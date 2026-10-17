"""Alta de negocios: queda listo para operar sin tocar código."""
import uuid

from .conftest import datos, id_de, unico


def nuevo_id() -> str:
    return f"neg_{uuid.uuid4().hex[:8]}"


def test_alta_de_negocio_lista_para_operar(client, admin):
    negocio = nuevo_id()
    r = client.post("/api/negocios", headers=admin, json={
        "id": negocio, "nombre": "Ferretería Prueba", "tipo": "distribucion", "prefijo": "FER",
    })
    assert r.status_code == 201, r.text
    assert r.json() == {"id": negocio, "nombre": "Ferretería Prueba", "tipo": "distribucion"}
    N = {"negocio_id": negocio}

    # Aparece en la lista del administrador que lo creó
    assert negocio in {n["id"] for n in client.get("/api/negocios", headers=admin).json()}

    # Catálogo contable sembrado
    cuentas = datos(client.get("/api/contabilidad/cuentas", headers=admin, params=N).json())
    assert len(cuentas) >= 40

    # Cotizaciones y pedidos usan sus prefijos
    r = client.post("/api/cotizaciones/", headers=admin, json=N)
    assert r.status_code == 201, r.text
    assert r.json()["numero"].startswith("FER")
    r = client.post("/api/pedidos/", headers=admin, json={**N, "cliente_nombre": "X", "total": 0})
    assert r.status_code == 201, r.text

    # Y los módulos que reciben ?negocio_id= lo aceptan
    for url in ("/api/crm/clientes", "/api/inventario/stock", "/api/personal/empleados", "/api/finanzas/cuentas"):
        assert client.get(url, headers=admin, params=N).status_code == 200, url


def test_alta_solo_para_administradores(client, solo_santal):
    r = client.post("/api/negocios", headers=solo_santal, json={
        "id": nuevo_id(), "nombre": "No autorizado", "prefijo": "NOA",
    })
    assert r.status_code == 403


def test_negocio_nuevo_no_es_visible_para_otros_usuarios(client, admin, solo_santal):
    negocio = nuevo_id()
    assert client.post("/api/negocios", headers=admin, json={
        "id": negocio, "nombre": "Privado", "prefijo": "PRI",
    }).status_code == 201
    assert negocio not in {n["id"] for n in client.get("/api/negocios", headers=solo_santal).json()}
    r = client.get("/api/crm/clientes", headers=solo_santal, params={"negocio_id": negocio})
    assert r.status_code == 403


def test_alta_duplicada_e_invalida(client, admin):
    negocio = nuevo_id()
    datos_ok = {"id": negocio, "nombre": "Duplicado", "prefijo": "DUP"}
    assert client.post("/api/negocios", headers=admin, json=datos_ok).status_code == 201
    assert client.post("/api/negocios", headers=admin, json=datos_ok).status_code == 409
    # No se puede pisar un negocio sembrado
    assert client.post("/api/negocios", headers=admin, json={**datos_ok, "id": "santal"}).status_code == 409

    for invalido in (
        {"id": "Con Espacios"}, {"id": "ab"}, {"id": "1empieza_con_numero"},
        {"prefijo": "minusculas"}, {"prefijo": "X"}, {"nombre": ""}, {"tipo": "inventado"},
    ):
        r = client.post("/api/negocios", headers=admin, json={**datos_ok, "id": nuevo_id(), **invalido})
        assert r.status_code == 422, invalido
