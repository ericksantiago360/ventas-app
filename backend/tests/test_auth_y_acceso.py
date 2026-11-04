import uuid

import pytest

from .conftest import NEGOCIOS, datos, id_de, unico

# Endpoints de listado que reciben negocio_id y deben respetar el acceso.
LISTADOS = [
    "/api/crm/clientes",
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


def test_clientes_solo_con_actividad_visible(client, admin, solo_santal):
    """Clientes unificados: el listado solo muestra los que tienen actividad en negocios del usuario."""
    marca = unico("Filtro")

    def cliente(sufijo: str) -> str:
        r = client.post("/api/crm/clientes", headers=admin, json={
            "empresa": f"{marca} {sufijo}", "telefono": "5550300", "canal_origen": "directo",
        })
        return id_de(r.json())

    def oportunidad(cliente_id: str, negocio: str, etapa: str) -> None:
        r = client.post("/api/crm/oportunidades", headers=admin,
                        json={"cliente_id": cliente_id, "negocio_id": negocio, "etapa": etapa})
        assert r.status_code == 201, r.text

    sin_actividad = cliente("sin")
    de_santal = cliente("santal")
    de_dulce = cliente("dulce")
    oportunidad(de_santal, "santal", "Prospecto")
    oportunidad(de_dulce, "dulce_tentacion", "Prospecto")

    r = client.get("/api/crm/clientes", headers=solo_santal, params={"q": marca, "limit": 100})
    visibles = {c["_id"] for c in datos(r.json())}
    assert visibles == {de_santal}
    assert sin_actividad not in visibles and de_dulce not in visibles


def test_creador_accede_a_su_cliente_sin_actividad(client, solo_santal):
    r = client.post("/api/crm/clientes", headers=solo_santal, json={
        "empresa": unico("Propio"), "telefono": "5550700", "canal_origen": "directo",
    })
    assert r.status_code == 201, r.text
    cliente = id_de(r.json())
    base = f"/api/crm/clientes/{cliente}"

    assert client.get(base, headers=solo_santal).status_code == 200
    assert client.put(base, headers=solo_santal, json={"contacto": "Ana"}).status_code == 200
    assert client.get(f"{base}/timeline", headers=solo_santal).status_code == 200
    r = client.patch(f"{base}/estado", headers=solo_santal, json={"activo": False})
    assert r.status_code == 200 and r.json()["data"]["activo"] is False
    assert client.delete(base, headers=solo_santal).status_code == 200


def test_cliente_ajeno_sin_actividad_no_es_accesible(client, admin, solo_santal):
    cliente = id_de(client.post("/api/crm/clientes", headers=admin, json={
        "empresa": unico("Ajeno"), "telefono": "5550800", "canal_origen": "directo",
    }).json())
    base = f"/api/crm/clientes/{cliente}"

    assert client.get(base, headers=solo_santal).status_code == 403
    assert client.put(base, headers=solo_santal, json={"contacto": "x"}).status_code == 403
    assert client.get(f"{base}/timeline", headers=solo_santal).status_code == 403
    assert client.patch(f"{base}/estado", headers=solo_santal, json={"activo": False}).status_code == 403
    assert client.delete(base, headers=solo_santal).status_code == 403


def test_duplicado_ajeno_no_revela_datos(client, admin, solo_santal):
    empresa = unico("Duplicado")
    original = client.post("/api/crm/clientes", headers=admin, json={
        "empresa": empresa, "telefono": "5550900", "canal_origen": "directo",
    })
    assert original.status_code == 201, original.text

    r = client.post("/api/crm/clientes", headers=solo_santal, json={
        "empresa": empresa, "telefono": "5550900", "canal_origen": "directo",
    })
    assert r.status_code == 200
    assert r.json() == {"duplicate_warning": True}


class TestCRMOtroNegocio:
    """Un usuario solo-Santal no puede tocar clientes ni oportunidades de otro negocio."""

    @pytest.fixture
    def cliente_dt(self, client, admin):
        r = client.post("/api/crm/clientes", headers=admin, json={
            "empresa": unico("Cliente DT"), "telefono": "5550101", "canal_origen": "directo",
        })
        return id_de(r.json())

    @pytest.fixture
    def oportunidad_dt(self, client, admin, cliente_dt):
        r = client.post("/api/crm/oportunidades", headers=admin, json={
            "cliente_id": cliente_dt, "negocio_id": "dulce_tentacion", "etapa": "Prospecto",
        })
        return id_de(r.json())

    def test_crear_cliente(self, client, solo_santal):
        # Clientes unificados: el alta no pertenece a un negocio, así que no se bloquea
        r = client.post("/api/crm/clientes", headers=solo_santal, json={
            "empresa": unico("X"), "telefono": "5550102", "canal_origen": "directo",
        })
        assert r.status_code == 201

    def test_ver_cliente(self, client, solo_santal, cliente_dt):
        assert client.get(f"/api/crm/clientes/{cliente_dt}", headers=solo_santal).status_code == 403

    def test_editar_cliente(self, client, solo_santal, cliente_dt):
        r = client.put(f"/api/crm/clientes/{cliente_dt}", headers=solo_santal, json={"nombre": "hack"})
        assert r.status_code == 403

    def test_desactivar_cliente(self, client, solo_santal, cliente_dt):
        r = client.patch(f"/api/crm/clientes/{cliente_dt}/estado", headers=solo_santal,
                         json={"activo": False})
        assert r.status_code == 403

    def test_mover_oportunidad(self, client, solo_santal, oportunidad_dt):
        r = client.put(f"/api/crm/oportunidades/{oportunidad_dt}/etapa", headers=solo_santal,
                       json={"etapa": "Negociación"})
        assert r.status_code == 403

    def test_borrar_oportunidad(self, client, solo_santal, oportunidad_dt):
        assert client.delete(f"/api/crm/oportunidades/{oportunidad_dt}", headers=solo_santal).status_code == 403


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


@pytest.mark.parametrize("negocios, negocio, permitido", [
    (["santal", "dulce_tentacion"], "santal", True),
    (["santal"], "dulce_tentacion", False),
    ("santal", "santal", True),       # un texto suelto cuenta como un negocio
    ("santal", "san", False),         # y no da acceso por subcadena
    ([], "santal", False),
    (["santal"], "", False),
    (["santal"], None, False),
])
def test_verificar_acceso(negocios, negocio, permitido):
    from fastapi import HTTPException
    from app.core.negocios import verificar_acceso

    try:
        verificar_acceso({"negocios": negocios}, negocio)
        assert permitido
    except HTTPException as e:
        assert not permitido and e.status_code == 403


def test_listar_negocios_del_usuario(client, admin, solo_santal):
    r = client.get("/api/negocios", headers=admin)
    assert r.status_code == 200, r.text
    negocios = r.json()
    assert set(NEGOCIOS) <= {n["id"] for n in negocios}
    lab = next(n for n in negocios if n["id"] == "diagnostico_plus")
    assert lab["tipo"] == "laboratorio_clinico" and lab["nombre"]

    # Un usuario solo ve los negocios que tiene asignados
    r = client.get("/api/negocios", headers=solo_santal)
    assert [n["id"] for n in r.json()] == ["santal"]

    assert client.get("/api/negocios").status_code == 401
