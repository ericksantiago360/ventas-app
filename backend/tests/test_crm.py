from .conftest import datos, id_de, unico


def test_cliente_crud(client, admin, cliente_santal):
    r = client.get(f"/api/crm/clientes/{cliente_santal}", headers=admin)
    assert r.status_code == 200

    r = client.put(f"/api/crm/clientes/{cliente_santal}", headers=admin, json={"empresa": "Renombrado"})
    assert r.status_code == 200
    assert datos(client.get(f"/api/crm/clientes/{cliente_santal}", headers=admin).json())["empresa"] == "Renombrado"


def test_cliente_sin_empresa_422(client, admin):
    r = client.post("/api/crm/clientes", headers=admin, json={"telefono": "5550600", "canal_origen": "directo"})
    assert r.status_code == 422


def test_editar_no_agrega_negocio(client, admin, cliente_santal):
    # Cliente unificado (SPEC §9): el documento no tiene negocio_id, ni al editarlo
    client.put(f"/api/crm/clientes/{cliente_santal}", headers=admin,
               json={"negocio_id": "dulce_tentacion", "empresa": "X"})
    doc = datos(client.get(f"/api/crm/clientes/{cliente_santal}", headers=admin).json())
    assert "negocio_id" not in doc


def test_cliente_inexistente_404(client, admin):
    r = client.get("/api/crm/clientes/000000000000000000000000", headers=admin)
    assert r.status_code == 404


def test_cliente_id_invalido_400(client, admin):
    assert client.get("/api/crm/clientes/no-es-id", headers=admin).status_code == 400


def test_oportunidad_flujo(client, admin):
    cliente = id_de(client.post("/api/crm/clientes", headers=admin, json={
        "empresa": unico("Empresa"), "telefono": "5550199", "canal_origen": "directo",
    }).json())
    r = client.post("/api/crm/oportunidades", headers=admin,
                    json={"cliente_id": cliente, "negocio_id": "santal", "etapa": "Prospecto"})
    assert r.status_code == 201, r.text
    op = id_de(r.json())

    assert client.put(f"/api/crm/oportunidades/{op}/etapa", headers=admin,
                      json={"etapa": "Negociación"}).status_code == 200
    assert client.put(f"/api/crm/oportunidades/{op}/etapa", headers=admin,
                      json={"etapa": "inventada"}).status_code == 400
    assert client.delete(f"/api/crm/oportunidades/{op}", headers=admin).status_code == 200
