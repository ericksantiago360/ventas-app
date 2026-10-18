import hashlib
import json
import re
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from gridfs.errors import NoFile
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from app.core.database import get_db
from app.core.negocios import obtener_del_negocio, verificar_acceso
from app.core.permissions import con_permiso, exigir_permiso
from app.core.security import get_current_user
from app.routers.pacientes import calcular_edad

from ..models.consentimiento import (
    PLANTILLAS_BASE, ConsentimientoCreate, PlantillaConsentimiento, PlantillaConsentimientoUpdate, Revocacion,
)
from ..models.receta import PerfilMedico
from ..pdf import datos_clinica, fecha_larga, render_pdf

router = APIRouter(prefix="/clinica", tags=["Clínica"])

# Las imágenes de firma solo viajan en el PDF; la API no las devuelve
SIN_FIRMAS = {"firma_paciente_base64": 0, "medico.firma_base64": 0, "testigos.firma_base64": 0}


# ── Utilidades ────────────────────────────────────────────────────────────────

def bucket_pdfs(db) -> AsyncIOMotorGridFSBucket:
    return AsyncIOMotorGridFSBucket(db, bucket_name="consentimientos_pdf")


async def siguiente_folio(db, negocio_id: str) -> str:
    counter = await db.counters.find_one_and_update(
        {"_id": f"consentimientos_{negocio_id}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    return f"CON-{str(counter['seq']).zfill(5)}"


def llenar(texto: str, valores: dict) -> str:
    """Reemplaza {marcador} por su valor; los desconocidos quedan tal cual (sin romper con llaves sueltas)."""
    return re.sub(r"\{(\w+)\}", lambda m: valores.get(m[1], m[0]), texto)


def ip_de(request: Request) -> str:
    reenviada = request.headers.get("x-forwarded-for", "")
    return reenviada.split(",")[0].strip() or (request.client.host if request.client else "")


def huella(doc: dict) -> str:
    """SHA-256 de lo firmado: texto, personas, firmas y fecha. Cualquier cambio posterior la rompe."""
    fecha = doc["fecha_firma"]
    if fecha.tzinfo is None:          # Mongo la devuelve en UTC sin zona
        fecha = fecha.replace(tzinfo=timezone.utc)
    contenido = {
        "texto": doc["texto"], "paciente": doc["paciente"], "firmante": doc["firmante"],
        "firma_paciente": doc["firma_paciente_base64"],
        "medico": {k: doc["medico"].get(k, "") for k in ("nombre", "cedula_profesional", "firma_base64")},
        "testigos": doc["testigos"], "fecha_firma": fecha.isoformat(timespec="milliseconds"),
    }
    return hashlib.sha256(json.dumps(contenido, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def a_consentimiento(doc: dict) -> dict:
    c = {k: v for k, v in doc.items() if k not in ("_id", "pdf_id", "firma_paciente_base64")}
    c["id"] = str(doc["_id"])
    c["medico"] = {k: v for k, v in doc.get("medico", {}).items() if k != "firma_base64"}
    c["testigos"] = [{"nombre": t["nombre"]} for t in doc.get("testigos", [])]
    for campo in ("fecha_firma", "created_at"):
        if c.get(campo) and c[campo].tzinfo is None:
            c[campo] = c[campo].replace(tzinfo=timezone.utc)
    return c


async def generar_pdf(db, doc: dict) -> ObjectId:
    config = await db.config_negocios.find_one({"_id": doc["negocio_id"]}) or {}
    contenido = await run_in_threadpool(
        render_pdf, "consentimiento.html",
        c=doc, clinica=datos_clinica(config), fecha=fecha_larga(doc["fecha_firma"]),
        revocado_el=fecha_larga(doc["revocacion"]["fecha"]) if doc.get("revocacion") else "",
    )
    pdf_id = await bucket_pdfs(db).upload_from_stream(
        f"{doc['folio']}.pdf", contenido, metadata={"negocio_id": doc["negocio_id"], "consentimiento_id": str(doc["_id"])},
    )
    await db.consentimientos.update_one({"_id": doc["_id"]}, {"$set": {"pdf_id": pdf_id}})
    if doc.get("pdf_id"):
        try:
            await bucket_pdfs(db).delete(doc["pdf_id"])
        except NoFile:
            pass
    doc["pdf_id"] = pdf_id
    return pdf_id


# ── Plantillas ────────────────────────────────────────────────────────────────

def a_plantilla(doc: dict) -> dict:
    return {"id": str(doc["_id"]), "tipo": doc["tipo"], "titulo": doc["titulo"], "texto": doc["texto"], "propia": True}


@router.get("/consentimientos/plantillas")
async def listar_plantillas(
    negocio_id: str = Depends(con_permiso("consentimientos:read")),
    db=Depends(get_db),
):
    """Las del negocio y, para los tipos que no ha personalizado, las incluidas."""
    propias = [a_plantilla(d) for d in await db.consentimientos_plantillas.find(
        {"negocio_id": negocio_id, "activo": True}).sort("titulo", 1).to_list(200)]
    tipos = {p["tipo"] for p in propias}
    base = [{"id": f"base:{p['tipo']}", **p, "propia": False} for p in PLANTILLAS_BASE if p["tipo"] not in tipos]
    return base + propias


@router.post("/consentimientos/plantillas", status_code=201)
async def crear_plantilla(
    body: PlantillaConsentimiento,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Una plantilla propia de un tipo incluido (cirugia, anestesia…) la reemplaza para el negocio."""
    verificar_acceso(user, body.negocio_id)
    exigir_permiso(user, body.negocio_id, "consentimientos:config")
    tipo = re.sub(r"\W+", "_", body.tipo.strip().lower()).strip("_")
    if await db.consentimientos_plantillas.find_one({"negocio_id": body.negocio_id, "tipo": tipo, "activo": True}):
        raise HTTPException(409, f"Ya hay una plantilla de tipo {tipo}; edítala")
    now = datetime.now(timezone.utc)
    doc = {**body.model_dump(), "tipo": tipo, "activo": True, "created_at": now, "updated_at": now}
    doc["_id"] = (await db.consentimientos_plantillas.insert_one(doc)).inserted_id
    return a_plantilla(doc)


@router.put("/consentimientos/plantillas/{id}")
async def actualizar_plantilla(
    id: str,
    body: PlantillaConsentimientoUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Los consentimientos ya firmados guardan su propio texto: editar la plantilla no los cambia."""
    plantilla = await obtener_del_negocio(db.consentimientos_plantillas, id, user, "Plantilla")
    exigir_permiso(user, plantilla["negocio_id"], "consentimientos:config")
    cambios = body.model_dump(exclude_none=True)
    if not cambios:
        raise HTTPException(400, "Sin campos a actualizar")
    doc = await db.consentimientos_plantillas.find_one_and_update(
        {"_id": plantilla["_id"]}, {"$set": {**cambios, "updated_at": datetime.now(timezone.utc)}}, return_document=True
    )
    return a_plantilla(doc)


@router.delete("/consentimientos/plantillas/{id}")
async def eliminar_plantilla(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Si era de un tipo incluido, vuelve a usarse la plantilla incluida."""
    plantilla = await obtener_del_negocio(db.consentimientos_plantillas, id, user, "Plantilla")
    exigir_permiso(user, plantilla["negocio_id"], "consentimientos:config")
    await db.consentimientos_plantillas.update_one(
        {"_id": plantilla["_id"]}, {"$set": {"activo": False, "updated_at": datetime.now(timezone.utc)}}
    )
    return {"ok": True}


# ── Consentimientos ───────────────────────────────────────────────────────────

@router.get("/consentimientos")
async def listar_consentimientos(
    negocio_id: str = Depends(con_permiso("consentimientos:read")),
    expediente_id: str = Query(""),
    q: str = Query(""),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db=Depends(get_db),
):
    filtro: dict = {"negocio_id": negocio_id}
    if expediente_id:
        filtro["expediente_id"] = expediente_id
    if q.strip():
        patron = {"$regex": re.escape(q.strip()), "$options": "i"}
        filtro["$or"] = [{"folio": patron}, {"paciente.nombre": patron}, {"procedimiento": patron},
                         {"titulo": patron}, {"expediente_folio": patron}]
    total = await db.consentimientos.count_documents(filtro)
    docs = await db.consentimientos.find(filtro, SIN_FIRMAS).sort("fecha_firma", -1).skip(skip).limit(limit).to_list(limit)
    return {"items": [a_consentimiento(d) for d in docs], "total": total, "skip": skip, "limit": limit}


@router.post("/consentimientos", status_code=201)
async def crear_consentimiento(
    body: ConsentimientoCreate,
    request: Request,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Se firma en el momento, en el dispositivo de la clínica: paciente (o su representante),
    dos testigos y el médico que informa (con la firma de su perfil médico).
    """
    exp = await obtener_del_negocio(db.expedientes, body.expediente_id, user, "Expediente")
    exigir_permiso(user, exp["negocio_id"], "consentimientos:create")
    if not exp.get("activo", True):
        raise HTTPException(400, "El expediente está cerrado")
    perfil = PerfilMedico(**(user.get("perfil_medico") or {}))
    if not perfil.cedula_profesional:
        raise HTTPException(400, "Registra tu cédula profesional en tu perfil médico: el consentimiento lo firma el médico que informa")
    nombres = [t.nombre.strip().lower() for t in body.testigos]
    if len(set(nombres)) < 2:
        raise HTTPException(400, "Los dos testigos deben ser personas distintas")

    paciente = await db.pacientes.find_one({"_id": ObjectId(exp["paciente_id"])}) or {}
    nombre_paciente = " ".join(filter(None, [paciente.get(k) for k in ("nombre", "apellido_paterno", "apellido_materno")]))
    firmante = body.firmante.model_dump()
    firmante["nombre"] = firmante["nombre"].strip() if body.firmante.tipo == "representante" else (firmante["nombre"].strip() or nombre_paciente)
    if firmante["nombre"].lower() in nombres:
        raise HTTPException(400, "Un testigo no puede ser quien otorga el consentimiento")
    edad = calcular_edad(paciente.get("fecha_nacimiento", ""))

    config = await db.config_negocios.find_one({"_id": exp["negocio_id"]}) or {}
    now = datetime.now(timezone.utc)
    now = now.replace(microsecond=now.microsecond // 1000 * 1000)   # Mongo guarda milisegundos
    texto = llenar(body.texto, {
        "paciente":      nombre_paciente,
        "edad":          str(edad) if edad else "—",
        "firmante":      firmante["nombre"] + (f" ({firmante['parentesco']})" if firmante["tipo"] == "representante" else ""),
        "medico":        user.get("nombre", ""),
        "cedula":        perfil.cedula_profesional,
        "clinica":       config.get("nombre", "la clínica"),
        "fecha":         fecha_larga(now),
        "procedimiento": body.procedimiento.strip(),
        "riesgos":       body.riesgos.strip() or "—",
        "beneficios":    body.beneficios.strip() or "—",
        "alternativas":  body.alternativas.strip() or "—",
    })
    doc = {
        "negocio_id":       exp["negocio_id"],
        "folio":            await siguiente_folio(db, exp["negocio_id"]),
        "expediente_id":    str(exp["_id"]),
        "expediente_folio": exp["folio"],
        "tipo":             body.tipo.strip(),
        "titulo":           body.titulo.strip(),
        "procedimiento":    body.procedimiento.strip(),
        "texto":            texto,
        "paciente":         {"nombre": nombre_paciente, "edad": edad, "sexo": paciente.get("sexo", ""), "curp": paciente.get("curp", "")},
        "firmante":         firmante,
        "firma_paciente_base64": body.firma_paciente_base64,
        "medico_id":        user["_id"],
        "medico": {
            "nombre": user.get("nombre", ""), "cedula_profesional": perfil.cedula_profesional,
            "especialidad": perfil.especialidad, "firma_base64": perfil.firma_base64,
        },
        "testigos":         [{"nombre": t.nombre.strip(), "firma_base64": t.firma_base64} for t in body.testigos],
        "fecha_firma":      now,
        "ip_firma":         ip_de(request),
        "user_agent":       request.headers.get("user-agent", "")[:300],
        "estado":           "vigente",
        "revocacion":       None,
        "created_at":       now,
    }
    doc["huella"] = huella(doc)
    doc["_id"] = (await db.consentimientos.insert_one(doc)).inserted_id
    await generar_pdf(db, doc)
    return a_consentimiento(doc)


@router.get("/consentimientos/{id}")
async def obtener_consentimiento(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    doc = await obtener_del_negocio(db.consentimientos, id, user, "Consentimiento")
    exigir_permiso(user, doc["negocio_id"], "consentimientos:read")
    c = a_consentimiento(doc)
    c["integro"] = huella(doc) == doc.get("huella")
    return c


@router.get("/consentimientos/{id}/pdf")
async def descargar_pdf(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    doc = await obtener_del_negocio(db.consentimientos, id, user, "Consentimiento")
    exigir_permiso(user, doc["negocio_id"], "consentimientos:read")
    try:
        contenido = await (await bucket_pdfs(db).open_download_stream(doc["pdf_id"])).read()
    except (KeyError, NoFile):
        contenido = await (await bucket_pdfs(db).open_download_stream(await generar_pdf(db, doc))).read()
    return Response(contenido, media_type="application/pdf", headers={
        "Content-Disposition": f'inline; filename="consentimiento-{doc["folio"]}.pdf"',
    })


@router.post("/consentimientos/{id}/revocar")
async def revocar_consentimiento(
    id: str,
    body: Revocacion,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """El paciente retira su consentimiento: queda registrado y el PDF sale marcado como revocado."""
    doc = await obtener_del_negocio(db.consentimientos, id, user, "Consentimiento")
    exigir_permiso(user, doc["negocio_id"], "consentimientos:update")
    if doc["estado"] == "revocado":
        raise HTTPException(400, "El consentimiento ya está revocado")
    revocacion = {"fecha": datetime.now(timezone.utc), "motivo": body.motivo.strip(), "usuario": user.get("nombre", "")}
    await db.consentimientos.update_one({"_id": doc["_id"]}, {"$set": {"estado": "revocado", "revocacion": revocacion}})
    doc.update({"estado": "revocado", "revocacion": revocacion})
    await generar_pdf(db, doc)
    return a_consentimiento(doc)
