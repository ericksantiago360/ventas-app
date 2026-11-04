"""Buscador global: resultados por módulo con su ruta, acceso por negocio y entrada segura."""
from .conftest import id_de, unico

NEG = "santal"
URL = "/api/buscar"


def test_encuentra_producto_con_su_ruta(client, admin):
    nombre = unico("Buscable")
    r = client.post("/api/catalogo/productos", headers=admin, json={
        "negocio_id": NEG, "codigo": unico("BS"), "nombre": nombre, "precio_base": 10, "tipo": "producto",
    })
    assert r.status_code == 201, r.text
    resultados = client.get(URL, headers=admin, params={"negocio_id": NEG, "q": nombre.lower()}).json()
    producto = next(x for x in resultados if x["titulo"] == nombre)
    assert producto["tipo"] == "Producto" and producto["ruta"] == "/catalogo"


def test_encuentra_cliente_por_empresa(client, admin):
    empresa = unico("Empresa buscable")
    cliente = client.post("/api/crm/clientes", headers=admin, json={
        "empresa": empresa, "telefono": "5550123", "canal_origen": "directo",
    }).json()
    resultados = client.get(URL, headers=admin, params={"negocio_id": NEG, "q": empresa[:12]}).json()
    assert any(x["tipo"] == "Cliente" and x["id"] == id_de(cliente) and x["ruta"] == "/crm" for x in resultados)


def test_texto_con_caracteres_especiales_no_rompe(client, admin):
    r = client.get(URL, headers=admin, params={"negocio_id": NEG, "q": "(.*)+["})
    assert r.status_code == 200 and isinstance(r.json(), list)


def test_consulta_corta_responde_vacio(client, admin):
    r = client.get(URL, headers=admin, params={"negocio_id": NEG, "q": "a"})
    assert r.status_code == 200 and r.json() == []


def test_sin_acceso_al_negocio_403(client, solo_santal):
    r = client.get(URL, headers=solo_santal, params={"negocio_id": "diagnostico_plus", "q": "gel"})
    assert r.status_code == 403
