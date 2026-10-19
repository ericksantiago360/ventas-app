from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import get_db
from app.core.negocios import negocio_autorizado, obtener_del_negocio, verificar_acceso
from app.core.security import get_current_user

from ..fechas import hoy
from ..models.operador import OperadorCreate, OperadorUpdate
from .vehiculos import DIAS_ALERTA

router = APIRouter(prefix="/carta-porte", tags=["Carta Porte - Operadores"])


def a_operador(doc: dict) -> dict:
    o = {k: v for k, v in doc.items() if k != "_id"}
    o["id"] = str(doc["_id"])
    o["dias_licencia"] = (date.fromisoformat(doc["fecha_vencimiento_licencia"]) - hoy()).days
    return o


@router.get("/operadores")
async def listar_operadores(
    negocio_id: str = Depends(negocio_autorizado),
    incluir_inactivos: bool = Query(False),
    db=Depends(get_db),
):
    filtro = {"negocio_id": negocio_id} if incluir_inactivos else {"negocio_id": negocio_id, "activo": True}
    return [a_operador(d) for d in await db.operadores.find(filtro).sort("nombre", 1).to_list(500)]


@router.get("/operadores/alertas")
async def alertas_operadores(
    negocio_id: str = Depends(negocio_autorizado),
    db=Depends(get_db),
):
    """Licencias vencidas o que vencen en los próximos 30 días."""
    ops = [a_operador(d) for d in await db.operadores.find({"negocio_id": negocio_id, "activo": True}).to_list(500)]
    return sorted(
        [{"operador_id": o["id"], "nombre": o["nombre"], "num_licencia": o["num_licencia"],
          "fecha_vencimiento": o["fecha_vencimiento_licencia"], "dias": o["dias_licencia"]}
         for o in ops if o["dias_licencia"] <= DIAS_ALERTA],
        key=lambda a: a["dias"],
    )


@router.post("/operadores", status_code=201)
async def crear_operador(
    body: OperadorCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    datos = body.model_dump(mode="json")
    now = datetime.now(timezone.utc)
    existente = await db.operadores.find_one({"negocio_id": body.negocio_id, "rfc": body.rfc})
    if existente and existente.get("activo", True):
        raise HTTPException(409, f"Ya hay un operador con el RFC {body.rfc}: {existente['nombre']}")
    if existente:
        doc = await db.operadores.find_one_and_update(
            {"_id": existente["_id"]}, {"$set": {**datos, "activo": True, "updated_at": now}}, return_document=True)
        return a_operador(doc)
    doc = {**datos, "activo": True, "created_at": now, "updated_at": now}
    doc["_id"] = (await db.operadores.insert_one(doc)).inserted_id
    return a_operador(doc)


@router.get("/operadores/{id}")
async def obtener_operador(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    return a_operador(await obtener_del_negocio(db.operadores, id, user, "Operador"))


@router.put("/operadores/{id}")
async def actualizar_operador(
    id: str,
    body: OperadorUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    o = await obtener_del_negocio(db.operadores, id, user, "Operador")
    otro = await db.operadores.find_one({"negocio_id": o["negocio_id"], "rfc": body.rfc, "_id": {"$ne": o["_id"]}})
    if otro:
        raise HTTPException(409, f"Ya hay un operador con el RFC {body.rfc}: {otro['nombre']}")
    doc = await db.operadores.find_one_and_update(
        {"_id": o["_id"]}, {"$set": {**body.model_dump(mode="json"), "updated_at": datetime.now(timezone.utc)}},
        return_document=True)
    return a_operador(doc)


@router.delete("/operadores/{id}")
async def baja_operador(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    o = await obtener_del_negocio(db.operadores, id, user, "Operador")
    en_uso = await db.cartas_porte.find_one({"operadores.operador_id": str(o["_id"]), "estado": {"$in": ["listo", "en_transito"]}})
    if en_uso:
        raise HTTPException(400, f"El operador está asignado a la carta porte {en_uso['folio']} ({en_uso['estado'].replace('_', ' ')})")
    await db.operadores.update_one({"_id": o["_id"]}, {"$set": {"activo": False, "updated_at": datetime.now(timezone.utc)}})
    return {"ok": True, "id": id}
