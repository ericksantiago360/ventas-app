"""
Farmacia / botiquín de la clínica.

Colecciones:
- farmacia_inventario:  negocio_id, nombre, principio_activo, presentacion, categoria,
                        stock (suma de los lotes), stock_minimo, lotes [{numero_lote,
                        fecha_caducidad YYYY-MM-DD, cantidad, proveedor}], precio_compra,
                        precio_venta, ubicacion, activo, version, created_at, updated_at
- farmacia_movimientos: negocio_id, articulo_id, articulo_nombre, tipo (entrada |
                        salida), cantidad, lotes [{numero_lote, cantidad}], receta_id,
                        receta_folio, motivo, usuario, fecha

Los lotes vacíos se quitan del artículo; su historia queda en los movimientos.
`version` sirve para que dos movimientos simultáneos no pisen el stock.
"""
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field

CATEGORIAS = Literal["medicamento", "reactivo", "material", "equipo"]


class ArticuloCreate(BaseModel):
    negocio_id: str
    nombre: str = Field(min_length=1, max_length=200)
    principio_activo: str = ""
    presentacion: str = ""          # "caja 30 tabletas 500 mg"
    categoria: CATEGORIAS = "medicamento"
    stock_minimo: int = Field(default=0, ge=0)
    precio_compra: float = Field(default=0, ge=0)
    precio_venta: float = Field(default=0, ge=0)
    ubicacion: str = ""             # "Estante A-3"


class ArticuloUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=1, max_length=200)
    principio_activo: Optional[str] = None
    presentacion: Optional[str] = None
    categoria: Optional[CATEGORIAS] = None
    stock_minimo: Optional[int] = Field(default=None, ge=0)
    precio_compra: Optional[float] = Field(default=None, ge=0)
    precio_venta: Optional[float] = Field(default=None, ge=0)
    ubicacion: Optional[str] = None


class Entrada(BaseModel):
    numero_lote: str = Field(min_length=1, max_length=60)
    fecha_caducidad: date
    cantidad: int = Field(gt=0)
    proveedor: str = ""
    precio_compra: Optional[float] = Field(default=None, ge=0)   # actualiza el del artículo
    motivo: str = ""


class Salida(BaseModel):
    cantidad: int = Field(gt=0)
    numero_lote: str = ""           # vacío: primero el que caduca antes
    receta_id: str = ""
    motivo: str = ""                # "Surtido de receta", "Uso en consulta", "Merma"…
