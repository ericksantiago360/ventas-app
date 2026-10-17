import calendar
from datetime import date, datetime, timezone
from typing import Literal, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.negocios import negocios_del_usuario, verificar_acceso
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


class NegocioUpdate(BaseModel):
    nombre:  Optional[str] = Field(default=None, min_length=2, max_length=120)
    tipo:    Optional[GIROS] = None
    prefijo: Optional[str] = Field(default=None, pattern=r"^[A-Z0-9]{2,6}$")
    activo:  Optional[bool] = None


CAMPOS_LISTA = {"nombre": 1, "tipo": 1, "prefijo_cotizacion": 1, "activo": 1}


def a_respuesta(doc: dict) -> dict:
    return {
        "id":      doc["_id"],
        "nombre":  doc.get("nombre") or doc["_id"],
        "tipo":    doc.get("tipo", ""),
        "prefijo": doc.get("prefijo_cotizacion", ""),
        "activo":  doc.get("activo", True),
    }


@router.get("")
async def listar_negocios(
    incluir_inactivos: bool = Query(False),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Negocios a los que el usuario tiene acceso, desde config_negocios.
    Los inactivos solo se listan a administradores que los piden (para reactivarlos).
    """
    filtro: dict = {"_id": {"$in": sorted(negocios_del_usuario(user))}}
    if not (incluir_inactivos and user.get("rol") == "admin"):
        filtro["activo"] = {"$ne": False}
    docs = await db.config_negocios.find(filtro, CAMPOS_LISTA).sort("nombre", 1).to_list(100)
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


@router.put("/{id}")
async def actualizar_negocio(
    id: str,
    body: NegocioUpdate,
    db=Depends(get_db),
    user=Depends(require_admin),
):
    """
    Edita nombre, giro, prefijo o estado. El identificador no cambia: es el negocio_id
    de todos sus registros. El prefijo nuevo solo aplica a folios futuros.
    Desactivar oculta el negocio de los selectores; sus datos se conservan.
    """
    verificar_acceso(user, id)
    negocio = await db.config_negocios.find_one({"_id": id})
    if not negocio:
        raise HTTPException(404, "Negocio no encontrado")

    if body.activo is False and negocio.get("activo", True):
        # Sin negocios activos el administrador no podría ni volver a esta pantalla
        otros_activos = await db.config_negocios.count_documents({
            "_id": {"$in": sorted(negocios_del_usuario(user) - {id})},
            "activo": {"$ne": False},
        })
        if not otros_activos:
            raise HTTPException(400, "No puedes desactivar tu único negocio activo")

    campos: dict = {"updated_at": datetime.now(timezone.utc)}
    if body.nombre is not None:
        campos["nombre"] = body.nombre.strip()
    if body.tipo is not None:
        campos["tipo"] = body.tipo
    if body.prefijo is not None:
        campos["prefijo_cotizacion"] = body.prefijo
        campos["prefijo_pedido"] = f"PED-{body.prefijo}"
    if body.activo is not None:
        campos["activo"] = body.activo

    await db.config_negocios.update_one({"_id": id}, {"$set": campos})
    return a_respuesta({**negocio, **campos})
