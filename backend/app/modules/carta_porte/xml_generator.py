"""
XML del CFDI 4.0 de tipo Traslado con complemento Carta Porte 3.1 (traslado propio).

Sin sello, certificado ni timbre: Sello, NoCertificado y Certificado van vacíos y se
llenan al timbrar (app/modules/timbrado). Estructura y tipos siguen los XSD oficiales
(cfdv40.xsd y CartaPorte31.xsd); tests/test_carta_porte.py valida contra ellos.

Traslado propio: el negocio es emisor y receptor (UsoCFDI S01, sin efectos fiscales) y
los conceptos son las mercancías trasladadas, con valor 0 (Moneda XXX).
"""
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

from lxml import etree

from . import catalogos
from .fechas import local_sat

CFDI = "http://www.sat.gob.mx/cfd/4"
CP = "http://www.sat.gob.mx/CartaPorte31"
XSI = "http://www.w3.org/2001/XMLSchema-instance"
SCHEMA_LOCATION = (
    "http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd "
    "http://www.sat.gob.mx/CartaPorte31 http://www.sat.gob.mx/sitio_internet/cfd/CartaPorte/CartaPorte31.xsd"
)


def num(valor: float, decimales: int) -> str:
    """Decimal sin notación científica ni ceros sobrantes: 1250.500 → '1250.5'."""
    d = Decimal(str(valor)).quantize(Decimal(1).scaleb(-decimales), rounding=ROUND_HALF_UP)
    texto = format(d, "f")
    return texto.rstrip("0").rstrip(".") if "." in texto else texto


def peso_en(kg: float, unidad: str) -> float:
    return kg / catalogos.KG_POR_UNIDAD[unidad]


def _sub(padre, ns: str, nombre: str, **atributos) -> etree._Element:
    """Nodo con sus atributos en el orden dado; se omiten los vacíos (atributos opcionales)."""
    nodo = etree.SubElement(padre, f"{{{ns}}}{nombre}")
    for k, v in atributos.items():
        if v is not None and v != "":
            nodo.set(k, str(v))
    return nodo


def _domicilio(padre, d: dict) -> None:
    _sub(padre, CP, "Domicilio",
         Calle=d.get("calle"), NumeroExterior=d.get("num_exterior"), NumeroInterior=d.get("num_interior"),
         Colonia=d.get("colonia"), Localidad=d.get("localidad"), Referencia=d.get("referencia"),
         Municipio=d.get("municipio"), Estado=d["estado"], Pais=d.get("pais", "MEX"), CodigoPostal=d["codigo_postal"])


def generar_xml_carta_porte(doc: dict, fecha: datetime | None = None) -> str:
    emisor, origen = doc["emisor"], doc["origen"]
    destinos, mercancias = doc["destinos"], doc["mercancias"]
    v = doc["vehiculo_snapshot"]
    hay_peligroso = any(m.get("material_peligroso") for m in mercancias)

    comprobante = etree.Element(f"{{{CFDI}}}Comprobante", nsmap={"cfdi": CFDI, "cartaporte31": CP, "xsi": XSI})
    comprobante.set(f"{{{XSI}}}schemaLocation", SCHEMA_LOCATION)
    for k, val in {
        "Version": "4.0",
        "Serie": "CP",
        "Folio": doc["folio"].split("-")[-1],
        "Fecha": local_sat(fecha or datetime.now(timezone.utc)),
        "Sello": "",            # se llenan al sellar con el CSD
        "NoCertificado": "",
        "Certificado": "",
        "SubTotal": "0",
        "Moneda": "XXX",        # traslado: no aplica moneda
        "Total": "0",
        "TipoDeComprobante": "T",
        "Exportacion": "01",
        "LugarExpedicion": emisor["codigo_postal"],
    }.items():
        comprobante.set(k, val)

    _sub(comprobante, CFDI, "Emisor", Rfc=emisor["rfc"], Nombre=emisor["nombre"], RegimenFiscal=emisor["regimen_fiscal"])
    # Traslado propio: el receptor es el mismo negocio
    _sub(comprobante, CFDI, "Receptor", Rfc=emisor["rfc"], Nombre=emisor["nombre"],
         DomicilioFiscalReceptor=emisor["codigo_postal"], RegimenFiscalReceptor=emisor["regimen_fiscal"], UsoCFDI="S01")

    conceptos = _sub(comprobante, CFDI, "Conceptos")
    for m in mercancias:
        _sub(conceptos, CFDI, "Concepto", ClaveProdServ=m["bienes_transp"], Cantidad=num(m["cantidad"], 6),
             ClaveUnidad=m["clave_unidad"], Descripcion=m["descripcion"], ValorUnitario="0", Importe="0", ObjetoImp="01")

    complemento = _sub(comprobante, CFDI, "Complemento")
    cp = _sub(complemento, CP, "CartaPorte", Version="3.1", IdCCP=doc["id_ccp"], TranspInternac="No",
              TotalDistRec=num(sum(d["distancia_recorrida"] for d in destinos), 2))

    ubicaciones = _sub(cp, CP, "Ubicaciones")
    nodo = _sub(ubicaciones, CP, "Ubicacion", TipoUbicacion="Origen", IDUbicacion="OR000001",
                RFCRemitenteDestinatario=origen["rfc_remitente"], NombreRemitenteDestinatario=origen["nombre_remitente"],
                FechaHoraSalidaLlegada=local_sat(origen["fecha_hora_salida"]))
    _domicilio(nodo, origen["domicilio"])
    for i, d in enumerate(destinos, start=1):
        nodo = _sub(ubicaciones, CP, "Ubicacion", TipoUbicacion="Destino", IDUbicacion=f"DE{i:06d}",
                    RFCRemitenteDestinatario=d["rfc_destinatario"], NombreRemitenteDestinatario=d["nombre_destinatario"],
                    FechaHoraSalidaLlegada=local_sat(d["fecha_hora_llegada"]),
                    DistanciaRecorrida=num(d["distancia_recorrida"], 2))
        _domicilio(nodo, d["domicilio"])

    unidad = doc["unidad_peso"]
    nodo_merc = _sub(cp, CP, "Mercancias", PesoBrutoTotal=num(peso_en(doc["peso_bruto_total"], unidad), 3),
                     UnidadPeso=unidad, NumTotalMercancias=len(mercancias))
    for m in mercancias:
        peligroso = m.get("material_peligroso")
        merc = _sub(nodo_merc, CP, "Mercancia",
                    BienesTransp=m["bienes_transp"], Descripcion=m["descripcion"], Cantidad=num(m["cantidad"], 6),
                    ClaveUnidad=m["clave_unidad"],
                    MaterialPeligroso=None if peligroso is None else ("Sí" if peligroso else "No"),
                    CveMaterialPeligroso=m.get("cve_material_peligroso") if peligroso else None,
                    Embalaje=m.get("embalaje") if peligroso else None,
                    PesoEnKg=num(m["peso_kg"], 3),
                    ValorMercancia=None if m.get("valor_mercancia") is None else num(m["valor_mercancia"], 2),
                    Moneda=m.get("moneda") if m.get("valor_mercancia") is not None else None)
        if len(destinos) > 1:
            _sub(merc, CP, "CantidadTransporta", Cantidad=num(m["cantidad"], 6),
                 IDOrigen="OR000001", IDDestino=f"DE{m['destino']:06d}")

    auto = _sub(nodo_merc, CP, "Autotransporte", PermSCT=v["tipo_permiso_sct"], NumPermisoSCT=v["num_permiso_sct"])
    _sub(auto, CP, "IdentificacionVehicular", ConfigVehicular=v["config_vehicular"],
         PesoBrutoVehicular=num(v["peso_bruto_vehicular"], 2), PlacaVM=v["placa"], AnioModeloVM=v["anio_modelo"])
    rc, carga, ambiente = v["seguro_resp_civil"], v.get("seguro_carga"), v.get("seguro_medio_ambiente")
    _sub(auto, CP, "Seguros",
         AseguraRespCivil=rc["aseguradora"], PolizaRespCivil=rc["num_poliza"],
         # Medio ambiente solo aplica con material peligroso
         AseguraMedAmbiente=ambiente["aseguradora"] if ambiente and hay_peligroso else None,
         PolizaMedAmbiente=ambiente["num_poliza"] if ambiente and hay_peligroso else None,
         AseguraCarga=carga["aseguradora"] if carga else None,
         PolizaCarga=carga["num_poliza"] if carga else None)
    if v.get("remolques"):
        nodo_rem = _sub(auto, CP, "Remolques")
        for r in v["remolques"][:2]:
            _sub(nodo_rem, CP, "Remolque", SubTipoRem=r["subtipo"], Placa=r["placa"])

    figura = _sub(cp, CP, "FiguraTransporte")
    for op in doc["operadores"]:
        o = op["snapshot"]
        _sub(figura, CP, "TiposFigura", TipoFigura="01", RFCFigura=o["rfc"], NumLicencia=o["num_licencia"], NombreFigura=o["nombre"])

    return etree.tostring(comprobante, pretty_print=True, xml_declaration=True, encoding="UTF-8").decode()
