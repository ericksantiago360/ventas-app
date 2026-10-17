from fastapi import APIRouter, Depends, HTTPException
from bson import ObjectId
from ..core.security import get_current_user
from ..core.database import get_db
from ..models.base import serialize_list

router = APIRouter()


def user_businesses(user: dict):
    negocios = user.get("negocios") or user.get("businesses") or []

    if isinstance(negocios, str):
        negocios = [negocios]

    return set(negocios)


def check_business(user: dict, negocio_id: str):
    if negocio_id not in user_businesses(user):
        raise HTTPException(
            status_code=403,
            detail="No tienes acceso a este negocio",
        )


async def obtener_doc(coleccion, id: str, user: dict, nombre: str) -> dict:
    try:
        oid = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=400, detail="ID inválido")

    doc = await coleccion.find_one({"_id": oid})

    if not doc:
        raise HTTPException(
            status_code=404,
            detail=f"{nombre} no encontrado"
        )

    check_business(user, doc.get("negocio_id"))
    return doc


# ============================================================
# CLIENTES
# ============================================================

@router.get("/clientes")
async def listar_clientes(
    negocio_id: str,
    q: str | None = None,
    activo: bool = True,
    page: int = 1,
    limit: int = 50,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_business(user, negocio_id)

    filtro = {
        "negocio_id": negocio_id,
        "activo": activo,
    }

    if q:
        filtro["$or"] = [
            {"nombre": {"$regex": q, "$options": "i"}},
            {"empresa": {"$regex": q, "$options": "i"}},
            {"telefono": {"$regex": q, "$options": "i"}},
            {"whatsapp": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
        ]

    page = max(page, 1)
    limit = min(max(limit, 1), 100)
    skip = (page - 1) * limit

    cursor = (
        db.clientes
        .find(filtro)
        .sort("nombre", 1)
        .skip(skip)
        .limit(limit)
    )

    docs = await cursor.to_list(length=limit)
    total = await db.clientes.count_documents(filtro)

    return {
        "data": serialize_list(docs),
        "total": total,
        "page": page,
        "limit": limit,
    }


@router.post("/clientes", status_code=201)
async def crear_cliente(
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    if not body.get("negocio_id"):
        raise HTTPException(
            status_code=400,
            detail="negocio_id es obligatorio"
        )

    check_business(user, body["negocio_id"])

    if not body.get("nombre"):
        raise HTTPException(
            status_code=400,
            detail="El nombre es obligatorio"
        )

    body["activo"] = True

    result = await db.clientes.insert_one(body)

    return {
        "id": str(result.inserted_id),
        "ok": True,
    }


@router.get("/clientes/{id}")
async def obtener_cliente(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    doc = await obtener_doc(db.clientes, id, user, "Cliente")

    return {
        "data": serialize_list([doc])[0]
    }


@router.put("/clientes/{id}")
async def editar_cliente(
    id: str,
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    doc = await obtener_doc(db.clientes, id, user, "Cliente")
    oid = doc["_id"]

    body.pop("_id", None)
    body.pop("negocio_id", None)

    result = await db.clientes.update_one(
        {"_id": oid},
        {"$set": body},
    )

    if result.matched_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Cliente no encontrado"
        )

    return {"ok": True}


@router.patch("/clientes/{id}/estado")
async def cambiar_estado_cliente(
    id: str,
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    doc = await obtener_doc(db.clientes, id, user, "Cliente")
    oid = doc["_id"]

    activo = bool(body.get("activo", True))

    result = await db.clientes.update_one(
        {"_id": oid},
        {"$set": {"activo": activo}},
    )

    if result.matched_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Cliente no encontrado"
        )

    return {"ok": True}


# ============================================================
# LEADS
# ============================================================

ETAPAS_LEAD = [
    "nuevo",
    "contactado",
    "calificado",
    "cotizacion",
    "ganado",
    "perdido",
]


@router.get("/leads")
async def listar_leads(
    negocio_id: str,
    etapa: str | None = None,
    q: str | None = None,
    page: int = 1,
    limit: int = 50,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_business(user, negocio_id)

    filtro = {
        "negocio_id": negocio_id,
    }

    if etapa:
        filtro["etapa"] = etapa

    if q:
        filtro["$or"] = [
            {"nombre": {"$regex": q, "$options": "i"}},
            {"empresa": {"$regex": q, "$options": "i"}},
            {"telefono": {"$regex": q, "$options": "i"}},
            {"whatsapp": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
        ]

    page = max(page, 1)
    limit = min(max(limit, 1), 100)
    skip = (page - 1) * limit

    cursor = (
        db.leads
        .find(filtro)
        .sort("_id", -1)
        .skip(skip)
        .limit(limit)
    )

    docs = await cursor.to_list(length=limit)
    total = await db.leads.count_documents(filtro)

    return {
        "data": serialize_list(docs),
        "total": total,
        "page": page,
        "limit": limit,
    }


@router.post("/leads", status_code=201)
async def crear_lead(
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    if not body.get("negocio_id"):
        raise HTTPException(
            status_code=400,
            detail="negocio_id es obligatorio"
        )

    check_business(user, body["negocio_id"])

    if not body.get("nombre"):
        raise HTTPException(
            status_code=400,
            detail="El nombre es obligatorio"
        )

    etapa = body.get("etapa", "nuevo")

    if etapa not in ETAPAS_LEAD:
        raise HTTPException(
            status_code=400,
            detail="Etapa inválida"
        )

    body["etapa"] = etapa

    result = await db.leads.insert_one(body)

    return {
        "id": str(result.inserted_id),
        "ok": True,
    }


@router.delete("/leads/{id}")
async def eliminar_lead(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    doc = await obtener_doc(db.leads, id, user, "Lead")
    oid = doc["_id"]

    result = await db.leads.delete_one({
        "_id": oid,
    })

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Lead no encontrado"
        )

    return {
        "ok": True,
        "message": "Lead eliminado correctamente",
        "id": id,
    }


@router.patch("/leads/{id}/etapa")
async def avanzar_etapa_lead(
    id: str,
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    doc = await obtener_doc(db.leads, id, user, "Lead")
    oid = doc["_id"]

    etapa = body.get("etapa")

    if etapa not in ETAPAS_LEAD:
        raise HTTPException(
            status_code=400,
            detail="Etapa inválida"
        )

    result = await db.leads.update_one(
        {"_id": oid},
        {"$set": {"etapa": etapa}},
    )

    if result.matched_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Lead no encontrado"
        )

    return {"ok": True}


@router.put("/leads/{id}")
async def editar_lead(
    id: str,
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    doc = await obtener_doc(db.leads, id, user, "Lead")
    oid = doc["_id"]

    body.pop("_id", None)
    body.pop("negocio_id", None)

    if "etapa" in body and body["etapa"] not in ETAPAS_LEAD:
        raise HTTPException(
            status_code=400,
            detail="Etapa inválida"
        )

    result = await db.leads.update_one(
        {"_id": oid},
        {"$set": body},
    )

    if result.matched_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Lead no encontrado"
        )

    return {"ok": True}
