from datetime import date, datetime, time, timedelta, timezone
from typing import Literal, Optional
from zoneinfo import ZoneInfo

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from app.core.config import settings
from app.core.database import get_db
from app.core.negocios import obtener_del_negocio, validar_cliente_unificado, verificar_acceso
from app.core.security import get_current_user
from app.modules.ecommerce.services import (
    calcular_totales, descontar_stock, redondear, reponer_stock, stock_disponible, tasa_iva,
)
from app.services.cobros import cancelar_cobro, registrar_cobro


router = APIRouter(prefix="/mostrador", tags=["Mostrador"])

METODOS_PAGO = Literal["efectivo", "tarjeta", "transferencia"]
CONCEPTO_VENTA = "Venta mostrador"
CONCEPTO_REPOSICION = "Cancelación venta mostrador"


# ──────────────────────────────────────────────────────────────────────────────
# Utilidades
# ──────────────────────────────────────────────────────────────────────────────

def serializar(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    return doc


def validar_oid(id: str) -> ObjectId:
    try:
        return ObjectId(id)
    except Exception:
        raise HTTPException(status_code=400, detail="ID inválido")


def rango_del_dia(dia: date) -> tuple[datetime, datetime]:
    """Medianoche a medianoche en la zona del negocio, expresado en UTC."""
    zona = ZoneInfo(settings.ZONA_HORARIA)
    inicio = datetime.combine(dia, time(0), tzinfo=zona).astimezone(timezone.utc)
    return inicio, inicio + timedelta(days=1)


def hoy() -> date:
    return datetime.now(ZoneInfo(settings.ZONA_HORARIA)).date()


async def generar_folio(db, negocio_id: str) -> str:
    contador = await db.contadores_ventas_mostrador.find_one_and_update(
        {"_id": negocio_id},
        {"$inc": {"secuencia": 1}, "$set": {"updated_at": datetime.now(timezone.utc)}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return f"VTA-{contador['secuencia']:06d}"


def descuento_para(cantidad: int, tramos: list[dict]) -> float:
    """
    Porcentaje del tramo más alto que alcanza la cantidad. Un solo tramo aplica por
    línea: no se acumulan. Sin tramo aplicable, 0.
    """
    aplicables = [t for t in tramos if t["cantidad_minima"] <= cantidad]
    if not aplicables:
        return 0.0
    return max(aplicables, key=lambda t: t["cantidad_minima"])["porcentaje"]


async def _tramos_activos(db, negocio_id: str) -> list[dict]:
    return await db.descuentos_volumen.find(
        {"negocio_id": negocio_id, "activo": {"$ne": False}}
    ).to_list(200)


async def _cargar_lineas(db, negocio_id: str, entrada: list) -> list[dict]:
    """Precios y nombres salen del catálogo, nunca del cliente. Partidas repetidas se suman."""
    agrupadas: dict[str, int] = {}
    for item in entrada:
        agrupadas[item.producto_id] = agrupadas.get(item.producto_id, 0) + item.cantidad

    tramos = await _tramos_activos(db, negocio_id)
    lineas = []
    for producto_id, cantidad in agrupadas.items():
        oid = validar_oid(producto_id)
        producto = await db.productos.find_one({"_id": oid, "negocio_id": negocio_id})
        if not producto:
            raise HTTPException(404, "Producto no encontrado en este negocio")
        if producto.get("activo") is False:
            raise HTTPException(422, f"El producto '{producto['nombre']}' está dado de baja")
        precio = float(producto.get("precio_base") or 0)
        if precio <= 0:
            raise HTTPException(422, f"El producto '{producto['nombre']}' no tiene precio de venta")

        pct = descuento_para(cantidad, tramos)
        lineas.append({
            "producto_id": producto_id,
            "nombre": producto["nombre"],
            "sku": producto.get("sku", ""),
            "cantidad": cantidad,
            "precio_lista": redondear(precio),
            "descuento_pct": pct,
            "precio_unitario": redondear(precio * (1 - pct / 100)),
            "iva_tasa": tasa_iva(producto),
            "control_inventario": bool(producto.get("control_inventario", False)),
        })
    return lineas


# ──────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ──────────────────────────────────────────────────────────────────────────────

class ItemVenta(BaseModel):
    producto_id: str
    cantidad: int = Field(gt=0)


class VentaCreate(BaseModel):
    negocio_id: str
    cuenta_id: str
    metodo_pago: METODOS_PAGO
    items: list[ItemVenta] = Field(min_length=1)
    monto_recibido: Optional[float] = Field(default=None, ge=0)
    cliente_id: Optional[str] = None
    notas: str = ""


class CancelarVentaIn(BaseModel):
    motivo: str = Field(min_length=1)


class TramoCreate(BaseModel):
    negocio_id: str
    nombre: str = Field(min_length=1)
    cantidad_minima: int = Field(ge=2)
    porcentaje: float = Field(gt=0, lt=100)


class TramoUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=1)
    cantidad_minima: Optional[int] = Field(default=None, ge=2)
    porcentaje: Optional[float] = Field(default=None, gt=0, lt=100)
    activo: Optional[bool] = None


# ──────────────────────────────────────────────────────────────────────────────
# Productos
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/productos")
async def listar_productos(
    negocio_id: str = Query(...),
    busqueda: str = Query(""),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    filtro: dict = {"negocio_id": negocio_id, "activo": {"$ne": False}}
    texto = busqueda.strip()
    if texto:
        filtro["$or"] = [
            {"nombre": {"$regex": texto, "$options": "i"}},
            {"codigo": {"$regex": texto, "$options": "i"}},
        ]

    productos = await db.productos.find(filtro).sort("nombre", 1).to_list(60)
    salida = []
    for p in productos:
        pid = str(p["_id"])
        salida.append({
            "id": pid,
            "nombre": p["nombre"],
            "sku": p.get("sku", ""),
            "precio": float(p.get("precio_base") or 0),
            "control_inventario": bool(p.get("control_inventario", False)),
            "stock": await stock_disponible(db, negocio_id, pid) if p.get("control_inventario") else None,
        })
    return salida


# ──────────────────────────────────────────────────────────────────────────────
# Ventas
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/ventas", status_code=201)
async def registrar_venta(
    body: VentaCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    usuario_id = str(user["_id"])

    cuenta = await db.cuentas_financieras.find_one({
        "_id": validar_oid(body.cuenta_id), "negocio_id": body.negocio_id, "activo": True,
    })
    if not cuenta:
        raise HTTPException(404, "Cuenta financiera no encontrada o dada de baja")
    await validar_cliente_unificado(db.clientes, body.cliente_id, "Cliente")

    lineas = await _cargar_lineas(db, body.negocio_id, body.items)
    totales = calcular_totales(lineas, iva_incluido=True)
    total = totales["total"]

    cambio = 0.0
    recibido = total
    if body.metodo_pago == "efectivo":
        if body.monto_recibido is None or body.monto_recibido < total:
            raise HTTPException(422, f"El monto recibido debe ser al menos {total:.2f}")
        recibido = redondear(body.monto_recibido)
        cambio = redondear(recibido - total)

    folio = await generar_folio(db, body.negocio_id)
    descuentos = await descontar_stock(
        db, body.negocio_id, lineas, usuario_id, referencia=folio, concepto=CONCEPTO_VENTA,
    )

    ahora = datetime.now(timezone.utc)
    venta = {
        "negocio_id": body.negocio_id,
        "folio": folio,
        "estado": "completada",
        "items": [{
            "producto_id": l["producto_id"], "nombre": l["nombre"], "sku": l["sku"],
            "cantidad": l["cantidad"], "precio_lista": l["precio_lista"],
            "descuento_pct": l["descuento_pct"], "precio_unitario": l["precio_unitario"],
            "iva_tasa": l["iva_tasa"], "importe": l["subtotal"],
        } for l in lineas],
        "subtotal": totales["subtotal"],
        "iva": totales["iva"],
        "total": total,
        "metodo_pago": body.metodo_pago,
        "monto_recibido": recibido,
        "cambio": cambio,
        "cuenta_id": body.cuenta_id,
        "cobro_id": None,
        "cliente_id": body.cliente_id,
        "notas": body.notas.strip(),
        "descuentos_stock": descuentos,
        "fecha": ahora,
        "cancelada_at": None,
        "motivo_cancelacion": "",
        "usuario_id": usuario_id,
        "created_at": ahora,
        "updated_at": ahora,
    }

    try:
        resultado = await db.ventas_mostrador.insert_one(venta)
        venta["_id"] = resultado.inserted_id
        cobro = await registrar_cobro(
            db,
            {
                "negocio_id": body.negocio_id,
                "cuenta_id": body.cuenta_id,
                "importe": total,
                "cliente_id": body.cliente_id,
                "metodo_pago": body.metodo_pago,
                "referencia": folio,
                "concepto": f"Venta {folio}",
                "fecha": ahora,
            },
            cuenta,
            usuario_id=usuario_id,
        )
        await db.ventas_mostrador.update_one(
            {"_id": resultado.inserted_id}, {"$set": {"cobro_id": str(cobro["_id"])}},
        )
        venta["cobro_id"] = str(cobro["_id"])
    except Exception:
        # Revierte: la venta y el stock. Un cobro guardado a medias se revisa desde Finanzas (ver spec §5)
        if venta.get("_id"):
            await db.ventas_mostrador.delete_one({"_id": venta["_id"]})
        await reponer_stock(db, body.negocio_id, descuentos, usuario_id, folio, CONCEPTO_REPOSICION)
        raise

    return serializar(venta)


@router.get("/ventas")
async def listar_ventas(
    negocio_id: str = Query(...),
    fecha: Optional[date] = Query(None),
    estado: Optional[Literal["completada", "cancelada"]] = Query(None),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    inicio, fin = rango_del_dia(fecha or hoy())
    filtro: dict = {"negocio_id": negocio_id, "fecha": {"$gte": inicio, "$lt": fin}}
    if estado:
        filtro["estado"] = estado
    ventas = await db.ventas_mostrador.find(filtro).sort("fecha", -1).to_list(500)
    return [serializar(v) for v in ventas]


@router.get("/ventas/{venta_id}")
async def detalle_venta(
    venta_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    venta = await obtener_del_negocio(db.ventas_mostrador, venta_id, user, "Venta")
    return serializar(venta)


@router.post("/ventas/{venta_id}/cancelar")
async def cancelar_venta(
    venta_id: str,
    body: CancelarVentaIn,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    venta = await obtener_del_negocio(db.ventas_mostrador, venta_id, user, "Venta")
    if venta["estado"] != "completada":
        raise HTTPException(400, "La venta ya está cancelada")

    ahora = datetime.now(timezone.utc)
    # Condicional: dos cancelaciones simultáneas no reponen el stock dos veces
    doc = await db.ventas_mostrador.find_one_and_update(
        {"_id": venta["_id"], "estado": "completada"},
        {"$set": {
            "estado": "cancelada", "cancelada_at": ahora,
            "motivo_cancelacion": body.motivo.strip(), "updated_at": ahora,
        }},
        return_document=ReturnDocument.AFTER,
    )
    if not doc:
        raise HTTPException(409, "La venta cambió de estado; recarga antes de cancelar")

    await reponer_stock(
        db, venta["negocio_id"], venta.get("descuentos_stock", []),
        str(user["_id"]), venta["folio"], CONCEPTO_REPOSICION,
    )
    if venta.get("cobro_id"):
        await cancelar_cobro(db, venta["cobro_id"], str(user["_id"]), f"Cancelación {venta['folio']}: {body.motivo.strip()}")
    return serializar(doc)


@router.get("/resumen")
async def resumen_del_dia(
    negocio_id: str = Query(...),
    fecha: Optional[date] = Query(None),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    dia = fecha or hoy()
    inicio, fin = rango_del_dia(dia)
    ventas = await db.ventas_mostrador.find({
        "negocio_id": negocio_id, "fecha": {"$gte": inicio, "$lt": fin},
    }).to_list(5000)

    por_metodo = {m: {"cantidad": 0, "total": 0.0} for m in ("efectivo", "tarjeta", "transferencia")}
    canceladas = 0
    for v in ventas:
        if v["estado"] == "cancelada":
            canceladas += 1
            continue
        fila = por_metodo[v["metodo_pago"]]
        fila["cantidad"] += 1
        fila["total"] = redondear(fila["total"] + v["total"])

    return {
        "fecha": dia.isoformat(),
        "por_metodo": por_metodo,
        "total": redondear(sum(f["total"] for f in por_metodo.values())),
        "ventas": sum(f["cantidad"] for f in por_metodo.values()),
        "canceladas": canceladas,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Descuentos por volumen
# ──────────────────────────────────────────────────────────────────────────────

async def _verificar_cantidad_libre(db, negocio_id: str, cantidad_minima: int, excepto=None) -> None:
    filtro: dict = {"negocio_id": negocio_id, "cantidad_minima": cantidad_minima, "activo": {"$ne": False}}
    if excepto:
        filtro["_id"] = {"$ne": excepto}
    if await db.descuentos_volumen.find_one(filtro):
        raise HTTPException(409, f"Ya hay un tramo activo desde {cantidad_minima} piezas")


@router.get("/descuentos-volumen")
async def listar_tramos(
    negocio_id: str = Query(...),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    docs = await db.descuentos_volumen.find({"negocio_id": negocio_id}).sort("cantidad_minima", 1).to_list(200)
    return [serializar(d) for d in docs]


@router.post("/descuentos-volumen", status_code=201)
async def crear_tramo(
    body: TramoCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    await _verificar_cantidad_libre(db, body.negocio_id, body.cantidad_minima)
    ahora = datetime.now(timezone.utc)
    doc = {
        "negocio_id": body.negocio_id,
        "nombre": body.nombre.strip(),
        "cantidad_minima": body.cantidad_minima,
        "porcentaje": body.porcentaje,
        "activo": True,
        "created_at": ahora,
        "updated_at": ahora,
    }
    resultado = await db.descuentos_volumen.insert_one(doc)
    doc["_id"] = resultado.inserted_id
    return serializar(doc)


@router.put("/descuentos-volumen/{tramo_id}")
async def actualizar_tramo(
    tramo_id: str,
    body: TramoUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    tramo = await obtener_del_negocio(db.descuentos_volumen, tramo_id, user, "Tramo de descuento")
    campos = body.model_dump(exclude_none=True)
    if not campos:
        raise HTTPException(400, "Sin campos a actualizar")
    if "nombre" in campos:
        campos["nombre"] = campos["nombre"].strip()
    # Revisa la cantidad solo si el tramo quedará activo con una cantidad distinta
    activo_final = campos.get("activo", tramo.get("activo", True))
    cantidad_final = campos.get("cantidad_minima", tramo["cantidad_minima"])
    if activo_final:
        await _verificar_cantidad_libre(db, tramo["negocio_id"], cantidad_final, excepto=tramo["_id"])
    campos["updated_at"] = datetime.now(timezone.utc)
    doc = await db.descuentos_volumen.find_one_and_update(
        {"_id": tramo["_id"]}, {"$set": campos}, return_document=ReturnDocument.AFTER,
    )
    return serializar(doc)
