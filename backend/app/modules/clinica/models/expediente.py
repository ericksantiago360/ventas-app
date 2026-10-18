"""
Expediente clínico (NOM-004-SSA3-2012).

Los datos personales del paciente viven en la colección `pacientes` (la misma que
usan laboratorio y el portal); el expediente apunta a ella con `paciente_id` y
guarda lo clínico: antecedentes, médico tratante y las notas.

Colecciones:
- expedientes:     negocio_id, folio (EXP-00001), paciente_id, antecedentes,
                   medico_id, archivos_adjuntos, activo, created_at, updated_at
- notas_clinicas:  negocio_id, expediente_id, medico_id, tipo, fecha, SOAP,
                   signos_vitales, diagnosticos, created_at. Una nota firmada no
                   se edita ni se borra.
- expedientes_archivos (GridFS): contenido de los adjuntos; el expediente guarda
                   la referencia (id, nombre, descripcion, content_type, tamano,
                   subido_por, fecha).
"""
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, model_validator

# Mismos valores que app/routers/pacientes.py
SEXOS = Literal["masculino", "femenino", "otro"]
TIPOS_NOTA = Literal["primera_vez", "seguimiento", "urgencia", "interconsulta"]


# ── Datos del paciente (se guardan en `pacientes`) ────────────────────────────

class ContactoEmergencia(BaseModel):
    nombre: str = ""
    telefono: str = ""
    parentesco: str = ""


class DatosPaciente(BaseModel):
    nombre: str = Field(min_length=1, max_length=120)
    apellido_paterno: str = ""
    apellido_materno: str = ""
    fecha_nacimiento: str = ""          # YYYY-MM-DD
    sexo: SEXOS = "masculino"
    curp: str = ""
    telefono: str = ""
    email: str = ""
    direccion: str = ""
    ocupacion: str = ""
    estado_civil: str = ""
    contacto_emergencia: ContactoEmergencia = ContactoEmergencia()


class DatosPacienteUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=1, max_length=120)
    apellido_paterno: Optional[str] = None
    apellido_materno: Optional[str] = None
    fecha_nacimiento: Optional[str] = None
    sexo: Optional[SEXOS] = None
    curp: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None
    direccion: Optional[str] = None
    ocupacion: Optional[str] = None
    estado_civil: Optional[str] = None
    contacto_emergencia: Optional[ContactoEmergencia] = None


# ── Antecedentes (se guardan en el expediente) ────────────────────────────────

class MedicamentoActual(BaseModel):
    nombre: str = Field(min_length=1)
    dosis: str = ""


class Antecedentes(BaseModel):
    heredofamiliares: str = ""
    patologicos: str = ""
    no_patologicos: str = ""
    alergias: List[str] = []
    medicamentos_actuales: List[MedicamentoActual] = []
    gineco_obstetricos: str = ""        # solo aplica si el paciente es mujer


class AntecedentesUpdate(BaseModel):
    heredofamiliares: Optional[str] = None
    patologicos: Optional[str] = None
    no_patologicos: Optional[str] = None
    alergias: Optional[List[str]] = None
    medicamentos_actuales: Optional[List[MedicamentoActual]] = None
    gineco_obstetricos: Optional[str] = None


# ── Expediente ────────────────────────────────────────────────────────────────

class ExpedienteCreate(BaseModel):
    """Se abre para un paciente ya registrado (paciente_id) o uno nuevo (paciente)."""
    negocio_id: str
    paciente_id: Optional[str] = None
    paciente: Optional[DatosPaciente] = None
    antecedentes: Optional[Antecedentes] = None
    medico_id: str = ""

    @model_validator(mode="after")
    def un_solo_paciente(self):
        if bool(self.paciente_id) == bool(self.paciente):
            raise ValueError("Indica paciente_id de un paciente registrado o los datos de uno nuevo, no ambos")
        return self


class ExpedienteUpdate(BaseModel):
    paciente: Optional[DatosPacienteUpdate] = None
    antecedentes: Optional[AntecedentesUpdate] = None
    medico_id: Optional[str] = None


# ── Nota clínica SOAP ─────────────────────────────────────────────────────────

class SignosVitales(BaseModel):
    tension_arterial: str = ""                                  # "120/80"
    frecuencia_cardiaca: Optional[int] = Field(default=None, ge=0, le=300)
    temperatura: Optional[float] = Field(default=None, ge=25, le=45)
    peso: Optional[float] = Field(default=None, ge=0, le=500)   # kg
    talla: Optional[float] = Field(default=None, ge=0, le=300)  # cm
    spo2: Optional[int] = Field(default=None, ge=0, le=100)


class Diagnostico(BaseModel):
    cie10: str = ""
    descripcion: str = Field(min_length=1)


class NotaCreate(BaseModel):
    tipo: TIPOS_NOTA = "seguimiento"
    fecha: Optional[datetime] = None    # vacío → ahora
    subjetivo: str = ""
    objetivo: str = ""
    analisis: str = ""
    plan: str = ""
    signos_vitales: SignosVitales = SignosVitales()
    diagnosticos: List[Diagnostico] = []

    @model_validator(mode="after")
    def con_contenido(self):
        if not any(s.strip() for s in (self.subjetivo, self.objetivo, self.analisis, self.plan)):
            raise ValueError("La nota necesita al menos una sección SOAP con contenido")
        return self
