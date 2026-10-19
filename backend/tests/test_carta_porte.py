"""Carta Porte 3.1 (traslado propio): catálogos, flota, operadores, documento, XML contra el XSD del SAT y PDF."""
import random
import string
from datetime import timedelta

import pytest
from lxml import etree

from app.modules.carta_porte.fechas import hoy
from app.modules.carta_porte.xml_generator import num

from .conftest import es_pdf, unico
from .sat_xsd import CP, CFDI, errores

N = {"negocio_id": "santal"}
URL = "/api/carta-porte"
NS = {"cfdi": CFDI, "cp": CP}


def en(dias: int) -> str:
    # El "hoy" del negocio (ZONA_HORARIA), no el del servidor en UTC: de noche en México ya es mañana en UTC
    return (hoy() + timedelta(days=dias)).isoformat()


def placa() -> str:
    return unico("P")[-6:]          # 6 caracteres hexadecimales en mayúscula


def seguro(dias=365, nombre="GNP Seguros"):
    return {"aseguradora": nombre, "num_poliza": unico("POL"), "fecha_vencimiento": en(dias)}


def nuevo_vehiculo(**extra):
    return {**N, "nombre": unico("Camión"), "placa": placa(), "anio_modelo": 2021, "config_vehicular": "C2",
            "peso_bruto_vehicular": 8.5, "num_permiso_sct": "PRIV-001", "seguro_resp_civil": seguro(), **extra}


def rfc_fisica() -> str:
    """RFC de persona física con forma válida y distinto en cada llamada."""
    letras = "".join(random.choices(string.ascii_uppercase, k=4))
    return f"{letras}800101{''.join(random.choices(string.ascii_uppercase + string.digits, k=2))}{random.randint(0, 9)}"


@pytest.fixture(scope="module", autouse=True)
def emisor(client, admin):
    r = client.put(f"{URL}/emisor", headers=admin, params=N, json={
        "rfc": "SMA850101AB1", "nombre": "Santal Machinery SA de CV", "regimen_fiscal": "601", "codigo_postal": "44100",
    })
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def vehiculo(client, admin):
    r = client.post(f"{URL}/vehiculos", headers=admin, json=nuevo_vehiculo(seguro_carga=seguro(nombre="Qualitas")))
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def operador(client, admin):
    r = client.post(f"{URL}/operadores", headers=admin, json={
        **N, "nombre": "Juan Pérez López", "rfc": rfc_fisica(), "num_licencia": unico("LF")[:16], "fecha_vencimiento_licencia": en(400)})
    assert r.status_code == 201, r.text
    return r.json()


def cuerpo(vehiculo, operador, **extra):
    return {
        **N, "vehiculo_id": vehiculo["id"], "operador_ids": [operador["id"]],
        "origen": {"fecha_hora_salida": f"{en(1)}T08:00:00",
                   "domicilio": {"calle": "Av. Juárez", "num_exterior": "100", "codigo_postal": "44100", "colonia": "0003"}},
        "destinos": [{"distancia_recorrida": 540.5, "fecha_hora_llegada": f"{en(1)}T16:30:00",
                      "domicilio": {"calle": "Paseo de la Reforma", "num_exterior": "222", "codigo_postal": "06600", "colonia": "0930"}}],
        "mercancias": [{"bienes_transp": "31161500", "descripcion": "Tornillos de acero", "cantidad": 40,
                        "clave_unidad": "XBX", "peso_kg": 820.25, "valor_mercancia": 15000}],
        **extra,
    }


def crear(client, admin, vehiculo, operador, **extra):
    r = client.post(URL, headers=admin, json=cuerpo(vehiculo, operador, **extra))
    assert r.status_code == 201, r.text
    return r.json()


# ── Catálogos ─────────────────────────────────────────────────────────────────

def test_catalogos(client, admin):
    c = client.get(f"{URL}/catalogos", headers=admin).json()
    configs = {x["clave"] for x in c["config_autotransporte"]}
    assert {"VL", "C2", "T3S2"} <= configs and "VAN" not in configs and "PICKUP" not in configs
    permisos = {p["clave"]: p["descripcion"] for p in c["tipo_permiso"]}
    assert permisos["TPAF02"] == "Transporte privado de carga"
    assert {e["clave"] for e in c["estados"]} >= {"JAL", "CMX", "NLE"}

    prod = client.get(f"{URL}/catalogos/productos", headers=admin, params={"q": "tornillos"}).json()
    assert "31161500" in {p["clave"] for p in prod}
    assert client.get(f"{URL}/catalogos/productos", headers=admin, params={"q": "1510150"}).json()[0]["material_peligroso"] == "1"

    cp = client.get(f"{URL}/catalogos/codigo-postal/44100", headers=admin).json()
    assert (cp["estado"], cp["municipio_nombre"]) == ("JAL", "Guadalajara")
    assert cp["colonias"]
    assert client.get(f"{URL}/catalogos/codigo-postal/00000", headers=admin).status_code == 404
    assert client.get(f"{URL}/catalogos/material-peligroso", headers=admin, params={"q": "diesel"}).json()[0]["clave"] == "1202"


# ── Flota y operadores ────────────────────────────────────────────────────────

def test_vehiculo_validaciones(client, admin, vehiculo):
    # La placa se guarda como la pide el SAT: sin guiones ni espacios
    r = client.post(f"{URL}/vehiculos", headers=admin, json=nuevo_vehiculo(placa="JA-12 34X"))
    assert r.status_code == 201 and r.json()["placa"] == "JA1234X"
    assert client.post(f"{URL}/vehiculos", headers=admin, json=nuevo_vehiculo(placa="JA-1234-XYZ")).status_code == 422
    assert client.post(f"{URL}/vehiculos", headers=admin, json=nuevo_vehiculo(placa=vehiculo["placa"])).status_code == 409
    # Claves que no existen en el catálogo del SAT
    assert client.post(f"{URL}/vehiculos", headers=admin, json=nuevo_vehiculo(config_vehicular="VAN")).status_code == 422
    assert client.post(f"{URL}/vehiculos", headers=admin, json=nuevo_vehiculo(tipo_permiso_sct="TPAF99")).status_code == 422
    # Remolques según la configuración (columna "Remolque" del catálogo)
    assert client.post(f"{URL}/vehiculos", headers=admin, json=nuevo_vehiculo(config_vehicular="T3S2")).status_code == 422
    assert client.post(f"{URL}/vehiculos", headers=admin, json=nuevo_vehiculo(
        remolques=[{"subtipo": "CTR007", "placa": "45UZ8A"}])).status_code == 422          # C2 no lleva remolque
    r = client.post(f"{URL}/vehiculos", headers=admin, json=nuevo_vehiculo(
        config_vehicular="T3S2", peso_bruto_vehicular=41.5, remolques=[{"subtipo": "CTR007", "placa": "45-UZ-8A"}]))
    assert r.status_code == 201 and r.json()["remolques"][0]["placa"] == "45UZ8A"
    assert client.post(f"{URL}/vehiculos", headers=admin, json=nuevo_vehiculo(
        remolques=[{"subtipo": "CTR999", "placa": "45UZ8A"}], config_vehicular="VL")).status_code == 422


def test_vehiculo_editar_baja_y_alertas(client, admin, vehiculo):
    datos = {k: v for k, v in vehiculo.items() if k in nuevo_vehiculo()}
    r = client.put(f"{URL}/vehiculos/{vehiculo['id']}", headers=admin,
                   json={**datos, "nombre": "Camión 1 - Blanco", "seguro_resp_civil": seguro(10)})
    assert r.status_code == 200 and r.json()["nombre"] == "Camión 1 - Blanco"
    alertas = client.get(f"{URL}/vehiculos/alertas", headers=admin, params=N).json()
    assert vehiculo["id"] in {a["vehiculo_id"] for a in alertas if a["seguro"] == "Responsabilidad civil" and a["dias"] == 10}
    assert client.delete(f"{URL}/vehiculos/{vehiculo['id']}", headers=admin).status_code == 200
    assert vehiculo["id"] not in {v["id"] for v in client.get(f"{URL}/vehiculos", headers=admin, params=N).json()}
    # Registrar de nuevo la placa reactiva el vehículo
    r = client.post(f"{URL}/vehiculos", headers=admin, json={**datos, **N})
    assert r.status_code == 201 and r.json()["id"] == vehiculo["id"]


def test_operador(client, admin, operador):
    assert client.post(f"{URL}/operadores", headers=admin, json={**N, "nombre": "X", "rfc": operador["rfc"],
               "num_licencia": "LIC123456", "fecha_vencimiento_licencia": en(10)}).status_code == 409
    assert client.post(f"{URL}/operadores", headers=admin, json={**N, "nombre": "X", "rfc": "SMA850101AB1",
               "num_licencia": "LIC123456", "fecha_vencimiento_licencia": en(10)}).status_code == 422   # RFC de persona moral
    assert client.post(f"{URL}/operadores", headers=admin, json={**N, "nombre": "X", "rfc": rfc_fisica(),
               "num_licencia": "L12", "fecha_vencimiento_licencia": en(10)}).status_code == 422          # licencia muy corta
    datos = {k: operador[k] for k in ("nombre", "rfc", "curp", "num_licencia", "tipo_licencia", "telefono")}
    r = client.put(f"{URL}/operadores/{operador['id']}", headers=admin, json={**datos, "fecha_vencimiento_licencia": en(-3)})
    assert r.status_code == 200 and r.json()["dias_licencia"] == -3
    assert operador["id"] in {a["operador_id"] for a in client.get(f"{URL}/operadores/alertas", headers=admin, params=N).json()}
    assert client.get(f"{URL}/alertas", headers=admin, params=N).json()["total"] >= 1


# ── Carta porte ───────────────────────────────────────────────────────────────

def test_crear_y_xml_valido_contra_xsd(client, admin, vehiculo, operador, emisor):
    c = crear(client, admin, vehiculo, operador)
    assert c["folio"].startswith("CP-") and c["estado"] == "borrador"
    assert c["id_ccp"].startswith("CCC") and len(c["id_ccp"]) == 36
    assert c["peso_bruto_total"] == 820.25 and c["total_dist_rec"] == 540.5
    # Traslado propio: remitente y destinatario son el negocio
    assert c["origen"]["rfc_remitente"] == emisor["rfc"] == c["destinos"][0]["rfc_destinatario"]
    # El domicilio se completa con el código postal
    assert c["destinos"][0]["domicilio"]["estado"] == "CMX" and c["destinos"][0]["domicilio"]["municipio"] == "015"

    xml = client.get(f"{URL}/{c['id']}/xml", headers=admin)
    assert xml.status_code == 200 and "sin-timbre" in xml.headers["content-disposition"]
    assert errores(xml.content) == []

    raiz = etree.fromstring(xml.content)
    assert raiz.get("TipoDeComprobante") == "T" and raiz.get("Moneda") == "XXX" and raiz.get("Total") == "0"
    assert raiz.find("cfdi:Receptor", NS).get("Rfc") == emisor["rfc"]
    assert raiz.find("cfdi:Receptor", NS).get("UsoCFDI") == "S01"
    concepto = raiz.find("cfdi:Conceptos/cfdi:Concepto", NS)
    assert concepto.get("ClaveProdServ") == "31161500"                # el concepto es la mercancía
    origen = raiz.find(".//cp:Ubicacion[@TipoUbicacion='Origen']", NS)
    assert origen.get("FechaHoraSalidaLlegada") == f"{en(1)}T08:00:00"  # hora local, no UTC
    ident = raiz.find(".//cp:Autotransporte/cp:IdentificacionVehicular", NS)
    assert (ident.get("ConfigVehicular"), ident.get("PesoBrutoVehicular"), ident.get("PlacaVM")) == ("C2", "8.5", vehiculo["placa"])
    seguros = raiz.find(".//cp:Seguros", NS)
    assert seguros.get("AseguraCarga") == "Qualitas" and seguros.get("AseguraMedAmbiente") is None
    assert raiz.find(".//cp:TiposFigura", NS).get("NumLicencia") == operador["num_licencia"]

    pdf = client.get(f"{URL}/{c['id']}/pdf", headers=admin)
    assert es_pdf(pdf)


def test_varios_destinos_remolque_y_material_peligroso(client, admin, operador):
    v = client.post(f"{URL}/vehiculos", headers=admin, json=nuevo_vehiculo(
        config_vehicular="T3S2", peso_bruto_vehicular=41.5, remolques=[{"subtipo": "CTR007", "placa": "45UZ8A"}],
        seguro_medio_ambiente=seguro(nombre="AXA Seguros"))).json()
    destinos = [
        {"distancia_recorrida": 540.5, "fecha_hora_llegada": f"{en(1)}T16:30:00", "domicilio": {"codigo_postal": "06600"}},
        {"distancia_recorrida": 130, "fecha_hora_llegada": f"{en(2)}T10:00:00", "domicilio": {"codigo_postal": "72000"},
         "nombre_destinatario": "Sucursal Puebla"},
    ]
    mercancias = [
        {"bienes_transp": "31161500", "descripcion": "Tornillos", "cantidad": 40, "clave_unidad": "XBX", "peso_kg": 800, "destino": 1},
        {"bienes_transp": "15101505", "descripcion": "Diésel", "cantidad": 200, "clave_unidad": "LTR", "peso_kg": 170,
         "cve_material_peligroso": "1202", "embalaje": "1A1", "destino": 2},
    ]
    # Con varios destinos, cada mercancía dice a cuál va
    sin_destino = [{**m, "destino": None} for m in mercancias]
    assert client.post(URL, headers=admin, json=cuerpo(v, operador, destinos=destinos, mercancias=sin_destino)).status_code == 422
    # Diésel es material peligroso según el catálogo: sin clave ni embalaje no pasa
    incompleto = [mercancias[0], {**mercancias[1], "cve_material_peligroso": ""}]
    assert client.post(URL, headers=admin, json=cuerpo(v, operador, destinos=destinos, mercancias=incompleto)).status_code == 422

    c = crear(client, admin, v, operador, destinos=destinos, mercancias=mercancias, unidad_peso="TNE")
    assert c["mercancias"][1]["material_peligroso"] is True and c["mercancias"][0]["material_peligroso"] is None
    xml = client.get(f"{URL}/{c['id']}/xml", headers=admin).content
    assert errores(xml) == []
    raiz = etree.fromstring(xml)
    assert raiz.find(".//cp:CartaPorte", NS).get("TotalDistRec") == "670.5"
    assert raiz.find(".//cp:Mercancias", NS).get("PesoBrutoTotal") == "0.97"        # 970 kg en toneladas
    assert [t.get("IDDestino") for t in raiz.findall(".//cp:CantidadTransporta", NS)] == ["DE000001", "DE000002"]
    assert len(raiz.findall(".//cp:Remolques", NS)) == 1                                # un solo nodo Remolques
    assert raiz.find(".//cp:Seguros", NS).get("AseguraMedAmbiente") == "AXA Seguros"
    assert raiz.findall(".//cp:Mercancia", NS)[1].get("MaterialPeligroso") == "Sí"
    assert es_pdf(client.get(f"{URL}/{c['id']}/pdf", headers=admin))


def test_material_peligroso_requiere_seguro_ambiental(client, admin, vehiculo, operador):
    merc = [{"bienes_transp": "15101505", "descripcion": "Diésel", "cantidad": 200, "clave_unidad": "LTR",
             "peso_kg": 170, "cve_material_peligroso": "1202", "embalaje": "1A1"}]
    r = client.post(URL, headers=admin, json=cuerpo(vehiculo, operador, mercancias=merc))
    assert r.status_code == 400 and "medio ambiente" in r.json()["detail"]


def test_validaciones_documento(client, admin, vehiculo, operador):
    base = cuerpo(vehiculo, operador)
    llega_antes = {**base, "destinos": [{**base["destinos"][0], "fecha_hora_llegada": f"{en(1)}T07:00:00"}]}
    assert client.post(URL, headers=admin, json=llega_antes).status_code == 422
    cp_inexistente = {**base, "destinos": [{**base["destinos"][0], "domicilio": {"codigo_postal": "00000"}}]}
    assert client.post(URL, headers=admin, json=cp_inexistente).status_code == 422
    colonia_ajena = {**base, "destinos": [{**base["destinos"][0], "domicilio": {"codigo_postal": "06600", "colonia": "0003"}}]}
    assert client.post(URL, headers=admin, json=colonia_ajena).status_code == 422
    clave_mala = {**base, "mercancias": [{**base["mercancias"][0], "bienes_transp": "99999999"}]}
    assert client.post(URL, headers=admin, json=clave_mala).status_code == 422
    peligroso_falso = {**base, "mercancias": [{**base["mercancias"][0], "material_peligroso": True}]}
    assert client.post(URL, headers=admin, json=peligroso_falso).status_code == 422


def test_editar_estados_y_vigencias(client, admin, vehiculo, operador):
    c = crear(client, admin, vehiculo, operador)
    url = f"{URL}/{c['id']}"
    nuevo = cuerpo(vehiculo, operador, observaciones="Entregar en andén 3")
    nuevo["mercancias"][0]["cantidad"] = 50
    r = client.put(url, headers=admin, json=nuevo)
    assert r.status_code == 200 and r.json()["mercancias"][0]["cantidad"] == 50
    assert 'Cantidad="50"' in client.get(f"{url}/xml", headers=admin).text

    assert client.put(f"{url}/estado", headers=admin, json={"estado": "entregado"}).status_code == 400   # salto no permitido

    # Licencia vencida al día de salida: no puede pasar a "listo"
    datos = {k: operador[k] for k in ("nombre", "rfc", "curp", "num_licencia", "tipo_licencia", "telefono")}
    client.put(f"{URL}/operadores/{operador['id']}", headers=admin, json={**datos, "fecha_vencimiento_licencia": en(0)})
    r = client.put(f"{url}/estado", headers=admin, json={"estado": "listo"})
    assert r.status_code == 400 and "licencia" in r.json()["detail"]
    client.put(f"{URL}/operadores/{operador['id']}", headers=admin, json={**datos, "fecha_vencimiento_licencia": en(200)})

    for estado in ("listo", "en_transito"):
        r = client.put(f"{url}/estado", headers=admin, json={"estado": estado})
        assert r.status_code == 200 and r.json()["estado"] == estado, r.text
    assert client.put(url, headers=admin, json=nuevo).status_code == 400            # ya no es borrador
    # Un vehículo o un operador en tránsito no se dan de baja
    assert client.delete(f"{URL}/vehiculos/{vehiculo['id']}", headers=admin).status_code == 400
    assert client.delete(f"{URL}/operadores/{operador['id']}", headers=admin).status_code == 400
    r = client.put(f"{url}/estado", headers=admin, json={"estado": "entregado", "nota": "Recibió almacén"})
    assert [h["estado"] for h in r.json()["historial"]] == ["borrador", "listo", "en_transito", "entregado"]
    assert client.post(f"{url}/cancelar", headers=admin, json={"motivo": "x"}).status_code == 400


def test_cancelar_listar_y_filtrar(client, admin, vehiculo, operador):
    c = crear(client, admin, vehiculo, operador)
    assert client.post(f"{URL}/{c['id']}/cancelar", headers=admin, json={"motivo": ""}).status_code == 422
    r = client.post(f"{URL}/{c['id']}/cancelar", headers=admin, json={"motivo": "Se pospuso el envío"})
    assert r.status_code == 200 and r.json()["estado"] == "cancelado"
    assert es_pdf(client.get(f"{URL}/{c['id']}/pdf", headers=admin))
    assert client.put(f"{URL}/{c['id']}/estado", headers=admin, json={"estado": "listo"}).status_code == 400

    lista = client.get(URL, headers=admin, params={**N, "estado": "cancelado"}).json()
    assert c["id"] in {x["id"] for x in lista["items"]} and "xml_interno" not in lista["items"][0]
    por_operador = client.get(URL, headers=admin, params={**N, "operador_id": operador["id"]}).json()
    assert c["id"] in {x["id"] for x in por_operador["items"]}
    por_fecha = client.get(URL, headers=admin, params={**N, "desde": en(1), "hasta": en(1)}).json()
    assert c["id"] in {x["id"] for x in por_fecha["items"]}
    assert c["id"] not in {x["id"] for x in client.get(URL, headers=admin, params={**N, "desde": en(5)}).json()["items"]}
    assert c["id"] in {x["id"] for x in client.get(URL, headers=admin, params={**N, "q": c["folio"]}).json()["items"]}


def test_sin_emisor_configurado(client, admin):
    v = client.post(f"{URL}/vehiculos", headers=admin, json={**nuevo_vehiculo(), "negocio_id": "dulce_tentacion"}).json()
    o = client.post(f"{URL}/operadores", headers=admin, json={"negocio_id": "dulce_tentacion", "nombre": "Ana",
                    "rfc": rfc_fisica(), "num_licencia": "LIC123456", "fecha_vencimiento_licencia": en(100)}).json()
    r = client.post(URL, headers=admin, json={**cuerpo(v, o), "negocio_id": "dulce_tentacion"})
    assert r.status_code == 400 and "datos fiscales" in r.json()["detail"]
    propuesta = client.get(f"{URL}/emisor", headers=admin, params={"negocio_id": "dulce_tentacion"}).json()
    assert propuesta["configurado"] is False
    # Régimen de persona física con RFC de persona moral
    r = client.put(f"{URL}/emisor", headers=admin, params={"negocio_id": "dulce_tentacion"},
                   json={"rfc": "DTE850101AB1", "nombre": "Dulce", "regimen_fiscal": "612", "codigo_postal": "44100"})
    assert r.status_code == 422


def test_vehiculo_de_otro_negocio(client, admin, operador):
    ajeno = client.post(f"{URL}/vehiculos", headers=admin, json={**nuevo_vehiculo(), "negocio_id": "bienes_raices"}).json()
    r = client.post(URL, headers=admin, json=cuerpo(ajeno, operador))
    assert r.status_code == 404


def test_sin_acceso_al_negocio(client, admin, solo_santal, vehiculo, operador):
    c = crear(client, admin, vehiculo, operador)
    otro = {"negocio_id": "dulce_tentacion"}
    assert client.get(URL, headers=solo_santal, params=otro).status_code == 403
    assert client.get(f"{URL}/vehiculos", headers=solo_santal, params=otro).status_code == 403
    assert client.get(f"{URL}/emisor", headers=solo_santal, params=otro).status_code == 403
    d = client.post(URL, headers=admin, json=cuerpo(vehiculo, operador)).json()
    # solo_santal sí ve los de Santal, pero no los de otro negocio
    assert client.get(f"{URL}/{d['id']}", headers=solo_santal).status_code == 200
    ajeno = client.post(f"{URL}/vehiculos", headers=admin, json={**nuevo_vehiculo(), "negocio_id": "dulce_tentacion"}).json()
    assert client.get(f"{URL}/vehiculos/{ajeno['id']}", headers=solo_santal).status_code == 403
    assert client.put(f"{URL}/vehiculos/{ajeno['id']}", headers=solo_santal, json=nuevo_vehiculo()).status_code == 403
    assert client.delete(f"{URL}/vehiculos/{ajeno['id']}", headers=solo_santal).status_code == 403


def test_licencia_segun_vehiculo_y_carga():
    from app.modules.carta_porte.catalogos import doblemente_articulado, problema_de_licencia
    assert doblemente_articulado("T3S2R4") and doblemente_articulado("T3S2S2") and not doblemente_articulado("T3S2")
    assert problema_de_licencia("B", "T3S2", False) == ""
    assert "E" in problema_de_licencia("B", "T3S2R4", False)
    assert "peligroso" in problema_de_licencia("B", "C2", True)
    assert problema_de_licencia("E", "T3S2S2", True) == ""
    assert "2 o 3 ejes" in problema_de_licencia("C", "T3S2", False) and problema_de_licencia("C", "C3", False) == ""
    assert "pasajeros" in problema_de_licencia("A", "C2", False)
    assert problema_de_licencia("ESTATAL", "VL", False) == "" and problema_de_licencia("ESTATAL", "C2", False)


def test_licencia_que_no_ampara_bloquea_listo(client, admin, vehiculo, operador):
    c = crear(client, admin, vehiculo, operador)            # vehículo C2, licencia B: válido
    datos = {k: operador[k] for k in ("nombre", "rfc", "curp", "num_licencia", "fecha_vencimiento_licencia", "telefono")}
    client.put(f"{URL}/operadores/{operador['id']}", headers=admin, json={**datos, "tipo_licencia": "A"})
    r = client.put(f"{URL}/{c['id']}/estado", headers=admin, json={"estado": "listo"})
    assert r.status_code == 400 and "pasajeros" in r.json()["detail"]
    client.put(f"{URL}/operadores/{operador['id']}", headers=admin, json={**datos, "tipo_licencia": "C"})
    assert client.put(f"{URL}/{c['id']}/estado", headers=admin, json={"estado": "listo"}).status_code == 200


def test_formato_numerico():
    assert num(1250.500, 3) == "1250.5" and num(8, 2) == "8" and num(0.1 + 0.2, 2) == "0.3" and num(1e-7, 6) == "0"
