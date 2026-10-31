"""Contabilidad: movimientos de venta del periodo (mostrador y pedidos no cancelados)."""
import pytest

from .conftest import id_de, unico

NEG = "santal"
REPORTE = "/api/contabilidad/reportes/ventas-periodo"


@pytest.fixture
def producto_con_precio(client, admin):
    r = client.post("/api/catalogo/productos", headers=admin, json={
        "negocio_id": NEG, "codigo": unico("VP"), "nombre": unico("Articulo"), "precio_base": 116,
        "tipo": "producto", "control_inventario": False,
    })
    assert r.status_code == 201, r.text
    return id_de(r.json())


def venta(client, admin, cuenta, producto, metodo="tarjeta"):
    r = client.post("/api/mostrador/ventas", headers=admin, json={
        "negocio_id": NEG, "cuenta_id": cuenta, "metodo_pago": metodo,
        "items": [{"producto_id": producto, "cantidad": 2}],
    })
    assert r.status_code == 201, r.text
    return r.json()


def test_venta_de_mostrador_aparece_en_el_periodo(client, admin, cuenta_santal, producto_con_precio):
    base = client.get(REPORTE, headers=admin, params={"negocio_id": NEG}).json()["totales"]

    v = venta(client, admin, cuenta_santal, producto_con_precio)
    reporte = client.get(REPORTE, headers=admin, params={"negocio_id": NEG}).json()

    assert reporte["totales"]["total"] - base["total"] == v["total"]
    assert reporte["totales"]["cantidad"] == base["cantidad"] + 1
    assert reporte["totales"]["por_canal"]["mostrador"] >= v["total"]
    mov = next(m for m in reporte["movimientos"] if m["referencia"] == v["folio"])
    assert mov["canal"] == "mostrador" and mov["total"] == v["total"] and mov["detalle"] == "tarjeta"


def test_venta_cancelada_sale_del_reporte(client, admin, cuenta_santal, producto_con_precio):
    v = venta(client, admin, cuenta_santal, producto_con_precio)
    antes = client.get(REPORTE, headers=admin, params={"negocio_id": NEG}).json()["totales"]["total"]

    client.post(f"/api/mostrador/ventas/{v['id']}/cancelar", headers=admin, json={"motivo": "Prueba"})
    reporte = client.get(REPORTE, headers=admin, params={"negocio_id": NEG}).json()

    assert reporte["totales"]["total"] == round(antes - v["total"], 2)
    assert all(m["referencia"] != v["folio"] for m in reporte["movimientos"])


def test_dias_suman_el_total(client, admin, cuenta_santal, producto_con_precio):
    venta(client, admin, cuenta_santal, producto_con_precio, metodo="tarjeta")
    reporte = client.get(REPORTE, headers=admin, params={"negocio_id": NEG}).json()
    assert round(sum(d["total"] for d in reporte["dias"]), 2) == reporte["totales"]["total"]


def test_usuario_sin_el_negocio_403(client, solo_santal):
    r = client.get(REPORTE, headers=solo_santal, params={"negocio_id": "diagnostico_plus"})
    assert r.status_code == 403
