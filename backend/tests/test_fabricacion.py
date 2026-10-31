"""Fabricación: almacenes, zonas y ubicaciones; stock por ubicación; órdenes que consumen de un almacén."""
import pytest

from .conftest import id_de, unico

NEG = "santal"
URL = "/api/fabricacion"


def insumo(client, admin, stock, negocio=NEG):
    r = client.post("/api/inventario/stock", headers=admin, json={
        "negocio_id": negocio, "nombre": unico("Insumo"), "unidad": "kg", "stock_inicial": stock,
    })
    assert r.status_code == 201, r.text
    return r.json()


def stock_de(client, admin, inventario_id) -> float:
    filas = client.get("/api/inventario/stock", headers=admin, params={"negocio_id": NEG}).json()
    return next(f["stock_actual"] for f in filas if f["id"] == inventario_id)


def en_ubicacion(client, admin, inventario_id, ubicacion_id) -> float:
    datos = client.get(f"{URL}/stock-ubicaciones", headers=admin, params={"negocio_id": NEG}).json()
    return sum(u["cantidad"] for u in datos["ubicaciones"]
               if u["inventario_id"] == inventario_id and u["ubicacion_id"] == ubicacion_id)


def asignar(client, admin, inventario_id, ubicacion_id, cantidad):
    r = client.post(f"{URL}/stock-ubicaciones/asignar", headers=admin, json={
        "negocio_id": NEG, "inventario_id": inventario_id, "ubicacion_id": ubicacion_id, "cantidad": cantidad,
    })
    assert r.status_code == 200, r.text


@pytest.fixture
def almacen(client, admin):
    """Almacén con zona y dos ubicaciones: una de almacenaje y otra de producto terminado."""
    a = client.post(f"{URL}/almacenes", headers=admin, json={"negocio_id": NEG, "codigo": unico("AL"), "nombre": "Almacén central"})
    assert a.status_code == 201, a.text
    almacen_id = id_de(a.json())
    z = client.post(f"{URL}/zonas", headers=admin, json={"negocio_id": NEG, "almacen_id": almacen_id, "codigo": unico("Z"), "nombre": "Zona A"})
    assert z.status_code == 201, z.text
    zona_id = id_de(z.json())
    u = client.post(f"{URL}/ubicaciones", headers=admin, json={"negocio_id": NEG, "zona_id": zona_id, "codigo": unico("U"), "nombre": "Estante 1"})
    d = client.post(f"{URL}/ubicaciones", headers=admin, json={"negocio_id": NEG, "zona_id": zona_id, "codigo": unico("P"), "nombre": "Producto terminado"})
    assert u.status_code == 201 and d.status_code == 201, (u.text, d.text)
    return {"almacen": almacen_id, "ubicacion": id_de(u.json()), "destino": id_de(d.json())}


@pytest.fixture
def fabricacion(client, admin, almacen):
    """Receta: 10 unidades por tanda con 2 kg de A y 1 kg de B. A=100 y B=50 están en el almacén."""
    a = insumo(client, admin, 100)
    b = insumo(client, admin, 50)
    final = insumo(client, admin, 0)
    asignar(client, admin, a["id"], almacen["ubicacion"], 100)
    asignar(client, admin, b["id"], almacen["ubicacion"], 50)
    r = client.post(f"{URL}/recetas", headers=admin, json={
        "negocio_id": NEG, "nombre": unico("Receta"), "producto_id": final["id"], "rendimiento": 10,
        "componentes": [{"inventario_id": a["id"], "cantidad": 2}, {"inventario_id": b["id"], "cantidad": 1}],
    })
    assert r.status_code == 201, r.text
    return {"receta": r.json(), "a": a["id"], "b": b["id"], "final": final["id"], **almacen}


def crear_orden(client, admin, datos, cantidad=30):
    r = client.post(f"{URL}/ordenes", headers=admin, json={
        "negocio_id": NEG, "receta_id": datos["receta"]["id"], "cantidad": cantidad,
        "almacen_id": datos["almacen"], "ubicacion_destino_id": datos["destino"],
    })
    assert r.status_code == 201, r.text
    return r.json()


# ── Almacenes, zonas y ubicaciones ───────────────────────────────────────────

def test_jerarquia_y_codigos_unicos(client, admin, almacen):
    r = client.post(f"{URL}/ubicaciones", headers=admin, json={"negocio_id": NEG, "zona_id": "64b000000000000000000000", "codigo": "X"})
    assert r.status_code == 404

    zona = client.get(f"{URL}/zonas", headers=admin, params={"negocio_id": NEG, "almacen_id": almacen["almacen"]}).json()[0]
    dup = client.post(f"{URL}/ubicaciones", headers=admin, json={"negocio_id": NEG, "zona_id": zona["id"], "codigo": "u-" + "x"})
    assert dup.status_code == 201
    dup2 = client.post(f"{URL}/ubicaciones", headers=admin, json={"negocio_id": NEG, "zona_id": zona["id"], "codigo": dup.json()["codigo"].lower()})
    assert dup2.status_code == 409


def test_ubicacion_hereda_el_almacen_de_su_zona(client, admin, almacen):
    ubic = client.get(f"{URL}/ubicaciones", headers=admin, params={"negocio_id": NEG, "almacen_id": almacen["almacen"]}).json()
    assert len(ubic) >= 2 and all(u["almacen_id"] == almacen["almacen"] for u in ubic)


# ── Stock por ubicación ──────────────────────────────────────────────────────

def test_asignar_solo_lo_que_no_tiene_ubicacion(client, admin, almacen):
    producto = insumo(client, admin, 10)
    asignar(client, admin, producto["id"], almacen["ubicacion"], 7)
    assert en_ubicacion(client, admin, producto["id"], almacen["ubicacion"]) == 7

    r = client.post(f"{URL}/stock-ubicaciones/asignar", headers=admin, json={
        "negocio_id": NEG, "inventario_id": producto["id"], "ubicacion_id": almacen["ubicacion"], "cantidad": 4,
    })
    assert r.status_code == 409
    assert stock_de(client, admin, producto["id"]) == 10  # el total no cambia al asignar


def test_transferir_entre_ubicaciones(client, admin, almacen):
    producto = insumo(client, admin, 10)
    asignar(client, admin, producto["id"], almacen["ubicacion"], 10)
    r = client.post(f"{URL}/stock-ubicaciones/transferir", headers=admin, json={
        "negocio_id": NEG, "inventario_id": producto["id"], "origen_id": almacen["ubicacion"],
        "destino_id": almacen["destino"], "cantidad": 4,
    })
    assert r.status_code == 200, r.text
    assert en_ubicacion(client, admin, producto["id"], almacen["ubicacion"]) == 6
    assert en_ubicacion(client, admin, producto["id"], almacen["destino"]) == 4
    assert stock_de(client, admin, producto["id"]) == 10

    too_much = client.post(f"{URL}/stock-ubicaciones/transferir", headers=admin, json={
        "negocio_id": NEG, "inventario_id": producto["id"], "origen_id": almacen["ubicacion"],
        "destino_id": almacen["destino"], "cantidad": 50,
    })
    assert too_much.status_code == 409
    mismo = client.post(f"{URL}/stock-ubicaciones/transferir", headers=admin, json={
        "negocio_id": NEG, "inventario_id": producto["id"], "origen_id": almacen["ubicacion"],
        "destino_id": almacen["ubicacion"], "cantidad": 1,
    })
    assert mismo.status_code == 422


# ── Recetas ──────────────────────────────────────────────────────────────────

def test_receta_y_validaciones(client, admin):
    a = insumo(client, admin, 1)
    final = insumo(client, admin, 0)
    ajeno = insumo(client, admin, 1, negocio="diagnostico_plus")
    base = {"negocio_id": NEG, "nombre": "R", "rendimiento": 5}

    r = client.post(f"{URL}/recetas", headers=admin, json={**base, "producto_id": final["id"],
                    "componentes": [{"inventario_id": final["id"], "cantidad": 1}]})
    assert r.status_code == 422
    r = client.post(f"{URL}/recetas", headers=admin, json={**base, "producto_id": final["id"],
                    "componentes": [{"inventario_id": ajeno["id"], "cantidad": 1}]})
    assert r.status_code == 404
    r = client.post(f"{URL}/recetas", headers=admin, json={**base, "producto_id": final["id"],
                    "componentes": [{"inventario_id": a["id"], "cantidad": 1}, {"inventario_id": a["id"], "cantidad": 2}]})
    assert r.status_code == 422


# ── Órdenes ──────────────────────────────────────────────────────────────────

def test_orden_exige_almacen_y_destino(client, admin, fabricacion):
    r = client.post(f"{URL}/ordenes", headers=admin, json={
        "negocio_id": NEG, "receta_id": fabricacion["receta"]["id"], "cantidad": 10,
        "almacen_id": "64b000000000000000000000", "ubicacion_destino_id": fabricacion["destino"],
    })
    assert r.status_code == 404
    r = client.post(f"{URL}/ordenes", headers=admin, json={
        "negocio_id": NEG, "receta_id": fabricacion["receta"]["id"], "cantidad": 10,
        "almacen_id": fabricacion["almacen"], "ubicacion_destino_id": "64b000000000000000000000",
    })
    assert r.status_code == 404


def test_orden_calcula_consumos_por_tanda_y_folio(client, admin, fabricacion):
    orden = crear_orden(client, admin, fabricacion, cantidad=30)
    assert orden["estado"] == "planeada" and orden["numero"].startswith("OF-")
    assert orden["tandas"] == 3 and orden["almacen_nombre"]
    consumos = {c["inventario_id"]: c["cantidad"] for c in orden["consumos"]}
    assert consumos[fabricacion["a"]] == 6 and consumos[fabricacion["b"]] == 3

    siguiente = crear_orden(client, admin, fabricacion, cantidad=10)
    assert int(siguiente["numero"].split("-")[1]) == int(orden["numero"].split("-")[1]) + 1


def test_terminar_consume_del_almacen_y_produce_en_destino(client, admin, fabricacion):
    orden = crear_orden(client, admin, fabricacion, cantidad=30)
    r = client.post(f"{URL}/ordenes/{orden['id']}/terminar", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["estado"] == "terminada" and r.json()["fecha_terminada"]

    assert stock_de(client, admin, fabricacion["a"]) == 94
    assert stock_de(client, admin, fabricacion["b"]) == 47
    assert stock_de(client, admin, fabricacion["final"]) == 30
    assert en_ubicacion(client, admin, fabricacion["a"], fabricacion["ubicacion"]) == 94
    assert en_ubicacion(client, admin, fabricacion["final"], fabricacion["destino"]) == 30

    movs = client.get("/api/inventario/movimientos", headers=admin, params={"negocio_id": NEG, "limit": 500}).json()
    de_orden = [m for m in movs if m["referencia"] == orden["numero"]]
    assert sorted((m["tipo"], m["cantidad"]) for m in de_orden) == [("entrada", 30), ("salida", 3), ("salida", 6)]


def test_faltante_en_el_almacen_bloquea_sin_cambios(client, admin, almacen):
    a = insumo(client, admin, 5)          # 5 en total, pero solo 3 están en el almacén
    asignar(client, admin, a["id"], almacen["ubicacion"], 3)
    final = insumo(client, admin, 0)
    r = client.post(f"{URL}/recetas", headers=admin, json={
        "negocio_id": NEG, "nombre": unico("Escasa"), "producto_id": final["id"], "rendimiento": 1,
        "componentes": [{"inventario_id": a["id"], "cantidad": 2}],
    })
    orden = crear_orden(client, admin, {"receta": r.json(), **almacen}, cantidad=2)  # necesita 4, hay 3 en el almacén

    detalle = client.get(f"{URL}/ordenes/{orden['id']}", headers=admin).json()
    assert detalle["consumos"][0]["disponible"] == 3 and detalle["consumos"][0]["faltante"] == 1

    r = client.post(f"{URL}/ordenes/{orden['id']}/terminar", headers=admin)
    assert r.status_code == 409 and "faltan" in r.text
    assert stock_de(client, admin, a["id"]) == 5
    assert en_ubicacion(client, admin, a["id"], almacen["ubicacion"]) == 3
    assert stock_de(client, admin, final["id"]) == 0
    assert client.get(f"{URL}/ordenes/{orden['id']}", headers=admin).json()["estado"] == "planeada"


def test_no_se_termina_dos_veces(client, admin, fabricacion):
    orden = crear_orden(client, admin, fabricacion, cantidad=10)
    assert client.post(f"{URL}/ordenes/{orden['id']}/terminar", headers=admin).status_code == 200
    assert client.post(f"{URL}/ordenes/{orden['id']}/terminar", headers=admin).status_code == 400
    assert stock_de(client, admin, fabricacion["final"]) == 10


def test_cancelar_planeada_no_toca_inventario(client, admin, fabricacion):
    orden = crear_orden(client, admin, fabricacion, cantidad=10)
    r = client.post(f"{URL}/ordenes/{orden['id']}/cancelar", headers=admin, json={"motivo": "Cambio de pedido"})
    assert r.status_code == 200 and r.json()["estado"] == "cancelada"
    assert en_ubicacion(client, admin, fabricacion["a"], fabricacion["ubicacion"]) == 100


def test_terminada_no_se_cancela(client, admin, fabricacion):
    orden = crear_orden(client, admin, fabricacion, cantidad=10)
    client.post(f"{URL}/ordenes/{orden['id']}/terminar", headers=admin)
    r = client.post(f"{URL}/ordenes/{orden['id']}/cancelar", headers=admin, json={"motivo": "Error"})
    assert r.status_code == 400


def test_usuario_sin_el_negocio_403(client, solo_santal, fabricacion):
    r = client.get(f"{URL}/almacenes", headers=solo_santal, params={"negocio_id": "diagnostico_plus"})
    assert r.status_code == 403
