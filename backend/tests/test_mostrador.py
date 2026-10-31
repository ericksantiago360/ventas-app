"""Mostrador: venta de caja con precio de catálogo, stock, cobro en finanzas y cancelación."""
import pytest

from .conftest import id_de, unico

NEG = "santal"
URL = "/api/mostrador"


@pytest.fixture
def producto_stock(client, admin):
    """Producto que controla inventario: $116 con IVA incluido (= $100 + 16%), 10 piezas en stock."""
    codigo = unico("MOS")
    r = client.post("/api/catalogo/productos", headers=admin, json={
        "negocio_id": NEG, "codigo": codigo, "nombre": f"Taza {codigo}", "precio_base": 116,
        "tipo": "producto", "control_inventario": True,
    })
    assert r.status_code == 201, r.text
    producto = r.json()
    pid = id_de(producto)

    r = client.post("/api/inventario/stock", headers=admin, json={
        "negocio_id": NEG, "nombre": unico("Inv Taza"), "producto_id": pid, "stock_inicial": 10,
    })
    assert r.status_code == 201, r.text
    return pid


def stock_de(client, admin, producto_id) -> float:
    filas = client.get(f"{URL}/productos", headers=admin, params={"negocio_id": NEG}).json()
    return next(f for f in filas if f["id"] == producto_id)["stock"]


def vender(client, headers, cuenta, producto, cantidad=2, metodo="efectivo", recibido=None):
    cuerpo = {
        "negocio_id": NEG, "cuenta_id": cuenta, "metodo_pago": metodo,
        "items": [{"producto_id": producto, "cantidad": cantidad}],
    }
    if recibido is not None:
        cuerpo["monto_recibido"] = recibido
    return client.post(f"{URL}/ventas", headers=headers, json=cuerpo)


def test_venta_con_precio_de_catalogo_iva_incluido_y_cambio(client, admin, cuenta_santal, producto_stock):
    r = vender(client, admin, cuenta_santal, producto_stock, cantidad=2, recibido=300)
    assert r.status_code == 201, r.text
    venta = r.json()

    assert venta["folio"].startswith("VTA-")
    assert venta["total"] == 232.0            # 2 × $116, IVA incluido
    assert venta["subtotal"] == 200.0 and venta["iva"] == 32.0
    assert venta["cambio"] == 68.0
    assert venta["estado"] == "completada" and venta["cobro_id"]
    assert venta["items"][0]["precio_unitario"] == 116.0

    assert stock_de(client, admin, producto_stock) == 8


def test_folio_consecutivo(client, admin, cuenta_santal, producto_stock):
    a = vender(client, admin, cuenta_santal, producto_stock, cantidad=1, recibido=116).json()
    b = vender(client, admin, cuenta_santal, producto_stock, cantidad=1, recibido=116).json()
    assert int(b["folio"].split("-")[1]) == int(a["folio"].split("-")[1]) + 1


def test_efectivo_con_monto_insuficiente_422(client, admin, cuenta_santal, producto_stock):
    assert vender(client, admin, cuenta_santal, producto_stock, cantidad=2, recibido=200).status_code == 422
    assert vender(client, admin, cuenta_santal, producto_stock, cantidad=2).status_code == 422
    assert stock_de(client, admin, producto_stock) == 10


def test_tarjeta_no_pide_monto_recibido(client, admin, cuenta_santal, producto_stock):
    r = vender(client, admin, cuenta_santal, producto_stock, cantidad=1, metodo="tarjeta")
    assert r.status_code == 201, r.text
    assert r.json()["cambio"] == 0 and r.json()["monto_recibido"] == 116.0


def test_sin_stock_suficiente_409_sin_cambios(client, admin, cuenta_santal, producto_stock):
    antes = client.get(f"{URL}/ventas", headers=admin, params={"negocio_id": NEG}).json()
    r = vender(client, admin, cuenta_santal, producto_stock, cantidad=11, recibido=5000)
    assert r.status_code == 409, r.text
    assert stock_de(client, admin, producto_stock) == 10
    despues = client.get(f"{URL}/ventas", headers=admin, params={"negocio_id": NEG}).json()
    assert len(despues) == len(antes)


def test_venta_crea_cobro_en_la_cuenta(client, admin, cuenta_santal, producto_stock):
    venta = vender(client, admin, cuenta_santal, producto_stock, cantidad=1, recibido=116).json()
    cobros = client.get("/api/finanzas/cobros", headers=admin, params={"negocio_id": NEG}).json()
    cobro = next(c for c in cobros if c["id"] == venta["cobro_id"])
    assert cobro["importe"] == 116.0
    assert cobro["estado"] == "confirmado"
    assert cobro["referencia"] == venta["folio"]


def test_cuenta_inexistente_o_de_otro_negocio_404(client, admin, producto_stock):
    r = vender(client, admin, "64b000000000000000000000", producto_stock, cantidad=1, recibido=116)
    assert r.status_code == 404


def test_producto_de_otro_negocio_404(client, admin, cuenta_santal):
    r = client.post(f"{URL}/ventas", headers=admin, json={
        "negocio_id": NEG, "cuenta_id": cuenta_santal, "metodo_pago": "tarjeta",
        "items": [{"producto_id": "64b000000000000000000000", "cantidad": 1}],
    })
    assert r.status_code == 404


def test_cancelar_repone_stock_y_revierte_cobro(client, admin, cuenta_santal, producto_stock):
    venta = vender(client, admin, cuenta_santal, producto_stock, cantidad=3, recibido=500).json()
    assert stock_de(client, admin, producto_stock) == 7

    r = client.post(f"{URL}/ventas/{venta['id']}/cancelar", headers=admin, json={"motivo": "Cliente se arrepintió"})
    assert r.status_code == 200, r.text
    assert r.json()["estado"] == "cancelada"
    assert stock_de(client, admin, producto_stock) == 10

    cobros = client.get("/api/finanzas/cobros", headers=admin, params={"negocio_id": NEG}).json()
    assert next(c for c in cobros if c["id"] == venta["cobro_id"])["estado"] == "cancelado"

    # Una venta cancelada no se vuelve a cancelar: no repone stock dos veces
    assert client.post(f"{URL}/ventas/{venta['id']}/cancelar", headers=admin, json={"motivo": "Otra vez"}).status_code == 400
    assert stock_de(client, admin, producto_stock) == 10


def test_resumen_del_dia_excluye_canceladas(client, admin, cuenta_santal, producto_stock):
    base = client.get(f"{URL}/resumen", headers=admin, params={"negocio_id": NEG}).json()

    efectivo = vender(client, admin, cuenta_santal, producto_stock, cantidad=1, recibido=116).json()
    vender(client, admin, cuenta_santal, producto_stock, cantidad=2, metodo="tarjeta")
    cancelada = vender(client, admin, cuenta_santal, producto_stock, cantidad=1, metodo="tarjeta").json()
    client.post(f"{URL}/ventas/{cancelada['id']}/cancelar", headers=admin, json={"motivo": "Error de cobro"})

    resumen = client.get(f"{URL}/resumen", headers=admin, params={"negocio_id": NEG}).json()
    assert resumen["ventas"] == base["ventas"] + 2
    assert resumen["canceladas"] == base["canceladas"] + 1
    assert resumen["por_metodo"]["efectivo"]["total"] - base["por_metodo"]["efectivo"]["total"] == 116.0
    assert resumen["por_metodo"]["tarjeta"]["total"] - base["por_metodo"]["tarjeta"]["total"] == 232.0
    assert efectivo["id"]


def test_usuario_sin_el_negocio_403(client, admin, solo_santal, cuenta_santal, producto_stock):
    r = client.get(f"{URL}/productos", headers=solo_santal, params={"negocio_id": "diagnostico_plus"})
    assert r.status_code == 403
    r = client.post(f"{URL}/ventas", headers=solo_santal, json={
        "negocio_id": "diagnostico_plus", "cuenta_id": cuenta_santal, "metodo_pago": "tarjeta",
        "items": [{"producto_id": producto_stock, "cantidad": 1}],
    })
    assert r.status_code == 403


# ── Descuentos por volumen ────────────────────────────────────────────────────

@pytest.fixture
def tramos(client, admin):
    """Crea tramos para la prueba y los desactiva al final, para no afectar a las demás."""
    creados = []

    def crear(cantidad_minima, porcentaje):
        r = client.post(f"{URL}/descuentos-volumen", headers=admin, json={
            "negocio_id": NEG, "nombre": unico("Tramo"), "cantidad_minima": cantidad_minima, "porcentaje": porcentaje,
        })
        assert r.status_code == 201, r.text
        creados.append(id_de(r.json()))
        return creados[-1]

    yield crear
    for tramo in creados:
        client.put(f"{URL}/descuentos-volumen/{tramo}", headers=admin, json={"activo": False})


def test_tramo_aplica_al_alcanzar_la_cantidad(client, admin, cuenta_santal, producto_stock, tramos):
    tramos(3, 10)

    sin_descuento = vender(client, admin, cuenta_santal, producto_stock, cantidad=2, metodo="tarjeta").json()
    assert sin_descuento["total"] == 232.0
    assert sin_descuento["items"][0]["descuento_pct"] == 0

    con_descuento = vender(client, admin, cuenta_santal, producto_stock, cantidad=3, metodo="tarjeta").json()
    item = con_descuento["items"][0]
    assert item["descuento_pct"] == 10
    assert item["precio_lista"] == 116.0
    assert item["precio_unitario"] == 104.4
    assert con_descuento["total"] == 313.2  # 3 × 104.40, IVA incluido


def test_el_tramo_mas_alto_que_alcanza_es_el_que_aplica(client, admin, cuenta_santal, producto_stock, tramos):
    tramos(2, 5)
    tramos(5, 15)

    seis = vender(client, admin, cuenta_santal, producto_stock, cantidad=6, metodo="tarjeta").json()
    assert seis["items"][0]["descuento_pct"] == 15   # no se acumulan: solo 15, no 5 + 15

    tres = vender(client, admin, cuenta_santal, producto_stock, cantidad=3, metodo="tarjeta").json()
    assert tres["items"][0]["descuento_pct"] == 5


def test_tramo_desactivado_deja_de_aplicar(client, admin, cuenta_santal, producto_stock, tramos):
    tramo = tramos(2, 20)
    assert client.put(f"{URL}/descuentos-volumen/{tramo}", headers=admin, json={"activo": False}).status_code == 200

    venta = vender(client, admin, cuenta_santal, producto_stock, cantidad=2, metodo="tarjeta").json()
    assert venta["items"][0]["descuento_pct"] == 0


def test_no_hay_dos_tramos_activos_con_la_misma_cantidad(client, admin, tramos):
    tramo = tramos(4, 8)
    r = client.post(f"{URL}/descuentos-volumen", headers=admin, json={
        "negocio_id": NEG, "nombre": "Otro", "cantidad_minima": 4, "porcentaje": 9,
    })
    assert r.status_code == 409

    # Al desactivar el primero, la cantidad vuelve a quedar libre
    client.put(f"{URL}/descuentos-volumen/{tramo}", headers=admin, json={"activo": False})
    r = client.post(f"{URL}/descuentos-volumen", headers=admin, json={
        "negocio_id": NEG, "nombre": "Otro", "cantidad_minima": 4, "porcentaje": 9,
    })
    assert r.status_code == 201, r.text
    client.put(f"{URL}/descuentos-volumen/{id_de(r.json())}", headers=admin, json={"activo": False})


def test_tramo_con_valores_invalidos_422(client, admin):
    for cuerpo in ({"cantidad_minima": 1, "porcentaje": 5},
                   {"cantidad_minima": 3, "porcentaje": 0},
                   {"cantidad_minima": 3, "porcentaje": 100}):
        r = client.post(f"{URL}/descuentos-volumen", headers=admin,
                        json={"negocio_id": NEG, "nombre": "X", **cuerpo})
        assert r.status_code == 422, cuerpo


def test_tramo_de_otro_negocio_403(client, solo_santal):
    r = client.post(f"{URL}/descuentos-volumen", headers=solo_santal, json={
        "negocio_id": "diagnostico_plus", "nombre": "X", "cantidad_minima": 3, "porcentaje": 5,
    })
    assert r.status_code == 403
