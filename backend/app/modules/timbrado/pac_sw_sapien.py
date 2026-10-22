"""
Timbrado y cancelación ante el SAT a través de SW Sapien (PAC).

Sandbox: https://services.test.sw.com.mx · Producción: https://services.sw.com.mx
Documentación: https://developers.sw.com.mx/

Lo que aún no está confirmado contra el sandbox (revisar antes de producción):
  - ruta de timbrado para CFDI 4.0 (STAMP_PATH) y el formato de la respuesta
  - ruta y verbo HTTP de cancelación (CANCEL_PATH, POST); SW documenta /cfdi33/cancel/{rfc}/{uuid}/{motivo}/{folio}
    y requiere tener los CSD cargados en su portal para esa vía
Los datos del TFD (UUID, fecha, sello SAT) se leen del XML timbrado, no de los campos JSON.

Nunca se incluyen el XML ni las credenciales en los mensajes de error.
"""
import base64

import httpx
from lxml import etree

from app.core.config import settings

TFD = "http://www.sat.gob.mx/TimbreFiscalDigital"
STAMP_PATH = "/cfdi40/stamp/v4/b64"
CANCEL_PATH = "/cfdi33/cancel/{rfc}/{uuid}/{motivo}"
TIMEOUT = 30


class ErrorPAC(Exception):
    """El PAC rechazó la operación o no se pudo contactar. El mensaje es apto para el usuario."""


async def _token(cliente: httpx.AsyncClient) -> str:
    if not settings.SW_USER or not settings.SW_PASSWORD:
        raise ErrorPAC("Faltan las credenciales del PAC (SW_USER y SW_PASSWORD) en la configuración")
    try:
        resp = await cliente.post(f"{settings.SW_URL}/security/authenticate",
                                  json={"user": settings.SW_USER, "password": settings.SW_PASSWORD})
    except httpx.HTTPError:
        raise ErrorPAC("No se pudo conectar con el PAC")
    datos = _json(resp)
    token = (_data(datos)).get("token")
    if resp.status_code >= 400 or not token:
        raise ErrorPAC(f"No se pudo autenticar con el PAC: {_mensaje(datos)}")
    return token


async def timbrar(xml_sellado: bytes) -> dict:
    """Envía el XML sellado y devuelve el XML timbrado con sus datos del TFD."""
    async with httpx.AsyncClient(timeout=TIMEOUT) as cliente:
        token = await _token(cliente)
        try:
            resp = await cliente.post(
                f"{settings.SW_URL}{STAMP_PATH}",
                headers={"Authorization": f"bearer {token}"},
                json={"xml": base64.b64encode(xml_sellado).decode()},
            )
        except httpx.HTTPError:
            raise ErrorPAC("No se pudo conectar con el PAC para timbrar")

    datos = _json(resp)
    xml_timbrado = (_data(datos)).get("cfdi")
    if resp.status_code >= 400 or not xml_timbrado:
        raise ErrorPAC(f"El PAC no timbró el comprobante: {_mensaje(datos)}")
    return {**datos_tfd(xml_timbrado), "xml_timbrado": xml_timbrado}


async def cancelar(rfc: str, uuid: str, motivo: str, folio_sustitucion: str = "") -> dict:
    """
    Solicita la cancelación ante el SAT. Devuelve la respuesta del PAC tal cual; el
    estatus lo interpreta quien llama.
    """
    ruta = CANCEL_PATH.format(rfc=rfc, uuid=uuid, motivo=motivo)
    if folio_sustitucion:
        ruta += f"/{folio_sustitucion}"
    async with httpx.AsyncClient(timeout=TIMEOUT) as cliente:
        token = await _token(cliente)
        try:
            resp = await cliente.post(f"{settings.SW_URL}{ruta}", headers={"Authorization": f"bearer {token}"})
        except httpx.HTTPError:
            raise ErrorPAC("No se pudo conectar con el PAC para cancelar")

    datos = _json(resp)
    if resp.status_code >= 400 or datos.get("status") == "error":
        raise ErrorPAC(f"El PAC no aceptó la cancelación: {_mensaje(datos)}")
    return _data(datos)


def datos_tfd(xml_timbrado: str) -> dict:
    """UUID, fecha de timbrado y sello del SAT del TimbreFiscalDigital."""
    raiz = etree.fromstring(xml_timbrado.encode("utf-8"))
    tfd = raiz.find(f".//{{{TFD}}}TimbreFiscalDigital")
    if tfd is None or not tfd.get("UUID"):
        raise ErrorPAC("La respuesta del PAC no trae el TimbreFiscalDigital")
    return {
        "uuid":           tfd.get("UUID"),
        "fecha_timbrado": tfd.get("FechaTimbrado"),
        "sello_sat":      tfd.get("SelloSAT"),
        "no_certificado_sat": tfd.get("NoCertificadoSAT"),
    }


def _data(datos: dict) -> dict:
    """El campo data de SW trae el resultado; en un error puede venir como texto."""
    data = datos.get("data")
    return data if isinstance(data, dict) else {}


def _json(resp: httpx.Response) -> dict:
    try:
        datos = resp.json()
    except ValueError:
        return {}
    return datos if isinstance(datos, dict) else {}


def _mensaje(datos: dict) -> str:
    d = _data(datos)
    codigo = d.get("codStatus") or datos.get("codigo") or ""
    texto = d.get("message") or datos.get("message") or d.get("messageDetail") or "sin detalle"
    return f"[{codigo}] {texto}" if codigo else texto
