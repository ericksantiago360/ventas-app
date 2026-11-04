from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, Field, model_validator

from .base import MongoBaseModel, validate_object_id

ObjectIdStr = Annotated[str, AfterValidator(validate_object_id)]

NegocioId = Literal["santal", "dulce_tentacion", "bienes_raices", "diagnostico_plus", "consultoria"]
TipoLead = Literal["propietario", "comprador", "arrendatario"]
CanalOrigen = Literal["whatsapp", "referido", "instagram", "directo", "visita", "otro"]
TipoInteraccion = Literal["llamada", "whatsapp", "correo", "visita", "muestra", "cambio_etapa", "nota"]


class Cliente(MongoBaseModel):
    """Empresa B2B compartida entre todos los negocios."""

    id: ObjectIdStr | None = Field(default=None, alias="_id")
    empresa: str = Field(min_length=1)
    contacto: str = ""
    telefono: str
    correo: str | None = None
    canal_origen: CanalOrigen
    tags: list[str] = []
    notas: str = ""
    # user_id de quien lo creó: puede ver el cliente aunque aún no tenga actividad
    creado_por: str | None = None
    activo: bool = True
    created_at: datetime
    updated_at: datetime


class Oportunidad(MongoBaseModel):
    """Lead de un cliente dentro de un negocio específico."""

    id: ObjectIdStr | None = Field(default=None, alias="_id")
    cliente_id: ObjectIdStr
    negocio_id: NegocioId
    etapa: str = Field(min_length=1)
    tipo_lead: TipoLead | None = None
    valor_estimado: float | None = None
    fecha_cierre_estimada: date | None = None
    activo: bool = True
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def tipo_lead_solo_bienes_raices(self):
        # tipo_lead solo aplica a Bienes Raíces; en otros negocios se ignora (spec §7)
        if self.negocio_id != "bienes_raices":
            self.tipo_lead = None
        elif self.tipo_lead is None:
            raise ValueError("Bienes Raíces requiere tipo_lead")
        return self


class Interaccion(MongoBaseModel):
    """Registro append-only del historial con un cliente. Nunca se edita ni elimina."""

    id: ObjectIdStr | None = Field(default=None, alias="_id")
    cliente_id: ObjectIdStr
    oportunidad_id: ObjectIdStr | None = None
    negocio_id: NegocioId
    tipo: TipoInteraccion
    descripcion: str
    fecha: datetime
    creado_por: str
