"""CRM leads: pipeline propio, tablero, movimiento de etapa, conversión a cliente y oportunidad, descarte."""
import pytest

from .conftest import id_de, unico

NEG = "santal"
URL = "/api/crm/leads"


@pytest.fixture
def lead(client, admin):
    r = client.post(URL, headers=admin, json={
        "negocio_id": NEG, "empresa": unico("Lead"), "contacto": "Ana", "telefono": "5550177", "canal_origen": "whatsapp",
    })
    assert r.status_code == 201, r.text
    return r.json()


def columnas(client, admin, negocio=NEG):
    return {c["etapa"]: c["leads"] for c in client.get(f"{URL}/kanban/{negocio}", headers=admin).json()["data"]}


def ids_en_tablero(client, admin, negocio=NEG):
    return [l["_id"] for etapa in columnas(client, admin, negocio).values() for l in etapa]


def test_lead_nuevo_aparece_en_la_primera_etapa(client, admin, lead):
    assert lead["etapa"] == "Nuevo" and lead["activo"] is True
    assert [l["_id"] for l in columnas(client, admin)["Nuevo"]].count(lead["_id"]) == 1


def test_mover_etapa_y_validaciones(client, admin, lead):
    r = client.put(f"{URL}/{lead['_id']}/etapa", headers=admin, json={"etapa": "Contactado"})
    assert r.status_code == 200 and r.json()["etapa"] == "Contactado"
    assert lead["_id"] in [l["_id"] for l in columnas(client, admin)["Contactado"]]

    assert client.put(f"{URL}/{lead['_id']}/etapa", headers=admin, json={"etapa": "Contactado"}).status_code == 400
    assert client.put(f"{URL}/{lead['_id']}/etapa", headers=admin, json={"etapa": "Inventada"}).status_code == 400


def test_convertir_crea_cliente_y_oportunidad(client, admin, lead):
    r = client.post(f"{URL}/{lead['_id']}/convertir", headers=admin, json={"valor_estimado": 9000})
    assert r.status_code == 201, r.text
    datos = r.json()

    assert datos["lead"]["activo"] is False
    assert datos["lead"]["oportunidad_id"] == datos["oportunidad"]["_id"]
    assert datos["oportunidad"]["etapa"] == "Prospecto"        # primera etapa del pipeline de oportunidades
    assert datos["oportunidad"]["cliente_id"] == datos["cliente"]["_id"]
    assert datos["cliente"]["empresa"] == lead["empresa"]
    assert datos["oportunidad"]["valor_estimado"] == 9000.0

    assert lead["_id"] not in ids_en_tablero(client, admin)
    assert client.post(f"{URL}/{lead['_id']}/convertir", headers=admin, json={}).status_code == 400


def test_convertir_reutiliza_cliente_existente(client, admin):
    empresa = unico("Existente")
    cliente = client.post("/api/crm/clientes", headers=admin, json={
        "empresa": empresa, "telefono": "5550166", "canal_origen": "directo",
    })
    cliente_id = id_de(cliente.json())

    lead = client.post(URL, headers=admin, json={
        "negocio_id": NEG, "empresa": empresa, "telefono": "5550166",
    }).json()
    datos = client.post(f"{URL}/{lead['_id']}/convertir", headers=admin, json={}).json()
    assert datos["cliente"]["_id"] == cliente_id


def test_bienes_raices_exige_tipo_lead_y_no_escribe_nada(client, admin):
    lead = client.post(URL, headers=admin, json={
        "negocio_id": "bienes_raices", "empresa": unico("Casa"), "telefono": "5550155",
    }).json()

    r = client.post(f"{URL}/{lead['_id']}/convertir", headers=admin, json={})
    assert r.status_code == 400
    assert lead["_id"] in ids_en_tablero(client, admin, "bienes_raices")

    r = client.post(f"{URL}/{lead['_id']}/convertir", headers=admin, json={"tipo_lead": "comprador"})
    assert r.status_code == 201, r.text
    assert r.json()["oportunidad"]["tipo_lead"] == "comprador"


def test_descartar_con_motivo(client, admin, lead):
    assert client.post(f"{URL}/{lead['_id']}/descartar", headers=admin, json={"motivo": ""}).status_code == 422

    r = client.post(f"{URL}/{lead['_id']}/descartar", headers=admin, json={"motivo": "No responde"})
    assert r.status_code == 200
    assert r.json()["activo"] is False and r.json()["motivo_descarte"] == "No responde"
    assert lead["_id"] not in ids_en_tablero(client, admin)
    assert client.put(f"{URL}/{lead['_id']}", headers=admin, json={"notas": "x"}).status_code == 400


def test_editar_lead(client, admin, lead):
    r = client.put(f"{URL}/{lead['_id']}", headers=admin, json={"contacto": "Luis", "telefono": "5550111"})
    assert r.status_code == 200
    assert r.json()["contacto"] == "Luis" and r.json()["telefono"] == "5550111"
    assert client.put(f"{URL}/{lead['_id']}", headers=admin, json={}).status_code == 400


def test_usuario_sin_el_negocio_403(client, solo_santal):
    r = client.post(URL, headers=solo_santal, json={
        "negocio_id": "diagnostico_plus", "empresa": "X", "telefono": "5550100",
    })
    assert r.status_code == 403
    r = client.get(f"{URL}/kanban/diagnostico_plus", headers=solo_santal)
    assert r.status_code == 403
