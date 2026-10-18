"""Clínica: expediente clínico, notas SOAP y su vínculo con la colección de pacientes."""
import pytest

from .conftest import id_de, unico

C = {"negocio_id": "diagnostico_plus"}
URL = "/api/clinica/expedientes"


def nuevo_paciente(**extra) -> dict:
    return {"nombre": unico("Paciente"), "apellido_paterno": "Ramírez", "sexo": "femenino",
            "fecha_nacimiento": "1985-03-10", "curp": unico("CURP"), **extra}


@pytest.fixture
def expediente(client, admin):
    r = client.post(URL, headers=admin, json={
        **C, "paciente": nuevo_paciente(direccion="Calle 1",
                                        contacto_emergencia={"nombre": "Luis", "telefono": "555-1234", "parentesco": "esposo"}),
        "antecedentes": {"alergias": ["Penicilina", " penicilina ", "", "Sulfas"], "patologicos": "HTA"},
    })
    assert r.status_code == 201, r.text
    return r.json()


def test_crear_con_paciente_nuevo(client, admin, expediente):
    assert expediente["folio"].startswith("EXP-")
    assert expediente["alergico"] is True
    # Se quitan vacíos y repetidos sin importar mayúsculas
    assert expediente["antecedentes"]["alergias"] == ["Penicilina", "Sulfas"]

    # El paciente quedó en la colección compartida con laboratorio, con alergias y teléfono de emergencia
    paciente = client.get(f"/api/pacientes/pacientes/{expediente['paciente_id']}", headers=admin).json()
    assert paciente["folio"].startswith("PAC-")
    assert paciente["alergias"] == "Penicilina, Sulfas"
    assert paciente["telefono_emergencia"] == "555-1234"
    assert paciente["direccion"] == "Calle 1"


def test_crear_para_paciente_existente(client, admin):
    r = client.post("/api/pacientes/pacientes", headers=admin, json={
        **C, "nombre": unico("Lab"), "sexo": "masculino", "alergias": "Látex; Yodo",
    })
    paciente_id = id_de(r.json())

    r = client.post(URL, headers=admin, json={**C, "paciente_id": paciente_id})
    assert r.status_code == 201, r.text
    # Sin antecedentes explícitos, se toman las alergias que ya tenía el paciente
    assert r.json()["antecedentes"]["alergias"] == ["Látex", "Yodo"]

    # Un solo expediente por paciente
    r = client.post(URL, headers=admin, json={**C, "paciente_id": paciente_id})
    assert r.status_code == 409


def test_paciente_id_y_datos_a_la_vez_422(client, admin):
    r = client.post(URL, headers=admin, json={**C, "paciente_id": "x", "paciente": nuevo_paciente()})
    assert r.status_code == 422
    assert client.post(URL, headers=admin, json=C).status_code == 422


def test_paciente_de_otro_negocio(client, admin):
    r = client.post("/api/pacientes/pacientes", headers=admin, json={"negocio_id": "santal", "nombre": unico("Ajeno")})
    r = client.post(URL, headers=admin, json={**C, "paciente_id": id_de(r.json())})
    assert r.status_code == 404


def test_medico(client, admin):
    medicos = client.get("/api/clinica/medicos", headers=admin, params=C).json()
    assert medicos
    medico_id = medicos[0]["id"]

    r = client.post(URL, headers=admin, json={**C, "paciente": nuevo_paciente(), "medico_id": medico_id})
    assert r.status_code == 201, r.text
    assert r.json()["medico_nombre"]

    # El médico debe tener acceso al negocio
    solo_santal = client.get("/api/clinica/medicos", headers=admin, params={"negocio_id": "santal"}).json()
    ajeno = next(m["id"] for m in solo_santal if m["id"] not in {x["id"] for x in medicos})
    r = client.post(URL, headers=admin, json={**C, "paciente": nuevo_paciente(), "medico_id": ajeno})
    assert r.status_code == 404


def test_listar_y_buscar(client, admin, expediente):
    nombre = expediente["paciente"]["nombre"]
    r = client.get(URL, headers=admin, params={**C, "q": f"{nombre.lower()} ramírez"})
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["total"] >= 1
    assert expediente["id"] in {e["id"] for e in cuerpo["items"]}

    for q in (expediente["folio"], expediente["paciente"]["curp"], expediente["paciente"]["folio"]):
        encontrados = client.get(f"{URL}/buscar", headers=admin, params={**C, "q": q}).json()
        assert expediente["id"] in {e["id"] for e in encontrados}, q

    # Caracteres especiales de regex no rompen la búsqueda
    assert client.get(f"{URL}/buscar", headers=admin, params={**C, "q": "(["}).status_code == 200


def test_actualizar(client, admin, expediente):
    r = client.put(f"{URL}/{expediente['id']}", headers=admin, json={
        "paciente": {"telefono": "555-0000", "ocupacion": "Docente"},
        "antecedentes": {"alergias": []},
    })
    assert r.status_code == 200, r.text
    exp = r.json()
    assert exp["paciente"]["telefono"] == "555-0000"
    assert exp["paciente"]["ocupacion"] == "Docente"
    assert exp["alergico"] is False
    # Los demás antecedentes no se tocan
    assert exp["antecedentes"]["patologicos"] == "HTA"
    assert exp["paciente"]["alergias"] == ""

    assert client.put(f"{URL}/{expediente['id']}", headers=admin, json={}).status_code == 400


def test_notas_soap(client, admin, expediente):
    url = f"{URL}/{expediente['id']}/notas"
    r = client.post(url, headers=admin, json={
        "tipo": "primera_vez", "subjetivo": "Cefalea", "analisis": "Migraña",
        "signos_vitales": {"tension_arterial": "120/80", "frecuencia_cardiaca": 72, "temperatura": 36.5},
        "diagnosticos": [{"cie10": "G43.9", "descripcion": "Migraña, no especificada"}],
    })
    assert r.status_code == 201, r.text
    nota = r.json()
    assert nota["medico_nombre"]
    assert nota["expediente_id"] == expediente["id"]

    client.post(url, headers=admin, json={"plan": "Control en 1 mes", "fecha": "2030-01-01T10:00:00"})
    notas = client.get(url, headers=admin).json()
    assert [n["plan"] for n in notas][0] == "Control en 1 mes"   # más reciente primero

    detalle = client.get(f"{URL}/{expediente['id']}", headers=admin).json()
    assert len(detalle["notas"]) == 2


def test_nota_invalida_422(client, admin, expediente):
    url = f"{URL}/{expediente['id']}/notas"
    assert client.post(url, headers=admin, json={"subjetivo": "  "}).status_code == 422
    assert client.post(url, headers=admin, json={"subjetivo": "x", "signos_vitales": {"spo2": 140}}).status_code == 422


def test_sin_acceso_al_negocio(client, solo_santal, expediente):
    assert client.get(URL, headers=solo_santal, params=C).status_code == 403
    assert client.get(f"{URL}/{expediente['id']}", headers=solo_santal).status_code == 403
    assert client.get(f"{URL}/{expediente['id']}/notas", headers=solo_santal).status_code == 403
    assert client.post(f"{URL}/{expediente['id']}/notas", headers=solo_santal,
                       json={"subjetivo": "x"}).status_code == 403
    assert client.put(f"{URL}/{expediente['id']}", headers=solo_santal,
                      json={"paciente": {"telefono": "1"}}).status_code == 403


def test_archivos_adjuntos(client, admin, solo_santal, expediente):
    url = f"{URL}/{expediente['id']}/archivos"
    pdf = b"%PDF-1.4 estudio"
    r = client.post(url, headers=admin, data={"descripcion": "Rx tórax"},
                    files={"archivo": ("rx tórax.pdf", pdf, "application/pdf")})
    assert r.status_code == 201, r.text
    archivo = r.json()
    assert archivo["tamano"] == len(pdf) and archivo["descripcion"] == "Rx tórax"

    assert [a["id"] for a in client.get(url, headers=admin).json()] == [archivo["id"]]
    assert client.get(f"{URL}/{expediente['id']}", headers=admin).json()["archivos"][0]["id"] == archivo["id"]

    r = client.get(f"{url}/{archivo['id']}", headers=admin)
    assert r.status_code == 200
    assert r.content == pdf
    assert r.headers["content-type"] == "application/pdf"

    # Tipo no permitido, vacío y sin acceso
    assert client.post(url, headers=admin, files={"archivo": ("x.exe", b"MZ", "application/octet-stream")}).status_code == 400
    assert client.post(url, headers=admin, files={"archivo": ("x.pdf", b"", "application/pdf")}).status_code == 400
    assert client.get(f"{url}/{archivo['id']}", headers=solo_santal).status_code == 403
    assert client.post(url, headers=solo_santal, files={"archivo": ("x.pdf", pdf, "application/pdf")}).status_code == 403


def test_archivo_de_otro_expediente_404(client, admin, expediente):
    otro = client.post(URL, headers=admin, json={**C, "paciente": nuevo_paciente()}).json()
    r = client.post(f"{URL}/{otro['id']}/archivos", headers=admin,
                    files={"archivo": ("a.png", b"\x89PNG", "image/png")})
    # No se puede leer por el id desde otro expediente
    assert client.get(f"{URL}/{expediente['id']}/archivos/{r.json()['id']}", headers=admin).status_code == 404
