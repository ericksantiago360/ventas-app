"""Mostrador: venta de caja con precio de catálogo, stock, cobro en finanzas y cancelación."""
import pytest

from .conftest import id_de, unico

NEG = "santal"
URL = "/api/mostrador"


@pytest.fixture
def producto_stock(client, admin):
    """Producto que controla inventario: $116 con IVA incluido (= $100 + 16%), 10 piezas en stock."""
    codigo = unico("MOS")
    r = client.post("/api/catalogo/productos", headers=admin, json={
        "negocio_id": NEG, "codigo": codigo, "nombre": f"Taza {codigo}", "precio_base": 116,
        "tipo": "producto", "control_inventario": True,
    })
    assert r.status_code == 201, r.text
    producto = r.json()
    pid = id_de(producto)

    r = client.post("/api/inventario/stock", headers=admin, json={
        "negocio_id": NEG, "nombre": unico("Inv Taza"), "producto_id": pid, "stock_inicial": 10,
    })
    assert r.status_code == 201, r.text
    return pid


def stock_de(client, admin, producto_id) -> float:
    filas = client.get(f"{URL}/productos", headers=admin, params={"negocio_id": NEG}).json()
    return next(f for f in filas if f["id"] == producto_id)["stock"]


def vender(client, headers, cuenta, producto, cantidad=2, metodo="efectivo", recibido=None):
    cuerpo = {
        "negocio_id": NEG, "cuenta_id": cuenta, "metodo_pago": metodo,
        "items": [{"producto_id": producto, "cantidad": cantidad}],
    }
    if recibido is not None:
        cuerpo["monto_recibido"] = recibido
    return client.post(f"{URL}/ventas", headers=headers, json=cuerpo)


def test_venta_con_precio_de_catalogo_iva_incluido_y_cambio(client, admin, cuenta_santal, producto_stock):
    r = vender(client, admin, cuenta_santal, producto_stock, cantidad=2, recibido=300)
    assert r.status_code == 201, r.text
    venta = r.json()

    assert venta["folio"].startswith("VTA-")
    assert venta["total"] == 232.0            # 2 × $116, IVA incluido
    assert venta["subtotal"] == 200.0 and venta["iva"] == 32.0
    assert venta["cambio"] == 68.0
    assert venta["estado"] == "completada" and venta["cobro_id"]
    assert venta["items"][0]["precio_unitario"] == 116.0

    assert stock_de(client, admin, producto_stock) == 8


def test_folio_consecutivo(client, admin, cuenta_santal, producto_stock):
    a = vender(client, admin, cuenta_santal, producto_stock, cantidad=1, recibido=116).json()
    b = vender(client, admin, cuenta_santal, producto_stock, cantidad=1, recibido=116).json()
    assert int(b["folio"].split("-")[1]) == int(a["folio"].split("-")[1]) + 1


def test_efectivo_con_monto_insuficiente_422(client, admin, cuenta_santal, producto_stock):
    assert vender(client, admin, cuenta_santal, producto_stock, cantidad=2, recibido=200).status_code == 422
    assert vender(client, admin, cuenta_santal, producto_stock, cantidad=2).status_code == 422
    assert stock_de(client, admin, producto_stock) == 10


def test_tarjeta_no_pide_monto_recibido(client, admin, cuenta_santal, producto_stock):
    r = vender(client, admin, cuenta_santal, producto_stock, cantidad=1, metodo="tarjeta")
    assert r.status_code == 201, r.text
    assert r.json()["cambio"] == 0 and r.json()["monto_recibido"] == 116.0


def test_sin_stock_suficiente_409_sin_cambios(client, admin, cuenta_santal, producto_stock):
    antes = client.get(f"{URL}/ventas", headers=admin, params={"negocio_id": NEG}).json()
    r = vender(client, admin, cuenta_santal, producto_stock, cantidad=11, recibido=5000)
    assert r.status_code == 409, r.text
    assert stock_de(client, admin, producto_stock) == 10
    despues = client.get(f"{URL}/ventas", headers=admin, params={"negocio_id": NEG}).json()
    assert len(despues) == len(antes)


def test_venta_crea_cobro_en_la_cuenta(client, admin, cuenta_santal, producto_stock):
    venta = vender(client, admin, cuenta_santal, producto_stock, cantidad=1, recibido=116).json()
    cobros = client.get("/api/finanzas/cobros", headers=admin, params={"negocio_id": NEG}).json()
    cobro = next(c for c in cobros if c["id"] == venta["cobro_id"])
    assert cobro["importe"] == 116.0
    assert cobro["estado"] == "confirmado"
    assert cobro["referencia"] == venta["folio"]


def test_cuenta_inexistente_o_de_otro_negocio_404(client, admin, producto_stock):
    r = vender(client, admin, "64b000000000000000000000", producto_stock, cantidad=1, recibido=116)
    assert r.status_code == 404


def test_producto_de_otro_negocio_404(client, admin, cuenta_santal):
    r = client.post(f"{URL}/ventas", headers=admin, json={
        "negocio_id": NEG, "cuenta_id": cuenta_santal, "metodo_pago": "tarjeta",
        "items": [{"producto_id": "64b000000000000000000000", "cantidad": 1}],
    })
    assert r.status_code == 404


def test_cancelar_repone_stock_y_revierte_cobro(client, admin, cuenta_santal, producto_stock):
    venta = vender(client, admin, cuenta_santal, producto_stock, cantidad=3, recibido=500).json()
    assert stock_de(client, admin, producto_stock) == 7

    r = client.post(f"{URL}/ventas/{venta['id']}/cancelar", headers=admin, json={"motivo": "Cliente se arrepintió"})
    assert r.status_code == 200, r.text
    assert r.json()["estado"] == "cancelada"
    assert stock_de(client, admin, producto_stock) == 10

    cobros = client.get("/api/finanzas/cobros", headers=admin, params={"negocio_id": NEG}).json()
    assert next(c for c in cobros if c["id"] == venta["cobro_id"])["estado"] == "cancelado"

    # Una venta cancelada no se vuelve a cancelar: no repone stock dos veces
    assert client.post(f"{URL}/ventas/{venta['id']}/cancelar", headers=admin, json={"motivo": "Otra vez"}).status_code == 400
    assert stock_de(client, admin, producto_stock) == 10


def test_resumen_del_dia_excluye_canceladas(client, admin, cuenta_santal, producto_stock):
    base = client.get(f"{URL}/resumen", headers=admin, params={"negocio_id": NEG}).json()

    efectivo = vender(client, admin, cuenta_santal, producto_stock, cantidad=1, recibido=116).json()
    vender(client, admin, cuenta_santal, producto_stock, cantidad=2, metodo="tarjeta")
    cancelada = vender(client, admin, cuenta_santal, producto_stock, cantidad=1, metodo="tarjeta").json()
    client.post(f"{URL}/ventas/{cancelada['id']}/cancelar", headers=admin, json={"motivo": "Error de cobro"})

    resumen = client.get(f"{URL}/resumen", headers=admin, params={"negocio_id": NEG}).json()
    assert resumen["ventas"] == base["ventas"] + 2
    assert resumen["canceladas"] == base["canceladas"] + 1
    assert resumen["por_metodo"]["efectivo"]["total"] - base["por_metodo"]["efectivo"]["total"] == 116.0
    assert resumen["por_metodo"]["tarjeta"]["total"] - base["por_metodo"]["tarjeta"]["total"] == 232.0
    assert efectivo["id"]


def test_usuario_sin_el_negocio_403(client, admin, solo_santal, cuenta_santal, producto_stock):
    r = client.get(f"{URL}/productos", headers=solo_santal, params={"negocio_id": "diagnostico_plus"})
    assert r.status_code == 403
    r = client.post(f"{URL}/ventas", headers=solo_santal, json={
        "negocio_id": "diagnostico_plus", "cuenta_id": cuenta_santal, "metodo_pago": "tarjeta",
        "items": [{"producto_id": producto_stock, "cantidad": 1}],
    })
    assert r.status_code == 403


# ── Descuentos por volumen ────────────────────────────────────────────────────

@pytest.fixture
def tramos(client, admin):
    """Crea tramos para la prueba y los desactiva al final, para no afectar a las demás."""
    creados = []

    def crear(cantidad_minima, porcentaje):
        r = client.post(f"{URL}/descuentos-volumen", headers=admin, json={
            "negocio_id": NEG, "nombre": unico("Tramo"), "cantidad_minima": cantidad_minima, "porcentaje": porcentaje,
        })
        assert r.status_code == 201, r.text
        creados.append(id_de(r.json()))
        return creados[-1]

    yield crear
    for tramo in creados:
        client.put(f"{URL}/descuentos-volumen/{tramo}", headers=admin, json={"activo": False})


def test_tramo_aplica_al_alcanzar_la_cantidad(client, admin, cuenta_santal, producto_stock, tramos):
    tramos(3, 10)

    sin_descuento = vender(client, admin, cuenta_santal, producto_stock, cantidad=2, metodo="tarjeta").json()
    assert sin_descuento["total"] == 232.0
    assert sin_descuento["items"][0]["descuento_pct"] == 0

    con_descuento = vender(client, admin, cuenta_santal, producto_stock, cantidad=3, metodo="tarjeta").json()
    item = con_descuento["items"][0]
    assert item["descuento_pct"] == 10
    assert item["precio_lista"] == 116.0
    assert item["precio_unitario"] == 104.4
    assert con_descuento["total"] == 313.2  # 3 × 104.40, IVA incluido


def test_el_tramo_mas_alto_que_alcanza_es_el_que_aplica(client, admin, cuenta_santal, producto_stock, tramos):
    tramos(2, 5)
    tramos(5, 15)

    seis = vender(client, admin, cuenta_santal, producto_stock, cantidad=6, metodo="tarjeta").json()
    assert seis["items"][0]["descuento_pct"] == 15   # no se acumulan: solo 15, no 5 + 15

    tres = vender(client, admin, cuenta_santal, producto_stock, cantidad=3, metodo="tarjeta").json()
    assert tres["items"][0]["descuento_pct"] == 5


def test_tramo_desactivado_deja_de_aplicar(client, admin, cuenta_santal, producto_stock, tramos):
    tramo = tramos(2, 20)
    assert client.put(f"{URL}/descuentos-volumen/{tramo}", headers=admin, json={"activo": False}).status_code == 200

    venta = vender(client, admin, cuenta_santal, producto_stock, cantidad=2, metodo="tarjeta").json()
    assert venta["items"][0]["descuento_pct"] == 0


def test_no_hay_dos_tramos_activos_con_la_misma_cantidad(client, admin, tramos):
    tramo = tramos(4, 8)
    r = client.post(f"{URL}/descuentos-volumen", headers=admin, json={
        "negocio_id": NEG, "nombre": "Otro", "cantidad_minima": 4, "porcentaje": 9,
    })
    assert r.status_code == 409

    # Al desactivar el primero, la cantidad vuelve a quedar libre
    client.put(f"{URL}/descuentos-volumen/{tramo}", headers=admin, json={"activo": False})
    r = client.post(f"{URL}/descuentos-volumen", headers=admin, json={
        "negocio_id": NEG, "nombre": "Otro", "cantidad_minima": 4, "porcentaje": 9,
    })
    assert r.status_code == 201, r.text
    client.put(f"{URL}/descuentos-volumen/{id_de(r.json())}", headers=admin, json={"activo": False})


def test_tramo_con_valores_invalidos_422(client, admin):
    for cuerpo in ({"cantidad_minima": 1, "porcentaje": 5},
                   {"cantidad_minima": 3, "porcentaje": 0},
                   {"cantidad_minima": 3, "porcentaje": 100}):
        r = client.post(f"{URL}/descuentos-volumen", headers=admin,
                        json={"negocio_id": NEG, "nombre": "X", **cuerpo})
        assert r.status_code == 422, cuerpo


def test_tramo_de_otro_negocio_403(client, solo_santal):
    r = client.post(f"{URL}/descuentos-volumen", headers=solo_santal, json={
        "negocio_id": "diagnostico_plus", "nombre": "X", "cantidad_minima": 3, "porcentaje": 5,
    })
    assert r.status_code == 403


def test_lector_de_codigo_encuentra_por_codigo_o_sku(client, admin, producto_stock):
    prod = client.get(f"{URL}/productos", headers=admin, params={"negocio_id": NEG}).json()
    fila = next(p for p in prod if p["id"] == producto_stock)
    r = client.get(f"{URL}/productos/por-codigo", headers=admin,
                   params={"negocio_id": NEG, "codigo": fila["sku"]})
    assert r.status_code == 200, r.text
    assert r.json()["id"] == producto_stock and r.json()["stock"] == 10
    # Sin distinguir mayúsculas
    r = client.get(f"{URL}/productos/por-codigo", headers=admin,
                   params={"negocio_id": NEG, "codigo": fila["sku"].lower()})
    assert r.status_code == 200 and r.json()["id"] == producto_stock


def test_lector_de_codigo_es_exacto_no_busqueda_parcial(client, admin, producto_stock):
    r = client.get(f"{URL}/productos/por-codigo", headers=admin,
                   params={"negocio_id": NEG, "codigo": "MOS"})
    assert r.status_code == 404
    r = client.get(f"{URL}/productos/por-codigo", headers=admin,
                   params={"negocio_id": NEG, "codigo": "NO-EXISTE-123"})
    assert r.status_code == 404


def test_lector_de_codigo_no_expone_productos_de_otro_negocio_ni_dados_de_baja(
    client, admin, solo_santal, producto_stock
):
    prod = client.get(f"{URL}/productos", headers=admin, params={"negocio_id": NEG}).json()
    sku = next(p for p in prod if p["id"] == producto_stock)["sku"]
    # Otro negocio: el usuario sin acceso a dulce_tentacion recibe 403
    r = client.get(f"{URL}/productos/por-codigo", headers=solo_santal,
                   params={"negocio_id": "dulce_tentacion", "codigo": sku})
    assert r.status_code == 403
    # Dado de baja: deja de aparecer
    client.put(f"/api/catalogo/productos/{producto_stock}", headers=admin,
               json={"negocio_id": NEG, "activo": False})
    r = client.get(f"{URL}/productos/por-codigo", headers=admin,
                   params={"negocio_id": NEG, "codigo": sku})
    assert r.status_code == 404


def test_descuento_manual_sobre_la_venta(client, admin, cuenta_santal, producto_stock):
    # 2 × $116 con 10% manual: $104.40 c/u, total $208.80
    r = client.post(f"{URL}/ventas", headers=admin, json={
        "negocio_id": NEG, "cuenta_id": cuenta_santal, "metodo_pago": "tarjeta",
        "items": [{"producto_id": producto_stock, "cantidad": 2}],
        "descuento_manual_pct": 10,
    })
    assert r.status_code == 201, r.text
    venta = r.json()
    assert venta["total"] == 208.8
    assert venta["items"][0]["precio_unitario"] == 104.4
    assert venta["descuento_manual_pct"] == 10
    assert venta["subtotal"] + venta["iva"] == 208.8


def test_descuento_manual_fuera_de_rango_422(client, admin, cuenta_santal, producto_stock):
    for pct in (-1, 100):
        r = client.post(f"{URL}/ventas", headers=admin, json={
            "negocio_id": NEG, "cuenta_id": cuenta_santal, "metodo_pago": "tarjeta",
            "items": [{"producto_id": producto_stock, "cantidad": 1}],
            "descuento_manual_pct": pct,
        })
        assert r.status_code == 422, (pct, r.text)


def test_linea_manual_artículo_sin_inventario(client, admin, cuenta_santal, producto_stock):
    r = client.post(f"{URL}/ventas", headers=admin, json={
        "negocio_id": NEG, "cuenta_id": cuenta_santal, "metodo_pago": "tarjeta",
        "items": [
            {"manual": {"nombre": "Envoltura especial", "precio": 58}, "cantidad": 2},
            {"producto_id": producto_stock, "cantidad": 1},
        ],
    })
    assert r.status_code == 201, r.text
    venta = r.json()
    manual = next(i for i in venta["items"] if i["manual"])
    assert manual["producto_id"] is None and manual["nombre"] == "Envoltura especial"
    assert manual["precio_unitario"] == 58.0
    assert venta["total"] == 116.0 + 116.0      # 2 × $58 + 1 × $116
    # El stock del producto controlado baja solo por la partida del catálogo
    assert stock_de(client, admin, producto_stock) == 9


def test_partida_con_producto_y_manual_o_ninguno_422(client, admin, cuenta_santal, producto_stock):
    base = {"negocio_id": NEG, "cuenta_id": cuenta_santal, "metodo_pago": "tarjeta"}
    ambos = {"producto_id": producto_stock, "manual": {"nombre": "X", "precio": 10}, "cantidad": 1}
    ninguno = {"cantidad": 1}
    for item in (ambos, ninguno):
        r = client.post(f"{URL}/ventas", headers=admin, json={**base, "items": [item]})
        assert r.status_code == 422, r.text
    assert stock_de(client, admin, producto_stock) == 10


# ── CRUD de productos del mostrador ──────────────────────────────────────────

def _crear_prod(client, admin, **extra):
    cuerpo = {"negocio_id": NEG, "codigo": unico("CRUD"), "nombre": unico("Artículo"), "precio": 50}
    cuerpo.update(extra)
    return client.post(f"{URL}/productos", headers=admin, json=cuerpo)


def test_crud_producto_crear_leer_editar(client, admin, cuenta_santal):
    r = _crear_prod(client, admin, precio=116)
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    assert r.json()["precio"] == 116.0 and r.json()["activo"] is True and r.json()["stock"] is None

    r = client.get(f"{URL}/productos/{pid}", headers=admin)
    assert r.status_code == 200 and r.json()["id"] == pid

    r = client.put(f"{URL}/productos/{pid}", headers=admin, json={"precio": 232, "nombre": "  Renombrado  "})
    assert r.status_code == 200, r.text
    assert r.json()["precio"] == 232.0 and r.json()["nombre"] == "Renombrado"

    # El precio nuevo es el que usa la siguiente venta
    venta = vender(client, admin, cuenta_santal, pid, cantidad=1, recibido=300).json()
    assert venta["total"] == 232.0


def test_crud_producto_codigo_repetido_409(client, admin):
    a = _crear_prod(client, admin).json()
    codigo_a = a["codigo"]
    assert _crear_prod(client, admin, codigo=codigo_a.lower()).status_code == 409
    b = _crear_prod(client, admin).json()
    r = client.put(f"{URL}/productos/{b['id']}", headers=admin, json={"codigo": codigo_a})
    assert r.status_code == 409


def test_crud_producto_inventariado_crea_stock(client, admin):
    r = _crear_prod(client, admin, control_inventario=True, stock_inicial=7)
    assert r.status_code == 201, r.text
    assert r.json()["control_inventario"] is True and r.json()["stock"] == 7


def test_crud_producto_baja_logica_y_listado(client, admin):
    pid = _crear_prod(client, admin).json()["id"]
    assert client.delete(f"{URL}/productos/{pid}", headers=admin).status_code == 200
    activos = client.get(f"{URL}/productos/admin", headers=admin, params={"negocio_id": NEG}).json()
    assert pid not in [p["id"] for p in activos]
    todos = client.get(f"{URL}/productos/admin", headers=admin,
                       params={"negocio_id": NEG, "incluir_inactivos": True}).json()
    dado_de_baja = next(p for p in todos if p["id"] == pid)
    assert dado_de_baja["activo"] is False
    # Ya no aparece en la venta
    assert pid not in [p["id"] for p in client.get(f"{URL}/productos", headers=admin, params={"negocio_id": NEG}).json()]


def test_crud_producto_otro_negocio_403(client, solo_santal):
    r = client.post(f"{URL}/productos", headers=solo_santal,
                    json={"negocio_id": "dulce_tentacion", "codigo": unico("X"), "nombre": "X", "precio": 10})
    assert r.status_code == 403


def test_crud_tramo_eliminar_deja_de_aplicar(client, admin, cuenta_santal, producto_stock, tramos):
    tramo_id = tramos(2, 10)  # 10% desde 2 piezas
    venta = vender(client, admin, cuenta_santal, producto_stock, cantidad=2, recibido=500).json()
    assert venta["items"][0]["descuento_pct"] == 10

    assert client.delete(f"{URL}/descuentos-volumen/{tramo_id}", headers=admin).status_code == 200
    assert client.delete(f"{URL}/descuentos-volumen/{tramo_id}", headers=admin).status_code == 404
    venta = vender(client, admin, cuenta_santal, producto_stock, cantidad=2, recibido=500).json()
    assert venta["items"][0]["descuento_pct"] == 0


# ── Sucursales ───────────────────────────────────────────────────────────────

@pytest.fixture
def sucursal(client, admin):
    """Sucursal activa de Santal. Se da de baja al final para no afectar a las pruebas de venta sin sucursal."""
    r = client.post(f"{URL}/sucursales", headers=admin, json={"negocio_id": NEG, "nombre": unico("Suc"), "direccion": "Centro"})
    assert r.status_code == 201, r.text
    suc = r.json()
    yield suc
    client.delete(f"{URL}/sucursales/{suc['id']}", headers=admin)


def test_sucursal_crud(client, admin):
    r = client.post(f"{URL}/sucursales", headers=admin, json={"negocio_id": NEG, "nombre": unico("CRUD")})
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    assert r.json()["activo"] is True

    r = client.put(f"{URL}/sucursales/{sid}", headers=admin, json={"nombre": "  Renombrada  ", "direccion": "Norte"})
    assert r.status_code == 200 and r.json()["nombre"] == "Renombrada" and r.json()["direccion"] == "Norte"

    assert client.delete(f"{URL}/sucursales/{sid}", headers=admin).status_code == 200
    activas = client.get(f"{URL}/sucursales", headers=admin, params={"negocio_id": NEG}).json()
    assert sid not in [s["id"] for s in activas]
    todas = client.get(f"{URL}/sucursales", headers=admin,
                       params={"negocio_id": NEG, "incluir_inactivas": True}).json()
    assert next(s for s in todas if s["id"] == sid)["activo"] is False


def test_sucursal_nombre_repetido_409(client, admin, sucursal):
    r = client.post(f"{URL}/sucursales", headers=admin, json={"negocio_id": NEG, "nombre": sucursal["nombre"].upper()})
    assert r.status_code == 409


def test_venta_exige_sucursal_y_la_guarda(client, admin, cuenta_santal, producto_stock, sucursal):
    # Con una sucursal activa, la venta sin sucursal se rechaza
    assert vender(client, admin, cuenta_santal, producto_stock, cantidad=1, recibido=200).status_code == 422

    r = client.post(f"{URL}/ventas", headers=admin, json={
        "negocio_id": NEG, "cuenta_id": cuenta_santal, "metodo_pago": "tarjeta",
        "items": [{"producto_id": producto_stock, "cantidad": 1}], "sucursal_id": sucursal["id"],
    })
    assert r.status_code == 201, r.text
    assert r.json()["sucursal_id"] == sucursal["id"] and r.json()["sucursal_nombre"] == sucursal["nombre"]

    # Filtros por sucursal en ventas y resumen
    filas = client.get(f"{URL}/ventas", headers=admin,
                       params={"negocio_id": NEG, "sucursal_id": sucursal["id"]}).json()
    assert [v["id"] for v in filas] == [r.json()["id"]]
    resumen = client.get(f"{URL}/resumen", headers=admin,
                         params={"negocio_id": NEG, "sucursal_id": sucursal["id"]}).json()
    assert resumen["ventas"] == 1


def test_venta_con_sucursal_de_baja_o_ajena_404(client, admin, cuenta_santal, producto_stock, sucursal):
    client.delete(f"{URL}/sucursales/{sucursal['id']}", headers=admin)
    r = client.post(f"{URL}/ventas", headers=admin, json={
        "negocio_id": NEG, "cuenta_id": cuenta_santal, "metodo_pago": "tarjeta",
        "items": [{"producto_id": producto_stock, "cantidad": 1}], "sucursal_id": sucursal["id"],
    })
    assert r.status_code == 404, r.text
