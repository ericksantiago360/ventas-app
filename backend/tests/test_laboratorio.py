"""Pacientes, órdenes, resultados, facturación de órdenes y portal del paciente."""
import re

import pytest

from .conftest import datos, es_pdf, id_de

L = {"negocio_id": "diagnostico_plus"}


@pytest.fixture(scope="module")
def plantilla(client, admin):
    client.post("/api/lab/plantillas/seed", headers=admin, params=L)
    plantillas = datos(client.get("/api/lab/plantillas", headers=admin, params=L).json())
    assert plantillas, "El seed no creó plantillas"
    return plantillas[0].get("id") or plantillas[0].get("_id")


@pytest.fixture
def paciente(client, admin):
    r = client.post("/api/pacientes/pacientes", headers=admin, json={
        **L, "nombre": "Ana", "apellido_paterno": "Pérez", "sexo": "femenino",
        "fecha_nacimiento": "1990-05-01", "email": "ana@test.mx",
    })
    assert r.status_code == 201, r.text
    return id_de(r.json())


@pytest.fixture
def orden_validada(client, admin, paciente, plantilla):
    r = client.post("/api/lab/ordenes", headers=admin, json={
        **L, "paciente_id": paciente, "fecha": "2026-10-16", "estudios": [{"plantilla_id": plantilla}],
    })
    assert r.status_code == 201, r.text
    orden = id_de(r.json())

    resultados = datos(client.get(f"/api/lab/ordenes/{orden}", headers=admin).json())["resultados"]
    assert resultados
    for res in resultados:
        rid = res.get("id") or res.get("_id")
        analitos = [dict(a, valor="5") for a in res["analitos"]]
        assert client.put(f"/api/lab/resultados/{rid}", headers=admin,
                          json={"analitos": analitos, "tecnico_nombre": "QA"}).status_code == 200
        assert client.patch(f"/api/lab/resultados/{rid}/validar", headers=admin,
                            params={"validado_por": "Dr QA"}).status_code == 200
    return orden


def test_sexo_invalido_422(client, admin):
    r = client.post("/api/pacientes/pacientes", headers=admin, json={**L, "nombre": "X", "sexo": "F"})
    assert r.status_code == 422


def test_pdf_orden(client, admin, orden_validada):
    assert es_pdf(client.get(f"/api/lab/ordenes/{orden_validada}/pdf", headers=admin))


def test_correo_sin_smtp_error_controlado(client, admin, orden_validada):
    assert client.get("/api/lab/correo/estado", headers=admin).status_code == 200
    r = client.post(f"/api/lab/ordenes/{orden_validada}/enviar-correo", headers=admin, json={})
    assert r.status_code in (400, 502, 503)
    assert "configurado" in r.json()["detail"]


def test_factura_desde_orden_una_sola_vez(client, admin, orden_validada):
    url = f"/api/facturacion/desde-orden/{orden_validada}"
    assert client.post(url, headers=admin, params={"emitir": True}).status_code == 201
    assert client.post(url, headers=admin).status_code in (400, 409)


def test_portal_del_paciente(client, admin, paciente, orden_validada):
    r = client.post(f"/api/pacientes/pacientes/{paciente}/portal/enlace", headers=admin)
    assert r.status_code == 200, r.text
    token = re.search(r"[?&]t=([\w\-.]+)", r.json()["url"]).group(1)
    portal = {"Authorization": f"Bearer {token}"}

    assert client.get("/api/portal/me", headers=portal).status_code == 200
    ordenes = client.get("/api/portal/ordenes", headers=portal)
    assert ordenes.status_code == 200
    assert es_pdf(client.get(f"/api/portal/ordenes/{orden_validada}/pdf", headers=portal))

    # El token del portal no abre la API interna
    assert client.get("/api/crm/clientes", headers=portal, params=L).status_code == 401

    assert client.post(f"/api/pacientes/pacientes/{paciente}/portal/revocar", headers=admin).status_code == 200
    assert client.get("/api/portal/me", headers=portal).status_code == 401
