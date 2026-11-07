from datetime import datetime, timezone


# =========================================================
# INTEGRACIÓN OPERACIÓN → CONTABILIDAD
# =========================================================

CUENTAS_BASE = {
    "clientes": "1130",
    "ventas": "4100",
    "iva_por_pagar": "2130",
    "caja": "1110",
    "bancos": "1120",
}


def obtener_periodo(fecha=None):
    """
    Convierte una fecha en periodo contable YYYY-MM.
    """
    if fecha is None:
        fecha = datetime.now(timezone.utc)

    if isinstance(fecha, str):
        try:
            fecha = datetime.fromisoformat(
                fecha.replace("Z", "+00:00")
            )
        except Exception:
            fecha = datetime.now(timezone.utc)

    return fecha.strftime("%Y-%m")


async def buscar_cuenta_por_codigo(
    db,
    negocio_id: str,
    codigo: str,
):
    return await db.catalogo_cuentas.find_one({
        "negocio_id": negocio_id,
        "codigo": codigo,
        "activo": True,
    })


async def existe_poliza_referencia(
    db,
    negocio_id: str,
    referencia_tipo: str,
    referencia_id: str,
):
    """
    Evita que una misma operación genere
    dos pólizas contables.
    """
    return await db.polizas_contables.find_one({
        "negocio_id": negocio_id,
        "referencia_tipo": referencia_tipo,
        "referencia_id": str(referencia_id),
        "estado": {
            "$ne": "cancelada"
        },
    })


async def siguiente_numero_poliza(
    db,
    negocio_id: str,
):
    """
    Generador independiente para pólizas automáticas.
    """
    from pymongo import ReturnDocument

    contador = await db.contadores_polizas.find_one_and_update(
        {
            "_id": f"{negocio_id}:automatico"
        },
        {
            "$inc": {
                "secuencia": 1
            },
            "$set": {
                "updated_at": datetime.now(
                    timezone.utc
                )
            },
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )

    return f"POL-AUT-{contador['secuencia']:06d}"


async def crear_poliza_venta_pedido(
    db,
    pedido: dict,
    usuario_id: str | None = None,
):
    """
    Genera automáticamente la póliza de una venta.

    Venta:
        Clientes       DEBE
        Ventas         HABER
        IVA por pagar  HABER

    La operación es idempotente:
    un pedido solamente puede generar una póliza
    automática de venta.
    """

    negocio_id = pedido["negocio_id"]
    pedido_id = str(pedido["_id"])

    # -----------------------------------------------------
    # PROTECCIÓN CONTRA DUPLICADOS
    # -----------------------------------------------------

    existente = await existe_poliza_referencia(
        db,
        negocio_id,
        "pedido",
        pedido_id,
    )

    if existente:
        return str(existente["_id"])

    # -----------------------------------------------------
    # IMPORTES
    # -----------------------------------------------------

    total = float(
        pedido.get("total", 0) or 0
    )

    subtotal = float(
        pedido.get("subtotal", 0) or 0
    )

    iva = float(
        pedido.get("iva", 0) or 0
    )

    # IEPS (pedidos de tienda con desglose): sin cuenta propia por ahora,
    # se acredita a ventas para que la póliza cuadre con el total.
    ieps = float(
        pedido.get("ieps", 0) or 0
    )

    if total <= 0:
        return None

    # Si por alguna razón subtotal no existe,
    # tratamos el total como venta sin IVA.
    if subtotal <= 0:
        subtotal = total
        iva = 0
        ieps = 0

    # -----------------------------------------------------
    # CUENTAS
    # -----------------------------------------------------

    cuenta_clientes = await buscar_cuenta_por_codigo(
        db,
        negocio_id,
        CUENTAS_BASE["clientes"],
    )

    cuenta_ventas = await buscar_cuenta_por_codigo(
        db,
        negocio_id,
        CUENTAS_BASE["ventas"],
    )

    cuenta_iva = None

    if iva > 0:
        cuenta_iva = await buscar_cuenta_por_codigo(
            db,
            negocio_id,
            CUENTAS_BASE["iva_por_pagar"],
        )

    if not cuenta_clientes:
        raise RuntimeError(
            "No existe la cuenta contable 1130 Clientes"
        )

    if not cuenta_ventas:
        raise RuntimeError(
            "No existe la cuenta contable 4100 Ventas"
        )

    if iva > 0 and not cuenta_iva:
        raise RuntimeError(
            "No existe la cuenta contable 2130 Impuestos por pagar"
        )

    # -----------------------------------------------------
    # PERIODO
    # -----------------------------------------------------

    periodo = obtener_periodo(
        pedido.get("created_at")
    )

    # -----------------------------------------------------
    # NÚMERO
    # -----------------------------------------------------

    numero = await siguiente_numero_poliza(
        db,
        negocio_id,
    )

    ahora = datetime.now(timezone.utc)

    # -----------------------------------------------------
    # PÓLIZA
    # -----------------------------------------------------

    poliza = {
        "negocio_id": negocio_id,
        "numero": numero,
        "tipo": "ingreso",
        "periodo": periodo,
        "fecha": ahora,
        "concepto": (
            f"Venta automática "
            f"{pedido.get('numero', pedido_id)}"
        ),
        "referencia_tipo": "pedido",
        "referencia_id": pedido_id,
        "estado": "contabilizada",
        "total_debe": total,
        "total_haber": total,
        "created_by": usuario_id,
        "created_at": ahora,
        "contabilizada_at": ahora,
        "contabilizada_por": usuario_id,
        "automatico": True,
        "origen": "pedido",
    }

    result = await db.polizas_contables.insert_one(
        poliza
    )

    poliza_id = result.inserted_id

    # -----------------------------------------------------
    # MOVIMIENTO 1 — CLIENTES
    # -----------------------------------------------------

    movimientos = [
        {
            "negocio_id": negocio_id,
            "poliza_id": str(poliza_id),
            "linea": 1,
            "fecha": ahora,
            "cuenta_id": str(cuenta_clientes["_id"]),
            "codigo": cuenta_clientes["codigo"],
            "nombre": cuenta_clientes["nombre"],
            "concepto": (
                f"Venta {pedido.get('numero', pedido_id)}"
            ),
            "debe": total,
            "haber": 0.0,
            "created_at": ahora,
            "automatico": True,
        },
        {
            "negocio_id": negocio_id,
            "poliza_id": str(poliza_id),
            "linea": 2,
            "fecha": ahora,
            "cuenta_id": str(cuenta_ventas["_id"]),
            "codigo": cuenta_ventas["codigo"],
            "nombre": cuenta_ventas["nombre"],
            "concepto": (
                f"Venta {pedido.get('numero', pedido_id)}"
            ),
            "debe": 0.0,
            "haber": round(subtotal + ieps, 2),
            "created_at": ahora,
            "automatico": True,
        },
    ]

    # -----------------------------------------------------
    # MOVIMIENTO 3 — IVA
    # -----------------------------------------------------

    if iva > 0:
        movimientos.append({
            "negocio_id": negocio_id,
            "poliza_id": str(poliza_id),
            "linea": 3,
            "fecha": ahora,
            "cuenta_id": str(cuenta_iva["_id"]),
            "codigo": cuenta_iva["codigo"],
            "nombre": cuenta_iva["nombre"],
            "concepto": (
                f"IVA venta "
                f"{pedido.get('numero', pedido_id)}"
            ),
            "debe": 0.0,
            "haber": iva,
            "created_at": ahora,
            "automatico": True,
        })

    await db.movimientos_contables.insert_many(
        movimientos
    )

    return str(poliza_id)

# =========================================================
# INTEGRACIÓN: COBRO FINANCIERO -> PÓLIZA CONTABLE
# =========================================================

async def crear_poliza_cobro(
    db,
    cobro: dict,
    cuenta_financiera: dict | None = None,
    usuario_id: str | None = None,
):
    """
    Genera la póliza contable de un cobro recibido.

    Ejemplo:
        Caja/Banco       DEBE
        Clientes         HABER

    El cobro no genera ingresos nuevamente porque el ingreso
    ya fue reconocido por la póliza de venta del pedido.
    """

    negocio_id = cobro["negocio_id"]
    cobro_id = str(cobro["_id"])

    # ---------------------------------------------------------
    # Evitar duplicar la póliza del mismo cobro
    # ---------------------------------------------------------
    existente = await existe_poliza_referencia(
        db,
        negocio_id,
        "cobro",
        cobro_id,
    )

    if existente:
        return str(existente["_id"])

    importe = float(cobro.get("importe", 0) or 0)

    if importe <= 0:
        return None

    # ---------------------------------------------------------
    # Determinar la cuenta contable de entrada de dinero
    # ---------------------------------------------------------
    if cuenta_financiera is None:
        cuenta_financiera = await db.cuentas_financieras.find_one({
            "_id": validar_object_id(cobro["cuenta_id"]),
            "negocio_id": negocio_id,
            "activo": True,
        })

    if not cuenta_financiera:
        raise RuntimeError(
            "No existe la cuenta financiera asociada al cobro"
        )

    tipo_cuenta = cuenta_financiera.get("tipo", "otro")

    if tipo_cuenta == "efectivo":
        codigo_cuenta_ingreso = "1110"
    else:
        codigo_cuenta_ingreso = "1120"

    cuenta_ingreso = await buscar_cuenta_por_codigo(
        db,
        negocio_id,
        codigo_cuenta_ingreso,
    )

    cuenta_clientes = await buscar_cuenta_por_codigo(
        db,
        negocio_id,
        CUENTAS_BASE["clientes"],
    )

    if not cuenta_ingreso:
        raise RuntimeError(
            f"No existe la cuenta contable {codigo_cuenta_ingreso}"
        )

    if not cuenta_clientes:
        raise RuntimeError(
            "No existe la cuenta contable 1130 Clientes"
        )

    # ---------------------------------------------------------
    # Número automático
    # ---------------------------------------------------------
    periodo = obtener_periodo(cobro.get("fecha"))
    numero = await siguiente_numero_poliza(
        db,
        negocio_id,
    )

    ahora = datetime.now(timezone.utc)

    pedido_id = cobro.get("pedido_id")

    concepto = cobro.get("concepto")

    if not concepto:
        concepto = f"Cobro {cobro.get('numero', cobro_id)}"

    # ---------------------------------------------------------
    # Crear póliza
    # ---------------------------------------------------------
    poliza = {
        "negocio_id": negocio_id,
        "numero": numero,
        "tipo": "ingreso",
        "periodo": periodo,
        "fecha": ahora,
        "concepto": concepto,
        "referencia_tipo": "cobro",
        "referencia_id": cobro_id,
        "estado": "contabilizada",
        "total_debe": importe,
        "total_haber": importe,
        "created_by": usuario_id,
        "created_at": ahora,
        "contabilizada_at": ahora,
        "contabilizada_por": usuario_id,
        "automatico": True,
        "origen": "cobro",
    }

    if pedido_id:
        poliza["pedido_id"] = str(pedido_id)

    result = await db.polizas_contables.insert_one(poliza)

    poliza_id = result.inserted_id

    # ---------------------------------------------------------
    # Movimientos contables
    # ---------------------------------------------------------
    movimientos = [
        {
            "negocio_id": negocio_id,
            "poliza_id": str(poliza_id),
            "linea": 1,
            "fecha": ahora,
            "cuenta_id": str(cuenta_ingreso["_id"]),
            "codigo": cuenta_ingreso["codigo"],
            "nombre": cuenta_ingreso["nombre"],
            "concepto": concepto,
            "debe": importe,
            "haber": 0.0,
            "created_at": ahora,
            "automatico": True,
        },
        {
            "negocio_id": negocio_id,
            "poliza_id": str(poliza_id),
            "linea": 2,
            "fecha": ahora,
            "cuenta_id": str(cuenta_clientes["_id"]),
            "codigo": cuenta_clientes["codigo"],
            "nombre": cuenta_clientes["nombre"],
            "concepto": concepto,
            "debe": 0.0,
            "haber": importe,
            "created_at": ahora,
            "automatico": True,
        },
    ]

    await db.movimientos_contables.insert_many(
        movimientos
    )

    return str(poliza_id)
