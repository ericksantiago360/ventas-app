"""
Desglose de impuestos mexicanos (IVA e IEPS 2026) para la tienda en línea.

Regla de negocio: los precios se capturan CON impuestos incluidos. Se desglosa
precio = base + IEPS + IVA, con esta cadena:

    precio = (base × (1 + tasa_IEPS) + cuota_IEPS) × (1 + tasa_IVA)

- El IEPS se calcula sobre la base; la base del IVA incluye el IEPS.
- La cuota fija de IEPS se multiplica por unidades (litros por pieza o cigarros
  por cajetilla) × cantidad.
- Decimal con ROUND_HALF_UP a centavos. Base e IEPS se redondean; el IVA absorbe
  el redondeo para que base + IEPS + IVA sea exactamente el precio.
- Si la cuota es mayor que el precio, la base queda en 0 (nunca negativa).

Las tasas son las de 2026 del prompt de implementación y deben confirmarse con
un contador antes de operar.

Este módulo no toca la base de datos: solo calcula.
"""
from decimal import ROUND_HALF_UP, Decimal

CENTAVO = Decimal("0.01")
CERO = Decimal("0")
UNO = Decimal("1")

IVA_GENERAL = Decimal("0.16")
IVA_FRONTERA = Decimal("0.08")

# Perfiles fiscales (catálogo editable en un solo lugar).
# iva:          tasa de IVA; None = exento (sin IVA).
# ieps_tasa:    tasa ad valorem de IEPS sobre la base.
# ieps_cuota:   cuota fija de IEPS por unidad (litro o cigarro).
PERFILES: dict[str, dict] = {
    "general":            {"etiqueta": "General 16%",                        "iva": IVA_GENERAL, "ieps_tasa": CERO,               "ieps_cuota": CERO},
    "iva_cero":           {"etiqueta": "Tasa 0% (alimentos básicos)",         "iva": CERO,        "ieps_tasa": CERO,               "ieps_cuota": CERO},
    "exento":             {"etiqueta": "Exento de IVA",                       "iva": None,        "ieps_tasa": CERO,               "ieps_cuota": CERO},
    "bebida_azucarada":   {"etiqueta": "Bebida azucarada (cuota por litro)",  "iva": IVA_GENERAL, "ieps_tasa": CERO,               "ieps_cuota": Decimal("3.0818")},
    "bebida_edulcorante": {"etiqueta": "Bebida con edulcorante (por litro)",  "iva": IVA_GENERAL, "ieps_tasa": CERO,               "ieps_cuota": Decimal("1.50")},
    "bebida_energizante": {"etiqueta": "Bebida energizante",                  "iva": IVA_GENERAL, "ieps_tasa": Decimal("0.25"),    "ieps_cuota": CERO},
    "alta_densidad":      {"etiqueta": "Alta densidad ≥275 kcal/100 g",       "iva": IVA_GENERAL, "ieps_tasa": Decimal("0.08"),    "ieps_cuota": CERO},
    "alcohol_14":         {"etiqueta": "Cerveza hasta 14° GL",                "iva": IVA_GENERAL, "ieps_tasa": Decimal("0.265"),   "ieps_cuota": CERO},
    "alcohol_20":         {"etiqueta": "Bebida de 14° a 20° GL",              "iva": IVA_GENERAL, "ieps_tasa": Decimal("0.30"),    "ieps_cuota": CERO},
    "alcohol_mas_20":     {"etiqueta": "Bebida de más de 20° GL",             "iva": IVA_GENERAL, "ieps_tasa": Decimal("0.53"),    "ieps_cuota": CERO},
    "cigarros":           {"etiqueta": "Cigarros (200% + cuota por cigarro)", "iva": IVA_GENERAL, "ieps_tasa": Decimal("2.00"),    "ieps_cuota": Decimal("0.8516")},
    "puros_mano":         {"etiqueta": "Puros hechos a mano",                 "iva": IVA_GENERAL, "ieps_tasa": Decimal("0.32"),    "ieps_cuota": CERO},
}

SAT_PRODUCTO_DEFAULT = ""
SAT_UNIDAD_DEFAULT = "H87"  # pieza


def _dec(valor) -> Decimal:
    return Decimal(str(valor or 0))


def _centavos(valor: Decimal) -> Decimal:
    return valor.quantize(CENTAVO, rounding=ROUND_HALF_UP)


def perfil_valido(clave: str | None) -> bool:
    return clave is None or clave in PERFILES


def tasa_iva(perfil: str, frontera: bool = False) -> Decimal:
    """Tasa de IVA del perfil. En región fronteriza la tasa general baja a 8%."""
    tasa = PERFILES[perfil]["iva"]
    if tasa is None:
        return CERO
    if frontera and tasa == IVA_GENERAL:
        return IVA_FRONTERA
    return tasa


def breakdown_line(
    precio_unitario,
    cantidad: int,
    perfil: str,
    unidades_por_pieza=0,
    frontera: bool = False,
) -> dict:
    """
    Desglosa una partida con precio incluido de impuestos.

    precio_unitario: precio por pieza con IVA e IEPS incluidos.
    unidades_por_pieza: litros por pieza (bebidas) o cigarros por cajetilla.
    Devuelve base, IEPS, IVA y total de la partida (todo en Decimal redondeado a centavos,
    y como float para la API/Mongo), más la tasa de IVA aplicada.
    """
    if perfil not in PERFILES:
        raise ValueError(f"Perfil fiscal desconocido: {perfil}")
    cfg = PERFILES[perfil]
    total = _centavos(_dec(precio_unitario) * int(cantidad))
    tasa_iv = tasa_iva(perfil, frontera)

    # Precio sin IVA: lo que el IEPS y la base deben cubrir
    sin_iva = total / (UNO + tasa_iv)
    cuota = cfg["ieps_cuota"] * _dec(unidades_por_pieza) * int(cantidad)

    if sin_iva <= cuota:
        base_exacta = CERO
    else:
        base_exacta = (sin_iva - cuota) / (UNO + cfg["ieps_tasa"])

    base = _centavos(base_exacta)
    ieps = _centavos(sin_iva - base_exacta) if sin_iva > 0 else CERO
    ieps = min(max(ieps, CERO), total)
    iva = total - base - ieps   # el IVA absorbe el redondeo

    return {
        "tax_profile": perfil,
        "iva_rate": float(tasa_iv),
        "base": float(base),
        "ieps": float(ieps),
        "iva": float(iva),
        "total": float(total),
    }


def breakdown_order(items: list[dict], envio=0, frontera: bool = False) -> dict:
    """
    Totales de una orden a partir de sus partidas.

    items: cada una con precio_unitario, cantidad, tax_profile y ieps_units.
    envio: costo de envío con IVA general incluido.

    Devuelve subtotal (base), ieps, iva, total e iva agrupado por tasa.
    El envío entra al subtotal, al IVA y al total, y se reporta aparte en
    envio_base / envio_iva.
    """
    lineas = []
    subtotal = ieps = iva = total = CERO
    por_tasa: dict[str, Decimal] = {}

    for item in items:
        desglose = breakdown_line(
            item["precio_unitario"], item["cantidad"], item.get("tax_profile") or "general",
            item.get("ieps_units") or 0, frontera,
        )
        lineas.append({**item, **desglose})
        subtotal += _dec(desglose["base"])
        ieps += _dec(desglose["ieps"])
        iva += _dec(desglose["iva"])
        total += _dec(desglose["total"])
        clave = f"{desglose['iva_rate'] * 100:g}"
        por_tasa[clave] = por_tasa.get(clave, CERO) + _dec(desglose["iva"])

    envio_base = envio_iva = CERO
    if _dec(envio) > 0:
        d = breakdown_line(envio, 1, "general", 0, frontera)
        envio_base, envio_iva = _dec(d["base"]), _dec(d["iva"])
        subtotal += envio_base
        iva += envio_iva
        total += _dec(envio)
        clave = f"{d['iva_rate'] * 100:g}"
        por_tasa[clave] = por_tasa.get(clave, CERO) + envio_iva

    return {
        "lineas": lineas,
        "subtotal": float(_centavos(subtotal)),
        "ieps": float(_centavos(ieps)),
        "iva": float(_centavos(iva)),
        "total": float(_centavos(total)),
        "envio_base": float(_centavos(envio_base)),
        "envio_iva": float(_centavos(envio_iva)),
        "iva_por_tasa": {k: float(_centavos(v)) for k, v in por_tasa.items()},
    }


# ============================================================
# CAMPOS FISCALES DEL PRODUCTO
# ============================================================

CAMPOS_FISCALES_DEFAULT = {
    "tax_profile": None,        # None = sin desglose (cálculo anterior de IVA)
    "ieps_units": 0.0,          # litros por pieza o cigarros por cajetilla
    "sat_product_key": "",      # c_ClaveProdServ, 8 dígitos
    "sat_unit_key": SAT_UNIDAD_DEFAULT,  # c_ClaveUnidad
}


def campos_fiscales(body: dict) -> dict:
    """
    Valida y normaliza los campos fiscales presentes en body.
    Solo devuelve las claves que vinieron. Lanza ValueError con mensaje para el usuario.
    """
    salida: dict = {}
    if "tax_profile" in body:
        perfil = body.get("tax_profile") or None
        if not perfil_valido(perfil):
            raise ValueError(f"Perfil fiscal desconocido: {perfil}")
        salida["tax_profile"] = perfil
    if "ieps_units" in body:
        try:
            unidades = float(body.get("ieps_units") or 0)
        except (TypeError, ValueError):
            raise ValueError("Las unidades de IEPS deben ser un número")
        if unidades < 0:
            raise ValueError("Las unidades de IEPS no pueden ser negativas")
        salida["ieps_units"] = unidades
    if "sat_product_key" in body:
        clave = str(body.get("sat_product_key") or "").strip()
        if clave and not (len(clave) == 8 and clave.isdigit()):
            raise ValueError("La clave de producto SAT debe tener 8 dígitos")
        salida["sat_product_key"] = clave
    if "sat_unit_key" in body:
        salida["sat_unit_key"] = str(body.get("sat_unit_key") or "").strip() or SAT_UNIDAD_DEFAULT
    return salida
