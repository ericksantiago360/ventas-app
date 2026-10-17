from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from bson import ObjectId

from ..core.database import get_db
from ..core.security import (
    verify_password,
    create_access_token,
    get_current_user,
)

router = APIRouter()


@router.post("/login")
async def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db=Depends(get_db),
):
    user = await db.usuarios.find_one(
        {"email": form.username.strip().lower(), "activo": True}
    )
    if not user or not verify_password(form.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email o contraseña incorrectos",
        )

    token = create_access_token({"sub": str(user["_id"])})

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id":       str(user["_id"]),
            "nombre":   user["nombre"],
            "email":    user["email"],
            "negocios": user.get("negocios", []),
            "rol":      user.get("rol", "usuario"),
        },
    }


@router.get("/me")
async def me(current_user=Depends(get_current_user)):
    return {
        "id":       current_user["_id"],
        "nombre":   current_user["nombre"],
        "email":    current_user["email"],
        "negocios": current_user.get("negocios", []),
        "rol":      current_user.get("rol", "usuario"),
    }
