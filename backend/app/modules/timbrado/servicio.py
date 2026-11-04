"""
Piezas comunes del timbrado: emisor fiscal, CSD activo, sellado + timbre y cancelación.
Lo usan la facturación y la carta porte; no conoce a ninguna de las dos.
"""
from datetime import datetime, timezone

from cryptography.fernet import InvalidToken
from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool

from . import pac_sw_sapien as pac
from .csd_signer import sellar
from .models.csd import aware


async def emisor_fiscal(db, negocio_id: str) -> dict:
    """Datos fiscales del negocio (los mismos que usa la carta porte)."""
    config = await db.config_negocios.find_one({"_id": negocio_id}, {"carta_porte_emisor": 1}) or {}
    emisor = config.get("carta_porte_emisor")
    if not emisor:
        raise HTTPException(400, "Registra primero los datos fiscales del negocio (RFC, razón social, régimen y código postal)")
    return emisor


async def csd_activo(db, negocio_id: str) -> dict:
    csd = await db.csd_negocios.find_one({"negocio_id": negocio_id, "activo": True})
    if not csd:
        raise HTTPException(400, "El negocio no tiene un CSD activo; súbelo en Administración → Negocios")
    if aware(csd["fecha_fin_vigencia"]) <= datetime.now(timezone.utc):
        raise HTTPException(400, f"El CSD venció el {aware(csd['fecha_fin_vigencia']):%d/%m/%Y}; sube uno vigente")
    return csd


async def timbrar_xml(db, negocio_id: str, xml: bytes) -> dict:
    """Sella el XML con el CSD activo y lo envía al PAC. Devuelve uuid, fecha, sello SAT y XML timbrado."""
    csd = await csd_activo(db, negocio_id)
    try:
        sellado = await run_in_threadpool(sellar, xml, csd)
    except (InvalidToken, RuntimeError):
        raise HTTPException(500, "No se pudo abrir el CSD del negocio; revisa CSD_MASTER_KEY")
    try:
        return await pac.timbrar(sellado)
    except pac.ErrorPAC as e:
        raise HTTPException(502, str(e))


async def cancelar_en_sat(rfc: str, uuid: str, motivo: str, folio_sustitucion: str = "") -> dict:
    try:
        return await pac.cancelar(rfc, uuid, motivo, folio_sustitucion)
    except pac.ErrorPAC as e:
        raise HTTPException(502, str(e))


def cancelacion_aceptada(respuesta: dict) -> bool:
    """El PAC informa el estatus; solo "cancelado" se toma como cancelación firme ante el SAT."""
    return str(respuesta.get("estatus") or respuesta.get("status") or "").strip().lower() == "cancelado"


def estado_sat_de(respuesta: dict) -> str:
    return str(respuesta.get("estatus") or respuesta.get("status") or "Solicitud enviada al SAT")
