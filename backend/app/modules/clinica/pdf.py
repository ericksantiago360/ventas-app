"""PDFs del módulo de clínica: plantillas HTML (app/templates) con Jinja2 → WeasyPrint."""
import base64
from datetime import timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from jinja2 import Environment, FileSystemLoader, select_autoescape
from reportlab.graphics import renderSVG
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing

from app.core.config import settings

PLANTILLAS = Path(__file__).resolve().parents[2] / "templates"
_jinja = Environment(loader=FileSystemLoader(PLANTILLAS), autoescape=select_autoescape(["html"]))

MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
         "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def qr_svg(texto: str) -> str:
    """QR como data URL SVG (sin dependencias nuevas: usa el de reportlab)."""
    widget = QrCodeWidget(texto, barLevel="M")
    x1, y1, x2, y2 = widget.getBounds()
    dibujo = Drawing(x2 - x1, y2 - y1)
    dibujo.add(widget)
    svg = renderSVG.drawToString(dibujo)
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


def datos_clinica(config: dict) -> dict:
    direccion = ", ".join(p for p in [
        config.get("direccion"), config.get("colonia"), config.get("ciudad"), config.get("estado_rep"),
        f"C.P. {config['cp']}" if config.get("cp") else "",
    ] if p)
    contacto = " · ".join(p for p in [
        f"Tel. {config['telefono']}" if config.get("telefono") else "", config.get("email", ""),
    ] if p)
    logo = config.get("logo_base64", "")
    return {
        "nombre":    config.get("nombre", ""),
        "direccion": direccion,
        "contacto":  contacto,
        "logo":      logo if logo.startswith("data:image/") else "",
    }


def fecha_larga(dt) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    local = dt.astimezone(ZoneInfo(settings.ZONA_HORARIA))
    return f"{local.day} de {MESES[local.month - 1]} de {local.year}, {local:%H:%M}"


def pdf_receta(receta: dict, config: dict, url_verificacion: str) -> bytes:
    # WeasyPrint se importa aquí: carga Pango al importarse y solo se necesita al generar
    from weasyprint import HTML

    html = _jinja.get_template("receta.html").render(
        r=receta,
        clinica=datos_clinica(config),
        fecha=fecha_larga(receta["fecha"]),
        qr=qr_svg(url_verificacion),
        url_verificacion_corta=url_verificacion.split("://", 1)[-1].rsplit("/", 1)[0],
    )
    return HTML(string=html, base_url=str(PLANTILLAS)).write_pdf()
