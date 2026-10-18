import re
import uuid
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from gridfs.errors import NoFile
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from app.core.config import settings
from app.core.database import get_db
from app.core.negocios import negocio_autorizado, obtener_del_negocio
from app.core.security import get_current_user
from app.routers.pacientes import calcular_edad

from ..models.receta import CancelarReceta, PerfilMedico, RecetaCreate
from ..pdf import datos_clinica, pdf_receta

router = APIRouter(prefix="/clinica", tags=["Clínica"])


# ── Utilidades ────────────────────────────────────────────────────────────────

def bucket_pdfs(db) -> AsyncIOMotorGridFSBucket:
    return AsyncIOMotorGridFSBucket(db, bucket_name="recetas_pdf")


async def siguiente_folio(db, negocio_id: str) -> str:
    counter = await db.counters.find_one_and_update(
        {"_id": f"recetas_{negocio_id}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    return f"RX-{str(counter['seq']).zfill(5)}"


def url_verificacion(request: Request, folio_verificacion: str) -> str:
    """URL pública del QR. APP_URL manda; si no está, se arma con el host por el que entró la petición."""
    base = settings.APP_URL.rstrip("/")
    if not base:
        proto = request.headers.get("x-forwarded-proto", request.url.scheme)
        host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
        base = f"{proto}://{host}"
    return f"{base}/rx/verificar/{folio_verificacion}"


def iniciales(nombre: str) -> str:
    return " ".join(f"{p[0].upper()}." for p in nombre.split() if p)


def a_receta(doc: dict) -> dict:
    receta = {k: v for k, v in doc.items() if k not in ("_id", "pdf_id")}
    receta["id"] = str(doc["_id"])
    for campo in ("fecha", "created_at", "cancelada_at"):
        if receta.get(campo) and receta[campo].tzinfo is None:
            receta[campo] = receta[campo].replace(tzinfo=timezone.utc)
    return receta


async def generar_y_guardar_pdf(db, receta: dict, url: str) -> ObjectId:
    """Genera el PDF, lo guarda en GridFS, lo enlaza a la receta y borra el anterior si había."""
    config = await db.config_negocios.find_one({"_id": receta["negocio_id"]}) or {}
    contenido = await run_in_threadpool(pdf_receta, receta, config, url)
    pdf_id = await bucket_pdfs(db).upload_from_stream(
        f"{receta['folio']}.pdf", contenido,
        metadata={"negocio_id": receta["negocio_id"], "receta_id": str(receta["_id"])},
    )
    await db.recetas.update_one({"_id": receta["_id"]}, {"$set": {"pdf_id": pdf_id, "url_verificacion": url}})
    if receta.get("pdf_id"):
        try:
            await bucket_pdfs(db).delete(receta["pdf_id"])
        except NoFile:
            pass
    receta.update({"pdf_id": pdf_id, "url_verificacion": url})
    return pdf_id


# ── Perfil médico (del usuario en sesión) ─────────────────────────────────────

@router.get("/perfil-medico")
async def obtener_perfil_medico(user=Depends(get_current_user)):
    """Datos que se imprimen en las recetas de quien tiene la sesión."""
    return {"nombre": user.get("nombre", ""), **PerfilMedico(**(user.get("perfil_medico") or {})).model_dump()}


@router.put("/perfil-medico")
async def actualizar_perfil_medico(
    body: PerfilMedico,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    perfil = {k: v.strip() if k != "firma_base64" else v for k, v in body.model_dump().items()}
    await db.usuarios.update_one({"_id": ObjectId(user["_id"])}, {"$set": {"perfil_medico": perfil}})
    return {"nombre": user.get("nombre", ""), **perfil}


# ── Verificación pública (QR) ─────────────────────────────────────────────────

@router.get("/recetas/verificar/{folio_verificacion}")
async def verificar_receta(folio_verificacion: str, db=Depends(get_db)):
    """
    Sin sesión: lo consulta la farmacia al escanear el QR. El folio es un UUID que
    solo aparece impreso en la receta; al paciente se le muestra solo con iniciales.
    """
    receta = await db.recetas.find_one({"folio_verificacion": folio_verificacion})
    if not receta:
        raise HTTPException(404, "Receta no encontrada")
    config = await db.config_negocios.find_one({"_id": receta["negocio_id"]}) or {}
    medico = receta["medico"]
    return {
        "valida":             receta["estado"] == "vigente",
        "estado":             receta["estado"],
        "motivo_cancelacion": receta.get("motivo_cancelacion", ""),
        "folio":              receta["folio"],
        "fecha":              a_receta(receta)["fecha"],
        "clinica":            datos_clinica(config)["nombre"],
        "medico": {
            "nombre":             medico["nombre"],
            "cedula_profesional": medico["cedula_profesional"],
            "especialidad":       medico.get("especialidad", ""),
        },
        "paciente_iniciales": iniciales(receta["paciente"]["nombre"]),
        "medicamentos": [
            {k: m.get(k, "") for k in ("nombre", "presentacion", "dosis", "frecuencia", "duracion", "via")}
            for m in receta["medicamentos"]
        ],
    }


# ── Recetas ───────────────────────────────────────────────────────────────────

@router.get("/recetas")
async def listar_recetas(
    negocio_id: str = Depends(negocio_autorizado),
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
        filtro["$or"] = [{"folio": patron}, {"paciente.nombre": patron}, {"expediente_folio": patron},
                         {"medicamentos.nombre": patron}]
    total = await db.recetas.count_documents(filtro)
    docs = await db.recetas.find(filtro, {"medico.firma_base64": 0}).sort("fecha", -1).skip(skip).limit(limit).to_list(limit)
    return {"items": [a_receta(d) for d in docs], "total": total, "skip": skip, "limit": limit}


@router.post("/recetas", status_code=201)
async def crear_receta(
    body: RecetaCreate,
    request: Request,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """La firma quien tiene la sesión, con los datos de su perfil médico; el PDF se genera al momento."""
    exp = await obtener_del_negocio(db.expedientes, body.expediente_id, user, "Expediente")
    if not exp.get("activo", True):
        raise HTTPException(400, "El expediente está cerrado")

    perfil = PerfilMedico(**(user.get("perfil_medico") or {}))
    if not perfil.cedula_profesional:
        raise HTTPException(400, "Registra tu cédula profesional en tu perfil médico antes de emitir recetas")

    nota = None
    if body.nota_clinica_id:
        if ObjectId.is_valid(body.nota_clinica_id):
            nota = await db.notas_clinicas.find_one({"_id": ObjectId(body.nota_clinica_id), "expediente_id": str(exp["_id"])})
        if not nota:
            raise HTTPException(404, "Nota clínica: no existe en este expediente")

    paciente = await db.pacientes.find_one({"_id": ObjectId(exp["paciente_id"])}) or {}
    signos = (nota or {}).get("signos_vitales") or {}
    diagnostico = body.diagnostico.strip() or "; ".join(
        " ".join(filter(None, [d.get("cie10"), d.get("descripcion")])) for d in (nota or {}).get("diagnosticos", [])
    )
    now = datetime.now(timezone.utc)
    doc = {
        "negocio_id":         exp["negocio_id"],
        "folio":              await siguiente_folio(db, exp["negocio_id"]),
        "folio_verificacion": str(uuid.uuid4()),
        "expediente_id":      str(exp["_id"]),
        "expediente_folio":   exp["folio"],
        "nota_clinica_id":    body.nota_clinica_id,
        "medico_id":          user["_id"],
        "medico":             {"nombre": user.get("nombre", ""), **perfil.model_dump()},
        "paciente": {
            "nombre":   " ".join(filter(None, [paciente.get(k) for k in ("nombre", "apellido_paterno", "apellido_materno")])),
            "edad":     calcular_edad(paciente.get("fecha_nacimiento", "")),
            "sexo":     paciente.get("sexo", ""),
            "alergias": (exp.get("antecedentes") or {}).get("alergias", []),
            "peso":     signos.get("peso"),
            "talla":    signos.get("talla"),
        },
        "medicamentos":           [m.model_dump() for m in body.medicamentos],
        "diagnostico":            diagnostico,
        "indicaciones_generales": body.indicaciones_generales.strip(),
        "fecha":                  now,
        "estado":                 "vigente",
        "motivo_cancelacion":     "",
        "created_at":             now,
    }
    doc["_id"] = (await db.recetas.insert_one(doc)).inserted_id
    await generar_y_guardar_pdf(db, doc, url_verificacion(request, doc["folio_verificacion"]))
    return a_receta(doc)


@router.get("/recetas/{id}")
async def obtener_receta(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    return a_receta(await obtener_del_negocio(db.recetas, id, user, "Receta"))


@router.get("/recetas/{id}/pdf")
async def descargar_pdf_receta(
    id: str,
    request: Request,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    receta = await obtener_del_negocio(db.recetas, id, user, "Receta")
    try:
        contenido = await (await bucket_pdfs(db).open_download_stream(receta["pdf_id"])).read()
    except (KeyError, NoFile):
        # Sin PDF guardado (falló al emitir o se perdió): se vuelve a generar con la misma URL del QR
        url = receta.get("url_verificacion") or url_verificacion(request, receta["folio_verificacion"])
        pdf_id = await generar_y_guardar_pdf(db, receta, url)
        contenido = await (await bucket_pdfs(db).open_download_stream(pdf_id)).read()
    return Response(contenido, media_type="application/pdf", headers={
        "Content-Disposition": f'inline; filename="receta-{receta["folio"]}.pdf"',
    })


@router.post("/recetas/{id}/cancelar")
async def cancelar_receta(
    id: str,
    body: CancelarReceta,
    request: Request,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """La receta no se borra: queda cancelada, el QR lo muestra y el PDF sale marcado."""
    receta = await obtener_del_negocio(db.recetas, id, user, "Receta")
    if receta["estado"] == "cancelada":
        raise HTTPException(400, "La receta ya está cancelada")
    if receta["medico_id"] != user["_id"] and user.get("rol") != "admin":
        raise HTTPException(403, "Solo el médico que la emitió o un administrador puede cancelarla")
    cambios = {
        "estado":             "cancelada",
        "motivo_cancelacion": body.motivo.strip(),
        "cancelada_por":      user.get("nombre", ""),
        "cancelada_at":       datetime.now(timezone.utc),
    }
    await db.recetas.update_one({"_id": receta["_id"]}, {"$set": cambios})
    receta.update(cambios)
    url = receta.get("url_verificacion") or url_verificacion(request, receta["folio_verificacion"])
    await generar_y_guardar_pdf(db, receta, url)
    return a_receta(receta)
