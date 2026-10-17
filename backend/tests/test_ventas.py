"""Cotizaciones → pedidos → pagos → facturación."""
import pytest

from .conftest import datos, es_pdf, id_de

ITEMS = [{"descripcion": "Producto", "cantidad": 2, "precio_unitario": 1000, "importe": 2000}]


@pytest.fixture
def cotizacion(client, admin, cliente_santal):
    r = client.post("/api/cotizaciones/", headers=admin, json={
        "negocio_id": "santal", "cliente_id": cliente_santal, "cliente_nombre": "Cliente",
        "items": ITEMS, "subtotal": 2000, "iva": 320, "total": 2320,
    })
    assert r.status_code == 201, r.text
    return id_de(r.json())


class TestCotizaciones:
    def test_estados(self, client, admin, cotizacion):
        url = f"/api/cotizaciones/{cotizacion}/estado"
        assert client.patch(url, headers=admin, json={"estado": "inventado"}).status_code == 400
        assert client.patch(url, headers=admin, json={"estado": "enviada"}).status_code == 200
        assert client.patch(url, headers=admin, json={"estado": "aceptada"}).status_code == 200
        assert client.get(f"/api/cotizaciones/{cotizacion}", headers=admin).json()["estado"] == "aceptada"

    def test_pdf(self, client, admin, cotizacion):
        assert es_pdf(client.get(f"/api/cotizaciones/{cotizacion}/pdf", headers=admin))


class TestPedidos:
    def test_transicion_invalida(self, client, admin, pedido_santal):
        r = client.patch(f"/api/pedidos/{pedido_santal}/estado", headers=admin, json={"estado": "entregado"})
        assert r.status_code == 400

    def test_flujo_y_pago_parcial(self, client, admin, pedido_santal, cuenta_santal):
        assert client.patch(f"/api/pedidos/{pedido_santal}/estado", headers=admin,
                            json={"estado": "en_proceso"}).status_code == 200
        assert client.patch(f"/api/pedidos/{pedido_santal}/etapa", headers=admin,
                            json={"etapa_interna": "en_corte"}).status_code == 200
        r = client.post(f"/api/pedidos/{pedido_santal}/pagos", headers=admin,
                        json={"monto": 1000, "cuenta_id": cuenta_santal, "metodo": "transferencia"})
        assert r.status_code == 201

        pedido = datos(client.get(f"/api/pedidos/{pedido_santal}", headers=admin).json())
        assert pedido["saldo_pendiente"] == pytest.approx(1320)
        assert client.get(f"/api/pedidos/{pedido_santal}/historial", headers=admin).status_code == 200

    def test_pago_sin_monto_400(self, client, admin, pedido_santal):
        assert client.post(f"/api/pedidos/{pedido_santal}/pagos", headers=admin, json={}).status_code == 400

    def test_kanban(self, client, admin, pedido_santal):
        r = client.get("/api/pedidos/kanban", headers=admin, params={"negocio_id": "santal"})
        assert pedido_santal in [p["_id"] for p in r.json()["confirmado"]]


class TestEtapasPorNegocio:
    @pytest.mark.parametrize("negocio,esperadas", [
        ("santal", ["recibido", "en_corte", "en_acabado", "control_calidad", "listo_para_recoger"]),
        ("dulce_tentacion", ["recibido", "preparando", "en_ruta", "listo_para_entrega"]),
        ("bienes_raices", ["recibido", "docs_pendientes", "revisando_docs", "aprobado", "contrato_listo"]),
        ("diagnostico_plus", ["recibido", "registro", "procesamiento", "validacion", "listo_para_entrega"]),
    ])
    def test_lista(self, client, admin, negocio, esperadas):
        r = client.get("/api/pedidos/etapas", headers=admin, params={"negocio_id": negocio})
        assert r.json()["data"] == esperadas

    def test_valida_contra_el_negocio(self, client, admin):
        r = client.post("/api/pedidos/", headers=admin,
                        json={"negocio_id": "dulce_tentacion", "cliente_nombre": "X", "total": 0})
        pedido = id_de(r.json())
        client.patch(f"/api/pedidos/{pedido}/estado", headers=admin, json={"estado": "en_proceso"})
        url = f"/api/pedidos/{pedido}/etapa"
        assert client.patch(url, headers=admin, json={"etapa_interna": "preparando"}).status_code == 200
        assert client.patch(url, headers=admin, json={"etapa_interna": "en_corte"}).status_code == 400


class TestFinanzasYFacturacion:
    def test_cobro(self, client, admin, cuenta_santal, pedido_santal):
        r = client.post("/api/finanzas/cobros", headers=admin, json={
            "negocio_id": "santal", "cuenta_id": cuenta_santal, "importe": 100, "pedido_id": pedido_santal,
        })
        assert r.status_code in (200, 201), r.text

    def test_factura_desde_pedido(self, client, admin, pedido_santal, cuenta_santal):
        r = client.post(f"/api/facturacion/desde-pedido/{pedido_santal}", headers=admin,
                        params={"emitir": True})
        assert r.status_code == 201, r.text
        factura = id_de(r.json())

        assert client.get(f"/api/facturacion/facturas/{factura}", headers=admin).status_code == 200
        r = client.post(f"/api/facturacion/facturas/{factura}/pagos", headers=admin,
                        json={"monto": 500, "cuenta_id": cuenta_santal})
        assert r.status_code == 201, r.text
        assert es_pdf(client.get(f"/api/facturacion/facturas/{factura}/pdf", headers=admin))

        r = client.post(f"/api/facturacion/facturas/{factura}/pagos", headers=admin,
                        json={"monto": 999999, "cuenta_id": cuenta_santal})
        assert r.status_code == 400
