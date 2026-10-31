from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from .config import settings

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    return _client


async def get_db() -> AsyncIOMotorDatabase:
    return _client[settings.MONGODB_DB]


async def connect_db() -> None:
    global _client
    _client = AsyncIOMotorClient(settings.MONGODB_URL)
    await _crear_indices(_client[settings.MONGODB_DB])
    print("✓ MongoDB conectado")


async def close_db() -> None:
    global _client
    if _client:
        _client.close()


async def _crear_indices(db: AsyncIOMotorDatabase) -> None:
    # ── Configuración de negocios ──────────────────────────────────────────
    
    # ── CRM ───────────────────────────────────────────────────────────────
    await db.clientes.create_index([("negocio_id", 1), ("activo", 1)])
    await db.clientes.create_index([("negocio_id", 1), ("nombre", 1)])
    await db.leads.create_index([("negocio_id", 1), ("etapa", 1)])
    await db.interacciones.create_index([("entidad_id", 1), ("fecha", -1)])
    # Índices de SPEC §8 (módulo CRM v1.1)
    await db.clientes.create_index([("empresa", "text"), ("telefono", 1)])
    await db.clientes.create_index([("activo", 1)])
    await db.oportunidades.create_index([("cliente_id", 1), ("negocio_id", 1)])
    await db.oportunidades.create_index([("negocio_id", 1), ("etapa", 1), ("activo", 1)])
    await db.interacciones.create_index([("cliente_id", 1), ("fecha", -1)])
    await db.interacciones.create_index([("oportunidad_id", 1), ("fecha", -1)])

    # ── Catálogo ──────────────────────────────────────────────────────────
    await db.productos.create_index([("negocio_id", 1), ("activo", 1)])
    await db.productos.create_index(
        [("negocio_id", 1), ("sku", 1)], unique=True
    )
    await db.productos.create_index(
        [("nombre", "text"), ("descripcion", "text")]
    )
    await db.categorias.create_index([("negocio_id", 1), ("parent_id", 1)])

    # ── Cotizaciones ──────────────────────────────────────────────────────
    await db.cotizaciones.create_index([("negocio_id", 1), ("estado", 1)])
    await db.cotizaciones.create_index(
        [("negocio_id", 1), ("numero", 1)], unique=True
    )
    await db.cotizaciones.create_index([("cliente_id", 1)])
    await db.cotizaciones.create_index([("fecha_vencimiento", 1)])
    #await db.contadores.create_index("_id", unique=True)

    # ── Pedidos ───────────────────────────────────────────────────────────
    await db.pedidos.create_index([("negocio_id", 1), ("estado", 1)])
    await db.pedidos.create_index(
        [("negocio_id", 1), ("numero", 1)], unique=True
    )
    await db.pedidos.create_index([("cotizacion_id", 1)])
    await db.pedidos.create_index([("created_at", -1)])

    # ── Inventario ────────────────────────────────────────────────────────
    await db.inventario.create_index(
        [("negocio_id", 1), ("producto_id", 1), ("variante_sku", 1)]
    )
    await db.consignaciones.create_index(
        [("negocio_id", 1), ("punto_id", 1), ("producto_id", 1)]
    )

    # ── Compras ───────────────────────────────────────────────────────────
    await db.proveedores.create_index([("negocio_id", 1), ("activo", 1)])
    await db.ordenes_compra.create_index(
        [("negocio_id", 1), ("numero", 1)], unique=True
    )
    await db.ordenes_compra.create_index([("negocio_id", 1), ("estado", 1)])

    # ── Leads CRM ─────────────────────────────────────────────────────────
    await db.leads.create_index([("negocio_id", 1), ("etapa", 1), ("activo", 1)])

    # ── Mostrador ─────────────────────────────────────────────────────────
    await db.ventas_mostrador.create_index(
        [("negocio_id", 1), ("folio", 1)], unique=True
    )
    await db.ventas_mostrador.create_index([("negocio_id", 1), ("fecha", -1)])

    # ── Facturación ───────────────────────────────────────────────────────
    await db.facturas.create_index([("negocio_id", 1), ("estado", 1), ("fecha", -1)])
    await db.facturas.create_index([("negocio_id", 1), ("origen_tipo", 1), ("origen_id", 1)])
    await db.facturas.create_index([("negocio_id", 1), ("folio", 1)])

    # ── Laboratorio / portal del paciente ─────────────────────────────────
    await db.ordenes_trabajo.create_index([("paciente_id", 1), ("created_at", -1)])
    await db.resultados_lab.create_index([("orden_id", 1), ("estado", 1)])
    await db.ordenes_trabajo.create_index([("negocio_id", 1), ("resultados_criticos", 1), ("notificado_medico", 1)])
    await db.ordenes_trabajo.create_index([("negocio_id", 1), ("expediente_id", 1), ("created_at", -1)])
    await db.rangos_referencia.create_index([("negocio_id", 1), ("clave", 1)])
    await db.pacientes.create_index([("email", 1)])
    await db.pacientes.create_index([("negocio_id", 1), ("curp", 1)])

    # ── Clínica: expediente clínico ───────────────────────────────────────
    await db.expedientes.create_index([("negocio_id", 1), ("folio", 1)], unique=True)
    # Un expediente por paciente
    await db.expedientes.create_index([("negocio_id", 1), ("paciente_id", 1)], unique=True)
    await db.expedientes.create_index([("negocio_id", 1), ("activo", 1), ("updated_at", -1)])
    await db.expedientes.create_index([("negocio_id", 1), ("medico_id", 1)])
    await db.notas_clinicas.create_index([("expediente_id", 1), ("fecha", -1)])

    # ── Clínica: agenda ───────────────────────────────────────────────────
    await db.citas.create_index([("negocio_id", 1), ("folio", 1)], unique=True)
    await db.citas.create_index([("negocio_id", 1), ("medico_id", 1), ("fecha_inicio", 1)])
    await db.citas.create_index([("negocio_id", 1), ("estado", 1), ("fecha_inicio", 1)])
    await db.citas.create_index([("negocio_id", 1), ("consultorio", 1), ("fecha_inicio", 1)])
    await db.citas.create_index([("expediente_id", 1), ("fecha_inicio", -1)])

    # ── Clínica: recetas ──────────────────────────────────────────────────
    await db.recetas.create_index("folio_verificacion", unique=True)
    await db.recetas.create_index([("negocio_id", 1), ("folio", 1)], unique=True)
    await db.recetas.create_index([("negocio_id", 1), ("fecha", -1)])
    await db.recetas.create_index([("expediente_id", 1), ("fecha", -1)])

    # ── Clínica: farmacia ─────────────────────────────────────────────────
    await db.farmacia_inventario.create_index([("negocio_id", 1), ("stock", 1)])
    await db.farmacia_inventario.create_index([("negocio_id", 1), ("activo", 1), ("nombre", 1)])
    await db.farmacia_inventario.create_index([("negocio_id", 1), ("lotes.fecha_caducidad", 1)])
    await db.farmacia_movimientos.create_index([("articulo_id", 1), ("fecha", -1)])
    await db.farmacia_movimientos.create_index([("negocio_id", 1), ("receta_id", 1)])

    # ── Clínica: consentimientos ──────────────────────────────────────────
    await db.consentimientos.create_index([("negocio_id", 1), ("folio", 1)], unique=True)
    await db.consentimientos.create_index([("negocio_id", 1), ("fecha_firma", -1)])
    await db.consentimientos.create_index([("expediente_id", 1), ("fecha_firma", -1)])
    await db.consentimientos_plantillas.create_index([("negocio_id", 1), ("tipo", 1), ("activo", 1)])

    # ── Carta Porte ───────────────────────────────────────────────────────
    await db.cartas_porte.create_index([("negocio_id", 1), ("folio", 1)], unique=True)
    await db.cartas_porte.create_index([("negocio_id", 1), ("estado", 1)])
    await db.cartas_porte.create_index([("negocio_id", 1), ("created_at", -1)])
    await db.cartas_porte.create_index([("negocio_id", 1), ("origen.fecha_hora_salida", -1)])
    await db.cartas_porte.create_index([("vehiculo_id", 1), ("estado", 1)])
    await db.cartas_porte.create_index([("operadores.operador_id", 1), ("estado", 1)])
    await db.vehiculos.create_index([("negocio_id", 1), ("placa", 1)], unique=True)
    await db.operadores.create_index([("negocio_id", 1), ("rfc", 1)], unique=True)

    # ── Timbrado SAT ──────────────────────────────────────────────────────
    await db.csd_negocios.create_index([("negocio_id", 1), ("activo", 1)])
    await db.facturas.create_index("uuid", sparse=True)
    await db.cartas_porte.create_index("timbrado.uuid", sparse=True)

    # ── Tienda en línea ───────────────────────────────────────────────────
    # Parciales: un negocio sin slug o sin referencia no debe chocar con otro
    await db.tienda_config.create_index("negocio_id", unique=True)
    await db.tienda_config.create_index(
        "slug", unique=True, partialFilterExpression={"slug": {"$type": "string"}}
    )
    await db.clientes_ecommerce.create_index([("negocio_id", 1), ("email", 1)], unique=True)
    await db.ordenes_ecommerce.create_index([("negocio_id", 1), ("folio", 1)], unique=True)
    await db.ordenes_ecommerce.create_index([("negocio_id", 1), ("estado", 1), ("created_at", -1)])
    await db.ordenes_ecommerce.create_index([("negocio_id", 1), ("cliente.email", 1)])
    await db.ordenes_ecommerce.create_index(
        "referencia_pago", unique=True, partialFilterExpression={"referencia_pago": {"$type": "string"}}
    )

    print("✓ Índices MongoDB creados")
