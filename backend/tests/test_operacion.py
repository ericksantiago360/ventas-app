"""Inventario, nómina, contabilidad y reportes."""
from .conftest import datos, id_de, unico

N = {"negocio_id": "santal"}


def test_inventario_movimientos(client, admin):
    r = client.post("/api/inventario/stock", headers=admin, json={
        **N, "nombre": unico("Insumo"), "sku": unico("INS"), "stock_inicial": 10, "stock_minimo": 5,
    })
    assert r.status_code == 201, r.text
    item = id_de(r.json())

    url = f"/api/inventario/stock/{item}/movimiento"
    assert client.post(url, headers=admin, json={"tipo": "salida", "cantidad": 7}).status_code == 200
    assert client.post(url, headers=admin, json={"tipo": "salida", "cantidad": 100}).status_code == 400

    alertas = datos(client.get("/api/inventario/stock", headers=admin,
                               params={**N, "solo_alertas": True}).json())
    assert item in [a.get("id") or a.get("_id") for a in alertas]


def test_nomina(client, admin):
    r = client.post("/api/personal/empleados", headers=admin, json={
        **N, "nombre": "Empleado", "salario_diario": 500, "periodo_pago": "quincenal",
        "fecha_ingreso": "2026-01-01",
    })
    assert r.status_code == 201, r.text

    r = client.post("/api/personal/nomina/periodos", headers=admin, json={
        **N, "nombre": unico("Q"), "tipo_periodo": "quincenal",
        "fecha_inicio": "2026-10-01", "fecha_fin": "2026-10-15",
    })
    assert r.status_code == 201, r.text
    periodo = id_de(r.json())

    assert client.patch(f"/api/personal/nomina/periodos/{periodo}/calcular", headers=admin).status_code == 200
    recibos = client.get("/api/personal/nomina/recibos", headers=admin, params={**N, "periodo_id": periodo})
    assert recibos.status_code == 200
    assert client.patch(f"/api/personal/nomina/periodos/{periodo}/cerrar", headers=admin).status_code == 200


def test_reportes_contables(client, admin):
    for ruta in ("balanza-comprobacion", "estado-resultados", "balance-general"):
        r = client.get(f"/api/contabilidad/reportes/{ruta}", headers=admin, params={**N, "periodo": "2026-10"})
        assert r.status_code == 200, f"{ruta}: {r.text}"


def test_reporte_resumen(client, admin):
    r = client.get("/api/reportes/resumen", headers=admin, params={**N, "mes": "2026-10"})
    assert r.status_code == 200
