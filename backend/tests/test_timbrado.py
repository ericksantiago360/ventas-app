"""
Timbrado SAT: CSD (subir, validar, revocar), sellado con XSLT del SAT, timbre con el PAC
(simulado), cancelación ante el SAT y XML timbrado. Para carta porte y factura.

El PAC se simula con un timbrado falso que verifica el Sello con la llave pública del CSD:
así la prueba confirma que el XML sellado es criptográficamente válido, no solo que existe.
"""
import asyncio
import base64
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.serialization import BestAvailableEncryption, Encoding, PrivateFormat
from cryptography.x509 import ObjectIdentifier
from cryptography.x509.oid import NameOID
from lxml import etree

from app.modules.timbrado import pac_sw_sapien
from app.modules.timbrado.csd_signer import cadena_original
from app.modules.timbrado.models.csd import leer_cer
from app.modules.timbrado.qr import url_verificacion
from app.modules.timbrado.cfdi_ingreso import clave_unidad

from .sat_xsd import CFDI, errores, esquema
from .test_carta_porte import N, URL, crear, en, nuevo_vehiculo, rfc_fisica, seguro
from .conftest import es_pdf, unico

CSD_URL = "/api/timbrado/csd"
FAC_URL = "/api/facturacion/facturas"
RFC = "SMA850101AB1"                  # RFC del emisor de las pruebas (mismo que test_carta_porte)
SERIE = "30001000000500003416"        # número de certificado de prueba (20 dígitos)
CLAVE = "clave-csd-prueba"
TFD = "http://www.sat.gob.mx/TimbreFiscalDigital"
OID_RFC = ObjectIdentifier("2.5.4.45")


def generar_csd(rfc=RFC, contrasena=CLAVE, dias=(-1, 365), llave=None, serie=SERIE):
    """Par .cer / .key de prueba con la forma de un CSD del SAT (RFC en x500UniqueIdentifier)."""
    llave = llave or rsa.generate_private_key(public_exponent=65537, key_size=2048)
    nombre = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "EMPRESA DE PRUEBA"),
        x509.NameAttribute(OID_RFC, f"{rfc} / ABCD123456"),
    ])
    ahora = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder()
            .subject_name(nombre).issuer_name(nombre)
            .public_key(llave.public_key())
            .serial_number(int.from_bytes(serie.encode("ascii"), "big"))
            .not_valid_before(ahora + timedelta(days=dias[0]))
            .not_valid_after(ahora + timedelta(days=dias[1]))
            .sign(llave, hashes.SHA256()))
    key = llave.private_bytes(Encoding.DER, PrivateFormat.PKCS8, BestAvailableEncryption(contrasena.encode()))
    return cert.public_bytes(Encoding.DER), key


def subir(client, headers, cer, key, contrasena=CLAVE, negocio="santal"):
    return client.post(CSD_URL, headers=headers, data={"negocio_id": negocio, "contrasena": contrasena},
                       files={"archivo_cer": ("csd.cer", cer, "application/pkix-cert"),
                              "archivo_key": ("csd.key", key, "application/octet-stream")})


def errores_factura(xml: bytes) -> list[str]:
    """Factura sin complemento: se valida contra cfdv40.xsd completo (sin el requisito de carta porte)."""
    schema = esquema("cfdv40.xsd")
    return [] if schema.validate(etree.ElementTree(etree.fromstring(xml))) else [e.message for e in schema.error_log]


def verificar_sello(xml: bytes) -> None:
    """Recalcula la cadena original y comprueba el Sello con la llave pública del Certificado del XML."""
    raiz = etree.fromstring(xml)
    certificado = x509.load_der_x509_certificate(base64.b64decode(raiz.get("Certificado")))
    assert raiz.get("NoCertificado") == SERIE
    certificado.public_key().verify(base64.b64decode(raiz.get("Sello")), cadena_original(xml).encode("utf-8"),
                                    padding.PKCS1v15(), hashes.SHA256())


@pytest.fixture
def pac(monkeypatch):
    """PAC simulado: verifica el sello, agrega el TimbreFiscalDigital y guarda los XML que recibe."""
    recibidos = []

    async def timbrar(xml_sellado: bytes) -> dict:
        verificar_sello(xml_sellado)
        recibidos.append(xml_sellado)
        raiz = etree.fromstring(xml_sellado)
        complemento = raiz.find(f"{{{CFDI}}}Complemento")
        if complemento is None:
            complemento = etree.SubElement(raiz, f"{{{CFDI}}}Complemento")
        uuid = str(uuid4()).upper()
        tfd = etree.SubElement(complemento, f"{{{TFD}}}TimbreFiscalDigital", nsmap={"tfd": TFD})
        for k, v in {"Version": "1.1", "UUID": uuid, "FechaTimbrado": "2026-10-21T12:00:00",
                     "SelloCFD": raiz.get("Sello"), "NoCertificadoSAT": "30001000000400002434",
                     "SelloSAT": "SELLOSATPRUEBA"}.items():
            tfd.set(k, v)
        xml = etree.tostring(raiz, encoding="UTF-8", xml_declaration=True).decode()
        return {**pac_sw_sapien.datos_tfd(xml), "xml_timbrado": xml}

    respuesta_cancelacion = {"estatus": "En proceso"}

    async def cancelar(rfc, uuid, motivo, folio_sustitucion=""):
        return dict(respuesta_cancelacion)

    monkeypatch.setattr(pac_sw_sapien, "timbrar", timbrar)
    monkeypatch.setattr(pac_sw_sapien, "cancelar", cancelar)

    class Pac:
        def __init__(self):
            self.recibidos = recibidos

        def responde(self, **datos):
            """Lo que responderá el PAC a la siguiente cancelación."""
            respuesta_cancelacion.clear()
            respuesta_cancelacion.update(datos)

    return Pac()


@pytest.fixture(scope="module", autouse=True)
def emisor(client, admin):
    r = client.put(f"{URL}/emisor", headers=admin, params=N, json={
        "rfc": RFC, "nombre": "Santal Machinery SA de CV", "regimen_fiscal": "601", "codigo_postal": "44100",
    })
    assert r.status_code == 200, r.text


@pytest.fixture
def csd_santal(client, admin):
    cer, key = generar_csd()
    r = subir(client, admin, cer, key)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def carta_lista(client, admin):
    vehiculo = client.post(f"{URL}/vehiculos", headers=admin,
                           json=nuevo_vehiculo(seguro_carga=seguro(nombre="Qualitas")))
    assert vehiculo.status_code == 201, vehiculo.text
    operador = client.post(f"{URL}/operadores", headers=admin, json={
        **N, "nombre": "Juan Pérez López", "rfc": rfc_fisica(), "num_licencia": unico("LF")[:16],
        "fecha_vencimiento_licencia": en(400)})
    assert operador.status_code == 201, operador.text
    c = crear(client, admin, vehiculo.json(), operador.json())
    r = client.put(f"{URL}/{c['id']}/estado", headers=admin, json={"estado": "listo", "nota": ""})
    assert r.status_code == 200, r.text
    return r.json()


# ── CSD ───────────────────────────────────────────────────────────────────────

def test_csd_subir_consultar_y_revocar(client, admin, csd_santal):
    assert csd_santal["no_certificado"] == SERIE
    assert csd_santal["rfc_emisor"] == RFC and csd_santal["activo"] is True
    assert "llave" not in str(csd_santal).lower() and CLAVE not in str(csd_santal)

    activo = client.get(CSD_URL, headers=admin, params={"negocio_id": "santal"})
    assert activo.status_code == 200 and activo.json()["no_certificado"] == SERIE

    assert client.delete(f"{CSD_URL}/{csd_santal['id']}", headers=admin).status_code == 200
    assert client.get(CSD_URL, headers=admin, params={"negocio_id": "santal"}).json() is None


def test_csd_nuevo_reemplaza_al_anterior(client, admin, csd_santal):
    cer, key = generar_csd(serie="30001000000500009999")
    r = subir(client, admin, cer, key)
    assert r.status_code == 201, r.text
    activo = client.get(CSD_URL, headers=admin, params={"negocio_id": "santal"}).json()
    assert activo["no_certificado"] == "30001000000500009999"


def test_csd_rechaza_datos_que_no_cuadran(client, admin):
    cer, key = generar_csd()
    otro_rfc, _ = generar_csd(rfc="AAA010101AAA")
    assert subir(client, admin, otro_rfc, key).status_code == 400          # RFC distinto al del negocio
    assert subir(client, admin, cer, key, contrasena="equivocada").status_code == 400
    otra_llave, otra_key = generar_csd()
    assert subir(client, admin, cer, otra_key).status_code == 400          # llave de otro certificado
    vencido, vencido_key = generar_csd(dias=(-400, -1))
    assert subir(client, admin, vencido, vencido_key).status_code == 400    # certificado vencido
    assert subir(client, admin, b"no es un certificado", key).status_code == 400


def test_csd_solo_admin_puede_subir_o_revocar(client, admin, solo_santal, csd_santal):
    cer, key = generar_csd()
    assert subir(client, solo_santal, cer, key).status_code == 403
    assert client.delete(f"{CSD_URL}/{csd_santal['id']}", headers=solo_santal).status_code == 403


def test_leer_cer_extrae_serie_rfc_y_vigencia():
    cer, _ = generar_csd()
    datos = leer_cer(cer)
    assert (datos["no_certificado"], datos["rfc"]) == (SERIE, RFC)
    assert datos["fecha_fin_vigencia"] > datos["fecha_inicio_vigencia"]


# ── Carta porte ───────────────────────────────────────────────────────────────

def test_carta_porte_timbrar_y_cancelar_ante_sat(client, admin, csd_santal, carta_lista, pac):
    url = f"{URL}/{carta_lista['id']}"
    r = client.post(f"{url}/timbrar", headers=admin)
    assert r.status_code == 200, r.text
    timbrado = r.json()["timbrado"]
    assert timbrado["uuid"] and timbrado["pac"] == "SW Sapien"
    assert r.json()["estado"] == "listo"
    assert errores(pac.recibidos[0]) == []             # el XML que llega al PAC es un CFDI válido

    xml = client.get(f"{url}/xml-timbrado", headers=admin)
    assert xml.status_code == 200 and timbrado["uuid"] in xml.text
    assert es_pdf(client.get(f"{url}/pdf", headers=admin))

    # Ya timbrada: no se timbra otra vez, no se cancela internamente ni regresa a borrador
    assert client.post(f"{url}/timbrar", headers=admin).status_code == 400
    assert client.post(f"{url}/cancelar", headers=admin, json={"motivo": "prueba"}).status_code == 400
    assert client.put(f"{url}/estado", headers=admin, json={"estado": "borrador", "nota": ""}).status_code == 400

    # SAT todavía no confirma: la carta sigue timbrada, con su estado
    pac.responde(estatus="En proceso")
    r = client.post(f"{url}/cancelar-timbre", headers=admin, json={"motivo": "02"})
    assert r.status_code == 200 and r.json()["estado"] == "listo"
    assert r.json()["timbrado"]["estado_sat"] == "En proceso"

    pac.responde(estatus="Cancelado")
    r = client.post(f"{url}/cancelar-timbre", headers=admin, json={"motivo": "02"})
    assert r.status_code == 200 and r.json()["estado"] == "cancelado"


def test_carta_porte_sin_csd_no_timbra(client, admin, carta_lista, pac):
    activo = client.get(CSD_URL, headers=admin, params={"negocio_id": "santal"}).json()
    if activo:
        client.delete(f"{CSD_URL}/{activo['id']}", headers=admin)
    r = client.post(f"{URL}/{carta_lista['id']}/timbrar", headers=admin)
    assert r.status_code == 400 and "CSD activo" in r.json()["detail"]


def test_carta_porte_solo_si_esta_lista(client, admin, csd_santal, pac):
    vehiculo = client.post(f"{URL}/vehiculos", headers=admin, json=nuevo_vehiculo(seguro_carga=seguro(nombre="Qualitas")))
    operador = client.post(f"{URL}/operadores", headers=admin, json={
        **N, "nombre": "Ana Ruiz", "rfc": rfc_fisica(), "num_licencia": unico("LF")[:16], "fecha_vencimiento_licencia": en(400)})
    borrador = crear(client, admin, vehiculo.json(), operador.json())
    r = client.post(f"{URL}/{borrador['id']}/timbrar", headers=admin)
    assert r.status_code == 400 and "lista" in r.json()["detail"]
    assert pac.recibidos == []


# ── Factura (CFDI de ingreso) ─────────────────────────────────────────────────

def factura_emitida(client, admin, **receptor):
    r = client.post(FAC_URL, headers=admin, json={
        "negocio_id": "santal",
        "receptor": {"nombre": "Público en general", "rfc": "XAXX010101000", **receptor},
        "conceptos": [{"descripcion": "Servicio de prueba", "cantidad": 2, "precio_unitario": 100,
                       "iva_tasa": 0.16, "unidad": "Servicio", "clave": ""}],
        "forma_pago": "01", "metodo_pago": "PUE", "emitir": True,
    })
    assert r.status_code == 201, r.text
    return r.json()


def test_factura_timbrar_y_cancelar_ante_sat(client, admin, csd_santal, pac):
    f = factura_emitida(client, admin)
    url = f"{FAC_URL}/{f['id']}"
    r = client.post(f"{url}/timbrar", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["uuid"] and r.json()["estado"] == "emitida"

    enviado = pac.recibidos[0]
    assert errores_factura(enviado) == []
    raiz = etree.fromstring(enviado)
    assert (raiz.get("SubTotal"), raiz.get("Total")) == ("200.00", "232.00")
    assert raiz.find(f"{{{CFDI}}}Impuestos").get("TotalImpuestosTrasladados") == "32.00"
    assert raiz.find(f"{{{CFDI}}}Receptor").get("Nombre") == "PUBLICO EN GENERAL"

    assert client.get(f"{url}/xml-timbrado", headers=admin).status_code == 200
    assert es_pdf(client.get(f"{url}/pdf", headers=admin))
    assert client.post(f"{url}/timbrar", headers=admin).status_code == 400
    assert client.post(f"{url}/cancelar", headers=admin, json={"motivo": "x"}).status_code == 400

    pac.responde(status="Cancelado")
    r = client.post(f"{url}/cancelar-timbre", headers=admin, json={"motivo": "02"})
    assert r.status_code == 200 and r.json()["estado"] == "cancelada"


def test_factura_receptor_con_rfc_sin_datos_fiscales(client, admin, csd_santal, pac):
    f = factura_emitida(client, admin, rfc="AAA010101AAA", nombre="Cliente Prueba")
    r = client.post(f"{FAC_URL}/{f['id']}/timbrar", headers=admin)
    assert r.status_code == 400 and "código postal" in r.json()["detail"]
    assert pac.recibidos == []


def test_factura_con_descuento_general_no_se_timbra(client, admin, csd_santal, pac):
    r = client.post(FAC_URL, headers=admin, json={
        "negocio_id": "santal", "receptor": {"nombre": "Público en general", "rfc": "XAXX010101000"},
        "conceptos": [{"descripcion": "Servicio", "cantidad": 1, "precio_unitario": 100, "iva_tasa": 0.16}],
        "descuento_general": 10, "emitir": True})
    fid = r.json()["id"]
    r = client.post(f"{FAC_URL}/{fid}/timbrar", headers=admin)
    assert r.status_code == 400 and "descuento general" in r.json()["detail"]


# ── Piezas sueltas ────────────────────────────────────────────────────────────

def test_url_de_verificacion_formato_sat():
    url = url_verificacion("AAAA-UUID", "SMA850101AB1", "XAXX010101000", 232, "XYZ12345ABCDEFGH")
    assert "tt=0000000232.000000" in url
    assert "fe=ABCDEFGH" in url
    assert "re=SMA850101AB1" in url and "rr=XAXX010101000" in url


def test_clave_unidad_de_texto_libre():
    assert clave_unidad("Servicio") == "E48"
    assert clave_unidad("pieza") == "H87"
    assert clave_unidad("E48") == "E48"
    assert clave_unidad("algo raro") == "H87"


# ── Cliente del PAC: respuestas del proveedor (sin red) ───────────────────────

def con_respuestas(monkeypatch, manejador):
    """Hace que el cliente HTTP del PAC use un transporte simulado con el manejador dado."""
    import httpx
    original = httpx.AsyncClient

    def fabrica(*args, **kwargs):
        return original(*args, transport=httpx.MockTransport(manejador), **kwargs)

    monkeypatch.setattr(pac_sw_sapien.httpx, "AsyncClient", fabrica)
    monkeypatch.setattr(pac_sw_sapien.settings, "SW_USER", "usuario@prueba.mx")
    monkeypatch.setattr(pac_sw_sapien.settings, "SW_PASSWORD", "no-importa")


def respuesta_json(codigo, cuerpo):
    import httpx
    return httpx.Response(codigo, json=cuerpo)


def test_pac_sin_credenciales_no_intenta_nada(monkeypatch):
    monkeypatch.setattr(pac_sw_sapien.settings, "SW_USER", "")
    with pytest.raises(pac_sw_sapien.ErrorPAC, match="SW_USER"):
        asyncio.run(pac_sw_sapien.timbrar(b"<x/>"))


def test_pac_falla_al_autenticar(monkeypatch):
    con_respuestas(monkeypatch, lambda req: respuesta_json(401, {"status": "error", "message": "Usuario inválido"}))
    with pytest.raises(pac_sw_sapien.ErrorPAC, match="No se pudo autenticar"):
        asyncio.run(pac_sw_sapien.timbrar(b"<x/>"))


def test_pac_rechaza_el_timbrado_sin_filtrar_el_xml(monkeypatch):
    def manejador(req):
        if req.url.path.endswith("/authenticate"):
            return respuesta_json(200, {"status": "success", "data": {"token": "tok"}})
        return respuesta_json(400, {"status": "error", "data": "RFC emisor no registrado", "message": "CFDI inválido"})

    con_respuestas(monkeypatch, manejador)
    with pytest.raises(pac_sw_sapien.ErrorPAC) as error:
        asyncio.run(pac_sw_sapien.timbrar(b"<cfdi:Comprobante>SECRETO</cfdi:Comprobante>"))
    assert "El PAC no timbró" in str(error.value)
    assert "SECRETO" not in str(error.value)


def test_pac_sin_conexion(monkeypatch):
    import httpx

    def manejador(req):
        raise httpx.ConnectError("sin red")

    con_respuestas(monkeypatch, manejador)
    with pytest.raises(pac_sw_sapien.ErrorPAC, match="No se pudo conectar"):
        asyncio.run(pac_sw_sapien.timbrar(b"<x/>"))


def test_pac_timbra_y_lee_el_tfd(monkeypatch):
    xml = (f'<cfdi:Comprobante xmlns:cfdi="{CFDI}"><cfdi:Complemento>'
           f'<tfd:TimbreFiscalDigital xmlns:tfd="{TFD}" UUID="ABC-123" FechaTimbrado="2026-10-21T09:00:00" '
           'SelloSAT="SAT==" NoCertificadoSAT="30001000000400002434"/></cfdi:Complemento></cfdi:Comprobante>')

    def manejador(req):
        if req.url.path.endswith("/authenticate"):
            return respuesta_json(200, {"status": "success", "data": {"token": "tok"}})
        assert req.headers["Authorization"] == "bearer tok"
        return respuesta_json(200, {"status": "success", "data": {"cfdi": xml}})

    con_respuestas(monkeypatch, manejador)
    resultado = asyncio.run(pac_sw_sapien.timbrar(b"<x/>"))
    assert resultado["uuid"] == "ABC-123" and resultado["sello_sat"] == "SAT=="
    assert resultado["xml_timbrado"] == xml


def test_pac_cancelacion_con_folio_de_sustitucion(monkeypatch):
    rutas = []

    def manejador(req):
        if req.url.path.endswith("/authenticate"):
            return respuesta_json(200, {"status": "success", "data": {"token": "tok"}})
        rutas.append(req.url.path)
        return respuesta_json(200, {"status": "success", "data": {"estatus": "Cancelado"}})

    con_respuestas(monkeypatch, manejador)
    datos = asyncio.run(pac_sw_sapien.cancelar("SMA850101AB1", "UUID-1", "01", "UUID-2"))
    assert datos == {"estatus": "Cancelado"}
    assert rutas == ["/cfdi33/cancel/SMA850101AB1/UUID-1/01/UUID-2"]
