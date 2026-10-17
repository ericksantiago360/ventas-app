from datetime import datetime, timezone
from typing import List, Literal, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.negocios import negocios_del_usuario
from app.core.security import hash_password, require_admin

router = APIRouter(prefix="/usuarios", tags=["Usuarios"])

ROLES = Literal["admin", "vendedor", "usuario"]
EMAIL = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class UsuarioCreate(BaseModel):
    nombre:   str = Field(min_length=2, max_length=120)
    email:    str = Field(pattern=EMAIL, max_length=200)
    password: str = Field(min_length=8, max_length=200)
    rol:      ROLES = "usuario"
    negocios: List[str] = []


class UsuarioUpdate(BaseModel):
    nombre:   Optional[str] = Field(default=None, min_length=2, max_length=120)
    password: Optional[str] = Field(default=None, min_length=8, max_length=200)
    rol:      Optional[ROLES] = None
    negocios: Optional[List[str]] = None
    activo:   Optional[bool] = None


def a_respuesta(doc: dict, admin: dict) -> dict:
    # Nunca se devuelve password_hash; de los negocios, solo los que el administrador también tiene
    return {
        "id":       str(doc["_id"]),
        "nombre":   doc.get("nombre", ""),
        "email":    doc.get("email", ""),
        "rol":      doc.get("rol", "usuario"),
        "negocios": sorted(negocios_del_usuario(doc) & negocios_del_usuario(admin)),
        "activo":   doc.get("activo", True),
    }


def validar_negocios(admin: dict, negocios: List[str]) -> None:
    """Un administrador solo puede asignar negocios a los que él mismo tiene acceso."""
    ajenos = set(negocios) - negocios_del_usuario(admin)
    if ajenos:
        raise HTTPException(403, f"No puedes asignar negocios a los que no tienes acceso: {', '.join(sorted(ajenos))}")


def visible_para(admin: dict, usuario: dict) -> bool:
    """Usuarios que comparten algún negocio con el administrador, o que no tienen ninguno."""
    propios = negocios_del_usuario(usuario)
    return not propios or bool(propios & negocios_del_usuario(admin))


async def quedaria_sin_admin(db, usuario_id: ObjectId) -> bool:
    otro = await db.usuarios.find_one({"_id": {"$ne": usuario_id}, "rol": "admin", "activo": {"$ne": False}})
    return otro is None


@router.get("")
async def listar_usuarios(
    db=Depends(get_db),
    admin=Depends(require_admin),
):
    docs = await db.usuarios.find({}).sort("nombre", 1).to_list(1000)
    return [a_respuesta(d, admin) for d in docs if visible_para(admin, d)]


@router.post("", status_code=201)
async def crear_usuario(
    body: UsuarioCreate,
    db=Depends(get_db),
    admin=Depends(require_admin),
):
    validar_negocios(admin, body.negocios)
    email = body.email.strip().lower()
    if await db.usuarios.find_one({"email": email}):
        raise HTTPException(409, "Ya existe un usuario con ese email")

    now = datetime.now(timezone.utc)
    doc = {
        "nombre":        body.nombre.strip(),
        "email":         email,
        "password_hash": hash_password(body.password),
        "negocios":      sorted(set(body.negocios)),
        "rol":           body.rol,
        "activo":        True,
        "created_at":    now,
        "updated_at":    now,
    }
    result = await db.usuarios.insert_one(doc)
    doc["_id"] = result.inserted_id
    return a_respuesta(doc, admin)


@router.put("/{id}")
async def actualizar_usuario(
    id: str,
    body: UsuarioUpdate,
    db=Depends(get_db),
    admin=Depends(require_admin),
):
    if not ObjectId.is_valid(id):
        raise HTTPException(400, "ID inválido")
    oid = ObjectId(id)
    usuario = await db.usuarios.find_one({"_id": oid})
    if not usuario or not visible_para(admin, usuario):
        raise HTTPException(404, "Usuario no encontrado")

    es_yo = str(oid) == str(admin["_id"])
    pierde_admin = (body.rol is not None and body.rol != "admin") or body.activo is False
    if usuario.get("rol") == "admin" and pierde_admin:
        if es_yo:
            raise HTTPException(400, "No puedes quitarte el rol de administrador ni desactivarte a ti mismo")
        if await quedaria_sin_admin(db, oid):
            raise HTTPException(400, "Debe quedar al menos un administrador activo")

    campos: dict = {"updated_at": datetime.now(timezone.utc)}
    if body.nombre is not None:
        campos["nombre"] = body.nombre.strip()
    if body.password is not None:
        campos["password_hash"] = hash_password(body.password)
    if body.rol is not None:
        campos["rol"] = body.rol
    if body.activo is not None:
        campos["activo"] = body.activo
    if body.negocios is not None:
        validar_negocios(admin, body.negocios)
        # Los negocios que el administrador no tiene no se tocan: no puede verlos ni quitarlos
        fuera_de_alcance = negocios_del_usuario(usuario) - negocios_del_usuario(admin)
        campos["negocios"] = sorted(set(body.negocios) | fuera_de_alcance)

    await db.usuarios.update_one({"_id": oid}, {"$set": campos})
    return a_respuesta({**usuario, **campos}, admin)
