"""
Flota propia.

Colección `vehiculos`: negocio_id, nombre, placa (sin guiones ni espacios, como la pide
el SAT), anio_modelo, config_vehicular (c_ConfigAutotransporte), peso_bruto_vehicular
(toneladas, NOM-SCT-012), tipo_permiso_sct (c_TipoPermiso), num_permiso_sct,
seguro_resp_civil / seguro_carga / seguro_medio_ambiente {aseguradora, num_poliza,
fecha_vencimiento YYYY-MM-DD}, remolques [{subtipo (c_SubTipoRem), placa}], activo,
created_at, updated_at.
"""
import re
from datetime import date
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from .. import catalogos

PLACA = re.compile(r"^[A-Z0-9]{5,7}$")


def normalizar_placa(placa: str) -> str:
    """El SAT pide solo los caracteres alfanuméricos: 'ABC-123-X' → 'ABC123X'."""
    limpia = re.sub(r"[\s-]", "", placa or "").upper()
    if not PLACA.match(limpia):
        raise ValueError("La placa debe tener de 5 a 7 letras o números (sin contar guiones ni espacios)")
    return limpia


class Seguro(BaseModel):
    aseguradora: str = Field(min_length=3, max_length=50)
    num_poliza: str = Field(min_length=3, max_length=30)
    fecha_vencimiento: date


class Remolque(BaseModel):
    subtipo: str
    placa: str

    @field_validator("subtipo")
    @classmethod
    def subtipo_valido(cls, v: str) -> str:
        if v not in catalogos.subtipo_remolque():
            raise ValueError(f"Subtipo de remolque {v} no existe en c_SubTipoRem")
        return v

    @field_validator("placa")
    @classmethod
    def placa_valida(cls, v: str) -> str:
        return normalizar_placa(v)


class VehiculoBase(BaseModel):
    nombre: str = Field(min_length=1, max_length=100)
    placa: str
    anio_modelo: int = Field(ge=1900, le=date.today().year + 1)
    config_vehicular: str
    peso_bruto_vehicular: float = Field(gt=0, le=200)       # toneladas
    tipo_permiso_sct: str = "TPAF02"                        # transporte privado de carga
    num_permiso_sct: str = Field(min_length=1, max_length=50)
    seguro_resp_civil: Seguro
    seguro_carga: Optional[Seguro] = None
    seguro_medio_ambiente: Optional[Seguro] = None          # obligatorio para material peligroso
    remolques: List[Remolque] = Field(default=[], max_length=2)

    @field_validator("placa")
    @classmethod
    def placa_valida(cls, v: str) -> str:
        return normalizar_placa(v)

    @field_validator("config_vehicular")
    @classmethod
    def config_valida(cls, v: str) -> str:
        if v not in catalogos.config_autotransporte():
            raise ValueError(f"Configuración vehicular {v} no existe en c_ConfigAutotransporte (camionetas y vans: VL)")
        return v

    @field_validator("tipo_permiso_sct")
    @classmethod
    def permiso_valido(cls, v: str) -> str:
        if v not in catalogos.tipo_permiso():
            raise ValueError(f"Tipo de permiso {v} no existe en c_TipoPermiso")
        return v

    @model_validator(mode="after")
    def remolques_segun_config(self):
        regla = catalogos.remolque_requerido(self.config_vehicular)
        if regla == "1" and not self.remolques:
            raise ValueError(f"La configuración {self.config_vehicular} requiere al menos un remolque")
        if regla == "0" and self.remolques:
            raise ValueError(f"La configuración {self.config_vehicular} no lleva remolque")
        return self


class VehiculoCreate(VehiculoBase):
    negocio_id: str


class VehiculoUpdate(VehiculoBase):
    """Se envía el vehículo completo: las reglas de remolque dependen de la configuración."""
