import re
from datetime import date, datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Response

from ..core.database import get_db
from ..core.negocios import (
    negocio_autorizado,
    negocios_del_usuario,
    obtener_del_negocio,
    verificar_acceso,
)
from ..core.security import get_current_user
from ..models.base import serialize_doc, serialize_list
from ..models.crm import TipoLead
from ..schemas.crm import (
    ClienteCreate,
    ClienteEstado,
    ClienteUpdate,
    EtapaUpdate,
    InteraccionCreate,
    OportunidadCreate,
    OportunidadUpdate,
)

router = APIRouter()

# Bienes Raíces: propietario tiene su pipeline; comprador y arrendatario comparten uno
CAMPO_PIPELINE_BR = {
    "propietario": "pipeline_crm_propietario",
    "comprador": "pipeline_crm_comprador",
    "arrendatario": "pipeline_crm_comprador",
}
TIPOS_LEAD_VISTA_BR = {
    "propietario": ["propietario"],
    "comprador": ["comprador", "arrendatario"],
    "arrendatario": ["comprador", "arrendatario"],
}


# ============================================================
# HELPERS
# ============================================================

def ahora() -> datetime:
    return datetime.now(timezone.utc)


def oid(valor: str) -> ObjectId:
    if not ObjectId.is_valid(str(valor)):
        raise HTTPException(status_code=400, detail="ID inválido")
    return ObjectId(valor)


def a_datetime(valor):
    # BSON no guarda datetime.date; las fechas de cierre se guardan a medianoche
    if isinstance(valor, date) and not isinstance(valor, datetime):
        return datetime.combine(valor, datetime.min.time())
    return valor


async def config_crm(db, negocio_id: str, tipo_lead: str | None) -> tuple[list[str], set[str]]:
    """Pipeline (en orden) y etapas terminales del negocio según config_negocios."""
    config = await db.config_negocios.find_one(
        {"_id": negocio_id},
        {"pipeline_crm": 1, "pipeline_crm_propietario": 1, "pipeline_crm_comprador": 1, "etapas_terminales": 1},
    ) or {}

    if negocio_id == "bienes_raices":
        if tipo_lead not in CAMPO_PIPELINE_BR:
            raise HTTPException(
                status_code=400,
                detail="Bienes Raíces requiere tipo_lead: propietario | comprador | arrendatario",
            )
        pipeline = config.get(CAMPO_PIPELINE_BR[tipo_lead]) or []
    else:
        pipeline = config.get("pipeline_crm") or []

    if not pipeline:
        raise HTTPException(status_code=400, detail=f"El negocio {negocio_id} no tiene pipeline CRM configurado")

    return pipeline, set(config.get("etapas_terminales") or [])


async def cliente_o_404(db, id: str) -> dict:
    doc = await db.clientes.find_one({"_id": oid(id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return doc


async def buscar_duplicado(db, empresa: str, telefono: str) -> dict | None:
    # Unicidad lógica (spec §3.1): empresa + telefono; no se enforce en BD
    return await db.clientes.find_one({
        "empresa": {"$regex": f"^{re.escape(empresa)}$", "$options": "i"},
        "telefono": telefono,
        "activo": True,
    })


async def clientes_con_actividad(db, negocio_ids: list[str]) -> list[ObjectId]:
    """Clientes con al menos una oportunidad, cotización o pedido en esos negocios."""
    ids: set[str] = set()
    for coleccion in (db.oportunidades, db.cotizaciones, db.pedidos):
        # cliente_id puede estar guardado como texto o como ObjectId (datos anteriores)
        ids |= {str(v) for v in await coleccion.distinct("cliente_id", {"negocio_id": {"$in": negocio_ids}}) if v}
    return [ObjectId(v) for v in ids if ObjectId.is_valid(v)]


async def tiene_actividad(db, cliente_id: ObjectId, negocio_ids: list[str]) -> bool:
    filtro = {"cliente_id": {"$in": [cliente_id, str(cliente_id)]}, "negocio_id": {"$in": negocio_ids}}
    for coleccion in (db.oportunidades, db.cotizaciones, db.pedidos):
        if await coleccion.find_one(filtro, {"_id": 1}):
            return True
    return False


async def cliente_accesible(db, cliente: dict, user) -> bool:
    """El creador siempre ve su cliente; los demás, solo si tiene actividad en sus negocios."""
    if cliente.get("creado_por") == user["_id"]:
        return True
    return await tiene_actividad(db, cliente["_id"], list(negocios_del_usuario(user)))


async def cliente_accesible_o_403(db, id: str, user) -> dict:
    cliente = await cliente_o_404(db, id)
    if not await cliente_accesible(db, cliente, user):
        raise HTTPException(status_code=403, detail="No tienes acceso a este cliente")
    return cliente


# ============================================================
# CLIENTES
# ============================================================

@router.get("/clientes")
async def listar_clientes(
    q: str | None = None,
    tags: list[str] = Query(default=[]),
    activo: bool = True,
    page: int = 1,
    limit: int = 50,
    negocio_id: str | None = None,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    # Clientes unificados (SPEC §9): no tienen negocio. Se listan los que tienen
    # actividad en los negocios del usuario, o en el ?negocio_id= si se pide uno.
    if negocio_id:
        verificar_acceso(user, negocio_id)
    negocios = [negocio_id] if negocio_id else sorted(negocios_del_usuario(user))

    filtro = {"activo": activo, "_id": {"$in": await clientes_con_actividad(db, negocios)}}

    if q:
        filtro["$or"] = [
            {"empresa": {"$regex": q, "$options": "i"}},
            {"contacto": {"$regex": q, "$options": "i"}},
            {"telefono": {"$regex": q, "$options": "i"}},
            {"correo": {"$regex": q, "$options": "i"}},
        ]
    if tags:
        filtro["tags"] = {"$in": tags}

    page = max(page, 1)
    limit = min(max(limit, 1), 100)
    skip = (page - 1) * limit

    docs = await db.clientes.find(filtro).sort("empresa", 1).skip(skip).limit(limit).to_list(length=limit)
    total = await db.clientes.count_documents(filtro)

    return {"data": serialize_list(docs), "total": total, "page": page, "limit": limit}


@router.post("/clientes", status_code=201)
async def crear_cliente(
    body: ClienteCreate,
    response: Response,
    forzar: bool = False,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    if not forzar:
        existente = await buscar_duplicado(db, body.empresa, body.telefono)
        if existente:
            # Spec §7: HTTP 200 + duplicate_warning, no se crea; forzar=true crea de todos modos
            response.status_code = 200
            # Sin acceso al duplicado no se revelan sus datos
            if not await cliente_accesible(db, existente, user):
                return {"duplicate_warning": True}
            return {
                "duplicate_warning": True,
                "mensaje": "Ya existe un cliente con esta empresa y teléfono. Considera vincularlo.",
                "cliente_existente": serialize_doc(existente),
            }

    marca = ahora()
    doc = {
        **body.model_dump(),
        "creado_por": user["_id"],
        "activo": True,
        "created_at": marca,
        "updated_at": marca,
    }
    resultado = await db.clientes.insert_one(doc)
    doc["_id"] = resultado.inserted_id

    return {"data": serialize_doc(doc)}


@router.get("/clientes/{id}")
async def obtener_cliente(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    cliente = await cliente_accesible_o_403(db, id, user)

    # Todas las oportunidades (abiertas y cerradas), solo de los negocios del usuario
    ops = await (
        db.oportunidades
        .find({"cliente_id": cliente["_id"], "negocio_id": {"$in": list(negocios_del_usuario(user))}})
        .sort("created_at", -1)
        .to_list(500)
    )

    por_negocio: dict[str, list] = {}
    for op in ops:
        op = serialize_doc(op)
        op["estado"] = "abierta" if op["activo"] else "cerrada"
        por_negocio.setdefault(op["negocio_id"], []).append(op)

    return {"data": {**serialize_doc(cliente), "oportunidades": por_negocio}}


@router.put("/clientes/{id}")
async def editar_cliente(
    id: str,
    body: ClienteUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    cliente = await cliente_accesible_o_403(db, id, user)
    cambios = body.model_dump(exclude_unset=True)
    cambios["updated_at"] = ahora()

    await db.clientes.update_one({"_id": cliente["_id"]}, {"$set": cambios})

    return {"data": serialize_doc(await db.clientes.find_one({"_id": cliente["_id"]}))}


@router.delete("/clientes/{id}")
async def eliminar_cliente(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    cliente = await cliente_accesible_o_403(db, id, user)
    await db.clientes.update_one(
        {"_id": cliente["_id"]},
        {"$set": {"activo": False, "updated_at": ahora()}},
    )
    return {"ok": True}


@router.patch("/clientes/{id}/estado")
async def cambiar_estado_cliente(
    id: str,
    body: ClienteEstado,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    cliente = await cliente_accesible_o_403(db, id, user)
    await db.clientes.update_one(
        {"_id": cliente["_id"]},
        {"$set": {"activo": body.activo, "updated_at": ahora()}},
    )
    return {"data": serialize_doc(await db.clientes.find_one({"_id": cliente["_id"]}))}


@router.get("/clientes/{id}/timeline")
async def timeline_cliente(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    cliente = await cliente_accesible_o_403(db, id, user)
    docs = await (
        db.interacciones
        .find({"cliente_id": cliente["_id"], "negocio_id": {"$in": list(negocios_del_usuario(user))}})
        .sort("fecha", -1)
        .to_list(500)
    )
    return {"data": serialize_list(docs)}


# ============================================================
# OPORTUNIDADES
# ============================================================

@router.get("/oportunidades")
async def listar_oportunidades(
    negocio_id: str = Depends(negocio_autorizado),
    etapa: str | None = None,
    activo: bool = True,
    page: int = 1,
    limit: int = 50,
    db=Depends(get_db),
):
    filtro = {"negocio_id": negocio_id, "activo": activo}
    if etapa:
        filtro["etapa"] = etapa

    page = max(page, 1)
    limit = min(max(limit, 1), 100)
    skip = (page - 1) * limit

    docs = await db.oportunidades.find(filtro).sort("updated_at", -1).skip(skip).limit(limit).to_list(length=limit)
    total = await db.oportunidades.count_documents(filtro)

    return {"data": serialize_list(docs), "total": total, "page": page, "limit": limit}


@router.post("/oportunidades", status_code=201)
async def crear_oportunidad(
    body: OportunidadCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    await cliente_o_404(db, body.cliente_id)

    pipeline, terminales = await config_crm(db, body.negocio_id, body.tipo_lead)
    if body.etapa not in pipeline:
        raise HTTPException(status_code=400, detail=f"La etapa '{body.etapa}' no existe en el pipeline de {body.negocio_id}")

    marca = ahora()
    doc = {
        "cliente_id": oid(body.cliente_id),
        "negocio_id": body.negocio_id,
        "etapa": body.etapa,
        "tipo_lead": body.tipo_lead,
        "valor_estimado": body.valor_estimado,
        "fecha_cierre_estimada": a_datetime(body.fecha_cierre_estimada),
        "activo": body.etapa not in terminales,
        "created_at": marca,
        "updated_at": marca,
    }
    resultado = await db.oportunidades.insert_one(doc)
    doc["_id"] = resultado.inserted_id

    return {"data": serialize_doc(doc)}


@router.get("/oportunidades/{id}")
async def obtener_oportunidad(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    doc = await obtener_del_negocio(db.oportunidades, id, user, "Oportunidad")
    return {"data": serialize_doc(doc)}


@router.put("/oportunidades/{id}")
async def editar_oportunidad(
    id: str,
    body: OportunidadUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    doc = await obtener_del_negocio(db.oportunidades, id, user, "Oportunidad")
    cambios = body.model_dump(exclude_unset=True)
    if "fecha_cierre_estimada" in cambios:
        cambios["fecha_cierre_estimada"] = a_datetime(cambios["fecha_cierre_estimada"])
    cambios["updated_at"] = ahora()

    await db.oportunidades.update_one({"_id": doc["_id"]}, {"$set": cambios})

    return {"data": serialize_doc(await db.oportunidades.find_one({"_id": doc["_id"]}))}


@router.put("/oportunidades/{id}/etapa")
async def mover_etapa(
    id: str,
    body: EtapaUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    op = await obtener_del_negocio(db.oportunidades, id, user, "Oportunidad")

    if not op.get("activo"):
        raise HTTPException(status_code=400, detail="La oportunidad está cerrada; no se puede mover de etapa")
    if op["etapa"] == body.etapa:
        raise HTTPException(status_code=400, detail="La oportunidad ya está en esa etapa")

    pipeline, terminales = await config_crm(db, op["negocio_id"], op.get("tipo_lead"))
    # Solo se valida el destino: la etapa de origen puede haber sido eliminada de config (spec §7)
    if body.etapa not in pipeline:
        raise HTTPException(status_code=400, detail=f"La etapa '{body.etapa}' no existe en el pipeline de {op['negocio_id']}")

    anterior = op["etapa"]
    marca = ahora()

    await db.oportunidades.update_one(
        {"_id": op["_id"]},
        {"$set": {
            "etapa": body.etapa,
            "activo": body.etapa not in terminales,
            "updated_at": marca,
        }},
    )
    # Spec §6 #1: el cambio de etapa queda registrado en el historial del cliente
    await db.interacciones.insert_one({
        "cliente_id": op["cliente_id"],
        "oportunidad_id": op["_id"],
        "negocio_id": op["negocio_id"],
        "tipo": "cambio_etapa",
        "descripcion": f"{anterior} → {body.etapa}",
        "fecha": marca,
        "creado_por": user["_id"],
    })

    return {"data": serialize_doc(await db.oportunidades.find_one({"_id": op["_id"]}))}


@router.delete("/oportunidades/{id}")
async def eliminar_oportunidad(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    doc = await obtener_del_negocio(db.oportunidades, id, user, "Oportunidad")
    await db.oportunidades.update_one(
        {"_id": doc["_id"]},
        {"$set": {"activo": False, "updated_at": ahora()}},
    )
    return {"ok": True}


# ============================================================
# INTERACCIONES
# ============================================================

@router.post("/interacciones", status_code=201)
async def registrar_interaccion(
    body: InteraccionCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    cliente = await cliente_o_404(db, body.cliente_id)

    if body.oportunidad_id:
        op = await db.oportunidades.find_one({"_id": oid(body.oportunidad_id)})
        if not op or op["cliente_id"] != cliente["_id"] or op["negocio_id"] != body.negocio_id:
            raise HTTPException(status_code=400, detail="La oportunidad no pertenece a ese cliente y negocio")

    doc = {
        "cliente_id": cliente["_id"],
        "oportunidad_id": oid(body.oportunidad_id) if body.oportunidad_id else None,
        "negocio_id": body.negocio_id,
        "tipo": body.tipo,
        "descripcion": body.descripcion,
        "fecha": body.fecha or ahora(),
        "creado_por": user["_id"],
    }
    resultado = await db.interacciones.insert_one(doc)
    doc["_id"] = resultado.inserted_id

    return {"data": serialize_doc(doc)}


# ============================================================
# KANBAN
# ============================================================

@router.get("/kanban/{negocio_id}")
async def kanban(
    negocio_id: str,
    tipo_lead: TipoLead | None = None,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)

    pipeline, _ = await config_crm(db, negocio_id, tipo_lead if negocio_id == "bienes_raices" else None)

    # Kanban solo muestra abiertas (spec: terminales no aparecen)
    filtro = {"negocio_id": negocio_id, "activo": True}
    if negocio_id == "bienes_raices":
        filtro["tipo_lead"] = {"$in": TIPOS_LEAD_VISTA_BR[tipo_lead]}

    docs = await db.oportunidades.find(filtro).sort("updated_at", -1).to_list(1000)

    # Columnas en el orden del pipeline; etapas eliminadas de config van al final para no perderlas
    columnas: dict[str, list] = {etapa: [] for etapa in pipeline}
    for doc in docs:
        columnas.setdefault(doc["etapa"], []).append(serialize_doc(doc))

    return {"data": [{"etapa": etapa, "oportunidades": ops} for etapa, ops in columnas.items()]}
