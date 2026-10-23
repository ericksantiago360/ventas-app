from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from ..models.crm import CanalOrigen, NegocioId, ObjectIdStr, TipoLead

# Manual: "cambio_etapa" solo lo genera PUT /oportunidades/{id}/etapa
TipoInteraccionManual = Literal["llamada", "whatsapp", "correo", "visita", "muestra", "nota"]


class ClienteCreate(BaseModel):
    empresa: str = Field(min_length=1)
    contacto: str = ""
    telefono: str = Field(min_length=1)
    correo: str | None = None
    canal_origen: CanalOrigen
    tags: list[str] = []
    notas: str = ""


class ClienteUpdate(BaseModel):
    empresa: str | None = Field(default=None, min_length=1)
    contacto: str | None = None
    telefono: str | None = None
    correo: str | None = None
    canal_origen: CanalOrigen | None = None
    tags: list[str] | None = None
    notas: str | None = None


class OportunidadCreate(BaseModel):
    cliente_id: ObjectIdStr
    negocio_id: NegocioId
    # La etapa se valida contra config_negocios en el router (es dato de runtime)
    etapa: str = Field(min_length=1)
    tipo_lead: TipoLead | None = None
    valor_estimado: float | None = None
    fecha_cierre_estimada: date | None = None

    @model_validator(mode="after")
    def tipo_lead_solo_bienes_raices(self):
        # En otros negocios tipo_lead se ignora (spec §7); en Bienes Raíces lo valida el router
        if self.negocio_id != "bienes_raices":
            self.tipo_lead = None
        return self


class OportunidadUpdate(BaseModel):
    # cliente_id, negocio_id, tipo_lead y etapa no se editan aquí: etapa va por /etapa
    valor_estimado: float | None = None
    fecha_cierre_estimada: date | None = None


class EtapaUpdate(BaseModel):
    etapa: str = Field(min_length=1)


class InteraccionCreate(BaseModel):
    cliente_id: ObjectIdStr
    oportunidad_id: ObjectIdStr | None = None
    negocio_id: NegocioId
    tipo: TipoInteraccionManual
    descripcion: str = Field(min_length=1)
    fecha: datetime | None = None
