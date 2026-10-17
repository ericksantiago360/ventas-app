import pytest

from .conftest import NEGOCIOS, id_de

# Endpoints de listado que reciben negocio_id y deben respetar el acceso.
LISTADOS = [
    "/api/crm/clientes",
    "/api/crm/leads",
    "/api/catalogo/productos",
    "/api/cotizaciones/",
    "/api/pedidos/",
    "/api/pedidos/etapas",
    "/api/finanzas/cuentas",
    "/api/pacientes/pacientes",
    "/api/lab/ordenes",
    "/api/facturacion/facturas",
    "/api/inventario/stock",
    "/api/personal/empleados",
    "/api/contabilidad/polizas",
]


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_login_contrasena_incorrecta(client):
    r = client.post("/auth/login", data={"username": "erick@santal.mx", "password": "mala"})
    assert r.status_code == 401


def test_sin_token_401(client):
    r = client.get("/api/crm/clientes", params={"negocio_id": "santal"})
    assert r.status_code == 401


def test_me(client, admin):
    r = client.get("/auth/me", headers=admin)
    assert r.status_code == 200
    assert set(NEGOCIOS) <= set(r.json()["negocios"])


@pytest.mark.parametrize("url", LISTADOS)
def test_negocio_sin_acceso_403(client, solo_santal, url):
    r = client.get(url, headers=solo_santal, params={"negocio_id": "dulce_tentacion"})
    assert r.status_code == 403


@pytest.mark.parametrize("url", LISTADOS)
def test_negocio_propio_200(client, solo_santal, url):
    r = client.get(url, headers=solo_santal, params={"negocio_id": "santal"})
    assert r.status_code == 200


class TestCRMOtroNegocio:
    """Un usuario solo-Santal no puede tocar clientes ni leads de otro negocio."""

    @pytest.fixture
    def cliente_dt(self, client, admin):
        r = client.post("/api/crm/clientes", headers=admin,
                        json={"negocio_id": "dulce_tentacion", "nombre": "Cliente DT"})
        return id_de(r.json())

    @pytest.fixture
    def lead_dt(self, client, admin):
        r = client.post("/api/crm/leads", headers=admin,
                        json={"negocio_id": "dulce_tentacion", "nombre": "Lead DT"})
        return id_de(r.json())

    def test_crear_cliente(self, client, solo_santal):
        r = client.post("/api/crm/clientes", headers=solo_santal,
                        json={"negocio_id": "dulce_tentacion", "nombre": "X"})
        assert r.status_code == 403

    def test_ver_cliente(self, client, solo_santal, cliente_dt):
        assert client.get(f"/api/crm/clientes/{cliente_dt}", headers=solo_santal).status_code == 403

    def test_editar_cliente(self, client, solo_santal, cliente_dt):
        r = client.put(f"/api/crm/clientes/{cliente_dt}", headers=solo_santal, json={"nombre": "hack"})
        assert r.status_code == 403

    def test_desactivar_cliente(self, client, solo_santal, cliente_dt):
        r = client.patch(f"/api/crm/clientes/{cliente_dt}/estado", headers=solo_santal,
                         json={"activo": False})
        assert r.status_code == 403

    def test_mover_lead(self, client, solo_santal, lead_dt):
        r = client.patch(f"/api/crm/leads/{lead_dt}/etapa", headers=solo_santal,
                         json={"etapa": "ganado"})
        assert r.status_code == 403

    def test_borrar_lead(self, client, solo_santal, lead_dt):
        assert client.delete(f"/api/crm/leads/{lead_dt}", headers=solo_santal).status_code == 403
