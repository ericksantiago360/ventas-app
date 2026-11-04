"""Catálogo: listas de precios generadas desde el precio base con un ajuste."""
from .conftest import id_de, unico

NEG = "santal"
URL = "/api/catalogo"


def categoria(client, admin):
    r = client.post(f"{URL}/categorias", headers=admin, json={"negocio_id": NEG, "nombre": unico("Cat")})
    assert r.status_code == 201, r.text
    return id_de(r.json())


def producto(client, admin, precio, categoria=None):
    cuerpo = {"negocio_id": NEG, "codigo": unico("LP"), "nombre": unico("Prod"), "precio_base": precio, "tipo": "producto"}
    if categoria:
        cuerpo["categoria_id"] = categoria
    r = client.post(f"{URL}/productos", headers=admin, json=cuerpo)
    assert r.status_code == 201, r.text
    return id_de(r.json())


def generar(client, admin, **extra):
    cuerpo = {"negocio_id": NEG, "nombre": unico("Lista"), "ajuste_pct": -10, **extra}
    return client.post(f"{URL}/listas-precios/generar", headers=admin, json=cuerpo)


def precios_de(client, admin, lista_id):
    r = client.get(f"{URL}/listas-precios/{lista_id}/precios", headers=admin, params={"negocio_id": NEG})
    assert r.status_code == 200, r.text
    return {f["producto_id"]: f for f in r.json()["data"]}


def test_ajuste_negativo_aplica_a_todos_los_productos(client, admin):
    a = producto(client, admin, 100)
    b = producto(client, admin, 250)
    r = generar(client, admin, ajuste_pct=-10)
    assert r.status_code == 201, r.text
    lista = r.json()["data"]
    assert lista["total_productos"] >= 2 and lista["ajuste_pct"] == -10

    precios = precios_de(client, admin, lista["_id"])
    assert precios[a]["precio"] == 90.0 and precios[a]["precio_base"] == 100.0
    assert precios[b]["precio"] == 225.0
    assert precios[a]["diferencia_pct"] == -10.0


def test_redondeo_a_pesos(client, admin):
    p = producto(client, admin, 33.33)
    lista = generar(client, admin, ajuste_pct=5, redondear_pesos=True).json()["data"]
    assert precios_de(client, admin, lista["_id"])[p]["precio"] == 35.0

    sin = generar(client, admin, ajuste_pct=5).json()["data"]
    assert precios_de(client, admin, sin["_id"])[p]["precio"] == 35.0  # 33.33 × 1.05 = 34.9965 → 35.0 con 2 decimales


def test_filtro_por_categoria(client, admin):
    cat = categoria(client, admin)
    en = producto(client, admin, 80, categoria=cat)
    fuera = producto(client, admin, 80)
    lista = generar(client, admin, categoria_id=cat).json()["data"]
    assert lista["total_productos"] == 1
    precios = precios_de(client, admin, lista["_id"])
    assert en in precios and fuera not in precios


def test_nombre_repetido_409_y_ajuste_invalido_422(client, admin):
    producto(client, admin, 10)
    nombre = unico("Unica")
    assert generar(client, admin, nombre=nombre).status_code == 201
    assert generar(client, admin, nombre=nombre).status_code == 409
    assert generar(client, admin, ajuste_pct=-150).status_code == 422
    assert generar(client, admin, nombre="").status_code == 422


def test_sin_productos_con_precio_422(client, admin):
    r = client.post(f"{URL}/listas-precios/generar", headers=admin, json={
        "negocio_id": NEG, "nombre": unico("Vacia"), "ajuste_pct": 0, "categoria_id": categoria(client, admin),
    })
    assert r.status_code == 422


def test_usuario_sin_el_negocio_403(client, solo_santal):
    r = client.post(f"{URL}/listas-precios/generar", headers=solo_santal, json={
        "negocio_id": "diagnostico_plus", "nombre": "X", "ajuste_pct": 0,
    })
    assert r.status_code == 403
