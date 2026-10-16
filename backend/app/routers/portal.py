"""
Portal del paciente (público).

El paciente entra con un enlace firmado que recibe por correo (al enviarle
resultados o al solicitarlo aquí con su email). Solo ve sus órdenes y,
de ellas, únicamente los estudios ya validados.
"""
import re
import time

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import get_current_paciente
from app.services.correo import CorreoError, correo_configurado
from app.services.notificaciones_lab import enviar_acceso_portal, url_publica
from app.services.reporte_lab import generar_pdf_resultados, nombre_archivo_pdf

router = APIRouter(prefix="/portal", tags=["Portal del paciente"])

# Evita usar el formulario para inundar un buzón: un envío por email cada 2 min
_ESPERA_SOLICITUD = 120
_ultimas_solicitudes: dict[str, float] = {}


class SolicitudAcceso(BaseModel):
    email: str


def _nombre_completo(p: dict) -> str:
    return " ".join(x for x in [p.get("nombre", ""), p.get("apellido_paterno", ""), p.get("apellido_materno", "")] if x).strip()


async def _orden_del_paciente(db, paciente: dict, id: str) -> dict:
    try:
        oid = ObjectId(id)
    except Exception:
        raise HTTPException(404, "Orden no encontrada")
    orden = await db.ordenes_trabajo.find_one({"_id": oid, "paciente_id": str(paciente["_id"])})
    if not orden:
        raise HTTPException(404, "Orden no encontrada")
    return orden


@router.post("/solicitar-acceso")
async def solicitar_acceso(body: SolicitudAcceso, request: Request, db=Depends(get_db)):
    respuesta = {
        "ok": True,
        "mensaje": "Si tu correo está registrado en el laboratorio, recibirás un enlace de acceso en unos minutos.",
    }
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(400, "Correo inválido")
    if not correo_configurado():
        raise HTTPException(503, "El laboratorio aún no tiene habilitado el envío de correos")

    ahora = time.monotonic()
    if ahora - _ultimas_solicitudes.get(email, -_ESPERA_SOLICITUD) < _ESPERA_SOLICITUD:
        return respuesta
    _ultimas_solicitudes[email] = ahora

    # Un mismo correo puede estar registrado en varios laboratorios / expedientes
    pacientes = await db.pacientes.find({
        "email": {"$regex": f"^{re.escape(email)}$", "$options": "i"},
        "activo": True,
    }).to_list(10)
    base = url_publica(request)
    for p in pacientes:
        try:
            await enviar_acceso_portal(db, p, base)
        except CorreoError:
            pass  # no revelar si el correo existe
    return respuesta


@router.get("/me")
async def mis_datos(db=Depends(get_db), paciente=Depends(get_current_paciente)):
    config = await db.config_negocios.find_one({"_id": paciente["negocio_id"]}) or {}
    return {
        "nombre":   _nombre_completo(paciente),
        "folio":    paciente.get("folio", ""),
        "sexo":     paciente.get("sexo", ""),
        "fecha_nacimiento": paciente.get("fecha_nacimiento", ""),
        "laboratorio": {
            "nombre":    config.get("nombre") or "Laboratorio de Análisis Clínico",
            "direccion": ", ".join(x for x in [config.get("direccion", ""), config.get("colonia", ""), config.get("ciudad", "")] if x),
            "telefono":  config.get("telefono", ""),
            "email":     config.get("email", ""),
        },
    }


@router.get("/ordenes")
async def mis_ordenes(db=Depends(get_db), paciente=Depends(get_current_paciente)):
    pid = str(paciente["_id"])
    ordenes = await db.ordenes_trabajo.find({"paciente_id": pid}).sort("created_at", -1).to_list(200)
    salida = []
    for o in ordenes:
        oid = str(o["_id"])
        total = await db.resultados_lab.count_documents({"orden_id": oid})
        validados = await db.resultados_lab.count_documents({"orden_id": oid, "estado": "validado"})
        salida.append({
            "id":        oid,
            "folio":     o.get("folio", ""),
            "fecha":     o.get("fecha", ""),
            "medico":    o.get("medico_solicitante", ""),
            "estudios":  [e.get("nombre", "") for e in o.get("estudios", [])],
            "listo":     o.get("estado") in ("completado", "entregado"),
            "validados": validados,
            "total":     total,
        })
    return salida


@router.get("/ordenes/{id}")
async def detalle_orden(id: str, db=Depends(get_db), paciente=Depends(get_current_paciente)):
    orden = await _orden_del_paciente(db, paciente, id)
    resultados = await db.resultados_lab.find(
        {"orden_id": str(orden["_id"]), "estado": "validado"}
    ).sort("estudio_nombre", 1).to_list(50)

    sexo = orden.get("paciente_sexo", "masculino")
    estudios = []
    for r in resultados:
        analitos = []
        for a in r.get("analitos", []):
            if a.get("tipo") == "cualitativo":
                ref = a.get("referencia_texto") or ""
            else:
                pre = "referencia_mujer" if sexo == "femenino" else "referencia_hombre"
                rmin, rmax = a.get(f"{pre}_min"), a.get(f"{pre}_max")
                ref = f"{rmin} – {rmax}" if rmin is not None and rmax is not None else ""
            analitos.append({
                "nombre":     a.get("nombre", ""),
                "valor":      a.get("valor", ""),
                "unidad":     a.get("unidad", ""),
                "referencia": ref,
                "flag":       a.get("flag", "pendiente"),
            })
        estudios.append({
            "nombre":        r.get("estudio_nombre", ""),
            "categoria":     r.get("estudio_categoria", ""),
            "observaciones": r.get("observaciones", ""),
            "fecha_validacion": r.get("fecha_validacion"),
            "analitos":      analitos,
        })

    return {
        "id":       str(orden["_id"]),
        "folio":    orden.get("folio", ""),
        "fecha":    orden.get("fecha", ""),
        "medico":   orden.get("medico_solicitante", ""),
        "listo":    orden.get("estado") in ("completado", "entregado"),
        "pendientes": [e.get("nombre", "") for e in orden.get("estudios", [])
                       if e.get("nombre") not in {r.get("estudio_nombre") for r in resultados}],
        "estudios": estudios,
    }


@router.get("/ordenes/{id}/pdf")
async def pdf_orden(id: str, db=Depends(get_db), paciente=Depends(get_current_paciente)):
    orden = await _orden_del_paciente(db, paciente, id)
    validados = await db.resultados_lab.count_documents({"orden_id": str(orden["_id"]), "estado": "validado"})
    if not validados:
        raise HTTPException(400, "Aún no hay resultados disponibles para esta orden")
    pdf = await generar_pdf_resultados(db, orden, solo_validados=True)
    return Response(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{nombre_archivo_pdf(orden)}"'},
    )
