"""
Configuración de la tienda.

- GET  /api/tienda/{slug}/config            pública: datos visibles, sin CLABE ni convenio
- GET  /api/admin/tienda/config             configuración completa del negocio
- PUT  /api/admin/tienda/config             actualizar (solo administradores)
- POST /api/admin/tienda/logo|banner        subir imagen (solo administradores)
- GET  /api/admin/tienda/categorias         categorías del negocio para elegir visibles
"""
import asyncio
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile

from app.core.config import settings
from app.core.database import get_db
from app.core.negocios import negocio_autorizado
from app.core.security import get_current_user, require_admin
from app.models.base import serialize_doc

from ..models.config import DEFAULTS_TIENDA, TiendaConfigUpdate, config_publica
from ..services import config_completa, config_por_slug

router = APIRouter()

IMAGENES_PERMITIDAS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
TAMANO_MAX_IMAGEN = 5 * 1024 * 1024


@router.get("/tienda/{slug}/config")
async def config_tienda_publica(slug: str, db=Depends(get_db)):
    return config_publica(await config_por_slug(db, slug))


@router.get("/admin/tienda/config")
async def obtener_config_admin(
    negocio_id: str = Depends(negocio_autorizado),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    config = await db.tienda_config.find_one({"negocio_id": negocio_id})
    doc = config_completa(serialize_doc(config))
    doc["negocio_id"] = negocio_id
    return doc


@router.put("/admin/tienda/config")
async def guardar_config_admin(
    body: TiendaConfigUpdate,
    negocio_id: str = Depends(negocio_autorizado),
    db=Depends(get_db),
    user=Depends(require_admin),
):
    if not await db.config_negocios.find_one({"_id": negocio_id}, {"_id": 1}):
        raise HTTPException(404, "Negocio no encontrado")

    cambios = body.model_dump(exclude_none=True)

    if "slug" in cambios:
        otra = await db.tienda_config.find_one({"slug": cambios["slug"], "negocio_id": {"$ne": negocio_id}})
        if otra:
            raise HTTPException(409, "Ese nombre de tienda (slug) ya está en uso")

    # Los valores por defecto solo se escriben al crear la configuración
    defaults = {k: v for k, v in DEFAULTS_TIENDA.items() if k not in cambios}
    await db.tienda_config.update_one(
        {"negocio_id": negocio_id},
        {
            "$set": {**cambios, "updated_at": datetime.now(timezone.utc)},
            "$setOnInsert": {**defaults, "negocio_id": negocio_id},
        },
        upsert=True,
    )
    return serialize_doc(await db.tienda_config.find_one({"negocio_id": negocio_id}))


@router.get("/admin/tienda/categorias")
async def categorias_para_tienda(
    negocio_id: str = Depends(negocio_autorizado),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    docs = await db.categorias.find({"negocio_id": negocio_id, "activo": {"$ne": False}}) \
        .sort("nombre", 1).to_list(length=1000)
    return {"data": [{"id": str(d["_id"]), "nombre": d.get("nombre", "")} for d in docs]}


@router.post("/admin/tienda/logo")
async def subir_logo(
    archivo: UploadFile,
    negocio_id: str = Depends(negocio_autorizado),
    db=Depends(get_db),
    user=Depends(require_admin),
):
    return await _guardar_imagen(db, negocio_id, archivo, "logo_url", "logo")


@router.post("/admin/tienda/banner")
async def subir_banner(
    archivo: UploadFile,
    negocio_id: str = Depends(negocio_autorizado),
    db=Depends(get_db),
    user=Depends(require_admin),
):
    return await _guardar_imagen(db, negocio_id, archivo, "banner_url", "banner")


async def _guardar_imagen(db, negocio_id: str, archivo: UploadFile, campo: str, prefijo: str) -> dict:
    extension = IMAGENES_PERMITIDAS.get(archivo.content_type or "")
    if not extension:
        raise HTTPException(400, "Formato no permitido. Usa JPG, PNG o WebP")
    contenido = await archivo.read()
    if len(contenido) > TAMANO_MAX_IMAGEN:
        raise HTTPException(400, "La imagen pasa de 5 MB")

    carpeta = Path(settings.STORAGE_PATH) / "tienda" / negocio_id
    carpeta.mkdir(parents=True, exist_ok=True)
    nombre = f"{prefijo}-{uuid.uuid4().hex[:12]}.{extension}"
    await asyncio.to_thread((carpeta / nombre).write_bytes, contenido)

    url = f"/storage/tienda/{negocio_id}/{nombre}"
    await db.tienda_config.update_one(
        {"negocio_id": negocio_id},
        {
            "$set": {campo: url, "updated_at": datetime.now(timezone.utc)},
            "$setOnInsert": {**{k: v for k, v in DEFAULTS_TIENDA.items() if k != campo}, "negocio_id": negocio_id},
        },
        upsert=True,
    )
    return {"ok": True, campo: url}
