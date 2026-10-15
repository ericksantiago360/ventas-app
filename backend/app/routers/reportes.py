import asyncio
from datetime import datetime, timezone, date

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import get_db
from app.core.security import get_current_user


router = APIRouter(prefix="/reportes", tags=["Reportes"])

MESES_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun",
             "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

ESTADOS = ["confirmado", "en_proceso", "listo", "entregado", "cobrado", "cancelado"]


def user_businesses(user: dict) -> list[str]:
    return list(user.get("negocios") or user.get("businesses") or [])


def check_negocio(user: dict, negocio_id: str):
    if negocio_id not in user_businesses(user):
        raise HTTPException(403, "Sin acceso a este negocio")


def rango_mes(mes: str):
    """Returns (inicio_dt, fin_dt, inicio_str, fin_str) for a YYYY-MM string.
    pedidos.created_at is stored as ISO string; other collections use proper datetimes.
    """
    year, month = map(int, mes.split("-"))
    inicio_dt = datetime(year, month, 1, tzinfo=timezone.utc)
    if month == 12:
        fin_dt = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
        fin_str_prefix = f"{year + 1}-01-01"
    else:
        fin_dt = datetime(year, month + 1, 1, tzinfo=timezone.utc)
        fin_str_prefix = f"{year}-{month + 1:02d}-01"
    inicio_str_prefix = f"{year}-{month:02d}-01"
    return inicio_dt, fin_dt, inicio_str_prefix, fin_str_prefix


# ──────────────────────────────────────────────────────────────────────────────
# RESUMEN
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/resumen")
async def resumen(
    negocio_id: str = Query(...),
    mes: str = Query(..., description="YYYY-MM"),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_negocio(user, negocio_id)
    inicio_dt, fin_dt, inicio_str, fin_str = rango_mes(mes)

    # pedidos.created_at is stored as ISO string — use string comparison
    filtro_mes = {
        "negocio_id": negocio_id,
        "created_at": {"$gte": inicio_str, "$lt": fin_str},
    }
    filtro_mes_activos = {**filtro_mes, "estado": {"$ne": "cancelado"}}

    # ── Paralelo ──────────────────────────────────────────────────────────────
    (
        pedidos_mes,
        top_productos_raw,
        top_clientes_raw,
        movimientos_mes,
        clientes_nuevos,
        saldo_docs,
        alertas_inv,
    ) = await asyncio.gather(
        db.pedidos.find(filtro_mes).to_list(2000),

        db.pedidos.aggregate([
            {"$match": filtro_mes_activos},
            {"$unwind": "$items"},
            {"$group": {
                "_id": "$items.nombre",
                "cantidad": {"$sum": "$items.cantidad"},
                "importe": {"$sum": {"$multiply": ["$items.cantidad", "$items.precio_unitario"]}},
            }},
            {"$sort": {"importe": -1}},
            {"$limit": 8},
        ]).to_list(8),

        db.pedidos.aggregate([
            {"$match": filtro_mes_activos},
            {"$group": {
                "_id": "$cliente_nombre",
                "pedidos": {"$sum": 1},
                "total": {"$sum": "$total"},
            }},
            {"$sort": {"total": -1}},
            {"$limit": 8},
        ]).to_list(8),

        db.movimientos_financieros.find({
            "negocio_id": negocio_id,
            "fecha": {"$gte": inicio_dt, "$lt": fin_dt},
        }).to_list(2000),

        db.clientes.count_documents({
            "negocio_id": negocio_id,
            "created_at": {"$gte": inicio_dt, "$lt": fin_dt},
        }),

        db.pedidos.find({
            "negocio_id": negocio_id,
            "estado": {"$nin": ["cobrado", "cancelado"]},
        }, {"saldo_pendiente": 1}).to_list(2000),

        db.inventario.count_documents({
            "negocio_id": negocio_id,
            "activo": {"$ne": False},
            "$expr": {"$lte": ["$stock_actual", "$stock_minimo"]},
        }),
    )

    # ── Totales de pedidos ────────────────────────────────────────────────────
    estados_count = {e: 0 for e in ESTADOS}
    ventas_total = 0.0
    cobrado_mes = 0.0

    for p in pedidos_mes:
        estado = p.get("estado", "confirmado")
        if estado in estados_count:
            estados_count[estado] += 1
        if estado != "cancelado":
            ventas_total += float(p.get("total") or 0)
        if estado == "cobrado":
            cobrado_mes += float(p.get("total") or 0)

    saldo_pendiente_total = sum(float(d.get("saldo_pendiente") or 0) for d in saldo_docs)

    # ── Finanzas ──────────────────────────────────────────────────────────────
    ingresos_mes = sum(
        float(m.get("importe") or 0)
        for m in movimientos_mes if m.get("tipo") == "ingreso"
    )
    egresos_mes = sum(
        float(m.get("importe") or 0)
        for m in movimientos_mes if m.get("tipo") == "egreso"
    )

    return {
        "mes": mes,
        "negocio_id": negocio_id,
        "pedidos_total": len(pedidos_mes),
        "ventas_total": round(ventas_total, 2),
        "cobrado_mes": round(cobrado_mes, 2),
        "saldo_pendiente_total": round(saldo_pendiente_total, 2),
        "pedidos_por_estado": estados_count,
        "top_productos": [
            {
                "nombre": r["_id"] or "Sin nombre",
                "cantidad": round(float(r.get("cantidad") or 0), 2),
                "importe": round(float(r.get("importe") or 0), 2),
            }
            for r in top_productos_raw
        ],
        "top_clientes": [
            {
                "nombre": r["_id"] or "Sin nombre",
                "pedidos": int(r.get("pedidos") or 0),
                "total": round(float(r.get("total") or 0), 2),
            }
            for r in top_clientes_raw
        ],
        "ingresos_mes": round(ingresos_mes, 2),
        "egresos_mes": round(egresos_mes, 2),
        "clientes_nuevos": clientes_nuevos,
        "alertas_inventario": alertas_inv,
    }


# ──────────────────────────────────────────────────────────────────────────────
# EVOLUCIÓN
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/evolucion")
async def evolucion(
    negocio_id: str = Query(...),
    meses: int = Query(6, ge=2, le=12),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_negocio(user, negocio_id)

    hoy = date.today()
    rangos = []
    for i in range(meses - 1, -1, -1):
        mes_offset = hoy.month - i
        year_val = hoy.year + (mes_offset - 1) // 12
        month_val = ((mes_offset - 1) % 12) + 1
        label = f"{MESES_ES[month_val - 1]} {str(year_val)[2:]}"
        mes_str = f"{year_val}-{month_val:02d}"
        _idt, _fdt, inicio_s, fin_s = rango_mes(mes_str)
        rangos.append((mes_str, label, inicio_s, fin_s))

    async def stats_mes(inicio_str, fin_str):
        docs = await db.pedidos.find(
            {
                "negocio_id": negocio_id,
                "created_at": {"$gte": inicio_str, "$lt": fin_str},
                "estado": {"$ne": "cancelado"},
            },
            {"total": 1, "estado": 1},
        ).to_list(2000)
        ventas = sum(float(d.get("total") or 0) for d in docs)
        cobrado = sum(float(d.get("total") or 0) for d in docs if d.get("estado") == "cobrado")
        return len(docs), round(ventas, 2), round(cobrado, 2)

    resultados = await asyncio.gather(*[stats_mes(r[2], r[3]) for r in rangos])

    return [
        {
            "mes": rangos[i][0],
            "label": rangos[i][1],
            "pedidos": resultados[i][0],
            "ventas": resultados[i][1],
            "cobrado": resultados[i][2],
        }
        for i in range(len(rangos))
    ]
