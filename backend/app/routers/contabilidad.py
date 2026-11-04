from datetime import date, datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user
from app.core.negocios import verificar_acceso
from pymongo import ReturnDocument

router = APIRouter(
    prefix="/contabilidad",
    tags=["Contabilidad"],
)


# ============================================================
# UTILIDADES
# ============================================================

def validar_object_id(id: str):
    try:
        return ObjectId(id)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="ID inválido",
        )


# ============================================================
# CATÁLOGO DE CUENTAS
# ============================================================

@router.get("/cuentas")
async def listar_cuentas(
    negocio_id: str,
    activo: Optional[bool] = None,
    tipo: Optional[str] = None,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)

    filtro = {
        "negocio_id": negocio_id,
    }

    if activo is not None:
        filtro["activo"] = activo

    if tipo:
        filtro["tipo"] = tipo

    cuentas = []

    cursor = (
        db.catalogo_cuentas
        .find(filtro)
        .sort("codigo", 1)
    )

    async for cuenta in cursor:
        cuenta["id"] = str(cuenta["_id"])
        cuenta.pop("_id", None)
        cuentas.append(cuenta)

    return cuentas


@router.get("/cuentas/{id}")
async def obtener_cuenta(
    id: str,
    negocio_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)

    cuenta = await db.catalogo_cuentas.find_one({
        "_id": validar_object_id(id),
        "negocio_id": negocio_id,
    })

    if not cuenta:
        raise HTTPException(
            status_code=404,
            detail="Cuenta contable no encontrada",
        )

    cuenta["id"] = str(cuenta["_id"])
    cuenta.pop("_id", None)

    return cuenta


@router.post("/cuentas")
async def crear_cuenta(
    datos: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    negocio_id = datos.get("negocio_id")

    if not negocio_id:
        raise HTTPException(
            status_code=400,
            detail="negocio_id es obligatorio",
        )

    verificar_acceso(user, negocio_id)

    codigo = str(
        datos.get("codigo", "")
    ).strip()

    nombre = str(
        datos.get("nombre", "")
    ).strip()

    tipo = datos.get("tipo")

    naturaleza = datos.get(
        "naturaleza"
    )

    if not codigo:
        raise HTTPException(
            status_code=400,
            detail="El código es obligatorio",
        )

    if not nombre:
        raise HTTPException(
            status_code=400,
            detail="El nombre es obligatorio",
        )

    tipos_validos = [
        "activo",
        "pasivo",
        "capital",
        "ingreso",
        "costo",
        "gasto",
    ]

    if tipo not in tipos_validos:
        raise HTTPException(
            status_code=400,
            detail="Tipo de cuenta inválido",
        )

    naturalezas_validas = [
        "deudora",
        "acreedora",
    ]

    if naturaleza not in naturalezas_validas:
        raise HTTPException(
            status_code=400,
            detail="Naturaleza inválida",
        )

    existente = await db.catalogo_cuentas.find_one({
        "negocio_id": negocio_id,
        "codigo": codigo,
    })

    if existente:
        raise HTTPException(
            status_code=409,
            detail="Ya existe una cuenta con ese código",
        )

    cuenta = {
        "negocio_id": negocio_id,
        "codigo": codigo,
        "nombre": nombre,
        "tipo": tipo,
        "subtipo": datos.get("subtipo"),
        "naturaleza": naturaleza,
        "nivel": int(
            datos.get("nivel", 1)
        ),
        "padre": datos.get("padre"),
        "descripcion": datos.get(
            "descripcion",
            "",
        ),
        "activo": datos.get(
            "activo",
            True,
        ),
        "sistema": False,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }

    result = await db.catalogo_cuentas.insert_one(
        cuenta
    )

    cuenta["id"] = str(
        result.inserted_id
    )

    cuenta.pop("_id", None)

    return cuenta


@router.put("/cuentas/{id}")
async def editar_cuenta(
    id: str,
    datos: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    negocio_id = datos.get("negocio_id")

    if not negocio_id:
        raise HTTPException(
            status_code=400,
            detail="negocio_id es obligatorio",
        )

    verificar_acceso(user, negocio_id)

    cuenta = await db.catalogo_cuentas.find_one({
        "_id": validar_object_id(id),
        "negocio_id": negocio_id,
    })

    if not cuenta:
        raise HTTPException(
            status_code=404,
            detail="Cuenta contable no encontrada",
        )

    if cuenta.get("sistema"):
        raise HTTPException(
            status_code=400,
            detail="Las cuentas del sistema no pueden modificarse",
        )

    campos = {}

    for campo in [
        "nombre",
        "subtipo",
        "naturaleza",
        "nivel",
        "padre",
        "descripcion",
        "activo",
    ]:
        if campo in datos:
            campos[campo] = datos[campo]

    campos["updated_at"] = datetime.utcnow()

    await db.catalogo_cuentas.update_one(
        {
            "_id": validar_object_id(id),
            "negocio_id": negocio_id,
        },
        {
            "$set": campos,
        },
    )

    cuenta_actualizada = await db.catalogo_cuentas.find_one({
        "_id": validar_object_id(id),
        "negocio_id": negocio_id,
    })

    cuenta_actualizada["id"] = str(
        cuenta_actualizada["_id"]
    )

    cuenta_actualizada.pop("_id", None)

    return cuenta_actualizada


@router.delete("/cuentas/{id}")
async def desactivar_cuenta(
    id: str,
    negocio_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)

    cuenta = await db.catalogo_cuentas.find_one({
        "_id": validar_object_id(id),
        "negocio_id": negocio_id,
    })

    if not cuenta:
        raise HTTPException(
            status_code=404,
            detail="Cuenta contable no encontrada",
        )

    if cuenta.get("sistema"):
        raise HTTPException(
            status_code=400,
            detail="Las cuentas del sistema no pueden desactivarse",
        )

    await db.catalogo_cuentas.update_one(
        {
            "_id": validar_object_id(id),
            "negocio_id": negocio_id,
        },
        {
            "$set": {
                "activo": False,
                "updated_at": datetime.utcnow(),
            }
        },
    )

    return {
        "ok": True,
        "message": "Cuenta contable desactivada",
        "id": id,
    }


# ============================================================
# PERIODOS CONTABLES
# ============================================================

@router.get("/periodos")
async def listar_periodos(
    negocio_id: str,
    estado: Optional[str] = None,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)

    filtro = {
        "negocio_id": negocio_id,
    }

    if estado:
        filtro["estado"] = estado

    periodos = []

    cursor = (
        db.periodos_contables
        .find(filtro)
        .sort("periodo", -1)
    )

    async for periodo in cursor:
        periodo["id"] = str(
            periodo["_id"]
        )
        periodo.pop("_id", None)
        periodos.append(periodo)

    return periodos


@router.post("/periodos")
async def crear_periodo(
    datos: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    negocio_id = datos.get("negocio_id")

    if not negocio_id:
        raise HTTPException(
            status_code=400,
            detail="negocio_id es obligatorio",
        )

    verificar_acceso(user, negocio_id)

    periodo = str(
        datos.get("periodo", "")
    ).strip()

    if not periodo:
        raise HTTPException(
            status_code=400,
            detail="El periodo es obligatorio",
        )

    existente = await db.periodos_contables.find_one({
        "negocio_id": negocio_id,
        "periodo": periodo,
    })

    if existente:
        raise HTTPException(
            status_code=409,
            detail="El periodo ya existe",
        )

    fecha_inicio = datos.get(
        "fecha_inicio"
    )

    fecha_fin = datos.get(
        "fecha_fin"
    )

    nuevo_periodo = {
        "negocio_id": negocio_id,
        "periodo": periodo,
        "fecha_inicio": fecha_inicio,
        "fecha_fin": fecha_fin,
        "estado": "abierto",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }

    result = await db.periodos_contables.insert_one(
        nuevo_periodo
    )

    nuevo_periodo["id"] = str(
        result.inserted_id
    )

    nuevo_periodo.pop("_id", None)

    return nuevo_periodo


@router.patch("/periodos/{id}/estado")
async def cambiar_estado_periodo(
    id: str,
    estado: str,
    negocio_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)

    estados_validos = [
        "abierto",
        "cerrado",
    ]

    if estado not in estados_validos:
        raise HTTPException(
            status_code=400,
            detail="Estado de periodo inválido",
        )

    periodo = await db.periodos_contables.find_one({
        "_id": validar_object_id(id),
        "negocio_id": negocio_id,
    })

    if not periodo:
        raise HTTPException(
            status_code=404,
            detail="Periodo contable no encontrado",
        )

    await db.periodos_contables.update_one(
        {
            "_id": validar_object_id(id),
            "negocio_id": negocio_id,
        },
        {
            "$set": {
                "estado": estado,
                "updated_at": datetime.utcnow(),
            }
        },
    )

    return {
        "ok": True,
        "message": f"Periodo {estado}",
        "id": id,
        "estado": estado,
    }


# ============================================================
# PÓLIZAS CONTABLES
# ============================================================

TIPOS_POLIZA = {
    "diario",
    "ingreso",
    "egreso",
    "traspaso",
    "ajuste",
}


async def generar_numero_poliza(db, negocio_id: str, tipo: str):
    """
    Genera números consecutivos por negocio y tipo de póliza.
    Ejemplo:
        POL-DIA-000001
        POL-ING-000001
        POL-EGR-000001
    """

    prefijos = {
        "diario": "POL-DIA",
        "ingreso": "POL-ING",
        "egreso": "POL-EGR",
        "traspaso": "POL-TRA",
        "ajuste": "POL-AJU",
    }

    prefijo = prefijos.get(tipo, "POL")

    contador = await db.contadores_polizas.find_one_and_update(
        {
            "_id": f"{negocio_id}:{tipo}",
        },
        {
            "$inc": {
                "secuencia": 1,
            },
            "$set": {
                "updated_at": datetime.utcnow(),
            },
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )

    secuencia = contador["secuencia"]

    return f"{prefijo}-{secuencia:06d}"


# ============================================================
# CREAR PÓLIZA
# ============================================================

@router.post("/polizas")
async def crear_poliza(
    datos: dict,
    db=Depends(get_db),
    usuario=Depends(get_current_user),
):
    negocio_id = datos.get("negocio_id")

    verificar_acceso(usuario, negocio_id)

    tipo = datos.get("tipo", "diario")

    if tipo not in TIPOS_POLIZA:
        raise HTTPException(
            status_code=400,
            detail="Tipo de póliza inválido",
        )

    fecha = datos.get("fecha")

    if not fecha:
        fecha = datetime.utcnow()

    periodo = datos.get("periodo")

    if not periodo:
        if isinstance(fecha, datetime):
            periodo = fecha.strftime("%Y-%m")
        else:
            periodo = str(fecha)[:7]

    # Verificar periodo
    periodo_doc = await db.periodos_contables.find_one({
        "negocio_id": negocio_id,
        "periodo": periodo,
    })

    if not periodo_doc:
        raise HTTPException(
            status_code=400,
            detail=f"El periodo contable {periodo} no existe",
        )

    if periodo_doc.get("estado") != "abierto":
        raise HTTPException(
            status_code=400,
            detail=f"El periodo contable {periodo} está cerrado",
        )

    numero = await generar_numero_poliza(
        db,
        negocio_id,
        tipo,
    )

    now = datetime.utcnow()

    poliza = {
        "negocio_id": negocio_id,
        "numero": numero,
        "tipo": tipo,
        "fecha": fecha,
        "periodo": periodo,
        "concepto": datos.get("concepto", ""),
        "referencia_tipo": datos.get("referencia_tipo"),
        "referencia_id": datos.get("referencia_id"),
        "estado": "borrador",
        "total_debe": 0.0,
        "total_haber": 0.0,
        "usuario_creacion": str(
            usuario.get("_id") or usuario.get("id") or ""
        ),
        "created_at": now,
        "updated_at": now,
    }

    result = await db.polizas_contables.insert_one(poliza)

    poliza["_id"] = str(result.inserted_id)

    return poliza


# ============================================================
# LISTAR PÓLIZAS
# ============================================================

@router.get("/polizas")
async def listar_polizas(
    negocio_id: str = Query(...),
    periodo: Optional[str] = Query(None),
    estado: Optional[str] = Query(None),
    tipo: Optional[str] = Query(None),
    db=Depends(get_db),
    usuario=Depends(get_current_user),
):
    verificar_acceso(usuario, negocio_id)

    filtro = {
        "negocio_id": negocio_id,
    }

    if periodo:
        filtro["periodo"] = periodo

    if estado:
        filtro["estado"] = estado

    if tipo:
        filtro["tipo"] = tipo

    cursor = db.polizas_contables.find(
        filtro
    ).sort(
        [
            ("fecha", -1),
            ("created_at", -1),
        ]
    )

    resultado = []

    async for poliza in cursor:
        poliza["_id"] = str(poliza["_id"])
        resultado.append(poliza)

    return resultado


# ============================================================
# OBTENER PÓLIZA
# ============================================================

@router.get("/polizas/{id}")
async def obtener_poliza(
    id: str,
    db=Depends(get_db),
    usuario=Depends(get_current_user),
):
    oid = validar_object_id(id)

    poliza = await db.polizas_contables.find_one({
        "_id": oid,
    })

    if not poliza:
        raise HTTPException(
            status_code=404,
            detail="Póliza no encontrada",
        )

    verificar_acceso(
        usuario,
        poliza["negocio_id"],
    )

    poliza["_id"] = str(poliza["_id"])

    movimientos = []

    cursor = db.movimientos_contables.find({
        "poliza_id": id,
    }).sort(
        "linea",
        1,
    )

    async for movimiento in cursor:
        movimiento["_id"] = str(movimiento["_id"])
        movimientos.append(movimiento)

    poliza["movimientos"] = movimientos

    return poliza


# ============================================================
# AGREGAR MOVIMIENTO A PÓLIZA
# ============================================================

@router.post("/polizas/{id}/movimientos")
async def agregar_movimiento_poliza(
    id: str,
    datos: dict,
    db=Depends(get_db),
    usuario=Depends(get_current_user),
):
    oid = validar_object_id(id)

    poliza = await db.polizas_contables.find_one({
        "_id": oid,
    })

    if not poliza:
        raise HTTPException(
            status_code=404,
            detail="Póliza no encontrada",
        )

    verificar_acceso(
        usuario,
        poliza["negocio_id"],
    )

    if poliza.get("estado") != "borrador":
        raise HTTPException(
            status_code=400,
            detail="Solo se pueden modificar pólizas en borrador",
        )

    cuenta_id = datos.get("cuenta_id")

    if not cuenta_id:
        raise HTTPException(
            status_code=400,
            detail="La cuenta contable es obligatoria",
        )

    cuenta = await db.catalogo_cuentas.find_one({
        "_id": validar_object_id(cuenta_id),
        "negocio_id": poliza["negocio_id"],
        "activo": True,
    })

    if not cuenta:
        raise HTTPException(
            status_code=404,
            detail="Cuenta contable no encontrada",
        )

    debe = float(datos.get("debe", 0) or 0)
    haber = float(datos.get("haber", 0) or 0)

    if debe < 0 or haber < 0:
        raise HTTPException(
            status_code=400,
            detail="Debe y Haber no pueden ser negativos",
        )

    if debe == 0 and haber == 0:
        raise HTTPException(
            status_code=400,
            detail="El movimiento debe tener un importe",
        )

    if debe > 0 and haber > 0:
        raise HTTPException(
            status_code=400,
            detail="Un movimiento no puede tener Debe y Haber simultáneamente",
        )

    ultimo = await db.movimientos_contables.find_one(
        {
            "poliza_id": id,
        },
        sort=[
            ("linea", -1),
        ],
    )

    linea = (
        int(ultimo["linea"]) + 1
        if ultimo
        else 1
    )

    movimiento = {
        "negocio_id": poliza["negocio_id"],
        "poliza_id": id,
        "linea": linea,
        "cuenta_id": cuenta_id,
        "codigo_cuenta": cuenta.get("codigo"),
        "nombre_cuenta": cuenta.get("nombre"),
        "concepto": datos.get(
            "concepto",
            poliza.get("concepto", ""),
        ),
        "debe": debe,
        "haber": haber,
        "created_at": datetime.utcnow(),
    }

    result = await db.movimientos_contables.insert_one(
        movimiento
    )

    movimiento["_id"] = str(result.inserted_id)

    # Actualizar totales
    totales = await db.movimientos_contables.aggregate([
        {
            "$match": {
                "poliza_id": id,
            }
        },
        {
            "$group": {
                "_id": None,
                "total_debe": {
                    "$sum": "$debe",
                },
                "total_haber": {
                    "$sum": "$haber",
                },
            }
        },
    ]).to_list(1)

    total_debe = (
        float(totales[0]["total_debe"])
        if totales
        else 0.0
    )

    total_haber = (
        float(totales[0]["total_haber"])
        if totales
        else 0.0
    )

    await db.polizas_contables.update_one(
        {
            "_id": oid,
        },
        {
            "$set": {
                "total_debe": total_debe,
                "total_haber": total_haber,
                "updated_at": datetime.utcnow(),
            }
        },
    )

    return movimiento


# ============================================================
# ELIMINAR MOVIMIENTO DE PÓLIZA
# ============================================================

@router.delete("/polizas/{id}/movimientos/{movimiento_id}")
async def eliminar_movimiento_poliza(
    id: str,
    movimiento_id: str,
    db=Depends(get_db),
    usuario=Depends(get_current_user),
):
    poliza_oid = validar_object_id(id)
    movimiento_oid = validar_object_id(movimiento_id)

    poliza = await db.polizas_contables.find_one({
        "_id": poliza_oid,
    })

    if not poliza:
        raise HTTPException(
            status_code=404,
            detail="Póliza no encontrada",
        )

    verificar_acceso(
        usuario,
        poliza["negocio_id"],
    )

    if poliza.get("estado") != "borrador":
        raise HTTPException(
            status_code=400,
            detail="Solo se pueden modificar pólizas en borrador",
        )

    result = await db.movimientos_contables.delete_one({
        "_id": movimiento_oid,
        "poliza_id": id,
    })

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Movimiento no encontrado",
        )

    # Recalcular totales
    totales = await db.movimientos_contables.aggregate([
        {
            "$match": {
                "poliza_id": id,
            }
        },
        {
            "$group": {
                "_id": None,
                "total_debe": {
                    "$sum": "$debe",
                },
                "total_haber": {
                    "$sum": "$haber",
                },
            }
        },
    ]).to_list(1)

    total_debe = (
        float(totales[0]["total_debe"])
        if totales
        else 0.0
    )

    total_haber = (
        float(totales[0]["total_haber"])
        if totales
        else 0.0
    )

    await db.polizas_contables.update_one(
        {
            "_id": poliza_oid,
        },
        {
            "$set": {
                "total_debe": total_debe,
                "total_haber": total_haber,
                "updated_at": datetime.utcnow(),
            }
        },
    )

    return {
        "ok": True,
        "message": "Movimiento eliminado correctamente",
        "total_debe": total_debe,
        "total_haber": total_haber,
    }


# ============================================================
# CONTABILIZAR PÓLIZA
# ============================================================

@router.patch("/polizas/{id}/contabilizar")
async def contabilizar_poliza(
    id: str,
    db=Depends(get_db),
    usuario=Depends(get_current_user),
):
    oid = validar_object_id(id)

    poliza = await db.polizas_contables.find_one({
        "_id": oid,
    })

    if not poliza:
        raise HTTPException(
            status_code=404,
            detail="Póliza no encontrada",
        )

    verificar_acceso(
        usuario,
        poliza["negocio_id"],
    )

    if poliza.get("estado") != "borrador":
        raise HTTPException(
            status_code=400,
            detail="La póliza no está en borrador",
        )

    total_debe = float(
        poliza.get("total_debe", 0)
    )

    total_haber = float(
        poliza.get("total_haber", 0)
    )

    if total_debe <= 0 or total_haber <= 0:
        raise HTTPException(
            status_code=400,
            detail="La póliza debe tener movimientos en Debe y Haber",
        )

    diferencia = round(
        total_debe - total_haber,
        2,
    )

    if diferencia != 0:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "La póliza está descuadrada",
                "total_debe": total_debe,
                "total_haber": total_haber,
                "diferencia": diferencia,
            },
        )

    now = datetime.utcnow()

    await db.polizas_contables.update_one(
        {
            "_id": oid,
        },
        {
            "$set": {
                "estado": "contabilizada",
                "usuario_contabilizacion": str(
                    usuario.get("_id")
                    or usuario.get("id")
                    or ""
                ),
                "fecha_contabilizacion": now,
                "updated_at": now,
            }
        },
    )

    return {
        "ok": True,
        "message": "Póliza contabilizada correctamente",
        "id": id,
        "numero": poliza["numero"],
        "total_debe": total_debe,
        "total_haber": total_haber,
    }


# ============================================================
# CANCELAR PÓLIZA
# ============================================================

@router.patch("/polizas/{id}/cancelar")
async def cancelar_poliza(
    id: str,
    db=Depends(get_db),
    usuario=Depends(get_current_user),
):
    oid = validar_object_id(id)

    poliza = await db.polizas_contables.find_one({
        "_id": oid,
    })

    if not poliza:
        raise HTTPException(
            status_code=404,
            detail="Póliza no encontrada",
        )

    verificar_acceso(
        usuario,
        poliza["negocio_id"],
    )

    if poliza.get("estado") == "cancelada":
        raise HTTPException(
            status_code=400,
            detail="La póliza ya está cancelada",
        )

    await db.polizas_contables.update_one(
        {
            "_id": oid,
        },
        {
            "$set": {
                "estado": "cancelada",
                "usuario_cancelacion": str(
                    usuario.get("_id")
                    or usuario.get("id")
                    or ""
                ),
                "fecha_cancelacion": datetime.utcnow(),
                "updated_at": datetime.utcnow(),
            }
        },
    )

    return {
        "ok": True,
        "message": "Póliza cancelada correctamente",
        "id": id,
    }
# ============================================================
# SPRINT 3 — BALANZA DE COMPROBACIÓN
# ============================================================

@router.get("/reportes/balanza-comprobacion")
async def balanza_comprobacion(
    negocio_id: str,
    periodo: str | None = None,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Balanza de comprobación basada únicamente en pólizas
    contabilizadas.

    Regla:
        Total Debe = Total Haber
    """

    verificar_acceso(current_user, negocio_id)

    match_movimientos = {
        "negocio_id": negocio_id,
    }

    pipeline = [
        {
            "$match": match_movimientos
        },
        {
            "$lookup": {
                "from": "polizas_contables",
                "let": {
                    "poliza_id_texto": "$poliza_id"
                },
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$eq": [
                                    {
                                        "$toString": "$_id"
                                    },
                                    "$$poliza_id_texto"
                                ]
                            }
                        }
                    }
                ],
                "as": "poliza",
            }
        },
        {
            "$unwind": "$poliza"
        },
        {
            "$match": {
                "poliza.estado": "contabilizada",
            }
        },
    ]

    if periodo:
        pipeline.append(
            {
                "$match": {
                    "poliza.periodo": periodo,
                }
            }
        )

    pipeline.extend(
        [
            {
                "$group": {
                    "_id": "$cuenta_id",
                    "codigo": {"$first": "$codigo_cuenta"},
                    "nombre": {"$first": "$nombre_cuenta"},
                    "debe": {"$sum": "$debe"},
                    "haber": {"$sum": "$haber"},
                }
            },
            {
                "$addFields": {
                    "movimiento": {
                        "$subtract": ["$debe", "$haber"]
                    }
                }
            },
            {
                "$sort": {
                    "codigo": 1
                }
            },
        ]
    )

    movimientos = await db.movimientos_contables.aggregate(
        pipeline
    ).to_list(length=None)

    # Las líneas automáticas no siempre traen código y nombre; se toman del catálogo
    ids_cuenta = [ObjectId(m["_id"]) for m in movimientos if ObjectId.is_valid(str(m["_id"]))]
    catalogo = {
        str(c["_id"]): c
        async for c in db.catalogo_cuentas.find({"_id": {"$in": ids_cuenta}}, {"codigo": 1, "nombre": 1})
    }

    cuentas = []

    total_debe = 0.0
    total_haber = 0.0

    for movimiento in movimientos:
        debe = round(float(movimiento.get("debe", 0)), 2)
        haber = round(float(movimiento.get("haber", 0)), 2)

        total_debe += debe
        total_haber += haber

        en_catalogo = catalogo.get(str(movimiento["_id"]), {})
        cuentas.append(
            {
                "cuenta_id": str(movimiento["_id"]),
                "codigo": movimiento.get("codigo") or en_catalogo.get("codigo"),
                "nombre": movimiento.get("nombre") or en_catalogo.get("nombre"),
                "debe": debe,
                "haber": haber,
                "saldo": round(debe - haber, 2),
            }
        )

    total_debe = round(total_debe, 2)
    total_haber = round(total_haber, 2)

    return {
        "negocio_id": negocio_id,
        "periodo": periodo,
        "cuentas": cuentas,
        "total_debe": total_debe,
        "total_haber": total_haber,
        "diferencia": round(total_debe - total_haber, 2),
        "cuadrada": total_debe == total_haber,
    }

# ============================================================
# SPRINT 3 — ESTADO DE RESULTADOS
# ============================================================

@router.get("/reportes/ventas-periodo")
async def ventas_periodo(
    negocio_id: str,
    periodo: str | None = None,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Movimientos de venta del periodo: ventas de mostrador y pedidos no cancelados.
    Los días se agrupan en la zona horaria del negocio.
    """
    verificar_acceso(current_user, negocio_id)

    zona = ZoneInfo(settings.ZONA_HORARIA)
    if periodo:
        anio, mes = (int(p) for p in periodo.split("-"))
    else:
        hoy = datetime.now(zona)
        anio, mes = hoy.year, hoy.month
        periodo = f"{anio:04d}-{mes:02d}"
    inicio_local = datetime(anio, mes, 1, tzinfo=zona)
    fin_local = datetime(anio + (mes // 12), mes % 12 + 1, 1, tzinfo=zona)
    inicio = inicio_local.astimezone(timezone.utc)
    fin = fin_local.astimezone(timezone.utc)

    def en_utc(valor) -> datetime | None:
        # Mongo devuelve datetimes sin zona; algunos pedidos guardan created_at como texto ISO
        if isinstance(valor, str):
            valor = datetime.fromisoformat(valor.replace("Z", "+00:00"))
        if not isinstance(valor, datetime):
            return None
        return valor.replace(tzinfo=timezone.utc) if valor.tzinfo is None else valor.astimezone(timezone.utc)

    def dia_local(fecha: datetime) -> date:
        return fecha.astimezone(zona).date()

    movimientos = []
    async for v in db.ventas_mostrador.find({"negocio_id": negocio_id, "estado": "completada"}):
        fecha = en_utc(v.get("fecha"))
        if fecha is None or not (inicio <= fecha < fin):
            continue
        movimientos.append({
            "canal": "mostrador", "referencia": v["folio"], "fecha": fecha,
            "total": round(float(v["total"]), 2), "detalle": v["metodo_pago"],
        })
    async for p in db.pedidos.find({"negocio_id": negocio_id, "estado": {"$not": {"$regex": "cancel"}}}):
        fecha = en_utc(p.get("created_at"))
        if fecha is None or not (inicio <= fecha < fin):
            continue
        movimientos.append({
            "canal": "pedido", "referencia": p.get("numero", ""), "fecha": fecha,
            "total": round(float(p.get("total") or 0), 2), "detalle": p.get("estado", ""),
        })

    por_dia: dict[str, dict] = {}
    por_canal = {"mostrador": 0.0, "pedido": 0.0}
    for m in movimientos:
        clave = dia_local(m["fecha"]).isoformat()
        dia = por_dia.setdefault(clave, {"fecha": clave, "mostrador": 0.0, "pedido": 0.0, "total": 0.0, "cantidad": 0})
        dia[m["canal"]] = round(dia[m["canal"]] + m["total"], 2)
        dia["total"] = round(dia["total"] + m["total"], 2)
        dia["cantidad"] += 1
        por_canal[m["canal"]] = round(por_canal[m["canal"]] + m["total"], 2)

    total = round(sum(m["total"] for m in movimientos), 2)
    movimientos.sort(key=lambda m: m["fecha"], reverse=True)
    return {
        "negocio_id": negocio_id,
        "periodo": periodo,
        "dias": sorted(por_dia.values(), key=lambda d: d["fecha"]),
        "totales": {
            "total": total,
            "cantidad": len(movimientos),
            "ticket_promedio": round(total / len(movimientos), 2) if movimientos else 0.0,
            "por_canal": por_canal,
        },
        "movimientos": [
            {**m, "fecha": dia_local(m["fecha"]).isoformat()} for m in movimientos[:1000]
        ],
    }


@router.get("/reportes/estado-resultados")
async def estado_resultados(
    negocio_id: str,
    periodo: str | None = None,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Estado de Resultados basado únicamente en pólizas
    contabilizadas.

    Ingresos - Costos - Gastos = Utilidad / Pérdida
    """

    verificar_acceso(current_user, negocio_id)

    pipeline = [
        {
            "$match": {
                "negocio_id": negocio_id,
            }
        },
        {
            "$lookup": {
                "from": "polizas_contables",
                "let": {
                    "poliza_id_texto": "$poliza_id"
                },
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$eq": [
                                    {
                                        "$toString": "$_id"
                                    },
                                    "$$poliza_id_texto"
                                ]
                            }
                        }
                    }
                ],
                "as": "poliza",
            }
        },
        {
            "$unwind": "$poliza"
        },
        {
            "$match": {
                "poliza.estado": "contabilizada",
            }
        },
        {
            "$lookup": {
                "from": "catalogo_cuentas",
                "let": {
                    "cuenta_id_texto": "$cuenta_id"
                },
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$eq": [
                                    {
                                        "$toString": "$_id"
                                    },
                                    "$$cuenta_id_texto"
                                ]
                            }
                        }
                    }
                ],
                "as": "cuenta",
            }
        },
        {
            "$unwind": {
                "path": "$cuenta",
                "preserveNullAndEmptyArrays": True,
            }
        },
    ]

    if periodo:
        pipeline.append(
            {
                "$match": {
                    "poliza.periodo": periodo,
                }
            }
        )

    pipeline.extend(
        [
            {
                "$match": {
                    "cuenta.tipo": {
                        "$in": [
                            "ingreso",
                            "costo",
                            "gasto",
                        ]
                    }
                }
            },
            {
                "$group": {
                    "_id": {
                        "tipo": "$cuenta.tipo",
                        "cuenta_id": "$cuenta_id",
                    },
                    "codigo": {
                        "$first": "$codigo_cuenta"
                    },
                    "nombre": {
                        "$first": "$nombre_cuenta"
                    },
                    "debe": {
                        "$sum": "$debe"
                    },
                    "haber": {
                        "$sum": "$haber"
                    },
                }
            },
            {
                "$sort": {
                    "codigo": 1
                }
            },
        ]
    )

    movimientos = await db.movimientos_contables.aggregate(
        pipeline
    ).to_list(length=None)

    ingresos = []
    costos = []
    gastos = []

    total_ingresos = 0.0
    total_costos = 0.0
    total_gastos = 0.0

    for movimiento in movimientos:
        tipo = movimiento["_id"]["tipo"]

        debe = round(
            float(movimiento.get("debe", 0)),
            2
        )

        haber = round(
            float(movimiento.get("haber", 0)),
            2
        )

        # Las cuentas de resultados normalmente son acreedoras
        # para ingresos y deudoras para costos/gastos.
        if tipo == "ingreso":
            importe = haber - debe
        else:
            importe = debe - haber

        importe = round(importe, 2)

        cuenta = {
            "cuenta_id": str(
                movimiento["_id"]["cuenta_id"]
            ),
            "codigo": movimiento.get("codigo"),
            "nombre": movimiento.get("nombre"),
            "importe": importe,
        }

        if tipo == "ingreso":
            ingresos.append(cuenta)
            total_ingresos += importe

        elif tipo == "costo":
            costos.append(cuenta)
            total_costos += importe

        elif tipo == "gasto":
            gastos.append(cuenta)
            total_gastos += importe

    total_ingresos = round(total_ingresos, 2)
    total_costos = round(total_costos, 2)
    total_gastos = round(total_gastos, 2)

    utilidad = round(
        total_ingresos
        - total_costos
        - total_gastos,
        2
    )

    return {
        "negocio_id": negocio_id,
        "periodo": periodo,
        "ingresos": ingresos,
        "costos": costos,
        "gastos": gastos,
        "total_ingresos": total_ingresos,
        "total_costos": total_costos,
        "total_gastos": total_gastos,
        "utilidad": utilidad,
        "resultado": (
            "utilidad"
            if utilidad >= 0
            else "perdida"
        ),
    }

# ============================================================
# SPRINT 3 — BALANCE GENERAL
# ============================================================

@router.get("/reportes/balance-general")
async def balance_general(
    negocio_id: str,
    periodo: str | None = None,
    db=Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Balance General basado en pólizas contabilizadas.

    Ecuación:
        Activo = Pasivo + Capital + Resultado del ejercicio
    """

    verificar_acceso(current_user, negocio_id)

    pipeline = [
        {
            "$match": {
                "negocio_id": negocio_id,
            }
        },
        {
            "$lookup": {
                "from": "polizas_contables",
                "let": {
                    "poliza_id_texto": "$poliza_id"
                },
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$eq": [
                                    {
                                        "$toString": "$_id"
                                    },
                                    "$$poliza_id_texto"
                                ]
                            }
                        }
                    }
                ],
                "as": "poliza",
            }
        },
        {
            "$unwind": "$poliza"
        },
        {
            "$match": {
                "poliza.estado": "contabilizada",
            }
        },
        {
            "$lookup": {
                "from": "catalogo_cuentas",
                "let": {
                    "cuenta_id_texto": "$cuenta_id"
                },
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$eq": [
                                    {
                                        "$toString": "$_id"
                                    },
                                    "$$cuenta_id_texto"
                                ]
                            }
                        }
                    }
                ],
                "as": "cuenta",
            }
        },
        {
            "$unwind": {
                "path": "$cuenta",
                "preserveNullAndEmptyArrays": False,
            }
        },
    ]

    if periodo:
        pipeline.append(
            {
                "$match": {
                    "poliza.periodo": periodo,
                }
            }
        )

    pipeline.extend(
        [
            {
                "$match": {
                    "cuenta.tipo": {
                        "$in": [
                            "activo",
                            "pasivo",
                            "capital",
                        ]
                    }
                }
            },
            {
                "$group": {
                    "_id": {
                        "tipo": "$cuenta.tipo",
                        "cuenta_id": "$cuenta_id",
                    },
                    "codigo": {
                        "$first": "$codigo_cuenta"
                    },
                    "nombre": {
                        "$first": "$nombre_cuenta"
                    },
                    "debe": {
                        "$sum": "$debe"
                    },
                    "haber": {
                        "$sum": "$haber"
                    },
                }
            },
            {
                "$sort": {
                    "codigo": 1
                }
            },
        ]
    )

    movimientos = await db.movimientos_contables.aggregate(
        pipeline
    ).to_list(length=None)

    activo = []
    pasivo = []
    capital = []

    total_activo = 0.0
    total_pasivo = 0.0
    total_capital = 0.0

    for movimiento in movimientos:
        tipo = movimiento["_id"]["tipo"]

        debe = round(
            float(movimiento.get("debe", 0)),
            2
        )

        haber = round(
            float(movimiento.get("haber", 0)),
            2
        )

        if tipo == "activo":
            importe = debe - haber
        else:
            importe = haber - debe

        importe = round(importe, 2)

        cuenta = {
            "cuenta_id": str(
                movimiento["_id"]["cuenta_id"]
            ),
            "codigo": movimiento.get("codigo"),
            "nombre": movimiento.get("nombre"),
            "importe": importe,
        }

        if tipo == "activo":
            activo.append(cuenta)
            total_activo += importe

        elif tipo == "pasivo":
            pasivo.append(cuenta)
            total_pasivo += importe

        elif tipo == "capital":
            capital.append(cuenta)
            total_capital += importe

    # --------------------------------------------------------
    # Resultado del ejercicio
    # --------------------------------------------------------

    resultado_pipeline = [
        {
            "$match": {
                "negocio_id": negocio_id,
            }
        },
        {
            "$lookup": {
                "from": "polizas_contables",
                "let": {
                    "poliza_id_texto": "$poliza_id"
                },
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$eq": [
                                    {
                                        "$toString": "$_id"
                                    },
                                    "$$poliza_id_texto"
                                ]
                            }
                        }
                    }
                ],
                "as": "poliza",
            }
        },
        {
            "$unwind": "$poliza"
        },
        {
            "$match": {
                "poliza.estado": "contabilizada",
            }
        },
    ]

    if periodo:
        resultado_pipeline.append(
            {
                "$match": {
                    "poliza.periodo": periodo,
                }
            }
        )

    resultado_pipeline.extend(
        [
            {
                "$lookup": {
                    "from": "catalogo_cuentas",
                    "let": {
                        "cuenta_id_texto": "$cuenta_id"
                    },
                    "pipeline": [
                        {
                            "$match": {
                                "$expr": {
                                    "$eq": [
                                        {
                                            "$toString": "$_id"
                                        },
                                        "$$cuenta_id_texto"
                                    ]
                                }
                            }
                        }
                    ],
                    "as": "cuenta",
                }
            },
            {
                "$unwind": "$cuenta"
            },
            {
                "$match": {
                    "cuenta.tipo": {
                        "$in": [
                            "ingreso",
                            "costo",
                            "gasto",
                        ]
                    }
                }
            },
            {
                "$group": {
                    "_id": "$cuenta.tipo",
                    "debe": {
                        "$sum": "$debe"
                    },
                    "haber": {
                        "$sum": "$haber"
                    },
                }
            },
        ]
    )

    resultados = await db.movimientos_contables.aggregate(
        resultado_pipeline
    ).to_list(length=None)

    total_ingresos = 0.0
    total_costos = 0.0
    total_gastos = 0.0

    for resultado in resultados:
        tipo = resultado["_id"]

        debe = float(resultado.get("debe", 0))
        haber = float(resultado.get("haber", 0))

        if tipo == "ingreso":
            total_ingresos += haber - debe
        elif tipo == "costo":
            total_costos += debe - haber
        elif tipo == "gasto":
            total_gastos += debe - haber

    resultado_ejercicio = round(
        total_ingresos
        - total_costos
        - total_gastos,
        2
    )

    total_activo = round(total_activo, 2)
    total_pasivo = round(total_pasivo, 2)
    total_capital = round(total_capital, 2)

    pasivo_capital_resultado = round(
        total_pasivo
        + total_capital
        + resultado_ejercicio,
        2
    )

    diferencia = round(
        total_activo
        - pasivo_capital_resultado,
        2
    )

    return {
        "negocio_id": negocio_id,
        "periodo": periodo,
        "activo": activo,
        "pasivo": pasivo,
        "capital": capital,
        "resultado_ejercicio": resultado_ejercicio,
        "total_activo": total_activo,
        "total_pasivo": total_pasivo,
        "total_capital": total_capital,
        "total_pasivo_capital_resultado":
            pasivo_capital_resultado,
        "diferencia": diferencia,
        "cuadrado": diferencia == 0,
    }
