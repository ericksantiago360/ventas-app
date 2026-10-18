"""Clínica: consentimiento informado con firmas, plantillas, huella de integridad y revocación."""
import pytest

from .conftest import es_pdf, unico

C = {"negocio_id": "diagnostico_plus"}
URL = "/api/clinica/consentimientos"
FIRMA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="


@pytest.fixture(scope="module", autouse=True)
def perfil(client, admin):
    client.put("/api/clinica/perfil-medico", headers=admin, json={"cedula_profesional": "7654321", "especialidad": "Cirugía general"})


@pytest.fixture
def expediente(client, admin):
    r = client.post("/api/clinica/expedientes", headers=admin, json={
        **C, "paciente": {"nombre": unico("Mario"), "apellido_paterno": "Soto", "fecha_nacimiento": "1975-02-01", "curp": "SOTM750201HDFXXX01"},
    })
    assert r.status_code == 201, r.text
    return r.json()


def cuerpo(expediente, **extra):
    return {
        "expediente_id": expediente["id"], "tipo": "cirugia", "titulo": "Consentimiento quirúrgico",
        "texto": "Yo, {firmante}, autorizo al {medico} (céd. {cedula}) a realizar {procedimiento} a {paciente}. Riesgos: {riesgos}. {desconocido} {",
        "procedimiento": "Colecistectomía laparoscópica", "riesgos": "Sangrado, infección",
        "firma_paciente_base64": FIRMA,
        "testigos": [{"nombre": "Ana Testigo", "firma_base64": FIRMA}, {"nombre": "Luis Testigo", "firma_base64": FIRMA}],
        **extra,
    }


def test_plantillas_incluidas_y_propias(client, admin):
    plantillas = client.get(f"{URL}/plantillas", headers=admin, params=C).json()
    tipos = {p["tipo"]: p for p in plantillas}
    assert {"cirugia", "anestesia", "procedimiento_menor"} <= tipos.keys()
    assert tipos["cirugia"]["propia"] is False and "{procedimiento}" in tipos["cirugia"]["texto"]

    # Una propia del mismo tipo reemplaza a la incluida; borrarla la regresa
    r = client.post(f"{URL}/plantillas", headers=admin, json={**C, "tipo": "Anestesia", "titulo": "Anestesia (clínica)",
                                                               "texto": "Texto propio de anestesia para {paciente} y {procedimiento}."})
    assert r.status_code == 201, r.text
    propia = r.json()
    assert propia["tipo"] == "anestesia"
    anestesias = [p for p in client.get(f"{URL}/plantillas", headers=admin, params=C).json() if p["tipo"] == "anestesia"]
    assert [p["id"] for p in anestesias] == [propia["id"]]
    assert client.post(f"{URL}/plantillas", headers=admin, json={**C, "tipo": "anestesia", "titulo": "x",
                                                                  "texto": "Otro texto de anestesia suficientemente largo"}).status_code == 409
    assert client.put(f"{URL}/plantillas/{propia['id']}", headers=admin, json={"titulo": "Anestesia general"}).json()["titulo"] == "Anestesia general"
    assert client.delete(f"{URL}/plantillas/{propia['id']}", headers=admin).status_code == 200
    assert next(p for p in client.get(f"{URL}/plantillas", headers=admin, params=C).json() if p["tipo"] == "anestesia")["propia"] is False


def test_firmar(client, admin, expediente):
    r = client.post(URL, headers={**admin, "X-Forwarded-For": "201.10.20.30, 10.0.0.1", "User-Agent": "Tablet-Recepcion"},
                    json=cuerpo(expediente))
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["folio"].startswith("CON-")
    assert c["estado"] == "vigente"
    assert c["ip_firma"] == "201.10.20.30"
    assert c["user_agent"] == "Tablet-Recepcion"
    assert len(c["huella"]) == 64
    # Marcadores llenos; los desconocidos y las llaves sueltas quedan como estaban
    nombre = expediente["paciente"]["nombre"]
    assert f"Yo, {nombre} Soto" in c["texto"]
    assert "Colecistectomía laparoscópica" in c["texto"] and "céd. 7654321" in c["texto"]
    assert c["texto"].endswith("{desconocido} {")
    assert c["firmante"] == {"tipo": "paciente", "nombre": f"{nombre} Soto", "parentesco": ""}
    assert c["medico"]["cedula_profesional"] == "7654321"
    # La API no devuelve las imágenes de las firmas
    assert "firma_paciente_base64" not in c and "firma_base64" not in c["medico"]
    assert c["testigos"] == [{"nombre": "Ana Testigo"}, {"nombre": "Luis Testigo"}]

    detalle = client.get(f"{URL}/{c['id']}", headers=admin).json()
    assert detalle["integro"] is True
    assert es_pdf(client.get(f"{URL}/{c['id']}/pdf", headers=admin))

    lista = client.get(URL, headers=admin, params={**C, "expediente_id": expediente["id"]}).json()
    assert [x["id"] for x in lista["items"]] == [c["id"]]
    assert c["id"] in {x["id"] for x in client.get(URL, headers=admin, params={**C, "q": "colecistectomía"}).json()["items"]}


def test_representante_legal(client, admin, expediente):
    r = client.post(URL, headers=admin, json=cuerpo(expediente, firmante={"tipo": "representante", "nombre": "Rosa Soto"}))
    assert r.status_code == 422          # falta parentesco
    r = client.post(URL, headers=admin, json=cuerpo(expediente, firmante={"tipo": "representante", "nombre": "Rosa Soto", "parentesco": "Madre"}))
    assert r.status_code == 201, r.text
    assert "Yo, Rosa Soto (Madre)" in r.json()["texto"]


def test_validaciones(client, admin, solo_santal, expediente):
    # Dos testigos, distintos y que no sean quien firma
    assert client.post(URL, headers=admin, json=cuerpo(expediente, testigos=[{"nombre": "Ana Testigo", "firma_base64": FIRMA}])).status_code == 422
    assert client.post(URL, headers=admin, json=cuerpo(expediente, testigos=[
        {"nombre": "Ana Testigo", "firma_base64": FIRMA}, {"nombre": "ana testigo", "firma_base64": FIRMA}])).status_code == 400
    nombre = f"{expediente['paciente']['nombre']} Soto"
    assert client.post(URL, headers=admin, json=cuerpo(expediente, testigos=[
        {"nombre": nombre, "firma_base64": FIRMA}, {"nombre": "Luis Testigo", "firma_base64": FIRMA}])).status_code == 400
    # Firmas: imagen válida y menor a 1 MB
    assert client.post(URL, headers=admin, json=cuerpo(expediente, firma_paciente_base64="data:text/html;base64,x")).status_code == 422
    grande = "data:image/png;base64," + "A" * 1_500_000
    assert client.post(URL, headers=admin, json=cuerpo(expediente, firma_paciente_base64=grande)).status_code == 422
    # El médico necesita cédula en su perfil
    exp = client.post("/api/clinica/expedientes", headers=solo_santal, json={"negocio_id": "santal", "paciente": {"nombre": unico("P")}}).json()
    r = client.post(URL, headers=solo_santal, json=cuerpo(exp))
    assert r.status_code == 400 and "cédula" in r.json()["detail"]


def test_revocar(client, admin, expediente):
    c = client.post(URL, headers=admin, json=cuerpo(expediente)).json()
    assert client.post(f"{URL}/{c['id']}/revocar", headers=admin, json={"motivo": ""}).status_code == 422
    r = client.post(f"{URL}/{c['id']}/revocar", headers=admin, json={"motivo": "El paciente decidió no operarse"})
    assert r.status_code == 200, r.text
    assert r.json()["estado"] == "revocado"
    assert r.json()["revocacion"]["motivo"] == "El paciente decidió no operarse"
    # La revocación no altera lo firmado
    assert client.get(f"{URL}/{c['id']}", headers=admin).json()["integro"] is True
    assert es_pdf(client.get(f"{URL}/{c['id']}/pdf", headers=admin))
    assert client.post(f"{URL}/{c['id']}/revocar", headers=admin, json={"motivo": "x"}).status_code == 400


def test_sin_acceso_al_negocio(client, admin, solo_santal, expediente):
    c = client.post(URL, headers=admin, json=cuerpo(expediente)).json()
    assert client.get(URL, headers=solo_santal, params=C).status_code == 403
    assert client.get(f"{URL}/plantillas", headers=solo_santal, params=C).status_code == 403
    assert client.get(f"{URL}/{c['id']}", headers=solo_santal).status_code == 403
    assert client.get(f"{URL}/{c['id']}/pdf", headers=solo_santal).status_code == 403
    assert client.post(f"{URL}/{c['id']}/revocar", headers=solo_santal, json={"motivo": "x"}).status_code == 403
    assert client.post(URL, headers=solo_santal, json=cuerpo(expediente)).status_code == 403
    assert client.post(f"{URL}/plantillas", headers=solo_santal, json={**C, "tipo": "x", "titulo": "x",
                                                                        "texto": "Texto suficientemente largo"}).status_code == 403
