"""
Crea (o restablece) usuarios de prueba para revisar la app en desarrollo.

NO usar en producción: la contraseña es pública y conocida.

Uso (con el stack corriendo):
    docker compose exec backend python scripts/crear_usuarios_prueba.py

Es idempotente: si el usuario ya existe, se actualizan sus negocios, rol,
roles de clínica y contraseña para que coincidan con lo de abajo.
"""
import asyncio
import os
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient

from app.core.security import hash_password

MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://mongo:27017")
MONGODB_DB  = os.getenv("MONGODB_DB",  "ventas")

PASSWORD = "Prueba-2026"
DOMINIO  = "prueba.test"

SANTAL   = "santal"
DULCE    = "dulce_tentacion"
RAICES   = "bienes_raices"
CLINICA  = "diagnostico_plus"
CONSULT  = "consultoria"

# (nombre, email local, rol global, negocios, roles_clinica)
USUARIOS = [
    ("Admin de prueba",        "admin",        "admin",    [SANTAL, DULCE, RAICES, CLINICA, CONSULT], {}),
    ("Vendedor Santal",        "vendedor.santal", "vendedor", [SANTAL],  {}),
    ("Vendedor Dulce Tentación", "vendedor.dulce", "vendedor", [DULCE],  {}),
    ("Usuario Bienes Raíces",  "usuario.raices", "usuario",  [RAICES],  {}),
    ("Usuario Consultoría",    "usuario.consultoria", "usuario", [CONSULT], {}),
    # Clínica (diagnostico_plus): un usuario por rol de clínica
    ("Recepción Clínica",      "recepcion",    "usuario", [CLINICA], {CLINICA: "recepcion"}),
    ("Médico Clínica",         "medico",       "usuario", [CLINICA], {CLINICA: "medico"}),
    ("Laboratorista Clínica",  "laboratorista", "usuario", [CLINICA], {CLINICA: "laboratorista"}),
    ("Farmacia Clínica",       "farmacia",     "usuario", [CLINICA], {CLINICA: "farmacia"}),
    ("Admin Clínica",          "admin.clinica", "usuario", [CLINICA], {CLINICA: "admin_clinica"}),
]


async def main() -> None:
    client = AsyncIOMotorClient(MONGODB_URL)
    db = client[MONGODB_DB]
    pwd_hash = hash_password(PASSWORD)

    for nombre, local, rol, negocios, roles_clinica in USUARIOS:
        email = f"{local}@{DOMINIO}"
        campos = {
            "nombre":        nombre,
            "email":         email,
            "password_hash": pwd_hash,
            "rol":           rol,
            "negocios":      sorted(set(negocios)),
            "roles_clinica": roles_clinica,
            "activo":        True,
        }
        resultado = await db.usuarios.update_one(
            {"email": email},
            {"$set": {**campos, "updated_at": datetime.now(timezone.utc)},
             "$setOnInsert": {"created_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
        estado = "creado" if resultado.upserted_id else "actualizado"
        print(f"  ✓ {estado:<10} {email:<38} rol={rol:<9} negocios={','.join(negocios)}"
              + (f" clinica={roles_clinica}" if roles_clinica else ""))

    client.close()

    print(f"\nContraseña para todos: {PASSWORD}")
    print("Login en http://localhost:8080")


if __name__ == "__main__":
    asyncio.run(main())
