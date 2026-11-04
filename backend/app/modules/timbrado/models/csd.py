"""
Certificado de Sello Digital (CSD) del negocio. Colección `csd_negocios`: negocio_id,
no_certificado (20 dígitos), certificado_b64 (.cer en base64, va en el XML), llave_privada_enc
y contrasena_enc (cifradas con crypto_utils), rfc_emisor, fecha_inicio_vigencia,
fecha_fin_vigencia, activo, created_at. Un solo CSD activo por negocio; los anteriores se archivan.

Aquí se valida el par .cer + .key + contraseña antes de guardarlo. Nunca se devuelve la
llave ni la contraseña: a_respuesta solo expone datos públicos del certificado.
"""
import base64
import re
from datetime import datetime, timedelta, timezone

from cryptography import x509
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import Encoding, load_der_private_key
from cryptography.x509 import ObjectIdentifier
from fastapi import HTTPException

# x500UniqueIdentifier (2.5.4.45): aquí el SAT pone el RFC del titular del certificado
OID_RFC = ObjectIdentifier("2.5.4.45")
RFC_EN_TEXTO = re.compile(r"[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}")
AVISO_VENCIMIENTO = timedelta(days=30)


def aware(dt: datetime) -> datetime:
    """Mongo devuelve fechas sin zona horaria; se guardan en UTC."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def leer_cer(cer: bytes) -> dict:
    """Datos del certificado: número de serie tal como va en el XML, RFC del titular y vigencia."""
    try:
        cert = x509.load_der_x509_certificate(cer)
    except ValueError:
        raise HTTPException(400, "El archivo .cer no es un certificado válido")

    rfc = None
    for atributo in cert.subject:
        if atributo.oid == OID_RFC and (m := RFC_EN_TEXTO.search(str(atributo.value))):
            rfc = m.group(0)
            break
    if not rfc:
        raise HTTPException(400, "El certificado no trae el RFC del titular")

    # NoCertificado: los bytes del número de serie leídos como texto (el SAT los emite como dígitos ASCII)
    serie = cert.serial_number.to_bytes((cert.serial_number.bit_length() + 7) // 8, "big")
    try:
        no_certificado = serie.decode("ascii")
    except UnicodeDecodeError:
        raise HTTPException(400, "El número de serie del certificado no es válido")
    if not re.fullmatch(r"\d{20}", no_certificado):
        raise HTTPException(400, "El número de serie del certificado debe tener 20 dígitos")

    inicio, fin = cert.not_valid_before_utc, cert.not_valid_after_utc
    if fin <= datetime.now(timezone.utc):
        raise HTTPException(400, f"El certificado venció el {fin:%d/%m/%Y}")

    return {
        "cert": cert,
        "no_certificado": no_certificado,
        "rfc": rfc,
        "fecha_inicio_vigencia": inicio,
        "fecha_fin_vigencia": fin,
    }


def leer_llave(key: bytes, contrasena: str, cert: x509.Certificate) -> rsa.RSAPrivateKey:
    """Abre la llave privada y comprueba que corresponde al certificado."""
    try:
        llave = load_der_private_key(key, password=contrasena.encode())
    except (ValueError, TypeError):
        raise HTTPException(400, "La contraseña no abre la llave privada, o el archivo .key no es válido")
    if not isinstance(llave, rsa.RSAPrivateKey):
        raise HTTPException(400, "La llave privada debe ser RSA")
    if llave.public_key().public_numbers() != cert.public_key().public_numbers():
        raise HTTPException(400, "La llave privada no corresponde al certificado")
    return llave


def certificado_b64(cert: x509.Certificate) -> str:
    """Atributo Certificado del XML: el .cer en DER, en base64 y sin saltos de línea."""
    return base64.b64encode(cert.public_bytes(Encoding.DER)).decode()


def a_respuesta(doc: dict | None) -> dict | None:
    if not doc:
        return None
    fin = aware(doc["fecha_fin_vigencia"])
    return {
        "id":                    str(doc["_id"]),
        "no_certificado":        doc["no_certificado"],
        "rfc_emisor":            doc["rfc_emisor"],
        "fecha_inicio_vigencia": doc["fecha_inicio_vigencia"],
        "fecha_fin_vigencia":    doc["fecha_fin_vigencia"],
        "vence_pronto":          fin - datetime.now(timezone.utc) <= AVISO_VENCIMIENTO,
        "vencido":               fin <= datetime.now(timezone.utc),
        "activo":                doc.get("activo", False),
    }
