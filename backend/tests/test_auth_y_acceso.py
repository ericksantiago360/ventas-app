import uuid

import pytest

from .conftest import NEGOCIOS, datos, id_de

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


# Recursos de negocios a los que solo_santal no tiene acceso:
# (alta, datos de alta, ruta por id, listado, negocio)
RECURSOS_AJENOS = {
    "inventario": ("/api/inventario/stock", {"sku": f"AJ-{uuid.uuid4().hex[:6]}", "stock_inicial": 1},
                   "/api/inventario/stock/{id}", "/api/inventario/stock", "dulce_tentacion"),
    "plantilla":  ("/api/lab/plantillas", {"codigo": f"AJ-{uuid.uuid4().hex[:6]}"},
                   "/api/lab/plantillas/{id}", "/api/lab/plantillas", "diagnostico_plus"),
    "paciente":   ("/api/pacientes/pacientes", {"sexo": "femenino"},
                   "/api/pacientes/pacientes/{id}", "/api/pacientes/pacientes", "diagnostico_plus"),
}


@pytest.mark.parametrize("recurso", RECURSOS_AJENOS)
def test_editar_o_desactivar_recurso_ajeno_403(client, admin, solo_santal, recurso):
    alta, extra, ruta, listado, negocio = RECURSOS_AJENOS[recurso]
    nombre = f"Ajeno {uuid.uuid4().hex[:6]}"
    r = client.post(alta, headers=admin, json={"negocio_id": negocio, "nombre": nombre, **extra})
    assert r.status_code == 201, r.text
    rid = id_de(r.json())
    url = ruta.format(id=rid)

    assert client.put(url, headers=solo_santal, json={"nombre": "hack"}).status_code == 403
    assert client.delete(url, headers=solo_santal).status_code == 403

    # Sigue activo y sin cambios
    items = datos(client.get(listado, headers=admin, params={"negocio_id": negocio}).json())
    item = next(i for i in items if id_de(i) == rid)
    assert item["nombre"] == nombre

    # El administrador sí puede editarlo y darlo de baja (la baja evita que otras pruebas lo usen)
    assert client.put(url, headers=admin, json={"nombre": nombre + " editado"}).status_code == 200
    assert client.delete(url, headers=admin).status_code == 200


def test_movimiento_de_inventario_ajeno_403(client, admin, solo_santal):
    neg = {"negocio_id": "dulce_tentacion"}
    r = client.post("/api/inventario/stock", headers=admin, json={
        **neg, "nombre": f"Ajeno {uuid.uuid4().hex[:6]}", "sku": f"AJ-{uuid.uuid4().hex[:6]}", "stock_inicial": 10,
    })
    assert r.status_code == 201, r.text
    item = id_de(r.json())

    r = client.post(f"/api/inventario/stock/{item}/movimiento", headers=solo_santal,
                    json={"tipo": "entrada", "cantidad": 5})
    assert r.status_code == 403

    items = datos(client.get("/api/inventario/stock", headers=admin, params=neg).json())
    assert next(i for i in items if id_de(i) == item)["stock_actual"] == 10
