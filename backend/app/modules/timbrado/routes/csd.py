"""
Certificado de Sello Digital por negocio. Solo un administrador sube o revoca el CSD;
cualquiera con acceso al negocio puede consultar su estado (nunca la llave).
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.core.database import get_db
from app.core.negocios import negocio_autorizado, obtener_del_negocio, verificar_acceso
from app.core.security import require_admin

from ..crypto_utils import cifrar
from ..models.csd import a_respuesta, certificado_b64, leer_cer, leer_llave
from ..servicio import emisor_fiscal

router = APIRouter(prefix="/timbrado/csd", tags=["Timbrado"])

TAMANO_MAXIMO = 64 * 1024   # un .cer o .key real pesa unos cuantos cientos de bytes


async def leer_archivo(archivo: UploadFile, nombre: str) -> bytes:
    datos = await archivo.read(TAMANO_MAXIMO + 1)
    if not datos:
        raise HTTPException(400, f"Falta el archivo {nombre}")
    if len(datos) > TAMANO_MAXIMO:
        raise HTTPException(400, f"El archivo {nombre} es demasiado grande")
    return datos


@router.get("")
async def estado_csd(
    negocio_id: str = Depends(negocio_autorizado),
    db=Depends(get_db),
):
    """CSD activo del negocio (o null si no tiene)."""
    return a_respuesta(await db.csd_negocios.find_one({"negocio_id": negocio_id, "activo": True}))


@router.post("", status_code=201)
async def subir_csd(
    negocio_id: str = Form(...),
    archivo_cer: UploadFile = File(...),
    archivo_key: UploadFile = File(...),
    contrasena: str = Form(..., min_length=1, max_length=200),
    db=Depends(get_db),
    user=Depends(require_admin),
):
    verificar_acceso(user, negocio_id)
    emisor = await emisor_fiscal(db, negocio_id)

    cer = leer_cer(await leer_archivo(archivo_cer, ".cer"))
    if cer["rfc"] != emisor["rfc"]:
        raise HTTPException(400, f"El certificado es del RFC {cer['rfc']}, pero el negocio es {emisor['rfc']}")
    key = await leer_archivo(archivo_key, ".key")
    leer_llave(key, contrasena, cer["cert"])      # comprueba contraseña y par; la llave no se guarda abierta

    ahora = datetime.now(timezone.utc)
    await db.csd_negocios.update_many({"negocio_id": negocio_id, "activo": True}, {"$set": {"activo": False}})
    doc = {
        "negocio_id":            negocio_id,
        "no_certificado":        cer["no_certificado"],
        "certificado_b64":       certificado_b64(cer["cert"]),
        "llave_privada_enc":     cifrar(key),
        "contrasena_enc":        cifrar(contrasena.encode()),
        "fecha_inicio_vigencia": cer["fecha_inicio_vigencia"],
        "fecha_fin_vigencia":    cer["fecha_fin_vigencia"],
        "rfc_emisor":            cer["rfc"],
        "activo":                True,
        "created_at":            ahora,
        "created_by":            user.get("nombre", ""),
    }
    doc["_id"] = (await db.csd_negocios.insert_one(doc)).inserted_id
    return a_respuesta(doc)


@router.delete("/{id}")
async def revocar_csd(
    id: str,
    db=Depends(get_db),
    user=Depends(require_admin),
):
    doc = await obtener_del_negocio(db.csd_negocios, id, user, "CSD")
    await db.csd_negocios.update_one({"_id": doc["_id"]}, {"$set": {"activo": False, "revocado_at": datetime.now(timezone.utc)}})
    return {"ok": True}
