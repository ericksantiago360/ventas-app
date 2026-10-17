from datetime import date, datetime, timezone
from typing import Literal, Optional, List

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.security import get_current_user, require_admin
from app.modules.nomina.constants import (
    AGUINALDO_DIAS, PRIMA_VACACIONAL, SALARIO_MINIMO_DIARIO, SBC_TOPE_DIARIO,
    cuota_obrera_imss, factor_integracion, retener_isr_mensual,
)

router = APIRouter(prefix="/personal", tags=["Personal"])

TIPOS_CONTRATO = Literal["planta", "temporal", "honorarios", "confianza"]
TIPOS_PERIODO  = Literal["semanal", "quincenal", "mensual"]
DIAS_PERIODO   = {"semanal": 7, "quincenal": 15, "mensual": 30}
DIAS_MES       = 30.4  # mes promedio usado por SAT/IMSS para tarifas mensuales
PRESTACIONES_LEY = {
    "aguinaldo_dias":   AGUINALDO_DIAS,
    "prima_vacacional": PRIMA_VACACIONAL,
    "vacaciones_extra": 0,
}


# ── Utilidades ────────────────────────────────────────────────────────────────

def serializar(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    return doc


def calcular_anio_servicio(fecha_ingreso: str, fecha: str) -> int:
    """Año de servicio en curso a la fecha dada (1 = primer año)."""
    try:
        ingreso = date.fromisoformat(fecha_ingreso[:10])
        ref     = date.fromisoformat(fecha[:10])
    except (TypeError, ValueError):
        return 1
    cumplidos = ref.year - ingreso.year - ((ref.month, ref.day) < (ingreso.month, ingreso.day))
    return max(0, cumplidos) + 1


def calcular_deducciones(
    salario_diario: float, dias: int, tipo_contrato: str = "planta", anio_servicio: int = 1,
    prestaciones: Optional[dict] = None,
) -> dict:
    """IMSS obrero e ISR del período, proporcionales a las tarifas mensuales."""
    # Honorarios no es relación laboral: no cotiza al IMSS ni lleva ISR de sueldos.
    if tipo_contrato == "honorarios":
        return {"sbc_diario": 0.0, "imss": 0.0, "isr": 0.0}

    factor_sbc = factor_integracion(anio_servicio, **(prestaciones or PRESTACIONES_LEY))
    sbc_diario = round(min(salario_diario * factor_sbc, SBC_TOPE_DIARIO), 2)

    # Salario mínimo: sin retención de ISR (Art. 96 LISR) y la cuota obrera
    # IMSS la cubre el patrón (Art. 36 LSS), así que no se descuenta.
    if salario_diario <= SALARIO_MINIMO_DIARIO:
        return {"sbc_diario": sbc_diario, "imss": 0.0, "isr": 0.0}

    # Escalar el resultado mensual por dias/30.4 equivale a usar la tarifa
    # proporcional al período. El IMSS va sobre el SBC; el ISR, sobre el salario.
    factor = dias / DIAS_MES
    imss = cuota_obrera_imss(sbc_diario * DIAS_MES)["total"] * factor
    isr  = retener_isr_mensual(salario_diario * DIAS_MES)["isr_retener"] * factor
    return {"sbc_diario": sbc_diario, "imss": round(imss, 2), "isr": round(isr, 2)}


def validar_oid(id: str) -> ObjectId:
    try:
        return ObjectId(id)
    except Exception:
        raise HTTPException(status_code=400, detail="ID inválido")


def check_negocio(user: dict, negocio_id: str):
    negocios = user.get("negocios") or user.get("businesses") or []
    if negocio_id not in list(negocios):
        raise HTTPException(status_code=403, detail="Sin acceso a este negocio")


async def obtener_prestaciones(db, negocio_id: str) -> dict:
    config = await db.config_negocios.find_one({"_id": negocio_id}, {"nomina": 1}) or {}
    return {**PRESTACIONES_LEY, **(config.get("nomina") or {})}


# Conceptos que genera el cálculo; cualquier otra línea del recibo es manual
CONCEPTOS_AUTO = {"Salario", "IMSS", "ISR"}

# Datos del empleado que alteran el cálculo de sus recibos
CAMPOS_CALCULO = {"salario_diario", "tipo_contrato", "fecha_ingreso"}


def calcular_recibo(emp: dict, periodo: dict, prestaciones: dict) -> dict:
    """Líneas automáticas (Salario, IMSS, ISR) del recibo de un empleado en un período."""
    dias = DIAS_PERIODO[periodo["tipo_periodo"]]
    salario_diario = float(emp.get("salario_diario", 0))
    ded = calcular_deducciones(
        salario_diario, dias, emp.get("tipo_contrato", "planta"),
        calcular_anio_servicio(emp.get("fecha_ingreso", ""), periodo["fecha_inicio"]),
        prestaciones,
    )
    return {
        "tipo_contrato":  emp.get("tipo_contrato", "planta"),
        "salario_diario": emp.get("salario_diario", 0),
        "sbc_diario":     ded["sbc_diario"],
        "percepciones":   [{"concepto": "Salario", "monto": round(salario_diario * dias, 2)}],
        "deducciones":    [
            {"concepto": concepto, "monto": ded[clave]}
            for concepto, clave in (("IMSS", "imss"), ("ISR", "isr"))
            if ded[clave] > 0
        ],
    }


async def recalcular_recibos_pendientes(db, negocio_id: str, empleado_id: Optional[str] = None) -> int:
    """
    Recalcula las líneas automáticas de los recibos pendientes en períodos abiertos,
    con los datos actuales del empleado y las prestaciones del negocio.

    Los períodos cerrados y los recibos pagados no se tocan; las líneas manuales se conservan.
    """
    prestaciones = await obtener_prestaciones(db, negocio_id)
    periodos = await db.nomina_periodos.find(
        {"negocio_id": negocio_id, "estado": {"$ne": "cerrado"}}
    ).to_list(500)
    filtro_recibos: dict = {"estado": {"$ne": "pagado"}}
    if empleado_id:
        filtro_recibos["empleado_id"] = empleado_id
    actualizados = 0

    for periodo in periodos:
        periodo_id = str(periodo["_id"])
        recibos = await db.nomina_recibos.find({**filtro_recibos, "periodo_id": periodo_id}).to_list(500)
        cambio_periodo = False

        for recibo in recibos:
            emp = await db.empleados.find_one({"_id": validar_oid(recibo["empleado_id"])})
            if not emp:
                continue
            auto = calcular_recibo(emp, periodo, prestaciones)
            for tipo in ("percepciones", "deducciones"):
                auto[tipo] += [l for l in recibo.get(tipo, []) if l["concepto"] not in CONCEPTOS_AUTO]
            if all(auto[k] == recibo.get(k) for k in auto):
                continue

            total_p = round(sum(l["monto"] for l in auto["percepciones"]), 2)
            total_d = round(sum(l["monto"] for l in auto["deducciones"]), 2)
            await db.nomina_recibos.update_one({"_id": recibo["_id"]}, {"$set": {
                **auto,
                "total_percepciones": total_p,
                "total_deducciones":  total_d,
                "total_neto":         round(total_p - total_d, 2),
                "updated_at":         datetime.now(timezone.utc),
            }})
            actualizados += 1
            cambio_periodo = True

        if cambio_periodo:
            await recalcular_totales_periodo(db, periodo_id)

    return actualizados


async def recalcular_totales_periodo(db, periodo_id: str):
    recibos = await db.nomina_recibos.find({"periodo_id": periodo_id}).to_list(500)
    t_p = round(sum(r.get("total_percepciones", 0) for r in recibos), 2)
    t_d = round(sum(r.get("total_deducciones", 0) for r in recibos), 2)
    await db.nomina_periodos.update_one(
        {"_id": validar_oid(periodo_id)},
        {"$set": {
            "total_percepciones": t_p,
            "total_deducciones": t_d,
            "total_neto": round(t_p - t_d, 2),
        }},
    )


# ── Pydantic models ───────────────────────────────────────────────────────────

class LineaConcepto(BaseModel):
    concepto: str
    monto: float = Field(ge=0)


class EmpleadoCreate(BaseModel):
    negocio_id: str
    nombre: str
    apellido_paterno: str = ""
    apellido_materno: str = ""
    puesto: str = ""
    departamento: str = ""
    tipo_contrato: TIPOS_CONTRATO = "planta"
    salario_diario: float = Field(default=0.0, ge=0)
    periodo_pago: TIPOS_PERIODO = "quincenal"
    fecha_ingreso: str = ""
    rfc: str = ""
    curp: str = ""
    nss: str = ""
    banco: str = ""
    clabe: str = ""
    email: str = ""
    telefono: str = ""


class EmpleadoUpdate(BaseModel):
    nombre: Optional[str] = None
    apellido_paterno: Optional[str] = None
    apellido_materno: Optional[str] = None
    puesto: Optional[str] = None
    departamento: Optional[str] = None
    tipo_contrato: Optional[TIPOS_CONTRATO] = None
    salario_diario: Optional[float] = None
    periodo_pago: Optional[TIPOS_PERIODO] = None
    fecha_ingreso: Optional[str] = None
    rfc: Optional[str] = None
    curp: Optional[str] = None
    nss: Optional[str] = None
    banco: Optional[str] = None
    clabe: Optional[str] = None
    email: Optional[str] = None
    telefono: Optional[str] = None


class PeriodoCreate(BaseModel):
    negocio_id: str
    nombre: str
    tipo_periodo: TIPOS_PERIODO = "quincenal"
    fecha_inicio: str
    fecha_fin: str


class ReciboUpdate(BaseModel):
    percepciones: Optional[List[LineaConcepto]] = None
    deducciones: Optional[List[LineaConcepto]] = None
    estado: Optional[Literal["pendiente", "pagado"]] = None


class NominaConfig(BaseModel):
    """Prestaciones del negocio para el factor de integración; no pueden ser menores a las de ley."""
    negocio_id: str
    aguinaldo_dias:   float = Field(default=AGUINALDO_DIAS, ge=AGUINALDO_DIAS, le=365)
    prima_vacacional: float = Field(default=PRIMA_VACACIONAL, ge=PRIMA_VACACIONAL, le=1)
    vacaciones_extra: int   = Field(default=0, ge=0, le=60)


# ── Empleados ─────────────────────────────────────────────────────────────────

@router.get("/empleados")
async def listar_empleados(
    negocio_id: str = Query(...),
    busqueda: str = Query(""),
    solo_activos: bool = Query(True),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_negocio(user, negocio_id)
    filtro: dict = {"negocio_id": negocio_id}
    if solo_activos:
        filtro["activo"] = True
    if busqueda.strip():
        filtro["$or"] = [
            {"nombre": {"$regex": busqueda.strip(), "$options": "i"}},
            {"apellido_paterno": {"$regex": busqueda.strip(), "$options": "i"}},
            {"puesto": {"$regex": busqueda.strip(), "$options": "i"}},
            {"departamento": {"$regex": busqueda.strip(), "$options": "i"}},
        ]
    items = await db.empleados.find(filtro).sort([("apellido_paterno", 1), ("nombre", 1)]).to_list(500)
    return [serializar(i) for i in items]


@router.post("/empleados", status_code=201)
async def crear_empleado(
    body: EmpleadoCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_negocio(user, body.negocio_id)
    now = datetime.now(timezone.utc)
    doc = {**body.model_dump(), "activo": True, "created_at": now, "updated_at": now}
    result = await db.empleados.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serializar(doc)


@router.put("/empleados/{id}")
async def actualizar_empleado(
    id: str,
    body: EmpleadoUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(id)
    antes = await db.empleados.find_one({"_id": oid})
    if not antes:
        raise HTTPException(404, "Empleado no encontrado")
    check_negocio(user, antes["negocio_id"])

    campos = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not campos:
        raise HTTPException(400, "Sin campos a actualizar")
    campos["updated_at"] = datetime.now(timezone.utc)
    await db.empleados.update_one({"_id": oid}, {"$set": campos})
    doc = {**antes, **campos}

    # El formulario manda todos los campos: recalcular solo si cambió algo del cálculo
    recalculados = 0
    if any(antes.get(k) != campos[k] for k in CAMPOS_CALCULO & campos.keys()):
        recalculados = await recalcular_recibos_pendientes(db, doc["negocio_id"], id)
    return {**serializar(doc), "recibos_recalculados": recalculados}


@router.delete("/empleados/{id}")
async def desactivar_empleado(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(id)
    doc = await db.empleados.find_one({"_id": oid})
    if not doc:
        raise HTTPException(404, "Empleado no encontrado")
    check_negocio(user, doc["negocio_id"])
    await db.empleados.update_one(
        {"_id": oid},
        {"$set": {"activo": False, "updated_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True}


# ── Períodos de nómina ────────────────────────────────────────────────────────

@router.get("/nomina/config")
async def obtener_config_nomina(
    negocio_id: str = Query(...),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_negocio(user, negocio_id)
    prestaciones = await obtener_prestaciones(db, negocio_id)
    return {
        "negocio_id": negocio_id,
        **prestaciones,
        "factor_primer_anio": factor_integracion(1, **prestaciones),
    }


@router.put("/nomina/config")
async def guardar_config_nomina(
    body: NominaConfig,
    db=Depends(get_db),
    user=Depends(require_admin),
):
    check_negocio(user, body.negocio_id)
    prestaciones = body.model_dump(exclude={"negocio_id"})
    await db.config_negocios.update_one(
        {"_id": body.negocio_id},
        {"$set": {"nomina": prestaciones, "updated_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    recalculados = await recalcular_recibos_pendientes(db, body.negocio_id)
    return {
        "negocio_id": body.negocio_id,
        **prestaciones,
        "factor_primer_anio": factor_integracion(1, **prestaciones),
        "recibos_recalculados": recalculados,
    }


@router.get("/nomina/periodos")
async def listar_periodos(
    negocio_id: str = Query(...),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_negocio(user, negocio_id)
    items = await db.nomina_periodos.find({"negocio_id": negocio_id}).sort("fecha_inicio", -1).to_list(200)
    return [serializar(i) for i in items]


@router.post("/nomina/periodos", status_code=201)
async def crear_periodo(
    body: PeriodoCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_negocio(user, body.negocio_id)
    now = datetime.now(timezone.utc)
    doc = {
        **body.model_dump(),
        "estado": "borrador",
        "total_percepciones": 0.0,
        "total_deducciones": 0.0,
        "total_neto": 0.0,
        "created_at": now,
        "updated_at": now,
    }
    result = await db.nomina_periodos.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serializar(doc)


@router.patch("/nomina/periodos/{id}/calcular")
async def calcular_nomina(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(id)
    periodo = await db.nomina_periodos.find_one({"_id": oid})
    if not periodo:
        raise HTTPException(404, "Período no encontrado")
    check_negocio(user, periodo["negocio_id"])
    if periodo["estado"] == "cerrado":
        raise HTTPException(400, "El período está cerrado")

    negocio_id = periodo["negocio_id"]
    prestaciones = await obtener_prestaciones(db, negocio_id)
    empleados = await db.empleados.find({"negocio_id": negocio_id, "activo": True}).to_list(500)
    now = datetime.now(timezone.utc)
    creados = 0

    for emp in empleados:
        emp_id = str(emp["_id"])
        if await db.nomina_recibos.find_one({"periodo_id": id, "empleado_id": emp_id}):
            continue

        auto      = calcular_recibo(emp, periodo, prestaciones)
        salario   = auto["percepciones"][0]["monto"]
        total_ded = round(sum(d["monto"] for d in auto["deducciones"]), 2)

        await db.nomina_recibos.insert_one({
            "negocio_id":       negocio_id,
            "periodo_id":       id,
            "empleado_id":      emp_id,
            "empleado_nombre":  f"{emp.get('nombre','')} {emp.get('apellido_paterno','')} {emp.get('apellido_materno','')}".strip(),
            "puesto":           emp.get("puesto", ""),
            "departamento":     emp.get("departamento", ""),
            **auto,
            "total_percepciones": salario,
            "total_deducciones":  total_ded,
            "total_neto":         round(salario - total_ded, 2),
            "estado":             "pendiente",
            "created_at":         now,
            "updated_at":         now,
        })
        creados += 1

    await recalcular_totales_periodo(db, id)

    updated = await db.nomina_periodos.find_one_and_update(
        {"_id": oid},
        {"$set": {"estado": "calculado", "updated_at": now}},
        return_document=True,
    )
    return {**serializar(updated), "recibos_creados": creados}


@router.patch("/nomina/periodos/{id}/cerrar")
async def cerrar_periodo(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(id)
    periodo = await db.nomina_periodos.find_one({"_id": oid})
    if not periodo:
        raise HTTPException(404, "Período no encontrado")
    check_negocio(user, periodo["negocio_id"])
    if periodo["estado"] == "borrador":
        raise HTTPException(400, "Calcula la nómina antes de cerrar el período")
    doc = await db.nomina_periodos.find_one_and_update(
        {"_id": oid},
        {"$set": {"estado": "cerrado", "updated_at": datetime.now(timezone.utc)}},
        return_document=True,
    )
    return serializar(doc)


@router.patch("/nomina/periodos/{id}/reabrir")
async def reabrir_periodo(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(id)
    periodo = await db.nomina_periodos.find_one({"_id": oid})
    if not periodo:
        raise HTTPException(404, "Período no encontrado")
    check_negocio(user, periodo["negocio_id"])
    doc = await db.nomina_periodos.find_one_and_update(
        {"_id": oid},
        {"$set": {"estado": "calculado", "updated_at": datetime.now(timezone.utc)}},
        return_document=True,
    )
    return serializar(doc)


# ── Recibos de nómina ─────────────────────────────────────────────────────────

@router.get("/nomina/recibos")
async def listar_recibos(
    negocio_id: str = Query(...),
    periodo_id: Optional[str] = Query(None),
    empleado_id: Optional[str] = Query(None),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_negocio(user, negocio_id)
    filtro: dict = {"negocio_id": negocio_id}
    if periodo_id:
        filtro["periodo_id"] = periodo_id
    if empleado_id:
        filtro["empleado_id"] = empleado_id
    items = await db.nomina_recibos.find(filtro).sort("empleado_nombre", 1).to_list(500)
    return [serializar(i) for i in items]


@router.put("/nomina/recibos/{id}")
async def actualizar_recibo(
    id: str,
    body: ReciboUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(id)
    recibo = await db.nomina_recibos.find_one({"_id": oid})
    if not recibo:
        raise HTTPException(404, "Recibo no encontrado")
    check_negocio(user, recibo["negocio_id"])

    periodo = await db.nomina_periodos.find_one({"_id": validar_oid(recibo["periodo_id"])})
    if periodo and periodo.get("estado") == "cerrado":
        raise HTTPException(400, "El período está cerrado — no se pueden editar los recibos")

    campos: dict = {"updated_at": datetime.now(timezone.utc)}

    percepciones = recibo.get("percepciones", [])
    deducciones  = recibo.get("deducciones", [])

    if body.percepciones is not None:
        percepciones = [p.model_dump() for p in body.percepciones]
        campos["percepciones"] = percepciones
        campos["total_percepciones"] = round(sum(p["monto"] for p in percepciones), 2)

    if body.deducciones is not None:
        deducciones = [d.model_dump() for d in body.deducciones]
        campos["deducciones"] = deducciones
        campos["total_deducciones"] = round(sum(d["monto"] for d in deducciones), 2)

    total_p = campos.get("total_percepciones", recibo.get("total_percepciones", 0))
    total_d = campos.get("total_deducciones",  recibo.get("total_deducciones", 0))
    campos["total_neto"] = round(total_p - total_d, 2)

    if body.estado is not None:
        campos["estado"] = body.estado

    doc = await db.nomina_recibos.find_one_and_update(
        {"_id": oid}, {"$set": campos}, return_document=True
    )
    await recalcular_totales_periodo(db, recibo["periodo_id"])
    return serializar(doc)


# ── Dashboard ─────────────────────────────────────────────────────────────────

@router.get("/dashboard")
async def dashboard(
    negocio_id: str = Query(...),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_negocio(user, negocio_id)
    empleados = await db.empleados.find({"negocio_id": negocio_id, "activo": True}).to_list(500)

    masa_diaria = sum(float(e.get("salario_diario", 0)) for e in empleados)

    departamentos: dict = {}
    for e in empleados:
        dep = e.get("departamento") or "Sin departamento"
        departamentos[dep] = departamentos.get(dep, 0) + 1

    contratos: dict = {}
    for e in empleados:
        c = e.get("tipo_contrato") or "planta"
        contratos[c] = contratos.get(c, 0) + 1

    ultimo_periodo = await db.nomina_periodos.find_one(
        {"negocio_id": negocio_id, "estado": {"$in": ["calculado", "cerrado"]}},
        sort=[("fecha_fin", -1)],
    )

    return {
        "total_empleados":          len(empleados),
        "masa_salarial_quincenal":  round(masa_diaria * 15, 2),
        "masa_salarial_mensual":    round(masa_diaria * 30, 2),
        "departamentos":            departamentos,
        "contratos":                contratos,
        "ultimo_periodo":           serializar(ultimo_periodo) if ultimo_periodo else None,
    }
