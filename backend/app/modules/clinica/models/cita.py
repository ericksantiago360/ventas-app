"""
Agenda médica.

Colección:
- citas: negocio_id, folio (CIT-00001), expediente_id, medico_id, consultorio,
         fecha_inicio, fecha_fin, duracion_minutos, tipo, estado, motivo,
         notas_recepcion, recordatorio_enviado, motivo_cancelacion,
         created_at, updated_at

Las fechas se guardan en UTC. Una fecha sin zona horaria se toma como hora local
de la clínica (settings.ZONA_HORARIA).
"""
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

TIPOS_CITA = Literal["primera_vez", "seguimiento", "urgencia", "procedimiento"]
ESTADOS_CITA = Literal["programada", "confirmada", "en_consulta", "atendida", "cancelada", "no_show"]

# No ocupan el horario del médico ni del consultorio
ESTADOS_LIBERAN = ("cancelada", "no_show")
# Ya no se modifican; para volver a ver al paciente se agenda otra cita
ESTADOS_FINALES = ("atendida", "cancelada")


class CitaCreate(BaseModel):
    negocio_id: str
    expediente_id: str = Field(min_length=1)
    medico_id: str = Field(min_length=1)
    consultorio: str = ""
    fecha_inicio: datetime
    duracion_minutos: int = Field(default=30, ge=5, le=480)
    tipo: TIPOS_CITA = "seguimiento"
    motivo: str = ""
    notas_recepcion: str = ""


class CitaUpdate(BaseModel):
    medico_id: Optional[str] = Field(default=None, min_length=1)
    consultorio: Optional[str] = None
    fecha_inicio: Optional[datetime] = None
    duracion_minutos: Optional[int] = Field(default=None, ge=5, le=480)
    tipo: Optional[TIPOS_CITA] = None
    estado: Optional[ESTADOS_CITA] = None
    motivo: Optional[str] = None
    notas_recepcion: Optional[str] = None
    recordatorio_enviado: Optional[bool] = None
