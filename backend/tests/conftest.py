"""
Fixtures compartidas.

Las pruebas corren la app en proceso (TestClient) contra un MongoDB real,
en una base temporal que se crea y se borra en cada corrida.

    make test                                   # Mongo aislado en Docker
    MONGODB_URL=mongodb://localhost:27017 pytest  # Mongo propio
"""
import asyncio
import os
import tempfile
import uuid

# La configuración se lee al importar la app: definir el entorno antes.
os.environ.setdefault("MONGODB_URL", "mongodb://localhost:27017")
os.environ["MONGODB_DB"] = f"ventas_test_{uuid.uuid4().hex[:8]}"
os.environ["SECRET_KEY"] = "test-secret-key-0123456789abcdef0123456789"
os.environ["STORAGE_PATH"] = tempfile.mkdtemp(prefix="ventas_storage_")
os.environ["DEBUG"] = "false"
for var in ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "APP_URL"):
    os.environ[var] = ""

import pytest
from fastapi.testclient import TestClient
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext

import init_catalogo
import init_contabilidad
import init_db
from app.main import app

ADMIN_EMAIL = "erick@santal.mx"
ADMIN_PASSWORD = "cambiar-contrasena"
SOLO_SANTAL_EMAIL = "solo@santal.mx"
SOLO_SANTAL_PASSWORD = "solo-santal-123"

NEGOCIOS = ["santal", "dulce_tentacion", "bienes_raices", "diagnostico_plus"]


async def _sembrar() -> None:
    await init_db.main()
    await init_catalogo.main()
    await init_contabilidad.main()

    client = AsyncIOMotorClient(os.environ["MONGODB_URL"])
    db = client[os.environ["MONGODB_DB"]]
    await db.usuarios.insert_one({
        "nombre": "Solo Santal",
        "email": SOLO_SANTAL_EMAIL,
        "password_hash": CryptContext(schemes=["bcrypt"]).hash(SOLO_SANTAL_PASSWORD),
        "negocios": ["santal"],
        "rol": "vendedor",
        "activo": True,
    })
    client.close()


async def _borrar_db() -> None:
    client = AsyncIOMotorClient(os.environ["MONGODB_URL"])
    await client.drop_database(os.environ["MONGODB_DB"])
    client.close()


@pytest.fixture(scope="session")
def client():
    asyncio.run(_sembrar())
    with TestClient(app) as c:
        yield c
    asyncio.run(_borrar_db())


def _token(client, email, password) -> dict:
    r = client.post("/auth/login", data={"username": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def admin(client):
    """Headers del admin (acceso a los 4 negocios)."""
    return _token(client, ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="session")
def solo_santal(client):
    """Headers de un usuario con acceso solo a Santal."""
    return _token(client, SOLO_SANTAL_EMAIL, SOLO_SANTAL_PASSWORD)


# ── Helpers ───────────────────────────────────────────────────────────────────

def id_de(respuesta: dict) -> str:
    """Extrae el id de las distintas formas de respuesta de la API."""
    for fuente in (respuesta, respuesta.get("data") or {}):
        for clave in ("id", "_id"):
            if isinstance(fuente, dict) and fuente.get(clave):
                return fuente[clave]
    raise AssertionError(f"La respuesta no trae id: {respuesta}")


def datos(respuesta: dict):
    return respuesta.get("data", respuesta) if isinstance(respuesta, dict) else respuesta


def unico(prefijo: str = "T") -> str:
    return f"{prefijo}-{uuid.uuid4().hex[:6].upper()}"


def es_pdf(r) -> bool:
    return r.status_code == 200 and r.content[:4] == b"%PDF"


# ── Datos de prueba reutilizables ─────────────────────────────────────────────

@pytest.fixture
def cliente_santal(client, admin):
    r = client.post("/api/crm/clientes", headers=admin,
                    json={"negocio_id": "santal", "nombre": unico("Cliente")})
    assert r.status_code == 201, r.text
    return id_de(r.json())


@pytest.fixture
def producto_santal(client, admin):
    codigo = unico("P")
    r = client.post("/api/catalogo/productos", headers=admin, json={
        "negocio_id": "santal", "codigo": codigo, "nombre": f"Producto {codigo}",
        "precio_base": 1000, "tipo": "producto",
    })
    assert r.status_code == 201, r.text
    return id_de(r.json())


@pytest.fixture
def cuenta_santal(client, admin):
    r = client.post("/api/finanzas/cuentas", headers=admin, json={
        "negocio_id": "santal", "nombre": unico("Banco"), "tipo": "banco", "saldo_inicial": 5000,
    })
    assert r.status_code in (200, 201), r.text
    return id_de(r.json())


@pytest.fixture
def pedido_santal(client, admin, cliente_santal, producto_santal):
    items = [{"producto_id": producto_santal, "descripcion": "Producto", "cantidad": 2,
              "precio_unitario": 1000, "importe": 2000}]
    r = client.post("/api/pedidos/", headers=admin, json={
        "negocio_id": "santal", "cliente_id": cliente_santal, "cliente_nombre": "Cliente",
        "items": items, "subtotal": 2000, "iva": 320, "total": 2320,
    })
    assert r.status_code == 201, r.text
    return id_de(r.json())
