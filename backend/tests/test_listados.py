"""Barrido: todos los GET de listado/dashboard responden sin error en cada negocio."""
import pytest

from app.main import app

from .conftest import NEGOCIOS

VALORES_QUERY = {"mes": "2026-10", "fecha": "2031-01-01"}


def _listados():
    for ruta, ops in app.openapi()["paths"].items():
        get = ops.get("get")
        # por-codigo es una búsqueda puntual: 404 si el código no existe; tiene sus propias pruebas
        if not get or "{" in ruta or ruta.startswith("/api/portal") or ruta in ("/auth/me", "/api/mostrador/productos/por-codigo"):
            continue
        requeridos = [
            p["name"] for p in get.get("parameters", [])
            if p["in"] == "query" and p.get("required")
        ]
        yield ruta, requeridos


@pytest.mark.parametrize("negocio", NEGOCIOS)
@pytest.mark.parametrize("ruta,requeridos", list(_listados()), ids=lambda v: v if isinstance(v, str) else "")
def test_listado_responde(client, admin, negocio, ruta, requeridos):
    # Un médico del negocio (si el negocio no asigna roles, cualquier usuario suyo, como el admin)
    medicos = client.get("/api/clinica/medicos", headers=admin, params={"negocio_id": negocio}).json()
    valores = {**VALORES_QUERY, "medico_id": medicos[0]["id"] if medicos else client.get("/auth/me", headers=admin).json()["id"]}
    params = {
        nombre: negocio if nombre == "negocio_id" else valores.get(nombre, "x")
        for nombre in requeridos
    }
    r = client.get(ruta, headers=admin, params=params)
    assert r.status_code < 400, r.text
