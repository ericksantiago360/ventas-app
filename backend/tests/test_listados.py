"""Barrido: todos los GET de listado/dashboard responden sin error en cada negocio."""
import pytest

from app.main import app

from .conftest import NEGOCIOS

VALORES_QUERY = {"mes": "2026-10"}


def _listados():
    for ruta, ops in app.openapi()["paths"].items():
        get = ops.get("get")
        if not get or "{" in ruta or ruta.startswith("/api/portal") or ruta == "/auth/me":
            continue
        requeridos = [
            p["name"] for p in get.get("parameters", [])
            if p["in"] == "query" and p.get("required")
        ]
        yield ruta, requeridos


@pytest.mark.parametrize("negocio", NEGOCIOS)
@pytest.mark.parametrize("ruta,requeridos", list(_listados()), ids=lambda v: v if isinstance(v, str) else "")
def test_listado_responde(client, admin, negocio, ruta, requeridos):
    params = {
        nombre: negocio if nombre == "negocio_id" else VALORES_QUERY.get(nombre, "x")
        for nombre in requeridos
    }
    r = client.get(ruta, headers=admin, params=params)
    assert r.status_code < 400, r.text
