"""
Leads del CRM: prospectos que todavía no se calificaron.

Un lead tiene su propio pipeline (LEAD_ETAPAS) por negocio. Al calificarlo se convierte:
se crea (o se reutiliza) el cliente, se abre una oportunidad en la primera etapa del
pipeline de oportunidades y el lead queda inactivo, con la referencia a esa oportunidad.
Un lead descartado queda inactivo con su motivo.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from ..core.database import get_db
from ..core.negocios import obtener_del_negocio, verificar_acceso
from ..core.security import get_current_user
from ..models.base import serialize_doc
from ..models.crm import CanalOrigen, NegocioId, TipoLead
from .crm import buscar_duplicado, config_crm


router = APIRouter(prefix="/crm/leads", tags=["CRM Leads"])

# Pipeline de leads, igual para todos los negocios. El descarte no es una etapa: deja el lead inactivo.
LEAD_ETAPAS = ["Nuevo", "Contactado", "Calificado"]


def ahora() -> datetime:
    return datetime.now(timezone.utc)


# ──────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ──────────────────────────────────────────────────────────────────────────────

class LeadCreate(BaseModel):
    negocio_id: NegocioId
    empresa: str = Field(min_length=1)
    contacto: str = ""
    telefono: str = Field(min_length=1)
    correo: Optional[str] = None
    canal_origen: CanalOrigen = "directo"
    notas: str = ""


class LeadUpdate(BaseModel):
    empresa: Optional[str] = Field(default=None, min_length=1)
    contacto: Optional[str] = None
    telefono: Optional[str] = Field(default=None, min_length=1)
    correo: Optional[str] = None
    canal_origen: Optional[CanalOrigen] = None
    notas: Optional[str] = None


class EtapaLeadIn(BaseModel):
    etapa: str


class ConvertirLeadIn(BaseModel):
    tipo_lead: Optional[TipoLead] = None
    valor_estimado: Optional[float] = Field(default=None, ge=0)


class DescartarLeadIn(BaseModel):
    motivo: str = Field(min_length=1)


# ──────────────────────────────────────────────────────────────────────────────
# Tablero
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/kanban/{negocio_id}")
async def kanban_leads(
    negocio_id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    docs = await db.leads.find({"negocio_id": negocio_id, "activo": True}).sort("updated_at", -1).to_list(500)

    columnas = {etapa: [] for etapa in LEAD_ETAPAS}
    for doc in docs:
        if doc.get("etapa") in columnas:
            columnas[doc["etapa"]].append(serialize_doc(doc))
    return {"data": [{"etapa": e, "leads": columnas[e]} for e in LEAD_ETAPAS]}


# ──────────────────────────────────────────────────────────────────────────────
# Alta, edición y movimiento
# ──────────────────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def crear_lead(
    body: LeadCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    marca = ahora()
    doc = {
        **body.model_dump(),
        "empresa": body.empresa.strip(),
        "etapa": LEAD_ETAPAS[0],
        "activo": True,
        "cliente_id": None,
        "oportunidad_id": None,
        "motivo_descarte": "",
        "creado_por": user["_id"],
        "created_at": marca,
        "updated_at": marca,
    }
    resultado = await db.leads.insert_one(doc)
    doc["_id"] = resultado.inserted_id
    return serialize_doc(doc)


@router.put("/{lead_id}")
async def actualizar_lead(
    lead_id: str,
    body: LeadUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    lead = await obtener_del_negocio(db.leads, lead_id, user, "Lead")
    if not lead.get("activo"):
        raise HTTPException(status_code=400, detail="El lead está cerrado; no se puede editar")

    campos = body.model_dump(exclude_none=True)
    if not campos:
        raise HTTPException(status_code=400, detail="Sin campos a actualizar")
    if "empresa" in campos:
        campos["empresa"] = campos["empresa"].strip()
    campos["updated_at"] = ahora()

    doc = await db.leads.find_one_and_update(
        {"_id": lead["_id"]}, {"$set": campos}, return_document=ReturnDocument.AFTER,
    )
    return serialize_doc(doc)


@router.put("/{lead_id}/etapa")
async def mover_etapa_lead(
    lead_id: str,
    body: EtapaLeadIn,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    lead = await obtener_del_negocio(db.leads, lead_id, user, "Lead")
    if not lead.get("activo"):
        raise HTTPException(status_code=400, detail="El lead está cerrado; no se puede mover de etapa")
    if lead["etapa"] == body.etapa:
        raise HTTPException(status_code=400, detail="El lead ya está en esa etapa")
    if body.etapa not in LEAD_ETAPAS:
        raise HTTPException(status_code=400, detail=f"La etapa '{body.etapa}' no existe en el pipeline de leads")

    # Condicional a la etapa actual: dos arrastres simultáneos no se pisan en silencio
    doc = await db.leads.find_one_and_update(
        {"_id": lead["_id"], "etapa": lead["etapa"], "activo": True},
        {"$set": {"etapa": body.etapa, "updated_at": ahora()}},
        return_document=ReturnDocument.AFTER,
    )
    if not doc:
        raise HTTPException(status_code=409, detail="El lead cambió mientras lo movías; recarga el tablero")
    return serialize_doc(doc)


# ──────────────────────────────────────────────────────────────────────────────
# Conversión y descarte
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/{lead_id}/convertir", status_code=201)
async def convertir_lead(
    lead_id: str,
    body: ConvertirLeadIn,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    lead = await obtener_del_negocio(db.leads, lead_id, user, "Lead")
    if not lead.get("activo"):
        raise HTTPException(status_code=400, detail="El lead ya está cerrado")

    # Valida el pipeline antes de escribir nada (en Bienes Raíces exige tipo_lead)
    pipeline, terminales = await config_crm(db, lead["negocio_id"], body.tipo_lead)
    etapa_inicial = pipeline[0]

    marca = ahora()
    cliente = await buscar_duplicado(db, lead["empresa"], lead["telefono"])
    if not cliente:
        cliente_doc = {
            "empresa": lead["empresa"],
            "contacto": lead.get("contacto", ""),
            "telefono": lead["telefono"],
            "correo": lead.get("correo"),
            "canal_origen": lead.get("canal_origen", "directo"),
            "tags": [],
            "notas": lead.get("notas", ""),
            "creado_por": user["_id"],
            "activo": True,
            "created_at": marca,
            "updated_at": marca,
        }
        resultado = await db.clientes.insert_one(cliente_doc)
        cliente_doc["_id"] = resultado.inserted_id
        cliente = cliente_doc

    oportunidad = {
        "cliente_id": cliente["_id"],
        "negocio_id": lead["negocio_id"],
        "etapa": etapa_inicial,
        "tipo_lead": body.tipo_lead,
        "valor_estimado": body.valor_estimado,
        "fecha_cierre_estimada": None,
        "activo": etapa_inicial not in terminales,
        "origen_lead_id": lead["_id"],
        "created_at": marca,
        "updated_at": marca,
    }
    resultado = await db.oportunidades.insert_one(oportunidad)
    oportunidad["_id"] = resultado.inserted_id

    # Condicional a activo: un lead convertido dos veces no abre dos oportunidades
    actualizado = await db.leads.find_one_and_update(
        {"_id": lead["_id"], "activo": True},
        {"$set": {
            "activo": False,
            "cliente_id": cliente["_id"],
            "oportunidad_id": oportunidad["_id"],
            "updated_at": marca,
        }},
        return_document=ReturnDocument.AFTER,
    )
    if not actualizado:
        await db.oportunidades.delete_one({"_id": oportunidad["_id"]})
        raise HTTPException(status_code=409, detail="El lead ya fue convertido o cerrado")

    return {
        "lead": serialize_doc(actualizado),
        "oportunidad": serialize_doc(oportunidad),
        "cliente": serialize_doc(cliente),
    }


@router.post("/{lead_id}/descartar")
async def descartar_lead(
    lead_id: str,
    body: DescartarLeadIn,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    lead = await obtener_del_negocio(db.leads, lead_id, user, "Lead")
    if not lead.get("activo"):
        raise HTTPException(status_code=400, detail="El lead ya está cerrado")

    doc = await db.leads.find_one_and_update(
        {"_id": lead["_id"], "activo": True},
        {"$set": {"activo": False, "motivo_descarte": body.motivo.strip(), "updated_at": ahora()}},
        return_document=ReturnDocument.AFTER,
    )
    if not doc:
        raise HTTPException(status_code=409, detail="El lead ya fue cerrado")
    return serialize_doc(doc)
