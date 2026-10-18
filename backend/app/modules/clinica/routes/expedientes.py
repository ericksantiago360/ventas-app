import re
from datetime import datetime, timezone
from urllib.parse import quote

from bson import ObjectId
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from gridfs.errors import NoFile
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from app.core.database import get_db
from app.core.negocios import (
    negocio_autorizado, negocios_del_usuario, obtener_del_negocio, validar_referencia, verificar_acceso,
)
from app.core.security import get_current_user
from app.routers.pacientes import calcular_edad, siguiente_folio as siguiente_folio_paciente

from ..models.expediente import Antecedentes, ExpedienteCreate, ExpedienteUpdate, NotaCreate

router = APIRouter(prefix="/clinica", tags=["Clínica"])

CAMPOS_BUSQUEDA = ("nombre", "apellido_paterno", "apellido_materno", "curp", "folio")

# Los adjuntos van a GridFS y no a STORAGE_PATH: /storage se sirve sin autenticación
MAX_ARCHIVO = 10 * 1024 * 1024
TIPOS_ARCHIVO = {"application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"}


# ── Utilidades ────────────────────────────────────────────────────────────────

async def siguiente_folio(db, negocio_id: str) -> str:
    counter = await db.counters.find_one_and_update(
        {"_id": f"expedientes_{negocio_id}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    return f"EXP-{str(counter['seq']).zfill(5)}"


def limpiar_alergias(alergias: list[str]) -> list[str]:
    vistas, resultado = set(), []
    for a in alergias:
        a = a.strip()
        if a and a.lower() not in vistas:
            vistas.add(a.lower())
            resultado.append(a)
    return resultado


def alergias_de_texto(texto: str) -> list[str]:
    """`pacientes.alergias` es texto libre; se separa por comas, punto y coma o renglones."""
    return limpiar_alergias(re.split(r"[,;\n]", texto or ""))


async def validar_medico(db, medico_id: str, negocio_id: str) -> dict | None:
    """El médico es un usuario activo con acceso al negocio. Vacío = sin médico asignado."""
    if not medico_id:
        return None
    if not ObjectId.is_valid(medico_id):
        raise HTTPException(400, "Médico: ID inválido")
    medico = await db.usuarios.find_one({"_id": ObjectId(medico_id), "activo": {"$ne": False}})
    if not medico or negocio_id not in negocios_del_usuario(medico):
        raise HTTPException(404, "Médico: no existe en este negocio")
    return medico


async def obtener_expediente(db, id: str, user: dict) -> dict:
    return await obtener_del_negocio(db.expedientes, id, user, "Expediente")


def a_paciente(doc: dict) -> dict:
    paciente = {k: v for k, v in doc.items() if k not in ("_id", "negocio_id", "portal_version")}
    paciente["id"] = str(doc["_id"])
    paciente["edad"] = calcular_edad(doc.get("fecha_nacimiento", ""))
    return paciente


def a_respuesta(exp: dict, paciente: dict | None, medico: dict | None) -> dict:
    antecedentes = exp.get("antecedentes") or {}
    return {
        "id":            str(exp["_id"]),
        "negocio_id":    exp["negocio_id"],
        "folio":         exp["folio"],
        "paciente_id":   exp["paciente_id"],
        "paciente":      a_paciente(paciente) if paciente else None,
        "antecedentes":  antecedentes,
        "alergico":      bool(antecedentes.get("alergias")),
        "medico_id":     exp.get("medico_id", ""),
        "medico_nombre": (medico or {}).get("nombre", ""),
        "activo":        exp.get("activo", True),
        "archivos":      exp.get("archivos_adjuntos", []),
        "created_at":    exp.get("created_at"),
        "updated_at":    exp.get("updated_at"),
    }


async def a_respuestas(db, expedientes: list[dict]) -> list[dict]:
    """Une cada expediente con su paciente y su médico en dos consultas."""
    def oids(valores):
        return [ObjectId(v) for v in valores if v and ObjectId.is_valid(v)]

    pacientes = {
        str(p["_id"]): p
        for p in await db.pacientes.find({"_id": {"$in": oids(e["paciente_id"] for e in expedientes)}}).to_list(None)
    }
    medicos = {
        str(u["_id"]): u
        for u in await db.usuarios.find(
            {"_id": {"$in": oids(e.get("medico_id") for e in expedientes)}}, {"nombre": 1}
        ).to_list(None)
    }
    return [a_respuesta(e, pacientes.get(e["paciente_id"]), medicos.get(e.get("medico_id"))) for e in expedientes]


def a_nota(doc: dict) -> dict:
    nota = {k: v for k, v in doc.items() if k != "_id"}
    nota["id"] = str(doc["_id"])
    return nota


async def filtro_busqueda(db, negocio_id: str, q: str) -> dict:
    """Cada palabra de q debe aparecer en algún dato del paciente (nombre, apellidos, CURP, folio)."""
    terminos = q.split()
    condiciones = [
        {"$or": [{c: {"$regex": re.escape(t), "$options": "i"}} for c in CAMPOS_BUSQUEDA]}
        for t in terminos
    ]
    pacientes = await db.pacientes.find(
        {"negocio_id": negocio_id, "$and": condiciones}, {"_id": 1}
    ).to_list(1000)
    return {"$or": [
        {"folio": {"$regex": re.escape(q.strip()), "$options": "i"}},
        {"paciente_id": {"$in": [str(p["_id"]) for p in pacientes]}},
    ]}


def campos_paciente(datos: dict) -> dict:
    """Campos del modelo del expediente → documento de `pacientes`, incluidos los que usa laboratorio."""
    campos = dict(datos)
    if "contacto_emergencia" in campos:
        campos["telefono_emergencia"] = campos["contacto_emergencia"].get("telefono", "")
    return campos


# ── Médicos ───────────────────────────────────────────────────────────────────

@router.get("/medicos")
async def listar_medicos(
    negocio_id: str = Depends(negocio_autorizado),
    db=Depends(get_db),
):
    """Usuarios del negocio que pueden ser médico tratante."""
    docs = await db.usuarios.find(
        {"activo": {"$ne": False}, "$or": [{"negocios": negocio_id}, {"businesses": negocio_id}]},
        {"nombre": 1, "rol": 1},
    ).sort("nombre", 1).to_list(500)
    return [{"id": str(d["_id"]), "nombre": d.get("nombre", ""), "rol": d.get("rol", "")} for d in docs]


# ── Expedientes ───────────────────────────────────────────────────────────────

@router.get("/expedientes")
async def listar_expedientes(
    negocio_id: str = Depends(negocio_autorizado),
    q: str = Query(""),
    medico_id: str = Query(""),
    solo_activos: bool = Query(True),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db=Depends(get_db),
):
    filtro: dict = {"negocio_id": negocio_id}
    if solo_activos:
        filtro["activo"] = True
    if medico_id:
        filtro["medico_id"] = medico_id
    if q.strip():
        filtro.update(await filtro_busqueda(db, negocio_id, q))

    total = await db.expedientes.count_documents(filtro)
    docs = await db.expedientes.find(filtro).sort("updated_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"items": await a_respuestas(db, docs), "total": total, "skip": skip, "limit": limit}


@router.get("/expedientes/buscar")
async def buscar_expedientes(
    negocio_id: str = Depends(negocio_autorizado),
    q: str = Query(..., min_length=1),
    db=Depends(get_db),
):
    """Búsqueda rápida (autocompletar) por nombre, CURP o folio."""
    filtro = {"negocio_id": negocio_id, "activo": True, **await filtro_busqueda(db, negocio_id, q)}
    docs = await db.expedientes.find(filtro).sort("updated_at", -1).limit(10).to_list(10)
    return await a_respuestas(db, docs)


@router.post("/expedientes", status_code=201)
async def crear_expediente(
    body: ExpedienteCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    medico = await validar_medico(db, body.medico_id, body.negocio_id)
    now = datetime.now(timezone.utc)

    if body.paciente_id:
        paciente = await validar_referencia(db.pacientes, body.paciente_id, body.negocio_id, "Paciente")
        existente = await db.expedientes.find_one({"negocio_id": body.negocio_id, "paciente_id": body.paciente_id})
        if existente:
            raise HTTPException(409, f"El paciente ya tiene el expediente {existente['folio']}")
        antecedentes = body.antecedentes or Antecedentes(alergias=alergias_de_texto(paciente.get("alergias", "")))
    else:
        antecedentes = body.antecedentes or Antecedentes()
        paciente = {
            **campos_paciente(body.paciente.model_dump()),
            "negocio_id":      body.negocio_id,
            "folio":           await siguiente_folio_paciente(db, body.negocio_id),
            "tipo_sangre":     "desconocido",
            "medico_tratante": (medico or {}).get("nombre", ""),
            "medico_cedula":   "",
            "alergias":        "",
            "notas":           "",
            "activo":          True,
            "created_at":      now,
            "updated_at":      now,
        }
        paciente["_id"] = (await db.pacientes.insert_one(paciente)).inserted_id

    antecedentes.alergias = limpiar_alergias(antecedentes.alergias)
    paciente_id = str(paciente["_id"])
    doc = {
        "negocio_id":   body.negocio_id,
        "folio":        await siguiente_folio(db, body.negocio_id),
        "paciente_id":  paciente_id,
        "antecedentes": antecedentes.model_dump(),
        "medico_id":    body.medico_id,
        "archivos_adjuntos": [],
        "activo":       True,
        "created_at":   now,
        "updated_at":   now,
    }
    doc["_id"] = (await db.expedientes.insert_one(doc)).inserted_id

    # Laboratorio y el portal leen las alergias del paciente como texto
    alergias = ", ".join(antecedentes.alergias)
    if alergias != paciente.get("alergias", ""):
        await db.pacientes.update_one({"_id": paciente["_id"]}, {"$set": {"alergias": alergias}})
        paciente["alergias"] = alergias

    return a_respuesta(doc, paciente, medico)


@router.get("/expedientes/{id}")
async def obtener_expediente_detalle(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    exp = await obtener_expediente(db, id, user)
    respuesta = (await a_respuestas(db, [exp]))[0]
    notas = await db.notas_clinicas.find({"expediente_id": respuesta["id"]}).sort("fecha", -1).to_list(None)
    respuesta["notas"] = [a_nota(n) for n in notas]
    # Resultados de laboratorio críticos que el médico aún no ha recibido
    respuesta["lab_criticos_pendientes"] = await db.ordenes_trabajo.count_documents({
        "negocio_id": exp["negocio_id"], "paciente_id": exp["paciente_id"],
        "resultados_criticos": True, "notificado_medico": False,
    })
    return respuesta


@router.put("/expedientes/{id}")
async def actualizar_expediente(
    id: str,
    body: ExpedienteUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    exp = await obtener_expediente(db, id, user)
    now = datetime.now(timezone.utc)
    cambios_exp: dict = {}
    cambios_paciente: dict = {}

    if body.paciente:
        cambios_paciente.update(campos_paciente(body.paciente.model_dump(exclude_none=True)))
    if body.antecedentes:
        antecedentes = body.antecedentes.model_dump(exclude_none=True)
        if "alergias" in antecedentes:
            antecedentes["alergias"] = limpiar_alergias(antecedentes["alergias"])
            cambios_paciente["alergias"] = ", ".join(antecedentes["alergias"])
        cambios_exp.update({f"antecedentes.{k}": v for k, v in antecedentes.items()})
    if body.medico_id is not None:
        await validar_medico(db, body.medico_id, exp["negocio_id"])
        cambios_exp["medico_id"] = body.medico_id

    if not cambios_exp and not cambios_paciente:
        raise HTTPException(400, "Sin campos a actualizar")

    if cambios_paciente:
        await db.pacientes.update_one(
            {"_id": ObjectId(exp["paciente_id"]), "negocio_id": exp["negocio_id"]},
            {"$set": {**cambios_paciente, "updated_at": now}},
        )
    exp = await db.expedientes.find_one_and_update(
        {"_id": exp["_id"]}, {"$set": {**cambios_exp, "updated_at": now}}, return_document=True
    )
    return (await a_respuestas(db, [exp]))[0]


# ── Notas clínicas SOAP ───────────────────────────────────────────────────────

@router.post("/expedientes/{id}/notas", status_code=201)
async def agregar_nota(
    id: str,
    body: NotaCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    exp = await obtener_expediente(db, id, user)
    if not exp.get("activo", True):
        raise HTTPException(400, "El expediente está cerrado")
    now = datetime.now(timezone.utc)
    # La nota la firma quien la escribe; no se puede registrar a nombre de otro médico
    doc = {
        **body.model_dump(),
        "negocio_id":    exp["negocio_id"],
        "expediente_id": str(exp["_id"]),
        "medico_id":     user["_id"],
        "medico_nombre": user.get("nombre", ""),
        "fecha":         body.fecha or now,
        "created_at":    now,
    }
    doc["_id"] = (await db.notas_clinicas.insert_one(doc)).inserted_id
    await db.expedientes.update_one({"_id": exp["_id"]}, {"$set": {"updated_at": now}})
    return a_nota(doc)


@router.get("/expedientes/{id}/notas")
async def listar_notas(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    exp = await obtener_expediente(db, id, user)
    notas = await db.notas_clinicas.find({"expediente_id": str(exp["_id"])}).sort("fecha", -1).to_list(None)
    return [a_nota(n) for n in notas]


# ── Archivos adjuntos ─────────────────────────────────────────────────────────

def bucket_archivos(db) -> AsyncIOMotorGridFSBucket:
    return AsyncIOMotorGridFSBucket(db, bucket_name="expedientes_archivos")


@router.post("/expedientes/{id}/archivos", status_code=201)
async def subir_archivo(
    id: str,
    archivo: UploadFile = File(...),
    descripcion: str = Form(""),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Estudios, imágenes o documentos externos del paciente (PDF o imagen, hasta 10 MB)."""
    exp = await obtener_expediente(db, id, user)
    if not exp.get("activo", True):
        raise HTTPException(400, "El expediente está cerrado")
    if archivo.content_type not in TIPOS_ARCHIVO:
        raise HTTPException(400, "Solo se aceptan PDF o imágenes (JPG, PNG, WEBP, HEIC)")
    contenido = await archivo.read(MAX_ARCHIVO + 1)
    if len(contenido) > MAX_ARCHIVO:
        raise HTTPException(413, "El archivo excede 10 MB")
    if not contenido:
        raise HTTPException(400, "El archivo está vacío")

    nombre = (archivo.filename or "archivo").rsplit("/", 1)[-1][:200]
    archivo_id = await bucket_archivos(db).upload_from_stream(
        nombre, contenido,
        metadata={"negocio_id": exp["negocio_id"], "expediente_id": str(exp["_id"]),
                  "content_type": archivo.content_type},
    )
    ref = {
        "id":           str(archivo_id),
        "nombre":       nombre,
        "descripcion":  descripcion.strip(),
        "content_type": archivo.content_type,
        "tamano":       len(contenido),
        "subido_por":   user.get("nombre", ""),
        "fecha":        datetime.now(timezone.utc),
    }
    await db.expedientes.update_one(
        {"_id": exp["_id"]}, {"$push": {"archivos_adjuntos": ref}, "$set": {"updated_at": ref["fecha"]}}
    )
    return ref


@router.get("/expedientes/{id}/archivos")
async def listar_archivos(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    exp = await obtener_expediente(db, id, user)
    return sorted(exp.get("archivos_adjuntos", []), key=lambda a: a["fecha"], reverse=True)


@router.get("/expedientes/{id}/archivos/{archivo_id}")
async def descargar_archivo(
    id: str,
    archivo_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    exp = await obtener_expediente(db, id, user)
    # Solo los archivos registrados en este expediente; así no se lee uno de otro negocio por id
    ref = next((a for a in exp.get("archivos_adjuntos", []) if a["id"] == archivo_id), None)
    if not ref:
        raise HTTPException(404, "Archivo no encontrado")
    try:
        stream = await bucket_archivos(db).open_download_stream(ObjectId(archivo_id))
    except NoFile:
        raise HTTPException(404, "Archivo no encontrado")

    async def contenido():
        while chunk := await stream.readchunk():
            yield chunk

    nombre = ref["nombre"].replace('"', "")
    return StreamingResponse(contenido(), media_type=ref["content_type"], headers={
        "Content-Disposition": f"inline; filename*=UTF-8''{quote(nombre)}",
    })
