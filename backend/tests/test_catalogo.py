import base64

from .conftest import datos, id_de, unico

N = {"negocio_id": "santal"}


def test_producto_codigo_duplicado_409(client, admin):
    codigo = unico("P")
    body = {**N, "codigo": codigo, "nombre": "Original"}
    assert client.post("/api/catalogo/productos", headers=admin, json=body).status_code == 201
    r = client.post("/api/catalogo/productos", headers=admin, json={**body, "nombre": "Duplicado"})
    assert r.status_code == 409


def test_categoria_duplicada_409(client, admin):
    nombre = unico("Cat")
    assert client.post("/api/catalogo/categorias", headers=admin,
                       json={**N, "nombre": nombre, "codigo": unico("C")}).status_code == 201
    r = client.post("/api/catalogo/categorias", headers=admin,
                    json={**N, "nombre": nombre, "codigo": unico("C")})
    assert r.status_code == 409
    assert "Ya existe" in r.json()["detail"]


def test_variantes(client, admin, producto_santal):
    sku = unico("VAR")
    r = client.post(f"/api/catalogo/productos/{producto_santal}/variantes", headers=admin,
                    json={**N, "nombre": "Variante A", "sku": sku, "precio": 1100})
    assert r.status_code == 201, r.text
    assert datos(r.json())["producto_id"] == producto_santal

    r = client.get(f"/api/catalogo/productos/{producto_santal}/variantes", headers=admin, params=N)
    assert r.status_code == 200, r.text
    assert [v["sku"] for v in datos(r.json())] == [sku]

    r = client.get(f"/api/catalogo/productos/{producto_santal}", headers=admin, params=N)
    assert r.status_code == 200


def test_precios_por_lista(client, admin, producto_santal):
    r = client.post("/api/catalogo/listas-precios", headers=admin,
                    json={**N, "nombre": unico("Lista"), "codigo": unico("L")})
    assert r.status_code == 201
    lista = id_de(r.json())

    r = client.post(f"/api/catalogo/productos/{producto_santal}/precios", headers=admin,
                    json={**N, "lista_id": lista, "lista_precio_id": lista, "precio": 900})
    assert r.status_code in (200, 201), r.text

    r = client.get(f"/api/catalogo/productos/{producto_santal}/precios", headers=admin, params=N)
    assert r.status_code == 200, r.text
    assert len(datos(r.json())) == 1


PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


def test_subir_imagen_producto(client, admin, producto_santal):
    r = client.post(f"/api/catalogo/productos/{producto_santal}/imagen", headers=admin,
                    params=N, files={"archivo": ("foto.png", PNG_1X1, "image/png")})
    assert r.status_code == 200, r.text
    url = datos(r.json())["imagen"]
    assert url.startswith("/storage/productos/santal/") and url.endswith(".png")

    r = client.get(f"/api/catalogo/productos/{producto_santal}", headers=admin, params=N)
    assert datos(r.json())["imagen"] == url


def test_subir_imagen_rechaza_archivo_no_imagen(client, admin, producto_santal):
    r = client.post(f"/api/catalogo/productos/{producto_santal}/imagen", headers=admin,
                    params=N, files={"archivo": ("foto.png", b"no es imagen", "image/png")})
    assert r.status_code == 400
    assert "Formato no permitido" in r.json()["detail"]


def test_subir_imagen_rechaza_archivo_mayor_a_5mb(client, admin, producto_santal):
    grande = PNG_1X1 + b"\0" * (5 * 1024 * 1024)
    r = client.post(f"/api/catalogo/productos/{producto_santal}/imagen", headers=admin,
                    params=N, files={"archivo": ("grande.png", grande, "image/png")})
    assert r.status_code == 400
    assert "5 MB" in r.json()["detail"]
