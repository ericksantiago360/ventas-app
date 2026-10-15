"""
Inicialización de la base de datos.
Ejecutar una sola vez:
    docker compose exec backend python init_db.py
"""
import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient

MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://mongo:27017")
MONGODB_DB  = os.getenv("MONGODB_DB",  "ventas")


async def main() -> None:
    client = AsyncIOMotorClient(MONGODB_URL)
    db = client[MONGODB_DB]

    # ── Negocios ──────────────────────────────────────────────────────────
    negocios = [
        {
            "_id": "santal",
            "nombre": "Santal Machinery",
            "tipo": "fabricacion_cnc",
            "prefijo_cotizacion": "SAN",
            "prefijo_pedido": "PED-SAN",
            "config": {
                "vigencia_cotizacion_dias": 15,
                "iva_aplicable": True,
                "anticipo_pct": 50,
                "moneda": "MXN",
            },
            "etapas_por_estado": {
                "en_proceso": ["en_corte", "en_acabado", "control_calidad"],
                "listo":      ["listo_para_recoger"],
                "entregado":  ["entregado"],
                "cobrado":    ["completo"],
            },
            "activo": True,
        },
        {
            "_id": "dulce_tentacion",
            "nombre": "Dulce Tentación",
            "tipo": "distribucion",
            "prefijo_cotizacion": "DT",
            "prefijo_pedido": "PED-DT",
            "config": {
                "vigencia_cotizacion_dias": 15,
                "iva_aplicable": False,
                "anticipo_pct": 0,
                "moneda": "MXN",
            },
            "etapas_por_estado": {
                "en_proceso": ["preparando", "en_ruta"],
                "listo":      ["listo_para_entrega"],
                "entregado":  ["entregado"],
                "cobrado":    ["liquidado"],
            },
            "activo": True,
        },
        {
            "_id": "bienes_raices",
            "nombre": "Bienes Raíces",
            "tipo": "inmobiliario",
            "prefijo_cotizacion": "BR",
            "prefijo_pedido": "PED-BR",
            "config": {
                "vigencia_cotizacion_dias": 30,
                "iva_aplicable": False,
                "anticipo_pct": 0,
                "moneda": "MXN",
            },
            "etapas_por_estado": {
                "en_proceso": ["docs_pendientes", "revisando_docs", "aprobado"],
                "listo":      ["contrato_listo"],
                "entregado":  ["llaves_entregadas"],
                "cobrado":    ["comision_cobrada"],
            },
            "activo": True,
        },
        {
            "_id": "diagnostico_plus",
            "nombre": "Diagnostico Plus Laboratorio Clinico",
            "tipo": "laboratorio_clinico",
            "prefijo_cotizacion": "DP",
            "prefijo_pedido": "PED-DP",
            "config": {
                "vigencia_cotizacion_dias": 15,
                "moneda": "MXN",
            },
            "etapas_por_estado": {
                "en_proceso": ["registro", "procesamiento", "validacion"],
                "listo": ["listo_para_entrega"],
                "entregado": ["entregado"],
                "cobrado": ["completo"],
            },
            "activo": True,
        },
    ]

    for neg in negocios:
        await db.config_negocios.update_one(
            {"_id": neg["_id"]},
            {"$setOnInsert": neg},
            upsert=True,
        )
        print(f"  ✓ Negocio: {neg['nombre']}")

    # ── Usuario admin ─────────────────────────────────────────────────────
    # Importamos hash_password aquí para no depender del módulo completo
    from passlib.context import CryptContext
    pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

    EMAIL    = "erick@santal.mx"
    PASSWORD = "cambiar-contrasena"

    existe = await db.usuarios.find_one({"email": EMAIL})
    if not existe:
        await db.usuarios.insert_one({
            "nombre":        "Erick Santiago",
            "email":         EMAIL,
            "password_hash": pwd.hash(PASSWORD),
            "negocios":      ["santal", "dulce_tentacion", "bienes_raices", "diagnostico_plus"],
            "rol":           "admin",
            "activo":        True,
        })
        print(f"  ✓ Usuario admin creado: {EMAIL}")
    else:
        await db.usuarios.update_one(
            {"email": EMAIL},
            {"$addToSet": {"negocios": "diagnostico_plus"}},
        )
        print(f"  - Usuario existente; acceso a Diagnostico Plus verificado: {EMAIL}")

    client.close()

    print("\n✓ Base de datos inicializada")
    print(f"  URL:      http://localhost")
    print(f"  Email:    {EMAIL}")
    print(f"  Password: {PASSWORD}")
    print("\n  IMPORTANTE: cambia la contraseña después del primer login.")


if __name__ == "__main__":
    asyncio.run(main())
