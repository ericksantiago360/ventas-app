"""
Validación contra los XSD oficiales del SAT (CFDI 4.0 y Carta Porte 3.1).

tests/fixtures/sat_xsd.tgz trae cfdv40.xsd, CartaPorte31.xsd, tdCFDI.xsd y los catálogos
(catCFDI.xsd, catCartaPorte.xsd, catComExt.xsd) tal como los publica el SAT en
http://www.sat.gob.mx/sitio_internet/cfd/; aquí se reescriben sus schemaLocation para
resolverlos localmente, sin red.
"""
import re
import tarfile
import tempfile
from functools import lru_cache
from pathlib import Path

from lxml import etree

FIXTURE = Path(__file__).parent / "fixtures" / "sat_xsd.tgz"
CFDI = "http://www.sat.gob.mx/cfd/4"
CP = "http://www.sat.gob.mx/CartaPorte31"


@lru_cache(maxsize=None)
def _directorio() -> Path:
    destino = Path(tempfile.mkdtemp(prefix="sat_xsd_"))
    with tarfile.open(FIXTURE) as tgz:
        try:
            tgz.extractall(destino, filter="data")
        except TypeError:          # Python < 3.12 sin filtros de extracción
            tgz.extractall(destino)
    for xsd in destino.glob("*.xsd"):
        texto = xsd.read_text(encoding="utf-8")
        xsd.write_text(re.sub(r'schemaLocation="https?://[^"]*/([^/"]+\.xsd)"', r'schemaLocation="\1"', texto), encoding="utf-8")
    # El Complemento del CFDI exige (wildcard strict) conocer el esquema de cada complemento
    (destino / "cfdi_cartaporte.xsd").write_text(
        '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">'
        f'<xs:import namespace="{CFDI}" schemaLocation="cfdv40.xsd"/>'
        f'<xs:import namespace="{CP}" schemaLocation="CartaPorte31.xsd"/>'
        '</xs:schema>', encoding="utf-8")
    return destino


@lru_cache(maxsize=None)
def esquema(nombre: str) -> etree.XMLSchema:
    return etree.XMLSchema(etree.parse(str(_directorio() / nombre)))


def errores(xml: str | bytes) -> list[str]:
    """
    Errores contra cfdv40.xsd y CartaPorte31.xsd. Sello, NoCertificado y Certificado se
    llenan con valores de forma válida: el XML interno aún no está sellado.
    """
    raiz = etree.fromstring(xml.encode() if isinstance(xml, str) else xml)
    if raiz.find(f"{{{CFDI}}}Complemento/{{{CP}}}CartaPorte") is None:
        return ["Falta el complemento cartaporte31:CartaPorte"]
    raiz.set("Sello", "SELLO")
    raiz.set("NoCertificado", "0" * 20)
    raiz.set("Certificado", "CERTIFICADO")
    schema = esquema("cfdi_cartaporte.xsd")
    return [] if schema.validate(etree.ElementTree(raiz)) else [e.message for e in schema.error_log]
