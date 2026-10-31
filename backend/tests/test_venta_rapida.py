"""CRM venta rápida: productos de interés, más vendidos y cotización, pedido o venta de mostrador desde un cliente."""
from .conftest import id_de, unico

NEG = "santal"
BASE = "/api/crm"


def venta(client, admin, cliente, tipo, producto, cantidad=2, **extra):
    return client.post(f"{BASE}/clientes/{cliente}/venta", headers=admin,
                       json={"negocio_id": NEG, "tipo": tipo, "items": [{"producto_id": producto, "cantidad": cantidad}], **extra})


def test_productos_de_interes_se_guardan_por_negocio(client, admin, cliente_santal, producto_santal):
    r = client.put(f"{BASE}/clientes/{cliente_santal}/productos-interes", headers=admin,
                   json={"negocio_id": NEG, "producto_ids": [producto_santal, producto_santal]})
    assert r.status_code == 200 and r.json()["producto_ids"] == [producto_santal]

    lista = client.get(f"{BASE}/clientes/{cliente_santal}/productos-interes", headers=admin, params={"negocio_id": NEG}).json()
    assert [p["id"] for p in lista] == [producto_santal] and lista[0]["precio"] == 1000.0


def test_interes_de_producto_ajeno_404(client, admin, cliente_santal):
    ajeno = id_de(client.post("/api/catalogo/productos", headers=admin, json={
        "negocio_id": "diagnostico_plus", "codigo": "AJ-" + cliente_santal[-6:], "nombre": "Ajeno", "precio_base": 5, "tipo": "producto",
    }).json())
    r = client.put(f"{BASE}/clientes/{cliente_santal}/productos-interes", headers=admin,
                   json={"negocio_id": NEG, "producto_ids": [ajeno]})
    assert r.status_code == 404


def test_mas_vendidos_cuenta_pedidos(client, admin, cliente_santal, producto_santal):
    antes = {p["id"]: p["unidades"] for p in client.get(f"{BASE}/productos-mas-vendidos", headers=admin, params={"negocio_id": NEG}).json()}
    r = venta(client, admin, cliente_santal, "pedido", producto_santal, cantidad=3)
    assert r.status_code == 201, r.text
    despues = {p["id"]: p["unidades"] for p in client.get(f"{BASE}/productos-mas-vendidos", headers=admin, params={"negocio_id": NEG}).json()}
    assert despues[producto_santal] == antes.get(producto_santal, 0) + 3


def test_genera_cotizacion_con_totales(client, admin, cliente_santal, producto_santal):
    r = venta(client, admin, cliente_santal, "cotizacion", producto_santal, cantidad=2)
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["tipo"] == "cotizacion" and d["numero"] and d["id"]
    assert d["total"] == 2320.0  # 2 × $1,000 + IVA 16%
    cot = client.get(f"/api/cotizaciones/{d['id']}", headers=admin)
    assert cot.status_code == 200 and cot.json()["subtotal"] == 2000.0


def test_genera_pedido(client, admin, cliente_santal, producto_santal):
    r = venta(client, admin, cliente_santal, "pedido", producto_santal, cantidad=1)
    assert r.status_code == 201, r.text
    assert r.json()["tipo"] == "pedido" and r.json()["total"] == 1160.0


def test_genera_venta_de_mostrador(client, admin, cliente_santal, producto_santal, cuenta_santal):
    r = venta(client, admin, cliente_santal, "mostrador", producto_santal, cantidad=1,
              cuenta_id=cuenta_santal, metodo_pago="tarjeta")
    assert r.status_code == 201, r.text
    assert r.json()["tipo"] == "mostrador" and r.json()["numero"].startswith("VTA-")


def test_mostrador_sin_cuenta_422(client, admin, cliente_santal, producto_santal):
    assert venta(client, admin, cliente_santal, "mostrador", producto_santal).status_code == 422


def test_producto_de_otro_negocio_404(client, admin, cliente_santal):
    r = client.post(f"{BASE}/clientes/{cliente_santal}/venta", headers=admin, json={
        "negocio_id": NEG, "tipo": "pedido", "items": [{"producto_id": "64b000000000000000000000", "cantidad": 1}],
    })
    assert r.status_code == 404


def test_usuario_sin_el_negocio_403(client, solo_santal, cliente_santal, producto_santal):
    r = client.post(f"{BASE}/clientes/{cliente_santal}/venta", headers=solo_santal, json={
        "negocio_id": "diagnostico_plus", "tipo": "pedido", "items": [{"producto_id": producto_santal, "cantidad": 1}],
    })
    assert r.status_code == 403


# ── Enviar lista de precios ───────────────────────────────────────────────────

def lista_santal(client, admin):
    r = client.post("/api/catalogo/listas-precios/generar", headers=admin, json={
        "negocio_id": NEG, "nombre": unico("Envio"), "ajuste_pct": -10,
    })
    assert r.status_code == 201, r.text
    return r.json()["data"]["_id"]


def test_envio_por_whatsapp_arma_el_enlace(client, admin, cliente_santal, producto_santal):
    lista = lista_santal(client, admin)
    r = client.post(f"{BASE}/clientes/{cliente_santal}/enviar-lista", headers=admin,
                    json={"negocio_id": NEG, "lista_id": lista, "canal": "whatsapp"})
    assert r.status_code == 200, r.text
    url = r.json()["url"]
    assert url.startswith("https://wa.me/5550100?text=")
    assert "Lista%20de%20precios" in url or "lista%20de%20precios" in url.lower()


def test_correo_sin_smtp_responde_503(client, admin, producto_santal):
    cliente = id_de(client.post("/api/crm/clientes", headers=admin, json={
        "empresa": unico("Correo"), "telefono": "5550199", "correo": "cliente@ejemplo.mx", "canal_origen": "directo",
    }).json())
    lista = lista_santal(client, admin)
    r = client.post(f"{BASE}/clientes/{cliente}/enviar-lista", headers=admin,
                    json={"negocio_id": NEG, "lista_id": lista, "canal": "correo"})
    assert r.status_code == 503


def test_correo_sin_direccion_del_cliente_422(client, admin, cliente_santal):
    lista = lista_santal(client, admin)
    r = client.post(f"{BASE}/clientes/{cliente_santal}/enviar-lista", headers=admin,
                    json={"negocio_id": NEG, "lista_id": lista, "canal": "correo"})
    assert r.status_code == 422


def test_lista_de_otro_negocio_404(client, admin, cliente_santal):
    r = client.post(f"{BASE}/clientes/{cliente_santal}/enviar-lista", headers=admin,
                    json={"negocio_id": NEG, "lista_id": "64b000000000000000000000", "canal": "whatsapp"})
    assert r.status_code == 404
