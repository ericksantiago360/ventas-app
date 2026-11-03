"""
Checkout público de la tienda (sin cuenta de usuario).

- POST /api/tienda/{slug}/checkout                 crea la orden
- GET  /api/tienda/{slug}/ordenes/{folio}?email=   estado de la orden (folio + correo como acceso)

Flujo: checkout → instrucciones de pago → el negocio confirma en el tablero → pedido en el Kanban.
Los precios se calculan en el servidor; el cliente solo manda producto, variante y cantidad.
"""
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import get_db

from ..email_service import enviar_aviso_interno, enviar_orden_recibida
from ..models.orden import CheckoutBody
from ..services import (
    TIPOS_CON_PAGO,
    ahora,
    calcular_totales,
    cargar_lineas,
    config_por_slug,
    costo_envio_checkout,
    generar_referencia,
    instrucciones_pago,
    crear_oportunidad_desde_orden,
    registrar_cliente_ecommerce,
    siguiente_folio,
    tipo_de_orden,
    validar_stock,
)

router = APIRouter()


@router.post("/tienda/{slug}/checkout", status_code=201)
async def checkout(slug: str, body: CheckoutBody, db=Depends(get_db)):
    config = await config_por_slug(db, slug)
    negocio_id = config["negocio_id"]

    # Primero se resuelven las líneas para saber el tipo de orden
    lineas = await cargar_lineas(db, negocio_id, body.partidas, config)
    tipo = tipo_de_orden(config, lineas)
    cotizar = tipo not in TIPOS_CON_PAGO

    if cotizar:
        for linea in lineas:
            linea["precio_unitario"] = 0.0
        totales = {"subtotal": 0.0, "iva": 0.0, "total": 0.0}
    else:
        if not body.metodo_pago:
            raise HTTPException(422, "Elige un método de pago")
        if not any(m.get("tipo") == body.metodo_pago for m in config.get("metodos_pago", [])):
            raise HTTPException(422, "Ese método de pago no está disponible en esta tienda")
        await validar_stock(db, negocio_id, lineas)
        totales = calcular_totales(lineas, config.get("iva_incluido", False))

    con_pago = not cotizar
    envio = 0.0
    if con_pago:
        # La entrega la elige el cliente, pero solo entre las opciones que el negocio habilitó
        disponible = config.get("entrega_envio", False) if body.entrega == "envio" \
            else config.get("entrega_recoger", True)
        if not disponible:
            raise HTTPException(422, "Esa opción de entrega no está disponible en esta tienda")
        envio = costo_envio_checkout(config, body.entrega, totales["total"])
        totales["total"] = round(totales["total"] + envio, 2)

    folio = await siguiente_folio(db)
    referencia = generar_referencia(folio, totales["total"]) if con_pago else None

    cliente = body.cliente.model_dump()
    orden = {
        "negocio_id": negocio_id,
        "folio": folio,
        "tipo": tipo,
        "estado": "pendiente_pago" if con_pago else "solicitud",
        "cliente": cliente,
        "partidas": lineas,
        "subtotal": totales["subtotal"],
        "iva": totales["iva"],
        "total": totales["total"],
        "entrega": body.entrega if con_pago else None,
        "costo_envio": envio,
        "metodo_pago_seleccionado": body.metodo_pago if con_pago else None,
        "referencia_pago": referencia,
        "notas_cliente": body.notas.strip(),
        "cita_solicitada": body.cita_solicitada,
        "pedido_id": None,
        "inventario_descontado": [],
        "created_at": ahora(),
        "updated_at": ahora(),
    }
    resultado = await db.ordenes_ecommerce.insert_one(orden)
    orden["_id"] = resultado.inserted_id

    await registrar_cliente_ecommerce(db, negocio_id, cliente)
    if not con_pago:
        # Cotización o contacto: la oportunidad del CRM existe desde que el cliente la envía
        await crear_oportunidad_desde_orden(db, orden)

    if con_pago:
        await enviar_orden_recibida(orden, config)
    await enviar_aviso_interno(orden, config)

    respuesta = {
        "ok": True,
        "folio": folio,
        "tipo": tipo,
        "estado": orden["estado"],
        "total": totales["total"],
        "referencia_pago": referencia,
    }
    if con_pago:
        respuesta["instrucciones_pago"] = instrucciones_pago(
            config, body.metodo_pago, folio, referencia, totales["total"],
        )
    return respuesta


@router.get("/tienda/{slug}/ordenes/{folio}")
async def estado_orden(
    slug: str,
    folio: str,
    email: str = Query(..., min_length=5),
    db=Depends(get_db),
):
    config = await config_por_slug(db, slug)
    orden = await db.ordenes_ecommerce.find_one({
        "negocio_id": config["negocio_id"],
        "folio": folio.upper(),
        "cliente.email": email.strip().lower(),
    })
    if not orden:
        raise HTTPException(404, "No encontramos una orden con ese folio y correo")

    metodo = orden.get("metodo_pago_seleccionado")
    cfg_metodo = next((m for m in config.get("metodos_pago", []) if m.get("tipo") == metodo), None)
    return {
        "folio": orden["folio"],
        "tipo": orden["tipo"],
        "estado": orden["estado"],
        "partidas": [
            {"nombre": p["nombre"], "cantidad": p["cantidad"], "subtotal": p.get("subtotal", 0)}
            for p in orden["partidas"]
        ],
        "subtotal": orden["subtotal"],
        "iva": orden["iva"],
        "total": orden["total"],
        "metodo_pago": metodo,
        "referencia_pago": orden.get("referencia_pago"),
        # Solo los últimos 4 dígitos de la CLABE: la completa va en el checkout y en el correo
        "clabe_terminacion": (cfg_metodo or {}).get("clabe", "")[-4:] if metodo == "transferencia" else None,
        "creada": orden["created_at"],
    }
