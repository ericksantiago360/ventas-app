"""
Venta rápida desde CRM: productos de interés de un cliente, productos más vendidos y
generación de cotización, pedido o venta de mostrador con las líneas elegidas.

La venta usa las mismas funciones de creación de cada módulo, así folios, estados y stock
no se duplican aquí.
"""
from collections import defaultdict
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Literal, Optional

from ..core.database import get_db
from ..core.negocios import verificar_acceso
from ..core.security import get_current_user
from .crm import cliente_accesible_o_403
from .cotizaciones import crear_cotizacion
from .mostrador import ItemVenta, VentaCreate, registrar_venta
from .pedidos import crear_pedido

router = APIRouter(prefix="/crm", tags=["CRM venta rápida"])

METODOS = Literal["efectivo", "tarjeta", "transferencia"]


def _oid(valor: str) -> ObjectId:
    if not ObjectId.is_valid(str(valor)):
        raise HTTPException(status_code=400, detail="ID inválido")
    return ObjectId(valor)


async def _productos_del_negocio(db, negocio_id: str, ids: list[str]) -> dict[str, dict]:
    """Productos activos del negocio por id; los que no existan o son de otro negocio responden 404."""
    productos = {}
    for pid in ids:
        p = await db.productos.find_one({"_id": _oid(pid), "negocio_id": negocio_id})
        if not p:
            raise HTTPException(status_code=404, detail="Producto no encontrado en este negocio")
        productos[pid] = p
    return productos


# ──────────────────────────────────────────────────────────────────────────────
# Productos de interés
# ──────────────────────────────────────────────────────────────────────────────

class InteresIn(BaseModel):
    negocio_id: str
    producto_ids: list[str] = Field(default_factory=list)


@router.get("/clientes/{cliente_id}/productos-interes")
async def productos_interes(
    cliente_id: str,
    negocio_id: str = Query(...),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    cliente = await cliente_accesible_o_403(db, cliente_id, user)
    ids = (cliente.get("productos_interes") or {}).get(negocio_id, [])
    productos = await _productos_del_negocio(db, negocio_id, ids) if ids else {}
    return [{"id": pid, "nombre": p["nombre"], "precio": float(p.get("precio_base") or 0)}
            for pid, p in productos.items()]


@router.put("/clientes/{cliente_id}/productos-interes")
async def guardar_productos_interes(
    cliente_id: str,
    body: InteresIn,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    cliente = await cliente_accesible_o_403(db, cliente_id, user)
    ids = list(dict.fromkeys(body.producto_ids))  # sin repetidos, conserva el orden
    await _productos_del_negocio(db, body.negocio_id, ids)
    await db.clientes.update_one(
        {"_id": cliente["_id"]},
        {"$set": {f"productos_interes.{body.negocio_id}": ids, "updated_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True, "producto_ids": ids}


# ──────────────────────────────────────────────────────────────────────────────
# Más vendidos
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/productos-mas-vendidos")
async def productos_mas_vendidos(
    negocio_id: str = Query(...),
    limite: int = Query(8, ge=1, le=30),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Unidades vendidas por producto en pedidos no cancelados y ventas de mostrador completadas."""
    verificar_acceso(user, negocio_id)
    unidades: dict[str, float] = defaultdict(float)

    async for p in db.pedidos.find({"negocio_id": negocio_id, "estado": {"$not": {"$regex": "cancel"}}}, {"items": 1}):
        for it in p.get("items") or []:
            if it.get("producto_id"):
                unidades[str(it["producto_id"])] += float(it.get("cantidad") or 0)
    async for v in db.ventas_mostrador.find({"negocio_id": negocio_id, "estado": "completada"}, {"items": 1}):
        for it in v.get("items") or []:
            if it.get("producto_id"):
                unidades[str(it["producto_id"])] += float(it.get("cantidad") or 0)

    top = sorted(unidades.items(), key=lambda kv: kv[1], reverse=True)[:limite]
    resultado = []
    for pid, cantidad in top:
        if not ObjectId.is_valid(pid):
            continue
        p = await db.productos.find_one({"_id": ObjectId(pid), "negocio_id": negocio_id, "activo": {"$ne": False}})
        if p:
            resultado.append({"id": pid, "nombre": p["nombre"], "precio": float(p.get("precio_base") or 0),
                              "unidades": round(cantidad, 2)})
    return resultado


# ──────────────────────────────────────────────────────────────────────────────
# Venta rápida
# ──────────────────────────────────────────────────────────────────────────────

class LineaVenta(BaseModel):
    producto_id: str
    cantidad: float = Field(gt=0)


class VentaRapidaIn(BaseModel):
    negocio_id: str
    tipo: Literal["cotizacion", "pedido", "mostrador"]
    items: list[LineaVenta] = Field(min_length=1)
    notas: str = ""
    cuenta_id: Optional[str] = None          # solo mostrador
    metodo_pago: Optional[METODOS] = None    # solo mostrador
    monto_recibido: Optional[float] = None   # solo mostrador, efectivo


@router.post("/clientes/{cliente_id}/venta", status_code=201)
async def venta_rapida(
    cliente_id: str,
    body: VentaRapidaIn,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    cliente = await cliente_accesible_o_403(db, cliente_id, user)

    # Agrupa líneas repetidas y toma nombre y precio del catálogo
    agrupadas: dict[str, float] = defaultdict(float)
    for linea in body.items:
        agrupadas[linea.producto_id] += linea.cantidad
    productos = await _productos_del_negocio(db, body.negocio_id, list(agrupadas))

    if body.tipo == "mostrador":
        if not body.cuenta_id or not body.metodo_pago:
            raise HTTPException(status_code=422, detail="La venta de mostrador necesita cuenta y método de pago")
        venta = await registrar_venta(
            VentaCreate(
                negocio_id=body.negocio_id,
                cuenta_id=body.cuenta_id,
                metodo_pago=body.metodo_pago,
                items=[ItemVenta(producto_id=pid, cantidad=int(cant)) for pid, cant in agrupadas.items()],
                monto_recibido=body.monto_recibido,
                cliente_id=str(cliente["_id"]),
                notas=body.notas,
            ),
            db,
            user,
        )
        return {"tipo": "mostrador", "id": venta["id"], "numero": venta["folio"], "total": venta["total"]}

    # Cotización y pedido: precios sin IVA del catálogo, IVA del producto
    items, subtotal, iva = [], 0.0, 0.0
    for pid, cant in agrupadas.items():
        p = productos[pid]
        precio = float(p.get("precio_base") or 0)
        importe = round(precio * cant, 2)
        tasa = float(p.get("iva_pct", 16) or 0) / 100 if p.get("iva_aplicable", True) else 0.0
        subtotal += importe
        iva += importe * tasa
        items.append({
            "producto_id": pid,
            "descripcion": p["nombre"],
            "cantidad": cant,
            "precio_unitario": precio,
            "descuento_item": 0,
            "iva_item": bool(tasa),
            "subtotal_item": importe,
            "importe": importe,
        })
    subtotal, iva = round(subtotal, 2), round(iva, 2)
    documento = {
        "negocio_id": body.negocio_id,
        "cliente_id": str(cliente["_id"]),
        "cliente_nombre": cliente.get("empresa", ""),
        "items": items,
        "subtotal": subtotal,
        "iva": iva,
        "total": round(subtotal + iva, 2),
        "notas": body.notas,
    }

    if body.tipo == "cotizacion":
        resultado = await crear_cotizacion(dict(documento), db, user)
        datos = resultado.get("data", resultado)
        return {"tipo": "cotizacion", "id": datos.get("id") or datos.get("_id"), "numero": datos.get("numero"), "total": documento["total"]}

    resultado = await crear_pedido(dict(documento), db, user)
    datos = resultado.get("data", resultado)
    return {"tipo": "pedido", "id": datos.get("id") or datos.get("_id"), "numero": datos.get("numero"), "total": documento["total"]}


# ──────────────────────────────────────────────────────────────────────────────
# Enviar lista de precios
# ──────────────────────────────────────────────────────────────────────────────

class EnviarListaIn(BaseModel):
    negocio_id: str
    lista_id: str
    canal: Literal["correo", "whatsapp"]


def _dinero(valor: float) -> str:
    return f"${valor:,.2f}"


def _texto_lista(nombre_lista: str, filas: list[dict], saludo: str) -> str:
    lineas = [f"{saludo}", "", f"Te comparto nuestra lista de precios: {nombre_lista}", ""]
    lineas += [f"- {f['nombre']}: {_dinero(f['precio'])}" for f in filas]
    lineas += ["", "Quedo a tus órdenes."]
    return "\n".join(lineas)


def _html_lista(nombre_lista: str, filas: list[dict], saludo: str) -> str:
    filas_html = "".join(
        f"<tr><td style='padding:6px 10px;border-bottom:1px solid #e2e8f0'>{f['nombre']}</td>"
        f"<td style='padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right'>{_dinero(f['precio'])}</td></tr>"
        for f in filas
    )
    return (
        f"<p>{saludo}</p>"
        f"<p>Te comparto nuestra lista de precios: <strong>{nombre_lista}</strong></p>"
        "<table style='border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;min-width:360px'>"
        "<thead><tr><th style='text-align:left;padding:6px 10px;background:#f8fafc'>Producto</th>"
        "<th style='text-align:right;padding:6px 10px;background:#f8fafc'>Precio</th></tr></thead>"
        f"<tbody>{filas_html}</tbody></table>"
        "<p>Quedo a tus órdenes.</p>"
    )


@router.post("/clientes/{cliente_id}/enviar-lista")
async def enviar_lista_precios(
    cliente_id: str,
    body: EnviarListaIn,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    from urllib.parse import quote

    from ..services.correo import CorreoError, correo_configurado, enviar_correo
    from .catalogo import precios_de_lista

    verificar_acceso(user, body.negocio_id)
    cliente = await cliente_accesible_o_403(db, cliente_id, user)
    detalle = await precios_de_lista(body.lista_id, body.negocio_id, db, user)
    lista, filas = detalle["lista"], detalle["data"]
    if not filas:
        raise HTTPException(status_code=422, detail="La lista no tiene precios que enviar")

    saludo = f"Hola {cliente.get('contacto') or cliente.get('empresa', '')}:"
    nombre_lista = lista["nombre"]

    if body.canal == "correo":
        if not cliente.get("correo"):
            raise HTTPException(status_code=422, detail="El cliente no tiene correo registrado")
        if not correo_configurado():
            raise HTTPException(status_code=503, detail="El correo no está configurado en el servidor; envía la lista por WhatsApp")
        try:
            await enviar_correo(
                destinatario=cliente["correo"],
                asunto=f"Lista de precios: {nombre_lista}",
                html=_html_lista(nombre_lista, filas, saludo),
                texto=_texto_lista(nombre_lista, filas, saludo),
            )
        except CorreoError as e:
            raise HTTPException(status_code=502, detail=str(e))
        return {"canal": "correo", "destinatario": cliente["correo"]}

    # WhatsApp: se abre un mensaje prearmado; lo envía el usuario desde su cuenta
    digitos = "".join(ch for ch in str(cliente.get("telefono") or "") if ch.isdigit())
    if not digitos:
        raise HTTPException(status_code=422, detail="El cliente no tiene teléfono registrado")
    if len(digitos) == 10:
        digitos = "52" + digitos
    texto = _texto_lista(nombre_lista, filas, saludo)
    return {"canal": "whatsapp", "url": f"https://wa.me/{digitos}?text={quote(texto)}"}
