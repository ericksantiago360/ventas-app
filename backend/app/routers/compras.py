from datetime import datetime, timezone
from typing import Literal, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.negocios import obtener_del_negocio, validar_referencia, verificar_acceso


router = APIRouter(prefix="/compras", tags=["Compras"])

ESTADOS_ORDEN = Literal["borrador", "enviada", "recibida_parcial", "recibida", "cancelada"]
TOLERANCIA = 1e-9


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
# Egreso en Finanzas: una orden recibida completa genera un egreso pendiente de pago.
# Es el único punto que crea o anula egresos de compras.
# ──────────────────────────────────────────────────────────────────────────────

async def egreso_de_orden(db, orden_id) -> dict | None:
    return await db.movimientos_financieros.find_one({
        "referencia_tipo": "ordenes_compra",
        "referencia_id": str(orden_id),
        "estado": {"$ne": "anulado"},
    })


async def registrar_egreso_compra(orden: dict, db) -> None:
    """Egreso pendiente por el total de la orden, sin cuenta: se asigna al registrar el pago. Idempotente."""
    if await egreso_de_orden(db, orden["_id"]):
        return
    now = datetime.now(timezone.utc)
    await db.movimientos_financieros.insert_one({
        "negocio_id":      orden["negocio_id"],
        "tipo":            "egreso",
        "categoria":       "compra_proveedor",
        "concepto":        f"OC {orden['numero']} — {orden.get('proveedor_nombre', '')}".strip(),
        "importe":         orden["total"],
        "cuenta_id":       None,
        "referencia_tipo": "ordenes_compra",
        "referencia_id":   str(orden["_id"]),
        "fecha":           orden.get("fecha_recepcion") or now,
        "estado":          "pendiente",
        "created_at":      now,
    })


async def anular_egreso_compra(db, orden_id) -> None:
    await db.movimientos_financieros.update_many(
        {"referencia_tipo": "ordenes_compra", "referencia_id": str(orden_id), "estado": {"$ne": "anulado"}},
        {"$set": {"estado": "anulado", "anulado_at": datetime.now(timezone.utc)}},
    )


def _calcular_totales(items: list[dict], impuestos: float) -> dict:
    subtotal = round(sum(i["importe"] for i in items), 2)
    return {"subtotal": subtotal, "impuestos": round(impuestos, 2), "total": round(subtotal + impuestos, 2)}


async def generar_numero_orden(db, negocio_id: str) -> str:
    contador = await db.contadores_compras.find_one_and_update(
        {"_id": negocio_id},
        {"$inc": {"secuencia": 1}, "$set": {"updated_at": datetime.now(timezone.utc)}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return f"OC-{contador['secuencia']:06d}"


async def _preparar_items(db, negocio_id: str, entrada: list) -> list[dict]:
    """Valida cada producto contra el negocio y arma las líneas con snapshot de nombre y unidad."""
    vistos: set[str] = set()
    items = []
    for linea in entrada:
        if linea.inventario_id in vistos:
            raise HTTPException(400, "Un producto no puede aparecer dos veces en la orden")
        vistos.add(linea.inventario_id)

        producto = await validar_referencia(db.inventario, linea.inventario_id, negocio_id, "Producto de inventario")
        if not producto.get("activo", True):
            raise HTTPException(422, f"El producto '{producto['nombre']}' está dado de baja")

        items.append({
            "inventario_id": linea.inventario_id,
            "nombre": producto["nombre"],
            "unidad": producto.get("unidad", "pza"),
            "cantidad": linea.cantidad,
            "cantidad_recibida": 0.0,
            "costo_unitario": linea.costo_unitario,
            "importe": round(linea.cantidad * linea.costo_unitario, 2),
        })
    return items


async def _proveedor_activo(db, negocio_id: str, proveedor_id: str) -> dict:
    proveedor = await validar_referencia(db.proveedores, proveedor_id, negocio_id, "Proveedor")
    if not proveedor.get("activo", True):
        raise HTTPException(422, "El proveedor está dado de baja")
    return proveedor


# ──────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ──────────────────────────────────────────────────────────────────────────────

class ProveedorCreate(BaseModel):
    negocio_id: str
    nombre: str = Field(min_length=1)
    rfc: str = ""
    contacto: str = ""
    telefono: str = ""
    email: str = ""
    dias_credito: int = Field(default=0, ge=0)
    notas: str = ""


class ProveedorUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=1)
    rfc: Optional[str] = None
    contacto: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None
    dias_credito: Optional[int] = Field(default=None, ge=0)
    notas: Optional[str] = None


class CompraItemIn(BaseModel):
    inventario_id: str
    cantidad: float = Field(gt=0)
    costo_unitario: float = Field(default=0, ge=0)


class OrdenCreate(BaseModel):
    negocio_id: str
    proveedor_id: str
    items: list[CompraItemIn] = Field(min_length=1)
    impuestos: float = Field(default=0, ge=0)
    notas: str = ""


class OrdenUpdate(BaseModel):
    proveedor_id: Optional[str] = None
    items: Optional[list[CompraItemIn]] = Field(default=None, min_length=1)
    impuestos: Optional[float] = Field(default=None, ge=0)
    notas: Optional[str] = None


class RecepcionItem(BaseModel):
    inventario_id: str
    cantidad: float = Field(gt=0)


class RecepcionIn(BaseModel):
    items: list[RecepcionItem] = Field(min_length=1)


class CancelarIn(BaseModel):
    motivo: str = Field(min_length=1)


# ──────────────────────────────────────────────────────────────────────────────
# Proveedores
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/proveedores")
async def listar_proveedores(
    negocio_id: str = Query(...),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    docs = await db.proveedores.find(
        {"negocio_id": negocio_id, "activo": {"$ne": False}}
    ).sort("nombre", 1).to_list(500)
    return [serializar(d) for d in docs]


@router.post("/proveedores", status_code=201)
async def crear_proveedor(
    body: ProveedorCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    now = datetime.now(timezone.utc)
    doc = {
        **body.model_dump(),
        "nombre": body.nombre.strip(),
        "activo": True,
        "created_at": now,
        "updated_at": now,
    }
    result = await db.proveedores.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serializar(doc)


@router.put("/proveedores/{proveedor_id}")
async def actualizar_proveedor(
    proveedor_id: str,
    body: ProveedorUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(proveedor_id)
    proveedor = await db.proveedores.find_one({"_id": oid})
    if not proveedor:
        raise HTTPException(404, "Proveedor no encontrado")
    verificar_acceso(user, proveedor["negocio_id"])

    campos = body.model_dump(exclude_none=True)
    if not campos:
        raise HTTPException(400, "Sin campos a actualizar")
    if "nombre" in campos:
        campos["nombre"] = campos["nombre"].strip()
    campos["updated_at"] = datetime.now(timezone.utc)

    doc = await db.proveedores.find_one_and_update(
        {"_id": oid}, {"$set": campos}, return_document=ReturnDocument.AFTER,
    )
    return serializar(doc)


@router.delete("/proveedores/{proveedor_id}")
async def desactivar_proveedor(
    proveedor_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(proveedor_id)
    proveedor = await db.proveedores.find_one({"_id": oid})
    if not proveedor:
        raise HTTPException(404, "Proveedor no encontrado")
    verificar_acceso(user, proveedor["negocio_id"])
    await db.proveedores.update_one(
        {"_id": oid},
        {"$set": {"activo": False, "updated_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True}


# ──────────────────────────────────────────────────────────────────────────────
# Órdenes de compra
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/ordenes")
async def listar_ordenes(
    negocio_id: str = Query(...),
    estado: Optional[ESTADOS_ORDEN] = Query(None),
    limit: int = Query(200, le=500),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    filtro: dict = {"negocio_id": negocio_id, "activo": {"$ne": False}}
    if estado:
        filtro["estado"] = estado
    docs = await db.ordenes_compra.find(filtro).sort("created_at", -1).to_list(limit)
    return [serializar(d) for d in docs]


@router.post("/ordenes", status_code=201)
async def crear_orden(
    body: OrdenCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    proveedor = await _proveedor_activo(db, body.negocio_id, body.proveedor_id)
    items = await _preparar_items(db, body.negocio_id, body.items)

    now = datetime.now(timezone.utc)
    doc = {
        "negocio_id": body.negocio_id,
        "numero": await generar_numero_orden(db, body.negocio_id),
        "proveedor_id": body.proveedor_id,
        "proveedor_nombre": proveedor["nombre"],
        "estado": "borrador",
        "items": items,
        **_calcular_totales(items, body.impuestos),
        "fecha_emision": now,
        "fecha_envio": None,
        "fecha_recepcion": None,
        "notas": body.notas.strip(),
        "motivo_cancelacion": "",
        "version": 0,
        "activo": True,
        "created_at": now,
        "updated_at": now,
    }
    result = await db.ordenes_compra.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serializar(doc)


@router.get("/ordenes/{orden_id}")
async def detalle_orden(
    orden_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    orden = await obtener_del_negocio(db.ordenes_compra, orden_id, user, "Orden de compra")
    egreso = await egreso_de_orden(db, orden["_id"])
    return {
        **serializar(orden),
        "egreso": {"id": str(egreso["_id"]), "estado": egreso["estado"]} if egreso else None,
    }


@router.put("/ordenes/{orden_id}")
async def actualizar_orden(
    orden_id: str,
    body: OrdenUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    orden = await obtener_del_negocio(db.ordenes_compra, orden_id, user, "Orden de compra")
    if orden["estado"] != "borrador":
        raise HTTPException(400, "Solo se pueden editar órdenes en borrador")

    campos = body.model_dump(exclude_none=True)
    if not campos:
        raise HTTPException(400, "Sin campos a actualizar")

    negocio_id = orden["negocio_id"]
    if "proveedor_id" in campos:
        proveedor = await _proveedor_activo(db, negocio_id, campos["proveedor_id"])
        campos["proveedor_nombre"] = proveedor["nombre"]
    if "items" in campos:
        campos["items"] = await _preparar_items(db, negocio_id, body.items)
    if "notas" in campos:
        campos["notas"] = campos["notas"].strip()

    items = campos.get("items", orden["items"])
    impuestos = campos.get("impuestos", orden["impuestos"])
    campos.update(_calcular_totales(items, impuestos))
    campos["updated_at"] = datetime.now(timezone.utc)

    doc = await db.ordenes_compra.find_one_and_update(
        {"_id": orden["_id"], "estado": "borrador"},
        {"$set": campos, "$inc": {"version": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if not doc:
        raise HTTPException(409, "La orden cambió de estado; recarga antes de editar")
    return serializar(doc)


@router.post("/ordenes/{orden_id}/enviar")
async def enviar_orden(
    orden_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    orden = await obtener_del_negocio(db.ordenes_compra, orden_id, user, "Orden de compra")
    if orden["estado"] != "borrador":
        raise HTTPException(400, f"No se puede enviar una orden en estado '{orden['estado']}'")

    now = datetime.now(timezone.utc)
    doc = await db.ordenes_compra.find_one_and_update(
        {"_id": orden["_id"], "estado": "borrador"},
        {
            "$set": {"estado": "enviada", "fecha_envio": now, "updated_at": now},
            "$inc": {"version": 1},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not doc:
        raise HTTPException(409, "La orden cambió de estado; recarga antes de enviar")
    return serializar(doc)


@router.post("/ordenes/{orden_id}/recepcion")
async def registrar_recepcion(
    orden_id: str,
    body: RecepcionIn,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    orden = await obtener_del_negocio(db.ordenes_compra, orden_id, user, "Orden de compra")
    if orden["estado"] not in ("enviada", "recibida_parcial"):
        raise HTTPException(400, f"No se puede recibir una orden en estado '{orden['estado']}'")

    # Se calcula sobre copias: nada se escribe hasta validar todas las líneas
    items = [dict(i) for i in orden["items"]]
    indice = {i["inventario_id"]: n for n, i in enumerate(items)}
    recepciones: list[tuple[dict, float]] = []
    vistos: set[str] = set()

    for r in body.items:
        if r.inventario_id in vistos:
            raise HTTPException(400, "Un producto no puede aparecer dos veces en la recepción")
        vistos.add(r.inventario_id)
        if r.inventario_id not in indice:
            raise HTTPException(400, "Un producto de la recepción no pertenece a esta orden")

        linea = items[indice[r.inventario_id]]
        pendiente = linea["cantidad"] - linea["cantidad_recibida"]
        if r.cantidad > pendiente + TOLERANCIA:
            raise HTTPException(
                422,
                f"'{linea['nombre']}': se intentan recibir {r.cantidad} y solo están pendientes {round(pendiente, 6)}",
            )
        linea["cantidad_recibida"] = round(linea["cantidad_recibida"] + r.cantidad, 6)
        recepciones.append((linea, r.cantidad))

    now = datetime.now(timezone.utc)
    pendientes = any(i["cantidad_recibida"] < i["cantidad"] - TOLERANCIA for i in items)
    nuevo_estado = "recibida_parcial" if pendientes else "recibida"

    # Primero se toma el control de la orden (versión), así dos recepciones simultáneas no se aplican dos veces
    doc = await db.ordenes_compra.find_one_and_update(
        {"_id": orden["_id"], "version": orden["version"], "estado": orden["estado"]},
        {
            "$set": {
                "items": items,
                "estado": nuevo_estado,
                "fecha_recepcion": now,
                "updated_at": now,
            },
            "$inc": {"version": 1},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not doc:
        raise HTTPException(409, "La orden cambió mientras se registraba la recepción; recarga y vuelve a intentar")

    # Después, el inventario: cada entrada suma stock y actualiza el costo unitario
    for linea, cantidad in recepciones:
        producto = await db.inventario.find_one_and_update(
            {"_id": validar_oid(linea["inventario_id"]), "negocio_id": orden["negocio_id"]},
            {"$inc": {"stock_actual": cantidad}, "$set": {"costo_unitario": linea["costo_unitario"], "updated_at": now}},
            return_document=ReturnDocument.BEFORE,
        )
        if not producto:
            raise HTTPException(404, f"Producto de inventario no encontrado: {linea['nombre']}")

        stock_anterior = float(producto["stock_actual"])
        await db.inventario_movimientos.insert_one({
            "negocio_id": orden["negocio_id"],
            "inventario_id": linea["inventario_id"],
            "producto_nombre": linea["nombre"],
            "tipo": "entrada",
            "cantidad": cantidad,
            "stock_anterior": stock_anterior,
            "stock_nuevo": stock_anterior + cantidad,
            "concepto": f"Recepción {orden['numero']}",
            "referencia": orden["numero"],
            "consignatario": orden["proveedor_nombre"],
            "fecha": now,
            "usuario_id": str(user["_id"]),
        })

    # Solo al cerrar la orden completa; las recepciones parciales no generan egreso
    if nuevo_estado == "recibida":
        await registrar_egreso_compra(doc, db)

    return serializar(doc)


@router.post("/ordenes/{orden_id}/cancelar")
async def cancelar_orden(
    orden_id: str,
    body: CancelarIn,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    orden = await obtener_del_negocio(db.ordenes_compra, orden_id, user, "Orden de compra")
    if orden["estado"] not in ("borrador", "enviada"):
        raise HTTPException(400, f"No se puede cancelar una orden en estado '{orden['estado']}'")
    if any(i["cantidad_recibida"] > 0 for i in orden["items"]):
        raise HTTPException(400, "La orden ya tiene recepciones; corrige el inventario con un ajuste")

    now = datetime.now(timezone.utc)
    doc = await db.ordenes_compra.find_one_and_update(
        {"_id": orden["_id"], "version": orden["version"], "estado": orden["estado"]},
        {
            "$set": {"estado": "cancelada", "motivo_cancelacion": body.motivo.strip(), "updated_at": now},
            "$inc": {"version": 1},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not doc:
        raise HTTPException(409, "La orden cambió de estado; recarga antes de cancelar")
    await anular_egreso_compra(db, orden["_id"])   # no-op hoy: solo se cancela antes de recibir
    return serializar(doc)
