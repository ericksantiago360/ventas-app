"""Tienda en línea: configuración pública, checkout, stock, confirmación y cancelación."""
import pytest

from .conftest import datos, id_de, unico

NEG = "santal"
CLABE = "012345678901234567"


def _tienda_activa(client, admin, negocio: str = NEG, **extra) -> str:
    slug = unico("tienda").lower()
    r = client.put("/api/admin/tienda/config", headers=admin, params={"negocio_id": negocio}, json={
        "slug": slug, "activa": True, "nombre_tienda": "Tienda de prueba",
        "metodos_pago": [
            {"tipo": "transferencia", "banco": "BBVA", "titular": "Santal SA de CV",
             "clabe": CLABE, "instrucciones": "Incluye la referencia en el concepto"},
            {"tipo": "oxxo_cie", "banco": "OXXO", "titular": "Santal SA de CV", "cuenta": "12345678901"},
        ],
        **extra,
    })
    assert r.status_code == 200, r.text
    return slug


@pytest.fixture(scope="module")
def slug(client, admin):
    return _tienda_activa(client, admin)


def _producto(client, admin, precio=1000.0, control=False, stock=None, nombre=None, negocio: str = NEG) -> str:
    codigo = unico("E")
    r = client.post("/api/catalogo/productos", headers=admin, json={
        "negocio_id": negocio, "codigo": codigo, "nombre": nombre or f"Producto {codigo}", "precio_base": precio,
        "tipo": "producto", "control_inventario": control, "iva_aplicable": True, "iva_pct": 16,
    })
    assert r.status_code == 201, r.text
    pid = id_de(r.json())
    if stock is not None:
        r = client.post("/api/inventario/stock", headers=admin, json={
            "negocio_id": negocio, "nombre": f"Inv {codigo}", "producto_id": pid, "stock_inicial": stock,
        })
        assert r.status_code == 201, r.text
    return pid


def _cliente(**extra) -> dict:
    return {"nombre": "Ana Compradora", "email": f"{unico('c').lower()}@mail.mx",
            "telefono": "5512345678", **extra}


def _checkout(client, slug, partidas, metodo="transferencia", cliente=None, **extra):
    cliente = cliente or _cliente()
    body = {"cliente": cliente, "partidas": partidas, **extra}
    if metodo:
        body["metodo_pago"] = metodo
    return client.post(f"/api/tienda/{slug}/checkout", json=body), cliente


def _stock_de(client, admin, pid: str) -> float:
    r = client.get("/api/inventario/stock", headers=admin, params={"negocio_id": NEG})
    assert r.status_code == 200, r.text
    fila = next(i for i in datos(r.json()) if i["producto_id"] == pid)
    return float(fila["stock_actual"])


def test_config_publica_no_expone_clabe_ni_convenio(client, admin, slug):
    r = client.get(f"/api/tienda/{slug}/config")
    assert r.status_code == 200, r.text
    cuerpo = r.text
    assert CLABE not in cuerpo
    assert "12345678901" not in cuerpo
    assert {m["tipo"] for m in r.json()["metodos_pago"]} == {"transferencia", "oxxo_cie"}


def test_tienda_inexistente_o_apagada_responde_404(client, admin, slug):
    assert client.get("/api/tienda/no-existe-jamas/config").status_code == 404
    client.put("/api/admin/tienda/config", headers=admin, params={"negocio_id": NEG}, json={"activa": False})
    try:
        assert client.get(f"/api/tienda/{slug}/config").status_code == 404
    finally:
        client.put("/api/admin/tienda/config", headers=admin, params={"negocio_id": NEG}, json={"activa": True})


def test_checkout_calcula_precios_en_servidor_e_instrucciones(client, admin, slug):
    pid = _producto(client, admin, precio=1000)
    # El cliente intenta mandar un precio falso: se ignora
    r, cliente = _checkout(client, slug, [{"producto_id": pid, "cantidad": 2, "precio_unitario": 1}])
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["total"] == 2320.0                       # 2 × 1000 + IVA 16%
    assert body["folio"].startswith("ECO-")
    assert body["referencia_pago"] == f"{body['folio']}-2320"
    assert body["instrucciones_pago"]["clabe"] == CLABE  # completa solo en el checkout

    estado = client.get(f"/api/tienda/{slug}/ordenes/{body['folio']}", params={"email": cliente["email"]})
    assert estado.status_code == 200, estado.text
    assert estado.json()["estado"] == "pendiente_pago"
    assert estado.json()["clabe_terminacion"] == "4567"
    assert CLABE not in estado.text


def test_estado_de_orden_requiere_el_correo_correcto(client, admin, slug):
    pid = _producto(client, admin)
    r, cliente = _checkout(client, slug, [{"producto_id": pid, "cantidad": 1}])
    folio = r.json()["folio"]
    ajeno = client.get(f"/api/tienda/{slug}/ordenes/{folio}", params={"email": "otro@mail.mx"})
    assert ajeno.status_code == 404


def test_checkout_rechaza_stock_insuficiente(client, admin, slug):
    pid = _producto(client, admin, control=True, stock=2)
    r, _ = _checkout(client, slug, [{"producto_id": pid, "cantidad": 5}])
    assert r.status_code == 409, r.text
    assert "Stock insuficiente" in r.json()["detail"]
    r, _ = _checkout(client, slug, [{"producto_id": pid, "cantidad": 2}])
    assert r.status_code == 201, r.text


def test_checkout_exige_metodo_de_pago_valido(client, admin, slug):
    pid = _producto(client, admin)
    r, _ = _checkout(client, slug, [{"producto_id": pid, "cantidad": 1}], metodo=None)
    assert r.status_code == 422


def test_confirmar_crea_pedido_y_descuenta_stock(client, admin, slug):
    pid = _producto(client, admin, control=True, stock=5)
    r, cliente = _checkout(client, slug, [{"producto_id": pid, "cantidad": 2}])
    orden = r.json()

    c = client.put(f"/api/admin/tienda/ordenes/{_id_orden(client, admin, orden['folio'])}/confirmar", headers=admin)
    assert c.status_code == 200, c.text
    pedido_id = c.json()["pedido_id"]
    assert pedido_id

    pedido = datos(client.get(f"/api/pedidos/{pedido_id}", headers=admin).json())
    assert pedido["origen"] == "ecommerce"
    assert pedido["folio_eco"] == orden["folio"]
    assert pedido["total"] == 2320.0
    assert pedido["saldo_pendiente"] == 0
    assert _stock_de(client, admin, pid) == 3

    estado = client.get(f"/api/tienda/{slug}/ordenes/{orden['folio']}", params={"email": cliente["email"]})
    assert estado.json()["estado"] == "confirmada"


def test_cancelar_orden_confirmada_repone_stock_y_pedido(client, admin, slug):
    pid = _producto(client, admin, control=True, stock=4)
    r, _ = _checkout(client, slug, [{"producto_id": pid, "cantidad": 3}])
    oid = _id_orden(client, admin, r.json()["folio"])
    confirmada = client.put(f"/api/admin/tienda/ordenes/{oid}/confirmar", headers=admin)
    assert confirmada.status_code == 200, confirmada.text
    assert _stock_de(client, admin, pid) == 1

    cancelada = client.put(f"/api/admin/tienda/ordenes/{oid}/cancelar", headers=admin)
    assert cancelada.status_code == 200, cancelada.text
    assert _stock_de(client, admin, pid) == 4
    pedido = datos(client.get(f"/api/pedidos/{confirmada.json()['pedido_id']}", headers=admin).json())
    assert pedido["estado"] == "cancelado"


def test_no_se_confirma_dos_veces(client, admin, slug):
    pid = _producto(client, admin)
    r, _ = _checkout(client, slug, [{"producto_id": pid, "cantidad": 1}])
    oid = _id_orden(client, admin, r.json()["folio"])
    assert client.put(f"/api/admin/tienda/ordenes/{oid}/confirmar", headers=admin).status_code == 200
    assert client.put(f"/api/admin/tienda/ordenes/{oid}/confirmar", headers=admin).status_code == 400


def test_productos_sin_stock_no_aparecen_en_el_catalogo(client, admin, slug):
    marca = unico("BUSCA")
    _producto(client, admin, control=True, stock=3, nombre=f"Visible {marca}")
    _producto(client, admin, control=True, stock=0, nombre=f"Oculto {marca}")

    r = client.get(f"/api/tienda/{slug}/productos", params={"buscar": marca})
    assert r.status_code == 200, r.text
    nombres = [p["nombre"] for p in r.json()["data"]]
    assert nombres == [f"Visible {marca}"]


def test_modo_cotizacion_no_muestra_precio_ni_cobra(client, admin, slug):
    pid = _producto(client, admin, control=True, stock=0)   # sin stock no bloquea una cotización
    client.put("/api/admin/tienda/config", headers=admin, params={"negocio_id": NEG}, json={"mostrar_precio": False})
    try:
        detalle = client.get(f"/api/tienda/{slug}/productos/{pid}").json()
        assert detalle["precio"] is None
        assert detalle["cotizable"] is True

        r, _ = _checkout(client, slug, [{"producto_id": pid, "cantidad": 4}], metodo=None)
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["tipo"] == "cotizacion"
        assert body["total"] == 0
        assert body["referencia_pago"] is None
        assert "instrucciones_pago" not in body
    finally:
        client.put("/api/admin/tienda/config", headers=admin, params={"negocio_id": NEG}, json={"mostrar_precio": True})


def test_admin_de_tienda_requiere_acceso_al_negocio(client, solo_santal):
    r = client.get("/api/admin/tienda/config", headers=solo_santal, params={"negocio_id": "diagnostico_plus"})
    assert r.status_code == 403


def test_slug_repetido_responde_409(client, admin, slug):
    otro_negocio = "dulce_tentacion"
    r = client.put("/api/admin/tienda/config", headers=admin, params={"negocio_id": otro_negocio},
                   json={"slug": slug})
    assert r.status_code == 409


def _id_orden(client, admin, folio: str) -> str:
    r = client.get("/api/admin/tienda/ordenes", headers=admin, params={"negocio_id": NEG, "buscar": folio})
    assert r.status_code == 200, r.text
    return next(o["_id"] for o in r.json()["data"] if o["folio"] == folio)


def test_correo_con_saltos_de_linea_se_rechaza(client, admin, slug):
    pid = _producto(client, admin)
    cliente = _cliente(email="ana@mail.mx\nBcc: alguien@mail.mx")
    r, _ = _checkout(client, slug, [{"producto_id": pid, "cantidad": 1}], cliente=cliente)
    assert r.status_code == 422, r.text


def test_servicio_con_cita_solicitada(client, admin, slug):
    codigo = unico("S")
    r = client.post("/api/catalogo/productos", headers=admin, json={
        "negocio_id": NEG, "codigo": codigo, "nombre": f"Estudio {codigo}", "precio_base": 450,
        "tipo": "servicio",
    })
    assert r.status_code == 201, r.text
    pid = id_de(r.json())

    r, cliente = _checkout(client, slug, [{"producto_id": pid, "cantidad": 1}], metodo="oxxo_cie",
                           cita_solicitada="2026-11-03T10:30:00")
    assert r.status_code == 201, r.text
    assert r.json()["tipo"] == "servicio"
    assert r.json()["instrucciones_pago"]["convenio_cie"] == "12345678901"

    oid = _id_orden(client, admin, r.json()["folio"])
    orden = datos(client.get(f"/api/admin/tienda/ordenes/{oid}", headers=admin).json())
    assert orden["cita_solicitada"].startswith("2026-11-03T10:30")


def test_contacto_de_propiedad_llega_como_lead(client, admin):
    slug = _tienda_activa(client, admin, negocio="bienes_raices", modo="propiedades")
    codigo = unico("INM")
    r = client.post("/api/catalogo/productos", headers=admin, json={
        "negocio_id": "bienes_raices", "codigo": codigo, "nombre": f"Casa {codigo}", "precio_base": 2500000,
        "tipo": "producto",
    })
    assert r.status_code == 201, r.text
    pid = id_de(r.json())

    r, cliente = _checkout(client, slug, [{"producto_id": pid, "cantidad": 1}], metodo=None)
    assert r.status_code == 201, r.text
    assert r.json()["tipo"] == "contacto"
    assert r.json()["total"] == 0
    assert "instrucciones_pago" not in r.json()

    leads = datos(client.get("/api/crm/leads", headers=admin, params={"negocio_id": "bienes_raices"}).json())
    assert any(l.get("email") == cliente["email"] for l in leads)
