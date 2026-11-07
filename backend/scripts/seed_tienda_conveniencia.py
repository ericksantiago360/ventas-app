"""
Carga el seed de prueba de la tienda de conveniencia en un negocio (idempotente).

    python scripts/seed_tienda_conveniencia.py [negocio_id]   # desde backend/
"""
import asyncio
import os
import sys

from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.modules.ecommerce.seed import sembrar_tienda_conveniencia  # noqa: E402

MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://mongo:27017")
MONGODB_DB = os.getenv("MONGODB_DB", "ventas")


async def main(negocio_id: str) -> None:
    client = AsyncIOMotorClient(MONGODB_URL)
    try:
        resumen = await sembrar_tienda_conveniencia(client[MONGODB_DB], negocio_id)
    finally:
        client.close()
    print(f"Seed tienda de conveniencia en '{negocio_id}': {resumen}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "dulce_tentacion"))
