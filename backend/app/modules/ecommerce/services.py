"""
Lógica de la tienda en línea: precios, folios, stock, clientes y el paso de una
orden confirmada al Kanban de pedidos.

Las rutas públicas y admin usan estas funciones; no escriben en otras colecciones
por su cuenta.
"""
import re
import uuid
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import HTTPException
from pymongo import ReturnDocument

from app.routers.crm import config_crm
from app.routers.pedidos import generar_numero_pedido
from app.services.contabilidad_integracion import crear_poliza_venta_pedido

from .models.config import DEFAULTS_TIENDA

IVA_DEFAULT_PCT = 16.0
ESTADOS_CONFIRMABLES = ("pendiente_pago", "pago_en_revision", "solicitud")
ESTADOS_CANCELABLES = ("pendiente_pago", "pago_en_revision", "solicitud", "confirmada")
TIPOS_CON_PAGO = ("producto", "servicio")
ETIQUETA_PAGO = {"transferencia": "Transferencia SPEI", "oxxo_cie": "Pago en OXXO (CIE)"}


def ahora() -> datetime:
    return datetime.now(timezone.utc)


def redondear(valor: float) -> float:
    return round(valor + 1e-9, 2)


# ============================================================
# CONFIGURACIÓN Y CATÁLOGO
# ============================================================

async def config_por_slug(db, slug: str) -> dict:
    """Tienda activa por slug. 404 si no existe o está apagada (sin revelar cuál)."""
    config = await db.tienda_config.find_one({"slug": slug.lower(), "activa": True})
    if not config:
        raise HTTPException(404, "Tienda no encontrada")
    return config


def config_completa(config: dict | None) -> dict:
    """Config guardada mezclada con los valores por defecto."""
    return {**DEFAULTS_TIENDA, **(config or {})}


def producto_visible(producto: dict, config: dict) -> bool:
    if not producto or producto.get("activo") is False:
        return False
    visibles = config.get("categorias_visibles") or []
    if visibles and producto.get("categoria_id") not in visibles:
        return False
    return True


def tasa_iva(producto: dict) -> float:
    if not producto.get("iva_aplicable", True):
        return 0.0
    return float(producto.get("iva_pct", IVA_DEFAULT_PCT) or 0) / 100


async def cargar_lineas(db, negocio_id: str, partidas: list, config: dict) -> list[dict]:
    """
    Convierte las partidas del cliente en líneas con precio tomado del catálogo.

    Partidas repetidas se suman.
    """
    agrupadas: dict[tuple, int] = {}
    for p in partidas:
        clave = (p.producto_id, p.variante_id or None)
        agrupadas[clave] = agrupadas.get(clave, 0) + p.cantidad

    lineas = []
    for (producto_id, variante_id), cantidad in agrupadas.items():
        if not ObjectId.is_valid(producto_id):
            raise HTTPException(400, "Producto inválido")
        producto = await db.productos.find_one({"_id": ObjectId(producto_id), "negocio_id": negocio_id})
        if not producto_visible(producto, config):
            raise HTTPException(404, "Un producto de tu carrito ya no está disponible")

        precio = float(producto.get("precio_base") or 0)
        nombre, sku = producto["nombre"], producto.get("sku", "")
        if variante_id:
            if not ObjectId.is_valid(variante_id):
                raise HTTPException(400, "Variante inválida")
            variante = await db.variantes_producto.find_one({
                "_id": ObjectId(variante_id), "producto_id": producto_id,
                "negocio_id": negocio_id, "activo": {"$ne": False},
            })
            if not variante:
                raise HTTPException(404, "Una variante de tu carrito ya no está disponible")
            precio = float(variante.get("precio") or 0) or precio
            nombre = f"{nombre} · {variante.get('nombre') or variante.get('sku', '')}".strip(" ·")
            sku = variante.get("sku", sku)

        lineas.append({
            "producto_id": producto_id,
            "variante_id": variante_id,
            "nombre": nombre,
            "sku": sku,
            "cantidad": cantidad,
            "precio_unitario": redondear(precio),
            "iva_tasa": tasa_iva(producto),
            "control_inventario": bool(producto.get("control_inventario", False)),
            "tipo_producto": producto.get("tipo", "producto"),
        })
    return lineas


def calcular_totales(lineas: list[dict], iva_incluido: bool) -> dict:
    """
    Subtotal, IVA y total. Con iva_incluido el precio ya trae el IVA dentro;
    si no, el IVA se suma encima.
    """
    subtotal = iva = total = 0.0
    for linea in lineas:
        importe = linea["precio_unitario"] * linea["cantidad"]
        tasa = linea["iva_tasa"]
        if iva_incluido:
            base = importe / (1 + tasa) if tasa else importe
            impuesto = importe - base
            subtotal += base
            iva += impuesto
            total += importe
        else:
            subtotal += importe
            iva += importe * tasa
        linea["subtotal"] = redondear(importe)
    total = total if iva_incluido else subtotal + iva
    return {
        "subtotal": redondear(subtotal),
        "iva": redondear(iva),
        "total": redondear(total),
    }


def costo_envio_checkout(config: dict, entrega: str, total: float) -> float:
    """
    Costo de envío a domicilio. Recoger en tienda siempre es gratis.
    Si el total (con IVA) alcanza monto_envio_gratis, el envío también es gratis.
    """
    if entrega != "envio":
        return 0.0
    gratis = float(config.get("monto_envio_gratis") or 0)
    if gratis > 0 and total >= gratis:
        return 0.0
    return redondear(float(config.get("costo_envio") or 0))


def tipo_de_orden(config: dict, lineas: list[dict]) -> str:
    if config.get("modo") == "propiedades":
        return "contacto"
    if not config.get("mostrar_precio", True):
        return "cotizacion"
    if any(l["tipo_producto"] == "servicio" for l in lineas):
        return "servicio"
    return "producto"


# ============================================================
# FOLIOS Y REFERENCIAS DE PAGO
# ============================================================

async def siguiente_folio(db) -> str:
    """Folio global de la tienda: ECO-0001, ECO-0002, …"""
    contador = await db.contadores_ecommerce.find_one_and_update(
        {"_id": "folio"},
        {"$inc": {"secuencia": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return f"ECO-{contador['secuencia']:04d}"


def generar_referencia(folio: str, total: float) -> str:
    """
    Referencia que el cliente escribe en su transferencia u OXXO para identificar
    el pago en el estado de cuenta. Ej.: ECO-0042-1580 para una orden de $1,580.
    """
    sufijo = str(int(round(total)))[-4:].zfill(4)
    return f"{folio}-{sufijo}"


# ============================================================
# STOCK
# ============================================================

async def stock_disponible(db, negocio_id: str, producto_id: str) -> float:
    total = 0.0
    docs = db.inventario.find({
        "negocio_id": negocio_id, "producto_id": producto_id, "activo": {"$ne": False},
    })
    async for doc in docs:
        total += float(doc.get("stock_actual", 0) or 0)
    return total


async def validar_stock(db, negocio_id: str, lineas: list[dict]) -> None:
    """Revisión previa al checkout. El descuento real ocurre al confirmar el pago."""
    for linea in lineas:
        if not linea["control_inventario"]:
            continue
        disponible = await stock_disponible(db, negocio_id, linea["producto_id"])
        if disponible < linea["cantidad"]:
            raise HTTPException(
                409,
                f"Stock insuficiente de {linea['nombre']}. Disponible: {int(disponible)}",
            )


async def descontar_stock(db, negocio_id: str, lineas: list[dict], usuario_id: str, referencia: str, concepto: str = "Tienda en línea") -> list[dict]:
    """
    Descuenta el stock de las líneas que controlan inventario. Si algo falla a la
    mitad, repone lo ya descontado y responde 409.
    """
    descuentos: list[dict] = []
    try:
        for linea in lineas:
            if not linea["control_inventario"]:
                continue
            restante = linea["cantidad"]
            docs = db.inventario.find({
                "negocio_id": negocio_id, "producto_id": linea["producto_id"],
                "activo": {"$ne": False}, "stock_actual": {"$gt": 0},
            }).sort("stock_actual", -1)
            async for doc in docs:
                if restante <= 0:
                    break
                tomar = min(restante, float(doc["stock_actual"]))
                resultado = await db.inventario.update_one(
                    {"_id": doc["_id"], "stock_actual": {"$gte": tomar}},
                    {"$inc": {"stock_actual": -tomar}, "$set": {"updated_at": ahora()}},
                )
                if resultado.modified_count == 0:
                    raise HTTPException(409, f"Stock insuficiente de {linea['nombre']}")
                descuentos.append({"inventario_id": str(doc["_id"]), "cantidad": tomar})
                restante -= tomar
                await _movimiento_inventario(
                    db, negocio_id, doc, "salida", tomar,
                    float(doc["stock_actual"]), float(doc["stock_actual"]) - tomar, referencia, usuario_id, concepto,
                )
            if restante > 0:
                raise HTTPException(409, f"Stock insuficiente de {linea['nombre']}")
    except HTTPException:
        await reponer_stock(db, negocio_id, descuentos, usuario_id, referencia, concepto)
        raise
    return descuentos


async def reponer_stock(db, negocio_id: str, descuentos: list[dict], usuario_id: str, referencia: str, concepto: str = "Tienda en línea") -> None:
    for d in descuentos:
        oid = ObjectId(d["inventario_id"])
        antes = await db.inventario.find_one({"_id": oid})
        await db.inventario.update_one(
            {"_id": oid},
            {"$inc": {"stock_actual": d["cantidad"]}, "$set": {"updated_at": ahora()}},
        )
        if antes:
            await _movimiento_inventario(
                db, negocio_id, antes, "entrada", d["cantidad"],
                float(antes["stock_actual"]), float(antes["stock_actual"]) + d["cantidad"], referencia, usuario_id, concepto,
            )


async def _movimiento_inventario(db, negocio_id, doc, tipo, cantidad, anterior, nuevo, referencia, usuario_id, concepto: str = "Tienda en línea") -> None:
    """Movimiento con el mismo formato que registra el módulo de inventario."""
    await db.inventario_movimientos.insert_one({
        "negocio_id": negocio_id,
        "inventario_id": str(doc["_id"]),
        "producto_nombre": doc.get("nombre", ""),
        "tipo": tipo,
        "cantidad": cantidad,
        "stock_anterior": anterior,
        "stock_nuevo": nuevo,
        "concepto": concepto,
        "referencia": referencia,
        "consignatario": "",
        "fecha": ahora(),
        "usuario_id": usuario_id,
    })


# ============================================================
# CLIENTES
# ============================================================

async def registrar_cliente_ecommerce(db, negocio_id: str, cliente: dict) -> None:
    """Cliente de la tienda (sin cuenta), identificado por correo."""
    ahora_ = ahora()
    await db.clientes_ecommerce.update_one(
        {"negocio_id": negocio_id, "email": cliente["email"]},
        {
            "$set": {
                "nombre": cliente["nombre"],
                "telefono": cliente["telefono"],
                "direccion_envio": cliente.get("direccion_envio", {}),
                "updated_at": ahora_,
            },
            "$inc": {"total_ordenes": 1},
            "$setOnInsert": {"created_at": ahora_},
        },
        upsert=True,
    )


async def cliente_crm_por_correo(db, negocio_id: str, cliente: dict) -> str:
    """ID del cliente en el CRM; si no existe, lo crea."""
    existente = await db.clientes.find_one({
        "negocio_id": negocio_id,
        "email": {"$regex": f"^{re.escape(cliente['email'])}$", "$options": "i"},
    })
    if existente:
        return str(existente["_id"])
    resultado = await db.clientes.insert_one({
        "negocio_id": negocio_id,
        "nombre": cliente["nombre"],
        "email": cliente["email"],
        "telefono": cliente["telefono"],
        "direccion_envio": cliente.get("direccion_envio", {}),
        "origen": "tienda",
        "activo": True,
        "created_at": ahora(),
        "updated_at": ahora(),
    })
    return str(resultado.inserted_id)


async def crear_oportunidad_desde_orden(db, orden: dict) -> None:
    """Solicitudes de cotización o contacto entran al CRM como oportunidad en la primera etapa del pipeline."""
    negocio_id = orden["negocio_id"]
    # Bienes Raíces exige tipo_lead; un interesado en una propiedad es comprador
    tipo_lead = "comprador" if negocio_id == "bienes_raices" else None
    pipeline, terminales = await config_crm(db, negocio_id, tipo_lead)
    cliente_id = await cliente_crm_por_correo(db, negocio_id, orden["cliente"])
    interes = ", ".join(f"{p['cantidad']} × {p['nombre']}" for p in orden["partidas"])
    etapa = pipeline[0]
    marca = ahora()
    await db.oportunidades.insert_one({
        "cliente_id": ObjectId(cliente_id),
        "negocio_id": negocio_id,
        "etapa": etapa,
        "tipo_lead": tipo_lead,
        "valor_estimado": orden.get("total"),
        "activo": etapa not in terminales,
        "origen": "tienda",
        "notas": f"Orden {orden['folio']} ({orden['tipo']}). Interés: {interes}. {orden.get('notas_cliente', '')}".strip(),
        "created_at": marca,
        "updated_at": marca,
    })


# ============================================================
# PEDIDOS (Kanban existente)
# ============================================================

async def crear_pedido_desde_orden(db, orden: dict, usuario_id: str) -> str:
    """
    Crea el pedido en el Kanban con el pago ya registrado: confirmar la orden
    significa que el dinero llegó.
    """
    negocio_id = orden["negocio_id"]
    cliente_id = await cliente_crm_por_correo(db, negocio_id, orden["cliente"])
    numero = await generar_numero_pedido(db, negocio_id)
    ahora_ = ahora().isoformat()
    total = orden["total"]

    pago = {
        "id": str(uuid.uuid4())[:8],
        "monto": total,
        "metodo": orden.get("metodo_pago_seleccionado"),
        "referencia": orden.get("referencia_pago"),
        "concepto": f"Pago en tienda en línea ({orden['folio']})",
        "fecha": ahora_,
    }

    pedido = {
        "negocio_id": negocio_id,
        "numero": numero,
        "cliente_id": cliente_id,
        "cliente_nombre": orden["cliente"]["nombre"],
        "items": [
            {
                "producto_id": p["producto_id"],
                "variante_id": p.get("variante_id"),
                "nombre": p["nombre"],
                "sku": p.get("sku", ""),
                "cantidad": p["cantidad"],
                "precio_unitario": p["precio_unitario"],
                "subtotal": p["subtotal"],
            }
            for p in orden["partidas"]
        ],
        "subtotal": orden["subtotal"],
        "iva": orden["iva"],
        "total": total,
        "estado": "confirmado",
        "etapa_interna": "recibido",
        "pagos": [pago],
        "saldo_pendiente": 0,
        "archivos": [],
        "historial": [],
        "origen": "ecommerce",
        "folio_eco": orden["folio"],
        "orden_ecommerce_id": str(orden["_id"]),
        "notas": orden.get("notas_cliente", ""),
        "created_at": ahora_,
        "updated_at": ahora_,
    }
    resultado = await db.pedidos.insert_one(pedido)
    pedido["_id"] = resultado.inserted_id

    if total > 0:
        await crear_poliza_venta_pedido(db, pedido, usuario_id)
    return str(resultado.inserted_id)


async def cancelar_pedido_de_orden(db, pedido_id: str) -> None:
    await db.pedidos.update_one(
        {"_id": ObjectId(pedido_id)},
        {"$set": {"estado": "cancelado", "updated_at": ahora().isoformat()}},
    )


def instrucciones_pago(config: dict, metodo: str, folio: str, referencia: str, total: float) -> dict | None:
    """Datos que el cliente necesita para pagar: se muestran solo al hacer el checkout."""
    metodo_cfg = next((m for m in config.get("metodos_pago", []) if m.get("tipo") == metodo), None)
    if not metodo_cfg:
        return None
    return {
        "tipo": metodo,
        "etiqueta": ETIQUETA_PAGO.get(metodo, metodo),
        "banco": metodo_cfg.get("banco", ""),
        "titular": metodo_cfg.get("titular", ""),
        "clabe": metodo_cfg.get("clabe", "") if metodo == "transferencia" else "",
        "convenio_cie": metodo_cfg.get("cuenta", "") if metodo == "oxxo_cie" else "",
        "monto": total,
        "referencia": referencia,
        "folio": folio,
        "instrucciones": metodo_cfg.get("instrucciones", ""),
    }
