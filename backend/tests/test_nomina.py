"""Cálculo de IMSS obrero e ISR en la nómina."""
import pytest

from app.modules.nomina.constants import (
    SALARIO_MINIMO_DIARIO, SBC_TOPE_DIARIO, SBC_TOPE_MENSUAL, cuota_obrera_imss,
    dias_vacaciones, factor_integracion, retener_isr_mensual,
)
from app.routers.personal import calcular_anio_servicio, calcular_deducciones

from .conftest import datos, id_de, unico

N = {"negocio_id": "santal"}


def test_cuota_obrera_imss():
    assert cuota_obrera_imss(12_000)["total"] == 290.21
    # Debajo de 3 UMA no hay cuota adicional de EM
    assert cuota_obrera_imss(10_000)["em_adicional"] == 0
    # El SBC se topa en 25 UMA
    assert cuota_obrera_imss(SBC_TOPE_MENSUAL * 2) == cuota_obrera_imss(SBC_TOPE_MENSUAL)


def test_retener_isr_mensual():
    assert retener_isr_mensual(11_000) == {
        "isr_tarifa": 837.82, "subsidio_empleo": 535.65, "isr_retener": 302.17,
    }
    # Arriba del tope no hay subsidio
    assert retener_isr_mensual(15_200)["subsidio_empleo"] == 0
    # El subsidio nunca deja ISR negativo
    assert retener_isr_mensual(5_000)["isr_retener"] == 0


@pytest.mark.parametrize("anio, vacaciones, factor", [
    (0, 12, 1.0493), (1, 12, 1.0493), (2, 14, 1.0507), (5, 20, 1.0548),
    (6, 22, 1.0562), (10, 22, 1.0562), (11, 24, 1.0575), (31, 32, 1.0630),
])
def test_factor_integracion(anio, vacaciones, factor):
    assert dias_vacaciones(anio) == vacaciones
    assert factor_integracion(anio) == factor


@pytest.mark.parametrize("ingreso, fecha, anio", [
    ("2026-01-01", "2026-11-01", 1),
    ("2025-11-01", "2026-11-01", 2),   # aniversario cumplido ese día
    ("2025-11-02", "2026-11-01", 1),
    ("2020-11-01", "2026-11-01", 7),
    ("", "2026-11-01", 1),             # sin fecha de ingreso
    ("2030-01-01", "2026-11-01", 1),   # fecha de ingreso futura
])
def test_calcular_anio_servicio(ingreso, fecha, anio):
    assert calcular_anio_servicio(ingreso, fecha) == anio


@pytest.mark.parametrize("salario_diario, dias, tipo, anio, esperado", [
    (500, 15, "planta", 1, {"sbc_diario": 524.65, "imss": 197.27, "isr": 709.87}),
    (500, 15, "temporal", 1, {"sbc_diario": 524.65, "imss": 197.27, "isr": 709.87}),
    (500, 15, "planta", 6, {"sbc_diario": 528.10, "imss": 198.71, "isr": 709.87}),
    (500, 15, "honorarios", 1, {"sbc_diario": 0.0, "imss": 0.0, "isr": 0.0}),
    (SALARIO_MINIMO_DIARIO, 15, "planta", 1, {"sbc_diario": 330.57, "imss": 0.0, "isr": 0.0}),
    (250, 15, "planta", 1, {"sbc_diario": 262.32, "imss": 0.0, "isr": 0.0}),
    (315.05, 15, "planta", 1, {"sbc_diario": 330.58, "imss": 117.77, "isr": 72.73}),
    (0, 15, "planta", 1, {"sbc_diario": 0.0, "imss": 0.0, "isr": 0.0}),
])
def test_calcular_deducciones(salario_diario, dias, tipo, anio, esperado):
    assert calcular_deducciones(salario_diario, dias, tipo, anio) == esperado


def test_sbc_topado_en_25_uma():
    ded = calcular_deducciones(3_000, 15)
    assert ded["sbc_diario"] == round(SBC_TOPE_DIARIO, 2)
    assert ded["imss"] == calcular_deducciones(5_000, 15)["imss"]


def test_deducciones_proporcionales_al_periodo():
    mensual = calcular_deducciones(500, 30)
    semanal = calcular_deducciones(500, 7)
    assert semanal["imss"] == pytest.approx(mensual["imss"] * 7 / 30, abs=0.01)
    assert semanal["isr"] == pytest.approx(mensual["isr"] * 7 / 30, abs=0.01)


def test_recibos_con_deducciones(client, admin):
    empleados = {}
    for clave, salario, contrato in (
        ("planta", 500, "planta"),
        ("minimo", SALARIO_MINIMO_DIARIO, "planta"),
        ("honorarios", 500, "honorarios"),
    ):
        r = client.post("/api/personal/empleados", headers=admin, json={
            **N, "nombre": unico(clave), "salario_diario": salario,
            "tipo_contrato": contrato, "fecha_ingreso": "2026-01-01",
        })
        assert r.status_code == 201, r.text
        empleados[clave] = id_de(r.json())

    r = client.post("/api/personal/nomina/periodos", headers=admin, json={
        **N, "nombre": unico("Q"), "tipo_periodo": "quincenal",
        "fecha_inicio": "2026-11-01", "fecha_fin": "2026-11-15",
    })
    assert r.status_code == 201, r.text
    periodo = id_de(r.json())
    assert client.patch(f"/api/personal/nomina/periodos/{periodo}/calcular", headers=admin).status_code == 200

    r = client.get("/api/personal/nomina/recibos", headers=admin, params={**N, "periodo_id": periodo})
    assert r.status_code == 200, r.text
    recibos = {rec["empleado_id"]: rec for rec in datos(r.json())}

    planta = recibos[empleados["planta"]]
    assert planta["total_percepciones"] == 7_500
    assert planta["deducciones"] == [
        {"concepto": "IMSS", "monto": 197.27},
        {"concepto": "ISR", "monto": 709.87},
    ]
    assert planta["sbc_diario"] == 524.65
    assert planta["total_deducciones"] == 907.14
    assert planta["total_neto"] == 6_592.86

    for clave in ("minimo", "honorarios"):
        rec = recibos[empleados[clave]]
        assert rec["deducciones"] == []
        assert rec["total_neto"] == rec["total_percepciones"]


def test_factor_integracion_con_prestaciones_superiores():
    # 30 días de aguinaldo, prima de 50% y 2 días extra de vacaciones: 1 + (30 + 14 × 0.5) / 365
    assert factor_integracion(1, 30, 0.5, 2) == 1.1014
    ded = calcular_deducciones(500, 15, prestaciones={
        "aguinaldo_dias": 30, "prima_vacacional": 0.5, "vacaciones_extra": 2,
    })
    assert ded["sbc_diario"] == 550.70


def test_config_nomina(client, admin):
    # Otro negocio para no alterar los cálculos de santal en las demás pruebas
    neg = {"negocio_id": "dulce_tentacion"}
    url = "/api/personal/nomina/config"

    r = client.get(url, headers=admin, params=neg)
    assert r.status_code == 200, r.text
    assert r.json() == {
        **neg, "aguinaldo_dias": 15, "prima_vacacional": 0.25, "vacaciones_extra": 0,
        "factor_primer_anio": 1.0493,
    }

    # Menos que la ley se rechaza
    for invalido in ({"aguinaldo_dias": 10}, {"prima_vacacional": 0.2}, {"vacaciones_extra": -1}):
        assert client.put(url, headers=admin, json={**neg, **invalido}).status_code == 422

    try:
        r = client.put(url, headers=admin, json={
            **neg, "aguinaldo_dias": 30, "prima_vacacional": 0.5, "vacaciones_extra": 2,
        })
        assert r.status_code == 200, r.text
        assert r.json()["factor_primer_anio"] == 1.1014
        assert client.get(url, headers=admin, params=neg).json()["aguinaldo_dias"] == 30

        r = client.post("/api/personal/empleados", headers=admin, json={
            **neg, "nombre": unico("Emp"), "salario_diario": 500, "fecha_ingreso": "2026-01-01",
        })
        assert r.status_code == 201, r.text
        empleado = id_de(r.json())

        r = client.post("/api/personal/nomina/periodos", headers=admin, json={
            **neg, "nombre": unico("Q"), "tipo_periodo": "quincenal",
            "fecha_inicio": "2026-11-01", "fecha_fin": "2026-11-15",
        })
        periodo = id_de(r.json())
        assert client.patch(f"/api/personal/nomina/periodos/{periodo}/calcular", headers=admin).status_code == 200

        recibos = datos(client.get("/api/personal/nomina/recibos", headers=admin,
                                   params={**neg, "periodo_id": periodo}).json())
        recibo = next(rec for rec in recibos if rec["empleado_id"] == empleado)
        assert recibo["sbc_diario"] == 550.70
        assert recibo["deducciones"][0] == {"concepto": "IMSS", "monto": 208.12}
    finally:
        client.put(url, headers=admin, json=neg)


def test_config_nomina_sin_acceso(client, solo_santal):
    r = client.get("/api/personal/nomina/config", headers=solo_santal, params={"negocio_id": "dulce_tentacion"})
    assert r.status_code == 403


def test_config_nomina_solo_admin(client, solo_santal):
    # Un usuario no administrador puede ver las prestaciones de su negocio, pero no cambiarlas
    url = "/api/personal/nomina/config"
    assert client.get(url, headers=solo_santal, params=N).status_code == 200
    r = client.put(url, headers=solo_santal, json={**N, "aguinaldo_dias": 30})
    assert r.status_code == 403
    assert client.get(url, headers=solo_santal, params=N).json()["aguinaldo_dias"] == 15
