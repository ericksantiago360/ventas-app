"""
Registro y reversión de cobros.

Un cobro siempre va acompañado de un movimiento financiero de ingreso
en la cuenta donde entró el dinero (eso es lo que mueve el saldo en
Finanzas) y, opcionalmente, de su póliza contable.
"""
from datetime import datetime, timezone

from bson import ObjectId
from pymongo import ReturnDocument

from .contabilidad_integracion import crear_poliza_cobro


async def siguiente_numero_cobro(db, negocio_id: str) -> str:
    config = await db.config_negocios.find_one({"_id": negocio_id}, {"prefijo_cobro": 1})
    prefijo = (config or {}).get("prefijo_cobro") or "COB"
    contador = await db.contadores_cobros.find_one_and_update(
        {"_id": negocio_id},
        {"$inc": {"secuencia": 1}, "$set": {"updated_at": datetime.utcnow()}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return f"{prefijo}-{contador['secuencia']:06d}"


async def registrar_cobro(
    db,
    datos: dict,
    cuenta: dict,
    usuario_id: str,
    generar_poliza: bool = True,
) -> dict:
    """
    Inserta el cobro y su movimiento financiero.

    `datos` lleva los campos de CobroCreate más, opcionalmente,
    factura_id / factura_folio. Si `generar_poliza` es True, la póliza
    se crea al final; si falla (p. ej. falta el catálogo de cuentas)
    la excepción se propaga con el cobro y el movimiento ya guardados.
    Mongo corre como standalone, por lo que no hay transacción.
    """
    cobro = dict(datos)
    cobro["numero"] = await siguiente_numero_cobro(db, cobro["negocio_id"])
    cobro["estado"] = "confirmado"
    cobro["created_by"] = usuario_id
    cobro["created_at"] = datetime.utcnow()

    result = await db.cobros.insert_one(cobro)
    cobro["_id"] = result.inserted_id

    await db.movimientos_financieros.insert_one({
        "negocio_id":      cobro["negocio_id"],
        "cuenta_id":       cobro["cuenta_id"],
        "tipo":            "ingreso",
        "categoria":       "cobro_cliente",
        "importe":         cobro["importe"],
        "concepto":        cobro.get("concepto") or f"Cobro {cobro['numero']}",
        "referencia_tipo": "cobro",
        "referencia_id":   str(cobro["_id"]),
        "fecha":           cobro["fecha"],
        "estado":          "confirmado",
        "created_by":      usuario_id,
        "created_at":      datetime.utcnow(),
    })

    cobro["poliza_id"] = None
    if generar_poliza:
        cobro["poliza_id"] = await crear_poliza_cobro(
            db, cobro, cuenta_financiera=cuenta, usuario_id=usuario_id,
        )
        if cobro["poliza_id"]:
            await db.cobros.update_one({"_id": cobro["_id"]}, {"$set": {"poliza_id": cobro["poliza_id"]}})
    return cobro


async def cancelar_cobro(db, cobro_id: str, usuario_id: str, motivo: str = "") -> None:
    """
    Revierte un cobro: el cobro, su movimiento financiero y su póliza
    pasan a cancelados. El dashboard de Finanzas y los reportes contables
    solo suman registros confirmados/contabilizados.
    """
    if not cobro_id or not ObjectId.is_valid(cobro_id):
        return
    ahora = datetime.utcnow()
    await db.cobros.update_one(
        {"_id": ObjectId(cobro_id)},
        {"$set": {"estado": "cancelado", "cancelado_at": ahora, "cancelado_por": usuario_id, "motivo_cancelacion": motivo}},
    )
    await db.movimientos_financieros.update_many(
        {"referencia_tipo": "cobro", "referencia_id": cobro_id},
        {"$set": {"estado": "cancelado", "updated_at": ahora}},
    )
    await db.polizas_contables.update_many(
        {"referencia_tipo": "cobro", "referencia_id": cobro_id, "estado": {"$ne": "cancelada"}},
        {"$set": {
            "estado":              "cancelada",
            "usuario_cancelacion": usuario_id,
            "fecha_cancelacion":   datetime.now(timezone.utc),
            "updated_at":          datetime.now(timezone.utc),
        }},
    )
