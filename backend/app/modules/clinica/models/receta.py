"""
Recetas digitales.

Colección:
- recetas: negocio_id, folio (RX-00001), folio_verificacion (UUID del QR),
           expediente_id, nota_clinica_id, medico_id, medico {nombre,
           cedula_profesional, especialidad, cedula_especialidad, institucion,
           firma_base64}, paciente {nombre, edad, sexo, alergias, peso, talla},
           medicamentos, diagnostico, indicaciones_generales, fecha, pdf_id,
           estado (vigente | cancelada), motivo_cancelacion, created_at

Los datos del médico y del paciente se copian al emitirla: la receta impresa no
cambia aunque después se edite el perfil o el expediente. El PDF se guarda en
GridFS (recetas_pdf), no en STORAGE_PATH, que se sirve sin autenticación.

El perfil médico vive en el usuario (usuarios.perfil_medico).
"""
from typing import List

from pydantic import BaseModel, Field, field_validator

MAX_FIRMA = 400_000     # caracteres del data URL (~300 KB de imagen)


class Medicamento(BaseModel):
    nombre: str = Field(min_length=1, max_length=200)
    presentacion: str = ""      # "tabletas 500 mg"
    dosis: str = ""             # "1 tableta"
    frecuencia: str = ""        # "cada 8 horas"
    duracion: str = ""          # "7 días"
    via: str = "oral"
    indicaciones: str = ""      # "tomar con alimentos"


class RecetaCreate(BaseModel):
    expediente_id: str = Field(min_length=1)
    nota_clinica_id: str = ""
    medicamentos: List[Medicamento] = Field(min_length=1, max_length=30)
    diagnostico: str = ""
    indicaciones_generales: str = ""


class PerfilMedico(BaseModel):
    cedula_profesional: str = Field(default="", max_length=20)
    especialidad: str = Field(default="", max_length=120)
    cedula_especialidad: str = Field(default="", max_length=20)
    institucion: str = Field(default="", max_length=200)    # quien expidió el título
    telefono: str = Field(default="", max_length=40)
    firma_base64: str = ""                                  # data:image/png;base64,…

    @field_validator("firma_base64")
    @classmethod
    def firma_valida(cls, v: str) -> str:
        if v and not v.startswith(("data:image/png;base64,", "data:image/jpeg;base64,")):
            raise ValueError("La firma debe ser una imagen PNG o JPG")
        if len(v) > MAX_FIRMA:
            raise ValueError("La imagen de la firma es demasiado grande (máx. ~300 KB)")
        return v


class CancelarReceta(BaseModel):
    motivo: str = Field(min_length=1, max_length=300)
