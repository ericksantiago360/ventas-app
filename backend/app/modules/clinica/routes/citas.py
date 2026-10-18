from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.config import settings
from app.core.database import get_db
from app.core.negocios import negocio_autorizado, obtener_del_negocio, verificar_acceso
from app.core.security import get_current_user

from ..models.cita import ESTADOS_FINALES, ESTADOS_LIBERAN, CitaCreate, CitaUpdate
from .expedientes import validar_medico

router = APIRouter(prefix="/clinica", tags=["Clínica"])


# ── Utilidades ────────────────────────────────────────────────────────────────

def zona(tz: str = "") -> ZoneInfo:
    try:
        return ZoneInfo(tz or settings.ZONA_HORARIA)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(400, f"Zona horaria inválida: {tz}")


def a_utc(dt: datetime) -> datetime:
    """Sin zona horaria = hora local de la clínica. Mongo devuelve UTC sin zona; se marca."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=zona())
    return dt.astimezone(timezone.utc)


def desde_db(dt: datetime | None) -> datetime | None:
    return dt.replace(tzinfo=timezone.utc) if dt and dt.tzinfo is None else dt


def rango_del_dia(dia: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    inicio = datetime.combine(dia, time.min, tzinfo=tz)
    return inicio.astimezone(timezone.utc), (inicio + timedelta(days=1)).astimezone(timezone.utc)


async def siguiente_folio(db, negocio_id: str) -> str:
    counter = await db.counters.find_one_and_update(
        {"_id": f"citas_{negocio_id}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    return f"CIT-{str(counter['seq']).zfill(5)}"


async def validar_horario(db, negocio_id: str, medico_id: str, consultorio: str,
                          inicio: datetime, fin: datetime, excluir: ObjectId | None = None) -> None:
    """Ni el médico ni el consultorio pueden tener dos citas al mismo tiempo."""
    ocupa = [{"medico_id": medico_id}]
    if consultorio:
        ocupa.append({"consultorio": consultorio})
    filtro = {
        "negocio_id":   negocio_id,
        "estado":       {"$nin": list(ESTADOS_LIBERAN)},
        "fecha_inicio": {"$lt": fin},
        "fecha_fin":    {"$gt": inicio},
        "$or":          ocupa,
    }
    if excluir:
        filtro["_id"] = {"$ne": excluir}
    choque = await db.citas.find_one(filtro)
    if choque:
        quien = "El médico" if choque["medico_id"] == medico_id else consultorio
        hora = desde_db(choque["fecha_inicio"]).astimezone(zona()).strftime("%H:%M")
        raise HTTPException(409, f"{quien} ya tiene la cita {choque['folio']} a las {hora}")


async def validar_expediente(db, expediente_id: str, negocio_id: str) -> dict:
    if not ObjectId.is_valid(expediente_id):
        raise HTTPException(400, "Expediente: ID inválido")
    exp = await db.expedientes.find_one({"_id": ObjectId(expediente_id), "negocio_id": negocio_id})
    if not exp:
        raise HTTPException(404, "Expediente: no existe en este negocio")
    if not exp.get("activo", True):
        raise HTTPException(400, "El expediente está cerrado")
    return exp


def a_cita(doc: dict, exp: dict | None, paciente: dict | None, medico: dict | None) -> dict:
    cita = {k: v for k, v in doc.items() if k != "_id"}
    for campo in ("fecha_inicio", "fecha_fin", "created_at", "updated_at"):
        cita[campo] = desde_db(doc.get(campo))
    alergias = ((exp or {}).get("antecedentes") or {}).get("alergias") or []
    return {
        **cita,
        "id":                str(doc["_id"]),
        "expediente_folio":  (exp or {}).get("folio", ""),
        "paciente_nombre":   " ".join(filter(None, [(paciente or {}).get(k) for k in ("nombre", "apellido_paterno", "apellido_materno")])),
        "paciente_telefono": (paciente or {}).get("telefono", ""),
        "alergias":          alergias,
        "medico_nombre":     (medico or {}).get("nombre", ""),
    }


async def a_citas(db, citas: list[dict]) -> list[dict]:
    """Une cada cita con su expediente, paciente y médico en tres consultas."""
    def oids(valores):
        return list({ObjectId(v) for v in valores if v and ObjectId.is_valid(v)})

    exps = {str(e["_id"]): e for e in await db.expedientes.find(
        {"_id": {"$in": oids(c["expediente_id"] for c in citas)}}, {"folio": 1, "paciente_id": 1, "antecedentes.alergias": 1}
    ).to_list(None)}
    pacientes = {str(p["_id"]): p for p in await db.pacientes.find(
        {"_id": {"$in": oids(e["paciente_id"] for e in exps.values())}},
        {"nombre": 1, "apellido_paterno": 1, "apellido_materno": 1, "telefono": 1},
    ).to_list(None)}
    medicos = {str(u["_id"]): u for u in await db.usuarios.find(
        {"_id": {"$in": oids(c["medico_id"] for c in citas)}}, {"nombre": 1}
    ).to_list(None)}

    resultado = []
    for c in citas:
        exp = exps.get(c["expediente_id"])
        resultado.append(a_cita(c, exp, pacientes.get((exp or {}).get("paciente_id")), medicos.get(c["medico_id"])))
    return resultado


# ── Consultorios ──────────────────────────────────────────────────────────────

@router.get("/consultorios")
async def listar_consultorios(
    negocio_id: str = Depends(negocio_autorizado),
    db=Depends(get_db),
):
    """Consultorios ya usados en la agenda, para sugerirlos al agendar."""
    usados = await db.citas.distinct("consultorio", {"negocio_id": negocio_id})
    return sorted(c for c in usados if c)


# ── Citas ─────────────────────────────────────────────────────────────────────

@router.get("/citas")
async def listar_citas(
    negocio_id: str = Depends(negocio_autorizado),
    desde: datetime | None = Query(None),
    hasta: datetime | None = Query(None),
    medico_id: str = Query(""),
    estado: str = Query(""),
    expediente_id: str = Query(""),
    db=Depends(get_db),
):
    """Citas que se cruzan con el rango [desde, hasta), en orden de hora."""
    filtro: dict = {"negocio_id": negocio_id}
    if desde:
        filtro["fecha_fin"] = {"$gt": a_utc(desde)}
    if hasta:
        filtro["fecha_inicio"] = {"$lt": a_utc(hasta)}
    if medico_id:
        filtro["medico_id"] = medico_id
    if estado:
        filtro["estado"] = {"$in": estado.split(",")}
    if expediente_id:
        filtro["expediente_id"] = expediente_id
    docs = await db.citas.find(filtro).sort("fecha_inicio", 1).to_list(2000)
    return await a_citas(db, docs)


@router.get("/citas/hoy")
async def citas_de_hoy(
    negocio_id: str = Depends(negocio_autorizado),
    medico_id: str = Query(""),
    fecha: date | None = Query(None, description="Otro día; por defecto, hoy"),
    tz: str = Query(""),
    db=Depends(get_db),
):
    """Agenda del día (en la zona horaria de la clínica) ordenada por hora."""
    z = zona(tz)
    inicio, fin = rango_del_dia(fecha or datetime.now(z).date(), z)
    filtro: dict = {"negocio_id": negocio_id, "fecha_inicio": {"$gte": inicio, "$lt": fin}}
    if medico_id:
        filtro["medico_id"] = medico_id
    docs = await db.citas.find(filtro).sort("fecha_inicio", 1).to_list(500)
    return await a_citas(db, docs)


@router.get("/citas/disponibilidad")
async def disponibilidad(
    negocio_id: str = Depends(negocio_autorizado),
    medico_id: str = Query(..., min_length=1),
    fecha: date = Query(...),
    duracion: int = Query(30, ge=5, le=480),
    consultorio: str = Query(""),
    hora_inicio: time = Query(time(8, 0)),
    hora_fin: time = Query(time(20, 0)),
    tz: str = Query(""),
    excluir_id: str = Query("", description="Cita que se está reprogramando"),
    db=Depends(get_db),
):
    """Horarios libres del médico (y del consultorio, si se indica) en el día, cada `duracion` minutos."""
    await validar_medico(db, medico_id, negocio_id)
    z = zona(tz)
    inicio_dia, fin_dia = rango_del_dia(fecha, z)
    ocupa = [{"medico_id": medico_id}] + ([{"consultorio": consultorio}] if consultorio else [])
    filtro = {
        "negocio_id":   negocio_id,
        "estado":       {"$nin": list(ESTADOS_LIBERAN)},
        "fecha_inicio": {"$lt": fin_dia},
        "fecha_fin":    {"$gt": inicio_dia},
        "$or":          ocupa,
    }
    if ObjectId.is_valid(excluir_id):
        filtro["_id"] = {"$ne": ObjectId(excluir_id)}
    ocupadas = [(desde_db(c["fecha_inicio"]), desde_db(c["fecha_fin"]))
                for c in await db.citas.find(filtro, {"fecha_inicio": 1, "fecha_fin": 1}).to_list(500)]

    ahora = datetime.now(timezone.utc)
    paso = timedelta(minutes=duracion)
    slot = datetime.combine(fecha, hora_inicio, tzinfo=z).astimezone(timezone.utc)
    limite = datetime.combine(fecha, hora_fin, tzinfo=z).astimezone(timezone.utc)
    libres = []
    while slot + paso <= limite:
        fin = slot + paso
        if slot >= ahora and not any(i < fin and f > slot for i, f in ocupadas):
            libres.append({"inicio": slot, "fin": fin})
        slot = fin
    return libres


@router.post("/citas", status_code=201)
async def crear_cita(
    body: CitaCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    await validar_expediente(db, body.expediente_id, body.negocio_id)
    await validar_medico(db, body.medico_id, body.negocio_id)
    consultorio = body.consultorio.strip()
    inicio = a_utc(body.fecha_inicio)
    fin = inicio + timedelta(minutes=body.duracion_minutos)
    await validar_horario(db, body.negocio_id, body.medico_id, consultorio, inicio, fin)

    now = datetime.now(timezone.utc)
    doc = {
        **body.model_dump(),
        "folio":                await siguiente_folio(db, body.negocio_id),
        "consultorio":          consultorio,
        "fecha_inicio":         inicio,
        "fecha_fin":            fin,
        "estado":               "programada",
        "recordatorio_enviado": False,
        "motivo_cancelacion":   "",
        "creado_por":           user.get("nombre", ""),
        "created_at":           now,
        "updated_at":           now,
    }
    doc["_id"] = (await db.citas.insert_one(doc)).inserted_id
    return (await a_citas(db, [doc]))[0]


@router.get("/citas/{id}")
async def obtener_cita(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    cita = await obtener_del_negocio(db.citas, id, user, "Cita")
    return (await a_citas(db, [cita]))[0]


@router.put("/citas/{id}")
async def actualizar_cita(
    id: str,
    body: CitaUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Reprogramar (fecha, duración, médico, consultorio) o cambiar el estado."""
    cita = await obtener_del_negocio(db.citas, id, user, "Cita")
    if cita["estado"] in ESTADOS_FINALES:
        raise HTTPException(400, f"La cita está {cita['estado']} y ya no se puede modificar")
    cambios = body.model_dump(exclude_none=True)
    if not cambios:
        raise HTTPException(400, "Sin campos a actualizar")
    if "consultorio" in cambios:
        cambios["consultorio"] = cambios["consultorio"].strip()
    if "medico_id" in cambios:
        await validar_medico(db, cambios["medico_id"], cita["negocio_id"])

    medico_id = cambios.get("medico_id", cita["medico_id"])
    consultorio = cambios.get("consultorio", cita.get("consultorio", ""))
    inicio = a_utc(cambios["fecha_inicio"]) if "fecha_inicio" in cambios else desde_db(cita["fecha_inicio"])
    fin = inicio + timedelta(minutes=cambios.get("duracion_minutos", cita["duracion_minutos"]))
    estado = cambios.get("estado", cita["estado"])
    horario_cambia = {"medico_id", "consultorio", "fecha_inicio", "duracion_minutos"} & cambios.keys()
    # Volver a ocupar el horario (reprogramar o reactivar un no-show) exige que siga libre
    if estado not in ESTADOS_LIBERAN and (horario_cambia or cita["estado"] in ESTADOS_LIBERAN):
        await validar_horario(db, cita["negocio_id"], medico_id, consultorio, inicio, fin, excluir=cita["_id"])
    if horario_cambia:
        cambios.update({"fecha_inicio": inicio, "fecha_fin": fin})
        # Al moverla, el recordatorio enviado ya no aplica
        if body.fecha_inicio is not None and body.recordatorio_enviado is None:
            cambios["recordatorio_enviado"] = False

    cita = await db.citas.find_one_and_update(
        {"_id": cita["_id"]},
        {"$set": {**cambios, "updated_at": datetime.now(timezone.utc)}},
        return_document=True,
    )
    return (await a_citas(db, [cita]))[0]


@router.delete("/citas/{id}")
async def cancelar_cita(
    id: str,
    motivo: str = Query(""),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Cancela la cita; queda en la agenda como cancelada y libera el horario."""
    cita = await obtener_del_negocio(db.citas, id, user, "Cita")
    if cita["estado"] in ESTADOS_FINALES:
        raise HTTPException(400, f"La cita ya está {cita['estado']}")
    cita = await db.citas.find_one_and_update(
        {"_id": cita["_id"]},
        {"$set": {"estado": "cancelada", "motivo_cancelacion": motivo.strip(),
                  "cancelada_por": user.get("nombre", ""), "updated_at": datetime.now(timezone.utc)}},
        return_document=True,
    )
    return (await a_citas(db, [cita]))[0]
