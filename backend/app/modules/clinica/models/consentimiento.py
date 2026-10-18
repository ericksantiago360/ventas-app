"""
Consentimiento informado (NOM-004-SSA3-2012, 10.1).

Colecciones:
- consentimientos_plantillas: negocio_id, tipo, titulo, texto (con marcadores
                    {paciente}, {procedimiento}, {riesgos}…), activo. Si un negocio
                    no tiene plantilla de un tipo, se usa la incluida (PLANTILLAS_BASE).
- consentimientos:  negocio_id, folio (CON-00001), expediente_id, tipo, titulo,
                    procedimiento, texto (ya con los marcadores llenos), paciente
                    {nombre, edad, sexo, curp}, firmante {tipo: paciente|representante,
                    nombre, parentesco}, firma_paciente_base64, medico {nombre,
                    cedula_profesional, especialidad, firma_base64}, testigos [{nombre,
                    firma_base64}] (dos), fecha_firma, ip_firma, user_agent, huella
                    (SHA-256 del contenido firmado), pdf_id, estado (vigente | revocado),
                    revocacion {fecha, motivo, usuario}, created_at

Un consentimiento firmado no se edita; el paciente puede revocarlo. Las firmas se
guardan en el documento (cada una < 1 MB); el PDF, en GridFS (consentimientos_pdf).
"""
from typing import List, Literal

from pydantic import BaseModel, Field, field_validator

MAX_FIRMA = 1_400_000      # caracteres del data URL ≈ 1 MB de imagen

TIPOS_FIRMANTE = Literal["paciente", "representante"]


def validar_firma(v: str) -> str:
    if not v.startswith(("data:image/png;base64,", "data:image/jpeg;base64,")):
        raise ValueError("La firma debe ser una imagen PNG o JPG")
    if len(v) > MAX_FIRMA:
        raise ValueError("La imagen de la firma excede 1 MB")
    return v


class Testigo(BaseModel):
    nombre: str = Field(min_length=3, max_length=120)
    firma_base64: str

    @field_validator("firma_base64")
    @classmethod
    def firma(cls, v: str) -> str:
        return validar_firma(v)


class Firmante(BaseModel):
    tipo: TIPOS_FIRMANTE = "paciente"
    nombre: str = ""            # vacío con tipo paciente → el nombre del expediente
    parentesco: str = ""        # obligatorio para el representante legal


class ConsentimientoCreate(BaseModel):
    expediente_id: str = Field(min_length=1)
    tipo: str = Field(min_length=1, max_length=60)
    titulo: str = Field(min_length=1, max_length=160)
    texto: str = Field(min_length=20, max_length=20_000)   # con marcadores; el servidor los llena
    procedimiento: str = Field(min_length=1, max_length=300)
    riesgos: str = ""
    beneficios: str = ""
    alternativas: str = ""
    firmante: Firmante = Firmante()
    firma_paciente_base64: str
    testigos: List[Testigo] = Field(min_length=2, max_length=2)     # NOM-004 10.1.1.9: dos testigos

    @field_validator("firma_paciente_base64")
    @classmethod
    def firma(cls, v: str) -> str:
        return validar_firma(v)

    @field_validator("firmante")
    @classmethod
    def representante_completo(cls, f: Firmante) -> Firmante:
        if f.tipo == "representante" and (len(f.nombre.strip()) < 3 or not f.parentesco.strip()):
            raise ValueError("Del representante legal se necesitan nombre y parentesco")
        return f


class PlantillaConsentimiento(BaseModel):
    negocio_id: str
    tipo: str = Field(min_length=1, max_length=60)
    titulo: str = Field(min_length=1, max_length=160)
    texto: str = Field(min_length=20, max_length=20_000)


class PlantillaConsentimientoUpdate(BaseModel):
    titulo: str | None = Field(default=None, min_length=1, max_length=160)
    texto: str | None = Field(default=None, min_length=20, max_length=20_000)


class Revocacion(BaseModel):
    motivo: str = Field(min_length=1, max_length=500)


# ── Plantillas incluidas ──────────────────────────────────────────────────────
# Marcadores: {paciente} {edad} {firmante} {medico} {cedula} {clinica} {fecha}
#             {procedimiento} {riesgos} {beneficios} {alternativas}

_COMUN_FINAL = (
    "Se me ha informado que puedo revocar este consentimiento en cualquier momento antes de "
    "la realización del procedimiento, sin que ello afecte la atención que recibo.\n\n"
    "Autorizo al personal de salud de {clinica} para atender las contingencias y urgencias "
    "derivadas del acto autorizado, conforme al principio de libertad prescriptiva.\n\n"
    "Declaro que he leído (o se me ha leído) este documento, que lo comprendo, que pude hacer "
    "las preguntas que consideré necesarias y que fueron respondidas a mi satisfacción."
)

PLANTILLAS_BASE = [
    {
        "tipo": "cirugia",
        "titulo": "Carta de consentimiento bajo información para procedimiento quirúrgico",
        "texto": (
            "Yo, {firmante}, en pleno uso de mis facultades, en mi calidad de paciente o de su "
            "representante legal, en relación con {paciente} ({edad} años), declaro que el/la "
            "{medico}, con cédula profesional {cedula}, me ha explicado de forma clara y suficiente "
            "el siguiente procedimiento quirúrgico:\n\n{procedimiento}\n\n"
            "Riesgos y posibles complicaciones que se me informaron:\n{riesgos}\n\n"
            "Beneficios esperados:\n{beneficios}\n\n"
            "Alternativas de tratamiento:\n{alternativas}\n\n"
            "Entiendo que la práctica de la medicina no es una ciencia exacta y que no se me han "
            "garantizado resultados. Por lo anterior, otorgo mi consentimiento libre y voluntario "
            "para que se realice el procedimiento descrito.\n\n" + _COMUN_FINAL
        ),
    },
    {
        "tipo": "anestesia",
        "titulo": "Carta de consentimiento bajo información para anestesia",
        "texto": (
            "Yo, {firmante}, en relación con {paciente} ({edad} años), autorizo la aplicación del "
            "procedimiento anestésico necesario para:\n\n{procedimiento}\n\n"
            "El/la {medico}, con cédula profesional {cedula}, me explicó el tipo de anestesia "
            "propuesto, la necesidad de ayuno y los cuidados posteriores.\n\n"
            "Riesgos que se me informaron (entre ellos reacciones alérgicas, náusea, dolor de "
            "cabeza, alteraciones respiratorias o cardiovasculares):\n{riesgos}\n\n"
            "Beneficios esperados:\n{beneficios}\n\n"
            "Alternativas:\n{alternativas}\n\n"
            "Declaro haber informado mis alergias, enfermedades y medicamentos actuales.\n\n" + _COMUN_FINAL
        ),
    },
    {
        "tipo": "procedimiento_menor",
        "titulo": "Carta de consentimiento bajo información para procedimiento menor",
        "texto": (
            "Yo, {firmante}, en relación con {paciente} ({edad} años), autorizo al/la {medico}, "
            "con cédula profesional {cedula}, a realizar el siguiente procedimiento:\n\n"
            "{procedimiento}\n\n"
            "Riesgos que se me informaron:\n{riesgos}\n\n"
            "Beneficios esperados:\n{beneficios}\n\n"
            "Alternativas:\n{alternativas}\n\n" + _COMUN_FINAL
        ),
    },
]
