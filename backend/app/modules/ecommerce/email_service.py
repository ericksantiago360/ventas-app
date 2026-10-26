"""
Correos transaccionales de la tienda: orden recibida, orden confirmada y aviso
interno al negocio.

Usa el envío SMTP del sistema (services/correo.py). Si el correo no está
configurado o falla, la orden se guarda igual: el error solo se registra.
"""
import logging
from html import escape

from app.services.correo import CorreoError, correo_configurado, enviar_correo

from .services import ETIQUETA_PAGO

log = logging.getLogger(__name__)


def _plantilla(nombre_tienda: str, color: str, saludo: str, parrafos: list[str], bloque: str = "") -> str:
    cuerpo = "".join(f'<p style="margin:0 0 12px">{escape(p)}</p>' for p in parrafos)
    return f"""<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,sans-serif">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden">
<div style="background:{escape(color)};color:#fff;padding:16px 24px;font-size:18px;font-weight:bold">{escape(nombre_tienda)}</div>
<div style="padding:24px;color:#222;font-size:15px;line-height:1.5">
<p style="margin:0 0 16px">{escape(saludo)}</p>{cuerpo}{bloque}
</div></div></body></html>"""


def _tabla_partidas(orden: dict) -> str:
    filas = "".join(
        f"<tr><td style='padding:6px 0'>{p['cantidad']} × {escape(p['nombre'])}</td>"
        f"<td style='padding:6px 0;text-align:right'>${p['subtotal']:,.2f}</td></tr>"
        for p in orden["partidas"]
    )
    return (
        f"<table style='width:100%;border-collapse:collapse;margin:12px 0'>{filas}"
        f"<tr><td style='padding-top:8px;font-weight:bold'>Total</td>"
        f"<td style='padding-top:8px;text-align:right;font-weight:bold'>${orden['total']:,.2f}</td></tr></table>"
    )


def _bloque_pago(orden: dict, config: dict) -> str:
    metodo = orden.get("metodo_pago_seleccionado")
    cfg = next((m for m in config.get("metodos_pago", []) if m.get("tipo") == metodo), None)
    if not cfg:
        return ""
    if metodo == "transferencia":
        datos = f"Banco: {cfg.get('banco', '')}<br>Titular: {cfg.get('titular', '')}<br>CLABE: {cfg.get('clabe', '')}"
    else:
        datos = f"Número de servicio (convenio CIE): {cfg.get('cuenta', '')}"
    return (
        f"<div style='background:#f4f5f7;border-radius:6px;padding:14px;margin-top:12px'>"
        f"<strong>{escape(ETIQUETA_PAGO.get(metodo, metodo))}</strong><br>{datos}<br>"
        f"Monto: <strong>${orden['total']:,.2f}</strong><br>"
        f"Referencia: <strong>{escape(orden['referencia_pago'])}</strong></div>"
    )


async def _enviar(destinatario: str, asunto: str, html: str, texto: str, nombre_tienda: str, responder_a: str = "") -> None:
    if not destinatario or not correo_configurado():
        return
    try:
        await enviar_correo(destinatario, asunto, html, texto, nombre_remitente=nombre_tienda, responder_a=responder_a)
    except CorreoError as e:
        log.warning("Correo de tienda no enviado a %s: %s", destinatario, e)


async def enviar_orden_recibida(orden: dict, config: dict) -> None:
    """Al hacer el checkout: folio, productos y datos para pagar."""
    tienda = config.get("nombre_tienda", "")
    color = config.get("color_primario", "#1F6FEB")
    cliente = orden["cliente"]
    bloque = _tabla_partidas(orden)
    if orden.get("referencia_pago"):
        bloque += _bloque_pago(orden, config)
    html = _plantilla(
        tienda, color,
        f"Hola {cliente['nombre']}, recibimos tu orden {orden['folio']}.",
        ["Para confirmarla, realiza el pago con los datos de abajo e incluye la referencia. "
         "Confirmaremos tu pedido cuando recibamos el pago."],
        bloque,
    )
    texto = f"Hola {cliente['nombre']}, recibimos tu orden {orden['folio']} por ${orden['total']:,.2f}. "
    texto += f"Referencia de pago: {orden.get('referencia_pago', '-')}."
    await _enviar(cliente["email"], f"Orden {orden['folio']} recibida – {tienda}", html, texto, tienda,
                  config.get("correo_contacto", ""))


async def enviar_orden_confirmada(orden: dict, config: dict) -> None:
    tienda = config.get("nombre_tienda", "")
    color = config.get("color_primario", "#1F6FEB")
    cliente = orden["cliente"]
    if orden["tipo"] in ("producto", "servicio"):
        mensaje = "Recibimos tu pago y tu pedido ya está en preparación."
    else:
        mensaje = "Recibimos tu solicitud. Un asesor se comunicará contigo para darte seguimiento."
    html = _plantilla(
        tienda, color,
        f"Hola {cliente['nombre']}, tu orden {orden['folio']} fue confirmada.",
        [mensaje],
        _tabla_partidas(orden) if orden["tipo"] in ("producto", "servicio") else "",
    )
    texto = f"Hola {cliente['nombre']}, tu orden {orden['folio']} fue confirmada. {mensaje}"
    await _enviar(cliente["email"], f"Orden {orden['folio']} confirmada – {tienda}", html, texto, tienda,
                  config.get("correo_contacto", ""))


async def enviar_aviso_interno(orden: dict, config: dict) -> None:
    """Al negocio: nueva orden de la tienda y lo que debe esperar pagar."""
    destino = config.get("correo_contacto", "")
    tienda = config.get("nombre_tienda", "")
    cliente = orden["cliente"]
    etiqueta = orden["tipo"].capitalize()
    if orden["tipo"] in ("producto", "servicio"):
        bloque = _tabla_partidas(orden) + (
            f"<p>Referencia esperada: <strong>{escape(orden['referencia_pago'])}</strong></p>"
        )
    else:
        bloque = "<ul>" + "".join(
            f"<li>{p['cantidad']} × {escape(p['nombre'])}</li>" for p in orden["partidas"]
        ) + "</ul>"
    html = _plantilla(
        tienda, config.get("color_primario", "#1F6FEB"),
        f"Nueva orden {orden['folio']} ({etiqueta}).",
        [f"Cliente: {cliente['nombre']} · {cliente['email']} · {cliente['telefono']}"],
        bloque,
    )
    texto = f"Nueva orden {orden['folio']} de {cliente['nombre']} ({cliente['email']})."
    await _enviar(destino, f"Nueva orden {orden['folio']} – {tienda}", html, texto, tienda, cliente["email"])
