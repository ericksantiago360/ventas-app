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

    # ── Facturación ───────────────────────────────────────────────────────
    await db.facturas.create_index([("negocio_id", 1), ("estado", 1), ("fecha", -1)])
    await db.facturas.create_index([("negocio_id", 1), ("origen_tipo", 1), ("origen_id", 1)])
    await db.facturas.create_index([("negocio_id", 1), ("folio", 1)])

    # ── Laboratorio / portal del paciente ─────────────────────────────────
    await db.ordenes_trabajo.create_index([("paciente_id", 1), ("created_at", -1)])
    await db.resultados_lab.create_index([("orden_id", 1), ("estado", 1)])
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

    print("✓ Índices MongoDB creados")
