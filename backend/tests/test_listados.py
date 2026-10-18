"""Barrido: todos los GET de listado/dashboard responden sin error en cada negocio."""
import pytest

from app.main import app

from .conftest import NEGOCIOS

VALORES_QUERY = {"mes": "2026-10", "fecha": "2031-01-01"}


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
    # El admin tiene acceso a todos los negocios, así que sirve como médico
    valores = {**VALORES_QUERY, "medico_id": client.get("/auth/me", headers=admin).json()["id"]}
    params = {
        nombre: negocio if nombre == "negocio_id" else valores.get(nombre, "x")
        for nombre in requeridos
    }
    r = client.get(ruta, headers=admin, params=params)
    assert r.status_code < 400, r.text
