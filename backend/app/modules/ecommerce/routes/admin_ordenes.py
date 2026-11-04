"""
Órdenes de la tienda en el panel del negocio.

- GET /api/admin/tienda/ordenes?negocio_id=&estado=&tipo=&buscar=&pagina=&limite=
- GET /api/admin/tienda/ordenes/{id}
- PUT /api/admin/tienda/ordenes/{id}/pago_recibido   pendiente_pago → pago_en_revision
- PUT /api/admin/tienda/ordenes/{id}/confirmar       → confirmada (crea pedido y descuenta stock)
- PUT /api/admin/tienda/ordenes/{id}/cancelar        → cancelada (repone stock si ya se había descontado)

Confirmar una orden de producto o servicio crea el pedido en el Kanban con el pago
registrado. Cotizaciones y contactos ya entraron al CRM como lead al enviarse.
"""
import re

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import get_db
from app.core.negocios import negocio_autorizado, obtener_del_negocio
from app.core.security import get_current_user
from app.models.base import serialize_doc, serialize_list

from ..email_service import enviar_orden_confirmada
from ..services import (
    ESTADOS_CANCELABLES,
    ESTADOS_CONFIRMABLES,
    TIPOS_CON_PAGO,
    ahora,
    cancelar_pedido_de_orden,
    config_completa,
    crear_pedido_desde_orden,
    descontar_stock,
    reponer_stock,
)

router = APIRouter()

ESTADOS_VALIDOS = ("pendiente_pago", "pago_en_revision", "solicitud", "confirmada", "enviada", "entregada", "cancelada")


async def _config_del_negocio(db, negocio_id: str) -> dict:
    return config_completa(await db.tienda_config.find_one({"negocio_id": negocio_id}))


@router.get("/admin/tienda/ordenes")
async def listar_ordenes(
    negocio_id: str = Depends(negocio_autorizado),
    estado: str | None = None,
    tipo: str | None = None,
    buscar: str | None = None,
    pagina: int = Query(1, ge=1),
    limite: int = Query(50, ge=1, le=200),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    filtro: dict = {"negocio_id": negocio_id}
    if estado:
        if estado not in ESTADOS_VALIDOS:
            raise HTTPException(400, "Estado inválido")
        filtro["estado"] = estado
    if tipo:
        filtro["tipo"] = tipo
    if buscar and buscar.strip():
        patron = re.escape(buscar.strip())
        filtro["$or"] = [
            {"folio": {"$regex": patron, "$options": "i"}},
            {"cliente.email": {"$regex": patron, "$options": "i"}},
            {"cliente.nombre": {"$regex": patron, "$options": "i"}},
            {"referencia_pago": {"$regex": patron, "$options": "i"}},
        ]

    cursor = db.ordenes_ecommerce.find(filtro).sort("created_at", -1).skip((pagina - 1) * limite).limit(limite)
    docs = await cursor.to_list(length=limite)
    return {
        "data": serialize_list(docs),
        "total": await db.ordenes_ecommerce.count_documents(filtro),
        "pagina": pagina,
        "limite": limite,
    }


@router.get("/admin/tienda/ordenes/{id}")
async def detalle_orden(id: str, db=Depends(get_db), user=Depends(get_current_user)):
    orden = await obtener_del_negocio(db.ordenes_ecommerce, id, user, "Orden")
    return serialize_doc(orden)


@router.put("/admin/tienda/ordenes/{id}/pago_recibido")
async def marcar_pago_en_revision(id: str, db=Depends(get_db), user=Depends(get_current_user)):
    orden = await obtener_del_negocio(db.ordenes_ecommerce, id, user, "Orden")
    if orden["estado"] != "pendiente_pago":
        raise HTTPException(400, "Solo una orden pendiente de pago puede pasar a revisión")
    await _actualizar_estado(db, orden, "pago_en_revision")
    return {"ok": True, "estado": "pago_en_revision"}


@router.put("/admin/tienda/ordenes/{id}/confirmar")
async def confirmar_orden(id: str, db=Depends(get_db), user=Depends(get_current_user)):
    orden = await obtener_del_negocio(db.ordenes_ecommerce, id, user, "Orden")
    if orden["estado"] not in ESTADOS_CONFIRMABLES:
        raise HTTPException(400, f"No se puede confirmar una orden en estado {orden['estado']}")

    negocio_id = orden["negocio_id"]
    usuario_id = str(user["_id"])
    config = await _config_del_negocio(db, negocio_id)
    pedido_id = None
    descuentos: list[dict] = []

    if orden["tipo"] in TIPOS_CON_PAGO:
        descuentos = await descontar_stock(db, negocio_id, orden["partidas"], usuario_id, orden["folio"])
        try:
            pedido_id = await crear_pedido_desde_orden(db, orden, usuario_id)
        except Exception:
            await reponer_stock(db, negocio_id, descuentos, usuario_id, orden["folio"])
            raise

    await db.ordenes_ecommerce.update_one(
        {"_id": orden["_id"]},
        {"$set": {
            "estado": "confirmada",
            "pedido_id": pedido_id,
            "inventario_descontado": descuentos,
            "confirmada_por": usuario_id,
            "updated_at": ahora(),
        }},
    )
    orden.update({"estado": "confirmada", "pedido_id": pedido_id})
    await enviar_orden_confirmada(orden, config)
    return {"ok": True, "estado": "confirmada", "pedido_id": pedido_id}


@router.put("/admin/tienda/ordenes/{id}/cancelar")
async def cancelar_orden(id: str, db=Depends(get_db), user=Depends(get_current_user)):
    orden = await obtener_del_negocio(db.ordenes_ecommerce, id, user, "Orden")
    if orden["estado"] not in ESTADOS_CANCELABLES:
        raise HTTPException(400, f"No se puede cancelar una orden en estado {orden['estado']}")

    usuario_id = str(user["_id"])
    if orden.get("inventario_descontado"):
        await reponer_stock(db, orden["negocio_id"], orden["inventario_descontado"], usuario_id, orden["folio"])
    if orden.get("pedido_id"):
        await cancelar_pedido_de_orden(db, orden["pedido_id"])

    await db.ordenes_ecommerce.update_one(
        {"_id": orden["_id"]},
        {"$set": {"estado": "cancelada", "inventario_descontado": [], "updated_at": ahora()}},
    )
    return {"ok": True, "estado": "cancelada"}


@router.put("/admin/tienda/ordenes/{id}/enviar")
async def marcar_enviada(id: str, db=Depends(get_db), user=Depends(get_current_user)):
    """Solo órdenes con envío a domicilio: confirmada → enviada."""
    orden = await obtener_del_negocio(db.ordenes_ecommerce, id, user, "Orden")
    if orden["estado"] != "confirmada":
        raise HTTPException(400, "Solo una orden confirmada puede marcarse como enviada")
    if orden.get("entrega") != "envio":
        raise HTTPException(400, "Esta orden es para recoger en tienda; márcala como entregada")
    await _actualizar_estado(db, orden, "enviada")
    return {"ok": True, "estado": "enviada"}


@router.put("/admin/tienda/ordenes/{id}/entregar")
async def marcar_entregada(id: str, db=Depends(get_db), user=Depends(get_current_user)):
    """Envío: enviada → entregada. Recoger en tienda: confirmada → entregada."""
    orden = await obtener_del_negocio(db.ordenes_ecommerce, id, user, "Orden")
    estado = orden["estado"]
    if estado not in ("confirmada", "enviada"):
        raise HTTPException(400, f"No se puede entregar una orden en estado {estado}")
    if estado == "confirmada" and orden.get("entrega") == "envio":
        raise HTTPException(400, "Primero marca la orden como enviada")
    await _actualizar_estado(db, orden, "entregada")
    return {"ok": True, "estado": "entregada"}


async def _actualizar_estado(db, orden: dict, estado: str) -> None:
    await db.ordenes_ecommerce.update_one(
        {"_id": orden["_id"]},
        {"$set": {"estado": estado, "updated_at": ahora()}},
    )
