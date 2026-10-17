from fastapi import APIRouter, Depends

from app.core.database import get_db
from app.core.negocios import negocios_del_usuario
from app.core.security import get_current_user

router = APIRouter(prefix="/negocios", tags=["Negocios"])


@router.get("")
async def listar_negocios(
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Negocios activos a los que el usuario tiene acceso, desde config_negocios."""
    docs = await db.config_negocios.find(
        {"_id": {"$in": sorted(negocios_del_usuario(user))}, "activo": {"$ne": False}},
        {"nombre": 1, "tipo": 1},
    ).sort("nombre", 1).to_list(100)
    return [
        {"id": d["_id"], "nombre": d.get("nombre") or d["_id"], "tipo": d.get("tipo", "")}
        for d in docs
    ]
