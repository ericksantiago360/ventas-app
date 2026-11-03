"""
Órdenes de la tienda en línea.

Colección ordenes_ecommerce. Tipos según el negocio:
- producto:   venta con pago por transferencia SPEI u OXXO (estado pendiente_pago)
- servicio:   igual que producto, con fecha de cita preferida (Diagnóstico Plus)
- cotizacion: sin precio; el cliente pide cotización (Santal Machinery)
- contacto:   formulario de interés sobre un inmueble (Bienes Raíces)

Estados: pendiente_pago → pago_en_revision → confirmada | cancelada
         solicitud → confirmada | cancelada   (cotizacion y contacto)

Los precios nunca vienen del cliente: el servidor los toma del catálogo.
"""
import re
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class DireccionEnvio(BaseModel):
    calle: str = ""
    numero: str = ""
    colonia: str = ""
    ciudad: str = ""
    estado: str = ""
    cp: str = ""


class ClienteCheckout(BaseModel):
    nombre: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=160)
    telefono: str = Field(min_length=7, max_length=20)
    direccion_envio: DireccionEnvio = DireccionEnvio()

    @field_validator("email")
    @classmethod
    def email_valido(cls, v: str) -> str:
        v = v.strip().lower()
        # Sin espacios ni saltos de línea: el correo termina en un encabezado SMTP
        if not EMAIL_RE.match(v):
            raise ValueError("Correo inválido")
        return v


class PartidaCheckout(BaseModel):
    producto_id: str = Field(min_length=1)
    variante_id: Optional[str] = None
    cantidad: int = Field(ge=1, le=999)


class CheckoutBody(BaseModel):
    cliente: ClienteCheckout
    partidas: list[PartidaCheckout] = Field(min_length=1, max_length=50)
    metodo_pago: Optional[Literal["transferencia", "oxxo_cie"]] = None
    entrega: Literal["recoger", "envio"] = "recoger"
    notas: str = Field(default="", max_length=1000)
    cita_solicitada: Optional[datetime] = None   # preferencia del cliente; el negocio agenda
