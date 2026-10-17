from datetime import datetime, timezone
import uuid

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pymongo import ReturnDocument

from ..core.security import get_current_user
from ..core.database import get_db
from ..core.negocios import validar_referencia
from ..models.base import serialize_list
from ..services.contabilidad_integracion import crear_poliza_venta_pedido
from ..services.contabilidad_integracion import (
    crear_poliza_venta_pedido,
)


router = APIRouter()


# =========================================================
# ESTADOS COMERCIALES
# =========================================================

TRANSICIONES = {
    "confirmado": ["en_proceso", "cancelado"],
    "en_proceso": ["listo", "cancelado"],
    "listo": ["entregado", "cancelado"],
    "entregado": ["cobrado"],
    "cobrado": [],
    "cancelado": [],
}


ESTADOS_KANBAN = [
    "confirmado",
    "en_proceso",
    "listo",
    "entregado",
]


# =========================================================
# ETAPAS INTERNAS
# =========================================================

ETAPAS_INTERNAS = [
    "recibido",
    "en_corte",
    "en_acabado",
    "control_calidad",
    "listo_para_recoger",
]


async def etapas_negocio(db, negocio_id: str) -> list[str]:
    """
    Etapas internas del negocio según config_negocios.etapas_por_estado
    (estados en_proceso y listo). Si no hay configuración se usan
    ETAPAS_INTERNAS.
    """
    config = await db.config_negocios.find_one(
        {"_id": negocio_id},
        {"etapas_por_estado": 1},
    ) or {}

    por_estado = config.get("etapas_por_estado") or {}

    etapas = ["recibido"]

    for estado in ("en_proceso", "listo"):
        for etapa in por_estado.get(estado, []):
            if etapa not in etapas:
                etapas.append(etapa)

    return etapas if len(etapas) > 1 else ETAPAS_INTERNAS


# =========================================================
# UTILIDADES
# =========================================================

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


def validar_object_id(id: str):
    try:
        return ObjectId(id)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="ID inválido",
        )


async def obtener_pedido(
    db,
    id: str,
    user: dict,
):
    oid = validar_object_id(id)

    pedido = await db.pedidos.find_one({
        "_id": oid
    })

    if not pedido:
        raise HTTPException(
            status_code=404,
            detail="Pedido no encontrado",
        )

    check_business(
        user,
        pedido.get("negocio_id"),
    )

    return pedido


async def generar_numero_pedido(
    db,
    negocio_id: str,
):
    config = await db.config_negocios.find_one(
        {
            "_id": negocio_id
        },
        {
            "prefijo_pedido": 1
        },
    )

    if not config:
        raise HTTPException(
            status_code=404,
            detail="Configuración del negocio no encontrada",
        )

    prefijo = config.get("prefijo_pedido")

    if not prefijo:
        raise HTTPException(
            status_code=400,
            detail="El negocio no tiene prefijo de pedido configurado",
        )

    contador = await db.contadores_pedidos.find_one_and_update(
        {
            "_id": negocio_id
        },
        {
            "$inc": {
                "secuencia": 1
            },
            "$set": {
                "updated_at": datetime.now(
                    timezone.utc
                ).isoformat()
            },
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )

    return f"{prefijo}-{contador['secuencia']:06d}"


# =========================================================
# LISTAR PEDIDOS
# =========================================================

@router.get("/")
async def listar_pedidos(
    negocio_id: str,
    estado: str | None = None,
    page: int = 1,
    limit: int = 20,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_business(
        user,
        negocio_id,
    )

    if page < 1:
        page = 1

    if limit < 1:
        limit = 20

    if limit > 100:
        limit = 100

    filtro = {
        "negocio_id": negocio_id,
        "eliminado": {"$ne": True},
    }

    if estado:
        filtro["estado"] = estado

    skip = (page - 1) * limit

    cursor = (
        db.pedidos
        .find(filtro)
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    )

    docs = await cursor.to_list(
        length=limit
    )

    total = await db.pedidos.count_documents(
        filtro
    )

    return {
        "data": serialize_list(docs),
        "total": total,
        "page": page,
        "limit": limit,
    }



# =========================================================
# KANBAN
# =========================================================

@router.get("/kanban")
async def kanban(
    negocio_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_business(
        user,
        negocio_id,
    )

    resultado = {
        estado: []
        for estado in ESTADOS_KANBAN
    }

    cursor = db.pedidos.find({
        "negocio_id": negocio_id,
        "eliminado": {"$ne": True},
        "estado": {
            "$in": ESTADOS_KANBAN
        },
    }).sort(
        "created_at",
        -1,
    )

    async for doc in cursor:
        doc["_id"] = str(
            doc["_id"]
        )

        resultado[
            doc["estado"]
        ].append(doc)

    return resultado


# =========================================================
# ETAPAS INTERNAS DEL NEGOCIO
# =========================================================

@router.get("/etapas")
async def listar_etapas(
    negocio_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_business(
        user,
        negocio_id,
    )

    return {
        "data": await etapas_negocio(
            db,
            negocio_id,
        )
    }


# =========================================================
# OBTENER PEDIDO
# =========================================================

@router.get("/{id}")
async def obtener_pedido_endpoint(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    pedido = await obtener_pedido(
        db,
        id,
        user,
    )

    return serialize_list(
        [pedido]
    )[0]


# =========================================================
# CREAR PEDIDO
# =========================================================

@router.post("/", status_code=201)
async def crear_pedido(
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    negocio_id = body.get(
        "negocio_id"
    )

    if not negocio_id:
        raise HTTPException(
            status_code=400,
            detail="negocio_id es obligatorio",
        )

    check_business(
        user,
        negocio_id,
    )
    await validar_referencia(db.clientes, body.get("cliente_id"), negocio_id, "Cliente")
    await validar_referencia(db.cotizaciones, body.get("cotizacion_id"), negocio_id, "Cotización")

    numero = await generar_numero_pedido(
        db,
        negocio_id,
    )

    ahora = datetime.now(
        timezone.utc
    ).isoformat()

    body["numero"] = numero
    body.setdefault(
        "estado",
        "confirmado",
    )
    body.setdefault(
        "etapa_interna",
        "recibido",
    )
    body.setdefault(
        "items",
        [],
    )
    body.setdefault(
        "subtotal",
        0,
    )
    body.setdefault(
        "iva",
        0,
    )
    body.setdefault(
        "total",
        0,
    )
    body.setdefault(
        "pagos",
        [],
    )
    body.setdefault(
        "archivos",
        [],
    )
    body.setdefault(
        "historial",
        [],
    )

    body["saldo_pendiente"] = (
        body.get("total", 0)
    )

    body["created_at"] = ahora
    body["updated_at"] = ahora

    result = await db.pedidos.insert_one(body)

    # =========================================================
    # INTEGRACIÓN CONTABLE
    # =========================================================
    pedido_creado = await db.pedidos.find_one({
        "_id": result.inserted_id
    })

    poliza_id = None

    if float(body.get("total", 0) or 0) > 0:
        poliza_id = await crear_poliza_venta_pedido(
            db,
            pedido_creado,
            str(user.get("_id", "")),
        )

    return {
        "ok": True,
        "id": str(result.inserted_id),
        "numero": numero,
        "poliza_id": poliza_id,
    }

# =========================================================
# EDITAR PEDIDO
# =========================================================

@router.put("/{id}")
async def editar_pedido(
    id: str,
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    pedido = await obtener_pedido(
        db,
        id,
        user,
    )

    if pedido.get("estado") in [
        "entregado",
        "cobrado",
        "cancelado",
    ]:
        raise HTTPException(
            status_code=400,
            detail=(
                "No se puede editar "
                "un pedido en estado "
                f"{pedido.get('estado')}"
            ),
        )

    campos_protegidos = {
        "_id",
        "numero",
        "negocio_id",
        "created_at",
        "historial",
        "pagos",
    }

    actualizacion = {
        key: value
        for key, value in body.items()
        if key not in campos_protegidos
    }
    await validar_referencia(db.clientes, actualizacion.get("cliente_id"), pedido["negocio_id"], "Cliente")
    await validar_referencia(db.cotizaciones, actualizacion.get("cotizacion_id"), pedido["negocio_id"], "Cotización")

    actualizacion[
        "updated_at"
    ] = datetime.now(
        timezone.utc
    ).isoformat()

    await db.pedidos.update_one(
        {
            "_id": pedido["_id"]
        },
        {
            "$set": actualizacion
        },
    )

    actualizado = await db.pedidos.find_one(
        {
            "_id": pedido["_id"]
        }
    )

    return serialize_list(
        [actualizado]
    )[0]


# =========================================================
# ELIMINAR / CANCELAR PEDIDO
# =========================================================

@router.delete("/{id}")
async def eliminar_pedido(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    pedido = await obtener_pedido(
        db,
        id,
        user,
    )

    estado = pedido.get(
        "estado"
    )

    if estado in [
        "entregado",
        "cobrado",
    ]:
        raise HTTPException(
            status_code=400,
            detail=(
                "Un pedido entregado "
                "o cobrado no puede eliminarse"
            ),
        )

    ahora = datetime.now(
        timezone.utc
    ).isoformat()

    entrada_historial = {
        "estado_anterior": estado,
        "estado_nuevo": "cancelado",
        "etapa_interna": pedido.get(
            "etapa_interna"
        ),
        "nota": "Pedido cancelado",
        "fecha": ahora,
    }

    await db.pedidos.update_one(
        {
            "_id": pedido["_id"]
        },
        {
            "$set": {
                "estado": "cancelado",
                "updated_at": ahora,
            },
            "$push": {
                "historial": entrada_historial
            },
        },
    )

    return {
        "ok": True,
        "message": "Pedido cancelado correctamente",
        "id": id,
    }

@router.patch("/{id}/eliminar")
async def marcar_pedido_eliminado(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    pedido = await obtener_pedido(
        db,
        id,
        user,
    )

    estado = pedido.get("estado")
    negocio_id = pedido.get("negocio_id")

    if pedido.get("eliminado") is True:
        raise HTTPException(
            status_code=400,
            detail="El pedido ya está eliminado",
        )

    if estado in ["entregado", "cobrado"]:
        raise HTTPException(
            status_code=400,
            detail=(
                "No se puede eliminar un pedido "
                "entregado o cobrado"
            ),
        )

    if pedido.get("pagos"):
        raise HTTPException(
            status_code=400,
            detail=(
                "No se puede eliminar un pedido "
                "con pagos registrados"
            ),
        )

    cobros_asociados = await db.cobros.count_documents({
        "pedido_id": id,
        "negocio_id": negocio_id,
    })

    if cobros_asociados > 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "No se puede eliminar un pedido "
                "con cobros asociados en Finanzas"
            ),
        )

    ahora = datetime.now(timezone.utc).isoformat()

    await db.pedidos.update_one(
        {
            "_id": pedido["_id"],
            "negocio_id": negocio_id,
            "eliminado": {"$ne": True},
        },
        {
            "$set": {
                "eliminado": True,
                "eliminado_at": ahora,
                "updated_at": ahora,
            },
            "$push": {
                "historial": {
                    "estado_anterior": estado,
                    "estado_nuevo": estado,
                    "etapa_interna": pedido.get(
                        "etapa_interna"
                    ),
                    "nota": (
                        "Pedido ocultado mediante "
                        "eliminación lógica"
                    ),
                    "fecha": ahora,
                }
            },
        },
    )

    return {
        "ok": True,
        "message": "Pedido eliminado de la lista",
        "id": id,
    }


# =========================================================
# CAMBIAR ESTADO
# =========================================================

@router.patch("/{id}/estado")
async def cambiar_estado(
    id: str,
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    pedido = await obtener_pedido(
        db,
        id,
        user,
    )

    estado_actual = pedido.get(
        "estado"
    )

    estado_nuevo = body.get(
        "estado"
    )

    if not estado_nuevo:
        raise HTTPException(
            status_code=400,
            detail="estado es obligatorio",
        )

    if estado_nuevo not in TRANSICIONES.get(
        estado_actual,
        [],
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Transición inválida: "
                f"{estado_actual} → "
                f"{estado_nuevo}"
            ),
        )

    ahora = datetime.now(
        timezone.utc
    ).isoformat()

    entrada_historial = {
        "estado_anterior": estado_actual,
        "estado_nuevo": estado_nuevo,
        "etapa_interna": body.get(
            "etapa_interna"
        ),
        "nota": body.get(
            "nota",
            "",
        ),
        "fecha": ahora,
    }

    update = {
        "$set": {
            "estado": estado_nuevo,
            "updated_at": ahora,
        },
        "$push": {
            "historial": entrada_historial
        },
    }

    if body.get("etapa_interna"):
        if body["etapa_interna"] not in await etapas_negocio(
            db,
            pedido["negocio_id"],
        ):
            raise HTTPException(
                status_code=400,
                detail="Etapa interna inválida",
            )

        update["$set"][
            "etapa_interna"
        ] = body[
            "etapa_interna"
        ]

    await db.pedidos.update_one(
        {
            "_id": pedido["_id"]
        },
        update,
    )

    return {
        "ok": True,
        "estado": estado_nuevo,
    }


# =========================================================
# CAMBIAR ETAPA INTERNA
# =========================================================

@router.patch("/{id}/etapa")
async def cambiar_etapa(
    id: str,
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    pedido = await obtener_pedido(
        db,
        id,
        user,
    )

    etapa = body.get(
        "etapa_interna"
    )

    if etapa not in await etapas_negocio(
        db,
        pedido["negocio_id"],
    ):
        raise HTTPException(
            status_code=400,
            detail="Etapa interna inválida",
        )

    ahora = datetime.now(
        timezone.utc
    ).isoformat()

    historial = {
        "tipo": "etapa_interna",
        "etapa_anterior": pedido.get(
            "etapa_interna"
        ),
        "etapa_nueva": etapa,
        "nota": body.get(
            "nota",
            "",
        ),
        "fecha": ahora,
    }

    await db.pedidos.update_one(
        {
            "_id": pedido["_id"]
        },
        {
            "$set": {
                "etapa_interna": etapa,
                "updated_at": ahora,
            },
            "$push": {
                "historial": historial
            },
        },
    )

    return {
        "ok": True,
        "etapa_interna": etapa,
    }


# =========================================================
# HISTORIAL
# =========================================================

@router.get("/{id}/historial")
async def historial_pedido(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    pedido = await obtener_pedido(
        db,
        id,
        user,
    )

    return {
        "data": pedido.get(
            "historial",
            [],
        )
    }


# =========================================================
# REGISTRAR PAGO
# =========================================================

@router.post("/{id}/pagos", status_code=201)
async def registrar_pago(
    id: str,
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    pedido = await obtener_pedido(
        db,
        id,
        user,
    )

    if pedido.get("estado") == "cancelado":
        raise HTTPException(
            status_code=400,
            detail="No se puede registrar un pago en un pedido cancelado",
        )

    monto = body.get(
        "monto"
    )

    if monto is None:
        raise HTTPException(
            status_code=400,
            detail="monto es obligatorio",
        )

    try:
        monto = float(monto)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="monto inválido",
        )

    if monto <= 0:
        raise HTTPException(
            status_code=400,
            detail="El monto debe ser mayor a cero",
        )

    pago = dict(body)

    pago["id"] = str(
        uuid.uuid4()
    )[:8]

    pago["monto"] = monto

    pago.setdefault(
        "fecha",
        datetime.now(
            timezone.utc
        ).isoformat(),
    )

    pagos_actuales = pedido.get(
        "pagos",
        [],
    )

    total_pagado = sum(
        float(p.get("monto", 0))
        for p in pagos_actuales
    )

    total_pagado += monto

    total = float(
        pedido.get(
            "total",
            0,
        )
    )

    saldo = max(
        total - total_pagado,
        0,
    )

    await db.pedidos.update_one(
        {
            "_id": pedido["_id"]
        },
        {
            "$push": {
                "pagos": pago
            },
            "$set": {
                "saldo_pendiente": saldo,
                "updated_at": datetime.now(
                    timezone.utc
                ).isoformat(),
            },
        },
    )

    return {
        "ok": True,
        "pago_id": pago["id"],
        "total_pagado": total_pagado,
        "saldo_pendiente": saldo,
    }
