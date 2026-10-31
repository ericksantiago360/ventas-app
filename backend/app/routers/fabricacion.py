from datetime import datetime, timezone
from typing import Literal, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from app.core.database import get_db
from app.core.negocios import obtener_del_negocio, validar_referencia, verificar_acceso
from app.core.security import get_current_user


router = APIRouter(prefix="/fabricacion", tags=["Fabricación"])

ESTADOS_ORDEN = Literal["planeada", "terminada", "cancelada"]
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


def ahora() -> datetime:
    return datetime.now(timezone.utc)


async def generar_numero_orden(db, negocio_id: str) -> str:
    contador = await db.contadores_fabricacion.find_one_and_update(
        {"_id": negocio_id},
        {"$inc": {"secuencia": 1}, "$set": {"updated_at": ahora()}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return f"OF-{contador['secuencia']:06d}"


async def _producto_inventario(db, negocio_id: str, inventario_id: str) -> dict:
    producto = await validar_referencia(db.inventario, inventario_id, negocio_id, "Producto de inventario")
    if not producto or not producto.get("activo", True):
        raise HTTPException(422, "Un producto de la receta está dado de baja")
    return producto


def _snapshot(producto: dict) -> dict:
    return {"inventario_id": str(producto["_id"]), "nombre": producto["nombre"], "unidad": producto.get("unidad", "pza")}


async def _codigo_libre(coleccion, negocio_id: str, codigo: str, nombre: str, filtro_extra: dict | None = None) -> None:
    filtro = {"negocio_id": negocio_id, "codigo": {"$regex": f"^{codigo}$", "$options": "i"}, **(filtro_extra or {})}
    if await coleccion.find_one(filtro):
        raise HTTPException(409, f"Ya existe un {nombre} con el código {codigo}")


async def _ubicacion_del_negocio(db, negocio_id: str, ubicacion_id: str) -> dict:
    return await validar_referencia(db.ubicaciones_fabricacion, ubicacion_id, negocio_id, "Ubicación")


async def _stock_en_almacen(db, negocio_id: str, almacen_id: str, inventario_ids: list[str]) -> dict[str, float]:
    """Stock que está en las ubicaciones de un almacén, por producto."""
    filas = db.stock_ubicacion.find({
        "negocio_id": negocio_id, "almacen_id": almacen_id,
        "inventario_id": {"$in": inventario_ids}, "cantidad": {"$gt": 0},
    })
    total: dict[str, float] = {}
    async for f in filas:
        total[f["inventario_id"]] = total.get(f["inventario_id"], 0.0) + float(f["cantidad"])
    return total


async def _sin_ubicacion(db, negocio_id: str, inventario_id: str) -> float:
    """Stock total del producto que todavía no está asignado a una ubicación."""
    producto = await db.inventario.find_one({"_id": ObjectId(inventario_id)}, {"stock_actual": 1})
    if not producto:
        return 0.0
    asignado = 0.0
    async for f in db.stock_ubicacion.find({"negocio_id": negocio_id, "inventario_id": inventario_id}):
        asignado += float(f["cantidad"])
    return max(0.0, float(producto.get("stock_actual", 0)) - asignado)


async def _ajustar_ubicacion(db, negocio_id: str, inventario_id: str, ubicacion: dict, delta: float) -> None:
    await db.stock_ubicacion.update_one(
        {"negocio_id": negocio_id, "inventario_id": inventario_id, "ubicacion_id": str(ubicacion["_id"])},
        {"$inc": {"cantidad": delta},
         "$setOnInsert": {"almacen_id": ubicacion["almacen_id"], "ubicacion_codigo": ubicacion["codigo"], "created_at": ahora()}},
        upsert=True,
    )


async def _movimiento(db, negocio_id, producto_id, nombre, tipo, cantidad, anterior, nuevo, referencia, usuario_id):
    await db.inventario_movimientos.insert_one({
        "negocio_id": negocio_id,
        "inventario_id": producto_id,
        "producto_nombre": nombre,
        "tipo": tipo,
        "cantidad": cantidad,
        "stock_anterior": anterior,
        "stock_nuevo": nuevo,
        "concepto": f"Fabricación {referencia}",
        "referencia": referencia,
        "consignatario": "",
        "fecha": ahora(),
        "usuario_id": usuario_id,
    })


# ──────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ──────────────────────────────────────────────────────────────────────────────

class ComponenteIn(BaseModel):
    inventario_id: str
    cantidad: float = Field(gt=0)


class RecetaCreate(BaseModel):
    negocio_id: str
    nombre: str = Field(min_length=1)
    producto_id: str
    rendimiento: float = Field(gt=0)
    componentes: list[ComponenteIn] = Field(min_length=1)


class RecetaUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=1)
    rendimiento: Optional[float] = Field(default=None, gt=0)
    componentes: Optional[list[ComponenteIn]] = Field(default=None, min_length=1)
    activo: Optional[bool] = None


class OrdenCreate(BaseModel):
    negocio_id: str
    receta_id: str
    cantidad: float = Field(gt=0)
    almacen_id: str
    ubicacion_destino_id: str
    notas: str = ""


class CancelarIn(BaseModel):
    motivo: str = Field(min_length=1)


class AlmacenCreate(BaseModel):
    negocio_id: str
    codigo: str = Field(min_length=1, max_length=20)
    nombre: str = Field(min_length=1)


class ZonaCreate(BaseModel):
    negocio_id: str
    almacen_id: str
    codigo: str = Field(min_length=1, max_length=20)
    nombre: str = Field(min_length=1)


class UbicacionCreate(BaseModel):
    negocio_id: str
    zona_id: str
    codigo: str = Field(min_length=1, max_length=30)
    nombre: str = ""


class AsignarIn(BaseModel):
    negocio_id: str
    inventario_id: str
    ubicacion_id: str
    cantidad: float = Field(gt=0)


class TransferirIn(BaseModel):
    negocio_id: str
    inventario_id: str
    origen_id: str
    destino_id: str
    cantidad: float = Field(gt=0)


# ──────────────────────────────────────────────────────────────────────────────
# Almacenes, zonas y ubicaciones
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/almacenes")
async def listar_almacenes(negocio_id: str = Query(...), db=Depends(get_db), user=Depends(get_current_user)):
    verificar_acceso(user, negocio_id)
    docs = await db.almacenes_fabricacion.find({"negocio_id": negocio_id}).sort("codigo", 1).to_list(200)
    return [serializar(d) for d in docs]


@router.post("/almacenes", status_code=201)
async def crear_almacen(body: AlmacenCreate, db=Depends(get_db), user=Depends(get_current_user)):
    verificar_acceso(user, body.negocio_id)
    codigo = body.codigo.strip().upper()
    await _codigo_libre(db.almacenes_fabricacion, body.negocio_id, codigo, "almacén")
    marca = ahora()
    doc = {"negocio_id": body.negocio_id, "codigo": codigo, "nombre": body.nombre.strip(), "activo": True,
           "created_at": marca, "updated_at": marca}
    resultado = await db.almacenes_fabricacion.insert_one(doc)
    doc["_id"] = resultado.inserted_id
    return serializar(doc)


@router.get("/zonas")
async def listar_zonas(negocio_id: str = Query(...), almacen_id: Optional[str] = Query(None),
                       db=Depends(get_db), user=Depends(get_current_user)):
    verificar_acceso(user, negocio_id)
    filtro: dict = {"negocio_id": negocio_id}
    if almacen_id:
        filtro["almacen_id"] = almacen_id
    docs = await db.zonas_fabricacion.find(filtro).sort("codigo", 1).to_list(500)
    return [serializar(d) for d in docs]


@router.post("/zonas", status_code=201)
async def crear_zona(body: ZonaCreate, db=Depends(get_db), user=Depends(get_current_user)):
    verificar_acceso(user, body.negocio_id)
    await validar_referencia(db.almacenes_fabricacion, body.almacen_id, body.negocio_id, "Almacén")
    codigo = body.codigo.strip().upper()
    await _codigo_libre(db.zonas_fabricacion, body.negocio_id, codigo, "zona", {"almacen_id": body.almacen_id})
    marca = ahora()
    doc = {"negocio_id": body.negocio_id, "almacen_id": body.almacen_id, "codigo": codigo,
           "nombre": body.nombre.strip(), "created_at": marca, "updated_at": marca}
    resultado = await db.zonas_fabricacion.insert_one(doc)
    doc["_id"] = resultado.inserted_id
    return serializar(doc)


@router.get("/ubicaciones")
async def listar_ubicaciones(negocio_id: str = Query(...), almacen_id: Optional[str] = Query(None),
                             db=Depends(get_db), user=Depends(get_current_user)):
    verificar_acceso(user, negocio_id)
    filtro: dict = {"negocio_id": negocio_id}
    if almacen_id:
        filtro["almacen_id"] = almacen_id
    docs = await db.ubicaciones_fabricacion.find(filtro).sort("codigo", 1).to_list(1000)
    return [serializar(d) for d in docs]


@router.post("/ubicaciones", status_code=201)
async def crear_ubicacion(body: UbicacionCreate, db=Depends(get_db), user=Depends(get_current_user)):
    verificar_acceso(user, body.negocio_id)
    zona = await validar_referencia(db.zonas_fabricacion, body.zona_id, body.negocio_id, "Zona")
    codigo = body.codigo.strip().upper()
    await _codigo_libre(db.ubicaciones_fabricacion, body.negocio_id, codigo, "ubicación", {"almacen_id": zona["almacen_id"]})
    marca = ahora()
    doc = {"negocio_id": body.negocio_id, "almacen_id": zona["almacen_id"], "zona_id": body.zona_id,
           "codigo": codigo, "nombre": body.nombre.strip(), "activo": True, "created_at": marca, "updated_at": marca}
    resultado = await db.ubicaciones_fabricacion.insert_one(doc)
    doc["_id"] = resultado.inserted_id
    return serializar(doc)


# ──────────────────────────────────────────────────────────────────────────────
# Stock por ubicación
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/stock-ubicaciones")
async def stock_por_ubicacion(
    negocio_id: str = Query(...),
    almacen_id: Optional[str] = Query(None),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    filtro: dict = {"negocio_id": negocio_id, "cantidad": {"$gt": 0}}
    if almacen_id:
        filtro["almacen_id"] = almacen_id
    filas = await db.stock_ubicacion.find(filtro).to_list(5000)

    ids = list({f["inventario_id"] for f in filas})
    productos = {str(p["_id"]): p async for p in db.inventario.find(
        {"_id": {"$in": [ObjectId(i) for i in ids if ObjectId.is_valid(i)]}}, {"nombre": 1, "unidad": 1, "stock_actual": 1})}

    ubicaciones = [{
        "inventario_id": f["inventario_id"],
        "producto": productos.get(f["inventario_id"], {}).get("nombre", ""),
        "unidad": productos.get(f["inventario_id"], {}).get("unidad", ""),
        "ubicacion_id": f["ubicacion_id"],
        "ubicacion_codigo": f.get("ubicacion_codigo", ""),
        "almacen_id": f["almacen_id"],
        "cantidad": round(float(f["cantidad"]), 6),
    } for f in filas]
    ubicaciones.sort(key=lambda u: (u["producto"], u["ubicacion_codigo"]))

    # Stock total que no está asignado a ninguna ubicación
    sin_ubicacion = []
    for pid, p in productos.items():
        restante = await _sin_ubicacion(db, negocio_id, pid)
        if restante > TOLERANCIA:
            sin_ubicacion.append({"inventario_id": pid, "producto": p.get("nombre", ""),
                                  "unidad": p.get("unidad", ""), "cantidad": round(restante, 6)})
    return {"ubicaciones": ubicaciones, "sin_ubicacion": sorted(sin_ubicacion, key=lambda s: s["producto"])}


@router.post("/stock-ubicaciones/asignar")
async def asignar_stock(body: AsignarIn, db=Depends(get_db), user=Depends(get_current_user)):
    """Mueve stock del total sin ubicación a una ubicación."""
    verificar_acceso(user, body.negocio_id)
    ubicacion = await _ubicacion_del_negocio(db, body.negocio_id, body.ubicacion_id)
    await _producto_inventario(db, body.negocio_id, body.inventario_id)
    disponible = await _sin_ubicacion(db, body.negocio_id, body.inventario_id)
    if body.cantidad > disponible + TOLERANCIA:
        raise HTTPException(409, f"Solo hay {round(disponible, 4)} sin ubicación para asignar")
    await _ajustar_ubicacion(db, body.negocio_id, body.inventario_id, ubicacion, body.cantidad)
    return {"ok": True}


@router.post("/stock-ubicaciones/transferir")
async def transferir_stock(body: TransferirIn, db=Depends(get_db), user=Depends(get_current_user)):
    """Mueve stock de una ubicación a otra del mismo negocio."""
    verificar_acceso(user, body.negocio_id)
    if body.origen_id == body.destino_id:
        raise HTTPException(422, "La ubicación de origen y destino son la misma")
    origen = await _ubicacion_del_negocio(db, body.negocio_id, body.origen_id)
    destino = await _ubicacion_del_negocio(db, body.negocio_id, body.destino_id)
    # Descuento atómico: nunca queda negativo
    resultado = await db.stock_ubicacion.update_one(
        {"negocio_id": body.negocio_id, "inventario_id": body.inventario_id,
         "ubicacion_id": body.origen_id, "cantidad": {"$gte": body.cantidad - TOLERANCIA}},
        {"$inc": {"cantidad": -body.cantidad}},
    )
    if resultado.modified_count == 0:
        raise HTTPException(409, "No hay suficiente stock en la ubicación de origen")
    await _ajustar_ubicacion(db, body.negocio_id, body.inventario_id, destino, body.cantidad)
    await db.stock_ubicacion.delete_many({"negocio_id": body.negocio_id, "cantidad": {"$lte": TOLERANCIA}})
    return {"ok": True, "origen": origen["codigo"], "destino": destino["codigo"]}


# ──────────────────────────────────────────────────────────────────────────────
# Recetas
# ──────────────────────────────────────────────────────────────────────────────

async def _preparar_componentes(db, negocio_id: str, producto_id: str | None, entrada: list[ComponenteIn]) -> list[dict]:
    vistos: set[str] = set()
    componentes = []
    for c in entrada:
        if c.inventario_id in vistos:
            raise HTTPException(422, "Un insumo no puede aparecer dos veces en la receta")
        if c.inventario_id == producto_id:
            raise HTTPException(422, "El producto terminado no puede ser insumo de sí mismo")
        vistos.add(c.inventario_id)
        producto = await _producto_inventario(db, negocio_id, c.inventario_id)
        componentes.append({**_snapshot(producto), "cantidad": c.cantidad})
    return componentes


@router.get("/recetas")
async def listar_recetas(negocio_id: str = Query(...), db=Depends(get_db), user=Depends(get_current_user)):
    verificar_acceso(user, negocio_id)
    docs = await db.recetas_fabricacion.find({"negocio_id": negocio_id}).sort("nombre", 1).to_list(500)
    return [serializar(d) for d in docs]


@router.post("/recetas", status_code=201)
async def crear_receta(body: RecetaCreate, db=Depends(get_db), user=Depends(get_current_user)):
    verificar_acceso(user, body.negocio_id)
    producto = await _producto_inventario(db, body.negocio_id, body.producto_id)
    componentes = await _preparar_componentes(db, body.negocio_id, body.producto_id, body.componentes)
    marca = ahora()
    doc = {
        "negocio_id": body.negocio_id,
        "nombre": body.nombre.strip(),
        "producto": _snapshot(producto),
        "rendimiento": body.rendimiento,
        "componentes": componentes,
        "activo": True,
        "created_at": marca,
        "updated_at": marca,
    }
    resultado = await db.recetas_fabricacion.insert_one(doc)
    doc["_id"] = resultado.inserted_id
    return serializar(doc)


@router.put("/recetas/{receta_id}")
async def actualizar_receta(receta_id: str, body: RecetaUpdate, db=Depends(get_db), user=Depends(get_current_user)):
    receta = await obtener_del_negocio(db.recetas_fabricacion, receta_id, user, "Receta")
    campos = body.model_dump(exclude_none=True)
    if not campos:
        raise HTTPException(400, "Sin campos a actualizar")
    if "nombre" in campos:
        campos["nombre"] = campos["nombre"].strip()
    if "componentes" in campos:
        campos["componentes"] = await _preparar_componentes(
            db, receta["negocio_id"], receta["producto"]["inventario_id"], body.componentes,
        )
    campos["updated_at"] = ahora()
    doc = await db.recetas_fabricacion.find_one_and_update(
        {"_id": receta["_id"]}, {"$set": campos}, return_document=ReturnDocument.AFTER,
    )
    return serializar(doc)


# ──────────────────────────────────────────────────────────────────────────────
# Órdenes
# ──────────────────────────────────────────────────────────────────────────────

def _con_faltantes(orden: dict, disponible: dict[str, float]) -> dict:
    """Agrega a cada consumo lo disponible en el almacén de origen y lo que falta."""
    for c in orden["consumos"]:
        d = disponible.get(c["inventario_id"], 0.0)
        c["disponible"] = round(d, 6)
        c["faltante"] = round(max(0.0, c["cantidad"] - d), 6)
    return orden


async def _disponible_orden(db, orden: dict) -> dict[str, float]:
    if not orden.get("almacen_id"):
        return {}
    return await _stock_en_almacen(db, orden["negocio_id"], orden["almacen_id"],
                                   [c["inventario_id"] for c in orden["consumos"]])


@router.get("/ordenes")
async def listar_ordenes(
    negocio_id: str = Query(...),
    estado: Optional[ESTADOS_ORDEN] = Query(None),
    limit: int = Query(200, le=500),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    filtro: dict = {"negocio_id": negocio_id}
    if estado:
        filtro["estado"] = estado
    docs = await db.ordenes_fabricacion.find(filtro).sort("created_at", -1).to_list(limit)
    return [serializar(d) for d in docs]


@router.post("/ordenes", status_code=201)
async def crear_orden(body: OrdenCreate, db=Depends(get_db), user=Depends(get_current_user)):
    verificar_acceso(user, body.negocio_id)
    receta = await obtener_del_negocio(db.recetas_fabricacion, body.receta_id, user, "Receta")
    if not receta.get("activo", True):
        raise HTTPException(422, "La receta está dada de baja")
    almacen = await validar_referencia(db.almacenes_fabricacion, body.almacen_id, body.negocio_id, "Almacén")
    destino = await _ubicacion_del_negocio(db, body.negocio_id, body.ubicacion_destino_id)

    tandas = body.cantidad / receta["rendimiento"]
    consumos = [
        {**{k: c[k] for k in ("inventario_id", "nombre", "unidad")}, "cantidad": round(c["cantidad"] * tandas, 6)}
        for c in receta["componentes"]
    ]
    marca = ahora()
    doc = {
        "negocio_id": body.negocio_id,
        "numero": await generar_numero_orden(db, body.negocio_id),
        "receta_id": str(receta["_id"]),
        "receta_nombre": receta["nombre"],
        "producto": receta["producto"],
        "cantidad": body.cantidad,
        "tandas": round(tandas, 6),
        "consumos": consumos,
        "almacen_id": str(almacen["_id"]),
        "almacen_nombre": almacen["nombre"],
        "ubicacion_destino_id": str(destino["_id"]),
        "ubicacion_destino_codigo": destino["codigo"],
        "estado": "planeada",
        "motivo_cancelacion": "",
        "fecha_terminada": None,
        "notas": body.notas.strip(),
        "version": 0,
        "created_at": marca,
        "updated_at": marca,
    }
    resultado = await db.ordenes_fabricacion.insert_one(doc)
    doc["_id"] = resultado.inserted_id
    return serializar(doc)


@router.get("/ordenes/{orden_id}")
async def detalle_orden(orden_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    orden = await obtener_del_negocio(db.ordenes_fabricacion, orden_id, user, "Orden de fabricación")
    return serializar(_con_faltantes(orden, await _disponible_orden(db, orden)))


def _aplicar_inverso(ops: list[tuple]) -> list[tuple]:
    """Operaciones de inventario en orden inverso, para deshacer una fabricación a medias."""
    return list(reversed(ops))


async def _deshacer(db, ops: list[tuple], negocio_id: str) -> None:
    for op in _aplicar_inverso(ops):
        if op[0] == "ubic":
            _, inventario_id, ubicacion_id, delta = op
            await db.stock_ubicacion.update_one(
                {"negocio_id": negocio_id, "inventario_id": inventario_id, "ubicacion_id": ubicacion_id},
                {"$inc": {"cantidad": -delta}},
            )
        else:
            _, inventario_id, delta = op
            await db.inventario.update_one({"_id": ObjectId(inventario_id)}, {"$inc": {"stock_actual": -delta}})


@router.post("/ordenes/{orden_id}/terminar")
async def terminar_orden(orden_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    orden = await obtener_del_negocio(db.ordenes_fabricacion, orden_id, user, "Orden de fabricación")
    if orden["estado"] != "planeada":
        raise HTTPException(400, f"No se puede terminar una orden en estado '{orden['estado']}'")
    if not orden.get("almacen_id"):
        raise HTTPException(400, "La orden no tiene almacén de origen; cancélala y crea una nueva")

    # 1) Faltantes en el almacén de origen: si falta algo no se escribe nada
    disponible = await _disponible_orden(db, orden)
    faltantes = [c for c in orden["consumos"] if disponible.get(c["inventario_id"], 0.0) + TOLERANCIA < c["cantidad"]]
    if faltantes:
        detalle = "; ".join(
            f"{c['nombre']}: faltan {round(c['cantidad'] - disponible.get(c['inventario_id'], 0.0), 4)} {c['unidad']}"
            for c in faltantes
        )
        raise HTTPException(409, f"Insumos insuficientes en {orden['almacen_nombre']} — {detalle}")

    usuario_id = str(user["_id"])
    negocio_id = orden["negocio_id"]
    referencia = orden["numero"]

    # 2) Se toma la orden con condición de estado: no se fabrica dos veces
    marca = ahora()
    tomada = await db.ordenes_fabricacion.find_one_and_update(
        {"_id": orden["_id"], "estado": "planeada"},
        {"$set": {"estado": "terminada", "fecha_terminada": marca, "updated_at": marca}, "$inc": {"version": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if not tomada:
        raise HTTPException(409, "La orden cambió de estado; recarga antes de terminar")

    ops: list[tuple] = []  # cada cambio aplicado, para poder deshacerlo si algo falla
    try:
        for c in orden["consumos"]:
            pendiente = c["cantidad"]
            # Primero de las ubicaciones con más stock del almacén
            filas = await db.stock_ubicacion.find({
                "negocio_id": negocio_id, "almacen_id": orden["almacen_id"],
                "inventario_id": c["inventario_id"], "cantidad": {"$gt": 0},
            }).sort("cantidad", -1).to_list(500)
            for f in filas:
                if pendiente <= TOLERANCIA:
                    break
                tomar = min(pendiente, float(f["cantidad"]))
                r = await db.stock_ubicacion.update_one(
                    {"_id": f["_id"], "cantidad": {"$gte": tomar - TOLERANCIA}},
                    {"$inc": {"cantidad": -tomar}},
                )
                if r.modified_count == 0:
                    raise HTTPException(409, f"Stock insuficiente de {c['nombre']} en {orden['almacen_nombre']}")
                ops.append(("ubic", c["inventario_id"], f["ubicacion_id"], -tomar))
                pendiente -= tomar
            if pendiente > TOLERANCIA:
                raise HTTPException(409, f"Stock insuficiente de {c['nombre']} en {orden['almacen_nombre']}")

            antes = await db.inventario.find_one_and_update(
                {"_id": ObjectId(c["inventario_id"]), "stock_actual": {"$gte": c["cantidad"] - TOLERANCIA}},
                {"$inc": {"stock_actual": -c["cantidad"]}, "$set": {"updated_at": marca}},
                return_document=ReturnDocument.BEFORE,
            )
            if not antes:
                raise HTTPException(409, f"Stock insuficiente de {c['nombre']}")
            ops.append(("global", c["inventario_id"], -c["cantidad"]))
            await _movimiento(db, negocio_id, c["inventario_id"], c["nombre"], "salida", c["cantidad"],
                              float(antes["stock_actual"]), float(antes["stock_actual"]) - c["cantidad"],
                              referencia, usuario_id)

        # Producto terminado: a la ubicación de destino y al total del inventario
        producto_id = orden["producto"]["inventario_id"]
        destino = await db.ubicaciones_fabricacion.find_one({"_id": ObjectId(orden["ubicacion_destino_id"])})
        if not destino:
            raise HTTPException(404, "La ubicación de destino ya no existe")
        antes = await db.inventario.find_one_and_update(
            {"_id": ObjectId(producto_id)},
            {"$inc": {"stock_actual": orden["cantidad"]}, "$set": {"updated_at": marca}},
            return_document=ReturnDocument.BEFORE,
        )
        if not antes:
            raise HTTPException(404, "Producto terminado no encontrado en inventario")
        ops.append(("global", producto_id, orden["cantidad"]))
        await _ajustar_ubicacion(db, negocio_id, producto_id, destino, orden["cantidad"])
        ops.append(("ubic", producto_id, str(destino["_id"]), orden["cantidad"]))
        await _movimiento(db, negocio_id, producto_id, orden["producto"]["nombre"], "entrada", orden["cantidad"],
                          float(antes["stock_actual"]), float(antes["stock_actual"]) + orden["cantidad"],
                          referencia, usuario_id)
    except Exception:
        await _deshacer(db, ops, negocio_id)
        await db.ordenes_fabricacion.update_one(
            {"_id": orden["_id"]},
            {"$set": {"estado": "planeada", "fecha_terminada": None, "updated_at": ahora()}, "$inc": {"version": 1}},
        )
        raise

    await db.stock_ubicacion.delete_many({"negocio_id": negocio_id, "cantidad": {"$lte": TOLERANCIA}})
    return serializar(tomada)


@router.post("/ordenes/{orden_id}/cancelar")
async def cancelar_orden(orden_id: str, body: CancelarIn, db=Depends(get_db), user=Depends(get_current_user)):
    orden = await obtener_del_negocio(db.ordenes_fabricacion, orden_id, user, "Orden de fabricación")
    if orden["estado"] != "planeada":
        raise HTTPException(400, f"No se puede cancelar una orden en estado '{orden['estado']}'")
    doc = await db.ordenes_fabricacion.find_one_and_update(
        {"_id": orden["_id"], "estado": "planeada"},
        {"$set": {"estado": "cancelada", "motivo_cancelacion": body.motivo.strip(), "updated_at": ahora()}, "$inc": {"version": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if not doc:
        raise HTTPException(409, "La orden cambió de estado; recarga antes de cancelar")
    return serializar(doc)
