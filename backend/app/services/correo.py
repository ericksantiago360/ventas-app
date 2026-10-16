"""
Envío de correo saliente vía SMTP.

smtplib es bloqueante, así que el envío se ejecuta en un hilo para no
detener el event loop de FastAPI.
"""
import asyncio
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from app.core.config import settings


class CorreoError(Exception):
    pass


def correo_configurado() -> bool:
    return bool(settings.SMTP_HOST and (settings.SMTP_FROM or settings.SMTP_USER))


def _enviar_sync(msg: EmailMessage) -> None:
    contexto = ssl.create_default_context()
    if settings.SMTP_SSL:
        servidor = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, context=contexto, timeout=30)
    else:
        servidor = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=30)
    with servidor:
        if not settings.SMTP_SSL:
            servidor.ehlo()
            if servidor.has_extn("starttls"):
                servidor.starttls(context=contexto)
                servidor.ehlo()
        if settings.SMTP_USER:
            servidor.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        servidor.send_message(msg)


async def enviar_correo(
    destinatario: str,
    asunto: str,
    html: str,
    texto: str,
    nombre_remitente: str = "",
    responder_a: str = "",
    adjuntos: list[tuple[str, bytes, str]] | None = None,   # (nombre, contenido, mime)
) -> None:
    if not correo_configurado():
        raise CorreoError("El envío de correo no está configurado (variables SMTP_* en el servidor)")

    remitente = settings.SMTP_FROM or settings.SMTP_USER
    msg = EmailMessage()
    msg["Subject"] = asunto
    msg["From"] = formataddr((settings.SMTP_FROM_NAME or nombre_remitente or "", remitente))
    msg["To"] = destinatario
    msg["Message-ID"] = make_msgid(domain=remitente.split("@")[-1])
    if responder_a:
        msg["Reply-To"] = responder_a
    msg.set_content(texto)
    msg.add_alternative(html, subtype="html")
    for nombre, contenido, mime in adjuntos or []:
        maintype, subtype = mime.split("/", 1)
        msg.add_attachment(contenido, maintype=maintype, subtype=subtype, filename=nombre)

    try:
        await asyncio.to_thread(_enviar_sync, msg)
    except (smtplib.SMTPException, OSError) as e:
        raise CorreoError(f"No se pudo enviar el correo: {e}") from e
