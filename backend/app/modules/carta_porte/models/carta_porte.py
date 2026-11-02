"""
Carta Porte de traslado propio (CFDI tipo T con complemento Carta Porte 3.1).

Colección `cartas_porte`: negocio_id, folio (CP-00001), id_ccp (IdCCP del SAT), estado
(borrador | listo | en_transito | entregado | cancelado), emisor {rfc, nombre,
regimen_fiscal, codigo_postal}, origen {rfc_remitente, nombre_remitente,
fecha_hora_salida, domicilio}, destinos [{num_destino, rfc_destinatario,
nombre_destinatario, distancia_recorrida, fecha_hora_llegada, domicilio}], mercancias
[...], unidad_peso, peso_bruto_total, num_total_mercancias, total_dist_rec,
vehiculo_id, vehiculo_snapshot, operadores [{operador_id, snapshot}], pedido_id,
factura_id, observaciones, xml_interno, timbrado {uuid, fecha_timbrado, pac,
cadena_original, sello_sat, xml_timbrado}, historial [{estado, fecha, usuario, nota}],
motivo_cancelacion, created_at, updated_at, created_by.

Los domicilios guardan claves SAT (estado, municipio, localidad, colonia), que es lo que
va en el XML; los nombres se toman del catálogo al mostrar e imprimir. Las fechas se
guardan en UTC; sin zona horaria se toman como hora local (settings.ZONA_HORARIA).

El vehículo y los operadores se copian (snapshot) al crear o editar el borrador, para
que el documento no cambie si después se edita la flota.
"""
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from .. import catalogos
from ..fechas import a_utc
from .operador import validar_rfc

ESTADOS = Literal["borrador", "listo", "en_transito", "entregado", "cancelado"]
TRANSICIONES = {
    "borrador":    {"listo"},
    "listo":       {"en_transito", "borrador"},
    "en_transito": {"entregado"},
    "entregado":   set(),
    "cancelado":   set(),
}


class Domicilio(BaseModel):
    """Con el código postal se completan estado, municipio y localidad (c_CodigoPostal)."""
    calle: str = Field(default="", max_length=100)
    num_exterior: str = Field(default="", max_length=55)
    num_interior: str = Field(default="", max_length=55)
    colonia: str = ""          # c_Colonia (4 dígitos) del código postal
    localidad: str = ""        # c_Localidad
    municipio: str = ""        # c_Municipio
    estado: str = ""           # c_Estado
    pais: Literal["MEX"] = "MEX"
    codigo_postal: str
    referencia: str = Field(default="", max_length=250)

    @model_validator(mode="after")
    def segun_codigo_postal(self):
        cp = catalogos.codigo_postal(self.codigo_postal.strip())
        if not cp:
            raise ValueError(f"El código postal {self.codigo_postal} no existe en el catálogo del SAT")
        if self.estado and self.estado != cp["estado"]:
            raise ValueError(f"El código postal {self.codigo_postal} es de {cp['estado_nombre']}, no de {self.estado}")
        self.estado = cp["estado"]
        self.municipio = self.municipio or cp["municipio"]
        self.localidad = self.localidad or cp["localidad"]
        if self.municipio != cp["municipio"]:
            raise ValueError(f"El municipio no corresponde al código postal {self.codigo_postal}")
        if self.colonia and not catalogos.colonia_valida(self.codigo_postal, self.colonia):
            raise ValueError(f"La colonia {self.colonia} no pertenece al código postal {self.codigo_postal}")
        return self


class Emisor(BaseModel):
    """Datos fiscales del negocio: en traslado propio es emisor, receptor, remitente y destinatario."""
    rfc: str
    nombre: str = Field(min_length=1, max_length=254)   # razón social tal como está en la constancia
    regimen_fiscal: str
    codigo_postal: str                                    # domicilio fiscal (LugarExpedicion)
    domicilio_salida: Optional[Domicilio] = None          # bodega habitual, para prellenar el origen

    @field_validator("rfc")
    @classmethod
    def rfc_valido(cls, v: str) -> str:
        return validar_rfc(v)

    @field_validator("nombre")
    @classmethod
    def nombre_limpio(cls, v: str) -> str:
        return " ".join(v.upper().split())

    @model_validator(mode="after")
    def regimen_y_cp(self):
        regimen = catalogos.regimen_fiscal().get(self.regimen_fiscal)
        if not regimen:
            raise ValueError(f"Régimen fiscal {self.regimen_fiscal} no existe en c_RegimenFiscal")
        moral = len(self.rfc) == 12
        if (moral and not regimen["moral"]) or (not moral and not regimen["fisica"]):
            raise ValueError(f"El régimen {self.regimen_fiscal} no aplica a persona {'moral' if moral else 'física'}")
        if not catalogos.codigo_postal(self.codigo_postal):
            raise ValueError(f"El código postal {self.codigo_postal} no existe en el catálogo del SAT")
        return self


class Origen(BaseModel):
    rfc_remitente: str = ""          # vacío: el RFC del negocio
    nombre_remitente: str = Field(default="", max_length=254)
    fecha_hora_salida: datetime
    domicilio: Domicilio


class Destino(BaseModel):
    rfc_destinatario: str = ""       # vacío: el RFC del negocio (traslado propio)
    nombre_destinatario: str = Field(default="", max_length=254)
    distancia_recorrida: float = Field(ge=0.01, le=99999)    # km desde la ubicación anterior
    fecha_hora_llegada: datetime
    domicilio: Domicilio


class Mercancia(BaseModel):
    bienes_transp: str                       # c_ClaveProdServCP
    descripcion: str = Field(min_length=1, max_length=1000)
    cantidad: float = Field(gt=0)
    clave_unidad: str = "H87"                # c_ClaveUnidad de la cantidad
    peso_kg: float = Field(ge=0.001)         # PesoEnKg del total de esa línea
    valor_mercancia: Optional[float] = Field(default=None, ge=0)
    moneda: Literal["MXN", "USD", "EUR"] = "MXN"
    material_peligroso: Optional[bool] = None
    cve_material_peligroso: str = ""         # c_MaterialPeligroso
    embalaje: str = ""                       # c_TipoEmbalaje
    destino: Optional[int] = Field(default=None, ge=1)   # a qué destino va (requerido con varios destinos)

    @field_validator("bienes_transp")
    @classmethod
    def clave_existe(cls, v: str) -> str:
        v = v.strip()
        if not catalogos.producto(v):
            raise ValueError(f"La clave {v} no existe en c_ClaveProdServCP")
        return v

    @field_validator("clave_unidad")
    @classmethod
    def unidad_existe(cls, v: str) -> str:
        if v not in catalogos.clave_unidad():
            raise ValueError(f"La unidad {v} no existe en c_ClaveUnidad")
        return v

    @model_validator(mode="after")
    def material_segun_catalogo(self):
        """El catálogo dice por clave si el material es peligroso: "0" no, "1" sí, "0,1" según el caso."""
        bandera = catalogos.producto(self.bienes_transp)["material_peligroso"]
        if bandera == "0":
            if self.material_peligroso:
                raise ValueError(f"La clave {self.bienes_transp} no se registra como material peligroso")
            self.material_peligroso = None
        elif bandera == "1":
            self.material_peligroso = True
        elif self.material_peligroso is None:
            raise ValueError(f"Indica si la mercancía {self.bienes_transp} se traslada como material peligroso")
        if self.material_peligroso:
            if not catalogos.material_peligroso(self.cve_material_peligroso):
                raise ValueError(f"{self.descripcion}: falta la clave de material peligroso (c_MaterialPeligroso)")
            if self.embalaje not in catalogos.tipo_embalaje():
                raise ValueError(f"{self.descripcion}: falta el tipo de embalaje del material peligroso")
        else:
            self.cve_material_peligroso = self.embalaje = ""
        return self


class CartaPorteBase(BaseModel):
    origen: Origen
    destinos: List[Destino] = Field(min_length=1, max_length=99)
    mercancias: List[Mercancia] = Field(min_length=1, max_length=500)
    unidad_peso: Literal["KGM", "TNE", "GRM", "LBR"] = "KGM"
    vehiculo_id: str = Field(min_length=1)
    operador_ids: List[str] = Field(min_length=1, max_length=5)
    pedido_id: str = ""
    observaciones: str = Field(default="", max_length=1000)

    @model_validator(mode="after")
    def coherente(self):
        salida = a_utc(self.origen.fecha_hora_salida)
        for i, d in enumerate(self.destinos, start=1):
            if a_utc(d.fecha_hora_llegada) <= salida:
                raise ValueError(f"La llegada al destino {i} debe ser posterior a la salida")
        if len(self.destinos) > 1:
            for m in self.mercancias:
                if m.destino is None or m.destino > len(self.destinos):
                    raise ValueError(f"Con varios destinos, indica a cuál va «{m.descripcion}»")
        else:
            for m in self.mercancias:
                m.destino = 1
        if len(set(self.operador_ids)) != len(self.operador_ids):
            raise ValueError("Un operador está repetido")
        return self


class CartaPorteCreate(CartaPorteBase):
    negocio_id: str


class CartaPorteUpdate(CartaPorteBase):
    pass


class CambioEstado(BaseModel):
    estado: ESTADOS
    nota: str = Field(default="", max_length=500)


class Cancelacion(BaseModel):
    motivo: str = Field(min_length=1, max_length=500)


class CancelacionSAT(BaseModel):
    """Cancelación del CFDI ante el SAT: 01 con relación (requiere folio fiscal que sustituye), 02 sin relación, 03 no se llevó a cabo, 04 nominativa en factura global."""
    motivo: Literal["01", "02", "03", "04"] = "02"
    folio_sustitucion: str = Field(default="", max_length=36)

    @model_validator(mode="after")
    def sustitucion_con_motivo_01(self):
        if self.motivo == "01" and not self.folio_sustitucion:
            raise ValueError("Con motivo 01 indica el UUID del comprobante que lo sustituye")
        return self
