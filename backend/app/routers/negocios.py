import calendar
from datetime import date, datetime, timezone
from typing import Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.negocios import negocios_del_usuario
from app.core.security import get_current_user, require_admin
from app.services.catalogo_contable import abrir_periodo, sembrar_catalogo_cuentas

router = APIRouter(prefix="/negocios", tags=["Negocios"])

GIROS = Literal["laboratorio_clinico", "fabricacion_cnc", "distribucion", "inmobiliario", "servicios", "otro"]


class NegocioCreate(BaseModel):
    # El id se usa como negocio_id en todos los registros: no se puede cambiar después
    id:      str = Field(pattern=r"^[a-z][a-z0-9_]{2,39}$")
    nombre:  str = Field(min_length=2, max_length=120)
    tipo:    GIROS = "otro"
    # Prefijo de folios: cotizaciones "DT-0001", pedidos "PED-DT-0001"
    prefijo: str = Field(pattern=r"^[A-Z0-9]{2,6}$")


def a_respuesta(doc: dict) -> dict:
    return {"id": doc["_id"], "nombre": doc.get("nombre") or doc["_id"], "tipo": doc.get("tipo", "")}


@router.get("")
async def listar_negocios(
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Negocios activos a los que el usuario tiene acceso, desde config_negocios."""
    docs = await db.config_negocios.find(
        {"_id": {"$in": sorted(negocios_del_usuario(user))}, "activo": {"$ne": False}},
        {"nombre": 1, "tipo": 1},
    ).sort("nombre", 1).to_list(100)
    return [a_respuesta(d) for d in docs]


@router.post("", status_code=201)
async def crear_negocio(
    body: NegocioCreate,
    db=Depends(get_db),
    user=Depends(require_admin),
):
    """
    Da de alta un negocio listo para operar: configuración con los campos que usan
    cotizaciones y pedidos, catálogo de cuentas contables y periodo del mes en curso.
    Queda asignado al administrador que lo crea.
    """
    if await db.config_negocios.find_one({"_id": body.id}):
        raise HTTPException(409, "Ya existe un negocio con ese identificador")

    now = datetime.now(timezone.utc)
    doc = {
        "_id":                body.id,
        "nombre":             body.nombre.strip(),
        "tipo":               body.tipo,
        "prefijo_cotizacion": body.prefijo,
        "prefijo_pedido":     f"PED-{body.prefijo}",
        "config": {
            "vigencia_cotizacion_dias": 15,
            "iva_aplicable":            True,
            "anticipo_pct":             0,
            "moneda":                   "MXN",
        },
        "activo":     True,
        "created_at": now,
        "updated_at": now,
    }
    await db.config_negocios.insert_one(doc)

    await sembrar_catalogo_cuentas(db, body.id)
    hoy = date.today()
    ultimo_dia = calendar.monthrange(hoy.year, hoy.month)[1]
    await abrir_periodo(
        db, body.id, hoy.strftime("%Y-%m"),
        hoy.replace(day=1).isoformat(), hoy.replace(day=ultimo_dia).isoformat(),
    )

    await db.usuarios.update_one({"_id": ObjectId(user["_id"])}, {"$addToSet": {"negocios": body.id}})
    return a_respuesta(doc)
