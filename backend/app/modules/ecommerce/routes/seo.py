"""
SEO de la tienda pública.

- GET /api/tienda/{slug}/sitemap.xml   URLs de la tienda y de sus productos visibles

Nginx publica la ruta como /tienda/{slug}/sitemap.xml (ver nginx/nginx.conf).
Los productos del sitemap siguen el mismo criterio que el catálogo público:
activos, en categorías visibles y, si controlan inventario, con stock mayor a 0.
"""
from datetime import datetime
from xml.sax.saxutils import escape

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from app.core.database import get_db

from ..services import config_por_slug

router = APIRouter()

LIMITE_URLS = 5000  # el protocolo admite hasta 50 000; la tienda no necesita más


def _origen_publico(request: Request) -> str:
    """Origen tal como lo ve el cliente (nginx pasa Host; el esquema viene de X-Forwarded-Proto)."""
    esquema = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("host", request.url.netloc)
    return f"{esquema}://{host}"


async def _productos_visibles(db, config: dict) -> list[str]:
    negocio_id = config["negocio_id"]
    visibles = config.get("categorias_visibles") or []

    filtro: dict = {"negocio_id": negocio_id, "activo": {"$ne": False}}
    if visibles:
        filtro["categoria_id"] = {"$in": visibles}

    productos = await db.productos.find(filtro, {"_id": 1, "control_inventario": 1}).to_list(length=LIMITE_URLS)

    # Stock de los productos que controlan existencias (una sola consulta)
    controlados = [str(p["_id"]) for p in productos if p.get("control_inventario")]
    stock: dict[str, float] = {}
    if controlados:
        async for fila in db.inventario.aggregate([
            {"$match": {"negocio_id": negocio_id, "producto_id": {"$in": controlados}, "activo": {"$ne": False}}},
            {"$group": {"_id": "$producto_id", "total": {"$sum": "$stock_actual"}}},
        ]):
            stock[fila["_id"]] = float(fila["total"] or 0)

    ids = []
    for p in productos:
        pid = str(p["_id"])
        if p.get("control_inventario") and stock.get(pid, 0) <= 0:
            continue
        ids.append(pid)
    return ids


@router.get("/tienda/{slug}/sitemap.xml")
async def sitemap_tienda(slug: str, request: Request, db=Depends(get_db)):
    config = await config_por_slug(db, slug)
    base = f"{_origen_publico(request)}/tienda/{escape(slug.lower())}"
    hoy = datetime.now().date().isoformat()

    urls = [f"<url><loc>{base}/</loc><lastmod>{hoy}</lastmod><changefreq>daily</changefreq></url>"]
    for pid in await _productos_visibles(db, config):
        urls.append(
            f"<url><loc>{base}/producto/{escape(pid)}</loc>"
            f"<changefreq>weekly</changefreq></url>"
        )

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        + "".join(urls)
        + "</urlset>"
    )
    return Response(content=xml, media_type="application/xml")
