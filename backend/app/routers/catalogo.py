import asyncio
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from pydantic import BaseModel

from ..core.config import settings
from ..core.database import get_db
from ..core.security import get_current_user
from ..core.negocios import negocio_autorizado, validar_referencia, verificar_acceso
from ..models.base import serialize_list
from .inventario import crear_item_inventario_producto, verificar_nombre_inventario_libre


router = APIRouter()


# ============================================================
# UTILIDADES
# ============================================================

def now():
    return datetime.now(timezone.utc)


def stock_inicial_de(body: dict) -> float:
    """
    stock_inicial no es campo del producto: se saca del body (para que no se guarde)
    y se valida. Solo se usa al crear o al activar el control de existencias.
    """
    valor = body.pop("stock_inicial", 0) or 0
    try:
        cantidad = float(valor)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="El stock inicial debe ser un número")
    if cantidad < 0:
        raise HTTPException(status_code=422, detail="El stock inicial no puede ser negativo")
    return cantidad


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


def ensure_business(body: dict, user: dict):
    negocio_id = body.get("negocio_id")

    if not negocio_id:
        raise HTTPException(
            status_code=422,
            detail="negocio_id es obligatorio",
        )

    verificar_acceso(user, negocio_id)
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
    verificar_acceso(user, negocio_id)

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
    verificar_acceso(user, negocio_id)

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
    verificar_acceso(user, negocio_id)

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
    verificar_acceso(user, negocio_id)

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
    stock_inicial = stock_inicial_de(body)
    await validar_referencia(db.categorias, body.get("categoria_id"), negocio_id, "Categoría")

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

    control_inventario = bool(body.get("control_inventario", False))
    if control_inventario:
        # Se valida antes de insertar el producto para no dejar un producto a medias
        await verificar_nombre_inventario_libre(db, negocio_id, nombre)

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

        "control_inventario": control_inventario,

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

    if control_inventario:
        await crear_item_inventario_producto(
            db,
            negocio_id=negocio_id,
            producto_id=str(result.inserted_id),
            nombre=nombre,
            sku=sku,
            unidad=doc["unidad"],
            costo=doc["costo"],
            stock_inicial=stock_inicial,
            usuario_id=str(user["_id"]),
        )

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
    verificar_acceso(user, negocio_id)

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
    # Solo aplica al crear o al activar el control; si ya hay ítem de inventario, se ignora
    stock_inicial = stock_inicial_de(body)

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

    await validar_referencia(db.categorias, body.get("categoria_id"), negocio_id, "Categoría")

    control_nuevo = (
        bool(body["control_inventario"]) if "control_inventario" in body
        else bool(actual.get("control_inventario", False))
    )
    crear_item = False
    if control_nuevo:
        ya_tiene_item = await db.inventario.find_one({
            "negocio_id": negocio_id,
            "producto_id": id,
            "activo": {"$ne": False},
        })
        crear_item = ya_tiene_item is None
        if crear_item:
            await verificar_nombre_inventario_libre(
                db, negocio_id, str(body.get("nombre", actual.get("nombre", "")))
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

    if crear_item:
        await crear_item_inventario_producto(
            db,
            negocio_id=negocio_id,
            producto_id=id,
            nombre=str(body.get("nombre", actual.get("nombre", ""))),
            sku=str(body.get("sku", actual.get("sku", ""))),
            unidad=str(body.get("unidad", actual.get("unidad", "pieza"))),
            costo=float(body.get("costo", actual.get("costo", 0)) or 0),
            stock_inicial=stock_inicial,
            usuario_id=str(user["_id"]),
        )

    doc = await db.productos.find_one({
        "_id": product_id,
        "negocio_id": negocio_id,
    })

    return {"data": serialize_list([doc])[0]}


TAMANO_MAX_IMAGEN_PRODUCTO = 5 * 1024 * 1024


def formato_imagen(contenido: bytes) -> str | None:
    """Extensión según los bytes del archivo; no confía en el Content-Type del cliente."""
    if contenido[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if contenido[:3] == b"\xff\xd8\xff":
        return "jpg"
    if contenido[:4] == b"RIFF" and contenido[8:12] == b"WEBP":
        return "webp"
    return None


@router.post("/productos/{id}/imagen")
async def subir_imagen_producto(
    id: str,
    archivo: UploadFile,
    negocio_id: str = Depends(negocio_autorizado),
    db=Depends(get_db),
):
    product_id = oid(id)

    actual = await db.productos.find_one({
        "_id": product_id,
        "negocio_id": negocio_id,
    })

    if not actual:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    contenido = await archivo.read()

    if len(contenido) > TAMANO_MAX_IMAGEN_PRODUCTO:
        raise HTTPException(status_code=400, detail="La imagen pasa de 5 MB")

    extension = formato_imagen(contenido)

    if not extension:
        raise HTTPException(status_code=400, detail="Formato no permitido. Usa JPG, PNG o WebP")

    carpeta = Path(settings.STORAGE_PATH) / "productos" / negocio_id
    carpeta.mkdir(parents=True, exist_ok=True)
    nombre = f"{id}-{uuid.uuid4().hex[:12]}.{extension}"
    await asyncio.to_thread((carpeta / nombre).write_bytes, contenido)

    url = f"/storage/productos/{negocio_id}/{nombre}"

    await db.productos.update_one(
        {"_id": product_id, "negocio_id": negocio_id},
        {"$set": {"imagen": url, "updated_at": now()}},
    )

    # Borra la imagen anterior solo si fue subida por este endpoint
    anterior = actual.get("imagen") or ""
    prefijo = f"/storage/productos/{negocio_id}/"
    if anterior.startswith(prefijo) and ".." not in anterior:
        ruta_anterior = Path(settings.STORAGE_PATH) / anterior.removeprefix("/storage/")
        await asyncio.to_thread(ruta_anterior.unlink, missing_ok=True)

    return {"data": {"imagen": url}}


# ============================================================
# GALERÍA DEL PRODUCTO (imágenes y videos de YouTube mezclados)
# `medios` es la lista ordenada; el primero es el principal.
# `imagen` sigue siendo la primera imagen (lo usan listados y POS).
# ============================================================

YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
YOUTUBE_PATRONES = [
    re.compile(r"youtu\.be/([^?&\s/]+)"),
    re.compile(r"[?&]v=([^?&\s]+)"),
    re.compile(r"/(?:embed|shorts)/([^?&\s/]+)"),
]


def extraer_youtube_id(url: str) -> str | None:
    for patron in YOUTUBE_PATRONES:
        m = patron.search(url or "")
        if m and YOUTUBE_ID_RE.match(m.group(1)):
            return m.group(1)
    return None


def _medio_youtube(youtube_id: str) -> dict:
    return {
        "id": f"yt-{uuid.uuid4().hex[:10]}",
        "tipo": "youtube",
        "youtube_id": youtube_id,
        "thumbnail": f"https://img.youtube.com/vi/{youtube_id}/hqdefault.jpg",
    }


def _medios_de(doc: dict) -> list[dict]:
    """Lista de medios; convierte el formato antiguo (imagenes / imagen) al vuelo."""
    if doc.get("medios") is not None:
        return list(doc["medios"])
    if doc.get("imagenes") is not None:
        return [{"id": f"img-{i}", "tipo": "imagen", "url": u} for i, u in enumerate(doc["imagenes"])]
    if doc.get("imagen"):
        return [{"id": "img-0", "tipo": "imagen", "url": doc["imagen"]}]
    return []


def _principal_de(medios: list[dict]) -> str:
    for m in medios:
        if m.get("tipo") == "imagen" and m.get("url"):
            return m["url"]
    return ""


class OrdenMedios(BaseModel):
    ids: list[str] = []


def _ruta_imagen_producto(negocio_id: str, url: str) -> Path | None:
    prefijo = f"/storage/productos/{negocio_id}/"
    if not url or not url.startswith(prefijo) or ".." in url:
        return None
    return Path(settings.STORAGE_PATH) / url.removeprefix("/storage/")


async def _producto_del_negocio(db, id: str, negocio_id: str):
    product_id = oid(id)
    actual = await db.productos.find_one({"_id": product_id, "negocio_id": negocio_id})
    if not actual:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return product_id, actual


@router.post("/productos/{id}/imagenes")
async def agregar_imagen_galeria(
    id: str,
    archivo: UploadFile,
    negocio_id: str = Depends(negocio_autorizado),
    db=Depends(get_db),
):
    product_id, actual = await _producto_del_negocio(db, id, negocio_id)

    contenido = await archivo.read()
    if len(contenido) > TAMANO_MAX_IMAGEN_PRODUCTO:
        raise HTTPException(status_code=400, detail="La imagen pasa de 5 MB")
    extension = formato_imagen(contenido)
    if not extension:
        raise HTTPException(status_code=400, detail="Formato no permitido. Usa JPG, PNG o WebP")

    carpeta = Path(settings.STORAGE_PATH) / "productos" / negocio_id
    carpeta.mkdir(parents=True, exist_ok=True)
    nombre = f"{id}-{uuid.uuid4().hex[:12]}.{extension}"
    await asyncio.to_thread((carpeta / nombre).write_bytes, contenido)
    url = f"/storage/productos/{negocio_id}/{nombre}"

    medios = _medios_de(actual) + [{"id": f"img-{uuid.uuid4().hex[:10]}", "tipo": "imagen", "url": url}]
    await _guardar_medios(db, product_id, negocio_id, medios)
    return {"data": {"imagen": _principal_de(medios), "medios": medios}}


class VideoYoutube(BaseModel):
    url: str


@router.post("/productos/{id}/medios/youtube")
async def agregar_video_youtube(
    id: str,
    body: VideoYoutube,
    negocio_id: str = Depends(negocio_autorizado),
    db=Depends(get_db),
):
    product_id, actual = await _producto_del_negocio(db, id, negocio_id)
    youtube_id = extraer_youtube_id(body.url.strip())
    if not youtube_id:
        raise HTTPException(status_code=400, detail="URL de YouTube no reconocida")

    medios = _medios_de(actual) + [_medio_youtube(youtube_id)]
    await _guardar_medios(db, product_id, negocio_id, medios)
    return {"data": {"imagen": _principal_de(medios), "medios": medios}}


async def _guardar_medios(db, product_id, negocio_id: str, medios: list[dict]) -> None:
    await db.productos.update_one(
        {"_id": product_id, "negocio_id": negocio_id},
        {"$set": {"medios": medios, "imagen": _principal_de(medios), "updated_at": now()}},
    )


@router.put("/productos/{id}/medios")
async def ordenar_medios_producto(
    id: str,
    body: OrdenMedios,
    negocio_id: str = Depends(negocio_autorizado),
    db=Depends(get_db),
):
    """
    Reordena o quita medios. `ids` debe ser un subconjunto de los medios actuales
    (así no se puede inyectar rutas ajenas). Las imágenes quitadas se borran del disco.
    """
    product_id, actual = await _producto_del_negocio(db, id, negocio_id)
    actuales = _medios_de(actual)
    por_id = {m["id"]: m for m in actuales}

    if len(set(body.ids)) != len(body.ids) or not set(body.ids) <= set(por_id):
        raise HTTPException(status_code=400, detail="La galería no coincide con los medios del producto")

    nuevos = [por_id[i] for i in body.ids]
    await _guardar_medios(db, product_id, negocio_id, nuevos)

    quitadas = [m for m in actuales if m["id"] not in body.ids and m.get("tipo") == "imagen"]
    for medio in quitadas:
        ruta = _ruta_imagen_producto(negocio_id, medio.get("url") or "")
        if ruta:
            await asyncio.to_thread(ruta.unlink, missing_ok=True)

    return {"data": {"imagen": _principal_de(nuevos), "medios": nuevos}}


@router.delete("/productos/{id}")
async def eliminar_producto(
    id: str,
    negocio_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)

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
    verificar_acceso(user, negocio_id)

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
    verificar_acceso(user, negocio_id)

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
    verificar_acceso(user, negocio_id)

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
    verificar_acceso(user, negocio_id)

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
    verificar_acceso(user, negocio_id)

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
    verificar_acceso(user, negocio_id)

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


# ============================================================
# LISTAS DE PRECIOS GENERADAS
# ============================================================

@router.post("/listas-precios/generar", status_code=201)
async def generar_lista_precios(
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Crea una lista a partir del precio base de los productos: precio = base × (1 + ajuste%).
    Un ajuste negativo sirve para mayoreo o promociones; con redondear_pesos el precio es entero.
    """
    body = clean_body(body)
    negocio_id = ensure_business(body, user)

    nombre = str(body.get("nombre", "")).strip()
    if not nombre:
        raise HTTPException(status_code=422, detail="El nombre es obligatorio")
    try:
        ajuste = float(body.get("ajuste_pct", 0) or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="El ajuste debe ser un número")
    if not -99 <= ajuste <= 500:
        raise HTTPException(status_code=422, detail="El ajuste debe estar entre -99% y 500%")

    redondear = bool(body.get("redondear_pesos", False))
    categoria_id = body.get("categoria_id") or None

    if await db.listas_precios.find_one({"negocio_id": negocio_id, "nombre": nombre}):
        raise HTTPException(status_code=409, detail="Ya existe una lista de precios con ese nombre")

    filtro = {"negocio_id": negocio_id, "activo": {"$ne": False}, "precio_base": {"$gt": 0}}
    if categoria_id:
        filtro["categoria_id"] = categoria_id
    productos = await db.productos.find(filtro).to_list(length=5000)
    if not productos:
        raise HTTPException(status_code=422, detail="No hay productos con precio base para generar la lista")

    factor = 1 + ajuste / 100

    def precio_de(base: float) -> float:
        valor = base * factor
        return float(round(valor)) if redondear else round(valor, 2)

    marca = now()
    lista = {
        "negocio_id": negocio_id,
        "nombre": nombre,
        "descripcion": str(body.get("descripcion", "") or ""),
        "moneda": "MXN",
        "activo": True,
        "generada": True,
        "ajuste_pct": ajuste,
        "categoria_id": categoria_id,
        "redondear_pesos": redondear,
        "total_productos": len(productos),
        "created_at": marca,
        "updated_at": marca,
    }
    resultado = await db.listas_precios.insert_one(lista)
    lista["_id"] = resultado.inserted_id

    await db.precios_producto.insert_many([{
        "negocio_id": negocio_id,
        "producto_id": p["_id"],
        "lista_precio_id": lista["_id"],
        "precio": precio_de(float(p["precio_base"])),
        "vigencia_desde": None,
        "vigencia_hasta": None,
        "created_at": marca,
        "updated_at": marca,
    } for p in productos])

    return {"data": serialize_list([lista])[0]}


@router.get("/listas-precios/{id}/precios")
async def precios_de_lista(
    id: str,
    negocio_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    lista_id = oid(id)
    lista = await db.listas_precios.find_one({"_id": lista_id, "negocio_id": negocio_id})
    if not lista:
        raise HTTPException(status_code=404, detail="Lista de precios no encontrada")

    precios = await db.precios_producto.find({"negocio_id": negocio_id, "lista_precio_id": lista_id}).to_list(length=5000)
    ids = [x["producto_id"] for x in precios]
    productos = {
        p["_id"]: p
        async for p in db.productos.find({"_id": {"$in": ids}}, {"nombre": 1, "codigo": 1, "precio_base": 1})
    }

    filas = []
    for x in precios:
        p = productos.get(x["producto_id"], {})
        base = float(p.get("precio_base") or 0)
        precio = float(x["precio"])
        filas.append({
            "producto_id": str(x["producto_id"]),
            "codigo": p.get("codigo", ""),
            "nombre": p.get("nombre", "(producto eliminado)"),
            "precio_base": base,
            "precio": precio,
            "diferencia_pct": round((precio - base) / base * 100, 2) if base else 0.0,
        })
    filas.sort(key=lambda f: f["nombre"])

    return {"lista": serialize_list([lista])[0], "data": filas, "total": len(filas)}
