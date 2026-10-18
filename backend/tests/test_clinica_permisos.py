"""Roles de clínica por negocio: qué puede hacer cada uno, compatibilidad del laboratorio y alta de roles."""
import pytest

from app.core.permissions import ROLES_CLINICA, tiene_permiso

from .conftest import NEGOCIO_ROLES, unico, usuario_con_rol

N = {"negocio_id": NEGOCIO_ROLES}
FIRMA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="


@pytest.fixture(scope="module")
def u(client, admin):
    """Un usuario por rol en el negocio de prueba, más uno sin rol de clínica."""
    usuarios = {rol: usuario_con_rol(client, admin, rol) for rol in [*ROLES_CLINICA, ""]}
    medico_h, _ = usuarios["medico"]
    client.put("/api/clinica/perfil-medico", headers=medico_h, json={"cedula_profesional": "1112223"})
    return usuarios


@pytest.fixture(scope="module")
def expediente(client, admin):
    r = client.post("/api/clinica/expedientes", headers=admin, json={**N, "paciente": {"nombre": unico("Perm")}})
    assert r.status_code == 201, r.text
    return r.json()


def h(u, rol):
    return u[rol][0]


def test_tabla_de_permisos():
    medico = {"rol": "usuario", "roles_clinica": {"x": "medico"}}
    assert tiene_permiso(medico, "x", "notas:create")
    assert not tiene_permiso(medico, "x", "expedientes:create")      # el médico no abre expedientes (plan)
    assert not tiene_permiso(medico, "otro", "notas:create")          # el rol es por negocio
    assert tiene_permiso({"rol": "usuario", "roles_clinica": {"x": "admin_clinica"}}, "x", "lab:config")
    assert tiene_permiso({"rol": "admin"}, "x", "cualquier:cosa")
    assert not tiene_permiso({"rol": "usuario"}, "x", "expedientes:read")


def test_sin_rol_no_ve_la_clinica_pero_si_el_laboratorio(client, u, expediente):
    sin_rol = h(u, "")
    r = client.get("/api/clinica/expedientes", headers=sin_rol, params=N)
    assert r.status_code == 403 and "rol de clínica" in r.json()["detail"]
    assert client.get(f"/api/clinica/expedientes/{expediente['id']}", headers=sin_rol).status_code == 403
    # Laboratorio de siempre: sin rol de clínica conserva el acceso
    assert client.get("/api/lab/ordenes", headers=sin_rol, params=N).status_code == 200
    assert client.post("/api/lab/plantillas/seed", headers=sin_rol, params=N).status_code == 201


def test_recepcion(client, u, expediente):
    r = h(u, "recepcion")
    nuevo = client.post("/api/clinica/expedientes", headers=r, json={**N, "paciente": {"nombre": unico("Rec")}})
    assert nuevo.status_code == 201
    medico_id = u["medico"][1]
    cita = client.post("/api/clinica/citas", headers=r, json={**N, "expediente_id": expediente["id"], "medico_id": medico_id,
                                                               "fecha_inicio": "2031-03-03T10:00:00"})
    assert cita.status_code == 201, cita.text
    assert client.put(f"/api/clinica/citas/{cita.json()['id']}", headers=r, json={"estado": "confirmada"}).status_code == 200

    assert client.put(f"/api/clinica/expedientes/{expediente['id']}", headers=r, json={"paciente": {"telefono": "1"}}).status_code == 403
    assert client.post(f"/api/clinica/expedientes/{expediente['id']}/notas", headers=r, json={"subjetivo": "x"}).status_code == 403
    assert client.get("/api/clinica/recetas", headers=r, params=N).status_code == 403
    assert client.get("/api/clinica/farmacia", headers=r, params=N).status_code == 403
    # Con rol de clínica, el laboratorio ya sigue sus permisos
    assert client.get("/api/lab/ordenes", headers=r, params=N).status_code == 403


def test_medico(client, u, expediente):
    m = h(u, "medico")
    assert client.post("/api/clinica/expedientes", headers=m, json={**N, "paciente": {"nombre": "x"}}).status_code == 403
    assert client.post(f"/api/clinica/expedientes/{expediente['id']}/notas", headers=m, json={"subjetivo": "Dolor"}).status_code == 201
    rx = client.post("/api/clinica/recetas", headers=m, json={"expediente_id": expediente["id"], "medicamentos": [{"nombre": "Ibuprofeno"}]})
    assert rx.status_code == 201, rx.text
    assert client.get(f"/api/clinica/recetas/{rx.json()['id']}/pdf", headers=m).status_code == 200
    assert client.post("/api/clinica/citas", headers=m, json={**N, "expediente_id": expediente["id"], "medico_id": u["medico"][1],
                                                              "fecha_inicio": "2031-03-04T10:00:00"}).status_code == 403
    assert client.get("/api/lab/ordenes", headers=m, params=N).status_code == 200
    assert client.post("/api/lab/rangos/seed", headers=m, params=N).status_code == 403          # configuración del laboratorio
    assert client.post("/api/clinica/consentimientos/plantillas", headers=m, json={
        **N, "tipo": "x", "titulo": "x", "texto": "Texto suficientemente largo"}).status_code == 403

    # El administrador de clínica puede cancelar recetas de otros médicos
    assert client.post(f"/api/clinica/recetas/{rx.json()['id']}/cancelar", headers=h(u, "admin_clinica"),
                       json={"motivo": "Prueba"}).status_code == 200


def test_otro_medico_no_cancela_receta_ajena(client, admin, u, expediente):
    rx = client.post("/api/clinica/recetas", headers=h(u, "medico"),
                     json={"expediente_id": expediente["id"], "medicamentos": [{"nombre": "Paracetamol"}]}).json()
    otro, _ = usuario_con_rol(client, admin, "medico")
    r = client.post(f"/api/clinica/recetas/{rx['id']}/cancelar", headers=otro, json={"motivo": "x"})
    assert r.status_code == 403


def test_laboratorista_y_farmacia(client, u, expediente):
    lab = h(u, "laboratorista")
    assert client.get(f"/api/clinica/expedientes/{expediente['id']}", headers=lab).status_code == 200
    assert client.post(f"/api/clinica/expedientes/{expediente['id']}/notas", headers=lab, json={"subjetivo": "x"}).status_code == 403
    assert client.get("/api/lab/ordenes", headers=lab, params=N).status_code == 200
    assert client.post("/api/lab/plantillas/seed", headers=lab, params=N).status_code == 403

    f = h(u, "farmacia")
    art = client.post("/api/clinica/farmacia", headers=f, json={**N, "nombre": unico("Med")})
    assert art.status_code == 201
    assert client.post(f"/api/clinica/farmacia/{art.json()['id']}/entrada", headers=f,
                       json={"numero_lote": "L1", "fecha_caducidad": "2031-01-01", "cantidad": 3}).status_code == 201
    assert client.get("/api/clinica/recetas", headers=f, params=N).status_code == 200
    assert client.post("/api/clinica/expedientes", headers=f, json={**N, "paciente": {"nombre": "x"}}).status_code == 403
    # El médico mueve inventario pero no da de alta artículos
    assert client.post("/api/clinica/farmacia", headers=h(u, "medico"), json={**N, "nombre": "x"}).status_code == 403


def test_admin_clinica(client, u):
    a = h(u, "admin_clinica")
    assert client.post("/api/lab/rangos/seed", headers=a, params=N).status_code == 201
    assert client.post("/api/clinica/consentimientos/plantillas", headers=a, json={
        **N, "tipo": unico("t").lower(), "titulo": "Propia", "texto": "Texto suficientemente largo"}).status_code == 201


def test_medicos_por_rol(client, admin, u, expediente):
    # El negocio ya asigna médicos: la lista y la validación solo aceptan el rol médico
    medicos = client.get("/api/clinica/medicos", headers=admin, params=N).json()
    assert u["medico"][1] in {m["id"] for m in medicos}
    assert u["recepcion"][1] not in {m["id"] for m in medicos}
    r = client.put(f"/api/clinica/expedientes/{expediente['id']}", headers=admin, json={"medico_id": u["recepcion"][1]})
    assert r.status_code == 400 and "rol de médico" in r.json()["detail"]
    assert client.put(f"/api/clinica/expedientes/{expediente['id']}", headers=admin, json={"medico_id": u["medico"][1]}).status_code == 200


def test_mis_permisos(client, admin, u):
    r = client.get("/api/clinica/mis-permisos", headers=h(u, "recepcion"), params=N).json()
    assert r["rol"] == "recepcion" and "citas:create" in r["permisos"] and r["admin"] is False
    assert client.get("/api/clinica/mis-permisos", headers=admin, params=N).json()["permisos"] == ["*"]
    assert client.get("/auth/me", headers=h(u, "medico")).json()["roles_clinica"] == {NEGOCIO_ROLES: "medico"}


def test_alta_y_cambio_de_roles(client, admin):
    base = {"nombre": "Rol Prueba", "password": "secreta123", "negocios": [NEGOCIO_ROLES]}
    # Rol en un negocio que el usuario no tiene, o rol inexistente
    r = client.post("/api/usuarios", headers=admin, json={**base, "email": f"{unico('a').lower()}@t.mx", "roles_clinica": {"santal": "medico"}})
    assert r.status_code == 400
    r = client.post("/api/usuarios", headers=admin, json={**base, "email": f"{unico('b').lower()}@t.mx", "roles_clinica": {NEGOCIO_ROLES: "cirujano"}})
    assert r.status_code == 422

    r = client.post("/api/usuarios", headers=admin, json={**base, "email": f"{unico('c').lower()}@t.mx", "roles_clinica": {NEGOCIO_ROLES: "recepcion"}})
    assert r.status_code == 201 and r.json()["roles_clinica"] == {NEGOCIO_ROLES: "recepcion"}
    uid = r.json()["id"]
    assert client.put(f"/api/usuarios/{uid}", headers=admin, json={"roles_clinica": {NEGOCIO_ROLES: "medico"}}).json()["roles_clinica"] == {NEGOCIO_ROLES: "medico"}
    assert client.put(f"/api/usuarios/{uid}", headers=admin, json={"roles_clinica": {NEGOCIO_ROLES: ""}}).json()["roles_clinica"] == {}
    client.put(f"/api/usuarios/{uid}", headers=admin, json={"roles_clinica": {NEGOCIO_ROLES: "medico"}})
    # Quitarle el negocio le quita el rol en él
    r = client.put(f"/api/usuarios/{uid}", headers=admin, json={"negocios": ["santal"]})
    assert r.json()["roles_clinica"] == {}
