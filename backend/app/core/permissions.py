"""
Roles y permisos del módulo de clínica.

El rol de clínica es por negocio: `usuarios.roles_clinica = {negocio_id: rol}`, aparte
del rol global (`usuarios.rol`). Un administrador global tiene todos los permisos.

- /clinica/*: sin rol de clínica en el negocio no hay acceso (datos clínicos).
- /lab/*:     quien no tiene rol de clínica conserva el acceso de siempre (laboratorios
              que no usan el módulo de clínica); con rol, se aplican sus permisos.

El acceso al negocio lo sigue decidiendo core/negocios.py; aquí solo se decide qué
puede hacer dentro de él.
"""
from fastapi import Depends, HTTPException

from .negocios import negocio_autorizado
from .security import get_current_user

ROLES_CLINICA = {
    "recepcion": [
        "expedientes:read", "expedientes:create",
        "citas:read", "citas:create", "citas:update",
    ],
    "medico": [
        "expedientes:read", "expedientes:update",
        "notas:create",
        "recetas:read", "recetas:create", "recetas:update",
        "consentimientos:read", "consentimientos:create", "consentimientos:update",
        "lab:read", "lab:create",
        "citas:read", "citas:update",
        "farmacia:read", "farmacia:update",
    ],
    "laboratorista": [
        "lab:read", "lab:create", "lab:update",
        "expedientes:read",
    ],
    "farmacia": [
        "farmacia:read", "farmacia:create", "farmacia:update",
        "recetas:read",
        "expedientes:read",
    ],
    "admin_clinica": ["*"],   # acceso total al módulo clínica, incluida la configuración (lab:config)
}

ETIQUETAS_ROLES = {
    "recepcion":     "Recepción",
    "medico":        "Médico",
    "laboratorista": "Laboratorista",
    "farmacia":      "Farmacia",
    "admin_clinica": "Administrador de clínica",
}


def rol_clinica(user: dict, negocio_id: str) -> str:
    return (user.get("roles_clinica") or {}).get(negocio_id, "")


def permisos_de(user: dict, negocio_id: str) -> set[str]:
    if user.get("rol") == "admin":
        return {"*"}
    return set(ROLES_CLINICA.get(rol_clinica(user, negocio_id), []))


def tiene_permiso(user: dict, negocio_id: str, permiso: str) -> bool:
    permisos = permisos_de(user, negocio_id)
    return "*" in permisos or permiso in permisos


def exigir_permiso(user: dict, negocio_id: str, permiso: str, *, sin_rol_permitido: bool = False) -> None:
    """
    403 si el usuario no tiene el permiso en el negocio. Con sin_rol_permitido (laboratorio),
    quien no tiene rol de clínica en el negocio pasa sin revisión.
    """
    if sin_rol_permitido and user.get("rol") != "admin" and not rol_clinica(user, negocio_id):
        return
    if not tiene_permiso(user, negocio_id, permiso):
        rol = ETIQUETAS_ROLES.get(rol_clinica(user, negocio_id))
        quien = f"Tu rol ({rol})" if rol else "Tu usuario no tiene rol de clínica en este negocio y"
        raise HTTPException(403, f"{quien} no permite esta acción ({permiso})")


def con_permiso(permiso: str, *, sin_rol_permitido: bool = False):
    """Dependencia para endpoints con ?negocio_id=: verifica el acceso al negocio y el permiso."""
    async def dependencia(negocio_id: str = Depends(negocio_autorizado), user=Depends(get_current_user)) -> str:
        exigir_permiso(user, negocio_id, permiso, sin_rol_permitido=sin_rol_permitido)
        return negocio_id
    return dependencia
