from datetime import datetime
from enum import Enum
from typing import Optional, Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from pymongo import ReturnDocument
from ..services.cobros import registrar_cobro

from app.core.database import get_db
from app.core.security import get_current_user


router = APIRouter(
    prefix="/finanzas",
    tags=["Finanzas"],
)

TIPOS_CUENTA_VALIDOS = ["efectivo", "banco", "wallet", "otro"]


# ============================================================
# UTILIDADES
# ============================================================

def user_businesses(user: dict) -> list[str]:
    negocios = user.get("negocios")
    if negocios is None:
        negocios = user.get("businesses")
    if negocios is None:
        negocios = []
    return negocios


async def negocio_autorizado(
    negocio_id: str,
    user=Depends(get_current_user),
) -> str:
    """Dependencia: valida acceso al negocio y lo devuelve ya verificado.
    Reemplaza las llamadas manuales a check_business en cada endpoint —
    imposible de olvidar porque FastAPI la resuelve antes de entrar a la función."""
    if negocio_id not in user_businesses(user):
        raise HTTPException(status_code=403, detail="No tienes acceso a este negocio")
    return negocio_id


def validar_object_id(id: str):
    """Convierte un ID a ObjectId cuando es posible.
    Si el ID ya está almacenado como texto, lo conserva como string."""
    if not id:
        raise HTTPException(status_code=400, detail="ID inválido")
    try:
        return ObjectId(id)
    except Exception:
        return id


def serializar(doc: dict) -> dict:
    """Normaliza _id -> id en documentos de Mongo antes de devolverlos."""
    doc["id"] = str(doc["_id"])
    doc.pop("_id", None)
    return doc


# ============================================================
# MODELOS (Pydantic) — validación real en vez de dict suelto
# ============================================================

class TipoMovimiento(str, Enum):
    INGRESO = "ingreso"
    EGRESO = "egreso"


class CuentaCreate(BaseModel):
    negocio_id: str
    nombre: str
    tipo: Literal["efectivo", "banco", "wallet", "otro"] = "otro"
    moneda: str = "MXN"
    saldo_inicial: float = 0.0
    activo: bool = True


class CuentaUpdate(BaseModel):
    nombre: Optional[str] = None
    tipo: Optional[Literal["efectivo", "banco", "wallet", "otro"]] = None
    moneda: Optional[str] = None
    activo: Optional[bool] = None


class MovimientoCreate(BaseModel):
    negocio_id: str
    cuenta_id: str
    tipo: TipoMovimiento
    categoria: str = "otro"
    importe: float = Field(gt=0)
    concepto: str = ""
    referencia_tipo: Optional[str] = None
    referencia_id: Optional[str] = None
    fecha: datetime = Field(default_factory=datetime.utcnow)


class MetodoPagoCreate(BaseModel):
    negocio_id: str
    nombre: str
    codigo: Optional[str] = None


class CobroCreate(BaseModel):
    negocio_id: str
    cuenta_id: str
    importe: float = Field(gt=0)
    pedido_id: Optional[str] = None
    cliente_id: Optional[str] = None
    metodo_pago: str = "otro"
    referencia: str = ""
    concepto: str = ""
    fecha: datetime = Field(default_factory=datetime.utcnow)


# ============================================================
# CUENTAS FINANCIERAS
# ============================================================

@router.get("/cuentas")
async def listar_cuentas(
    negocio_id: str = Depends(negocio_autorizado),
    activo: Optional[bool] = None,
    limit: int = Query(200, ge=1, le=500),
    db=Depends(get_db),
):
    filtro = {"negocio_id": negocio_id}
    if activo is not None:
        filtro["activo"] = activo

    cursor = db.cuentas_financieras.find(filtro).sort("nombre", 1).limit(limit)
    return [serializar(c) async for c in cursor]


@router.get("/cuentas/{id}")
async def obtener_cuenta(
    id: str,
    negocio_id: str = Depends(negocio_autorizado),
    db=Depends(get_db),
):
    oid = validar_object_id(id)

    cuenta = await db.cuentas_financieras.find_one({
        "_id": oid,
        "negocio_id": negocio_id,
        "activo": True,
    })
    if not cuenta:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")

    return serializar(cuenta)


@router.post("/cuentas")
async def crear_cuenta(
    datos: CuentaCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    # negocio_id viene en el body -> se valida aquí, no vía dependencia de query param
    if datos.negocio_id not in user_businesses(user):
        raise HTTPException(status_code=403, detail="No tienes acceso a este negocio")

    existente = await db.cuentas_financieras.find_one({
        "negocio_id": datos.negocio_id,
        "nombre": datos.nombre,
    })
    if existente:
        raise HTTPException(status_code=409, detail="Ya existe una cuenta con ese nombre")

    cuenta = datos.model_dump()
    cuenta["created_at"] = datetime.utcnow()
    cuenta["updated_at"] = datetime.utcnow()

    result = await db.cuentas_financieras.insert_one(cuenta)
    cuenta["_id"] = result.inserted_id
    return serializar(cuenta)


@router.put("/cuentas/{id}")
async def editar_cuenta(
    id: str,
    datos: CuentaUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_object_id(id)
    cuenta = await db.cuentas_financieras.find_one({"_id": oid})
    if not cuenta:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")

    negocio_id = cuenta["negocio_id"]
    if negocio_id not in user_businesses(user):
        raise HTTPException(status_code=403, detail="No tienes acceso a este negocio")

    cambios = datos.model_dump(exclude_unset=True)
    cambios["updated_at"] = datetime.utcnow()

    cuenta_actualizada = await db.cuentas_financieras.find_one_and_update(
        {"_id": oid, "negocio_id": negocio_id},
        {"$set": cambios},
        return_document=ReturnDocument.AFTER,
    )
    return serializar(cuenta_actualizada)


@router.delete("/cuentas/{id}")
async def desactivar_cuenta(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_object_id(id)
    cuenta = await db.cuentas_financieras.find_one({"_id": oid})
    if not cuenta:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")

    if cuenta["negocio_id"] not in user_businesses(user):
        raise HTTPException(status_code=403, detail="No tienes acceso a este negocio")

    await db.cuentas_financieras.update_one(
        {"_id": oid},
        {"$set": {"activo": False, "updated_at": datetime.utcnow()}},
    )
    return {"ok": True, "message": "Cuenta desactivada correctamente"}


# ============================================================
# MOVIMIENTOS
# ============================================================

@router.get("/movimientos")
async def listar_movimientos(
    negocio_id: str = Depends(negocio_autorizado),
    cuenta_id: Optional[str] = None,
    tipo: Optional[TipoMovimiento] = None,
    limit: int = Query(100, ge=1, le=500),
    db=Depends(get_db),
):
    filtro = {"negocio_id": negocio_id}
    if cuenta_id:
        filtro["cuenta_id"] = cuenta_id
    if tipo:
        filtro["tipo"] = tipo.value

    cursor = (
        db.movimientos_financieros
        .find(filtro)
        .sort("fecha", -1)
        .limit(limit)
    )
    return [serializar(m) async for m in cursor]


@router.post("/movimientos")
async def crear_movimiento(
    datos: MovimientoCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    if datos.negocio_id not in user_businesses(user):
        raise HTTPException(status_code=403, detail="No tienes acceso a este negocio")

    cuenta = await db.cuentas_financieras.find_one({
        "_id": validar_object_id(datos.cuenta_id),
        "negocio_id": datos.negocio_id,
        "activo": True,
    })
    if not cuenta:
        raise HTTPException(status_code=404, detail="Cuenta financiera no encontrada")

    movimiento = datos.model_dump()
    movimiento["tipo"] = datos.tipo.value
    movimiento["estado"] = "confirmado"
    movimiento["created_by"] = str(user.get("_id", ""))
    movimiento["created_at"] = datetime.utcnow()

    result = await db.movimientos_financieros.insert_one(movimiento)
    movimiento["_id"] = result.inserted_id
    return serializar(movimiento)


# ============================================================
# MÉTODOS DE PAGO
# ============================================================

@router.get("/metodos-pago")
async def listar_metodos_pago(
    negocio_id: str = Depends(negocio_autorizado),
    db=Depends(get_db),
):
    cursor = db.metodos_pago.find({
        "negocio_id": negocio_id,
        "activo": True,
    }).sort("nombre", 1)
    return [serializar(m) async for m in cursor]


@router.post("/metodos-pago")
async def crear_metodo_pago(
    datos: MetodoPagoCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    if datos.negocio_id not in user_businesses(user):
        raise HTTPException(status_code=403, detail="No tienes acceso a este negocio")

    codigo = datos.codigo or datos.nombre.strip().lower().replace(" ", "_")

    existente = await db.metodos_pago.find_one({
        "negocio_id": datos.negocio_id,
        "codigo": codigo,
    })
    if existente:
        raise HTTPException(status_code=409, detail="El método de pago ya existe")

    metodo = {
        "negocio_id": datos.negocio_id,
        "nombre": datos.nombre,
        "codigo": codigo,
        "activo": True,
        "created_at": datetime.utcnow(),
    }
    result = await db.metodos_pago.insert_one(metodo)
    metodo["_id"] = result.inserted_id
    return serializar(metodo)


# ============================================================
# COBROS
# ============================================================

@router.get("/cobros")
async def listar_cobros(
    negocio_id: str = Depends(negocio_autorizado),
    pedido_id: Optional[str] = None,
    cliente_id: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    db=Depends(get_db),
):
    filtro = {"negocio_id": negocio_id}
    if pedido_id:
        filtro["pedido_id"] = pedido_id
    if cliente_id:
        filtro["cliente_id"] = cliente_id

    cursor = db.cobros.find(filtro).sort("fecha", -1).limit(limit)
    return [serializar(c) async for c in cursor]


@router.post("/cobros")
async def crear_cobro(
    datos: CobroCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    if datos.negocio_id not in user_businesses(user):
        raise HTTPException(status_code=403, detail="No tienes acceso a este negocio")

    cuenta = await db.cuentas_financieras.find_one({
        "_id": validar_object_id(datos.cuenta_id),
        "negocio_id": datos.negocio_id,
        "activo": True,
    })
    if not cuenta:
        raise HTTPException(status_code=404, detail="Cuenta financiera no encontrada")

    cobro = await registrar_cobro(
        db,
        datos.model_dump(),
        cuenta,
        usuario_id=str(user.get("_id", "")),
    )
    return serializar(cobro)
    



# ============================================================
# DASHBOARD
# ============================================================

@router.get("/dashboard")
async def dashboard_financiero(
    negocio_id: str = Depends(negocio_autorizado),
    db=Depends(get_db),
):
    # Una sola agregación en Mongo en vez de N+1 queries + suma en Python.
    pipeline = [
        {"$match": {"negocio_id": negocio_id, "estado": "confirmado"}},
        {"$group": {
            "_id": {"cuenta_id": "$cuenta_id", "tipo": "$tipo"},
            "total": {"$sum": "$importe"},
        }},
    ]
    totales_por_cuenta: dict[str, dict[str, float]] = {}
    async for row in db.movimientos_financieros.aggregate(pipeline):
        cuenta_id = row["_id"]["cuenta_id"]
        tipo = row["_id"]["tipo"]
        totales_por_cuenta.setdefault(cuenta_id, {"ingreso": 0.0, "egreso": 0.0})
        totales_por_cuenta[cuenta_id][tipo] = row["total"]

    cuentas = []
    total_dinero = 0.0
    total_ingresos = 0.0
    total_egresos = 0.0

    cursor = db.cuentas_financieras.find({"negocio_id": negocio_id, "activo": True})
    async for cuenta in cursor:
        cuenta_id = str(cuenta["_id"])
        totales = totales_por_cuenta.get(cuenta_id, {"ingreso": 0.0, "egreso": 0.0})
        ingresos = totales["ingreso"]
        egresos = totales["egreso"]

        saldo = float(cuenta.get("saldo_inicial", 0)) + ingresos - egresos

        total_dinero += saldo
        total_ingresos += ingresos
        total_egresos += egresos

        cuentas.append({
            "id": cuenta_id,
            "nombre": cuenta["nombre"],
            "tipo": cuenta["tipo"],
            "moneda": cuenta.get("moneda", "MXN"),
            "saldo": saldo,
        })

    return {
        "negocio_id": negocio_id,
        "total_dinero": total_dinero,
        "ingresos_registrados": total_ingresos,
        "egresos_registrados": total_egresos,
        "cuentas": cuentas,
    }