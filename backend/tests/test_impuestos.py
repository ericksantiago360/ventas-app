"""Impuestos IVA/IEPS 2026 de la tienda: cálculo puro, checkout, envío, validación y seed."""
import asyncio
import os

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from app.modules.ecommerce.impuestos import (
    PERFILES, breakdown_line, breakdown_order, campos_fiscales,
)
from app.modules.ecommerce.seed import PRODUCTOS, sembrar_tienda_conveniencia

from .conftest import id_de, unico

NEG = "santal"
CLABE = "012345678901234567"


# ============================================================
# CÁLCULO PURO
# ============================================================

def test_iva_general_116_da_base_100_e_iva_16():
    d = breakdown_line(116, 1, "general")
    assert (d["base"], d["ieps"], d["iva"], d["total"]) == (100.0, 0.0, 16.0, 116.0)


def test_frontera_108_da_iva_8():
    d = breakdown_line(108, 1, "general", frontera=True)
    assert (d["base"], d["iva"]) == (100.0, 8.0)


def test_alta_densidad_125_28():
    d = breakdown_line(125.28, 1, "alta_densidad")
    assert (d["base"], d["ieps"], d["iva"]) == (100.0, 8.0, 17.28)


def test_refresco_600_ml_a_20_pesos():
    d = breakdown_line(20, 1, "bebida_azucarada", unidades_por_pieza=0.6)
    assert (d["base"], d["ieps"], d["iva"]) == (15.39, 1.85, 2.76)


def test_cuota_mayor_que_el_precio_deja_base_en_cero():
    d = breakdown_line(10, 1, "cigarros", unidades_por_pieza=20)   # cuota 17.03 > 10 / 1.16
    assert d["base"] == 0.0
    assert d["ieps"] > 0
    assert d["base"] + d["ieps"] + d["iva"] == d["total"]


@pytest.mark.parametrize("perfil", list(PERFILES))
@pytest.mark.parametrize("precio", [0.01, 1, 9.99, 15, 20, 116, 125.28, 333.33, 1999.99])
@pytest.mark.parametrize("cantidad", [1, 3])
def test_base_mas_ieps_mas_iva_cuadra_con_el_precio(perfil, precio, cantidad):
    d = breakdown_line(precio, cantidad, perfil, unidades_por_pieza=0.7, frontera=False)
    assert d["base"] >= 0 and d["ieps"] >= 0 and d["iva"] >= 0
    assert round(d["base"] + d["ieps"] + d["iva"], 2) == d["total"]


@pytest.mark.parametrize("perfil", ["general", "alta_densidad", "bebida_azucarada"])
def test_frontera_tambien_cuadra(perfil):
    d = breakdown_line(250.50, 2, perfil, unidades_por_pieza=1, frontera=True)
    assert round(d["base"] + d["ieps"] + d["iva"], 2) == d["total"]


def test_perfil_exento_y_iva_cero_no_cobran_iva():
    assert breakdown_line(50, 1, "exento")["iva"] == 0.0
    assert breakdown_line(50, 1, "iva_cero")["iva"] == 0.0


def test_perfil_desconocido_falla():
    with pytest.raises(ValueError):
        breakdown_line(10, 1, "no_existe")


def test_orden_con_envio_suma_envio_con_iva_general():
    items = [{"precio_unitario": 125.28, "cantidad": 1, "tax_profile": "alta_densidad", "ieps_units": 0}]
    o = breakdown_order(items, envio=99)
    assert o["envio_base"] == 85.34 and o["envio_iva"] == 13.66
    assert o["subtotal"] == 185.34 and o["ieps"] == 8.0 and o["iva"] == 30.94
    assert o["total"] == 224.28
    assert round(o["subtotal"] + o["ieps"] + o["iva"], 2) == o["total"]


# ============================================================
# CAMPOS FISCALES
# ============================================================

def test_campos_fiscales_normaliza_y_valida():
    assert campos_fiscales({"tax_profile": "", "sat_unit_key": ""}) == {
        "tax_profile": None, "sat_unit_key": "H87",
    }
    assert campos_fiscales({"sat_product_key": "50202306"}) == {"sat_product_key": "50202306"}
    for malo in ({"tax_profile": "inventado"}, {"sat_product_key": "123"},
                 {"ieps_units": -1}, {"ieps_units": "abc"}):
        with pytest.raises(ValueError):
            campos_fiscales(malo)


# ============================================================
# INTEGRACIÓN (API + Mongo)
# ============================================================

def _tienda(client, admin, **extra) -> str:
    slug = unico("imp").lower()
    r = client.put("/api/admin/tienda/config", headers=admin, params={"negocio_id": NEG}, json={
        "slug": slug, "activa": True, "nombre_tienda": "Tienda impuestos",
        "metodos_pago": [{"tipo": "transferencia", "banco": "BBVA", "titular": "Santal SA de CV", "clabe": CLABE}],
        **extra,
    })
    assert r.status_code == 200, r.text
    return slug


def _producto(client, admin, precio, perfil=None, ieps_units=0, negocio=NEG) -> str:
    codigo = unico("IMP")
    body = {
        "negocio_id": negocio, "codigo": codigo, "nombre": f"Prod {codigo}", "precio_base": precio,
        "tipo": "producto", "control_inventario": False, "iva_aplicable": True, "iva_pct": 16,
        "ieps_units": ieps_units,
    }
    if perfil:
        body["tax_profile"] = perfil
    r = client.post("/api/catalogo/productos", headers=admin, json=body)
    assert r.status_code == 201, r.text
    return id_de(r.json())


def _checkout(client, slug, partidas, **extra):
    cliente = {"nombre": "Ana Compradora", "email": f"{unico('c').lower()}@mail.mx", "telefono": "5512345678"}
    body = {"cliente": cliente, "partidas": partidas, "metodo_pago": "transferencia", **extra}
    r = client.post(f"/api/tienda/{slug}/checkout", json=body)
    assert r.status_code == 201, r.text
    return r.json(), cliente


def _estado(client, slug, folio, email):
    r = client.get(f"/api/tienda/{slug}/ordenes/{folio}", params={"email": email})
    assert r.status_code == 200, r.text
    return r.json()


def test_checkout_con_perfil_desglosa_y_guarda_en_la_orden(client, admin):
    slug = _tienda(client, admin)
    pid = _producto(client, admin, 125.28, perfil="alta_densidad")
    resp, cliente = _checkout(client, slug, [{"producto_id": pid, "cantidad": 1}])
    assert resp["total"] == 125.28
    estado = _estado(client, slug, resp["folio"], cliente["email"])
    assert (estado["subtotal"], estado["ieps"], estado["iva"], estado["total"]) == (100.0, 8.0, 17.28, 125.28)


def test_envio_causa_iva_y_el_total_cuadra(client, admin):
    slug = _tienda(client, admin, entrega_envio=True, entrega_recoger=True,
                   costo_envio=99, monto_envio_gratis=499)
    pid = _producto(client, admin, 125.28, perfil="alta_densidad")
    resp, cliente = _checkout(client, slug, [{"producto_id": pid, "cantidad": 1}], entrega="envio")
    assert resp["total"] == 224.28
    estado = _estado(client, slug, resp["folio"], cliente["email"])
    assert estado["costo_envio"] == 99
    assert round(estado["subtotal"] + estado["ieps"] + estado["iva"], 2) == estado["total"] == 224.28


def test_frontera_aplica_iva_8_por_ciento(client, admin):
    slug = _tienda(client, admin, iva_frontera=True)
    pid = _producto(client, admin, 108, perfil="general")
    resp, cliente = _checkout(client, slug, [{"producto_id": pid, "cantidad": 1}])
    estado = _estado(client, slug, resp["folio"], cliente["email"])
    assert (estado["subtotal"], estado["iva"], estado["total"]) == (100.0, 8.0, 108.0)


def test_producto_sin_perfil_mantiene_el_calculo_anterior(client, admin):
    slug = _tienda(client, admin)
    pid = _producto(client, admin, 1000)           # sin tax_profile: IVA 16% encima (iva_incluido=False)
    resp, _ = _checkout(client, slug, [{"producto_id": pid, "cantidad": 2}])
    assert resp["total"] == 2320.0


def test_catalogo_rechaza_perfil_y_clave_sat_invalidos(client, admin):
    base = {"negocio_id": NEG, "codigo": unico("V"), "nombre": "X", "precio_base": 10}
    r = client.post("/api/catalogo/productos", headers=admin, json={**base, "tax_profile": "inventado"})
    assert r.status_code == 422
    r = client.post("/api/catalogo/productos", headers=admin, json={**base, "sat_product_key": "123"})
    assert r.status_code == 422
    pid = id_de(client.post("/api/catalogo/productos", headers=admin, json={
        **base, "codigo": unico("V"), "tax_profile": "cigarros", "ieps_units": 20,
    }).json())
    r = client.put(f"/api/catalogo/productos/{pid}", headers=admin, json={"negocio_id": NEG, "sat_product_key": "50202306"})
    assert r.status_code == 200, r.text


def test_seed_tienda_es_idempotente(client, admin):
    async def correr():
        cliente = AsyncIOMotorClient(os.environ["MONGODB_URL"])
        try:
            db = cliente[os.environ["MONGODB_DB"]]
            primero = await sembrar_tienda_conveniencia(db, "diagnostico_plus")
            segundo = await sembrar_tienda_conveniencia(db, "diagnostico_plus")
            total = await db.productos.count_documents({"negocio_id": "diagnostico_plus", "sku": {"$regex": "^CONV-"}})
            return primero, segundo, total
        finally:
            cliente.close()

    primero, segundo, total = asyncio.run(correr())
    assert len(PRODUCTOS) == 19
    assert primero["productos_creados"] == 19
    assert segundo["productos_creados"] == 0 and segundo["productos_omitidos"] == 19
    assert segundo["categorias_creadas"] == 0
    assert total == 19
    # Cada perfil fiscal del catálogo aparece al menos una vez en el seed
    perfiles_seed = {p[3] for p in PRODUCTOS}
    requeridos = {"general", "iva_cero", "exento", "bebida_azucarada", "bebida_edulcorante", "bebida_energizante",
                  "alta_densidad", "alcohol_14", "alcohol_20", "alcohol_mas_20", "cigarros"}
    assert requeridos <= perfiles_seed


def test_confirmar_pedido_con_ieps_genera_poliza_cuadrada(client, admin):
    """La póliza de venta debe cuadrar aun con IEPS (se acredita a ventas)."""
    slug = _tienda(client, admin)
    pid = _producto(client, admin, 125.28, perfil="alta_densidad")
    resp, cliente = _checkout(client, slug, [{"producto_id": pid, "cantidad": 1}])
    folio = resp["folio"]

    r = client.get("/api/admin/tienda/ordenes", headers=admin, params={"negocio_id": NEG, "buscar": folio})
    assert r.status_code == 200, r.text
    orden_id = next(o["_id"] if "_id" in o else o["id"] for o in r.json()["data"] if o["folio"] == folio)
    c = client.put(f"/api/admin/tienda/ordenes/{orden_id}/confirmar", headers=admin)
    assert c.status_code == 200, c.text
    pedido_id = c.json()["pedido_id"]

    async def movimientos():
        cliente_db = AsyncIOMotorClient(os.environ["MONGODB_URL"])
        try:
            db = cliente_db[os.environ["MONGODB_DB"]]
            poliza = await db.polizas_contables.find_one({"referencia_id": pedido_id})
            mov = await db.movimientos_contables.find({"poliza_id": str(poliza["_id"])}).to_list(None)
            return sum(m["debe"] for m in mov), sum(m["haber"] for m in mov)
        finally:
            cliente_db.close()

    debe, haber = asyncio.run(movimientos())
    assert round(debe, 2) == round(haber, 2) == 125.28
