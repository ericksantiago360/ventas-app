"""Clínica: perfil médico, recetas con PDF y verificación pública por QR."""
import pytest

from .conftest import NEGOCIO_ROLES, es_pdf, unico, usuario_con_rol

C = {"negocio_id": "diagnostico_plus"}
URL = "/api/clinica/recetas"
FIRMA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

MEDICAMENTOS = [
    {"nombre": "Paracetamol", "presentacion": "tabletas 500 mg", "dosis": "1 tableta",
     "frecuencia": "cada 8 horas", "duracion": "5 días", "via": "oral", "indicaciones": "con alimentos"},
    {"nombre": "Loratadina", "dosis": "10 mg", "frecuencia": "cada 24 horas", "duracion": "7 días"},
]


@pytest.fixture(scope="module")
def con_perfil(client, admin):
    r = client.put("/api/clinica/perfil-medico", headers=admin, json={
        "cedula_profesional": " 1234567 ", "especialidad": "Medicina interna",
        "institucion": "UNAM", "firma_base64": FIRMA,
    })
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def expediente(client, admin):
    r = client.post("/api/clinica/expedientes", headers=admin, json={
        **C, "paciente": {"nombre": unico("Ana"), "apellido_paterno": "Torres", "sexo": "femenino",
                          "fecha_nacimiento": "1990-05-01"},
        "antecedentes": {"alergias": ["Penicilina"]},
    })
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def nota(client, admin, expediente):
    r = client.post(f"/api/clinica/expedientes/{expediente['id']}/notas", headers=admin, json={
        "subjetivo": "Fiebre", "signos_vitales": {"peso": 62.5, "talla": 165},
        "diagnosticos": [{"cie10": "J06.9", "descripcion": "Infección aguda de vías respiratorias superiores"}],
    })
    assert r.status_code == 201, r.text
    return r.json()


def test_perfil_medico(client, admin, con_perfil):
    assert con_perfil["cedula_profesional"] == "1234567"
    perfil = client.get("/api/clinica/perfil-medico", headers=admin).json()
    assert perfil["especialidad"] == "Medicina interna"
    assert perfil["nombre"]

    assert client.put("/api/clinica/perfil-medico", headers=admin,
                      json={"firma_base64": "data:text/html;base64,PHNjcmlwdD4="}).status_code == 422


def test_sin_cedula_no_emite(client, admin):
    # Médico recién creado: aún no registra su perfil médico
    medico, _ = usuario_con_rol(client, admin, "medico")
    exp = client.post("/api/clinica/expedientes", headers=admin, json={
        "negocio_id": NEGOCIO_ROLES, "paciente": {"nombre": unico("Pac")},
    }).json()
    r = client.post(URL, headers=medico, json={"expediente_id": exp["id"], "medicamentos": MEDICAMENTOS})
    assert r.status_code == 400
    assert "cédula" in r.json()["detail"]


def test_crear_desde_nota(client, admin, con_perfil, expediente, nota):
    r = client.post(URL, headers=admin, json={
        "expediente_id": expediente["id"], "nota_clinica_id": nota["id"],
        "medicamentos": MEDICAMENTOS, "indicaciones_generales": "Reposo e hidratación",
    })
    assert r.status_code == 201, r.text
    rx = r.json()
    assert rx["folio"].startswith("RX-")
    assert rx["estado"] == "vigente"
    assert len(rx["folio_verificacion"]) == 36
    # Diagnóstico tomado de la nota; datos copiados del médico y del paciente
    assert rx["diagnostico"] == "J06.9 Infección aguda de vías respiratorias superiores"
    assert rx["medico"]["cedula_profesional"] == "1234567"
    assert rx["paciente"]["alergias"] == ["Penicilina"]
    assert rx["paciente"]["peso"] == 62.5
    assert rx["paciente"]["edad"] > 30
    assert rx["url_verificacion"] == f"http://testserver/rx/verificar/{rx['folio_verificacion']}"

    pdf = client.get(f"{URL}/{rx['id']}/pdf", headers=admin)
    assert es_pdf(pdf)
    assert pdf.headers["content-type"] == "application/pdf"

    # Cambiar el perfil después no altera la receta emitida
    client.put("/api/clinica/perfil-medico", headers=admin, json={**con_perfil, "especialidad": "Otra"})
    assert client.get(f"{URL}/{rx['id']}", headers=admin).json()["medico"]["especialidad"] == "Medicina interna"
    client.put("/api/clinica/perfil-medico", headers=admin, json=con_perfil)


def test_validaciones(client, admin, con_perfil, expediente, nota):
    assert client.post(URL, headers=admin, json={"expediente_id": expediente["id"], "medicamentos": []}).status_code == 422
    assert client.post(URL, headers=admin, json={"expediente_id": expediente["id"],
                                                 "medicamentos": [{"nombre": ""}]}).status_code == 422
    # La nota debe ser del mismo expediente
    otro = client.post("/api/clinica/expedientes", headers=admin, json={**C, "paciente": {"nombre": unico("Otro")}}).json()
    r = client.post(URL, headers=admin, json={"expediente_id": otro["id"], "nota_clinica_id": nota["id"],
                                              "medicamentos": MEDICAMENTOS})
    assert r.status_code == 404


def test_verificacion_publica_y_cancelar(client, admin, con_perfil, expediente):
    rx = client.post(URL, headers=admin, json={"expediente_id": expediente["id"], "medicamentos": MEDICAMENTOS}).json()
    url = f"{URL}/verificar/{rx['folio_verificacion']}"

    v = client.get(url)          # sin sesión
    assert v.status_code == 200
    v = v.json()
    assert v["valida"] is True
    assert v["medico"]["cedula_profesional"] == "1234567"
    assert [m["nombre"] for m in v["medicamentos"]] == ["Paracetamol", "Loratadina"]
    # Solo iniciales del paciente; sin alergias ni expediente
    assert v["paciente_iniciales"] == "".join(f"{p[0]}. " for p in rx["paciente"]["nombre"].split()).strip()
    assert "expediente_id" not in v and "alergias" not in str(v)

    assert client.get(f"{URL}/verificar/no-existe").status_code == 404

    assert client.post(f"{URL}/{rx['id']}/cancelar", headers=admin, json={"motivo": ""}).status_code == 422
    r = client.post(f"{URL}/{rx['id']}/cancelar", headers=admin, json={"motivo": "Dosis equivocada"})
    assert r.status_code == 200, r.text
    assert r.json()["estado"] == "cancelada"
    assert client.get(url).json()["valida"] is False
    assert client.get(url).json()["motivo_cancelacion"] == "Dosis equivocada"
    assert es_pdf(client.get(f"{URL}/{rx['id']}/pdf", headers=admin))
    assert client.post(f"{URL}/{rx['id']}/cancelar", headers=admin, json={"motivo": "x"}).status_code == 400


def test_listar(client, admin, con_perfil, expediente):
    rx = client.post(URL, headers=admin, json={"expediente_id": expediente["id"], "medicamentos": MEDICAMENTOS}).json()
    lista = client.get(URL, headers=admin, params={**C, "expediente_id": expediente["id"]}).json()
    assert [r["id"] for r in lista["items"]] == [rx["id"]]
    assert "firma_base64" not in lista["items"][0]["medico"]

    for q in (rx["folio"], "loratadina", expediente["paciente"]["nombre"]):
        ids = [r["id"] for r in client.get(URL, headers=admin, params={**C, "q": q}).json()["items"]]
        assert rx["id"] in ids, q


def test_sin_acceso_al_negocio(client, admin, solo_santal, con_perfil, expediente):
    rx = client.post(URL, headers=admin, json={"expediente_id": expediente["id"], "medicamentos": MEDICAMENTOS}).json()
    assert client.get(URL, headers=solo_santal, params=C).status_code == 403
    assert client.get(f"{URL}/{rx['id']}", headers=solo_santal).status_code == 403
    assert client.get(f"{URL}/{rx['id']}/pdf", headers=solo_santal).status_code == 403
    assert client.post(f"{URL}/{rx['id']}/cancelar", headers=solo_santal, json={"motivo": "x"}).status_code == 403
    assert client.post(URL, headers=solo_santal, json={"expediente_id": expediente["id"],
                                                       "medicamentos": MEDICAMENTOS}).status_code == 403
