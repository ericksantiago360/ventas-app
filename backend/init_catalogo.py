import asyncio
import os

from motor.motor_asyncio import AsyncIOMotorClient

MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://mongo:27017")
MONGODB_DB = os.getenv("MONGODB_DB", "ventas")


async def create_index_safe(collection, keys, **options):
    indexes = await collection.index_information()

    requested_name = options.pop("name", None)

    if requested_name is None:
        requested_name = "_".join(
            f"{field}_{direction}" for field, direction in keys
        )

    if requested_name in indexes:
        print(f"  ✓ Ya existe: {collection.name}.{requested_name}")
        return requested_name

    name = await collection.create_index(
        keys,
        name=requested_name,
        **options,
    )

    print(f"  + Creado: {collection.name}.{name}")
    return name


async def main():
    client = AsyncIOMotorClient(MONGODB_URL)
    db = client[MONGODB_DB]

    print("Preparando índices del catálogo...")

    # ── Categorías ─────────────────────────────────────────────
    await create_index_safe(
        db.categorias,
        [("negocio_id", 1), ("nombre", 1)],
        unique=True,
    )

    await create_index_safe(
        db.categorias,
        [("negocio_id", 1), ("activo", 1)],
    )

    # ── Productos ──────────────────────────────────────────────
    await create_index_safe(
        db.productos,
        [("negocio_id", 1), ("sku", 1)],
        unique=True,
    )

    await create_index_safe(
        db.productos,
        [("negocio_id", 1), ("categoria_id", 1)],
    )

    await create_index_safe(
        db.productos,
        [("negocio_id", 1), ("activo", 1)],
    )

    await create_index_safe(
        db.productos,
        [("negocio_id", 1), ("nombre", 1)],
    )

    # ── Variantes ──────────────────────────────────────────────
    await create_index_safe(
        db.variantes_producto,
        [("negocio_id", 1), ("producto_id", 1)],
    )

    await create_index_safe(
        db.variantes_producto,
        [("negocio_id", 1), ("sku", 1)],
        unique=True,
    )

    # ── Listas de precios ──────────────────────────────────────
    await create_index_safe(
        db.listas_precios,
        [("negocio_id", 1), ("nombre", 1)],
        unique=True,
    )

    await create_index_safe(
        db.listas_precios,
        [("negocio_id", 1), ("activa", 1)],
    )

    # ── Precios por producto ───────────────────────────────────
    await create_index_safe(
        db.precios_producto,
        [
            ("negocio_id", 1),
            ("lista_precio_id", 1),
            ("producto_id", 1),
            ("variante_id", 1),
        ],
        unique=True,
    )

    # ── Atributos ──────────────────────────────────────────────
    await create_index_safe(
        db.atributos,
        [("negocio_id", 1), ("nombre", 1)],
        unique=True,
    )

    print("")
    print("✓ Índices del catálogo listos.")

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
