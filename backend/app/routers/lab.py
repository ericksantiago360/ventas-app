from datetime import datetime, timezone, date
from typing import Optional, Literal, List

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field, model_validator

from app.core.database import get_db
from app.core.permissions import exigir_permiso
from app.core.security import get_current_user
from app.core.negocios import negocios_del_usuario, validar_referencia, verificar_acceso
from app.modules.clinica.routes.expedientes import validar_medico
from app.routers.pacientes import calcular_edad
from app.services.rangos_lab import (
    RANGOS_SEED, calcular_flag, catalogo_de_rangos, normalizar, referencia_de_plantilla, resolver_referencia,
)
from app.services.reporte_lab import generar_pdf_resultados, nombre_archivo_pdf
from app.services.correo import CorreoError, correo_configurado
from app.services.notificaciones_lab import enviar_resultados, url_publica

router = APIRouter(prefix="/lab", tags=["Laboratorio"])

ESTADOS_ORDEN    = Literal["pendiente", "en_proceso", "completado", "entregado"]
ESTADOS_RESULT   = Literal["pendiente", "capturado", "validado"]
FLAGS            = Literal["pendiente", "normal", "alto", "bajo", "critico"]
TIPOS_MUESTRA    = Literal["sangre", "orina", "heces", "cultivo", "otro"]
SEXOS_RANGO      = Literal["ambos", "masculino", "femenino"]
MEDIOS_AVISO     = Literal["telefono", "en_persona", "correo", "mensaje", "otro"]


# ── Utilidades ────────────────────────────────────────────────────────────────

def serializar(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    return doc


def validar_oid(id: str) -> ObjectId:
    try:
        return ObjectId(id)
    except Exception:
        raise HTTPException(400, "ID inválido")


async def siguiente_folio(db, coleccion: str, negocio_id: str, prefijo: str) -> str:
    counter = await db.counters.find_one_and_update(
        {"_id": f"{coleccion}_{negocio_id}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    return f"{prefijo}-{str(counter['seq']).zfill(5)}"


def criticos_de(resultados: list[dict]) -> list[dict]:
    return [
        {"estudio": r.get("estudio_nombre", ""), "analito": a.get("nombre", ""), "valor": a.get("valor", ""), "unidad": a.get("unidad", "")}
        for r in resultados for a in r.get("analitos", []) if a.get("flag") == "critico"
    ]


async def actualizar_criticos(db, orden_id: str, now: datetime) -> None:
    """
    Marca la orden con resultados críticos. Queda como notificada solo si el médico ya
    recibió aviso de todos los críticos actuales: uno nuevo vuelve a pedir aviso.
    """
    resultados = await db.resultados_lab.find({"orden_id": orden_id}, {"estudio_nombre": 1, "analitos": 1}).to_list(50)
    criticos = criticos_de(resultados)
    orden = await db.ordenes_trabajo.find_one({"_id": validar_oid(orden_id)}, {"criticos_notificados": 1})
    avisados = orden.get("criticos_notificados", []) if orden else []
    claves = lambda lista: {(c["estudio"], c["analito"], c["valor"]) for c in lista}
    await db.ordenes_trabajo.update_one({"_id": validar_oid(orden_id)}, {"$set": {
        "resultados_criticos": bool(criticos),
        "criticos":            criticos,
        "notificado_medico":   bool(criticos) and claves(criticos) <= claves(avisados),
        "updated_at":          now,
    }})


# ── Pydantic models ───────────────────────────────────────────────────────────

class AnalitoBase(BaseModel):
    nombre: str
    unidad: str = ""
    tipo: Literal["numerico", "cualitativo"] = "numerico"
    referencia_hombre_min: Optional[float] = None
    referencia_hombre_max: Optional[float] = None
    referencia_mujer_min: Optional[float] = None
    referencia_mujer_max: Optional[float] = None
    referencia_texto: str = ""


class PlantillaCreate(BaseModel):
    negocio_id: str
    codigo: str
    nombre: str
    categoria: str = ""
    muestra: str = "Sangre"
    tiempo_entrega: int = Field(default=2, ge=0)   # horas
    precio: float = Field(default=0.0, ge=0)
    analitos: List[AnalitoBase] = []


class PlantillaUpdate(BaseModel):
    codigo: Optional[str] = None
    nombre: Optional[str] = None
    categoria: Optional[str] = None
    muestra: Optional[str] = None
    tiempo_entrega: Optional[int] = None
    precio: Optional[float] = None
    analitos: Optional[List[AnalitoBase]] = None


class EstudioOrden(BaseModel):
    plantilla_id: str


class OrdenCreate(BaseModel):
    negocio_id: str
    paciente_id: str = ""         # o expediente_id: se toma su paciente
    expediente_id: str = ""       # vacío: se liga al expediente del paciente si tiene
    medico_solicitante: str = ""  # nombre (médico externo o el de la clínica)
    medico_solicitante_id: str = ""
    urgente: bool = False
    fecha: str                    # YYYY-MM-DD
    observaciones: str = ""
    estudios: List[EstudioOrden]  # lista de plantilla_ids


class MuestraRegistro(BaseModel):
    tipo: TIPOS_MUESTRA = "sangre"
    fecha_toma: Optional[datetime] = None   # vacío → ahora
    tecnico_id: str = ""                    # vacío → quien registra
    observaciones: str = ""


class NotificacionCritico(BaseModel):
    notificado_a: str = Field(min_length=1, max_length=120)   # quién recibió el aviso
    medio: MEDIOS_AVISO = "telefono"
    nota: str = ""


class RangoEdad(BaseModel):
    sexo: SEXOS_RANGO = "ambos"
    edad_min: int = Field(default=0, ge=0, le=999)
    edad_max: int = Field(default=999, ge=0, le=999)
    min: float
    max: float
    critico_min: Optional[float] = None
    critico_max: Optional[float] = None

    @model_validator(mode="after")
    def coherente(self):
        if self.edad_min > self.edad_max:
            raise ValueError("La edad mínima no puede ser mayor que la máxima")
        if self.min > self.max:
            raise ValueError("El mínimo de referencia no puede ser mayor que el máximo")
        if self.critico_min is not None and self.critico_min > self.min:
            raise ValueError("El crítico bajo debe ser menor o igual al mínimo de referencia")
        if self.critico_max is not None and self.critico_max < self.max:
            raise ValueError("El crítico alto debe ser mayor o igual al máximo de referencia")
        return self


class RangoParametro(BaseModel):
    negocio_id: str
    parametro: str = Field(min_length=1, max_length=120)
    unidad: str = ""
    aliases: List[str] = []
    rangos: List[RangoEdad] = Field(min_length=1)


class RangoParametroUpdate(BaseModel):
    parametro: Optional[str] = Field(default=None, min_length=1, max_length=120)
    unidad: Optional[str] = None
    aliases: Optional[List[str]] = None
    rangos: Optional[List[RangoEdad]] = Field(default=None, min_length=1)


class AnalitoResultado(BaseModel):
    nombre: str
    valor: str = ""
    unidad: str = ""
    tipo: Literal["numerico", "cualitativo"] = "numerico"
    referencia_hombre_min: Optional[float] = None
    referencia_hombre_max: Optional[float] = None
    referencia_mujer_min: Optional[float] = None
    referencia_mujer_max: Optional[float] = None
    referencia_texto: str = ""
    flag: FLAGS = "pendiente"


class EnvioCorreo(BaseModel):
    email: str = ""               # vacío → correo registrado del paciente
    mensaje: str = ""
    marcar_entregado: bool = True


class ResultadoCaptura(BaseModel):
    analitos: List[AnalitoResultado]      # de cada analito solo se toma el valor; lo demás es de la orden
    observaciones: str = ""
    tecnico_nombre: str = ""


# ── PLANTILLAS ────────────────────────────────────────────────────────────────

@router.get("/plantillas")
async def listar_plantillas(
    negocio_id: str = Query(...),
    categoria: str = Query(""),
    busqueda: str = Query(""),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    exigir_permiso(user, negocio_id, "lab:read", sin_rol_permitido=True)
    filtro: dict = {"negocio_id": negocio_id, "activo": True}
    if categoria.strip():
        filtro["categoria"] = categoria.strip()
    if busqueda.strip():
        filtro["$or"] = [
            {"nombre":   {"$regex": busqueda.strip(), "$options": "i"}},
            {"codigo":   {"$regex": busqueda.strip(), "$options": "i"}},
            {"categoria":{"$regex": busqueda.strip(), "$options": "i"}},
        ]
    items = await db.plantillas_estudios.find(filtro).sort([("categoria", 1), ("nombre", 1)]).to_list(500)
    return [serializar(i) for i in items]


@router.post("/plantillas", status_code=201)
async def crear_plantilla(
    body: PlantillaCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    exigir_permiso(user, body.negocio_id, "lab:config", sin_rol_permitido=True)
    now = datetime.now(timezone.utc)
    doc = {
        **body.model_dump(),
        "analitos": [a.model_dump() for a in body.analitos],
        "activo":     True,
        "created_at": now,
        "updated_at": now,
    }
    result = await db.plantillas_estudios.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serializar(doc)


@router.put("/plantillas/{id}")
async def actualizar_plantilla(
    id: str,
    body: PlantillaUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(id)
    plantilla = await db.plantillas_estudios.find_one({"_id": oid})
    if not plantilla:
        raise HTTPException(404, "Plantilla no encontrada")
    verificar_acceso(user, plantilla["negocio_id"])
    exigir_permiso(user, plantilla["negocio_id"], "lab:config", sin_rol_permitido=True)

    campos = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if "analitos" in campos:
        campos["analitos"] = [a.model_dump() for a in body.analitos]
    if not campos:
        raise HTTPException(400, "Sin campos a actualizar")
    campos["updated_at"] = datetime.now(timezone.utc)
    doc = await db.plantillas_estudios.find_one_and_update(
        {"_id": oid}, {"$set": campos}, return_document=True
    )
    return serializar(doc)


@router.delete("/plantillas/{id}")
async def desactivar_plantilla(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(id)
    plantilla = await db.plantillas_estudios.find_one({"_id": oid})
    if not plantilla:
        raise HTTPException(404, "Plantilla no encontrada")
    verificar_acceso(user, plantilla["negocio_id"])
    exigir_permiso(user, plantilla["negocio_id"], "lab:config", sin_rol_permitido=True)
    await db.plantillas_estudios.update_one(
        {"_id": oid},
        {"$set": {"activo": False, "updated_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True}


@router.post("/plantillas/seed", status_code=201)
async def seed_plantillas(
    negocio_id: str = Query(...),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    exigir_permiso(user, negocio_id, "lab:config", sin_rol_permitido=True)
    now = datetime.now(timezone.utc)
    creados = 0
    for est in ESTUDIOS_SEED:
        existente = await db.plantillas_estudios.find_one(
            {"negocio_id": negocio_id, "codigo": est["codigo"]}
        )
        if existente:
            continue
        await db.plantillas_estudios.insert_one({
            **est,
            "negocio_id": negocio_id,
            "activo":     True,
            "created_at": now,
            "updated_at": now,
        })
        creados += 1
    return {"creados": creados, "total_seed": len(ESTUDIOS_SEED)}


# ── ÓRDENES DE TRABAJO ────────────────────────────────────────────────────────

@router.get("/ordenes")
async def listar_ordenes(
    negocio_id: str = Query(...),
    fecha: str = Query(""),
    estado: str = Query(""),
    paciente_id: str = Query(""),
    expediente_id: str = Query(""),
    busqueda: str = Query(""),
    criticos: bool = Query(False, description="Solo con resultados críticos sin notificar al médico"),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    exigir_permiso(user, negocio_id, "lab:read", sin_rol_permitido=True)
    filtro: dict = {"negocio_id": negocio_id}
    if expediente_id.strip():
        filtro["expediente_id"] = expediente_id.strip()
    if criticos:
        filtro.update({"resultados_criticos": True, "notificado_medico": False})
    if fecha.strip():
        filtro["fecha"] = fecha.strip()
    if estado.strip():
        filtro["estado"] = estado.strip()
    if paciente_id.strip():
        filtro["paciente_id"] = paciente_id.strip()
    if busqueda.strip():
        filtro["$or"] = [
            {"folio":            {"$regex": busqueda.strip(), "$options": "i"}},
            {"paciente_nombre":  {"$regex": busqueda.strip(), "$options": "i"}},
            {"medico_solicitante":{"$regex": busqueda.strip(), "$options": "i"}},
        ]
    items = await db.ordenes_trabajo.find(filtro).sort("created_at", -1).to_list(500)
    return [serializar(i) for i in items]


@router.post("/ordenes", status_code=201)
async def crear_orden(
    body: OrdenCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    exigir_permiso(user, body.negocio_id, "lab:create", sin_rol_permitido=True)
    if not body.estudios:
        raise HTTPException(400, "Debe seleccionar al menos un estudio")

    # El paciente llega directo o por su expediente clínico
    expediente = None
    if body.expediente_id:
        expediente = await validar_referencia(db.expedientes, body.expediente_id, body.negocio_id, "Expediente")
        if body.paciente_id and body.paciente_id != expediente["paciente_id"]:
            raise HTTPException(400, "El expediente es de otro paciente")
    paciente_id = body.paciente_id or (expediente or {}).get("paciente_id", "")
    if not paciente_id:
        raise HTTPException(400, "Indica el paciente o su expediente")
    paciente = await validar_referencia(db.pacientes, paciente_id, body.negocio_id, "Paciente")
    if not paciente:
        raise HTTPException(404, "Paciente no encontrado")
    if not expediente:
        expediente = await db.expedientes.find_one({"negocio_id": body.negocio_id, "paciente_id": paciente_id})

    medico_nombre = body.medico_solicitante.strip()
    if body.medico_solicitante_id:
        medico = await validar_medico(db, body.medico_solicitante_id, body.negocio_id)
        medico_nombre = medico_nombre or medico.get("nombre", "")

    # Obtener plantillas
    plantilla_ids = [validar_oid(e.plantilla_id) for e in body.estudios]
    plantillas_docs = await db.plantillas_estudios.find(
        {"_id": {"$in": plantilla_ids}, "negocio_id": body.negocio_id, "activo": True}
    ).to_list(50)

    if len(plantillas_docs) != len(body.estudios):
        raise HTTPException(400, "Una o más plantillas no existen o están inactivas")

    plantillas_map = {str(p["_id"]): p for p in plantillas_docs}
    now = datetime.now(timezone.utc)
    folio = await siguiente_folio(db, "ordenes", body.negocio_id, "OT")

    estudios_list = []
    total = 0.0
    for e in body.estudios:
        p = plantillas_map[e.plantilla_id]
        estudios_list.append({
            "plantilla_id": e.plantilla_id,
            "nombre":       p["nombre"],
            "codigo":       p["codigo"],
            "categoria":    p.get("categoria", ""),
            "muestra":      p.get("muestra", ""),
            "precio":       float(p.get("precio", 0)),
        })
        total += float(p.get("precio", 0))

    edad = calcular_edad(paciente.get("fecha_nacimiento", ""))
    sexo = paciente.get("sexo", "masculino")
    catalogo = await catalogo_de_rangos(db, body.negocio_id)

    orden_doc = {
        "negocio_id":          body.negocio_id,
        "folio":               folio,
        "paciente_id":         paciente_id,
        "expediente_id":       str(expediente["_id"]) if expediente else "",
        "expediente_folio":    expediente["folio"] if expediente else "",
        "paciente_nombre":     f"{paciente.get('nombre','')} {paciente.get('apellido_paterno','')} {paciente.get('apellido_materno','')}".strip(),
        "paciente_folio":      paciente.get("folio", ""),
        "paciente_sexo":       paciente.get("sexo", "masculino"),
        "paciente_edad":       edad,
        "medico_solicitante":  medico_nombre,
        "medico_solicitante_id": body.medico_solicitante_id,
        "urgente":             body.urgente,
        "muestra":             None,
        "resultados_criticos": False,
        "criticos":            [],
        "notificado_medico":   False,
        "criticos_notificados": [],
        "notificaciones":      [],
        "fecha":               body.fecha,
        "estudios":            estudios_list,
        "total":               round(total, 2),
        "estado":              "pendiente",
        "observaciones":       body.observaciones.strip(),
        "created_at":          now,
        "updated_at":          now,
    }
    result = await db.ordenes_trabajo.insert_one(orden_doc)
    orden_id = str(result.inserted_id)

    # Crear un registro de resultado por cada estudio, con el rango que le toca al paciente
    for e, p_doc in zip(body.estudios, [plantillas_map[e.plantilla_id] for e in body.estudios]):
        analitos_init = []
        for a in p_doc.get("analitos", []):
            analitos_init.append({
                "nombre":                  a["nombre"],
                "valor":                   "",
                "unidad":                  a.get("unidad", ""),
                "tipo":                    a.get("tipo", "numerico"),
                "referencia_hombre_min":   a.get("referencia_hombre_min"),
                "referencia_hombre_max":   a.get("referencia_hombre_max"),
                "referencia_mujer_min":    a.get("referencia_mujer_min"),
                "referencia_mujer_max":    a.get("referencia_mujer_max"),
                "referencia_texto":        a.get("referencia_texto", ""),
                "referencia_aplicada":     resolver_referencia(a, catalogo, edad, sexo),
                "flag":                    "pendiente",
            })
        await db.resultados_lab.insert_one({
            "negocio_id":       body.negocio_id,
            "orden_id":         orden_id,
            "paciente_id":      paciente_id,
            "paciente_sexo":    sexo,
            "plantilla_id":     e.plantilla_id,
            "estudio_nombre":   p_doc["nombre"],
            "estudio_codigo":   p_doc["codigo"],
            "estudio_categoria":p_doc.get("categoria", ""),
            "analitos":         analitos_init,
            "estado":           "pendiente",
            "observaciones":    "",
            "tecnico_nombre":   "",
            "validado_por":     "",
            "fecha_captura":    None,
            "fecha_validacion": None,
            "created_at":       now,
            "updated_at":       now,
        })

    orden_doc["_id"] = result.inserted_id
    return serializar(orden_doc)


@router.get("/ordenes/{id}")
async def obtener_orden(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(id)
    orden = await db.ordenes_trabajo.find_one({"_id": oid})
    if not orden:
        raise HTTPException(404, "Orden no encontrada")
    verificar_acceso(user, orden["negocio_id"])
    exigir_permiso(user, orden["negocio_id"], "lab:read", sin_rol_permitido=True)
    orden = serializar(orden)
    resultados = await db.resultados_lab.find({"orden_id": id}).sort("estudio_nombre", 1).to_list(50)
    orden["resultados"] = [serializar(r) for r in resultados]
    return orden


@router.patch("/ordenes/{id}/estado")
async def cambiar_estado_orden(
    id: str,
    estado: ESTADOS_ORDEN = Query(...),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(id)
    orden = await db.ordenes_trabajo.find_one({"_id": oid})
    if not orden:
        raise HTTPException(404, "Orden no encontrada")
    verificar_acceso(user, orden["negocio_id"])
    exigir_permiso(user, orden["negocio_id"], "lab:update", sin_rol_permitido=True)
    doc = await db.ordenes_trabajo.find_one_and_update(
        {"_id": oid},
        {"$set": {"estado": estado, "updated_at": datetime.now(timezone.utc)}},
        return_document=True,
    )
    return serializar(doc)


# ── Envío de resultados por correo ────────────────────────────────────────────

@router.get("/correo/estado")
async def estado_correo(user=Depends(get_current_user)):
    return {"configurado": correo_configurado()}


@router.post("/ordenes/{id}/enviar-correo")
async def enviar_orden_por_correo(
    id: str,
    body: EnvioCorreo,
    request: Request,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(id)
    orden = await db.ordenes_trabajo.find_one({"_id": oid})
    if not orden:
        raise HTTPException(404, "Orden no encontrada")
    verificar_acceso(user, orden["negocio_id"])
    exigir_permiso(user, orden["negocio_id"], "lab:update", sin_rol_permitido=True)
    if orden.get("estado") not in ("completado", "entregado"):
        raise HTTPException(400, "Solo se pueden enviar órdenes con todos sus resultados validados")

    paciente = await db.pacientes.find_one({"_id": validar_oid(orden["paciente_id"])})
    if not paciente:
        raise HTTPException(404, "Paciente no encontrado")

    destinatario = (body.email or paciente.get("email") or "").strip()
    if not destinatario or "@" not in destinatario:
        raise HTTPException(400, "El paciente no tiene un correo válido registrado")

    now = datetime.now(timezone.utc)
    envio = {
        "canal":        "email",
        "destinatario": destinatario,
        "fecha":        now,
        "usuario":      user.get("nombre") or user.get("email") or str(user.get("_id", "")),
        "ok":           True,
        "error":        "",
    }
    try:
        await enviar_resultados(db, orden, paciente, destinatario, body.mensaje, url_publica(request))
    except CorreoError as e:
        envio.update(ok=False, error=str(e))
        await db.ordenes_trabajo.update_one({"_id": oid}, {"$push": {"envios": envio}})
        raise HTTPException(502, str(e))

    campos = {"updated_at": now}
    if body.marcar_entregado and orden.get("estado") == "completado":
        campos["estado"] = "entregado"
    doc = await db.ordenes_trabajo.find_one_and_update(
        {"_id": oid},
        {"$set": campos, "$push": {"envios": envio}},
        return_document=True,
    )
    return serializar(doc)


# ── RESULTADOS ────────────────────────────────────────────────────────────────

@router.put("/resultados/{id}")
async def capturar_resultado(
    id: str,
    body: ResultadoCaptura,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(id)
    resultado = await db.resultados_lab.find_one({"_id": oid})
    if not resultado:
        raise HTTPException(404, "Resultado no encontrado")
    verificar_acceso(user, resultado["negocio_id"])
    exigir_permiso(user, resultado["negocio_id"], "lab:update", sin_rol_permitido=True)
    if resultado.get("estado") == "validado":
        raise HTTPException(400, "El resultado ya está validado")

    # Nombre, unidad y rangos vienen de la orden, no del navegador: solo se captura el valor
    sexo = resultado.get("paciente_sexo", "masculino")
    valores = {normalizar(a.nombre): a.valor for a in body.analitos}
    analitos_guardados = []
    for a in resultado.get("analitos", []):
        valor = str(valores.get(normalizar(a["nombre"]), a.get("valor", ""))).strip()
        referencia = a.get("referencia_aplicada")
        if referencia is None and a.get("tipo") != "cualitativo":
            referencia = referencia_de_plantilla(a, sexo)    # órdenes creadas antes del catálogo
        analitos_guardados.append({**a, "valor": valor, "referencia_aplicada": referencia,
                                   "flag": calcular_flag(valor, a, referencia)})

    now = datetime.now(timezone.utc)
    campos = {
        "analitos":        analitos_guardados,
        "observaciones":   body.observaciones.strip(),
        "tecnico_nombre":  body.tecnico_nombre.strip(),
        "estado":          "capturado",
        "fecha_captura":   now,
        "updated_at":      now,
    }
    doc = await db.resultados_lab.find_one_and_update(
        {"_id": oid}, {"$set": campos}, return_document=True
    )

    # Poner orden en_proceso si estaba pendiente
    await db.ordenes_trabajo.update_one(
        {"_id": validar_oid(resultado["orden_id"]), "estado": "pendiente"},
        {"$set": {"estado": "en_proceso", "updated_at": now}},
    )
    await actualizar_criticos(db, resultado["orden_id"], now)

    return serializar(doc)


@router.patch("/resultados/{id}/validar")
async def validar_resultado(
    id: str,
    validado_por: str = Query(""),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(id)
    resultado = await db.resultados_lab.find_one({"_id": oid})
    if not resultado:
        raise HTTPException(404, "Resultado no encontrado")
    verificar_acceso(user, resultado["negocio_id"])
    exigir_permiso(user, resultado["negocio_id"], "lab:update", sin_rol_permitido=True)
    if resultado.get("estado") != "capturado":
        raise HTTPException(400, "Solo se pueden validar resultados ya capturados")

    now = datetime.now(timezone.utc)
    doc = await db.resultados_lab.find_one_and_update(
        {"_id": oid},
        {"$set": {
            "estado":            "validado",
            "validado_por":      validado_por.strip() or user.get("nombre") or str(user.get("_id", "")),
            "fecha_validacion":  now,
            "updated_at":        now,
        }},
        return_document=True,
    )

    # Si todos los resultados de la orden están validados → completar orden
    orden_id = resultado["orden_id"]
    pendientes = await db.resultados_lab.count_documents(
        {"orden_id": orden_id, "estado": {"$ne": "validado"}}
    )
    if pendientes == 0:
        await db.ordenes_trabajo.update_one(
            {"_id": validar_oid(orden_id)},
            {"$set": {"estado": "completado", "updated_at": now}},
        )

    return serializar(doc)


# ── DASHBOARD ─────────────────────────────────────────────────────────────────

@router.get("/dashboard")
async def dashboard(
    negocio_id: str = Query(...),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    exigir_permiso(user, negocio_id, "lab:read", sin_rol_permitido=True)
    hoy = date.today().isoformat()

    ordenes_hoy      = await db.ordenes_trabajo.count_documents({"negocio_id": negocio_id, "fecha": hoy})
    pendientes        = await db.ordenes_trabajo.count_documents({"negocio_id": negocio_id, "estado": "pendiente"})
    en_proceso        = await db.ordenes_trabajo.count_documents({"negocio_id": negocio_id, "estado": "en_proceso"})
    completadas_hoy   = await db.ordenes_trabajo.count_documents({"negocio_id": negocio_id, "estado": "completado",  "fecha": hoy})
    por_entregar      = await db.ordenes_trabajo.count_documents({"negocio_id": negocio_id, "estado": "completado"})

    # Ingresos del día (suma de totales de órdenes de hoy)
    pipeline = [
        {"$match": {"negocio_id": negocio_id, "fecha": hoy}},
        {"$group": {"_id": None, "total": {"$sum": "$total"}}},
    ]
    ingresos_res = await db.ordenes_trabajo.aggregate(pipeline).to_list(1)
    ingresos_hoy = round(ingresos_res[0]["total"] if ingresos_res else 0, 2)

    # Críticos que el médico aún no conoce: lo primero que hay que atender
    criticos = await db.ordenes_trabajo.find(
        {"negocio_id": negocio_id, "resultados_criticos": True, "notificado_medico": False}
    ).sort("updated_at", -1).to_list(50)
    urgentes = await db.ordenes_trabajo.count_documents(
        {"negocio_id": negocio_id, "urgente": True, "estado": {"$in": ["pendiente", "en_proceso"]}}
    )

    # Últimas 10 órdenes
    ultimas = await db.ordenes_trabajo.find(
        {"negocio_id": negocio_id}
    ).sort("created_at", -1).limit(10).to_list(10)

    return {
        "fecha":           hoy,
        "ordenes_hoy":     ordenes_hoy,
        "pendientes":      pendientes,
        "en_proceso":      en_proceso,
        "completadas_hoy": completadas_hoy,
        "por_entregar":    por_entregar,
        "ingresos_hoy":    ingresos_hoy,
        "urgentes_abiertas":      urgentes,
        "criticos_sin_notificar": [serializar(o) for o in criticos],
        "ultimas_ordenes": [serializar(o) for o in ultimas],
    }


# ── Toma de muestra y resultados críticos ─────────────────────────────────────

@router.put("/ordenes/{id}/muestra")
async def registrar_muestra(
    id: str,
    body: MuestraRegistro,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(id)
    orden = await db.ordenes_trabajo.find_one({"_id": oid})
    if not orden:
        raise HTTPException(404, "Orden no encontrada")
    verificar_acceso(user, orden["negocio_id"])
    exigir_permiso(user, orden["negocio_id"], "lab:update", sin_rol_permitido=True)

    tecnico = user
    if body.tecnico_id and body.tecnico_id != user["_id"]:
        tecnico = await db.usuarios.find_one({"_id": validar_oid(body.tecnico_id), "activo": {"$ne": False}})
        if not tecnico or orden["negocio_id"] not in negocios_del_usuario(tecnico):
            raise HTTPException(404, "Técnico: no existe en este negocio")
    fecha = body.fecha_toma or datetime.now(timezone.utc)
    if fecha.tzinfo is None:
        fecha = fecha.replace(tzinfo=timezone.utc)
    muestra = {
        "tipo":           body.tipo,
        "fecha_toma":     fecha,
        "tecnico_id":     str(tecnico["_id"]),
        "tecnico_nombre": tecnico.get("nombre", ""),
        "observaciones":  body.observaciones.strip(),
    }
    doc = await db.ordenes_trabajo.find_one_and_update(
        {"_id": oid}, {"$set": {"muestra": muestra, "updated_at": datetime.now(timezone.utc)}}, return_document=True
    )
    return serializar(doc)


@router.post("/ordenes/{id}/notificar")
async def notificar_criticos(
    id: str,
    body: NotificacionCritico,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Deja constancia de que el médico recibió aviso de los resultados críticos (quién, cómo, cuándo)."""
    oid = validar_oid(id)
    orden = await db.ordenes_trabajo.find_one({"_id": oid})
    if not orden:
        raise HTTPException(404, "Orden no encontrada")
    verificar_acceso(user, orden["negocio_id"])
    exigir_permiso(user, orden["negocio_id"], "lab:update", sin_rol_permitido=True)
    if not orden.get("resultados_criticos"):
        raise HTTPException(400, "La orden no tiene resultados críticos")

    now = datetime.now(timezone.utc)
    aviso = {
        "fecha":        now,
        "usuario":      user.get("nombre", ""),
        "notificado_a": body.notificado_a.strip(),
        "medio":        body.medio,
        "nota":         body.nota.strip(),
        "criticos":     orden.get("criticos", []),
    }
    doc = await db.ordenes_trabajo.find_one_and_update(
        {"_id": oid},
        {"$set": {"notificado_medico": True, "criticos_notificados": orden.get("criticos", []), "updated_at": now},
         "$push": {"notificaciones": aviso}},
        return_document=True,
    )
    return serializar(doc)


# ── Rangos de referencia por edad y sexo ──────────────────────────────────────

async def obtener_rango(db, id: str, user: dict) -> dict:
    doc = await db.rangos_referencia.find_one({"_id": validar_oid(id)})
    if not doc:
        raise HTTPException(404, "Parámetro no encontrado")
    verificar_acceso(user, doc["negocio_id"])
    return doc


async def clave_libre(db, negocio_id: str, parametro: str, aliases: list[str], excluir=None) -> None:
    """Un nombre o alias solo puede pertenecer a un parámetro, o el analito no sabría qué rango usar."""
    nombres = {normalizar(n) for n in [parametro, *aliases] if n.strip()}
    filtro = {"negocio_id": negocio_id, "activo": True}
    if excluir:
        filtro["_id"] = {"$ne": excluir}
    async for otro in db.rangos_referencia.find(filtro, {"parametro": 1, "aliases": 1}):
        if nombres & {normalizar(n) for n in [otro["parametro"], *otro.get("aliases", [])]}:
            raise HTTPException(409, f"Ese nombre ya lo usa el parámetro {otro['parametro']}")


@router.get("/rangos")
async def listar_rangos(
    negocio_id: str = Query(...),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    exigir_permiso(user, negocio_id, "lab:read", sin_rol_permitido=True)
    docs = await db.rangos_referencia.find({"negocio_id": negocio_id, "activo": True}).sort("parametro", 1).to_list(500)
    return [serializar(d) for d in docs]


@router.post("/rangos", status_code=201)
async def crear_rango(
    body: RangoParametro,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    exigir_permiso(user, body.negocio_id, "lab:config", sin_rol_permitido=True)
    aliases = [a.strip() for a in body.aliases if a.strip()]
    await clave_libre(db, body.negocio_id, body.parametro, aliases)
    now = datetime.now(timezone.utc)
    doc = {
        **body.model_dump(), "parametro": body.parametro.strip(), "clave": normalizar(body.parametro),
        "aliases": aliases, "activo": True, "created_at": now, "updated_at": now,
    }
    doc["_id"] = (await db.rangos_referencia.insert_one(doc)).inserted_id
    return serializar(doc)


@router.put("/rangos/{id}")
async def actualizar_rango(
    id: str,
    body: RangoParametroUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Aplica a las órdenes nuevas; las ya creadas conservan el rango con que se abrieron."""
    actual = await obtener_rango(db, id, user)
    exigir_permiso(user, actual["negocio_id"], "lab:config", sin_rol_permitido=True)
    cambios = body.model_dump(exclude_none=True)
    if not cambios:
        raise HTTPException(400, "Sin campos a actualizar")
    if "aliases" in cambios:
        cambios["aliases"] = [a.strip() for a in cambios["aliases"] if a.strip()]
    if "parametro" in cambios:
        cambios["parametro"] = cambios["parametro"].strip()
        cambios["clave"] = normalizar(cambios["parametro"])
    await clave_libre(db, actual["negocio_id"], cambios.get("parametro", actual["parametro"]),
                      cambios.get("aliases", actual.get("aliases", [])), excluir=actual["_id"])
    doc = await db.rangos_referencia.find_one_and_update(
        {"_id": actual["_id"]}, {"$set": {**cambios, "updated_at": datetime.now(timezone.utc)}}, return_document=True
    )
    return serializar(doc)


@router.delete("/rangos/{id}")
async def eliminar_rango(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    actual = await obtener_rango(db, id, user)
    exigir_permiso(user, actual["negocio_id"], "lab:config", sin_rol_permitido=True)
    await db.rangos_referencia.update_one(
        {"_id": actual["_id"]}, {"$set": {"activo": False, "updated_at": datetime.now(timezone.utc)}}
    )
    return {"ok": True}


@router.post("/rangos/seed", status_code=201)
async def seed_rangos(
    negocio_id: str = Query(...),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Carga los parámetros comunes que aún no existan (por nombre); no toca los ya configurados."""
    verificar_acceso(user, negocio_id)
    exigir_permiso(user, negocio_id, "lab:config", sin_rol_permitido=True)
    existentes = await catalogo_de_rangos(db, negocio_id)
    now = datetime.now(timezone.utc)
    creados = 0
    for p in RANGOS_SEED:
        if normalizar(p["parametro"]) in existentes:
            continue
        await db.rangos_referencia.insert_one({
            **p, "negocio_id": negocio_id, "clave": normalizar(p["parametro"]),
            "activo": True, "created_at": now, "updated_at": now,
        })
        creados += 1
    return {"creados": creados, "total_seed": len(RANGOS_SEED)}


# ── Configuración del laboratorio ────────────────────────────────────────────

class LabConfig(BaseModel):
    negocio_id: str
    nombre: str = ""
    nombre_corto: str = ""
    direccion: str = ""
    colonia: str = ""
    ciudad: str = ""
    estado_rep: str = ""
    cp: str = ""
    telefono: str = ""
    email: str = ""
    rfc: str = ""
    director: str = ""
    cedula_director: str = ""
    firma_director_base64: str = ""     # data:image/png;base64,… para el reporte
    aviso_pie: str = ""

    @model_validator(mode="after")
    def firma_valida(self):
        f = self.firma_director_base64
        if f and not f.startswith(("data:image/png;base64,", "data:image/jpeg;base64,")):
            raise ValueError("La firma debe ser una imagen PNG o JPG")
        if len(f) > 400_000:
            raise ValueError("La imagen de la firma es demasiado grande (máx. ~300 KB)")
        return self


@router.get("/config")
async def obtener_config(
    negocio_id: str = Query(...),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, negocio_id)
    exigir_permiso(user, negocio_id, "lab:read", sin_rol_permitido=True)
    doc = await db.config_negocios.find_one({"_id": negocio_id}) or {}
    doc.pop("_id", None)
    return {"negocio_id": negocio_id, **doc}


@router.put("/config")
async def guardar_config(
    body: LabConfig,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    verificar_acceso(user, body.negocio_id)
    exigir_permiso(user, body.negocio_id, "lab:config", sin_rol_permitido=True)
    campos = {k: v for k, v in body.model_dump().items() if k != "negocio_id"}
    campos["updated_at"] = datetime.now(timezone.utc)
    await db.config_negocios.update_one(
        {"_id": body.negocio_id},
        {"$set": campos},
        upsert=True,
    )
    return {"ok": True, **campos}


@router.get("/ordenes/{id}/pdf")
async def pdf_orden(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    oid = validar_oid(id)
    orden = await db.ordenes_trabajo.find_one({"_id": oid})
    if not orden:
        raise HTTPException(404, "Orden no encontrada")
    verificar_acceso(user, orden["negocio_id"])
    exigir_permiso(user, orden["negocio_id"], "lab:read", sin_rol_permitido=True)

    pdf = await generar_pdf_resultados(db, orden)
    return Response(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{nombre_archivo_pdf(orden)}"'},
    )


# ── Seed de estudios comunes ──────────────────────────────────────────────────

ESTUDIOS_SEED = [
    {
        "codigo": "BH", "nombre": "Biometría Hemática", "categoria": "Hematología",
        "muestra": "Sangre", "tiempo_entrega": 2, "precio": 180.0,
        "analitos": [
            {"nombre":"Hemoglobina","unidad":"g/dL","tipo":"numerico","referencia_hombre_min":13.5,"referencia_hombre_max":17.5,"referencia_mujer_min":12.0,"referencia_mujer_max":15.5,"referencia_texto":""},
            {"nombre":"Hematocrito","unidad":"%","tipo":"numerico","referencia_hombre_min":41.0,"referencia_hombre_max":53.0,"referencia_mujer_min":36.0,"referencia_mujer_max":46.0,"referencia_texto":""},
            {"nombre":"Eritrocitos","unidad":"x10⁶/µL","tipo":"numerico","referencia_hombre_min":4.5,"referencia_hombre_max":5.9,"referencia_mujer_min":4.0,"referencia_mujer_max":5.2,"referencia_texto":""},
            {"nombre":"Leucocitos","unidad":"x10³/µL","tipo":"numerico","referencia_hombre_min":4.5,"referencia_hombre_max":11.0,"referencia_mujer_min":4.5,"referencia_mujer_max":11.0,"referencia_texto":""},
            {"nombre":"Plaquetas","unidad":"x10³/µL","tipo":"numerico","referencia_hombre_min":150.0,"referencia_hombre_max":400.0,"referencia_mujer_min":150.0,"referencia_mujer_max":400.0,"referencia_texto":""},
            {"nombre":"VCM","unidad":"fL","tipo":"numerico","referencia_hombre_min":80.0,"referencia_hombre_max":100.0,"referencia_mujer_min":80.0,"referencia_mujer_max":100.0,"referencia_texto":""},
            {"nombre":"HCM","unidad":"pg","tipo":"numerico","referencia_hombre_min":27.0,"referencia_hombre_max":33.0,"referencia_mujer_min":27.0,"referencia_mujer_max":33.0,"referencia_texto":""},
        ],
    },
    {
        "codigo": "QS6", "nombre": "Química Sanguínea 6", "categoria": "Química sanguínea",
        "muestra": "Sangre", "tiempo_entrega": 3, "precio": 250.0,
        "analitos": [
            {"nombre":"Glucosa","unidad":"mg/dL","tipo":"numerico","referencia_hombre_min":70.0,"referencia_hombre_max":100.0,"referencia_mujer_min":70.0,"referencia_mujer_max":100.0,"referencia_texto":""},
            {"nombre":"Urea","unidad":"mg/dL","tipo":"numerico","referencia_hombre_min":7.0,"referencia_hombre_max":20.0,"referencia_mujer_min":7.0,"referencia_mujer_max":20.0,"referencia_texto":""},
            {"nombre":"Creatinina","unidad":"mg/dL","tipo":"numerico","referencia_hombre_min":0.7,"referencia_hombre_max":1.3,"referencia_mujer_min":0.5,"referencia_mujer_max":1.1,"referencia_texto":""},
            {"nombre":"Ácido Úrico","unidad":"mg/dL","tipo":"numerico","referencia_hombre_min":3.5,"referencia_hombre_max":7.2,"referencia_mujer_min":2.6,"referencia_mujer_max":6.0,"referencia_texto":""},
            {"nombre":"Colesterol Total","unidad":"mg/dL","tipo":"numerico","referencia_hombre_min":0.0,"referencia_hombre_max":200.0,"referencia_mujer_min":0.0,"referencia_mujer_max":200.0,"referencia_texto":""},
            {"nombre":"Triglicéridos","unidad":"mg/dL","tipo":"numerico","referencia_hombre_min":0.0,"referencia_hombre_max":150.0,"referencia_mujer_min":0.0,"referencia_mujer_max":150.0,"referencia_texto":""},
        ],
    },
    {
        "codigo": "EGO", "nombre": "Examen General de Orina", "categoria": "Urianálisis",
        "muestra": "Orina", "tiempo_entrega": 1, "precio": 120.0,
        "analitos": [
            {"nombre":"Color","unidad":"","tipo":"cualitativo","referencia_hombre_min":None,"referencia_hombre_max":None,"referencia_mujer_min":None,"referencia_mujer_max":None,"referencia_texto":"Amarillo claro"},
            {"nombre":"Aspecto","unidad":"","tipo":"cualitativo","referencia_hombre_min":None,"referencia_hombre_max":None,"referencia_mujer_min":None,"referencia_mujer_max":None,"referencia_texto":"Transparente"},
            {"nombre":"Glucosa","unidad":"","tipo":"cualitativo","referencia_hombre_min":None,"referencia_hombre_max":None,"referencia_mujer_min":None,"referencia_mujer_max":None,"referencia_texto":"Negativo"},
            {"nombre":"Proteínas","unidad":"","tipo":"cualitativo","referencia_hombre_min":None,"referencia_hombre_max":None,"referencia_mujer_min":None,"referencia_mujer_max":None,"referencia_texto":"Negativo"},
            {"nombre":"Cetonas","unidad":"","tipo":"cualitativo","referencia_hombre_min":None,"referencia_hombre_max":None,"referencia_mujer_min":None,"referencia_mujer_max":None,"referencia_texto":"Negativo"},
            {"nombre":"pH","unidad":"","tipo":"numerico","referencia_hombre_min":4.5,"referencia_hombre_max":8.0,"referencia_mujer_min":4.5,"referencia_mujer_max":8.0,"referencia_texto":""},
            {"nombre":"Densidad","unidad":"","tipo":"numerico","referencia_hombre_min":1.003,"referencia_hombre_max":1.030,"referencia_mujer_min":1.003,"referencia_mujer_max":1.030,"referencia_texto":""},
            {"nombre":"Leucocitos","unidad":"/campo","tipo":"numerico","referencia_hombre_min":0.0,"referencia_hombre_max":5.0,"referencia_mujer_min":0.0,"referencia_mujer_max":5.0,"referencia_texto":""},
            {"nombre":"Eritrocitos","unidad":"/campo","tipo":"numerico","referencia_hombre_min":0.0,"referencia_hombre_max":2.0,"referencia_mujer_min":0.0,"referencia_mujer_max":2.0,"referencia_texto":""},
        ],
    },
    {
        "codigo": "TSH", "nombre": "TSH", "categoria": "Hormonas",
        "muestra": "Sangre", "tiempo_entrega": 4, "precio": 220.0,
        "analitos": [
            {"nombre":"TSH","unidad":"µUI/mL","tipo":"numerico","referencia_hombre_min":0.27,"referencia_hombre_max":4.2,"referencia_mujer_min":0.27,"referencia_mujer_max":4.2,"referencia_texto":""},
        ],
    },
    {
        "codigo": "TFH", "nombre": "Perfil de Función Hepática", "categoria": "Química sanguínea",
        "muestra": "Sangre", "tiempo_entrega": 3, "precio": 320.0,
        "analitos": [
            {"nombre":"TGO (AST)","unidad":"U/L","tipo":"numerico","referencia_hombre_min":10.0,"referencia_hombre_max":40.0,"referencia_mujer_min":10.0,"referencia_mujer_max":35.0,"referencia_texto":""},
            {"nombre":"TGP (ALT)","unidad":"U/L","tipo":"numerico","referencia_hombre_min":7.0,"referencia_hombre_max":56.0,"referencia_mujer_min":7.0,"referencia_mujer_max":35.0,"referencia_texto":""},
            {"nombre":"Bilirrubina Total","unidad":"mg/dL","tipo":"numerico","referencia_hombre_min":0.2,"referencia_hombre_max":1.2,"referencia_mujer_min":0.2,"referencia_mujer_max":1.2,"referencia_texto":""},
            {"nombre":"Bilirrubina Directa","unidad":"mg/dL","tipo":"numerico","referencia_hombre_min":0.0,"referencia_hombre_max":0.3,"referencia_mujer_min":0.0,"referencia_mujer_max":0.3,"referencia_texto":""},
            {"nombre":"Fosfatasa Alcalina","unidad":"U/L","tipo":"numerico","referencia_hombre_min":44.0,"referencia_hombre_max":147.0,"referencia_mujer_min":44.0,"referencia_mujer_max":147.0,"referencia_texto":""},
        ],
    },
    {
        "codigo": "PCR", "nombre": "Proteína C Reactiva", "categoria": "Inmunología",
        "muestra": "Sangre", "tiempo_entrega": 2, "precio": 150.0,
        "analitos": [
            {"nombre":"PCR Cuantitativa","unidad":"mg/L","tipo":"numerico","referencia_hombre_min":0.0,"referencia_hombre_max":5.0,"referencia_mujer_min":0.0,"referencia_mujer_max":5.0,"referencia_texto":""},
        ],
    },
    {
        "codigo": "GLUC", "nombre": "Glucosa en Ayuno", "categoria": "Química sanguínea",
        "muestra": "Sangre", "tiempo_entrega": 1, "precio": 80.0,
        "analitos": [
            {"nombre":"Glucosa","unidad":"mg/dL","tipo":"numerico","referencia_hombre_min":70.0,"referencia_hombre_max":100.0,"referencia_mujer_min":70.0,"referencia_mujer_max":100.0,"referencia_texto":""},
        ],
    },
    {
        "codigo": "HBA1C", "nombre": "Hemoglobina Glucosilada (HbA1c)", "categoria": "Química sanguínea",
        "muestra": "Sangre", "tiempo_entrega": 4, "precio": 280.0,
        "analitos": [
            {"nombre":"HbA1c","unidad":"%","tipo":"numerico","referencia_hombre_min":4.0,"referencia_hombre_max":5.7,"referencia_mujer_min":4.0,"referencia_mujer_max":5.7,"referencia_texto":""},
        ],
    },
]
