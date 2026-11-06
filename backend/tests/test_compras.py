"""Compras: proveedores, órdenes de compra, recepciones que alimentan el inventario."""
import pytest

from .conftest import id_de, unico

NEG = "santal"
URL = "/api/compras"


@pytest.fixture
def proveedor(client, admin):
    r = client.post(f"{URL}/proveedores", headers=admin, json={
        "negocio_id": NEG, "nombre": unico("Proveedor"), "dias_credito": 15,
    })
    assert r.status_code == 201, r.text
    return id_de(r.json())


@pytest.fixture
def insumo(client, admin):
    r = client.post("/api/inventario/stock", headers=admin, json={
        "negocio_id": NEG, "nombre": unico("Insumo"), "unidad": "pza", "stock_inicial": 0,
    })
    assert r.status_code == 201, r.text
    return r.json()


def orden_nueva(client, admin, proveedor, insumos, impuestos=0):
    items = [{"inventario_id": i["id"], "cantidad": c, "costo_unitario": costo} for i, c, costo in insumos]
    r = client.post(f"{URL}/ordenes", headers=admin, json={
        "negocio_id": NEG, "proveedor_id": proveedor, "items": items, "impuestos": impuestos,
    })
    assert r.status_code == 201, r.text
    return r.json()


def stock_de(client, admin, insumo_id) -> float:
    r = client.get("/api/inventario/stock", headers=admin, params={"negocio_id": NEG})
    return next(i["stock_actual"] for i in r.json() if i["id"] == insumo_id)


def recibir(client, admin, orden_id, lineas):
    return client.post(f"{URL}/ordenes/{orden_id}/recepcion", headers=admin, json={
        "items": [{"inventario_id": i, "cantidad": c} for i, c in lineas],
    })


# ── Proveedores ───────────────────────────────────────────────────────────────

def test_proveedores_alta_edicion_y_baja(client, admin):
    r = client.post(f"{URL}/proveedores", headers=admin, json={"negocio_id": NEG, "nombre": "  Distribuidora X  "})
    assert r.status_code == 201, r.text
    prov = r.json()
    assert prov["nombre"] == "Distribuidora X" and prov["activo"] is True

    r = client.put(f"{URL}/proveedores/{prov['id']}", headers=admin, json={"telefono": "5550199"})
    assert r.status_code == 200 and r.json()["telefono"] == "5550199"

    assert client.delete(f"{URL}/proveedores/{prov['id']}", headers=admin).status_code == 200
    ids = [p["id"] for p in client.get(f"{URL}/proveedores", headers=admin, params={"negocio_id": NEG}).json()]
    assert prov["id"] not in ids


def test_proveedor_dado_de_baja_no_entra_a_ordenes(client, admin, insumo):
    prov = id_de(client.post(f"{URL}/proveedores", headers=admin, json={"negocio_id": NEG, "nombre": unico("P")}).json())
    client.delete(f"{URL}/proveedores/{prov}", headers=admin)
    r = client.post(f"{URL}/ordenes", headers=admin, json={
        "negocio_id": NEG, "proveedor_id": prov, "items": [{"inventario_id": insumo["id"], "cantidad": 1}],
    })
    assert r.status_code == 422, r.text


# ── Órdenes ───────────────────────────────────────────────────────────────────

def test_orden_calcula_importes_y_folio_consecutivo(client, admin, proveedor, insumo):
    otro = client.post("/api/inventario/stock", headers=admin, json={
        "negocio_id": NEG, "nombre": unico("Otro"), "stock_inicial": 0,
    }).json()

    a = orden_nueva(client, admin, proveedor, [(insumo, 4, 25.5), (otro, 2, 10)], impuestos=12)
    assert a["estado"] == "borrador"
    assert a["subtotal"] == 122.0 and a["total"] == 134.0
    assert a["items"][0]["importe"] == 102.0 and a["items"][0]["cantidad_recibida"] == 0
    assert a["proveedor_nombre"] and a["numero"].startswith("OC-")

    b = orden_nueva(client, admin, proveedor, [(insumo, 1, 5)])
    assert int(b["numero"].split("-")[1]) == int(a["numero"].split("-")[1]) + 1


def test_orden_rechaza_producto_repetido_y_de_otro_negocio(client, admin, proveedor, insumo):
    r = client.post(f"{URL}/ordenes", headers=admin, json={
        "negocio_id": NEG, "proveedor_id": proveedor,
        "items": [{"inventario_id": insumo["id"], "cantidad": 1}, {"inventario_id": insumo["id"], "cantidad": 2}],
    })
    assert r.status_code == 400

    ajeno = client.post("/api/inventario/stock", headers=admin, json={
        "negocio_id": "diagnostico_plus", "nombre": unico("Ajeno"), "stock_inicial": 0,
    }).json()
    r = client.post(f"{URL}/ordenes", headers=admin, json={
        "negocio_id": NEG, "proveedor_id": proveedor, "items": [{"inventario_id": ajeno["id"], "cantidad": 1}],
    })
    assert r.status_code == 404


def test_editar_solo_en_borrador(client, admin, proveedor, insumo):
    orden = orden_nueva(client, admin, proveedor, [(insumo, 3, 10)])
    r = client.put(f"{URL}/ordenes/{orden['id']}", headers=admin, json={"impuestos": 5})
    assert r.status_code == 200 and r.json()["total"] == 35.0

    assert client.post(f"{URL}/ordenes/{orden['id']}/enviar", headers=admin).json()["estado"] == "enviada"
    r = client.put(f"{URL}/ordenes/{orden['id']}", headers=admin, json={"impuestos": 0})
    assert r.status_code == 400


def test_transiciones_invalidas(client, admin, proveedor, insumo):
    orden = orden_nueva(client, admin, proveedor, [(insumo, 1, 1)])
    # Sin enviar no se puede recibir
    assert recibir(client, admin, orden["id"], [(insumo["id"], 1)]).status_code == 400

    assert client.post(f"{URL}/ordenes/{orden['id']}/enviar", headers=admin).status_code == 200
    assert client.post(f"{URL}/ordenes/{orden['id']}/enviar", headers=admin).status_code == 400

    # Enviada sin recepciones sí se cancela; cancelada es final
    r = client.post(f"{URL}/ordenes/{orden['id']}/cancelar", headers=admin, json={"motivo": "Ya no se necesita"})
    assert r.status_code == 200 and r.json()["estado"] == "cancelada"
    assert client.post(f"{URL}/ordenes/{orden['id']}/enviar", headers=admin).status_code == 400
    assert client.post(f"{URL}/ordenes/{orden['id']}/cancelar", headers=admin, json={"motivo": "Otra vez"}).status_code == 400


# ── Recepciones ───────────────────────────────────────────────────────────────

def test_recepcion_parcial_y_total_actualizan_inventario(client, admin, proveedor, insumo):
    base = stock_de(client, admin, insumo["id"])
    orden = orden_nueva(client, admin, proveedor, [(insumo, 10, 7.5)])
    client.post(f"{URL}/ordenes/{orden['id']}/enviar", headers=admin)

    r = recibir(client, admin, orden["id"], [(insumo["id"], 4)])
    assert r.status_code == 200, r.text
    assert r.json()["estado"] == "recibida_parcial"
    assert r.json()["items"][0]["cantidad_recibida"] == 4
    assert stock_de(client, admin, insumo["id"]) == base + 4

    r = recibir(client, admin, orden["id"], [(insumo["id"], 6)])
    assert r.json()["estado"] == "recibida"
    assert stock_de(client, admin, insumo["id"]) == base + 10

    producto = next(i for i in client.get("/api/inventario/stock", headers=admin, params={"negocio_id": NEG}).json()
                    if i["id"] == insumo["id"])
    assert producto["costo_unitario"] == 7.5

    movs = client.get("/api/inventario/movimientos", headers=admin,
                      params={"negocio_id": NEG, "inventario_id": insumo["id"]}).json()
    recepciones = [m for m in movs if m["referencia"] == orden["numero"]]
    assert sorted(m["cantidad"] for m in recepciones) == [4, 6]
    assert all(m["tipo"] == "entrada" for m in recepciones)


def test_recepcion_que_excede_pendiente_no_escribe_nada(client, admin, proveedor, insumo):
    base = stock_de(client, admin, insumo["id"])
    orden = orden_nueva(client, admin, proveedor, [(insumo, 5, 1)])
    client.post(f"{URL}/ordenes/{orden['id']}/enviar", headers=admin)

    r = recibir(client, admin, orden["id"], [(insumo["id"], 6)])
    assert r.status_code == 422
    assert stock_de(client, admin, insumo["id"]) == base
    assert client.get(f"{URL}/ordenes/{orden['id']}", headers=admin).json()["estado"] == "enviada"


def test_recepcion_con_producto_ajeno_a_la_orden(client, admin, proveedor, insumo):
    otro = client.post("/api/inventario/stock", headers=admin, json={
        "negocio_id": NEG, "nombre": unico("Ajeno"), "stock_inicial": 0,
    }).json()
    orden = orden_nueva(client, admin, proveedor, [(insumo, 2, 1)])
    client.post(f"{URL}/ordenes/{orden['id']}/enviar", headers=admin)
    assert recibir(client, admin, orden["id"], [(otro["id"], 1)]).status_code == 400


def test_cancelar_bloqueado_con_recepciones(client, admin, proveedor, insumo):
    orden = orden_nueva(client, admin, proveedor, [(insumo, 3, 1)])
    client.post(f"{URL}/ordenes/{orden['id']}/enviar", headers=admin)
    recibir(client, admin, orden["id"], [(insumo["id"], 1)])

    r = client.post(f"{URL}/ordenes/{orden['id']}/cancelar", headers=admin, json={"motivo": "Cambio de planes"})
    assert r.status_code == 400


def test_recepcion_total_deja_la_orden_recibida_y_no_admite_mas(client, admin, proveedor, insumo):
    orden = orden_nueva(client, admin, proveedor, [(insumo, 2, 1)])
    client.post(f"{URL}/ordenes/{orden['id']}/enviar", headers=admin)
    assert recibir(client, admin, orden["id"], [(insumo["id"], 2)]).json()["estado"] == "recibida"
    assert recibir(client, admin, orden["id"], [(insumo["id"], 1)]).status_code == 400


# ── Acceso ────────────────────────────────────────────────────────────────────

def test_usuario_sin_el_negocio_recibe_403(client, admin, solo_santal, proveedor, insumo):
    r = client.get(f"{URL}/proveedores", headers=solo_santal, params={"negocio_id": "diagnostico_plus"})
    assert r.status_code == 403

    orden = orden_nueva(client, admin, proveedor, [(insumo, 1, 1)])
    assert client.get(f"{URL}/ordenes/{orden['id']}", headers=solo_santal).status_code == 200

    r = client.post(f"{URL}/ordenes", headers=solo_santal, json={
        "negocio_id": "diagnostico_plus", "proveedor_id": proveedor, "items": [{"inventario_id": insumo["id"], "cantidad": 1}],
    })
    assert r.status_code == 403


# ── Egreso en Finanzas ────────────────────────────────────────────────────────

def egresos_de(client, admin, orden_id) -> list[dict]:
    movimientos = client.get("/api/finanzas/movimientos", headers=admin,
                             params={"negocio_id": NEG, "tipo": "egreso", "limit": 500}).json()
    return [m for m in movimientos if m.get("referencia_id") == orden_id]


def test_recepcion_total_genera_un_egreso_pendiente_y_la_parcial_no(client, admin, proveedor, insumo):
    orden = orden_nueva(client, admin, proveedor, [(insumo, 4, 25)], impuestos=10)   # subtotal 100 + 10
    oid = orden["id"]
    assert client.post(f"{URL}/ordenes/{oid}/enviar", headers=admin).status_code == 200

    # Recepción parcial: no genera egreso
    assert recibir(client, admin, oid, [(insumo["id"], 2)]).status_code == 200
    assert egresos_de(client, admin, oid) == []
    assert client.get(f"{URL}/ordenes/{oid}", headers=admin).json()["egreso"] is None

    # Recepción que completa la orden: un solo egreso por el total, sin cuenta, pendiente de pago
    r = recibir(client, admin, oid, [(insumo["id"], 2)])
    assert r.status_code == 200 and r.json()["estado"] == "recibida"
    egresos = egresos_de(client, admin, oid)
    assert len(egresos) == 1
    e = egresos[0]
    assert e["importe"] == 110.0
    assert e["estado"] == "pendiente" and e["cuenta_id"] is None
    assert e["tipo"] == "egreso" and e["categoria"] == "compra_proveedor"
    assert e["referencia_tipo"] == "ordenes_compra" and e["negocio_id"] == NEG
    assert e["concepto"].startswith(f"OC {orden['numero']}")

    detalle = client.get(f"{URL}/ordenes/{oid}", headers=admin).json()
    assert detalle["egreso"] == {"id": e["id"], "estado": "pendiente"}


def test_orden_recibida_no_duplica_el_egreso(client, admin, proveedor, insumo):
    orden = orden_nueva(client, admin, proveedor, [(insumo, 2, 50)])
    oid = orden["id"]
    assert client.post(f"{URL}/ordenes/{oid}/enviar", headers=admin).status_code == 200
    assert recibir(client, admin, oid, [(insumo["id"], 2)]).status_code == 200
    # Una segunda recepción sobre una orden ya recibida se rechaza y no crea nada
    assert recibir(client, admin, oid, [(insumo["id"], 1)]).status_code == 400
    assert len(egresos_de(client, admin, oid)) == 1
