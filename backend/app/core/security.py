from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from bson import ObjectId

from .config import settings
from .database import get_db

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    return jwt.encode(
        {**data, "exp": expire},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db=Depends(get_db),
):
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido o expirado",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        user_id: str = payload.get("sub")
        # Los tokens del portal del paciente no dan acceso al sistema interno
        if not user_id or payload.get("scope") == "portal":
            raise exc
    except JWTError:
        raise exc

    try:
        user = await db.usuarios.find_one(
            {"_id": ObjectId(user_id), "activo": True}
        )
    except Exception:
        raise exc

    if not user:
        raise exc

    user["_id"] = str(user["_id"])
    return user


async def require_admin(user=Depends(get_current_user)):
    if user.get("rol") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo un administrador puede hacer esto",
        )
    return user


# ── Portal del paciente ───────────────────────────────────────────────────────
# Acceso sin contraseña: el paciente recibe por correo un enlace con un token
# firmado. `pv` (portal_version del paciente) permite revocar los enlaces
# emitidos incrementando ese contador.

def create_portal_token(paciente_id: str, portal_version: int = 0) -> tuple[str, datetime]:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.PORTAL_TOKEN_DAYS)
    token = jwt.encode(
        {"sub": paciente_id, "scope": "portal", "pv": portal_version, "exp": expire},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )
    return token, expire


portal_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", scheme_name="PortalPaciente")


async def get_current_paciente(
    token: str = Depends(portal_scheme),
    db=Depends(get_db),
):
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Enlace inválido o expirado. Solicita uno nuevo.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        raise exc
    if payload.get("scope") != "portal" or not payload.get("sub"):
        raise exc
    try:
        paciente = await db.pacientes.find_one({"_id": ObjectId(payload["sub"]), "activo": True})
    except Exception:
        raise exc
    if not paciente or paciente.get("portal_version", 0) != payload.get("pv", 0):
        raise exc
    return paciente
