"""
Sellado de un CFDI 4.0 (ingreso o con complemento Carta Porte 3.1) con el CSD del negocio.

  1. Se ponen NoCertificado y Certificado en el nodo Comprobante
  2. La cadena original sale del XSLT del SAT (cadenaoriginal_4_0.xslt). Ese XSLT es 2.0 e
     incluye las plantillas de Carta Porte, así que lo procesa SaxonCHE; lxml solo hace XSLT 1.0.
  3. La cadena se firma con RSA-SHA256 (PKCS#1 v1.5) y el Sello va en base64
  4. La llave se descifra solo en memoria; nunca se escribe a disco ni se registra

Los XSLT vienen del árbol vendorizado en xslt/ (ver xslt/README.md).
"""
import base64
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from lxml import etree
from saxonche import PySaxonProcessor

from .crypto_utils import descifrar
from .models.csd import leer_llave

XSLT_CADENA_40 = Path(__file__).parent / "xslt" / "sitio_internet" / "cfd" / "4" / "cadenaoriginal_4_0" / "cadenaoriginal_4_0.xslt"


def cadena_original(xml_bytes: bytes) -> str:
    """Cadena original ||...|| del CFDI (incluye los complementos que el XSLT conoce)."""
    with PySaxonProcessor(license=False) as proc:
        # El XSLT del SAT tiene reglas ambiguas heredadas (XTDE0540) que Saxon resuelve sin problema:
        # se silencia el aviso para no ensuciar la salida del servidor en cada timbrado
        proc.set_configuration_property("http://saxon.sf.net/feature/recoveryPolicy", "recoverSilently")
        ejecutable = proc.new_xslt30_processor().compile_stylesheet(stylesheet_file=str(XSLT_CADENA_40))
        return ejecutable.transform_to_string(xdm_node=proc.parse_xml(xml_text=xml_bytes.decode("utf-8")))


def sellar(xml_bytes: bytes, csd: dict) -> bytes:
    """
    Devuelve el XML con NoCertificado, Certificado y Sello. `csd` es el documento de
    csd_negocios tal como está en la base (las llaves siguen cifradas).
    """
    # Las llaves se descifran aquí, dentro de la función, y no se guardan en ninguna variable de módulo
    certificado = x509.load_der_x509_certificate(base64.b64decode(csd["certificado_b64"]))
    llave = leer_llave(descifrar(csd["llave_privada_enc"]), descifrar(csd["contrasena_enc"]).decode(), certificado)

    doc = etree.fromstring(xml_bytes)
    doc.set("NoCertificado", csd["no_certificado"])
    doc.set("Certificado", csd["certificado_b64"])
    doc.set("Sello", "")       # la cadena original no incluye el Sello; se llena al final

    cadena = cadena_original(etree.tostring(doc, encoding="UTF-8", xml_declaration=True))
    firma = llave.sign(cadena.encode("utf-8"), padding.PKCS1v15(), hashes.SHA256())
    doc.set("Sello", base64.b64encode(firma).decode())
    return etree.tostring(doc, encoding="UTF-8", xml_declaration=True)
