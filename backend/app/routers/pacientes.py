from datetime import datetime, timezone, date
from typing import Optional, Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.negocios import verificar_acceso
from app.services.correo import CorreoError
from app.services.notificaciones_lab import enlace_portal, enviar_acceso_portal, url_publica

router = APIRouter(prefix="/pacientes", tags=["Pacientes"])

TIPOS_SANGRE = Literal["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "desconocido"]
SEXOS = Literal["masculino", "femenino", "otro"]


# ── Utilidades ────────────────────────────────────────────────────────────────

def serializar(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    return doc


def validar_oid(id: str) -> ObjectId:
    try:
        return ObjectId(id)
    except Exception:
        raise HTTPException(status_code=400, detail="ID inválido")


def calcular_edad(fecha_nacimiento: str) -> int:
    if not fecha_nacimiento:
        return 0
    try:
        nacimiento = date.fromisoformat(fecha_nacimiento)
        hoy = date.today()
        return hoy.year - nacimiento.year - (
            (hoy.month, hoy.day) < (nacimiento.month, nacimiento.day)
        )
    except Exception:
        return 0


async def siguiente_folio(db, negocio_id: str) -> str:
    counter = await db.counters.find_one_and_update(
        {"_id": f"pacientes_{negocio_id}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    return f"PAC-{str(counter['seq']).zfill(5)}"


# ── Pydantic models ───────────────────────────────────────────────────────────

class PacienteCreate(BaseModel):
    negocio_id: str
    nombre: str
    apellido_paterno: str = ""
    apellido_materno: str = ""
    fecha_nacimiento: str = ""          # YYYY-MM-DD
    sexo: SEXOS = "masculino"
    tipo_sangre: TIPOS_SANGRE = "desconocido"
    curp: str = ""
    email: str = ""
    telefono: str = ""
    telefono_emergencia: str = ""
    medico_tratante: str = ""           # nombre libre del médico referente
    medico_cedula: str = ""
    alergias: str = ""
    notas: str = ""


class PacienteUpdate(BaseModel):
    nombre: Optional[str] = None
    apellido_paterno: Optional[str] = None
    apellido_materno: Optional[str] = None
    fecha_nacimiento: Optional[str] = None
    sexo: Optional[SEXOS] = None
    tipo_sangre: Optional[TIPOS_SANGRE] = None
    curp: Optional[str] = None
    email: Optional[str] = None
    telefono: Optional[str] = None
    telefono_emergencia: Optional[str] = None
    medico_tratante: Optional[str] = None
    medico_cedula: Optional[str] = None
    alergias: Optional[str] = None
    notas: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/pacientes")
async def listar_pacientes(
    negocio_id: str = Query(...),
    busqueda: str = Query(""),
    solo_activos: bool = Query(True),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, le=500),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    filtro: dict = {"negocio_id": negocio_id}
    if solo_activos:
        filtro["activo"] = True
    if busqueda.strip():
        filtro["$or"] = [
            {"nombre":           {"$regex": busqueda.strip(), "$options": "i"}},
            {"apellido_paterno": {"$regex": busqueda.strip(), "$options": "i"}},
            {"apellido_materno": {"$regex": busqueda.strip(), "$options": "i"}},
            {"folio":            {"$regex": busqueda.strip(), "$options": "i"}},
            {"curp":             {"$regex": busqueda.strip(), "$options": "i"}},
            {"medico_tratante":  {"$regex": busqueda.strip(), "$options": "i"}},
        ]
    items = (
        await db.pacientes.find(filtro)
        .sort([("apellido_paterno", 1), ("nombre", 1)])
        .skip(skip)
        .limit(limit)
        .to_list(limit)
    )
    result = []
    for p in items:
        p = serializar(p)
        p["edad"] = calcular_edad(p.get("fecha_nacimiento", ""))
        result.append(p)
    return result


@router.post("/pacientes", status_code=201)
async def crear_paciente(
    body: PacienteCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    now = datetime.now(timezone.utc)
    folio = await siguiente_folio(db, body.negocio_id)
    doc = {
        **body.model_dump(),
        "folio":      folio,
        "activo":     True,
        "created_at": now,
        "updated_at": now,
    }
    result = await db.pacientes.insert_one(doc)
    doc["_id"] = result.inserted_id
    doc = serializar(doc)
    doc["edad"] = calcular_edad(doc.get("fecha_nacimiento", ""))
    return doc


@router.get("/pacientes/{id}")
async def obtener_paciente(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(id)
    doc = await db.pacientes.find_one({"_id": oid})
    if not doc:
        raise HTTPException(404, "Paciente no encontrado")
    verificar_acceso(user, doc["negocio_id"])
    doc = serializar(doc)
    doc["edad"] = calcular_edad(doc.get("fecha_nacimiento", ""))
    return doc


@router.put("/pacientes/{id}")
async def actualizar_paciente(
    id: str,
    body: PacienteUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(id)
    paciente = await db.pacientes.find_one({"_id": oid})
    if not paciente:
        raise HTTPException(404, "Paciente no encontrado")
    verificar_acceso(user, paciente["negocio_id"])

    campos = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not campos:
        raise HTTPException(400, "Sin campos a actualizar")
    campos["updated_at"] = datetime.now(timezone.utc)
    doc = await db.pacientes.find_one_and_update(
        {"_id": oid}, {"$set": campos}, return_document=True
    )
    doc = serializar(doc)
    doc["edad"] = calcular_edad(doc.get("fecha_nacimiento", ""))
    return doc


@router.delete("/pacientes/{id}")
async def desactivar_paciente(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(id)
    paciente = await db.pacientes.find_one({"_id": oid})
    if not paciente:
        raise HTTPException(404, "Paciente no encontrado")
    verificar_acceso(user, paciente["negocio_id"])
    await db.pacientes.update_one(
        {"_id": oid},
        {"$set": {"activo": False, "updated_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True}


# ── Portal del paciente ───────────────────────────────────────────────────────

async def _paciente_portal(db, user: dict, id: str) -> dict:
    doc = await db.pacientes.find_one({"_id": validar_oid(id)})
    if not doc:
        raise HTTPException(404, "Paciente no encontrado")
    verificar_acceso(user, doc["negocio_id"])
    if not doc.get("activo", True):
        raise HTTPException(400, "El paciente está dado de baja")
    return doc


@router.post("/pacientes/{id}/portal/enlace")
async def generar_enlace_portal(
    id: str,
    request: Request,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Enlace de acceso para compartir por otro medio (WhatsApp, impreso)."""
    paciente = await _paciente_portal(db, user, id)
    url, expira = enlace_portal(url_publica(request), paciente)
    return {"url": url, "expira": expira}


@router.post("/pacientes/{id}/portal/enviar")
async def enviar_enlace_portal(
    id: str,
    request: Request,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    paciente = await _paciente_portal(db, user, id)
    if "@" not in (paciente.get("email") or ""):
        raise HTTPException(400, "El paciente no tiene un correo válido registrado")
    try:
        await enviar_acceso_portal(db, paciente, url_publica(request))
    except CorreoError as e:
        raise HTTPException(502, str(e))
    return {"ok": True, "email": paciente["email"]}


@router.post("/pacientes/{id}/portal/revocar")
async def revocar_accesos_portal(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Invalida todos los enlaces de portal emitidos hasta ahora para el paciente."""
    paciente = await _paciente_portal(db, user, id)
    await db.pacientes.update_one(
        {"_id": paciente["_id"]},
        {"$inc": {"portal_version": 1}, "$set": {"updated_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True}


@router.get("/pacientes/dashboard/resumen")
async def dashboard(
    negocio_id: str = Query(...),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    filtro = {"negocio_id": negocio_id, "activo": True}
    pacientes = await db.pacientes.find(filtro).to_list(5000)

    total = len(pacientes)

    # Nuevos este mes
    hoy = date.today()
    inicio_mes = f"{hoy.year}-{str(hoy.month).zfill(2)}-01"
    nuevos_mes = sum(
        1 for p in pacientes
        if str(p.get("created_at", ""))[:7] == inicio_mes[:7]
    )

    # Desglose por sexo
    por_sexo: dict = {}
    for p in pacientes:
        s = p.get("sexo") or "otro"
        por_sexo[s] = por_sexo.get(s, 0) + 1

    # Desglose por tipo de sangre
    por_sangre: dict = {}
    for p in pacientes:
        ts = p.get("tipo_sangre") or "desconocido"
        por_sangre[ts] = por_sangre.get(ts, 0) + 1

    # Médicos referentes top 5
    medicos: dict = {}
    for p in pacientes:
        m = (p.get("medico_tratante") or "").strip()
        if m:
            medicos[m] = medicos.get(m, 0) + 1
    top_medicos = sorted(medicos.items(), key=lambda x: x[1], reverse=True)[:5]

    # Últimos 5 registrados
    ultimos = await db.pacientes.find(filtro).sort("created_at", -1).limit(5).to_list(5)
    ultimos_out = []
    for p in ultimos:
        p = serializar(p)
        p["edad"] = calcular_edad(p.get("fecha_nacimiento", ""))
        ultimos_out.append(p)

    return {
        "total_pacientes": total,
        "nuevos_este_mes": nuevos_mes,
        "por_sexo":        por_sexo,
        "por_sangre":      por_sangre,
        "top_medicos":     [{"medico": m, "pacientes": c} for m, c in top_medicos],
        "ultimos":         ultimos_out,
    }
