"""
Seed de prueba: categoría "Tienda de conveniencia" (estilo OXXO) con 19 productos,
uno al menos por perfil fiscal. Idempotente: categorías por nombre, productos por SKU.

Precios de ejemplo con impuestos incluidos (MXN). Son datos de prueba, no tarifas.

Uso (desde backend/):
    python scripts/seed_tienda_conveniencia.py [negocio_id]
    make seed-tienda NEGOCIO=dulce_tentacion
"""
from datetime import datetime, timezone

CATEGORIA_RAIZ = "Tienda de conveniencia"

SUBCATEGORIAS = ["Bebidas", "Botanas y dulces", "Básicos", "Cigarros", "Varios"]

# (sku, nombre, subcategoria, perfil, precio, ieps_units, unidad)
# ieps_units: litros por pieza (bebidas por litro) o cigarros por cajetilla.
PRODUCTOS = [
    ("CONV-LECHE-1L",   "Leche entera 1 L",               "Básicos",          "iva_cero",           26.50, 0,   "pieza"),
    ("CONV-PAN-BLANCO", "Pan blanco bolsa",               "Básicos",          "iva_cero",           45.00, 0,   "pieza"),
    ("CONV-HUEVO-12",   "Huevo blanco 12 piezas",         "Básicos",          "iva_cero",           62.00, 0,   "pieza"),
    ("CONV-AGUA-1L",    "Agua purificada 1 L",            "Bebidas",          "iva_cero",           15.00, 0,   "pieza"),
    ("CONV-REF-600",    "Refresco cola 600 ml",           "Bebidas",          "bebida_azucarada",   20.00, 0.6, "pieza"),
    ("CONV-REF-2L",     "Refresco cola 2 L",              "Bebidas",          "bebida_azucarada",   38.00, 2,   "pieza"),
    ("CONV-REF-ZERO",   "Refresco sin azúcar 600 ml",     "Bebidas",          "bebida_edulcorante", 20.00, 0.6, "pieza"),
    ("CONV-ENERGIZ",    "Bebida energizante 473 ml",      "Bebidas",          "bebida_energizante", 33.00, 0,   "pieza"),
    ("CONV-PAPAS",      "Papas sabor original 45 g",      "Botanas y dulces", "alta_densidad",      17.00, 0,   "pieza"),
    ("CONV-CHOC",       "Chocolate barra 40 g",           "Botanas y dulces", "alta_densidad",      25.00, 0,   "pieza"),
    ("CONV-GALLETAS",   "Galletas de vainilla 120 g",     "Botanas y dulces", "alta_densidad",      28.00, 0,   "pieza"),
    ("CONV-CERV-LATA",  "Cerveza clara lata 355 ml",      "Bebidas",          "alcohol_14",         24.00, 0,   "pieza"),
    ("CONV-CERV-6",     "Cerveza clara six pack 355 ml",  "Bebidas",          "alcohol_14",        139.00, 0,   "pieza"),
    ("CONV-VINO",       "Vino tinto 750 ml",              "Bebidas",          "alcohol_20",        189.00, 0,   "pieza"),
    ("CONV-TEQUILA",    "Tequila reposado 750 ml",        "Bebidas",          "alcohol_mas_20",    389.00, 0,   "pieza"),
    ("CONV-CIG-20",     "Cigarros cajetilla 20 piezas",   "Cigarros",         "cigarros",           70.00, 20,  "pieza"),
    ("CONV-REVISTA",    "Revista semanal",                "Varios",           "exento",             65.00, 0,   "pieza"),
    ("CONV-JABON",      "Jabón de tocador",               "Varios",           "general",            22.00, 0,   "pieza"),
    ("CONV-PANALES",    "Pañales talla M 12 piezas",      "Varios",           "general",           179.00, 0,   "pieza"),
]


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


async def _categoria(db, negocio_id: str, nombre: str, padre_id: str | None, orden: int) -> tuple[str, bool]:
    """ID de la categoría (la crea si no existe) y si fue creada en esta corrida."""
    existente = await db.categorias.find_one({
        "negocio_id": negocio_id, "nombre": nombre, "categoria_padre_id": padre_id,
    })
    if existente:
        return str(existente["_id"]), False
    resultado = await db.categorias.insert_one({
        "negocio_id": negocio_id,
        "nombre": nombre,
        "codigo": "",
        "descripcion": "",
        "categoria_padre_id": padre_id,
        "activo": True,
        "orden": orden,
        "created_at": _ahora(),
        "updated_at": _ahora(),
    })
    return str(resultado.inserted_id), True


async def sembrar_tienda_conveniencia(db, negocio_id: str) -> dict:
    """Crea categorías y productos de prueba. Devuelve conteos de lo creado y lo omitido."""
    raiz_id, raiz_creada = await _categoria(db, negocio_id, CATEGORIA_RAIZ, None, 0)
    subcat_ids: dict[str, str] = {}
    categorias_creadas = int(raiz_creada)
    for orden, nombre in enumerate(SUBCATEGORIAS, start=1):
        subcat_ids[nombre], creada = await _categoria(db, negocio_id, nombre, raiz_id, orden)
        categorias_creadas += creada

    creados = omitidos = 0
    for sku, nombre, subcat, perfil, precio, ieps_units, unidad in PRODUCTOS:
        if await db.productos.find_one({"negocio_id": negocio_id, "sku": sku}):
            omitidos += 1
            continue
        marca = _ahora()
        await db.productos.insert_one({
            "negocio_id": negocio_id,
            "codigo": sku,
            "sku": sku,
            "nombre": nombre,
            "descripcion": "",
            "tipo": "producto",
            "categoria_id": subcat_ids[subcat],
            "unidad": unidad,
            "activo": True,
            "imagen": None,
            "costo": 0.0,
            "precio_base": precio,
            "iva_aplicable": True,
            "iva_pct": 16.0,
            "moneda": "MXN",
            "control_inventario": False,
            "permite_variantes": False,
            "especificaciones": {},
            "metadata": {},
            "tax_profile": perfil,
            "ieps_units": float(ieps_units),
            "sat_product_key": "",
            "sat_unit_key": "H87",
            "created_at": marca,
            "updated_at": marca,
        })
        creados += 1

    return {
        "categorias_creadas": categorias_creadas,
        "productos_creados": creados,
        "productos_omitidos": omitidos,
    }
