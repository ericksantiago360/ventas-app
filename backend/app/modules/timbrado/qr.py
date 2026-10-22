"""
QR de verificación del CFDI en el portal del SAT (se imprime en el PDF).
"""
import base64
import io
from urllib.parse import urlencode

import qrcode
from lxml import etree

from .pac_sw_sapien import TFD

PORTAL_SAT = "https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx"
CFDI = "http://www.sat.gob.mx/cfd/4"


def url_verificacion(uuid: str, rfc_emisor: str, rfc_receptor: str, total: float, sello: str) -> str:
    """Formato del SAT: total con 10 enteros y 6 decimales; fe son los últimos 8 caracteres del sello."""
    return PORTAL_SAT + "?" + urlencode({
        "id": uuid,
        "re": rfc_emisor,
        "rr": rfc_receptor,
        "tt": f"{float(total):017.6f}",
        "fe": sello[-8:],
    })


def url_desde_xml(xml_timbrado: str) -> str:
    """URL de verificación armada con los datos del CFDI timbrado (fe usa el Sello del CFDI, no el del SAT)."""
    raiz = etree.fromstring(xml_timbrado.encode("utf-8"))
    tfd = raiz.find(f".//{{{TFD}}}TimbreFiscalDigital")
    return url_verificacion(
        tfd.get("UUID"),
        raiz.find(f"{{{CFDI}}}Emisor").get("Rfc"),
        raiz.find(f"{{{CFDI}}}Receptor").get("Rfc"),
        float(raiz.get("Total")),
        raiz.get("Sello"),
    )


def qr_png(url: str) -> bytes:
    buf = io.BytesIO()
    qrcode.make(url).save(buf, format="PNG")
    return buf.getvalue()


def qr_data_uri(url: str) -> str:
    return "data:image/png;base64," + base64.b64encode(qr_png(url)).decode()
