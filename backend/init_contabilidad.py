import asyncio
import os

from motor.motor_asyncio import AsyncIOMotorClient

from app.services.catalogo_contable import abrir_periodo_actual, sembrar_catalogo_cuentas


MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://mongo:27017")
MONGODB_DB = os.getenv("MONGODB_DB", "ventas")


async def main():

    client = AsyncIOMotorClient(MONGODB_URL)
    db = client[MONGODB_DB]

    print("Inicializando contabilidad...")

    # Todos los negocios dados de alta, no una lista fija: antes faltaba diagnostico_plus
    negocios = [n["_id"] for n in await db.config_negocios.find({}, {"_id": 1}).sort("_id", 1).to_list(500)]

    for negocio_id in negocios:

        print(
            f"\nNegocio: {negocio_id}"
        )

        creadas, existentes = await sembrar_catalogo_cuentas(db, negocio_id)

        print(
            f"  Creadas: {creadas}"
        )

        print(
            f"  Existentes: {existentes}"
        )

        periodo_actual, creado = await abrir_periodo_actual(db, negocio_id)

        if creado:

            print(
                f"  Periodo {periodo_actual} creado"
            )

        else:

            print(
                f"  Periodo {periodo_actual} ya existe"
            )

    await db.catalogo_cuentas.create_index(
        {
            "negocio_id": 1,
            "codigo": 1,
        },
        unique=True,
    )

    await db.periodos_contables.create_index(
        {
            "negocio_id": 1,
            "periodo": 1,
        },
        unique=True,
    )

    print(
        "\n✓ Contabilidad inicializada correctamente"
    )

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
