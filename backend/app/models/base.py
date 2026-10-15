from pydantic import BaseModel, ConfigDict
from bson import ObjectId
from typing import Any


def validate_object_id(v: Any) -> str:
    if isinstance(v, ObjectId):
        return str(v)
    if isinstance(v, str) and ObjectId.is_valid(v):
        return v
    raise ValueError(f"ObjectId inválido: {v}")


def serialize_doc(doc: dict | None) -> dict | None:
    """Convierte ObjectId a str para serialización JSON."""
    if not doc:
        return doc
    if "_id" in doc:
        doc["_id"] = str(doc["_id"])
    return doc


def serialize_list(docs: list[dict]) -> list[dict]:
    return [serialize_doc(d) for d in docs]


class MongoBaseModel(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
    )
