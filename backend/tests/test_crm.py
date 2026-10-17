from .conftest import datos, id_de


def test_cliente_crud(client, admin, cliente_santal):
    r = client.get(f"/api/crm/clientes/{cliente_santal}", headers=admin)
    assert r.status_code == 200

    r = client.put(f"/api/crm/clientes/{cliente_santal}", headers=admin, json={"nombre": "Renombrado"})
    assert r.status_code == 200
    assert datos(client.get(f"/api/crm/clientes/{cliente_santal}", headers=admin).json())["nombre"] == "Renombrado"


def test_cliente_sin_nombre_400(client, admin):
    r = client.post("/api/crm/clientes", headers=admin, json={"negocio_id": "santal"})
    assert r.status_code == 400


def test_editar_no_cambia_negocio(client, admin, cliente_santal):
    client.put(f"/api/crm/clientes/{cliente_santal}", headers=admin,
               json={"negocio_id": "dulce_tentacion", "nombre": "X"})
    doc = datos(client.get(f"/api/crm/clientes/{cliente_santal}", headers=admin).json())
    assert doc["negocio_id"] == "santal"


def test_cliente_inexistente_404(client, admin):
    r = client.get("/api/crm/clientes/000000000000000000000000", headers=admin)
    assert r.status_code == 404


def test_cliente_id_invalido_400(client, admin):
    assert client.get("/api/crm/clientes/no-es-id", headers=admin).status_code == 400


def test_lead_flujo(client, admin):
    r = client.post("/api/crm/leads", headers=admin, json={"negocio_id": "santal", "nombre": "Lead"})
    assert r.status_code == 201
    lead = id_de(r.json())

    assert client.patch(f"/api/crm/leads/{lead}/etapa", headers=admin,
                        json={"etapa": "contactado"}).status_code == 200
    assert client.patch(f"/api/crm/leads/{lead}/etapa", headers=admin,
                        json={"etapa": "inventada"}).status_code == 400
    assert client.delete(f"/api/crm/leads/{lead}", headers=admin).status_code == 200
