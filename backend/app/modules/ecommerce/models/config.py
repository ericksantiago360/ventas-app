"""
Configuración de la tienda en línea por negocio.

Colección tienda_config (una por negocio):
- negocio_id, slug, activa, nombre_tienda, descripcion, logo_url, banner_url,
  color_primario, whatsapp, correo_contacto, politica_envios, politica_devoluciones,
  metodos_pago, categorias_visibles, mostrar_precio, modo, iva_incluido, moneda,
  monto_minimo, monto_envio_gratis, entrega_*, costo_envio, tiempo_entrega,
  zonas_cobertura, notif_email_cliente, notif_whatsapp_admin, mensaje_confirmacion,
  facebook_url, instagram_url, tiktok_url, politica_privacidad, updated_at

El slug es la parte de la URL pública (/tienda/{slug}/...) y es único en toda la
plataforma. Los datos bancarios completos solo los ve el administrador.
"""
import re
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

TIPOS_PAGO = Literal["transferencia", "oxxo_cie"]
MODOS_TIENDA = Literal["catalogo", "propiedades"]
MONEDAS = Literal["MXN", "USD", "EUR"]

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class MetodoPago(BaseModel):
    tipo: TIPOS_PAGO
    banco: str = ""
    titular: str = ""
    clabe: str = ""          # CLABE interbancaria, 18 dígitos (SPEI)
    cuenta: str = ""         # número de convenio CIE para OXXO, 11 dígitos
    instrucciones: str = ""

    @field_validator("clabe")
    @classmethod
    def clabe_valida(cls, v: str) -> str:
        v = v.replace(" ", "")
        if v and not (v.isdigit() and len(v) == 18):
            raise ValueError("La CLABE debe tener 18 dígitos")
        return v

    @field_validator("cuenta")
    @classmethod
    def convenio_valido(cls, v: str) -> str:
        v = v.replace(" ", "")
        if v and not (v.isdigit() and len(v) == 11):
            raise ValueError("El número de convenio CIE debe tener 11 dígitos")
        return v


class TiendaConfigUpdate(BaseModel):
    slug: Optional[str] = None
    activa: Optional[bool] = None
    nombre_tienda: Optional[str] = Field(default=None, max_length=120)
    descripcion: Optional[str] = Field(default=None, max_length=500)
    color_primario: Optional[str] = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    whatsapp: Optional[str] = None
    correo_contacto: Optional[str] = None
    politica_envios: Optional[str] = None
    politica_devoluciones: Optional[str] = None
    metodos_pago: Optional[list[MetodoPago]] = None
    categorias_visibles: Optional[list[str]] = None
    mostrar_precio: Optional[bool] = None
    modo: Optional[MODOS_TIENDA] = None
    iva_incluido: Optional[bool] = None
    iva_frontera: Optional[bool] = None   # región fronteriza: IVA general 8% en productos con desglose

    # Moneda y precios
    moneda: Optional[MONEDAS] = None
    monto_minimo: Optional[float] = Field(default=None, ge=0)
    monto_envio_gratis: Optional[float] = Field(default=None, ge=0)

    # Envíos y entrega
    entrega_envio: Optional[bool] = None
    entrega_recoger: Optional[bool] = None
    entrega_entregas_plus: Optional[bool] = None
    costo_envio: Optional[float] = Field(default=None, ge=0)
    tiempo_entrega: Optional[str] = Field(default=None, max_length=120)
    zonas_cobertura: Optional[str] = Field(default=None, max_length=500)

    # Comunicación con el cliente
    notif_email_cliente: Optional[bool] = None
    notif_whatsapp_admin: Optional[bool] = None
    mensaje_confirmacion: Optional[str] = Field(default=None, max_length=500)

    # Redes sociales
    facebook_url: Optional[str] = Field(default=None, max_length=300)
    instagram_url: Optional[str] = Field(default=None, max_length=300)
    tiktok_url: Optional[str] = Field(default=None, max_length=300)

    # Políticas
    politica_privacidad: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("slug")
    @classmethod
    def slug_valido(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip().lower()
        if not (3 <= len(v) <= 40 and SLUG_RE.match(v)):
            raise ValueError("El slug solo puede tener letras minúsculas, números y guiones (3 a 40 caracteres)")
        return v


DEFAULTS_TIENDA = {
    "activa": False,
    "nombre_tienda": "",
    "descripcion": "",
    "logo_url": "",
    "banner_url": "",
    "color_primario": "#1F6FEB",
    "whatsapp": "",
    "correo_contacto": "",
    "politica_envios": "",
    "politica_devoluciones": "",
    "metodos_pago": [],
    "categorias_visibles": [],
    "mostrar_precio": True,
    "modo": "catalogo",
    "iva_incluido": False,
    "iva_frontera": False,
    "moneda": "MXN",
    "monto_minimo": 0,
    "monto_envio_gratis": 0,
    "entrega_envio": False,
    "entrega_recoger": True,
    "entrega_entregas_plus": False,
    "costo_envio": 0,
    "tiempo_entrega": "",
    "zonas_cobertura": "",
    "notif_email_cliente": True,
    "notif_whatsapp_admin": False,
    "mensaje_confirmacion": "",
    "facebook_url": "",
    "instagram_url": "",
    "tiktok_url": "",
    "politica_privacidad": "",
}


def config_publica(config: dict) -> dict:
    """Lo que ve el cliente en el storefront: sin CLABE ni número de convenio."""
    metodos = [
        {"tipo": m.get("tipo"), "banco": m.get("banco", ""), "titular": m.get("titular", ""),
         "instrucciones": m.get("instrucciones", "")}
        for m in config.get("metodos_pago", [])
    ]
    return {
        "slug": config.get("slug"),
        "nombre_tienda": config.get("nombre_tienda", ""),
        "descripcion": config.get("descripcion", ""),
        "logo_url": config.get("logo_url", ""),
        "banner_url": config.get("banner_url", ""),
        "color_primario": config.get("color_primario", DEFAULTS_TIENDA["color_primario"]),
        "whatsapp": config.get("whatsapp", ""),
        "correo_contacto": config.get("correo_contacto", ""),
        "politica_envios": config.get("politica_envios", ""),
        "politica_devoluciones": config.get("politica_devoluciones", ""),
        "metodos_pago": metodos,
        "mostrar_precio": config.get("mostrar_precio", True),
        "modo": config.get("modo", "catalogo"),
        "iva_incluido": config.get("iva_incluido", False),
        "moneda": config.get("moneda", "MXN"),
        "monto_minimo": config.get("monto_minimo", 0),
        "monto_envio_gratis": config.get("monto_envio_gratis", 0),
        "entrega_envio": config.get("entrega_envio", False),
        "entrega_recoger": config.get("entrega_recoger", True),
        "costo_envio": config.get("costo_envio", 0),
        "tiempo_entrega": config.get("tiempo_entrega", ""),
        "zonas_cobertura": config.get("zonas_cobertura", ""),
    }
