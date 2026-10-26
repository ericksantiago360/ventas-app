"""
Catálogo público de la tienda. Lee los productos del catálogo interno; no duplica nada.

- GET /api/tienda/{slug}/categorias
- GET /api/tienda/{slug}/productos?categoria=&buscar=&pagina=&limite=
- GET /api/tienda/{slug}/productos/{producto_id}

Nunca devuelve costo, proveedor ni stock exacto: solo si el producto está disponible.
"""
import re

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import get_db

from ..services import config_por_slug, producto_visible

router = APIRouter()


def _precio_publico(valor, config: dict):
    if not config.get("mostrar_precio", True):
        return None
    return round(float(valor or 0), 2)


def _producto_publico(doc: dict, config: dict, variantes: list[dict], disponible: bool) -> dict:
    return {
        "id": str(doc["_id"]),
        "nombre": doc.get("nombre", ""),
        "descripcion": doc.get("descripcion", ""),
        "imagen": doc.get("imagen"),
        "tipo": doc.get("tipo", "producto"),
        "unidad": doc.get("unidad", "pieza"),
        "categoria_id": doc.get("categoria_id"),
        "precio": _precio_publico(doc.get("precio_base"), config),
        "cotizable": not config.get("mostrar_precio", True),
        "disponible": disponible,
        "variantes": [
            {
                "id": str(v["_id"]),
                "nombre": v.get("nombre") or v.get("sku", ""),
                "atributos": v.get("atributos", {}),
                "precio": _precio_publico(v.get("precio"), config),
            }
            for v in variantes
        ],
    }


async def _variantes_de(db, negocio_id: str, producto_ids: list[str]) -> dict[str, list[dict]]:
    if not producto_ids:
        return {}
    docs = db.variantes_producto.find({
        "negocio_id": negocio_id,
        "producto_id": {"$in": producto_ids},
        "activo": {"$ne": False},
    }).sort("sku", 1)
    agrupadas: dict[str, list[dict]] = {}
    async for v in docs:
        agrupadas.setdefault(v["producto_id"], []).append(v)
    return agrupadas


@router.get("/tienda/{slug}/categorias")
async def categorias_publicas(slug: str, db=Depends(get_db)):
    config = await config_por_slug(db, slug)
    negocio_id = config["negocio_id"]
    visibles = config.get("categorias_visibles") or []

    filtro = {"negocio_id": negocio_id, "activo": {"$ne": False}}
    if visibles:
        filtro["_id"] = {"$in": [ObjectId(c) for c in visibles if ObjectId.is_valid(c)]}
    categorias = await db.categorias.find(filtro).sort("nombre", 1).to_list(length=500)

    conteo = {}
    async for fila in db.productos.aggregate([
        {"$match": {"negocio_id": negocio_id, "activo": {"$ne": False}}},
        {"$group": {"_id": "$categoria_id", "n": {"$sum": 1}}},
    ]):
        conteo[fila["_id"]] = fila["n"]

    return {
        "data": [
            {"id": str(c["_id"]), "nombre": c.get("nombre", ""), "productos": conteo.get(str(c["_id"]), 0)}
            for c in categorias
        ]
    }


@router.get("/tienda/{slug}/productos")
async def productos_publicos(
    slug: str,
    categoria: str | None = None,
    buscar: str | None = None,
    pagina: int = Query(1, ge=1),
    limite: int = Query(24, ge=1, le=60),
    db=Depends(get_db),
):
    config = await config_por_slug(db, slug)
    negocio_id = config["negocio_id"]
    visibles = config.get("categorias_visibles") or []

    filtro: dict = {"negocio_id": negocio_id, "activo": {"$ne": False}}
    if categoria:
        if visibles and categoria not in visibles:
            raise HTTPException(404, "Categoría no disponible")
        filtro["categoria_id"] = categoria
    elif visibles:
        filtro["categoria_id"] = {"$in": visibles}
    if buscar and buscar.strip():
        patron = re.escape(buscar.strip())
        filtro["$or"] = [
            {"nombre": {"$regex": patron, "$options": "i"}},
            {"descripcion": {"$regex": patron, "$options": "i"}},
        ]

    # Productos que controlan inventario solo aparecen si tienen existencias.
    # El filtro va en la agregación para que la paginación cuadre.
    pipeline = [
        {"$match": filtro},
        {"$lookup": {
            "from": "inventario",
            "let": {"pid": {"$toString": "$_id"}},
            "pipeline": [
                {"$match": {"$expr": {"$and": [
                    {"$eq": ["$producto_id", "$$pid"]},
                    {"$eq": ["$negocio_id", negocio_id]},
                    {"$ne": ["$activo", False]},
                ]}}},
                {"$project": {"stock_actual": 1}},
            ],
            "as": "inv",
        }},
        {"$addFields": {"stock_total": {"$sum": "$inv.stock_actual"}}},
        {"$match": {"$or": [
            {"control_inventario": {"$ne": True}},
            {"stock_total": {"$gt": 0}},
        ]}},
        {"$sort": {"nombre": 1}},
        {"$facet": {
            "data": [{"$skip": (pagina - 1) * limite}, {"$limit": limite}],
            "total": [{"$count": "n"}],
        }},
    ]
    resultado = (await db.productos.aggregate(pipeline).to_list(length=1))[0]
    docs = resultado["data"]
    total = resultado["total"][0]["n"] if resultado["total"] else 0

    ids = [str(d["_id"]) for d in docs]
    variantes = await _variantes_de(db, negocio_id, ids)
    return {
        "data": [
            _producto_publico(
                d, config, variantes.get(str(d["_id"]), []),
                disponible=True,
            )
            for d in docs
        ],
        "total": total,
        "pagina": pagina,
        "limite": limite,
    }


@router.get("/tienda/{slug}/productos/{producto_id}")
async def producto_publico(slug: str, producto_id: str, db=Depends(get_db)):
    config = await config_por_slug(db, slug)
    negocio_id = config["negocio_id"]
    if not ObjectId.is_valid(producto_id):
        raise HTTPException(404, "Producto no encontrado")

    doc = await db.productos.find_one({"_id": ObjectId(producto_id), "negocio_id": negocio_id})
    if not producto_visible(doc, config):
        raise HTTPException(404, "Producto no encontrado")

    stock = 0.0
    if doc.get("control_inventario"):
        async for inv in db.inventario.find({"negocio_id": negocio_id, "producto_id": producto_id, "activo": {"$ne": False}}):
            stock += float(inv.get("stock_actual", 0) or 0)
    disponible = not doc.get("control_inventario") or stock > 0

    variantes = await _variantes_de(db, negocio_id, [producto_id])
    return _producto_publico(doc, config, variantes.get(producto_id, []), disponible=disponible)
