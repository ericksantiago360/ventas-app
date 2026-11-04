"""
Buscador global: busca en los módulos del negocio y devuelve el resultado con la ruta del módulo.

Solo cuenta lo que el usuario puede ver: el negocio debe estar en sus negocios, y los clientes
se filtran con las mismas reglas que el CRM.
"""
import re

from fastapi import APIRouter, Depends, Query

from ..core.database import get_db
from ..core.negocios import verificar_acceso
from ..core.security import get_current_user
from .crm import cliente_accesible

router = APIRouter(prefix="/buscar", tags=["Buscador"])

LIMITE_POR_TIPO = 5


def _regex(texto: str) -> dict:
    return {"$regex": re.escape(texto), "$options": "i"}


def _resultado(tipo: str, titulo: str, subtitulo: str, ruta: str, id_: str) -> dict:
    return {"tipo": tipo, "titulo": titulo or "(sin nombre)", "subtitulo": subtitulo, "ruta": ruta, "id": id_}


@router.get("")
async def buscar(
    negocio_id: str = Query(...),
    q: str = Query("", max_length=80),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    texto = q.strip()
    if len(texto) < 2:
        return []
    activo = {"$ne": False}
    base = {"negocio_id": negocio_id}
    out: list[dict] = []

    # Clientes (unificados: se filtran por acceso del usuario)
    clientes = await db.clientes.find({
        "activo": activo,
        "$or": [{"empresa": _regex(texto)}, {"contacto": _regex(texto)}, {"telefono": _regex(texto)}],
    }).to_list(200)
    visibles = 0
    for c in clientes:
        if visibles >= LIMITE_POR_TIPO:
            break
        if await cliente_accesible(db, c, user):
            visibles += 1
            out.append(_resultado("Cliente", c.get("empresa", ""), c.get("telefono", ""), "/crm", str(c["_id"])))

    async def por_coleccion(coleccion, tipo, filtro_texto, titulo_campo, subtitulo_campo, ruta, extra=None):
        filtro = {**base, **(extra or {}), "$or": filtro_texto}
        for d in await coleccion.find(filtro).to_list(LIMITE_POR_TIPO):
            out.append(_resultado(tipo, d.get(titulo_campo, ""), str(d.get(subtitulo_campo, "") or ""), ruta, str(d["_id"])))

    await por_coleccion(db.leads, "Lead", [{"empresa": _regex(texto)}, {"contacto": _regex(texto)}],
                        "empresa", "etapa", "/crm", {"activo": True})
    await por_coleccion(db.productos, "Producto", [{"nombre": _regex(texto)}, {"codigo": _regex(texto)}],
                        "nombre", "codigo", "/catalogo", {"activo": activo})
    await por_coleccion(db.inventario, "Inventario", [{"nombre": _regex(texto)}, {"sku": _regex(texto)}],
                        "nombre", "sku", "/inventario", {"activo": activo})
    await por_coleccion(db.pedidos, "Pedido", [{"numero": _regex(texto)}, {"cliente_nombre": _regex(texto)}],
                        "numero", "cliente_nombre", "/pedidos")
    await por_coleccion(db.cotizaciones, "Cotización", [{"numero": _regex(texto)}],
                        "numero", "estado", "/cotizaciones")
    await por_coleccion(db.ventas_mostrador, "Venta de mostrador", [{"folio": _regex(texto)}],
                        "folio", "metodo_pago", "/mostrador")
    await por_coleccion(db.proveedores, "Proveedor", [{"nombre": _regex(texto)}, {"rfc": _regex(texto)}],
                        "nombre", "contacto", "/compras", {"activo": activo})
    await por_coleccion(db.ordenes_compra, "Orden de compra", [{"numero": _regex(texto)}, {"proveedor_nombre": _regex(texto)}],
                        "numero", "proveedor_nombre", "/compras")
    await por_coleccion(db.ordenes_fabricacion, "Orden de fabricación", [{"numero": _regex(texto)}, {"receta_nombre": _regex(texto)}],
                        "numero", "receta_nombre", "/fabricacion")
    return out
