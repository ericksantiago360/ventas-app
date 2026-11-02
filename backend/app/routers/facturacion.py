"""
Facturación ágil (interna, sin timbrado SAT).

Flujo:
    borrador → emitida → pagada
                  ↘ cancelada

Una factura puede generarse en un clic desde un pedido o una orden de
laboratorio; los datos del receptor y los conceptos se copian del origen.
Un mismo origen no puede tener dos facturas activas.
"""
from datetime import datetime, timezone, date, timedelta
from io import BytesIO
from typing import Literal, List
import uuid

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field, model_validator
from pymongo import ReturnDocument

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, Image,
)

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.negocios import validar_cliente_unificado, validar_referencia, verificar_acceso
from app.models.crm import ObjectIdStr
from app.services.cobros import registrar_cobro, cancelar_cobro
from app.services.contabilidad_integracion import crear_poliza_cobro
from app.modules.timbrado.cfdi_ingreso import generar_cfdi_ingreso
from app.modules.timbrado.qr import qr_png, url_desde_xml
from app.modules.timbrado.servicio import (
    cancelacion_aceptada, cancelar_en_sat, emisor_fiscal, estado_sat_de, timbrar_xml,
)

router = APIRouter(prefix="/facturacion", tags=["Facturación"])

ORIGENES   = Literal["manual", "pedido", "orden_lab"]
METODOS    = Literal["PUE", "PPD"]
ESTADOS_ACTIVOS = ["borrador", "emitida", "pagada"]

RFC_PUBLICO_GENERAL = "XAXX010101000"

FORMAS_PAGO = {
    "01": "Efectivo", "02": "Cheque", "03": "Transferencia", "04": "Tarjeta de crédito",
    "28": "Tarjeta de débito", "99": "Por definir",
}


# ── Modelos ───────────────────────────────────────────────────────────────────

class Receptor(BaseModel):
    nombre:         str = ""
    rfc:            str = RFC_PUBLICO_GENERAL
    email:          str = ""
    telefono:       str = ""
    direccion:      str = ""
    cp:             str = ""
    regimen_fiscal: str = ""
    uso_cfdi:       str = "S01"


class Concepto(BaseModel):
    descripcion:     str
    clave:           str = ""
    unidad:          str = "Servicio"
    cantidad:        float = Field(1, gt=0)
    precio_unitario: float = Field(0, ge=0)
    descuento:       float = Field(0, ge=0)
    iva_tasa:        float = Field(0.16, ge=0, le=1)


class FacturaBase(BaseModel):
    receptor:          Receptor = Receptor()
    cliente_id:        ObjectIdStr | None = None
    paciente_id:       str = ""
    conceptos:         List[Concepto] = []
    descuento_general: float = Field(0, ge=0)
    forma_pago:        str = "01"     # 01 efectivo, 03 transferencia, 04 tarjeta...
    metodo_pago:       METODOS = "PUE"
    moneda:            Literal["MXN", "USD", "EUR"] = "MXN"
    fecha:             str = ""       # YYYY-MM-DD
    dias_credito:      int = Field(0, ge=0, le=365)
    notas:             str = ""


class FacturaCreate(FacturaBase):
    negocio_id: str
    emitir:     bool = False


class PagoCreate(BaseModel):
    monto:      float = Field(..., gt=0)
    cuenta_id:  str = Field(..., min_length=1)   # cuenta financiera donde entra el dinero
    forma_pago: str = "01"
    fecha:      str = ""
    referencia: str = ""


class CancelarBody(BaseModel):
    motivo: str = ""


class CancelarSATBody(BaseModel):
    """Motivo SAT: 01 con relación (requiere el UUID que sustituye), 02 sin relación, 03 no se llevó a cabo, 04 factura global."""
    motivo:            Literal["01", "02", "03", "04"] = "02"
    folio_sustitucion: str = Field("", max_length=36)

    @model_validator(mode="after")
    def sustitucion_con_motivo_01(self):
        if self.motivo == "01" and not self.folio_sustitucion:
            raise ValueError("Con motivo 01 indica el UUID del comprobante que lo sustituye")
        return self


# ── Utilidades ────────────────────────────────────────────────────────────────

def serializar(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    return doc


def validar_oid(id: str) -> ObjectId:
    try:
        return ObjectId(id)
    except Exception:
        raise HTTPException(400, "ID inválido")


def hoy_iso() -> str:
    return date.today().isoformat()


def calcular_totales(conceptos: list[dict], descuento_general: float = 0) -> dict:
    """
    Misma lógica que Pedidos: el IVA se calcula por concepto sobre
    (cantidad × precio − descuento) y el descuento general reduce el subtotal.
    """
    subtotal = 0.0
    descuentos = 0.0
    iva = 0.0
    for c in conceptos:
        bruto = float(c["cantidad"]) * float(c["precio_unitario"])
        desc = min(float(c.get("descuento", 0) or 0), bruto)
        importe = bruto - desc
        c["importe"] = round(importe, 2)
        c["iva_importe"] = round(importe * float(c.get("iva_tasa", 0) or 0), 2)
        subtotal += bruto
        descuentos += desc
        iva += c["iva_importe"]

    descuento_general = min(float(descuento_general or 0), subtotal - descuentos)
    descuentos += descuento_general
    total = subtotal - descuentos + iva
    return {
        "subtotal":  round(subtotal, 2),
        "descuento": round(descuentos, 2),
        "iva":       round(iva, 2),
        "total":     round(total, 2),
    }


def fecha_vencimiento(fecha: str, dias: int) -> str:
    try:
        base = date.fromisoformat(fecha)
    except Exception:
        base = date.today()
    return (base + timedelta(days=dias)).isoformat()


async def siguiente_folio(db, negocio_id: str) -> tuple[str, int]:
    config = await db.config_negocios.find_one({"_id": negocio_id}, {"serie_factura": 1}) or {}
    serie = config.get("serie_factura") or "F"
    counter = await db.counters.find_one_and_update(
        {"_id": f"facturas_{negocio_id}_{serie}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return serie, counter["seq"]


async def obtener_factura(db, id: str, user: dict) -> dict:
    factura = await db.facturas.find_one({"_id": validar_oid(id)})
    if not factura:
        raise HTTPException(404, "Factura no encontrada")
    verificar_acceso(user, factura["negocio_id"])
    return factura


async def validar_origen_libre(db, negocio_id: str, origen_tipo: str, origen_id: str):
    existente = await db.facturas.find_one({
        "negocio_id":  negocio_id,
        "origen_tipo": origen_tipo,
        "origen_id":   origen_id,
        "estado":      {"$in": ESTADOS_ACTIVOS},
    })
    if existente:
        raise HTTPException(
            400,
            f"Este {origen_tipo.replace('_', ' ')} ya tiene la factura "
            f"{existente.get('folio') or 'en borrador'}",
        )


async def validar_receptor(db, body: FacturaBase, negocio_id: str):
    await validar_cliente_unificado(db.clientes, body.cliente_id, "Cliente")
    await validar_referencia(db.pacientes, body.paciente_id, negocio_id, "Paciente")


def armar_documento(body: FacturaBase, negocio_id: str) -> dict:
    conceptos = [c.model_dump() for c in body.conceptos]
    if not conceptos:
        raise HTTPException(400, "La factura debe tener al menos un concepto")
    if not body.receptor.nombre.strip():
        raise HTTPException(400, "El nombre del receptor es obligatorio")

    totales = calcular_totales(conceptos, body.descuento_general)
    fecha = body.fecha or hoy_iso()
    receptor = body.receptor.model_dump()
    receptor["rfc"] = (receptor["rfc"] or RFC_PUBLICO_GENERAL).strip().upper()

    return {
        "negocio_id":        negocio_id,
        "receptor":          receptor,
        "cliente_id":        body.cliente_id,
        "paciente_id":       body.paciente_id,
        "conceptos":         conceptos,
        "descuento_general": body.descuento_general,
        "forma_pago":        body.forma_pago,
        "metodo_pago":       body.metodo_pago,
        "moneda":            body.moneda,
        "fecha":             fecha,
        "dias_credito":      body.dias_credito,
        "fecha_vencimiento": fecha_vencimiento(fecha, body.dias_credito),
        "notas":             body.notas.strip(),
        **totales,
    }


async def emitir_doc(db, factura: dict, user: dict) -> dict:
    """Asigna folio y pasa la factura a 'emitida'."""
    if factura["estado"] != "borrador":
        raise HTTPException(400, f"No se puede emitir una factura {factura['estado']}")
    if float(factura.get("total", 0)) <= 0:
        raise HTTPException(400, "El total de la factura debe ser mayor a cero")

    serie, numero = await siguiente_folio(db, factura["negocio_id"])
    now = datetime.now(timezone.utc)
    cambios = {
        "serie":       serie,
        "numero":      numero,
        "folio":       f"{serie}-{numero:06d}",
        "estado":      "emitida",
        "emitida_at":  now,
        "emitida_por": user.get("nombre", ""),
        "updated_at":  now,
    }
    res = await db.facturas.update_one(
        {"_id": factura["_id"], "estado": "borrador"},
        {"$set": cambios, "$push": {"historial": {"accion": "emitida", "fecha": now, "usuario": user.get("nombre", "")}}},
    )
    if res.matched_count == 0:
        raise HTTPException(409, "La factura ya fue emitida por otro usuario")
    factura.update(cambios)
    return factura


async def insertar_factura(db, doc: dict, origen_tipo: str, origen_id: str, user: dict, emitir: bool) -> dict:
    now = datetime.now(timezone.utc)
    doc.update({
        "origen_tipo":     origen_tipo,
        "origen_id":       origen_id,
        "origen_folio":    doc.get("origen_folio", ""),
        "serie":           "",
        "numero":          None,
        "folio":           "",
        "estado":          "borrador",
        "pagos":           [],
        "total_pagado":    0.0,
        "saldo":           doc["total"],
        "historial":       [{"accion": "creada", "fecha": now, "usuario": user.get("nombre", "")}],
        "created_by":      str(user.get("_id", "")),
        "created_at":      now,
        "updated_at":      now,
    })
    result = await db.facturas.insert_one(doc)
    doc["_id"] = result.inserted_id
    if emitir:
        doc = await emitir_doc(db, doc, user)
    return serializar(doc)


# ── Listado y resumen ─────────────────────────────────────────────────────────

@router.get("/facturas")
async def listar_facturas(
    negocio_id: str = Query(...),
    estado: str = Query(""),
    busqueda: str = Query(""),
    desde: str = Query(""),
    hasta: str = Query(""),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    filtro: dict = {"negocio_id": negocio_id}
    if estado.strip() == "vencida":
        filtro["estado"] = "emitida"
        filtro["fecha_vencimiento"] = {"$lt": hoy_iso()}
    elif estado.strip():
        filtro["estado"] = estado.strip()
    if desde.strip() or hasta.strip():
        filtro["fecha"] = {}
        if desde.strip():
            filtro["fecha"]["$gte"] = desde.strip()
        if hasta.strip():
            filtro["fecha"]["$lte"] = hasta.strip()
    if busqueda.strip():
        rx = {"$regex": busqueda.strip(), "$options": "i"}
        filtro["$or"] = [
            {"folio": rx},
            {"receptor.nombre": rx},
            {"receptor.rfc": rx},
            {"origen_folio": rx},
        ]
    items = await db.facturas.find(filtro, {"historial": 0}).sort("created_at", -1).to_list(500)
    return [serializar(i) for i in items]


@router.get("/resumen")
async def resumen(
    negocio_id: str = Query(...),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    hoy = date.today()
    inicio_mes = hoy.replace(day=1).isoformat()

    async def agregar(match: dict, campo: str) -> tuple[float, int]:
        res = await db.facturas.aggregate([
            {"$match": {"negocio_id": negocio_id, **match}},
            {"$group": {"_id": None, "suma": {"$sum": f"${campo}"}, "n": {"$sum": 1}}},
        ]).to_list(1)
        return (round(res[0]["suma"], 2), res[0]["n"]) if res else (0.0, 0)

    facturado_mes, n_mes   = await agregar({"estado": {"$in": ["emitida", "pagada"]}, "fecha": {"$gte": inicio_mes}}, "total")
    cobrado_mes, _         = await agregar({"estado": {"$in": ["emitida", "pagada"]}, "fecha": {"$gte": inicio_mes}}, "total_pagado")
    por_cobrar, n_abiertas = await agregar({"estado": "emitida"}, "saldo")
    vencido, n_vencidas    = await agregar({"estado": "emitida", "fecha_vencimiento": {"$lt": hoy.isoformat()}}, "saldo")
    borradores = await db.facturas.count_documents({"negocio_id": negocio_id, "estado": "borrador"})

    top = await db.facturas.aggregate([
        {"$match": {"negocio_id": negocio_id, "estado": {"$in": ["emitida", "pagada"]}}},
        {"$group": {"_id": "$receptor.nombre", "total": {"$sum": "$total"}, "facturas": {"$sum": 1}}},
        {"$sort": {"total": -1}},
        {"$limit": 5},
    ]).to_list(5)

    return {
        "facturado_mes":   facturado_mes,
        "facturas_mes":    n_mes,
        "cobrado_mes":     cobrado_mes,
        "por_cobrar":      por_cobrar,
        "facturas_abiertas": n_abiertas,
        "vencido":         vencido,
        "facturas_vencidas": n_vencidas,
        "borradores":      borradores,
        "top_clientes":    [{"receptor": t["_id"] or "—", "total": round(t["total"], 2), "facturas": t["facturas"]} for t in top],
    }


@router.get("/pendientes")
async def pendientes_de_facturar(
    negocio_id: str = Query(...),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Pedidos y órdenes de laboratorio con importe que aún no tienen factura activa."""
    verificar_acceso(user, negocio_id)
    facturados = await db.facturas.find(
        {"negocio_id": negocio_id, "estado": {"$in": ESTADOS_ACTIVOS}, "origen_tipo": {"$ne": "manual"}},
        {"origen_tipo": 1, "origen_id": 1},
    ).to_list(5000)
    ya = {(f["origen_tipo"], f["origen_id"]) for f in facturados}

    pedidos = await db.pedidos.find(
        {"negocio_id": negocio_id, "eliminado": {"$ne": True}, "estado": {"$ne": "cancelado"}, "total": {"$gt": 0}},
        {"numero": 1, "cliente_nombre": 1, "total": 1, "estado": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(300)

    ordenes = await db.ordenes_trabajo.find(
        {"negocio_id": negocio_id, "total": {"$gt": 0}},
        {"folio": 1, "paciente_nombre": 1, "total": 1, "estado": 1, "fecha": 1},
    ).sort("created_at", -1).to_list(300)

    salida = []
    for p in pedidos:
        if ("pedido", str(p["_id"])) in ya:
            continue
        salida.append({
            "origen_tipo": "pedido",
            "origen_id":   str(p["_id"]),
            "folio":       p.get("numero", ""),
            "nombre":      p.get("cliente_nombre", ""),
            "total":       float(p.get("total", 0) or 0),
            "estado":      p.get("estado", ""),
            "fecha":       str(p.get("created_at", ""))[:10],
        })
    for o in ordenes:
        if ("orden_lab", str(o["_id"])) in ya:
            continue
        salida.append({
            "origen_tipo": "orden_lab",
            "origen_id":   str(o["_id"]),
            "folio":       o.get("folio", ""),
            "nombre":      o.get("paciente_nombre", ""),
            "total":       float(o.get("total", 0) or 0),
            "estado":      o.get("estado", ""),
            "fecha":       str(o.get("fecha", ""))[:10],
        })
    salida.sort(key=lambda x: x["fecha"], reverse=True)
    return salida


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("/facturas/{id}")
async def obtener(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    return serializar(await obtener_factura(db, id, user))


@router.post("/facturas", status_code=201)
async def crear_factura(
    body: FacturaCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    await validar_receptor(db, body, body.negocio_id)
    doc = armar_documento(body, body.negocio_id)
    return await insertar_factura(db, doc, "manual", "", user, body.emitir)


@router.put("/facturas/{id}")
async def actualizar_factura(
    id: str,
    body: FacturaBase,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    factura = await obtener_factura(db, id, user)
    if factura["estado"] != "borrador":
        raise HTTPException(400, "Solo se pueden editar facturas en borrador")
    await validar_receptor(db, body, factura["negocio_id"])
    cambios = armar_documento(body, factura["negocio_id"])
    cambios["saldo"] = cambios["total"]
    cambios["updated_at"] = datetime.now(timezone.utc)
    actualizada = await db.facturas.find_one_and_update(
        {"_id": factura["_id"]},
        {"$set": cambios},
        return_document=ReturnDocument.AFTER,
    )
    return serializar(actualizada)


@router.delete("/facturas/{id}")
async def eliminar_borrador(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    factura = await obtener_factura(db, id, user)
    if factura["estado"] != "borrador":
        raise HTTPException(400, "Solo se pueden eliminar borradores; una factura emitida se cancela")
    await db.facturas.delete_one({"_id": factura["_id"]})
    return {"ok": True}


@router.post("/facturas/{id}/emitir")
async def emitir(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    factura = await obtener_factura(db, id, user)
    return serializar(await emitir_doc(db, factura, user))


@router.post("/facturas/{id}/cancelar")
async def cancelar(
    id: str,
    body: CancelarBody,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    factura = await obtener_factura(db, id, user)
    if factura["estado"] != "emitida":
        raise HTTPException(400, f"No se puede cancelar una factura {factura['estado']}")
    if factura.get("uuid"):
        raise HTTPException(400, "La factura está timbrada: cancélala ante el SAT (cancelar-timbre)")
    if factura.get("pagos"):
        raise HTTPException(400, "La factura tiene pagos registrados; elimínalos antes de cancelar")
    now = datetime.now(timezone.utc)
    actualizada = await db.facturas.find_one_and_update(
        {"_id": factura["_id"]},
        {
            "$set": {
                "estado":          "cancelada",
                "motivo_cancelacion": body.motivo.strip(),
                "cancelada_at":    now,
                "saldo":           0.0,
                "updated_at":      now,
            },
            "$push": {"historial": {"accion": "cancelada", "fecha": now, "usuario": user.get("nombre", ""), "nota": body.motivo.strip()}},
        },
        return_document=ReturnDocument.AFTER,
    )
    return serializar(actualizada)


# ── Timbrado SAT ──────────────────────────────────────────────────────────────

@router.post("/facturas/{id}/timbrar")
async def timbrar(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Sella y timbra ante el SAT una factura emitida (CFDI 4.0 de ingreso)."""
    factura = await obtener_factura(db, id, user)
    if factura.get("uuid"):
        raise HTTPException(400, f"La factura ya está timbrada (UUID {factura['uuid']})")
    if factura["estado"] not in ("emitida", "pagada"):
        raise HTTPException(400, f"No se puede timbrar una factura {factura['estado']}; emítela primero")

    now = datetime.now(timezone.utc)
    emisor = await emisor_fiscal(db, factura["negocio_id"])
    xml = await run_in_threadpool(generar_cfdi_ingreso, factura, emisor, now)
    resultado = await timbrar_xml(db, factura["negocio_id"], xml)

    # El timbre ya existe ante el SAT: se guarda sin condiciones para no perder el UUID
    actualizada = await db.facturas.find_one_and_update(
        {"_id": factura["_id"]},
        {"$set": {
            "uuid":               resultado["uuid"],
            "fecha_timbrado":     resultado["fecha_timbrado"],
            "sello_sat":          resultado["sello_sat"],
            "no_certificado_sat": resultado["no_certificado_sat"],
            "xml_timbrado":       resultado["xml_timbrado"],
            "pac":                "SW Sapien",
            "estado_sat":         "Vigente",
            "updated_at":         now,
        },
         "$push": {"historial": {"accion": "timbrada", "fecha": now, "usuario": user.get("nombre", ""),
                                 "nota": f"UUID {resultado['uuid']}"}}},
        return_document=ReturnDocument.AFTER,
    )
    return serializar(actualizada)


@router.post("/facturas/{id}/cancelar-timbre")
async def cancelar_timbre(
    id: str,
    body: CancelarSATBody,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Cancela el CFDI ante el SAT. Si el SAT confirma, la factura queda cancelada; si aún
    está en proceso, se guarda su estado y la factura sigue como emitida.
    """
    factura = await obtener_factura(db, id, user)
    if not factura.get("uuid"):
        raise HTTPException(400, "La factura no está timbrada")
    if factura["estado"] == "cancelada":
        raise HTTPException(400, "La factura ya está cancelada")
    if factura.get("pagos"):
        raise HTTPException(400, "La factura tiene pagos registrados; elimínalos antes de cancelar")

    emisor = await emisor_fiscal(db, factura["negocio_id"])
    respuesta = await cancelar_en_sat(emisor["rfc"], factura["uuid"], body.motivo, body.folio_sustitucion)
    now = datetime.now(timezone.utc)
    aceptada = cancelacion_aceptada(respuesta)
    cambios = {"estado_sat": estado_sat_de(respuesta), "updated_at": now}
    if aceptada:
        cambios.update({
            "estado":             "cancelada",
            "motivo_cancelacion": f"Cancelada ante el SAT (motivo {body.motivo})",
            "cancelada_at":       now,
            "saldo":              0.0,
        })
    nota = f"Cancelación ante el SAT, motivo {body.motivo}: {estado_sat_de(respuesta)}"
    actualizada = await db.facturas.find_one_and_update(
        {"_id": factura["_id"]},
        {"$set": cambios,
         "$push": {"historial": {"accion": "cancelada" if aceptada else "cancelacion_sat_pendiente",
                                 "fecha": now, "usuario": user.get("nombre", ""), "nota": nota}}},
        return_document=ReturnDocument.AFTER,
    )
    return serializar(actualizada)


@router.get("/facturas/{id}/xml-timbrado")
async def xml_timbrado(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    factura = await obtener_factura(db, id, user)
    if not factura.get("xml_timbrado"):
        raise HTTPException(404, "La factura no está timbrada")
    return Response(factura["xml_timbrado"], media_type="application/xml", headers={
        "Content-Disposition": f'attachment; filename="factura-{factura.get("folio") or "sin-folio"}-timbrada.xml"'})


# ── Pagos ─────────────────────────────────────────────────────────────────────

async def _recalcular_pagos(db, factura: dict, pagos: list[dict], accion: dict) -> dict:
    """
    Reescribe la lista de pagos y recalcula saldo/estado. El filtro exige que
    los pagos sigan siendo los que se leyeron, para que dos pagos simultáneos
    no se pisen entre sí.
    """
    total_pagado = round(sum(float(p["monto"]) for p in pagos), 2)
    saldo = round(max(float(factura["total"]) - total_pagado, 0), 2)
    estado = "pagada" if saldo <= 0 else "emitida"
    now = datetime.now(timezone.utc)
    actualizada = await db.facturas.find_one_and_update(
        {"_id": factura["_id"], "pagos": factura.get("pagos", [])},
        {
            "$set": {"pagos": pagos, "total_pagado": total_pagado, "saldo": saldo, "estado": estado, "updated_at": now},
            "$push": {"historial": {**accion, "fecha": now}},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not actualizada:
        raise HTTPException(409, "La factura cambió mientras se guardaba; recárgala e intenta de nuevo")
    return actualizada


def _fecha_cobro(fecha: str) -> datetime:
    """Los cobros de Finanzas guardan datetime UTC sin zona."""
    if not fecha or fecha == hoy_iso():
        return datetime.utcnow()
    try:
        return datetime.fromisoformat(fecha)
    except ValueError:
        raise HTTPException(400, "Fecha de pago inválida")


@router.post("/facturas/{id}/pagos", status_code=201)
async def registrar_pago(
    id: str,
    body: PagoCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Registra el pago en la factura y, en Finanzas, el cobro con su
    movimiento de ingreso en la cuenta elegida. La póliza del cobro
    (Caja/Bancos contra Clientes) solo se genera cuando la factura viene
    de un pedido, porque solo los pedidos tienen póliza de venta que
    abra la cuenta por cobrar.
    """
    factura = await obtener_factura(db, id, user)
    if factura["estado"] != "emitida":
        raise HTTPException(400, "Solo se registran pagos en facturas emitidas con saldo")
    saldo = float(factura.get("saldo", 0))
    if body.monto > saldo + 0.009:
        raise HTTPException(400, f"El pago excede el saldo pendiente ({saldo:,.2f})")

    cuenta = None
    if ObjectId.is_valid(body.cuenta_id):
        cuenta = await db.cuentas_financieras.find_one({
            "_id": ObjectId(body.cuenta_id), "negocio_id": factura["negocio_id"], "activo": True,
        })
    if not cuenta:
        raise HTTPException(404, "Cuenta financiera no encontrada o inactiva")

    usuario_id = str(user.get("_id", ""))
    fecha = body.fecha or hoy_iso()
    pago = {
        "id":            uuid.uuid4().hex[:8],
        "monto":         round(body.monto, 2),
        "forma_pago":    body.forma_pago,
        "fecha":         fecha,
        "referencia":    body.referencia.strip(),
        "usuario":       user.get("nombre", ""),
        "cuenta_id":     body.cuenta_id,
        "cuenta_nombre": cuenta.get("nombre", ""),
        "cobro_id":      None,
        "cobro_numero":  None,
        "poliza_id":     None,
    }

    # 1. Apartar el pago en la factura (falla si otro pago entró antes).
    factura_nueva = await _recalcular_pagos(
        db, factura, factura.get("pagos", []) + [pago],
        {"accion": "pago", "usuario": user.get("nombre", ""), "nota": f"{pago['monto']:,.2f}"},
    )

    # 2. Cobro + movimiento financiero. Si falla, se retira el pago.
    try:
        cobro = await registrar_cobro(
            db,
            {
                "negocio_id":    factura["negocio_id"],
                "cuenta_id":     body.cuenta_id,
                "importe":       pago["monto"],
                "pedido_id":     factura["origen_id"] if factura.get("origen_tipo") == "pedido" else None,
                "cliente_id":    factura.get("cliente_id") or None,
                "factura_id":    id,
                "factura_folio": factura.get("folio", ""),
                "metodo_pago":   FORMAS_PAGO.get(body.forma_pago, "otro").lower().replace(" ", "_"),
                "referencia":    pago["referencia"],
                "concepto":      f"Pago factura {factura.get('folio', '')} · {factura['receptor'].get('nombre', '')}".strip(" ·"),
                "fecha":         _fecha_cobro(fecha),
            },
            cuenta,
            usuario_id=usuario_id,
            generar_poliza=False,
        )
    except Exception:
        await _recalcular_pagos(
            db, factura_nueva, factura.get("pagos", []),
            {"accion": "pago_revertido", "usuario": user.get("nombre", ""), "nota": "Error al registrar el cobro en Finanzas"},
        )
        raise

    cambios = {"pagos.$.cobro_id": str(cobro["_id"]), "pagos.$.cobro_numero": cobro["numero"]}

    # 3. Póliza contable (no bloquea el pago si falta el catálogo de cuentas).
    if factura.get("origen_tipo") == "pedido":
        try:
            poliza_id = await crear_poliza_cobro(db, cobro, cuenta_financiera=cuenta, usuario_id=usuario_id)
            cambios["pagos.$.poliza_id"] = poliza_id
            if poliza_id:
                await db.cobros.update_one({"_id": cobro["_id"]}, {"$set": {"poliza_id": poliza_id}})
        except RuntimeError as e:
            cambios["pagos.$.poliza_error"] = str(e)

    actualizada = await db.facturas.find_one_and_update(
        {"_id": factura["_id"], "pagos.id": pago["id"]},
        {"$set": cambios},
        return_document=ReturnDocument.AFTER,
    )
    return serializar(actualizada)


@router.delete("/facturas/{id}/pagos/{pago_id}")
async def eliminar_pago(
    id: str,
    pago_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Quita el pago de la factura y cancela su cobro, movimiento y póliza."""
    factura = await obtener_factura(db, id, user)
    if factura["estado"] not in ("emitida", "pagada"):
        raise HTTPException(400, "La factura no admite cambios en pagos")
    pago = next((p for p in factura.get("pagos", []) if p["id"] == pago_id), None)
    if not pago:
        raise HTTPException(404, "Pago no encontrado")
    pagos = [p for p in factura["pagos"] if p["id"] != pago_id]
    actualizada = await _recalcular_pagos(
        db, factura, pagos,
        {"accion": "pago_eliminado", "usuario": user.get("nombre", ""), "nota": f"{pago['monto']:,.2f}"},
    )
    await cancelar_cobro(
        db, pago.get("cobro_id"), str(user.get("_id", "")),
        motivo=f"Pago eliminado de la factura {factura.get('folio', '')}",
    )
    return serializar(actualizada)


# ── Facturación en un clic ────────────────────────────────────────────────────

@router.post("/desde-pedido/{pedido_id}", status_code=201)
async def facturar_pedido(
    pedido_id: str,
    emitir: bool = Query(False),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    pedido = await db.pedidos.find_one({"_id": validar_oid(pedido_id)})
    if not pedido or pedido.get("eliminado"):
        raise HTTPException(404, "Pedido no encontrado")
    verificar_acceso(user, pedido["negocio_id"])
    if pedido.get("estado") == "cancelado":
        raise HTTPException(400, "No se puede facturar un pedido cancelado")
    await validar_origen_libre(db, pedido["negocio_id"], "pedido", pedido_id)

    cliente = {}
    if pedido.get("cliente_id") and ObjectId.is_valid(pedido["cliente_id"]):
        cliente = await db.clientes.find_one(
            {"_id": ObjectId(pedido["cliente_id"])}
        ) or {}

    conceptos = []
    for it in pedido.get("items", []):
        conceptos.append(Concepto(
            descripcion=it.get("nombre") or it.get("descripcion") or "Producto",
            clave=it.get("sku") or it.get("codigo") or "",
            unidad="Pieza",
            cantidad=float(it.get("cantidad", 1) or 1),
            precio_unitario=float(it.get("precio_unitario", 0) or 0),
            descuento=float(it.get("descuento", 0) or 0),
            iva_tasa=(float(it.get("iva_pct", 16) or 0) / 100) if it.get("iva_aplicable", True) is not False else 0,
        ))
    if not conceptos:
        raise HTTPException(400, "El pedido no tiene partidas para facturar")

    body = FacturaBase(
        receptor=Receptor(
            nombre=cliente.get("razon_social") or cliente.get("nombre") or pedido.get("cliente_nombre", ""),
            rfc=cliente.get("rfc") or RFC_PUBLICO_GENERAL,
            email=cliente.get("email", ""),
            telefono=cliente.get("telefono", ""),
            direccion=cliente.get("direccion", ""),
            cp=cliente.get("cp", "") or cliente.get("codigo_postal", ""),
        ),
        cliente_id=str(pedido["cliente_id"]) if pedido.get("cliente_id") else None,
        conceptos=conceptos,
        descuento_general=float(pedido.get("descuento", 0) or 0),
        metodo_pago="PUE" if float(pedido.get("saldo_pendiente", 0) or 0) <= 0 else "PPD",
    )
    doc = armar_documento(body, pedido["negocio_id"])
    doc["origen_folio"] = pedido.get("numero", "")
    return await insertar_factura(db, doc, "pedido", pedido_id, user, emitir)


@router.post("/desde-orden/{orden_id}", status_code=201)
async def facturar_orden(
    orden_id: str,
    emitir: bool = Query(False),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    orden = await db.ordenes_trabajo.find_one({"_id": validar_oid(orden_id)})
    if not orden:
        raise HTTPException(404, "Orden no encontrada")
    verificar_acceso(user, orden["negocio_id"])
    await validar_origen_libre(db, orden["negocio_id"], "orden_lab", orden_id)

    paciente = {}
    if orden.get("paciente_id") and ObjectId.is_valid(orden["paciente_id"]):
        paciente = await db.pacientes.find_one(
            {"_id": ObjectId(orden["paciente_id"]), "negocio_id": orden["negocio_id"]}
        ) or {}

    # Los análisis clínicos suelen estar exentos de IVA; el precio de la orden
    # ya es el total, por eso iva_tasa = 0 (editable mientras sea borrador).
    conceptos = [
        Concepto(
            descripcion=e.get("nombre", "Estudio"),
            clave=e.get("codigo", ""),
            unidad="Servicio",
            cantidad=1,
            precio_unitario=float(e.get("precio", 0) or 0),
            iva_tasa=0,
        )
        for e in orden.get("estudios", [])
    ]
    if not conceptos:
        raise HTTPException(400, "La orden no tiene estudios para facturar")

    body = FacturaBase(
        receptor=Receptor(
            nombre=orden.get("paciente_nombre", ""),
            rfc=paciente.get("rfc") or RFC_PUBLICO_GENERAL,
            email=paciente.get("email", "") or "",
            telefono=paciente.get("telefono", "") or "",
            uso_cfdi="D01",
        ),
        paciente_id=str(orden.get("paciente_id") or ""),
        conceptos=conceptos,
        notas=f"Médico solicitante: {orden['medico_solicitante']}" if orden.get("medico_solicitante") else "",
    )
    doc = armar_documento(body, orden["negocio_id"])
    doc["origen_folio"] = orden.get("folio", "")
    return await insertar_factura(db, doc, "orden_lab", orden_id, user, emitir)


# ── PDF ───────────────────────────────────────────────────────────────────────


def _money(n) -> str:
    return f"${float(n or 0):,.2f}"


@router.get("/facturas/{id}/pdf")
async def pdf_factura(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    f = await obtener_factura(db, id, user)
    config = await db.config_negocios.find_one({"_id": f["negocio_id"]}) or {}
    emisor   = config.get("nombre", "")
    rfc_em   = config.get("rfc", "")
    dir_em   = "  ·  ".join(p for p in [config.get("direccion", ""), config.get("colonia", ""), config.get("ciudad", ""),
                                         f"C.P. {config['cp']}" if config.get("cp") else ""] if p)
    contacto = "  ·  ".join(p for p in [f"Tel: {config['telefono']}" if config.get("telefono") else "",
                                         config.get("email", "")] if p)

    azul   = colors.HexColor("#1d4ed8")
    gris   = colors.HexColor("#64748b")
    oscuro = colors.HexColor("#0f172a")

    sEm   = ParagraphStyle("em",   fontSize=15, fontName="Helvetica-Bold", textColor=oscuro, leading=18)
    sSm   = ParagraphStyle("sm",   fontSize=8,  textColor=gris, leading=11)
    sTit  = ParagraphStyle("tit",  fontSize=13, fontName="Helvetica-Bold", textColor=azul, alignment=TA_RIGHT)
    sFol  = ParagraphStyle("fol",  fontSize=9,  textColor=oscuro, alignment=TA_RIGHT, leading=13)
    sLbl  = ParagraphStyle("lbl",  fontSize=7.5, fontName="Helvetica-Bold", textColor=gris)
    sVal  = ParagraphStyle("val",  fontSize=9,  textColor=oscuro, leading=12)
    sCell = ParagraphStyle("cell", fontSize=8.5, textColor=oscuro, leading=11)
    sNote = ParagraphStyle("note", fontSize=7.5, textColor=gris, alignment=TA_CENTER)

    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, rightMargin=15 * mm, leftMargin=15 * mm,
                            topMargin=14 * mm, bottomMargin=14 * mm)
    story = []

    folio = f.get("folio") or "BORRADOR"
    estado_txt = {"borrador": "BORRADOR", "emitida": "EMITIDA", "pagada": "PAGADA", "cancelada": "CANCELADA"}[f["estado"]]
    header = Table([[
        Paragraph(emisor or "Emisor", sEm),
        Paragraph("FACTURA", sTit),
    ], [
        Paragraph("<br/>".join(p for p in [f"RFC: {rfc_em}" if rfc_em else "", dir_em, contacto] if p), sSm),
        Paragraph(f"<b>Folio:</b> {folio}<br/><b>Fecha:</b> {f['fecha']}<br/>"
                  f"<b>Vence:</b> {f['fecha_vencimiento']}<br/><b>Estado:</b> {estado_txt}", sFol),
    ]], colWidths=["60%", "40%"])
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story += [header, HRFlowable(width="100%", thickness=2, color=azul, spaceBefore=4, spaceAfter=8)]

    r = f["receptor"]
    receptor_tbl = Table([
        [Paragraph("RECEPTOR", sLbl), Paragraph("RFC", sLbl), Paragraph("USO CFDI", sLbl), Paragraph("MÉTODO / FORMA", sLbl)],
        [Paragraph(r.get("nombre", ""), sVal), Paragraph(r.get("rfc", ""), sVal), Paragraph(r.get("uso_cfdi", ""), sVal),
         Paragraph(f"{f['metodo_pago']} / {FORMAS_PAGO.get(f['forma_pago'], f['forma_pago'])}", sVal)],
    ], colWidths=["40%", "20%", "15%", "25%"])
    receptor_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story += [receptor_tbl, Spacer(1, 10)]

    filas = [["Clave", "Descripción", "Cant.", "P. unitario", "Desc.", "IVA", "Importe"]]
    for c in f["conceptos"]:
        filas.append([
            Paragraph(c.get("clave", ""), sCell),
            Paragraph(c["descripcion"], sCell),
            f"{c['cantidad']:g}",
            _money(c["precio_unitario"]),
            _money(c.get("descuento", 0)) if c.get("descuento") else "—",
            f"{c.get('iva_tasa', 0) * 100:g}%",
            _money(c["importe"]),
        ])
    tabla = Table(filas, colWidths=[22 * mm, 66 * mm, 14 * mm, 24 * mm, 18 * mm, 14 * mm, 24 * mm], repeatRows=1)
    tabla.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), azul),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
        ("LINEBELOW", (0, -1), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
    ]))
    story += [tabla, Spacer(1, 8)]

    tot_rows = [["Subtotal", _money(f["subtotal"])]]
    if f.get("descuento"):
        tot_rows.append(["Descuento", f"-{_money(f['descuento'])}"])
    tot_rows += [["IVA", _money(f["iva"])], [f"Total {f.get('moneda', 'MXN')}", _money(f["total"])]]
    if f.get("total_pagado"):
        tot_rows += [["Pagado", _money(f["total_pagado"])], ["Saldo", _money(f["saldo"])]]
    tot = Table(tot_rows, colWidths=[30 * mm, 30 * mm], hAlign="RIGHT")
    tot.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("FONTNAME", (0, 3 if f.get("descuento") else 2), (-1, 3 if f.get("descuento") else 2), "Helvetica-Bold"),
        ("LINEABOVE", (0, 3 if f.get("descuento") else 2), (-1, 3 if f.get("descuento") else 2), 0.8, oscuro),
    ]))
    story.append(tot)

    if f.get("notas"):
        story += [Spacer(1, 10), Paragraph("NOTAS", sLbl), Paragraph(f["notas"], sVal)]
    if f["estado"] == "cancelada":
        story += [Spacer(1, 10), Paragraph(f"<font color='#b91c1c'><b>FACTURA CANCELADA</b> {f.get('motivo_cancelacion', '')}</font>", sVal)]

    story += [Spacer(1, 18), HRFlowable(width="100%", thickness=0.4, color=colors.HexColor("#cbd5e1"), spaceAfter=4)]
    if f.get("uuid"):
        qr = Image(BytesIO(qr_png(url_desde_xml(f["xml_timbrado"]))), width=26 * mm, height=26 * mm)
        datos = Paragraph(f"<b>Folio fiscal (UUID):</b> {f['uuid']}<br/>Fecha de certificación: {f.get('fecha_timbrado', '')}"
                          "<br/>CFDI de ingreso verificable en el portal del SAT con el código QR.", sVal)
        story.append(Table([[qr, datos]], colWidths=[30 * mm, 150 * mm], style=[("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    else:
        story.append(Paragraph("Comprobante interno sin validez fiscal (no timbrado ante el SAT).", sNote))

    doc.build(story)
    buf.seek(0)
    nombre = f"factura-{f.get('folio') or 'borrador'}.pdf"
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f'inline; filename="{nombre}"'})
