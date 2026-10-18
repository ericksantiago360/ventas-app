"""Clínica: inventario de farmacia por lotes, salidas FEFO, mermas, alertas y caducidades."""
from datetime import date, timedelta

import pytest

from .conftest import unico

C = {"negocio_id": "diagnostico_plus"}
URL = "/api/clinica/farmacia"


def en(dias: int) -> str:
    return (date.today() + timedelta(days=dias)).isoformat()


@pytest.fixture
def articulo(client, admin):
    r = client.post(URL, headers=admin, json={
        **C, "nombre": unico("Amoxicilina"), "principio_activo": "amoxicilina", "presentacion": "caja 12 cápsulas 500 mg",
        "stock_minimo": 5, "precio_compra": 40, "precio_venta": 85, "ubicacion": "Estante A-3",
    })
    assert r.status_code == 201, r.text
    return r.json()


def entrada(client, admin, articulo, lote, dias, cantidad, **extra):
    return client.post(f"{URL}/{articulo['id']}/entrada", headers=admin, json={
        "numero_lote": lote, "fecha_caducidad": en(dias), "cantidad": cantidad, **extra,
    })


def salida(client, admin, articulo, cantidad, merma=False, **extra):
    return client.post(f"{URL}/{articulo['id']}/salida", headers=admin, params={"merma": merma},
                       json={"cantidad": cantidad, **extra})


def test_alta_y_entradas(client, admin, articulo):
    assert articulo["stock"] == 0 and articulo["stock_bajo"] is True

    r = entrada(client, admin, articulo, "L-200", 200, 10, proveedor="Distribuidora", precio_compra=42)
    assert r.status_code == 201, r.text
    assert r.json()["articulo"]["stock"] == 10
    assert r.json()["articulo"]["precio_compra"] == 42
    assert r.json()["movimiento"]["tipo"] == "entrada"

    # Mismo lote suma; mismo lote con otra caducidad es un error
    assert entrada(client, admin, articulo, "L-200", 200, 5).json()["articulo"]["lotes"][0]["cantidad"] == 15
    assert entrada(client, admin, articulo, "L-200", 100, 5).status_code == 400

    a = entrada(client, admin, articulo, "L-45", 45, 3).json()["articulo"]
    assert a["stock"] == 18
    assert a["proxima_caducidad"] == en(45)
    assert [l["numero_lote"] for l in a["lotes"]] == ["L-45", "L-200"]

    assert entrada(client, admin, articulo, "L-x", 10, 0).status_code == 422


def test_salida_fefo(client, admin, articulo):
    entrada(client, admin, articulo, "LEJOS", 300, 10)
    entrada(client, admin, articulo, "CERCA", 40, 4)
    entrada(client, admin, articulo, "VENCIDO", -10, 6)

    # Primero el que caduca antes, sin tocar el caducado
    r = salida(client, admin, articulo, 6, motivo="Uso en consulta")
    assert r.status_code == 201, r.text
    assert r.json()["movimiento"]["lotes"] == [{"numero_lote": "CERCA", "cantidad": 4}, {"numero_lote": "LEJOS", "cantidad": 2}]
    a = r.json()["articulo"]
    assert {l["numero_lote"]: l["cantidad"] for l in a["lotes"]} == {"LEJOS": 8, "VENCIDO": 6}   # el vacío se quita
    assert a["stock"] == 14 and a["stock_caducado"] == 6

    # Lo vigente no alcanza; el caducado no cuenta
    r = salida(client, admin, articulo, 10)
    assert r.status_code == 400 and "8" in r.json()["detail"]
    # Un lote caducado solo sale como merma
    assert salida(client, admin, articulo, 1, numero_lote="VENCIDO").status_code == 400
    r = salida(client, admin, articulo, 6, merma=True, numero_lote="VENCIDO")
    assert r.status_code == 201
    assert r.json()["movimiento"]["motivo"] == "Merma"
    assert r.json()["articulo"]["stock"] == 8

    assert salida(client, admin, articulo, 1, numero_lote="NO-EXISTE").status_code == 404
    movs = client.get(f"{URL}/{articulo['id']}/movimientos", headers=admin).json()
    assert [m["tipo"] for m in movs][:2] == ["salida", "salida"]
    assert len(movs) == 5


def test_salida_con_receta(client, admin, articulo):
    entrada(client, admin, articulo, "L1", 100, 10)
    client.put("/api/clinica/perfil-medico", headers=admin, json={"cedula_profesional": "1234567"})
    exp = client.post("/api/clinica/expedientes", headers=admin, json={**C, "paciente": {"nombre": unico("Pac")}}).json()
    rx = client.post("/api/clinica/recetas", headers=admin, json={
        "expediente_id": exp["id"], "medicamentos": [{"nombre": "Amoxicilina"}],
    }).json()

    r = salida(client, admin, articulo, 2, receta_id=rx["id"])
    assert r.status_code == 201, r.text
    assert r.json()["movimiento"]["receta_folio"] == rx["folio"]
    assert r.json()["movimiento"]["motivo"] == f"Surtido de receta {rx['folio']}"

    assert salida(client, admin, articulo, 1, merma=True, receta_id=rx["id"]).status_code == 400
    client.post(f"/api/clinica/recetas/{rx['id']}/cancelar", headers=admin, json={"motivo": "Error"})
    assert salida(client, admin, articulo, 1, receta_id=rx["id"]).status_code == 400
    assert salida(client, admin, articulo, 1, receta_id="000000000000000000000000").status_code == 404


def test_alertas_y_caducidades(client, admin, articulo):
    entrada(client, admin, articulo, "A10", 10, 2)       # stock 2 ≤ mínimo 5 y caduca en 10 días
    entrada(client, admin, articulo, "A75", 75, 1)
    entrada(client, admin, articulo, "A-5", -5, 1)

    alertas = client.get(f"{URL}/alertas", headers=admin, params=C).json()
    assert articulo["id"] in {a["articulo_id"] for a in alertas["stock_bajo"]}
    assert ("A10", 10) in {(l["numero_lote"], l["dias"]) for l in alertas["por_caducar"] if l["articulo_id"] == articulo["id"]}
    assert "A-5" in {l["numero_lote"] for l in alertas["caducados"] if l["articulo_id"] == articulo["id"]}
    assert "A75" not in {l["numero_lote"] for l in alertas["por_caducar"]}
    assert alertas["total"] >= 3

    plazos = {l["numero_lote"]: l["plazo"] for l in client.get(f"{URL}/caducidades", headers=admin, params=C).json()
              if l["articulo_id"] == articulo["id"]}
    assert plazos == {"A-5": "caducado", "A10": "30", "A75": "90"}
    corto = client.get(f"{URL}/caducidades", headers=admin, params={**C, "dias": 30}).json()
    assert "A75" not in {l["numero_lote"] for l in corto}

    con_alerta = client.get(URL, headers=admin, params={**C, "solo_alertas": True}).json()
    assert articulo["id"] in {a["id"] for a in con_alerta}


def test_listar_editar_y_baja(client, admin, articulo):
    assert articulo["id"] in {a["id"] for a in client.get(URL, headers=admin, params={**C, "q": "amoxi 500"}).json()}
    assert articulo["id"] not in {a["id"] for a in client.get(URL, headers=admin, params={**C, "categoria": "equipo"}).json()}

    r = client.put(f"{URL}/{articulo['id']}", headers=admin, json={"stock_minimo": 0, "ubicacion": "B-1"})
    assert r.status_code == 200 and r.json()["ubicacion"] == "B-1"
    assert client.put(f"{URL}/{articulo['id']}", headers=admin, json={}).status_code == 400

    entrada(client, admin, articulo, "L", 100, 1)
    assert client.delete(f"{URL}/{articulo['id']}", headers=admin).status_code == 400   # aún tiene existencia
    salida(client, admin, articulo, 1)
    assert client.delete(f"{URL}/{articulo['id']}", headers=admin).status_code == 200
    assert articulo["id"] not in {a["id"] for a in client.get(URL, headers=admin, params=C).json()}
    assert entrada(client, admin, articulo, "L2", 100, 1).status_code == 400


def test_sin_acceso_al_negocio(client, admin, solo_santal, articulo):
    for metodo, ruta, kw in [
        ("get", URL, {"params": C}),
        ("get", f"{URL}/alertas", {"params": C}),
        ("get", f"{URL}/caducidades", {"params": C}),
        ("get", f"{URL}/{articulo['id']}", {}),
        ("put", f"{URL}/{articulo['id']}", {"json": {"ubicacion": "x"}}),
        ("delete", f"{URL}/{articulo['id']}", {}),
        ("post", f"{URL}/{articulo['id']}/entrada", {"json": {"numero_lote": "x", "fecha_caducidad": en(10), "cantidad": 1}}),
        ("post", f"{URL}/{articulo['id']}/salida", {"json": {"cantidad": 1}}),
        ("get", f"{URL}/{articulo['id']}/movimientos", {}),
        ("post", URL, {"json": {**C, "nombre": "x"}}),
    ]:
        assert getattr(client, metodo)(ruta, headers=solo_santal, **kw).status_code == 403, ruta
