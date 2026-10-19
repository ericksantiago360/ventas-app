from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import get_db
from app.core.negocios import negocio_autorizado, obtener_del_negocio, verificar_acceso
from app.core.security import get_current_user

from ..fechas import hoy
from ..models.vehiculo import VehiculoCreate, VehiculoUpdate

router = APIRouter(prefix="/carta-porte", tags=["Carta Porte - Flota"])

DIAS_ALERTA = 30
SEGUROS = {"seguro_resp_civil": "Responsabilidad civil", "seguro_carga": "Carga", "seguro_medio_ambiente": "Medio ambiente"}


def a_vehiculo(doc: dict) -> dict:
    v = {k: val for k, val in doc.items() if k != "_id"}
    v["id"] = str(doc["_id"])
    return v


def vencimientos(v: dict, dia: date) -> list[dict]:
    """Seguros vencidos o que vencen en los próximos 30 días."""
    avisos = []
    for campo, nombre in SEGUROS.items():
        seguro = v.get(campo)
        if seguro and seguro.get("fecha_vencimiento"):
            dias = (date.fromisoformat(seguro["fecha_vencimiento"]) - dia).days
            if dias <= DIAS_ALERTA:
                avisos.append({"seguro": nombre, "fecha_vencimiento": seguro["fecha_vencimiento"], "dias": dias,
                               "aseguradora": seguro.get("aseguradora", ""), "num_poliza": seguro.get("num_poliza", "")})
    return avisos


@router.get("/vehiculos")
async def listar_vehiculos(
    negocio_id: str = Depends(negocio_autorizado),
    incluir_inactivos: bool = Query(False),
    db=Depends(get_db),
):
    filtro = {"negocio_id": negocio_id} if incluir_inactivos else {"negocio_id": negocio_id, "activo": True}
    docs = await db.vehiculos.find(filtro).sort("nombre", 1).to_list(500)
    dia = hoy()
    return [{**a_vehiculo(d), "alertas": vencimientos(d, dia)} for d in docs]


@router.get("/vehiculos/alertas")
async def alertas_vehiculos(
    negocio_id: str = Depends(negocio_autorizado),
    db=Depends(get_db),
):
    dia = hoy()
    resultado = []
    async for v in db.vehiculos.find({"negocio_id": negocio_id, "activo": True}):
        for aviso in vencimientos(v, dia):
            resultado.append({"vehiculo_id": str(v["_id"]), "nombre": v["nombre"], "placa": v["placa"], **aviso})
    return sorted(resultado, key=lambda a: a["dias"])


@router.post("/vehiculos", status_code=201)
async def crear_vehiculo(
    body: VehiculoCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    datos = body.model_dump(mode="json")
    now = datetime.now(timezone.utc)
    existente = await db.vehiculos.find_one({"negocio_id": body.negocio_id, "placa": body.placa})
    if existente and existente.get("activo", True):
        raise HTTPException(409, f"Ya hay un vehículo con la placa {body.placa}: {existente['nombre']}")
    if existente:
        # Dado de baja antes: se reactiva con los datos nuevos
        doc = await db.vehiculos.find_one_and_update(
            {"_id": existente["_id"]}, {"$set": {**datos, "activo": True, "updated_at": now}}, return_document=True)
        return a_vehiculo(doc)
    doc = {**datos, "activo": True, "created_at": now, "updated_at": now}
    doc["_id"] = (await db.vehiculos.insert_one(doc)).inserted_id
    return a_vehiculo(doc)


@router.get("/vehiculos/{id}")
async def obtener_vehiculo(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    v = await obtener_del_negocio(db.vehiculos, id, user, "Vehículo")
    return {**a_vehiculo(v), "alertas": vencimientos(v, hoy())}


@router.put("/vehiculos/{id}")
async def actualizar_vehiculo(
    id: str,
    body: VehiculoUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Las cartas porte ya creadas conservan los datos con que se hicieron (snapshot)."""
    v = await obtener_del_negocio(db.vehiculos, id, user, "Vehículo")
    datos = body.model_dump(mode="json")
    otro = await db.vehiculos.find_one({"negocio_id": v["negocio_id"], "placa": body.placa, "_id": {"$ne": v["_id"]}})
    if otro:
        raise HTTPException(409, f"Ya hay un vehículo con la placa {body.placa}: {otro['nombre']}")
    doc = await db.vehiculos.find_one_and_update(
        {"_id": v["_id"]}, {"$set": {**datos, "updated_at": datetime.now(timezone.utc)}}, return_document=True)
    return a_vehiculo(doc)


@router.delete("/vehiculos/{id}")
async def baja_vehiculo(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    v = await obtener_del_negocio(db.vehiculos, id, user, "Vehículo")
    en_uso = await db.cartas_porte.find_one({"vehiculo_id": str(v["_id"]), "estado": {"$in": ["listo", "en_transito"]}})
    if en_uso:
        raise HTTPException(400, f"El vehículo está asignado a la carta porte {en_uso['folio']} ({en_uso['estado'].replace('_', ' ')})")
    await db.vehiculos.update_one({"_id": v["_id"]}, {"$set": {"activo": False, "updated_at": datetime.now(timezone.utc)}})
    return {"ok": True, "id": id}
