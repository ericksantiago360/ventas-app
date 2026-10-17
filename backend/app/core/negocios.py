"""
Validaciones entre registros de distintos negocios.

Todo registro vive en un negocio (negocio_id). Cuando un registro apunta a otro
(un pedido a su cliente, una orden a su paciente), ambos deben ser del mismo
negocio; si no, un usuario podría copiar o enlazar datos de un negocio ajeno.
"""
from bson import ObjectId
from fastapi import HTTPException


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
