"""Cálculo de IMSS obrero e ISR en la nómina."""
import pytest

from app.modules.nomina.constants import (
    SALARIO_MINIMO_DIARIO, SBC_TOPE_MENSUAL, cuota_obrera_imss, retener_isr_mensual,
)
from app.routers.personal import calcular_deducciones

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


@pytest.mark.parametrize("salario_diario, dias, tipo, esperado", [
    (500, 15, "planta", {"imss": 187.01, "isr": 709.87}),
    (500, 15, "temporal", {"imss": 187.01, "isr": 709.87}),
    (500, 15, "honorarios", {"imss": 0.0, "isr": 0.0}),
    (SALARIO_MINIMO_DIARIO, 15, "planta", {"imss": 0.0, "isr": 0.0}),
    (250, 15, "planta", {"imss": 0.0, "isr": 0.0}),
    (315.05, 15, "planta", {"imss": 112.24, "isr": 72.73}),
    (0, 15, "planta", {"imss": 0.0, "isr": 0.0}),
])
def test_calcular_deducciones(salario_diario, dias, tipo, esperado):
    assert calcular_deducciones(salario_diario, dias, tipo) == esperado


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
        {"concepto": "IMSS", "monto": 187.01},
        {"concepto": "ISR", "monto": 709.87},
    ]
    assert planta["total_deducciones"] == 896.88
    assert planta["total_neto"] == 6_603.12

    for clave in ("minimo", "honorarios"):
        rec = recibos[empleados[clave]]
        assert rec["deducciones"] == []
        assert rec["total_neto"] == rec["total_percepciones"]
