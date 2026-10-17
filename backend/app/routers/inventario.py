from datetime import datetime, timezone
from typing import Literal, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.negocios import validar_referencia, verificar_acceso


router = APIRouter(prefix="/inventario", tags=["Inventario"])

TIPOS_MOVIMIENTO = Literal[
    "entrada",
    "salida",
    "ajuste",
    "consignacion_salida",
    "consignacion_entrada",
]


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


# ──────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ──────────────────────────────────────────────────────────────────────────────

class ProductoInventarioCreate(BaseModel):
    negocio_id: str
    nombre: str
    sku: str = ""
    unidad: str = "pza"
    stock_inicial: float = 0.0
    stock_minimo: float = 0.0
    stock_maximo: float = 0.0
    ubicacion: str = ""
    costo_unitario: float = 0.0
    producto_id: Optional[str] = None


class ProductoInventarioUpdate(BaseModel):
    nombre: Optional[str] = None
    sku: Optional[str] = None
    unidad: Optional[str] = None
    stock_minimo: Optional[float] = None
    stock_maximo: Optional[float] = None
    ubicacion: Optional[str] = None
    costo_unitario: Optional[float] = None


class MovimientoCreate(BaseModel):
    tipo: TIPOS_MOVIMIENTO
    cantidad: float = Field(gt=0)
    concepto: str = ""
    referencia: str = ""
    consignatario: str = ""


# ──────────────────────────────────────────────────────────────────────────────
# Stock
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/stock")
async def listar_stock(
    negocio_id: str = Query(...),
    busqueda: str = Query(""),
    solo_alertas: bool = Query(False),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)

    filtro: dict = {"negocio_id": negocio_id, "activo": {"$ne": False}}

    if busqueda.strip():
        filtro["$or"] = [
            {"nombre": {"$regex": busqueda.strip(), "$options": "i"}},
            {"sku": {"$regex": busqueda.strip(), "$options": "i"}},
        ]

    if solo_alertas:
        filtro["$expr"] = {"$lte": ["$stock_actual", "$stock_minimo"]}

    items = await db.inventario.find(filtro).sort("nombre", 1).to_list(500)
    return [serializar(i) for i in items]


@router.post("/stock", status_code=201)
async def crear_producto(
    body: ProductoInventarioCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    await validar_referencia(db.productos, body.producto_id, body.negocio_id, "Producto del catálogo")

    existente = await db.inventario.find_one({
        "negocio_id": body.negocio_id,
        "nombre": {"$regex": f"^{body.nombre.strip()}$", "$options": "i"},
        "activo": {"$ne": False},
    })
    if existente:
        raise HTTPException(400, "Ya existe un producto con ese nombre en el inventario")

    now = datetime.now(timezone.utc)

    doc = {
        "negocio_id": body.negocio_id,
        "producto_id": body.producto_id,
        "nombre": body.nombre.strip(),
        "sku": body.sku.strip(),
        "unidad": body.unidad,
        "stock_actual": body.stock_inicial,
        "stock_minimo": body.stock_minimo,
        "stock_maximo": body.stock_maximo,
        "ubicacion": body.ubicacion.strip(),
        "costo_unitario": body.costo_unitario,
        "activo": True,
        "created_at": now,
        "updated_at": now,
    }

    result = await db.inventario.insert_one(doc)

    if body.stock_inicial > 0:
        await db.inventario_movimientos.insert_one({
            "negocio_id": body.negocio_id,
            "inventario_id": str(result.inserted_id),
            "producto_nombre": doc["nombre"],
            "tipo": "entrada",
            "cantidad": body.stock_inicial,
            "stock_anterior": 0.0,
            "stock_nuevo": body.stock_inicial,
            "concepto": "Stock inicial",
            "referencia": "",
            "consignatario": "",
            "fecha": now,
            "usuario_id": str(user["_id"]),
        })

    doc["_id"] = result.inserted_id
    return serializar(doc)


@router.put("/stock/{item_id}")
async def actualizar_producto(
    item_id: str,
    body: ProductoInventarioUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(item_id)
    item = await db.inventario.find_one({"_id": oid})
    if not item:
        raise HTTPException(404, "Producto no encontrado")
    verificar_acceso(user, item["negocio_id"])

    campos = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not campos:
        raise HTTPException(400, "Sin campos a actualizar")

    campos["updated_at"] = datetime.now(timezone.utc)

    doc = await db.inventario.find_one_and_update(
        {"_id": oid},
        {"$set": campos},
        return_document=True,
    )
    return serializar(doc)


@router.delete("/stock/{item_id}")
async def desactivar_producto(
    item_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(item_id)
    item = await db.inventario.find_one({"_id": oid})
    if not item:
        raise HTTPException(404, "Producto no encontrado")
    verificar_acceso(user, item["negocio_id"])
    await db.inventario.update_one(
        {"_id": oid},
        {"$set": {"activo": False, "updated_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True}


# ──────────────────────────────────────────────────────────────────────────────
# Movimientos
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/stock/{item_id}/movimiento")
async def registrar_movimiento(
    item_id: str,
    body: MovimientoCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(item_id)

    item = await db.inventario.find_one({"_id": oid})
    if not item:
        raise HTTPException(404, "Producto no encontrado")
    verificar_acceso(user, item["negocio_id"])

    stock_anterior = float(item["stock_actual"])

    if body.tipo in ("entrada", "consignacion_entrada"):
        stock_nuevo = stock_anterior + body.cantidad
    elif body.tipo in ("salida", "consignacion_salida"):
        if body.cantidad > stock_anterior:
            raise HTTPException(
                400,
                f"Stock insuficiente. Disponible: {stock_anterior} {item.get('unidad','pza')}",
            )
        stock_nuevo = stock_anterior - body.cantidad
    else:
        # ajuste: la cantidad es el nuevo valor absoluto
        stock_nuevo = body.cantidad

    now = datetime.now(timezone.utc)

    await db.inventario.update_one(
        {"_id": oid},
        {"$set": {"stock_actual": stock_nuevo, "updated_at": now}},
    )

    await db.inventario_movimientos.insert_one({
        "negocio_id": item["negocio_id"],
        "inventario_id": item_id,
        "producto_nombre": item["nombre"],
        "tipo": body.tipo,
        "cantidad": body.cantidad,
        "stock_anterior": stock_anterior,
        "stock_nuevo": stock_nuevo,
        "concepto": body.concepto.strip(),
        "referencia": body.referencia.strip(),
        "consignatario": body.consignatario.strip(),
        "fecha": now,
        "usuario_id": str(user["_id"]),
    })

    updated = await db.inventario.find_one({"_id": oid})
    return serializar(updated)


@router.get("/movimientos")
async def listar_movimientos(
    negocio_id: str = Query(...),
    inventario_id: Optional[str] = Query(None),
    tipo: Optional[str] = Query(None),
    limit: int = Query(200, le=500),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)

    filtro: dict = {"negocio_id": negocio_id}
    if inventario_id:
        filtro["inventario_id"] = inventario_id
    if tipo:
        filtro["tipo"] = tipo

    movs = await db.inventario_movimientos.find(filtro).sort("fecha", -1).to_list(limit)
    return [serializar(m) for m in movs]


# ──────────────────────────────────────────────────────────────────────────────
# Dashboard / alertas
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/dashboard")
async def dashboard(
    negocio_id: str = Query(...),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)

    filtro = {"negocio_id": negocio_id, "activo": {"$ne": False}}
    items = await db.inventario.find(filtro).to_list(1000)

    total_productos = len(items)
    alertas = sum(
        1 for i in items if float(i.get("stock_actual", 0)) <= float(i.get("stock_minimo", 0))
    )
    sin_stock = sum(1 for i in items if float(i.get("stock_actual", 0)) == 0)
    valor_total = sum(
        float(i.get("stock_actual", 0)) * float(i.get("costo_unitario", 0))
        for i in items
    )

    return {
        "negocio_id": negocio_id,
        "total_productos": total_productos,
        "alertas_stock_bajo": alertas,
        "sin_stock": sin_stock,
        "valor_total_inventario": round(valor_total, 2),
    }
