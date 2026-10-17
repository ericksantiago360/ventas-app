"""Catálogo contable sembrado para todos los negocios, incluido Diagnóstico Plus."""
from datetime import date

import pytest

from .conftest import NEGOCIOS, datos


@pytest.mark.parametrize("negocio", NEGOCIOS)
def test_negocio_sembrado_con_catalogo_y_periodo(client, admin, negocio):
    N = {"negocio_id": negocio}
    cuentas = datos(client.get("/api/contabilidad/cuentas", headers=admin, params=N).json())
    codigos = {c["codigo"] for c in cuentas}
    # Cuentas que usan las pólizas automáticas de venta y cobro
    assert {"1000", "4000"} <= codigos and len(cuentas) >= 40, negocio

    periodos = datos(client.get("/api/contabilidad/periodos", headers=admin, params=N).json())
    abiertos = {p["periodo"] for p in periodos if p["estado"] == "abierto"}
    assert date.today().strftime("%Y-%m") in abiertos, negocio
