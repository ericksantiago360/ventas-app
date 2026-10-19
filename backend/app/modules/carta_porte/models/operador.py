"""
Operadores (choferes).

Colección `operadores`: negocio_id, nombre, rfc, curp, num_licencia, tipo_licencia,
fecha_vencimiento_licencia (YYYY-MM-DD), telefono, activo, created_at, updated_at.
En el XML van RFC, nombre y número de licencia (FiguraTransporte, TipoFigura 01).
"""
import re
from datetime import date

from pydantic import BaseModel, Field, field_validator

from .. import catalogos

# tdCFDI:t_RFC
RFC = re.compile(r"^[A-Z&Ñ]{3,4}[0-9]{2}(0[1-9]|1[012])(0[1-9]|[12][0-9]|3[01])[A-Z0-9]{2}[0-9A]$")
CURP = re.compile(r"^[A-Z][AEIOUX][A-Z]{2}[0-9]{2}(0[1-9]|1[012])(0[1-9]|[12][0-9]|3[01])[HM][A-Z]{5}[0-9A-Z][0-9]$")


def validar_rfc(v: str) -> str:
    v = (v or "").strip().upper()
    if not RFC.match(v):
        raise ValueError("RFC inválido (12 caracteres persona moral, 13 persona física)")
    return v


class OperadorBase(BaseModel):
    nombre: str = Field(min_length=1, max_length=254)
    rfc: str
    curp: str = ""
    num_licencia: str = Field(min_length=6, max_length=16)
    tipo_licencia: str = "B"
    fecha_vencimiento_licencia: date
    telefono: str = ""

    @field_validator("rfc")
    @classmethod
    def rfc_valido(cls, v: str) -> str:
        if len(v.strip()) != 13:
            raise ValueError("El RFC de un operador es de persona física (13 caracteres)")
        return validar_rfc(v)

    @field_validator("curp")
    @classmethod
    def curp_valida(cls, v: str) -> str:
        v = v.strip().upper()
        if v and not CURP.match(v):
            raise ValueError("CURP inválida")
        return v

    @field_validator("num_licencia")
    @classmethod
    def licencia_sin_pipes(cls, v: str) -> str:
        v = v.strip()
        if "|" in v or len(v) < 6:
            raise ValueError("Número de licencia inválido (6 a 16 caracteres)")
        return v

    @field_validator("tipo_licencia")
    @classmethod
    def tipo_valido(cls, v: str) -> str:
        if v not in catalogos.TIPO_LICENCIA:
            raise ValueError(f"Tipo de licencia {v} no válido")
        return v


class OperadorCreate(OperadorBase):
    negocio_id: str


class OperadorUpdate(OperadorBase):
    pass
