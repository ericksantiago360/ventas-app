"""Laboratorio: rangos por edad y sexo, resultados críticos, aviso al médico, muestra y vínculo al expediente."""
import pytest

from app.services.rangos_lab import calcular_flag, normalizar, rango_para

from .conftest import es_pdf, unico

L = {"negocio_id": "diagnostico_plus"}


# ── Lógica pura ───────────────────────────────────────────────────────────────

def test_calcular_flag():
    num = {"tipo": "numerico"}
    ref = {"min": 70, "max": 110, "critico_min": 40, "critico_max": 400, "fuente": "catalogo"}
    assert [calcular_flag(v, num, ref) for v in ("39", "50", "90", "200", "401", "", "abc")] == \
        ["critico", "bajo", "normal", "alto", "critico", "pendiente", "pendiente"]
    assert calcular_flag("95,5", num, ref) == "normal"            # coma decimal
    # Del catálogo sin críticos definidos: nunca crítico
    assert calcular_flag("100", num, {"min": 0.27, "max": 4.2, "fuente": "catalogo"}) == "alto"
    # De plantilla (sin críticos): la regla anterior del 30 %
    assert calcular_flag("150", num, {"min": 70, "max": 100, "fuente": "plantilla"}) == "critico"
    assert calcular_flag("120", num, {"min": 70, "max": 100, "fuente": "plantilla"}) == "alto"
    assert calcular_flag("x", {"tipo": "cualitativo"}, None) == "normal"


def test_rango_por_edad_y_sexo():
    p = {"rangos": [
        {"sexo": "ambos", "edad_min": 0, "edad_max": 17, "min": 11, "max": 15},
        {"sexo": "masculino", "edad_min": 18, "edad_max": 999, "min": 13.5, "max": 17.5},
        {"sexo": "ambos", "edad_min": 18, "edad_max": 999, "min": 12, "max": 16},
    ]}
    assert rango_para(p, 10, "femenino")["min"] == 11
    assert rango_para(p, 40, "masculino")["min"] == 13.5        # su sexo gana sobre "ambos"
    assert rango_para(p, 40, "femenino")["min"] == 12
    assert normalizar("  Ácido   Úrico ") == "acido urico"


# ── API ───────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def parametro(client, admin):
    """Parámetro propio con nombre único, para no chocar con el seed ni con otras pruebas."""
    nombre = unico("Analito")
    r = client.post("/api/lab/rangos", headers=admin, json={
        **L, "parametro": nombre, "unidad": "mg/dL", "aliases": [f"{nombre} sérico"],
        "rangos": [
            {"sexo": "ambos", "edad_min": 0, "edad_max": 17, "min": 60, "max": 90, "critico_min": 30, "critico_max": 300},
            {"sexo": "femenino", "edad_min": 18, "edad_max": 999, "min": 70, "max": 110, "critico_min": 40, "critico_max": 400},
            {"sexo": "masculino", "edad_min": 18, "edad_max": 999, "min": 75, "max": 115, "critico_min": 40, "critico_max": 400},
        ],
    })
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture(scope="module")
def plantilla(client, admin, parametro):
    r = client.post("/api/lab/plantillas", headers=admin, json={
        **L, "codigo": unico("RC"), "nombre": "Perfil RC", "categoria": "QA", "precio": 100,
        "analitos": [
            # Coincide con el catálogo por alias (sin importar mayúsculas ni acentos)
            {"nombre": f"{parametro['parametro'].upper()} SERICO", "unidad": "mg/dL",
             "referencia_hombre_min": 1, "referencia_hombre_max": 2, "referencia_mujer_min": 1, "referencia_mujer_max": 2},
            # Sin parámetro en el catálogo: usa el rango de la plantilla
            {"nombre": unico("Otro"), "unidad": "U/L",
             "referencia_hombre_min": 10, "referencia_hombre_max": 40, "referencia_mujer_min": 10, "referencia_mujer_max": 35},
            {"nombre": "Aspecto", "tipo": "cualitativo", "referencia_texto": "Claro"},
        ],
    })
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def expediente(client, admin):
    r = client.post("/api/clinica/expedientes", headers=admin, json={
        **L, "paciente": {"nombre": unico("Lucía"), "apellido_paterno": "Ríos", "sexo": "femenino", "fecha_nacimiento": "1980-01-15"},
    })
    assert r.status_code == 201, r.text
    return r.json()


def nueva_orden(client, admin, plantilla, **extra):
    r = client.post("/api/lab/ordenes", headers=admin, json={
        **L, "fecha": "2026-10-18", "estudios": [{"plantilla_id": plantilla["id"]}], **extra,
    })
    assert r.status_code == 201, r.text
    detalle = client.get(f"/api/lab/ordenes/{r.json()['id']}", headers=admin).json()
    return detalle


def capturar(client, admin, resultado, valores: dict):
    analitos = [{"nombre": a["nombre"], "valor": valores.get(i, ""), "referencia_hombre_min": 0, "referencia_hombre_max": 99999}
                for i, a in enumerate(resultado["analitos"])]
    r = client.put(f"/api/lab/resultados/{resultado['id']}", headers=admin, json={"analitos": analitos})
    assert r.status_code == 200, r.text
    return r.json()


def test_orden_desde_expediente_con_rango_por_edad_y_sexo(client, admin, plantilla, expediente):
    medico = client.get("/api/clinica/medicos", headers=admin, params=L).json()[0]
    orden = nueva_orden(client, admin, plantilla, expediente_id=expediente["id"], urgente=True, medico_solicitante_id=medico["id"])
    assert orden["paciente_id"] == expediente["paciente_id"]
    assert orden["expediente_folio"] == expediente["folio"]
    assert orden["urgente"] is True
    assert orden["medico_solicitante"] == medico["nombre"]

    analitos = orden["resultados"][0]["analitos"]
    # Mujer de 46 años: rango femenino adulto del catálogo, no el de la plantilla
    assert analitos[0]["referencia_aplicada"] == {"min": 70, "max": 110, "critico_min": 40, "critico_max": 400,
                                                  "fuente": "catalogo", "parametro": analitos[0]["referencia_aplicada"]["parametro"]}
    assert analitos[1]["referencia_aplicada"]["fuente"] == "plantilla"
    assert analitos[1]["referencia_aplicada"]["max"] == 35
    assert analitos[2]["referencia_aplicada"] is None


def test_paciente_sin_expediente_se_liga_si_tiene(client, admin, plantilla, expediente):
    # Llega solo con paciente_id (como laboratorio): se liga a su expediente
    orden = nueva_orden(client, admin, plantilla, paciente_id=expediente["paciente_id"])
    assert orden["expediente_id"] == expediente["id"]

    otro = client.post("/api/clinica/expedientes", headers=admin, json={**L, "paciente": {"nombre": unico("Otro")}}).json()
    r = client.post("/api/lab/ordenes", headers=admin, json={
        **L, "fecha": "2026-10-18", "estudios": [{"plantilla_id": plantilla["id"]}],
        "expediente_id": otro["id"], "paciente_id": expediente["paciente_id"],
    })
    assert r.status_code == 400
    assert client.post("/api/lab/ordenes", headers=admin, json={
        **L, "fecha": "2026-10-18", "estudios": [{"plantilla_id": plantilla["id"]}],
    }).status_code == 400


def test_critico_y_aviso_al_medico(client, admin, plantilla, expediente):
    orden = nueva_orden(client, admin, plantilla, expediente_id=expediente["id"])
    res = orden["resultados"][0]

    # El navegador manda otros rangos: se ignoran
    guardado = capturar(client, admin, res, {0: "35", 1: "20", 2: "Turbio"})
    assert [a["flag"] for a in guardado["analitos"]] == ["critico", "normal", "normal"]
    assert guardado["analitos"][0]["referencia_aplicada"]["min"] == 70

    o = client.get(f"/api/lab/ordenes/{orden['id']}", headers=admin).json()
    assert o["resultados_criticos"] is True and o["notificado_medico"] is False
    assert o["criticos"][0]["valor"] == "35"

    # Aparece en pendientes, en el resumen del día y en el expediente
    pendientes = client.get("/api/lab/ordenes", headers=admin, params={**L, "criticos": True}).json()
    assert orden["id"] in {x["id"] for x in pendientes}
    dash = client.get("/api/lab/dashboard", headers=admin, params=L).json()
    assert orden["id"] in {x["id"] for x in dash["criticos_sin_notificar"]}
    assert client.get(f"/api/clinica/expedientes/{expediente['id']}", headers=admin).json()["lab_criticos_pendientes"] == 1

    assert client.post(f"/api/lab/ordenes/{orden['id']}/notificar", headers=admin, json={"notificado_a": ""}).status_code == 422
    r = client.post(f"/api/lab/ordenes/{orden['id']}/notificar", headers=admin,
                    json={"notificado_a": "Dra. López", "medio": "telefono", "nota": "Recibido"})
    assert r.status_code == 200, r.text
    assert r.json()["notificado_medico"] is True
    assert r.json()["notificaciones"][0]["notificado_a"] == "Dra. López"
    assert client.get(f"/api/clinica/expedientes/{expediente['id']}", headers=admin).json()["lab_criticos_pendientes"] == 0

    # Un crítico nuevo vuelve a pedir aviso
    capturar(client, admin, res, {0: "500", 1: "20"})
    assert client.get(f"/api/lab/ordenes/{orden['id']}", headers=admin).json()["notificado_medico"] is False
    # Corregido a normal: deja de ser crítica
    capturar(client, admin, res, {0: "90", 1: "20"})
    o = client.get(f"/api/lab/ordenes/{orden['id']}", headers=admin).json()
    assert o["resultados_criticos"] is False
    assert client.post(f"/api/lab/ordenes/{orden['id']}/notificar", headers=admin,
                       json={"notificado_a": "x"}).status_code == 400


def test_muestra_y_pdf(client, admin, plantilla, expediente):
    orden = nueva_orden(client, admin, plantilla, expediente_id=expediente["id"], urgente=True)
    r = client.put(f"/api/lab/ordenes/{orden['id']}/muestra", headers=admin,
                   json={"tipo": "sangre", "fecha_toma": "2026-10-18T08:15:00Z"})
    assert r.status_code == 200, r.text
    assert r.json()["muestra"]["tecnico_nombre"]
    assert client.put(f"/api/lab/ordenes/{orden['id']}/muestra", headers=admin, json={"tipo": "saliva"}).status_code == 422
    assert client.put(f"/api/lab/ordenes/{orden['id']}/muestra", headers=admin,
                      json={"tecnico_id": "000000000000000000000000"}).status_code == 404

    res = orden["resultados"][0]
    capturar(client, admin, res, {0: "35", 1: "50", 2: "Claro"})
    assert es_pdf(client.get(f"/api/lab/ordenes/{orden['id']}/pdf", headers=admin))
    client.patch(f"/api/lab/resultados/{res['id']}/validar", headers=admin)
    assert es_pdf(client.get(f"/api/lab/ordenes/{orden['id']}/pdf", headers=admin))


def test_crud_y_seed_de_rangos(client, admin, parametro):
    lista = client.get("/api/lab/rangos", headers=admin, params=L).json()
    assert parametro["id"] in {p["id"] for p in lista}

    # Un nombre o alias no puede repetirse entre parámetros
    r = client.post("/api/lab/rangos", headers=admin, json={
        **L, "parametro": f"{parametro['parametro'].lower()} sérico", "rangos": [{"min": 1, "max": 2}],
    })
    assert r.status_code == 409
    # Rangos incoherentes
    assert client.post("/api/lab/rangos", headers=admin, json={
        **L, "parametro": unico("X"), "rangos": [{"min": 10, "max": 5}],
    }).status_code == 422
    assert client.post("/api/lab/rangos", headers=admin, json={
        **L, "parametro": unico("X"), "rangos": [{"min": 10, "max": 20, "critico_min": 15}],
    }).status_code == 422

    r = client.put(f"/api/lab/rangos/{parametro['id']}", headers=admin, json={"unidad": "mg/dL", "aliases": [f"{parametro['parametro']} sérico"]})
    assert r.status_code == 200

    r = client.post("/api/lab/rangos/seed", headers=admin, params=L)
    assert r.status_code == 201 and r.json()["creados"] > 0
    assert client.post("/api/lab/rangos/seed", headers=admin, params=L).json()["creados"] == 0
    assert "Glucosa" in {p["parametro"] for p in client.get("/api/lab/rangos", headers=admin, params=L).json()}

    temporal = client.post("/api/lab/rangos", headers=admin, json={**L, "parametro": unico("Temp"), "rangos": [{"min": 1, "max": 2}]}).json()
    assert client.delete(f"/api/lab/rangos/{temporal['id']}", headers=admin).status_code == 200
    assert temporal["id"] not in {p["id"] for p in client.get("/api/lab/rangos", headers=admin, params=L).json()}


def test_sin_acceso_al_negocio(client, admin, solo_santal, plantilla, parametro):
    orden = nueva_orden(client, admin, plantilla, paciente_id=client.post("/api/pacientes/pacientes", headers=admin,
                        json={**L, "nombre": unico("P")}).json()["id"])
    assert client.get("/api/lab/rangos", headers=solo_santal, params=L).status_code == 403
    assert client.put(f"/api/lab/rangos/{parametro['id']}", headers=solo_santal, json={"unidad": "x"}).status_code == 403
    assert client.delete(f"/api/lab/rangos/{parametro['id']}", headers=solo_santal).status_code == 403
    assert client.post("/api/lab/rangos/seed", headers=solo_santal, params=L).status_code == 403
    assert client.post(f"/api/lab/ordenes/{orden['id']}/notificar", headers=solo_santal, json={"notificado_a": "x"}).status_code == 403
    assert client.put(f"/api/lab/ordenes/{orden['id']}/muestra", headers=solo_santal, json={}).status_code == 403
