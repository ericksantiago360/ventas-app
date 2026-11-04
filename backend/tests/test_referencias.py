"""
Referencias entre negocios: un registro no puede apuntar a otro de un negocio distinto.

Se usa el admin, que tiene acceso a todos los negocios: aun así, un pedido de
Santal no puede enlazar una cotización, paciente o categoría de otro negocio.
Los clientes son compartidos entre negocios (SPEC §9), así que sí se pueden enlazar.
"""
import pytest

from .conftest import datos, id_de, unico

S = {"negocio_id": "santal"}
DT = {"negocio_id": "dulce_tentacion"}
L = {"negocio_id": "diagnostico_plus"}


@pytest.fixture
def cliente_ajeno(client, admin):
    r = client.post("/api/crm/clientes", headers=admin,
                    json={"empresa": unico("Cliente DT"), "telefono": "5550400", "canal_origen": "directo"})
    assert r.status_code == 201, r.text
    return id_de(r.json())


@pytest.fixture
def paciente_ajeno(client, admin):
    # Paciente registrado en Santal, no en el laboratorio
    r = client.post("/api/pacientes/pacientes", headers=admin, json={
        **S, "nombre": unico("Paciente"), "sexo": "femenino", "email": "ajeno@test.mx",
    })
    assert r.status_code == 201, r.text
    return id_de(r.json())


@pytest.fixture
def paciente_lab(client, admin):
    r = client.post("/api/pacientes/pacientes", headers=admin, json={
        **L, "nombre": unico("Paciente"), "sexo": "masculino",
    })
    assert r.status_code == 201, r.text
    return id_de(r.json())


def plantilla_en(client, admin, negocio):
    r = client.post("/api/lab/plantillas", headers=admin, json={
        "negocio_id": negocio, "codigo": unico("REF"), "nombre": "Estudio", "categoria": "QA",
        "precio": 100, "analitos": [{"nombre": "Glucosa", "unidad": "mg/dL"}],
    })
    assert r.status_code == 201, r.text
    return id_de(r.json())


class TestOrdenLaboratorio:
    def test_paciente_de_otro_negocio(self, client, admin, paciente_ajeno):
        plantilla = plantilla_en(client, admin, "diagnostico_plus")
        r = client.post("/api/lab/ordenes", headers=admin, json={
            **L, "fecha": "2026-10-17", "paciente_id": paciente_ajeno, "estudios": [{"plantilla_id": plantilla}],
        })
        assert r.status_code == 404
        # La orden no se creó con los datos del paciente ajeno
        ordenes = datos(client.get("/api/lab/ordenes", headers=admin, params=L).json())
        assert all(o.get("paciente_id") != paciente_ajeno for o in ordenes)

    def test_plantilla_de_otro_negocio(self, client, admin, paciente_lab):
        plantilla = plantilla_en(client, admin, "santal")
        r = client.post("/api/lab/ordenes", headers=admin, json={
            **L, "fecha": "2026-10-17", "paciente_id": paciente_lab, "estudios": [{"plantilla_id": plantilla}],
        })
        assert r.status_code == 400

    def test_referencias_propias(self, client, admin, paciente_lab):
        plantilla = plantilla_en(client, admin, "diagnostico_plus")
        r = client.post("/api/lab/ordenes", headers=admin, json={
            **L, "fecha": "2026-10-17", "paciente_id": paciente_lab, "estudios": [{"plantilla_id": plantilla}],
        })
        assert r.status_code == 201, r.text


class TestCotizacionesYPedidos:
    def test_cotizacion_con_cliente_compartido(self, client, admin, cliente_ajeno, cliente_santal):
        # Cliente unificado: una cotización de Santal puede usar un cliente creado sin negocio
        r = client.post("/api/cotizaciones/", headers=admin, json={**S, "cliente_id": cliente_ajeno})
        assert r.status_code == 201, r.text

        r = client.post("/api/cotizaciones/", headers=admin, json={**S, "cliente_id": cliente_santal})
        assert r.status_code == 201, r.text
        cotizacion = id_de(r.json())
        r = client.put(f"/api/cotizaciones/{cotizacion}", headers=admin, json={"cliente_id": cliente_ajeno})
        assert r.status_code == 200, r.text

    def test_pedido_con_cliente_compartido(self, client, admin, cliente_ajeno, pedido_santal):
        r = client.post("/api/pedidos/", headers=admin, json={**S, "cliente_id": cliente_ajeno, "total": 0})
        assert r.status_code == 201, r.text
        r = client.put(f"/api/pedidos/{pedido_santal}", headers=admin, json={"cliente_id": cliente_ajeno})
        assert r.status_code == 200, r.text

    def test_pedido_con_cotizacion_ajena(self, client, admin):
        r = client.post("/api/cotizaciones/", headers=admin, json={**DT})
        cotizacion_ajena = id_de(r.json())
        r = client.post("/api/pedidos/", headers=admin, json={**S, "cotizacion_id": cotizacion_ajena, "total": 0})
        assert r.status_code == 404

    def test_id_invalido(self, client, admin):
        r = client.post("/api/pedidos/", headers=admin, json={**S, "cliente_id": "no-es-un-id", "total": 0})
        assert r.status_code == 400


class TestFacturacionYFinanzas:
    def test_factura_manual_con_paciente_ajeno(self, client, admin, cliente_ajeno, paciente_ajeno):
        base = {"receptor": {"nombre": "Receptor"}, "conceptos": [{"descripcion": "Servicio", "precio_unitario": 100}]}
        # El paciente sí es de un negocio: una factura de Santal no puede usar el de laboratorio
        r = client.post("/api/facturacion/facturas", headers=admin, json={**L, **base, "paciente_id": paciente_ajeno})
        assert r.status_code == 404

        r = client.post("/api/facturacion/facturas", headers=admin, json={**S, **base, "cliente_id": cliente_ajeno})
        assert r.status_code == 201, r.text
        factura = id_de(r.json())
        r = client.put(f"/api/facturacion/facturas/{factura}", headers=admin, json={**base, "cliente_id": cliente_ajeno})
        assert r.status_code == 200, r.text

    def test_cobro_con_pedido_ajeno(self, client, admin, cuenta_santal, cliente_ajeno):
        r = client.post("/api/pedidos/", headers=admin, json={**DT, "cliente_nombre": "X", "total": 0})
        pedido_ajeno = id_de(r.json())
        base = {**S, "cuenta_id": cuenta_santal, "importe": 100}
        assert client.post("/api/finanzas/cobros", headers=admin, json={**base, "pedido_id": pedido_ajeno}).status_code == 404
        # El cobro por cliente compartido sí se acepta
        assert client.post("/api/finanzas/cobros", headers=admin, json={**base, "cliente_id": cliente_ajeno}).status_code == 200


class TestCatalogoEInventario:
    def test_producto_con_categoria_ajena(self, client, admin, producto_santal):
        r = client.post("/api/catalogo/categorias", headers=admin, json={**DT, "nombre": unico("Cat")})
        assert r.status_code == 201, r.text
        categoria_ajena = id_de(r.json())

        codigo = unico("P")
        r = client.post("/api/catalogo/productos", headers=admin, json={
            **S, "codigo": codigo, "nombre": codigo, "categoria_id": categoria_ajena,
        })
        assert r.status_code == 404
        r = client.put(f"/api/catalogo/productos/{producto_santal}", headers=admin,
                       json={**S, "categoria_id": categoria_ajena})
        assert r.status_code == 404

    def test_inventario_con_producto_ajeno(self, client, admin, producto_santal):
        r = client.post("/api/inventario/stock", headers=admin, json={
            **DT, "nombre": unico("Insumo"), "producto_id": producto_santal,
        })
        assert r.status_code == 404
