"""Administración de usuarios: alta, edición y alcance por negocio."""
import uuid

import pytest

URL = "/api/usuarios"


def nuevo_email() -> str:
    return f"user_{uuid.uuid4().hex[:8]}@test.mx"


def login(client, email, password):
    return client.post("/auth/login", data={"username": email, "password": password})


def headers_de(client, email, password) -> dict:
    r = login(client, email, password)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def crear(client, headers, **datos):
    base = {"nombre": "Usuario Prueba", "email": nuevo_email(), "password": "secreta123",
            "rol": "vendedor", "negocios": ["santal"]}
    return client.post(URL, headers=headers, json={**base, **datos})


@pytest.fixture
def admin_santal(client, admin):
    """Administrador con acceso solo a Santal."""
    email = nuevo_email()
    assert crear(client, admin, email=email, rol="admin", negocios=["santal"]).status_code == 201
    return headers_de(client, email, "secreta123")


def test_alta_y_login(client, admin):
    email = nuevo_email()
    r = crear(client, admin, nombre="Ana López", email=email.upper(), negocios=["santal", "dulce_tentacion"])
    assert r.status_code == 201, r.text
    usuario = r.json()
    assert usuario["email"] == email            # se guarda en minúsculas
    assert usuario["negocios"] == ["dulce_tentacion", "santal"]
    assert "password_hash" not in usuario

    # Entra aunque escriba el email con mayúsculas, y solo ve sus negocios
    h = headers_de(client, email.upper(), "secreta123")
    assert {n["id"] for n in client.get("/api/negocios", headers=h).json()} == {"santal", "dulce_tentacion"}

    assert usuario["id"] in {u["id"] for u in client.get(URL, headers=admin).json()}


def test_email_duplicado_y_datos_invalidos(client, admin):
    email = nuevo_email()
    assert crear(client, admin, email=email).status_code == 201
    assert crear(client, admin, email=email.upper()).status_code == 409

    for invalido in ({"password": "corta"}, {"email": "sin-arroba"}, {"rol": "dueño"}, {"nombre": ""}):
        assert crear(client, admin, **invalido).status_code == 422, invalido


def test_solo_administradores(client, solo_santal):
    assert client.get(URL, headers=solo_santal).status_code == 403
    assert crear(client, solo_santal).status_code == 403


def test_editar_password_y_desactivar(client, admin):
    email = nuevo_email()
    uid = crear(client, admin, email=email).json()["id"]

    r = client.put(f"{URL}/{uid}", headers=admin, json={"nombre": "Nuevo Nombre", "rol": "usuario", "password": "otra-clave-1"})
    assert r.status_code == 200, r.text
    assert r.json()["nombre"] == "Nuevo Nombre" and r.json()["rol"] == "usuario"
    assert login(client, email, "secreta123").status_code == 401
    assert login(client, email, "otra-clave-1").status_code == 200

    assert client.put(f"{URL}/{uid}", headers=admin, json={"activo": False}).status_code == 200
    assert login(client, email, "otra-clave-1").status_code == 401

    assert client.put(f"{URL}/000000000000000000000000", headers=admin, json={"nombre": "X Y"}).status_code == 404


def test_no_puede_quitarse_el_rol_ni_desactivarse(client, admin_santal):
    yo = client.get("/auth/me", headers=admin_santal).json()["id"]
    for cambio in ({"rol": "vendedor"}, {"activo": False}):
        r = client.put(f"{URL}/{yo}", headers=admin_santal, json=cambio)
        assert r.status_code == 400, cambio
    # Sigue siendo administrador
    assert client.get(URL, headers=admin_santal).status_code == 200


class TestAlcancePorNegocio:
    def test_no_asigna_negocios_que_no_tiene(self, client, admin_santal):
        assert crear(client, admin_santal, negocios=["dulce_tentacion"]).status_code == 403
        assert crear(client, admin_santal, negocios=["santal"]).status_code == 201

    def test_solo_ve_usuarios_de_sus_negocios(self, client, admin, admin_santal):
        ajeno = crear(client, admin, negocios=["dulce_tentacion"]).json()["id"]
        compartido = crear(client, admin, negocios=["santal", "dulce_tentacion"]).json()
        visibles = {u["id"]: u for u in client.get(URL, headers=admin_santal).json()}

        assert ajeno not in visibles
        assert client.put(f"{URL}/{ajeno}", headers=admin_santal, json={"nombre": "Hack Eado"}).status_code == 404
        # Del usuario compartido solo ve los negocios que también tiene
        assert visibles[compartido["id"]]["negocios"] == ["santal"]

    def test_editar_conserva_negocios_fuera_de_alcance(self, client, admin, admin_santal):
        uid = crear(client, admin, negocios=["santal", "dulce_tentacion"]).json()["id"]

        # El admin de Santal le quita Santal: no puede tocar Dulce Tentación
        r = client.put(f"{URL}/{uid}", headers=admin_santal, json={"negocios": []})
        assert r.status_code == 200, r.text
        completo = next(u for u in client.get(URL, headers=admin).json() if u["id"] == uid)
        assert completo["negocios"] == ["dulce_tentacion"]
