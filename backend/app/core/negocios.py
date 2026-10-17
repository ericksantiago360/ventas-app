"""
Acceso por negocio.

Todo registro vive en un negocio (negocio_id) y cada usuario tiene la lista de
negocios a los que puede entrar. Este módulo es el único lugar donde se decide
ese acceso; los routers no deben reimplementarlo.

- negocio_autorizado: dependencia para endpoints que reciben ?negocio_id=
- verificar_acceso: cuando el negocio llega en el cuerpo o en un registro
- obtener_del_negocio: leer un registro por id y verificar el acceso a su negocio
- validar_referencia: un registro que apunta a otro debe ser del mismo negocio
"""
from bson import ObjectId
from fastapi import Depends, HTTPException, Query

from .security import get_current_user


def negocios_del_usuario(user: dict) -> set[str]:
    negocios = user.get("negocios") or user.get("businesses") or []
    # Un texto suelto se trata como un solo negocio; si no, "san" in "santal" daría acceso
    if isinstance(negocios, str):
        negocios = [negocios]
    return set(negocios)


def verificar_acceso(user: dict, negocio_id: str) -> None:
    if not negocio_id or negocio_id not in negocios_del_usuario(user):
        raise HTTPException(status_code=403, detail="No tienes acceso a este negocio")


async def negocio_autorizado(
    negocio_id: str = Query(...),
    user=Depends(get_current_user),
) -> str:
    """Dependencia: valida el ?negocio_id= antes de entrar al endpoint y lo devuelve."""
    verificar_acceso(user, negocio_id)
    return negocio_id


async def obtener_del_negocio(coleccion, id: str, user: dict, nombre: str) -> dict:
    """
    Lee un registro por id y verifica que el usuario tenga acceso a su negocio.

    404 si no existe; 403 si es de un negocio ajeno. Se verifica antes de que el
    endpoint escriba nada, así que un usuario no puede tocar registros de otros.
    """
    if not ObjectId.is_valid(str(id)):
        raise HTTPException(status_code=400, detail="ID inválido")
    doc = await coleccion.find_one({"_id": ObjectId(str(id))})
    if not doc:
        raise HTTPException(status_code=404, detail=f"{nombre} no encontrado")
    verificar_acceso(user, doc.get("negocio_id"))
    return doc


async def validar_referencia(coleccion, ref_id, negocio_id: str, nombre: str) -> dict | None:
    """
    Devuelve el documento al que apunta ref_id si pertenece a negocio_id.

    Una referencia vacía es válida (campo opcional) y devuelve None. Si el id no
    existe o es de otro negocio responde 404, sin revelar cuál de los dos casos es.
    """
    if not ref_id:
        return None
    if not ObjectId.is_valid(str(ref_id)):
        raise HTTPException(400, f"{nombre}: ID inválido")
    doc = await coleccion.find_one({"_id": ObjectId(str(ref_id)), "negocio_id": negocio_id})
    if not doc:
        raise HTTPException(404, f"{nombre}: no existe en este negocio")
    return doc
