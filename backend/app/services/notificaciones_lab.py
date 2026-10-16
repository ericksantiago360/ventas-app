"""
Correos al paciente: entrega de resultados (con PDF adjunto) y enlace
de acceso al portal del paciente.
"""
from html import escape

from fastapi import Request

from app.core.config import settings
from app.core.security import create_portal_token
from app.services.correo import enviar_correo
from app.services.reporte_lab import generar_pdf_resultados, nombre_archivo_pdf


def url_publica(request: Request) -> str:
    """Base de los enlaces en correos. En producción define APP_URL: sin ella se
    usa el Host de la petición, que detrás de un proxy puede no ser el público."""
    return (settings.APP_URL or str(request.base_url)).rstrip("/")


def enlace_portal(base_url: str, paciente: dict) -> tuple[str, str]:
    token, expira = create_portal_token(str(paciente["_id"]), paciente.get("portal_version", 0))
    return f"{base_url}/portal/acceso?t={token}", expira.strftime("%d/%m/%Y")


async def _datos_lab(db, negocio_id: str) -> dict:
    config = await db.config_negocios.find_one({"_id": negocio_id}) or {}
    return {
        "nombre":   config.get("nombre") or "Laboratorio de Análisis Clínico",
        "telefono": config.get("telefono", ""),
        "email":    config.get("email", ""),
    }


def _plantilla(lab: dict, saludo: str, parrafos: list[str], boton: tuple[str, str] | None, nota: str) -> str:
    contacto = "  ·  ".join(escape(x) for x in [lab["telefono"], lab["email"]] if x)
    cuerpo = "".join(f'<p style="margin:0 0 14px;line-height:1.55">{p}</p>' for p in parrafos)
    btn = ""
    if boton:
        texto, url = boton
        btn = (
            f'<p style="margin:22px 0"><a href="{escape(url)}" '
            'style="background:#1d4ed8;color:#fff;text-decoration:none;padding:11px 22px;'
            f'border-radius:6px;font-weight:600;display:inline-block">{escape(texto)}</a></p>'
        )
    return f"""<!doctype html>
<html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#1e293b">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:10px;overflow:hidden">
<tr><td style="background:#1d4ed8;color:#fff;padding:18px 24px;font-size:18px;font-weight:700">{escape(lab["nombre"])}</td></tr>
<tr><td style="padding:24px;font-size:14px">
<p style="margin:0 0 14px">{saludo}</p>
{cuerpo}{btn}
<p style="margin:18px 0 0;font-size:12px;color:#64748b;line-height:1.5">{nota}</p>
</td></tr>
<tr><td style="padding:14px 24px;background:#f8fafc;font-size:11px;color:#94a3b8">{contacto}</td></tr>
</table></td></tr></table></body></html>"""


async def enviar_resultados(db, orden: dict, paciente: dict, destinatario: str, mensaje: str, base_url: str) -> None:
    lab = await _datos_lab(db, orden["negocio_id"])
    pdf = await generar_pdf_resultados(db, orden, solo_validados=True)
    url, expira = enlace_portal(base_url, paciente)
    nombre = paciente.get("nombre", "").strip() or orden.get("paciente_nombre", "")
    folio = orden.get("folio", "")
    estudios = ", ".join(e.get("nombre", "") for e in orden.get("estudios", []))

    parrafos = [
        f"Tus resultados de laboratorio de la orden <strong>{escape(folio)}</strong> "
        f"({escape(orden.get('fecha', ''))}) ya están listos. Te los enviamos adjuntos en PDF.",
        f"Estudios: {escape(estudios)}.",
    ]
    if mensaje.strip():
        parrafos.append(escape(mensaje.strip()).replace("\n", "<br>"))
    parrafos.append("También puedes consultarlos y descargarlos en cualquier momento desde tu portal de paciente:")

    html = _plantilla(
        lab,
        f"Hola {escape(nombre)},",
        parrafos,
        ("Ver mis resultados", url),
        f"Este enlace es personal y vence el {expira}. Los resultados deben ser interpretados por tu médico.",
    )
    texto = (
        f"Hola {nombre},\n\n"
        f"Tus resultados de la orden {folio} ({orden.get('fecha', '')}) están listos y van adjuntos en PDF.\n"
        f"Estudios: {estudios}.\n\n"
        + (f"{mensaje.strip()}\n\n" if mensaje.strip() else "")
        + f"Consulta tu portal de paciente: {url}\n(enlace personal, vence el {expira})\n\n{lab['nombre']}"
    )
    await enviar_correo(
        destinatario,
        f"Tus resultados de laboratorio – {folio}",
        html,
        texto,
        nombre_remitente=lab["nombre"],
        responder_a=lab["email"],
        adjuntos=[(nombre_archivo_pdf(orden), pdf, "application/pdf")],
    )


async def enviar_acceso_portal(db, paciente: dict, base_url: str) -> None:
    lab = await _datos_lab(db, paciente["negocio_id"])
    url, expira = enlace_portal(base_url, paciente)
    nombre = paciente.get("nombre", "").strip()
    html = _plantilla(
        lab,
        f"Hola {escape(nombre)},",
        ["Usa el siguiente botón para entrar a tu portal de paciente, donde puedes consultar y "
         "descargar tus resultados de laboratorio."],
        ("Entrar a mi portal", url),
        f"El enlace es personal y vence el {expira}. Si no solicitaste este acceso, ignora este correo.",
    )
    texto = (
        f"Hola {nombre},\n\nEntra a tu portal de paciente para consultar tus resultados:\n{url}\n\n"
        f"El enlace es personal y vence el {expira}. Si no lo solicitaste, ignora este correo.\n\n{lab['nombre']}"
    )
    await enviar_correo(
        paciente["email"],
        f"Acceso a tu portal de resultados – {lab['nombre']}",
        html,
        texto,
        nombre_remitente=lab["nombre"],
        responder_a=lab["email"],
    )
