import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.config import settings
from app.core.database import get_db
from app.core.negocios import negocio_autorizado, obtener_del_negocio, verificar_acceso
from app.core.security import get_current_user

from ..models.farmacia import ArticuloCreate, ArticuloUpdate, Entrada, Salida

router = APIRouter(prefix="/clinica", tags=["Clínica"])

DIAS_ALERTA = 30
REINTENTOS = 5


# ── Utilidades ────────────────────────────────────────────────────────────────

def hoy() -> date:
    return datetime.now(ZoneInfo(settings.ZONA_HORARIA)).date()


def a_articulo(doc: dict, dia: date | None = None) -> dict:
    dia = dia or hoy()
    limite = (dia + timedelta(days=DIAS_ALERTA)).isoformat()
    lotes = sorted(doc.get("lotes", []), key=lambda l: l["fecha_caducidad"])
    articulo = {k: v for k, v in doc.items() if k not in ("_id", "version")}
    articulo.update({
        "id":                 str(doc["_id"]),
        "lotes":              lotes,
        "proxima_caducidad":  lotes[0]["fecha_caducidad"] if lotes else None,
        "stock_bajo":         doc.get("stock", 0) <= doc.get("stock_minimo", 0),
        "stock_caducado":     sum(l["cantidad"] for l in lotes if l["fecha_caducidad"] < dia.isoformat()),
        "por_caducar":        any(dia.isoformat() <= l["fecha_caducidad"] <= limite for l in lotes),
    })
    return articulo


async def guardar_lotes(db, articulo: dict, lotes: list[dict], extra: dict | None = None) -> dict | None:
    """Escribe los lotes solo si nadie cambió el artículo desde que se leyó; None = hay que reintentar."""
    lotes = [l for l in lotes if l["cantidad"] > 0]
    return await db.farmacia_inventario.find_one_and_update(
        {"_id": articulo["_id"], "version": articulo.get("version", 0)},
        {"$set": {
            "lotes": lotes, "stock": sum(l["cantidad"] for l in lotes),
            "version": articulo.get("version", 0) + 1, "updated_at": datetime.now(timezone.utc), **(extra or {}),
        }},
        return_document=True,
    )


async def registrar_movimiento(db, articulo: dict, tipo: str, cantidad: int, lotes: list[dict],
                               user: dict, motivo: str = "", receta: dict | None = None) -> dict:
    mov = {
        "negocio_id":      articulo["negocio_id"],
        "articulo_id":     str(articulo["_id"]),
        "articulo_nombre": articulo["nombre"],
        "tipo":            tipo,
        "cantidad":        cantidad,
        "lotes":           lotes,
        "receta_id":       str(receta["_id"]) if receta else "",
        "receta_folio":    receta["folio"] if receta else "",
        "motivo":          motivo.strip(),
        "usuario":         user.get("nombre", ""),
        "fecha":           datetime.now(timezone.utc),
    }
    mov["_id"] = (await db.farmacia_movimientos.insert_one(mov)).inserted_id
    return a_movimiento(mov)


def a_movimiento(doc: dict) -> dict:
    mov = {k: v for k, v in doc.items() if k != "_id"}
    mov["id"] = str(doc["_id"])
    if mov["fecha"].tzinfo is None:
        mov["fecha"] = mov["fecha"].replace(tzinfo=timezone.utc)
    return mov


async def obtener_articulo(db, id: str, user: dict) -> dict:
    return await obtener_del_negocio(db.farmacia_inventario, id, user, "Artículo")


# ── Alertas y caducidades ─────────────────────────────────────────────────────

@router.get("/farmacia/alertas")
async def alertas_farmacia(
    negocio_id: str = Depends(negocio_autorizado),
    db=Depends(get_db),
):
    """Stock en o bajo el mínimo, lotes que caducan en 30 días y lotes ya caducados con existencia."""
    dia = hoy()
    limite = (dia + timedelta(days=DIAS_ALERTA)).isoformat()
    base = {"negocio_id": negocio_id, "activo": True}
    stock_bajo = await db.farmacia_inventario.find(
        {**base, "$expr": {"$lte": ["$stock", "$stock_minimo"]}}
    ).sort("nombre", 1).to_list(500)
    con_lotes = await db.farmacia_inventario.find(
        {**base, "lotes": {"$elemMatch": {"cantidad": {"$gt": 0}, "fecha_caducidad": {"$lte": limite}}}}
    ).to_list(500)

    por_caducar, caducados = [], []
    for a in con_lotes:
        for l in a["lotes"]:
            if l["cantidad"] <= 0 or l["fecha_caducidad"] > limite:
                continue
            fila = {"articulo_id": str(a["_id"]), "nombre": a["nombre"], "presentacion": a.get("presentacion", ""),
                    **l, "dias": (date.fromisoformat(l["fecha_caducidad"]) - dia).days}
            (caducados if fila["dias"] < 0 else por_caducar).append(fila)

    return {
        "stock_bajo":  [{"articulo_id": str(a["_id"]), "nombre": a["nombre"], "presentacion": a.get("presentacion", ""),
                         "stock": a["stock"], "stock_minimo": a.get("stock_minimo", 0)} for a in stock_bajo],
        "por_caducar": sorted(por_caducar, key=lambda f: f["fecha_caducidad"]),
        "caducados":   sorted(caducados, key=lambda f: f["fecha_caducidad"]),
        "total":       len(stock_bajo) + len(por_caducar) + len(caducados),
    }


@router.get("/farmacia/caducidades")
async def caducidades(
    negocio_id: str = Depends(negocio_autorizado),
    dias: int = Query(90, ge=1, le=730),
    db=Depends(get_db),
):
    """Lotes con existencia que caducan en los próximos `dias` (y los ya caducados), agrupados por plazo."""
    dia = hoy()
    limite = (dia + timedelta(days=dias)).isoformat()
    articulos = await db.farmacia_inventario.find({
        "negocio_id": negocio_id, "activo": True,
        "lotes": {"$elemMatch": {"cantidad": {"$gt": 0}, "fecha_caducidad": {"$lte": limite}}},
    }).to_list(1000)

    lotes = []
    for a in articulos:
        for l in a["lotes"]:
            if l["cantidad"] <= 0 or l["fecha_caducidad"] > limite:
                continue
            restantes = (date.fromisoformat(l["fecha_caducidad"]) - dia).days
            plazo = "caducado" if restantes < 0 else "30" if restantes <= 30 else "60" if restantes <= 60 else "90" if restantes <= 90 else "mas"
            lotes.append({
                "articulo_id": str(a["_id"]), "nombre": a["nombre"], "presentacion": a.get("presentacion", ""),
                "ubicacion": a.get("ubicacion", ""), "precio_compra": a.get("precio_compra", 0),
                **l, "dias": restantes, "plazo": plazo,
            })
    lotes.sort(key=lambda l: l["fecha_caducidad"])
    return lotes


# ── Inventario ────────────────────────────────────────────────────────────────

@router.get("/farmacia")
async def listar_articulos(
    negocio_id: str = Depends(negocio_autorizado),
    q: str = Query(""),
    categoria: str = Query(""),
    solo_alertas: bool = Query(False),
    solo_activos: bool = Query(True),
    db=Depends(get_db),
):
    filtro: dict = {"negocio_id": negocio_id}
    if solo_activos:
        filtro["activo"] = True
    if categoria:
        filtro["categoria"] = categoria
    if q.strip():
        filtro["$and"] = [
            {"$or": [{c: {"$regex": re.escape(t), "$options": "i"}}
                     for c in ("nombre", "principio_activo", "presentacion", "ubicacion")]}
            for t in q.split()
        ]
    if solo_alertas:
        limite = (hoy() + timedelta(days=DIAS_ALERTA)).isoformat()
        filtro["$or"] = [
            {"$expr": {"$lte": ["$stock", "$stock_minimo"]}},
            {"lotes": {"$elemMatch": {"cantidad": {"$gt": 0}, "fecha_caducidad": {"$lte": limite}}}},
        ]
    dia = hoy()
    docs = await db.farmacia_inventario.find(filtro).sort("nombre", 1).to_list(2000)
    return [a_articulo(d, dia) for d in docs]


@router.post("/farmacia", status_code=201)
async def crear_articulo(
    body: ArticuloCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Alta sin existencia; el stock entra por lotes con /entrada."""
    verificar_acceso(user, body.negocio_id)
    now = datetime.now(timezone.utc)
    doc = {
        **body.model_dump(),
        "nombre":     body.nombre.strip(),
        "stock":      0,
        "lotes":      [],
        "activo":     True,
        "version":    0,
        "created_at": now,
        "updated_at": now,
    }
    doc["_id"] = (await db.farmacia_inventario.insert_one(doc)).inserted_id
    return a_articulo(doc)


@router.get("/farmacia/{id}")
async def obtener_articulo_detalle(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    return a_articulo(await obtener_articulo(db, id, user))


@router.put("/farmacia/{id}")
async def actualizar_articulo(
    id: str,
    body: ArticuloUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    articulo = await obtener_articulo(db, id, user)
    cambios = body.model_dump(exclude_none=True)
    if not cambios:
        raise HTTPException(400, "Sin campos a actualizar")
    doc = await db.farmacia_inventario.find_one_and_update(
        {"_id": articulo["_id"]},
        {"$set": {**cambios, "updated_at": datetime.now(timezone.utc)}},
        return_document=True,
    )
    return a_articulo(doc)


@router.delete("/farmacia/{id}")
async def baja_articulo(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Baja lógica: deja de aparecer en el inventario; sus movimientos se conservan."""
    articulo = await obtener_articulo(db, id, user)
    if articulo.get("stock", 0) > 0:
        raise HTTPException(400, "El artículo aún tiene existencia; da salida (merma) a sus lotes antes de darlo de baja")
    await db.farmacia_inventario.update_one(
        {"_id": articulo["_id"]}, {"$set": {"activo": False, "updated_at": datetime.now(timezone.utc)}}
    )
    return {"ok": True, "id": id}


# ── Movimientos ───────────────────────────────────────────────────────────────

@router.post("/farmacia/{id}/entrada", status_code=201)
async def registrar_entrada(
    id: str,
    body: Entrada,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    numero = body.numero_lote.strip()
    caducidad = body.fecha_caducidad.isoformat()
    for _ in range(REINTENTOS):
        articulo = await obtener_articulo(db, id, user)
        if not articulo.get("activo", True):
            raise HTTPException(400, "El artículo está dado de baja")
        lotes = [dict(l) for l in articulo.get("lotes", [])]
        existente = next((l for l in lotes if l["numero_lote"] == numero), None)
        if existente:
            if existente["fecha_caducidad"] != caducidad:
                raise HTTPException(400, f"El lote {numero} ya existe con caducidad {existente['fecha_caducidad']}")
            existente["cantidad"] += body.cantidad
            if body.proveedor.strip():
                existente["proveedor"] = body.proveedor.strip()
        else:
            lotes.append({"numero_lote": numero, "fecha_caducidad": caducidad,
                          "cantidad": body.cantidad, "proveedor": body.proveedor.strip()})
        extra = {"precio_compra": body.precio_compra} if body.precio_compra is not None else None
        doc = await guardar_lotes(db, articulo, lotes, extra)
        if doc:
            mov = await registrar_movimiento(db, doc, "entrada", body.cantidad,
                                             [{"numero_lote": numero, "cantidad": body.cantidad}], user, body.motivo)
            return {"articulo": a_articulo(doc), "movimiento": mov}
    raise HTTPException(409, "El artículo cambió mientras se registraba la entrada; intenta de nuevo")


@router.post("/farmacia/{id}/salida", status_code=201)
async def registrar_salida(
    id: str,
    body: Salida,
    merma: bool = Query(False, description="Baja por caducidad o daño: permite sacar lotes caducados"),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    receta = None
    for _ in range(REINTENTOS):
        articulo = await obtener_articulo(db, id, user)
        if body.receta_id and receta is None:
            if merma:
                raise HTTPException(400, "Una merma no se vincula a una receta")
            if ObjectId.is_valid(body.receta_id):
                receta = await db.recetas.find_one({"_id": ObjectId(body.receta_id), "negocio_id": articulo["negocio_id"]})
            if not receta:
                raise HTTPException(404, "Receta: no existe en este negocio")
            if receta["estado"] != "vigente":
                raise HTTPException(400, f"La receta {receta['folio']} está cancelada")

        dia = hoy()
        lotes = [dict(l) for l in articulo.get("lotes", [])]
        if body.numero_lote:
            elegidos = [l for l in lotes if l["numero_lote"] == body.numero_lote.strip()]
            if not elegidos:
                raise HTTPException(404, f"Lote {body.numero_lote}: no existe en este artículo")
            if elegidos[0]["fecha_caducidad"] < dia.isoformat() and not merma:
                raise HTTPException(400, f"El lote {body.numero_lote} caducó el {elegidos[0]['fecha_caducidad']}; solo puede salir como merma")
        else:
            # Primero el que caduca antes (FEFO); los caducados solo salen como merma
            elegidos = sorted(
                (l for l in lotes if l["cantidad"] > 0 and (merma or l["fecha_caducidad"] >= dia.isoformat())),
                key=lambda l: l["fecha_caducidad"],
            )

        disponible = sum(l["cantidad"] for l in elegidos)
        if disponible < body.cantidad:
            detalle = "en ese lote" if body.numero_lote else "vigente (sin caducar)"
            raise HTTPException(400, f"Solo hay {disponible} {detalle}; se pidieron {body.cantidad}")

        faltan, usados = body.cantidad, []
        for l in elegidos:
            toma = min(faltan, l["cantidad"])
            if toma:
                l["cantidad"] -= toma
                usados.append({"numero_lote": l["numero_lote"], "cantidad": toma})
                faltan -= toma
        doc = await guardar_lotes(db, articulo, lotes)
        if doc:
            motivo = body.motivo or ("Merma" if merma else f"Surtido de receta {receta['folio']}" if receta else "")
            mov = await registrar_movimiento(db, doc, "salida", body.cantidad, usados, user, motivo, receta)
            return {"articulo": a_articulo(doc), "movimiento": mov}
    raise HTTPException(409, "El artículo cambió mientras se registraba la salida; intenta de nuevo")


@router.get("/farmacia/{id}/movimientos")
async def listar_movimientos(
    id: str,
    limit: int = Query(100, ge=1, le=500),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    articulo = await obtener_articulo(db, id, user)
    docs = await db.farmacia_movimientos.find({"articulo_id": str(articulo["_id"])}).sort("fecha", -1).limit(limit).to_list(limit)
    return [a_movimiento(d) for d in docs]
