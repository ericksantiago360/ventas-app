"""Clínica: agenda médica, traslapes, disponibilidad y cambios de estado."""
import pytest

from .conftest import unico

C = {"negocio_id": "diagnostico_plus"}
URL = "/api/clinica/citas"
TZ = "America/Mexico_City"     # UTC-6, sin horario de verano


@pytest.fixture(scope="module")
def medico(client, admin):
    return client.get("/api/clinica/medicos", headers=admin, params=C).json()[0]["id"]


@pytest.fixture(scope="module")
def otro_medico(client, admin):
    r = client.post("/api/usuarios", headers=admin, json={
        "nombre": "Dra. Segunda", "email": f"{unico('medico').lower()}@clinica.mx",
        "password": "medico-12345", "negocios": [C["negocio_id"]],
    })
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.fixture
def expediente(client, admin):
    r = client.post("/api/clinica/expedientes", headers=admin, json={
        **C, "paciente": {"nombre": unico("Paciente"), "apellido_paterno": "López", "telefono": "555-1"},
        "antecedentes": {"alergias": ["Penicilina"]},
    })
    assert r.status_code == 201, r.text
    return r.json()


def agendar(client, admin, expediente, medico, inicio, **extra):
    return client.post(URL, headers=admin, json={
        **C, "expediente_id": expediente["id"], "medico_id": medico, "fecha_inicio": inicio, **extra,
    })


def test_crear(client, admin, expediente, medico):
    # Sin zona horaria = hora local de la clínica
    r = agendar(client, admin, expediente, medico, "2031-01-06T10:00:00", duracion_minutos=45,
                tipo="primera_vez", consultorio=" Consultorio 1 ", motivo="Revisión")
    assert r.status_code == 201, r.text
    cita = r.json()
    assert cita["folio"].startswith("CIT-")
    assert cita["estado"] == "programada"
    assert cita["fecha_inicio"].startswith("2031-01-06T16:00:00")      # 10:00 en CDMX = 16:00 UTC
    assert cita["fecha_fin"].startswith("2031-01-06T16:45:00")
    assert cita["consultorio"] == "Consultorio 1"
    assert cita["paciente_nombre"].endswith("López")
    assert cita["expediente_folio"] == expediente["folio"]
    assert cita["alergias"] == ["Penicilina"]
    assert cita["medico_nombre"]

    assert "Consultorio 1" in client.get("/api/clinica/consultorios", headers=admin, params=C).json()


def test_traslapes(client, admin, expediente, medico, otro_medico):
    assert agendar(client, admin, expediente, medico, "2031-01-07T10:00:00-06:00",
                   consultorio="Sala A").status_code == 201

    # Mismo médico, horario encimado
    r = agendar(client, admin, expediente, medico, "2031-01-07T10:15:00-06:00", consultorio="Sala B")
    assert r.status_code == 409
    assert "médico" in r.json()["detail"]
    # Otro médico, mismo consultorio
    r = agendar(client, admin, expediente, otro_medico, "2031-01-07T10:15:00-06:00", consultorio="Sala A")
    assert r.status_code == 409
    assert "Sala A" in r.json()["detail"]
    # Justo al terminar sí cabe
    assert agendar(client, admin, expediente, medico, "2031-01-07T10:30:00-06:00").status_code == 201
    # Otro médico en otro consultorio a la misma hora, también
    assert agendar(client, admin, expediente, otro_medico, "2031-01-07T10:00:00-06:00",
                   consultorio="Sala B").status_code == 201


def test_cancelar_libera_horario(client, admin, expediente, medico):
    cita = agendar(client, admin, expediente, medico, "2031-01-08T09:00:00").json()
    r = client.delete(f"{URL}/{cita['id']}", headers=admin, params={"motivo": "Paciente enfermo"})
    assert r.status_code == 200
    assert r.json()["estado"] == "cancelada"
    assert r.json()["motivo_cancelacion"] == "Paciente enfermo"

    assert agendar(client, admin, expediente, medico, "2031-01-08T09:00:00").status_code == 201
    # Una cancelada ya no se modifica
    assert client.put(f"{URL}/{cita['id']}", headers=admin, json={"estado": "confirmada"}).status_code == 400
    assert client.delete(f"{URL}/{cita['id']}", headers=admin).status_code == 400


def test_reprogramar_y_estados(client, admin, expediente, medico):
    a = agendar(client, admin, expediente, medico, "2031-01-09T09:00:00").json()
    b = agendar(client, admin, expediente, medico, "2031-01-09T11:00:00").json()
    client.put(f"{URL}/{a['id']}", headers=admin, json={"recordatorio_enviado": True})

    # Moverla encima de otra cita no se puede
    assert client.put(f"{URL}/{a['id']}", headers=admin, json={"fecha_inicio": "2031-01-09T11:15:00"}).status_code == 409
    # Ampliar su duración sobre sí misma sí (no choca consigo)
    r = client.put(f"{URL}/{a['id']}", headers=admin, json={"duracion_minutos": 60})
    assert r.status_code == 200, r.text
    assert r.json()["fecha_fin"].startswith("2031-01-09T16:00:00")
    assert r.json()["recordatorio_enviado"] is True

    r = client.put(f"{URL}/{a['id']}", headers=admin, json={"fecha_inicio": "2031-01-09T12:00:00"})
    assert r.status_code == 200
    assert r.json()["fecha_inicio"].startswith("2031-01-09T18:00:00")
    assert r.json()["recordatorio_enviado"] is False   # se movió: hay que avisar de nuevo

    # No-show libera el horario; reactivarla exige que siga libre
    client.put(f"{URL}/{b['id']}", headers=admin, json={"estado": "no_show"})
    otra = agendar(client, admin, expediente, medico, "2031-01-09T11:00:00")
    assert otra.status_code == 201
    assert client.put(f"{URL}/{b['id']}", headers=admin, json={"estado": "confirmada"}).status_code == 409

    for estado in ("confirmada", "en_consulta", "atendida"):
        assert client.put(f"{URL}/{a['id']}", headers=admin, json={"estado": estado}).json()["estado"] == estado
    assert client.put(f"{URL}/{a['id']}", headers=admin, json={"motivo": "x"}).status_code == 400
    assert client.put(f"{URL}/{otra.json()['id']}", headers=admin, json={}).status_code == 400


def test_listar_y_hoy(client, admin, expediente, medico, otro_medico):
    agendar(client, admin, expediente, medico, "2031-01-10T17:00:00")
    agendar(client, admin, expediente, otro_medico, "2031-01-10T08:00:00")
    # 23:30 del día 10 en CDMX ya es el 11 en UTC: debe contar como del día 10
    agendar(client, admin, expediente, medico, "2031-01-10T23:30:00")
    agendar(client, admin, expediente, medico, "2031-01-11T08:00:00")

    dia = client.get(f"{URL}/hoy", headers=admin, params={**C, "fecha": "2031-01-10", "tz": TZ}).json()
    assert [c["fecha_inicio"][11:16] for c in dia] == ["14:00", "23:00", "05:30"]   # en UTC, por hora local

    solo = client.get(f"{URL}/hoy", headers=admin, params={**C, "fecha": "2031-01-10", "tz": TZ, "medico_id": medico}).json()
    assert len(solo) == 2

    r = client.get(URL, headers=admin, params={**C, "desde": "2031-01-10T00:00:00-06:00",
                                               "hasta": "2031-01-12T00:00:00-06:00", "medico_id": medico})
    assert len(r.json()) == 3
    r = client.get(URL, headers=admin, params={**C, "expediente_id": expediente["id"], "estado": "programada,confirmada"})
    assert len(r.json()) == 4

    assert client.get(f"{URL}/hoy", headers=admin, params={**C, "tz": "Marte/Base"}).status_code == 400


def test_disponibilidad(client, admin, expediente, medico):
    agendar(client, admin, expediente, medico, "2031-01-13T09:00:00", duracion_minutos=60)
    agendar(client, admin, expediente, medico, "2031-01-13T11:15:00")
    params = {**C, "medico_id": medico, "fecha": "2031-01-13", "tz": TZ,
              "hora_inicio": "08:00", "hora_fin": "12:00", "duracion": 30}
    libres = client.get(f"{URL}/disponibilidad", headers=admin, params=params).json()
    # Hora local = UTC-6
    horas = [f"{int(s['inicio'][11:13]) - 6:02d}:{s['inicio'][14:16]}" for s in libres]
    assert horas == ["08:00", "08:30", "10:00", "10:30"]

    # Días pasados no tienen horarios libres
    assert client.get(f"{URL}/disponibilidad", headers=admin, params={**params, "fecha": "2020-01-01"}).json() == []


def test_validaciones(client, admin, expediente, medico):
    assert agendar(client, admin, expediente, "", "2031-01-14T10:00:00").status_code == 422
    assert agendar(client, admin, expediente, medico, "2031-01-14T10:00:00", duracion_minutos=0).status_code == 422
    assert agendar(client, admin, {"id": "000000000000000000000000"}, medico, "2031-01-14T10:00:00").status_code == 404

    otro = client.post("/api/clinica/expedientes", headers=admin, json={
        "negocio_id": "santal", "paciente": {"nombre": unico("Ajeno")},
    }).json()
    assert agendar(client, admin, otro, medico, "2031-01-14T10:00:00").status_code == 404


def test_sin_acceso_al_negocio(client, admin, solo_santal, expediente, medico):
    cita = agendar(client, admin, expediente, medico, "2031-01-15T10:00:00").json()
    assert client.get(URL, headers=solo_santal, params=C).status_code == 403
    assert client.get(f"{URL}/hoy", headers=solo_santal, params=C).status_code == 403
    assert client.get(f"{URL}/{cita['id']}", headers=solo_santal).status_code == 403
    assert client.put(f"{URL}/{cita['id']}", headers=solo_santal, json={"estado": "confirmada"}).status_code == 403
    assert client.delete(f"{URL}/{cita['id']}", headers=solo_santal).status_code == 403
    assert client.post(URL, headers=solo_santal, json={
        **C, "expediente_id": expediente["id"], "medico_id": medico, "fecha_inicio": "2031-01-15T12:00:00",
    }).status_code == 403
