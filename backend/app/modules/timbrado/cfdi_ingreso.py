"""
CFDI 4.0 de ingreso (factura) a partir de una factura interna. Sin sello: el sellado y el
timbre los pone timbrado/servicio.py. Estructura según cfdv40.xsd (tests/test_timbrado.py).

Alcance: MXN, IVA por concepto (0% o 16%) y descuentos por concepto. El descuento general
no se reparte entre los conceptos, así que se rechaza al timbrar en lugar de timbrar mal.
"""
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException
from lxml import etree

from app.modules.carta_porte import catalogos
from app.modules.carta_porte.fechas import local_sat
from app.modules.carta_porte.xml_generator import num

CFDI = "http://www.sat.gob.mx/cfd/4"
XSI = "http://www.w3.org/2001/XMLSchema-instance"
SCHEMA_LOCATION = "http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd"

RFC_PUBLICO_GENERAL = "XAXX010101000"
NOMBRE_PUBLICO_GENERAL = "PUBLICO EN GENERAL"
REGIMEN_PUBLICO_GENERAL = "616"            # Sin obligaciones fiscales
CLAVE_PROD_SERV_GENERICA = "01010101"      # No existe en el catálogo
IVA = "002"

# Unidades de texto libre (como se capturan en la factura) a su c_ClaveUnidad
UNIDADES_LIBRES = {
    "servicio": "E48", "pieza": "H87", "pza": "H87", "unidad": "H87", "hora": "HUR", "dia": "DAY",
    "kilo": "KGM", "kg": "KGM", "litro": "LTR", "caja": "XBX",
}


def clave_unidad(unidad: str) -> str:
    texto = (unidad or "").strip()
    if texto.upper() in catalogos.clave_unidad():
        return texto.upper()
    return UNIDADES_LIBRES.get(catalogos.normalizar(texto), "H87")


def _dec(valor) -> Decimal:
    return Decimal(str(valor or 0))


def _redondear(valor: Decimal) -> Decimal:
    return valor.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def monto(valor: Decimal) -> str:
    """Importe en pesos con dos decimales, como lo imprime el SAT: 200.00"""
    return f"{_redondear(valor):.2f}"


def _receptor(factura: dict, emisor: dict) -> dict:
    r = factura["receptor"]
    if r["rfc"] == RFC_PUBLICO_GENERAL:
        return {"rfc": RFC_PUBLICO_GENERAL, "nombre": NOMBRE_PUBLICO_GENERAL, "cp": emisor["codigo_postal"],
                "regimen": REGIMEN_PUBLICO_GENERAL, "uso": "S01"}

    faltan = [etiqueta for etiqueta, valor in (("nombre", r.get("nombre")), ("código postal", r.get("cp")),
                                               ("régimen fiscal", r.get("regimen_fiscal"))) if not (valor or "").strip()]
    if faltan:
        raise HTTPException(400, f"Para timbrar faltan datos del receptor: {', '.join(faltan)}")
    if not catalogos.codigo_postal(r["cp"].strip()):
        raise HTTPException(400, f"El código postal del receptor ({r['cp']}) no existe en el catálogo del SAT")
    if r["regimen_fiscal"] not in catalogos.regimen_fiscal():
        raise HTTPException(400, f"El régimen fiscal del receptor ({r['regimen_fiscal']}) no existe en el catálogo del SAT")
    return {"rfc": r["rfc"], "nombre": r["nombre"].strip().upper(), "cp": r["cp"].strip(),
            "regimen": r["regimen_fiscal"], "uso": r.get("uso_cfdi") or "S01"}


def generar_cfdi_ingreso(factura: dict, emisor: dict, fecha: datetime) -> bytes:
    if factura.get("moneda", "MXN") != "MXN":
        raise HTTPException(400, "Por ahora solo se timbran facturas en pesos (MXN)")
    if float(factura.get("descuento_general") or 0) > 0:
        raise HTTPException(400, "Esta factura tiene descuento general; por ahora solo se timbran descuentos por concepto")
    if not factura.get("conceptos"):
        raise HTTPException(400, "La factura no tiene conceptos")

    receptor = _receptor(factura, emisor)
    metodo = factura.get("metodo_pago", "PUE")
    # SAT: con pago en parcialidades (PPD) la forma de pago es 99 (por definir)
    forma = "99" if metodo == "PPD" else factura.get("forma_pago", "01")

    conceptos_xml, traslados = [], {}
    subtotal = descuento = iva_total = Decimal("0")
    for c in factura["conceptos"]:
        base = _redondear(_dec(c["importe"]))                      # ya con descuento por concepto
        importe = _redondear(_dec(c["cantidad"]) * _dec(c["precio_unitario"]))
        desc = importe - base
        tasa = _dec(c.get("iva_tasa"))
        iva = _redondear(_dec(c["iva_importe"]))
        subtotal += importe
        descuento += desc
        iva_total += iva
        acumulado = traslados.setdefault(tasa, [Decimal("0"), Decimal("0")])
        acumulado[0] += base
        acumulado[1] += iva
        conceptos_xml.append((c, importe, desc, base, tasa, iva))

    total = subtotal - descuento + iva_total

    comprobante = etree.Element(f"{{{CFDI}}}Comprobante", nsmap={"cfdi": CFDI, "xsi": XSI})
    comprobante.set(f"{{{XSI}}}schemaLocation", SCHEMA_LOCATION)
    serie = factura.get("serie") or ""
    atributos = {
        "Version": "4.0",
        "Serie": serie,
        "Folio": str(int(factura["numero"])),
        "Fecha": local_sat(fecha),
        "Sello": "",
        "NoCertificado": "",
        "Certificado": "",
        "SubTotal": monto(subtotal),
        "Descuento": monto(descuento) if descuento > 0 else None,
        "Moneda": "MXN",
        "Total": monto(total),
        "TipoDeComprobante": "I",
        "Exportacion": "01",
        "MetodoPago": metodo,
        "FormaPago": forma,
        "LugarExpedicion": emisor["codigo_postal"],
    }
    for k, v in atributos.items():
        if v is not None:
            comprobante.set(k, v)

    _sub(comprobante, "Emisor", Rfc=emisor["rfc"], Nombre=emisor["nombre"], RegimenFiscal=emisor["regimen_fiscal"])
    _sub(comprobante, "Receptor", Rfc=receptor["rfc"], Nombre=receptor["nombre"],
         DomicilioFiscalReceptor=receptor["cp"], RegimenFiscalReceptor=receptor["regimen"], UsoCFDI=receptor["uso"])

    nodo_conceptos = _sub(comprobante, "Conceptos")
    for c, importe, desc, base, tasa, iva in conceptos_xml:
        texto_unidad = (c.get("unidad") or "").strip()
        # Unidad (texto libre) solo va si no es una clave del catálogo
        unidad_libre = None if texto_unidad.upper() in catalogos.clave_unidad() else texto_unidad
        concepto = _sub(nodo_conceptos, "Concepto",
                        ClaveProdServ=(c.get("clave") or "").strip() or CLAVE_PROD_SERV_GENERICA,
                        Cantidad=num(c["cantidad"], 6), ClaveUnidad=clave_unidad(texto_unidad),
                        Unidad=unidad_libre, Descripcion=c["descripcion"].strip(),
                        ValorUnitario=num(c["precio_unitario"], 6),
                        Importe=monto(importe), Descuento=monto(desc) if desc > 0 else None, ObjetoImp="02")
        impuestos = _sub(concepto, "Impuestos")
        traslados_c = _sub(impuestos, "Traslados")
        _sub(traslados_c, "Traslado", Base=monto(base), Impuesto=IVA, TipoFactor="Tasa",
             TasaOCuota=f"{tasa:.6f}", Importe=monto(iva))

    impuestos = _sub(comprobante, "Impuestos", TotalImpuestosTrasladados=monto(iva_total))
    nodo_traslados = _sub(impuestos, "Traslados")
    for tasa, (base, iva) in sorted(traslados.items()):
        _sub(nodo_traslados, "Traslado", Base=monto(base), Impuesto=IVA, TipoFactor="Tasa",
             TasaOCuota=f"{tasa:.6f}", Importe=monto(iva))

    return etree.tostring(comprobante, pretty_print=True, xml_declaration=True, encoding="UTF-8")


def _sub(padre, nombre: str, **atributos) -> etree._Element:
    nodo = etree.SubElement(padre, f"{{{CFDI}}}{nombre}")
    for k, v in atributos.items():
        if v is not None and v != "":
            nodo.set(k, str(v))
    return nodo
