import re
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
from app.routers.inventario import ProductoInventarioCreate, crear_producto as crear_inventario
from app.core.security import get_current_user
from app.modules.ecommerce.services import (
    IVA_DEFAULT_PCT, calcular_totales, descontar_stock, redondear, reponer_stock, stock_disponible, tasa_iva,
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
    """
    Precios y nombres de productos salen del catálogo, nunca del cliente. Partidas repetidas
    del catálogo se suman. Las líneas manuales (artículo sin inventario) llevan su precio
    tecleado y no entran a tramos de volumen ni a stock.
    """
    agrupadas: dict[str, int] = {}
    manuales: list = []
    for item in entrada:
        if bool(item.producto_id) == bool(item.manual):
            raise HTTPException(422, "Cada partida lleva producto_id o manual, pero no ambos ni ninguno")
        if item.manual:
            manuales.append(item)
            continue
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
            "manual": False,
        })
    for item in manuales:
        precio = redondear(item.manual.precio)
        lineas.append({
            "producto_id": None,
            "nombre": item.manual.nombre.strip(),
            "sku": "",
            "cantidad": item.cantidad,
            "precio_lista": precio,
            "descuento_pct": 0.0,
            "precio_unitario": precio,
            "iva_tasa": IVA_DEFAULT_PCT / 100,
            "control_inventario": False,
            "manual": True,
        })
    return lineas


# ──────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ──────────────────────────────────────────────────────────────────────────────

class ItemManual(BaseModel):
    nombre: str = Field(min_length=1, max_length=120)
    precio: float = Field(gt=0)  # IVA incluido


class ItemVenta(BaseModel):
    producto_id: Optional[str] = None
    manual: Optional[ItemManual] = None
    cantidad: int = Field(gt=0)


class VentaCreate(BaseModel):
    negocio_id: str
    cuenta_id: str
    metodo_pago: METODOS_PAGO
    items: list[ItemVenta] = Field(min_length=1)
    monto_recibido: Optional[float] = Field(default=None, ge=0)
    cliente_id: Optional[str] = None
    sucursal_id: Optional[str] = None  # obligatoria si el negocio tiene sucursales activas
    # Descuento manual sobre toda la venta, aplicado después del descuento por volumen de cada línea
    descuento_manual_pct: float = Field(default=0, ge=0, lt=100)
    notas: str = ""


class CancelarVentaIn(BaseModel):
    motivo: str = Field(min_length=1)


class TramoCreate(BaseModel):
    negocio_id: str
    nombre: str = Field(min_length=1)
    cantidad_minima: int = Field(ge=2)
    porcentaje: float = Field(gt=0, lt=100)


class SucursalCreate(BaseModel):
    negocio_id: str
    nombre: str = Field(min_length=1, max_length=80)
    direccion: str = Field(default="", max_length=200)


class SucursalUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=1, max_length=80)
    direccion: Optional[str] = Field(default=None, max_length=200)
    activo: Optional[bool] = None


class ProductoMostradorCreate(BaseModel):
    negocio_id: str
    codigo: str = Field(min_length=1, max_length=40)
    nombre: str = Field(min_length=1, max_length=120)
    precio: float = Field(gt=0)  # IVA incluido
    control_inventario: bool = False
    stock_inicial: float = Field(default=0, ge=0)


class ProductoMostradorUpdate(BaseModel):
    codigo: Optional[str] = Field(default=None, min_length=1, max_length=40)
    nombre: Optional[str] = Field(default=None, min_length=1, max_length=120)
    precio: Optional[float] = Field(default=None, gt=0)  # IVA incluido
    activo: Optional[bool] = None


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
    return [await _fila_producto(db, negocio_id, p) for p in productos]


async def _fila_producto(db, negocio_id: str, p: dict) -> dict:
    pid = str(p["_id"])
    return {
        "id": pid,
        "nombre": p["nombre"],
        "sku": p.get("sku", ""),
        "precio": float(p.get("precio_base") or 0),
        "control_inventario": bool(p.get("control_inventario", False)),
        "stock": await stock_disponible(db, negocio_id, pid) if p.get("control_inventario") else None,
    }


async def _codigo_libre(db, negocio_id: str, codigo: str, excepto=None) -> None:
    filtro: dict = {"negocio_id": negocio_id, "codigo": {"$regex": f"^{re.escape(codigo)}$", "$options": "i"}}
    if excepto:
        filtro["_id"] = {"$ne": excepto}
    if await db.productos.find_one(filtro):
        raise HTTPException(409, f"Ya existe un producto con el código {codigo}")


@router.get("/productos/por-codigo")
async def producto_por_codigo(
    negocio_id: str = Query(...),
    codigo: str = Query(..., min_length=1),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Lector de código de barras: coincidencia exacta con `codigo` o `sku`, sin distinguir mayúsculas."""
    verificar_acceso(user, negocio_id)
    exacto = {"$regex": f"^{re.escape(codigo.strip())}$", "$options": "i"}
    p = await db.productos.find_one({
        "negocio_id": negocio_id,
        "activo": {"$ne": False},
        "$or": [{"codigo": exacto}, {"sku": exacto}],
    })
    if not p:
        raise HTTPException(404, f"No hay un producto con el código '{codigo.strip()}'")
    return await _fila_producto(db, negocio_id, p)


# ──────────────────────────────────────────────────────────────────────────────
# Sucursales
# ──────────────────────────────────────────────────────────────────────────────

async def _sucursal_para_venta(db, negocio_id: str, sucursal_id: Optional[str]) -> Optional[dict]:
    """Sin sucursales activas la venta no lleva sucursal. Con sucursales, es obligatorio elegir una activa."""
    if sucursal_id:
        sucursal = await db.sucursales.find_one({
            "_id": validar_oid(sucursal_id), "negocio_id": negocio_id, "activo": {"$ne": False},
        })
        if not sucursal:
            raise HTTPException(404, "Sucursal no encontrada o dada de baja")
        return sucursal
    if await db.sucursales.find_one({"negocio_id": negocio_id, "activo": {"$ne": False}}):
        raise HTTPException(422, "Elige la sucursal donde se vende")
    return None


async def _nombre_sucursal_libre(db, negocio_id: str, nombre: str, excepto=None) -> None:
    filtro: dict = {"negocio_id": negocio_id, "nombre": {"$regex": f"^{re.escape(nombre)}$", "$options": "i"}}
    if excepto:
        filtro["_id"] = {"$ne": excepto}
    if await db.sucursales.find_one(filtro):
        raise HTTPException(409, f"Ya existe una sucursal llamada '{nombre}'")


def _fila_sucursal(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "negocio_id": doc["negocio_id"],
        "nombre": doc["nombre"],
        "direccion": doc.get("direccion", ""),
        "activo": doc.get("activo") is not False,
    }


@router.get("/sucursales")
async def listar_sucursales(
    negocio_id: str = Query(...),
    incluir_inactivas: bool = Query(False),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    filtro: dict = {"negocio_id": negocio_id}
    if not incluir_inactivas:
        filtro["activo"] = {"$ne": False}
    docs = await db.sucursales.find(filtro).sort("nombre", 1).to_list(100)
    return [_fila_sucursal(d) for d in docs]


@router.post("/sucursales", status_code=201)
async def crear_sucursal(
    body: SucursalCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    nombre = body.nombre.strip()
    await _nombre_sucursal_libre(db, body.negocio_id, nombre)
    ahora = datetime.now(timezone.utc)
    doc = {
        "negocio_id": body.negocio_id, "nombre": nombre, "direccion": body.direccion.strip(),
        "activo": True, "created_at": ahora, "updated_at": ahora,
    }
    resultado = await db.sucursales.insert_one(doc)
    doc["_id"] = resultado.inserted_id
    return _fila_sucursal(doc)


@router.put("/sucursales/{sucursal_id}")
async def editar_sucursal(
    sucursal_id: str,
    body: SucursalUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    suc = await obtener_del_negocio(db.sucursales, sucursal_id, user, "Sucursal")
    cambios = body.model_dump(exclude_none=True)
    if not cambios:
        raise HTTPException(400, "Sin campos a actualizar")
    if "nombre" in cambios:
        cambios["nombre"] = cambios["nombre"].strip()
        await _nombre_sucursal_libre(db, suc["negocio_id"], cambios["nombre"], excepto=suc["_id"])
    if "direccion" in cambios:
        cambios["direccion"] = cambios["direccion"].strip()
    cambios["updated_at"] = datetime.now(timezone.utc)
    doc = await db.sucursales.find_one_and_update(
        {"_id": suc["_id"]}, {"$set": cambios}, return_document=ReturnDocument.AFTER,
    )
    return _fila_sucursal(doc)


@router.delete("/sucursales/{sucursal_id}")
async def dar_de_baja_sucursal(
    sucursal_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Baja lógica: las ventas ya hechas conservan el nombre de la sucursal."""
    suc = await obtener_del_negocio(db.sucursales, sucursal_id, user, "Sucursal")
    await db.sucursales.update_one(
        {"_id": suc["_id"]}, {"$set": {"activo": False, "updated_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True, "id": sucursal_id}


@router.get("/productos/admin")
async def listar_productos_admin(
    negocio_id: str = Query(...),
    busqueda: str = Query(""),
    incluir_inactivos: bool = Query(False),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Catálogo del mostrador para administrar: incluye dados de baja si se pide."""
    verificar_acceso(user, negocio_id)
    filtro: dict = {"negocio_id": negocio_id}
    if not incluir_inactivos:
        filtro["activo"] = {"$ne": False}
    texto = busqueda.strip()
    if texto:
        filtro["$or"] = [
            {"nombre": {"$regex": re.escape(texto), "$options": "i"}},
            {"codigo": {"$regex": re.escape(texto), "$options": "i"}},
        ]
    productos = await db.productos.find(filtro).sort("nombre", 1).to_list(200)
    return [await _fila_admin(db, negocio_id, p) for p in productos]


async def _fila_admin(db, negocio_id: str, p: dict) -> dict:
    return {
        **(await _fila_producto(db, negocio_id, p)),
        "codigo": p.get("codigo", ""),
        "activo": p.get("activo") is not False,
    }


@router.post("/productos", status_code=201)
async def crear_producto_mostrador(
    body: ProductoMostradorCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    codigo = body.codigo.strip()
    nombre = body.nombre.strip()
    await _codigo_libre(db, body.negocio_id, codigo)

    ahora = datetime.now(timezone.utc)
    doc = {
        "negocio_id": body.negocio_id,
        "codigo": codigo,
        "sku": codigo,
        "nombre": nombre,
        "descripcion": "",
        "tipo": "producto",
        "categoria_id": None,
        "unidad": "pieza",
        "precio_base": redondear(body.precio),  # IVA incluido
        "iva_aplicable": True,
        "iva_pct": IVA_DEFAULT_PCT,
        "control_inventario": body.control_inventario,
        "activo": True,
        "created_at": ahora,
        "updated_at": ahora,
    }
    resultado = await db.productos.insert_one(doc)
    doc["_id"] = resultado.inserted_id

    if body.control_inventario:
        try:
            # Reutiliza el alta de inventario: valida nombre repetido y crea el registro de stock
            await crear_inventario(
                ProductoInventarioCreate(
                    negocio_id=body.negocio_id, nombre=nombre, sku=codigo,
                    stock_inicial=body.stock_inicial, producto_id=str(resultado.inserted_id),
                ),
                db=db, user=user,
            )
        except Exception:
            await db.productos.delete_one({"_id": resultado.inserted_id})
            raise
    return await _fila_admin(db, body.negocio_id, doc)


@router.get("/productos/{producto_id}")
async def detalle_producto(
    producto_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    p = await obtener_del_negocio(db.productos, producto_id, user, "Producto")
    return await _fila_admin(db, str(p["negocio_id"]), p)


@router.put("/productos/{producto_id}")
async def editar_producto(
    producto_id: str,
    body: ProductoMostradorUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Edita código, nombre, precio o estado. El control de inventario no se cambia aquí (afectaría el stock)."""
    p = await obtener_del_negocio(db.productos, producto_id, user, "Producto")
    cambios = body.model_dump(exclude_none=True)
    if not cambios:
        raise HTTPException(400, "Sin campos a actualizar")
    if "codigo" in cambios:
        cambios["codigo"] = cambios["codigo"].strip()
        await _codigo_libre(db, p["negocio_id"], cambios["codigo"], excepto=p["_id"])
    if "nombre" in cambios:
        cambios["nombre"] = cambios["nombre"].strip()
    if "precio" in cambios:
        cambios["precio_base"] = redondear(cambios.pop("precio"))
    cambios["updated_at"] = datetime.now(timezone.utc)
    await db.productos.update_one({"_id": p["_id"]}, {"$set": cambios})
    return await detalle_producto(producto_id, db=db, user=user)


@router.delete("/productos/{producto_id}")
async def dar_de_baja_producto(
    producto_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Baja lógica: deja de venderse, pero las ventas y el inventario conservan su historial."""
    p = await obtener_del_negocio(db.productos, producto_id, user, "Producto")
    await db.productos.update_one(
        {"_id": p["_id"]}, {"$set": {"activo": False, "updated_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True, "id": producto_id}


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
    sucursal = await _sucursal_para_venta(db, body.negocio_id, body.sucursal_id)

    lineas = await _cargar_lineas(db, body.negocio_id, body.items)
    if body.descuento_manual_pct:
        for linea in lineas:
            linea["precio_unitario"] = redondear(linea["precio_unitario"] * (1 - body.descuento_manual_pct / 100))
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
            "producto_id": l["producto_id"], "manual": l["manual"], "nombre": l["nombre"], "sku": l["sku"],
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
        "sucursal_id": str(sucursal["_id"]) if sucursal else None,
        "sucursal_nombre": sucursal["nombre"] if sucursal else None,
        "descuento_manual_pct": body.descuento_manual_pct,
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
    sucursal_id: Optional[str] = Query(None),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    inicio, fin = rango_del_dia(fecha or hoy())
    filtro: dict = {"negocio_id": negocio_id, "fecha": {"$gte": inicio, "$lt": fin}}
    if estado:
        filtro["estado"] = estado
    if sucursal_id:
        filtro["sucursal_id"] = sucursal_id
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
    sucursal_id: Optional[str] = Query(None),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    dia = fecha or hoy()
    inicio, fin = rango_del_dia(dia)
    filtro: dict = {"negocio_id": negocio_id, "fecha": {"$gte": inicio, "$lt": fin}}
    if sucursal_id:
        filtro["sucursal_id"] = sucursal_id
    ventas = await db.ventas_mostrador.find(filtro).to_list(5000)

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


@router.delete("/descuentos-volumen/{tramo_id}")
async def eliminar_tramo(
    tramo_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Borrado real: las ventas guardan el porcentaje aplicado por línea, no el id del tramo."""
    tramo = await obtener_del_negocio(db.descuentos_volumen, tramo_id, user, "Tramo de descuento")
    await db.descuentos_volumen.delete_one({"_id": tramo["_id"]})
    return {"ok": True, "id": tramo_id}
