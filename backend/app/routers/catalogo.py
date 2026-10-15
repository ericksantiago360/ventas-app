from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query

from ..core.database import get_db
from ..core.security import get_current_user
from ..models.base import serialize_list


router = APIRouter()


# ============================================================
# UTILIDADES
# ============================================================

def now():
    return datetime.now(timezone.utc)


def oid(value: str):
    try:
        return ObjectId(value)
    except Exception:
        raise HTTPException(status_code=400, detail="ID inválido")


def clean_body(body: dict):
    """
    Elimina campos que el cliente no debe controlar directamente.
    """
    body = dict(body)

    for field in (
        "_id",
        "created_at",
        "updated_at",
    ):
        body.pop(field, None)

    return body


def user_businesses(user: dict):
    """
    Obtiene los negocios autorizados para el usuario.
    Compatible con la estructura actual del sistema.
    """
    negocios = user.get("negocios") or user.get("businesses") or []

    if isinstance(negocios, str):
        negocios = [negocios]

    return set(negocios)


def check_business(user: dict, negocio_id: str):
    """
    Impide consultar o modificar información de otro negocio.
    """
    if negocio_id not in user_businesses(user):
        raise HTTPException(
            status_code=403,
            detail="No tienes acceso a este negocio",
        )


def ensure_business(body: dict, user: dict):
    negocio_id = body.get("negocio_id")

    if not negocio_id:
        raise HTTPException(
            status_code=422,
            detail="negocio_id es obligatorio",
        )

    check_business(user, negocio_id)
    return negocio_id


def validate_active(value):
    if value is None:
        return True
    return bool(value)


# ============================================================
# CATEGORÍAS
# ============================================================

@router.get("/categorias")
async def listar_categorias(
    negocio_id: str,
    activo: bool | None = True,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_business(user, negocio_id)

    filtro = {
        "negocio_id": negocio_id,
    }

    if activo is not None:
        filtro["activo"] = activo

    docs = await db.categorias.find(
        filtro
    ).sort("orden", 1).sort("nombre", 1).to_list(length=1000)

    return {
        "data": serialize_list(docs),
        "total": len(docs),
    }


@router.post("/categorias", status_code=201)
async def crear_categoria(
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    body = clean_body(body)
    negocio_id = ensure_business(body, user)

    nombre = str(body.get("nombre", "")).strip()

    if not nombre:
        raise HTTPException(
            status_code=422,
            detail="El nombre de la categoría es obligatorio",
        )

    codigo = str(body.get("codigo", "")).strip().upper()

    categoria_padre_id = body.get("categoria_padre_id")

    if categoria_padre_id:
        oid(categoria_padre_id)

    doc = {
        "negocio_id": negocio_id,
        "nombre": nombre,
        "codigo": codigo,
        "descripcion": body.get("descripcion", ""),
        "categoria_padre_id": categoria_padre_id,
        "activo": validate_active(body.get("activo")),
        "orden": int(body.get("orden", 0)),
        "created_at": now(),
        "updated_at": now(),
    }

    result = await db.categorias.insert_one(doc)

    return {
        "id": str(result.inserted_id),
        "data": serialize_list([doc])[0],
    }


@router.get("/categorias/{id}")
async def obtener_categoria(
    id: str,
    negocio_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_business(user, negocio_id)

    doc = await db.categorias.find_one({
        "_id": oid(id),
        "negocio_id": negocio_id,
    })

    if not doc:
        raise HTTPException(
            status_code=404,
            detail="Categoría no encontrada",
        )

    return {"data": serialize_list([doc])[0]}


@router.put("/categorias/{id}")
async def editar_categoria(
    id: str,
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    body = clean_body(body)
    negocio_id = ensure_business(body, user)

    update = {}

    if "nombre" in body:
        nombre = str(body["nombre"]).strip()

        if not nombre:
            raise HTTPException(
                status_code=422,
                detail="El nombre no puede estar vacío",
            )

        update["nombre"] = nombre

    if "codigo" in body:
        update["codigo"] = str(body["codigo"]).strip().upper()

    if "descripcion" in body:
        update["descripcion"] = body["descripcion"]

    if "categoria_padre_id" in body:
        categoria_padre_id = body["categoria_padre_id"]

        if categoria_padre_id:
            oid(categoria_padre_id)

        update["categoria_padre_id"] = categoria_padre_id

    if "activo" in body:
        update["activo"] = validate_active(body["activo"])

    if "orden" in body:
        update["orden"] = int(body["orden"])

    update["updated_at"] = now()

    result = await db.categorias.update_one(
        {
            "_id": oid(id),
            "negocio_id": negocio_id,
        },
        {
            "$set": update,
        },
    )

    if result.matched_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Categoría no encontrada",
        )

    doc = await db.categorias.find_one({
        "_id": oid(id),
        "negocio_id": negocio_id,
    })

    return {"data": serialize_list([doc])[0]}


@router.delete("/categorias/{id}")
async def eliminar_categoria(
    id: str,
    negocio_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_business(user, negocio_id)

    result = await db.categorias.update_one(
        {
            "_id": oid(id),
            "negocio_id": negocio_id,
        },
        {
            "$set": {
                "activo": False,
                "updated_at": now(),
            }
        },
    )

    if result.matched_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Categoría no encontrada",
        )

    return {"ok": True}


# ============================================================
# PRODUCTOS / SERVICIOS
# ============================================================

@router.get("/productos")
async def listar_productos(
    negocio_id: str,
    q: str | None = None,
    categoria_id: str | None = None,
    tipo: str | None = None,
    activo: bool | None = True,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_business(user, negocio_id)

    filtro: dict[str, Any] = {
        "negocio_id": negocio_id,
    }

    if activo is not None:
        filtro["activo"] = activo

    if tipo:
        filtro["tipo"] = tipo

    if categoria_id:
        filtro["categoria_id"] = categoria_id

    if q:
        texto = q.strip()

        filtro["$or"] = [
            {"nombre": {"$regex": texto, "$options": "i"}},
            {"codigo": {"$regex": texto, "$options": "i"}},
            {"sku": {"$regex": texto, "$options": "i"}},
            {"descripcion": {"$regex": texto, "$options": "i"}},
        ]

    skip = (page - 1) * limit

    cursor = (
        db.productos
        .find(filtro)
        .sort("nombre", 1)
        .skip(skip)
        .limit(limit)
    )

    docs = await cursor.to_list(length=limit)
    total = await db.productos.count_documents(filtro)

    return {
        "data": serialize_list(docs),
        "total": total,
        "page": page,
        "limit": limit,
    }


@router.post("/productos", status_code=201)
async def crear_producto(
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    body = clean_body(body)
    negocio_id = ensure_business(body, user)

    codigo = str(body.get("codigo", "")).strip()
    nombre = str(body.get("nombre", "")).strip()

    if not codigo:
        raise HTTPException(
            status_code=422,
            detail="El código es obligatorio",
        )

    if not nombre:
        raise HTTPException(
            status_code=422,
            detail="El nombre es obligatorio",
        )

    existe = await db.productos.find_one({
        "negocio_id": negocio_id,
        "codigo": codigo,
    })

    if existe:
        raise HTTPException(
            status_code=409,
            detail="Ya existe un producto con ese código en este negocio",
        )

    sku = str(body.get("sku") or codigo).strip()

    existe_sku = await db.productos.find_one({
        "negocio_id": negocio_id,
        "sku": sku,
    })

    if existe_sku:
        raise HTTPException(
            status_code=409,
            detail="Ya existe un producto con ese SKU en este negocio",
        )

    doc = {
        "negocio_id": negocio_id,

        "codigo": codigo,
        "sku": sku,

        "nombre": nombre,
        "descripcion": body.get("descripcion", ""),

        "tipo": body.get("tipo", "producto"),

        "categoria_id": body.get("categoria_id"),

        "unidad": body.get("unidad", "pieza"),

        "activo": validate_active(body.get("activo")),

        "imagen": body.get("imagen"),

        "costo": float(body.get("costo", 0) or 0),
        "precio_base": float(body.get("precio_base", 0) or 0),

        "iva_aplicable": bool(body.get("iva_aplicable", True)),
        "iva_pct": float(body.get("iva_pct", 16) or 0),

        "moneda": body.get("moneda", "MXN"),

        "control_inventario": bool(
            body.get("control_inventario", False)
        ),

        "permite_variantes": bool(
            body.get("permite_variantes", False)
        ),

        "especificaciones": body.get(
            "especificaciones", {}
        ),

        "metadata": body.get(
            "metadata", {}
        ),

        "created_at": now(),
        "updated_at": now(),
    }

    result = await db.productos.insert_one(doc)

    return {
        "id": str(result.inserted_id),
        "data": serialize_list([doc])[0],
    }


@router.get("/productos/{id}")
async def obtener_producto(
    id: str,
    negocio_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_business(user, negocio_id)

    doc = await db.productos.find_one({
        "_id": oid(id),
        "negocio_id": negocio_id,
    })

    if not doc:
        raise HTTPException(
            status_code=404,
            detail="Producto no encontrado",
        )

    return {"data": serialize_list([doc])[0]}


@router.put("/productos/{id}")
async def editar_producto(
    id: str,
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    body = clean_body(body)
    negocio_id = ensure_business(body, user)

    product_id = oid(id)

    actual = await db.productos.find_one({
        "_id": product_id,
        "negocio_id": negocio_id,
    })

    if not actual:
        raise HTTPException(
            status_code=404,
            detail="Producto no encontrado",
        )

    if "codigo" in body:
        codigo = str(body["codigo"]).strip()

        existe = await db.productos.find_one({
            "_id": {"$ne": product_id},
            "negocio_id": negocio_id,
            "codigo": codigo,
        })

        if existe:
            raise HTTPException(
                status_code=409,
                detail="Ese código ya existe en este negocio",
            )

        body["codigo"] = codigo

    if "sku" in body:
        sku = str(body["sku"]).strip()

        existe = await db.productos.find_one({
            "_id": {"$ne": product_id},
            "negocio_id": negocio_id,
            "sku": sku,
        })

        if existe:
            raise HTTPException(
                status_code=409,
                detail="Ese SKU ya existe en este negocio",
            )

        body["sku"] = sku

    for field in ("costo", "precio_base", "iva_pct"):
        if field in body:
            body[field] = float(body[field] or 0)

    body["updated_at"] = now()

    await db.productos.update_one(
        {
            "_id": product_id,
            "negocio_id": negocio_id,
        },
        {
            "$set": body,
        },
    )

    doc = await db.productos.find_one({
        "_id": product_id,
        "negocio_id": negocio_id,
    })

    return {"data": serialize_list([doc])[0]}


@router.delete("/productos/{id}")
async def eliminar_producto(
    id: str,
    negocio_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_business(user, negocio_id)

    product_id = oid(id)

    producto = await db.productos.find_one({
        "_id": product_id,
        "negocio_id": negocio_id,
    })

    if not producto:
        raise HTTPException(
            status_code=404,
            detail="Producto no encontrado",
        )

    # Eliminar variantes asociadas
    await db.variantes_producto.delete_many({
        "producto_id": product_id,
        "negocio_id": negocio_id,
    })

    # Eliminar precios asociados
    await db.precios_producto.delete_many({
        "producto_id": product_id,
        "negocio_id": negocio_id,
    })

    # Eliminar producto
    result = await db.productos.delete_one({
        "_id": product_id,
        "negocio_id": negocio_id,
    })

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Producto no encontrado",
        )

    return {
        "ok": True,
        "message": "Producto eliminado correctamente",
        "id": id,
    }     
          

# ============================================================
# VARIANTES
# ============================================================

@router.get("/productos/{producto_id}/variantes")
async def listar_variantes(
    producto_id: str,
    negocio_id: str,
    activo: bool | None = True,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_business(user, negocio_id)

    product_id = oid(producto_id)

    producto = await db.productos.find_one({
        "_id": product_id,
        "negocio_id": negocio_id,
    })

    if not producto:
        raise HTTPException(
            status_code=404,
            detail="Producto no encontrado",
        )

    filtro = {
        "negocio_id": negocio_id,
        "producto_id": product_id,
    }

    if activo is not None:
        filtro["activo"] = activo

    docs = await db.variantes_producto.find(
        filtro
    ).sort("nombre", 1).to_list(length=1000)

    return {
        "data": serialize_list(docs),
        "total": len(docs),
    }


@router.post("/productos/{producto_id}/variantes", status_code=201)
async def crear_variante(
    producto_id: str,
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    body = clean_body(body)
    negocio_id = ensure_business(body, user)

    product_id = oid(producto_id)

    producto = await db.productos.find_one({
        "_id": product_id,
        "negocio_id": negocio_id,
    })

    if not producto:
        raise HTTPException(
            status_code=404,
            detail="Producto no encontrado",
        )

    sku = str(body.get("sku", "")).strip()
    nombre = str(body.get("nombre", "")).strip()

    if not sku:
        raise HTTPException(
            status_code=422,
            detail="El SKU de la variante es obligatorio",
        )

    if not nombre:
        raise HTTPException(
            status_code=422,
            detail="El nombre de la variante es obligatorio",
        )

    existe = await db.variantes_producto.find_one({
        "negocio_id": negocio_id,
        "sku": sku,
    })

    if existe:
        raise HTTPException(
            status_code=409,
            detail="Ese SKU de variante ya existe",
        )

    doc = {
        "negocio_id": negocio_id,
        "producto_id": product_id,

        "sku": sku,
        "nombre": nombre,

        "atributos": body.get("atributos", {}),

        "precio": float(body.get("precio", 0) or 0),
        "costo": float(body.get("costo", 0) or 0),

        "activo": validate_active(body.get("activo")),

        "metadata": body.get("metadata", {}),

        "created_at": now(),
        "updated_at": now(),
    }

    result = await db.variantes_producto.insert_one(doc)

    return {
        "id": str(result.inserted_id),
        "data": serialize_list([doc])[0],
    }


@router.put("/variantes/{id}")
async def editar_variante(
    id: str,
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    body = clean_body(body)
    negocio_id = ensure_business(body, user)

    variante_id = oid(id)

    actual = await db.variantes_producto.find_one({
        "_id": variante_id,
        "negocio_id": negocio_id,
    })

    if not actual:
        raise HTTPException(
            status_code=404,
            detail="Variante no encontrada",
        )

    if "sku" in body:
        sku = str(body["sku"]).strip()

        existe = await db.variantes_producto.find_one({
            "_id": {"$ne": variante_id},
            "negocio_id": negocio_id,
            "sku": sku,
        })

        if existe:
            raise HTTPException(
                status_code=409,
                detail="Ese SKU ya existe",
            )

        body["sku"] = sku

    for field in ("precio", "costo"):
        if field in body:
            body[field] = float(body[field] or 0)

    body["updated_at"] = now()

    await db.variantes_producto.update_one(
        {
            "_id": variante_id,
            "negocio_id": negocio_id,
        },
        {
            "$set": body,
        },
    )

    doc = await db.variantes_producto.find_one({
        "_id": variante_id,
        "negocio_id": negocio_id,
    })

    return {"data": serialize_list([doc])[0]}


@router.delete("/variantes/{id}")
async def eliminar_variante(
    id: str,
    negocio_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_business(user, negocio_id)

    result = await db.variantes_producto.update_one(
        {
            "_id": oid(id),
            "negocio_id": negocio_id,
        },
        {
            "$set": {
                "activo": False,
                "updated_at": now(),
            }
        },
    )

    if result.matched_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Variante no encontrada",
        )

    return {"ok": True}


# ============================================================
# LISTAS DE PRECIOS
# ============================================================

@router.get("/listas-precios")
async def listar_listas_precios(
    negocio_id: str,
    activo: bool | None = True,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_business(user, negocio_id)

    filtro = {
        "negocio_id": negocio_id,
    }

    if activo is not None:
        filtro["activo"] = activo

    docs = await db.listas_precios.find(
        filtro
    ).sort("nombre", 1).to_list(length=500)

    return {
        "data": serialize_list(docs),
        "total": len(docs),
    }


@router.post("/listas-precios", status_code=201)
async def crear_lista_precios(
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    body = clean_body(body)
    negocio_id = ensure_business(body, user)

    nombre = str(body.get("nombre", "")).strip()

    if not nombre:
        raise HTTPException(
            status_code=422,
            detail="El nombre es obligatorio",
        )

    doc = {
        "negocio_id": negocio_id,
        "nombre": nombre,
        "descripcion": body.get("descripcion", ""),
        "moneda": body.get("moneda", "MXN"),
        "activo": validate_active(body.get("activo")),
        "created_at": now(),
        "updated_at": now(),
    }

    result = await db.listas_precios.insert_one(doc)

    return {
        "id": str(result.inserted_id),
        "data": serialize_list([doc])[0],
    }


@router.put("/listas-precios/{id}")
async def editar_lista_precios(
    id: str,
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    body = clean_body(body)
    negocio_id = ensure_business(body, user)

    lista_id = oid(id)

    result = await db.listas_precios.update_one(
        {
            "_id": lista_id,
            "negocio_id": negocio_id,
        },
        {
            "$set": {
                **body,
                "updated_at": now(),
            }
        },
    )

    if result.matched_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Lista de precios no encontrada",
        )

    doc = await db.listas_precios.find_one({
        "_id": lista_id,
        "negocio_id": negocio_id,
    })

    return {"data": serialize_list([doc])[0]}


# ============================================================
# PRECIOS POR PRODUCTO
# ============================================================

@router.get("/productos/{producto_id}/precios")
async def listar_precios_producto(
    producto_id: str,
    negocio_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_business(user, negocio_id)

    product_id = oid(producto_id)

    producto = await db.productos.find_one({
        "_id": product_id,
        "negocio_id": negocio_id,
    })

    if not producto:
        raise HTTPException(
            status_code=404,
            detail="Producto no encontrado",
        )

    docs = await db.precios_producto.find({
        "negocio_id": negocio_id,
        "producto_id": product_id,
    }).to_list(length=500)

    return {
        "data": serialize_list(docs),
        "total": len(docs),
    }


@router.post("/productos/{producto_id}/precios", status_code=201)
async def crear_precio_producto(
    producto_id: str,
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    body = clean_body(body)
    negocio_id = ensure_business(body, user)

    product_id = oid(producto_id)

    producto = await db.productos.find_one({
        "_id": product_id,
        "negocio_id": negocio_id,
    })

    if not producto:
        raise HTTPException(
            status_code=404,
            detail="Producto no encontrado",
        )

    lista_id = oid(body.get("lista_precio_id"))

    lista = await db.listas_precios.find_one({
        "_id": lista_id,
        "negocio_id": negocio_id,
    })

    if not lista:
        raise HTTPException(
            status_code=404,
            detail="Lista de precios no encontrada",
        )

    precio = float(body.get("precio", 0) or 0)

    doc = {
        "negocio_id": negocio_id,
        "producto_id": product_id,
        "lista_precio_id": lista_id,
        "precio": precio,
        "vigencia_desde": body.get("vigencia_desde"),
        "vigencia_hasta": body.get("vigencia_hasta"),
        "created_at": now(),
        "updated_at": now(),
    }

    result = await db.precios_producto.update_one(
        {
            "negocio_id": negocio_id,
            "producto_id": product_id,
            "lista_precio_id": lista_id,
        },
        {
            "$set": doc,
        },
        upsert=True,
    )

    if result.upserted_id:
        doc["_id"] = result.upserted_id
    else:
        existing = await db.precios_producto.find_one({
            "negocio_id": negocio_id,
            "producto_id": product_id,
            "lista_precio_id": lista_id,
        })
        doc = existing

    return {
        "id": str(doc["_id"]),
        "data": serialize_list([doc])[0],
    }


# ============================================================
# ATRIBUTOS DINÁMICOS
# ============================================================

@router.get("/atributos")
async def listar_atributos(
    negocio_id: str,
    activo: bool | None = True,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_business(user, negocio_id)

    filtro = {
        "negocio_id": negocio_id,
    }

    if activo is not None:
        filtro["activo"] = activo

    docs = await db.atributos.find(
        filtro
    ).sort("nombre", 1).to_list(length=500)

    return {
        "data": serialize_list(docs),
        "total": len(docs),
    }


@router.post("/atributos", status_code=201)
async def crear_atributo(
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    body = clean_body(body)
    negocio_id = ensure_business(body, user)

    nombre = str(body.get("nombre", "")).strip()
    codigo = str(body.get("codigo", "")).strip()

    if not nombre:
        raise HTTPException(
            status_code=422,
            detail="El nombre del atributo es obligatorio",
        )

    if not codigo:
        raise HTTPException(
            status_code=422,
            detail="El código del atributo es obligatorio",
        )

    existe = await db.atributos.find_one({
        "negocio_id": negocio_id,
        "codigo": codigo,
    })

    if existe:
        raise HTTPException(
            status_code=409,
            detail="Ya existe ese atributo en este negocio",
        )

    doc = {
        "negocio_id": negocio_id,

        "nombre": nombre,
        "codigo": codigo,

        "tipo": body.get("tipo", "text"),

        "opciones": body.get("opciones", []),

        "activo": validate_active(body.get("activo")),

        "created_at": now(),
        "updated_at": now(),
    }

    result = await db.atributos.insert_one(doc)

    return {
        "id": str(result.inserted_id),
        "data": serialize_list([doc])[0],
    }


@router.put("/atributos/{id}")
async def editar_atributo(
    id: str,
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    body = clean_body(body)
    negocio_id = ensure_business(body, user)

    atributo_id = oid(id)

    actual = await db.atributos.find_one({
        "_id": atributo_id,
        "negocio_id": negocio_id,
    })

    if not actual:
        raise HTTPException(
            status_code=404,
            detail="Atributo no encontrado",
        )

    if "codigo" in body:
        codigo = str(body["codigo"]).strip()

        existe = await db.atributos.find_one({
            "_id": {"$ne": atributo_id},
            "negocio_id": negocio_id,
            "codigo": codigo,
        })

        if existe:
            raise HTTPException(
                status_code=409,
                detail="Ese código ya existe",
            )

        body["codigo"] = codigo

    body["updated_at"] = now()

    await db.atributos.update_one(
        {
            "_id": atributo_id,
            "negocio_id": negocio_id,
        },
        {
            "$set": body,
        },
    )

    doc = await db.atributos.find_one({
        "_id": atributo_id,
        "negocio_id": negocio_id,
    })

    return {"data": serialize_list([doc])[0]}


@router.delete("/atributos/{id}")
async def eliminar_atributo(
    id: str,
    negocio_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_business(user, negocio_id)

    result = await db.atributos.update_one(
        {
            "_id": oid(id),
            "negocio_id": negocio_id,
        },
        {
            "$set": {
                "activo": False,
                "updated_at": now(),
            }
        },
    )

    if result.matched_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Atributo no encontrado",
        )

    return {"ok": True}
