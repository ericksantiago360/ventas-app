from pydantic import BaseModel, ConfigDict
from bson import ObjectId
from typing import Any


def validate_object_id(v: Any) -> str:
    if isinstance(v, ObjectId):
        return str(v)
    if isinstance(v, str) and ObjectId.is_valid(v):
        return v
    raise ValueError(f"ObjectId inválido: {v}")


def _convertir_object_ids(valor: Any) -> Any:
    if isinstance(valor, ObjectId):
        return str(valor)
    if isinstance(valor, dict):
        return {k: _convertir_object_ids(v) for k, v in valor.items()}
    if isinstance(valor, list):
        return [_convertir_object_ids(v) for v in valor]
    return valor


def serialize_doc(doc: dict | None) -> dict | None:
    """Convierte todos los ObjectId (incluidos anidados) a str para serialización JSON."""
    if not doc:
        return doc
    return _convertir_object_ids(doc)


def serialize_list(docs: list[dict]) -> list[dict]:
    return [serialize_doc(d) for d in docs]


class MongoBaseModel(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
    )
