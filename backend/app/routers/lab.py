from datetime import datetime, timezone, date
from typing import Optional, Literal, List

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.negocios import validar_referencia
from app.services.reporte_lab import generar_pdf_resultados, nombre_archivo_pdf
from app.services.correo import CorreoError, correo_configurado
from app.services.notificaciones_lab import enviar_resultados, url_publica

router = APIRouter(prefix="/lab", tags=["Laboratorio"])

ESTADOS_ORDEN    = Literal["pendiente", "en_proceso", "completado", "entregado"]
ESTADOS_RESULT   = Literal["pendiente", "capturado", "validado"]
FLAGS            = Literal["pendiente", "normal", "alto", "bajo", "critico"]


# ── Utilidades ────────────────────────────────────────────────────────────────

def serializar(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    return doc


def validar_oid(id: str) -> ObjectId:
    try:
        return ObjectId(id)
    except Exception:
        raise HTTPException(400, "ID inválido")


def check_negocio(user: dict, negocio_id: str):
    negocios = user.get("negocios") or user.get("businesses") or []
    if negocio_id not in list(negocios):
        raise HTTPException(403, "Sin acceso a este negocio")


async def siguiente_folio(db, coleccion: str, negocio_id: str, prefijo: str) -> str:
    counter = await db.counters.find_one_and_update(
        {"_id": f"{coleccion}_{negocio_id}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    return f"{prefijo}-{str(counter['seq']).zfill(5)}"


def calcular_flag(valor: str, analito: dict, sexo: str = "masculino") -> str:
    if analito.get("tipo") == "cualitativo":
        return "normal"
    try:
        num = float(valor)
    except (ValueError, TypeError):
        return "pendiente"
    ref_min = analito.get("referencia_mujer_min" if sexo == "femenino" else "referencia_hombre_min")
    ref_max = analito.get("referencia_mujer_max" if sexo == "femenino" else "referencia_hombre_max")
    if ref_min is None or ref_max is None:
        return "pendiente"
    if num < ref_min:
        return "critico" if (ref_min > 0 and num < ref_min * 0.7) else "bajo"
    if num > ref_max:
        return "critico" if num > ref_max * 1.3 else "alto"
    return "normal"


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
    paciente_id: str
    medico_solicitante: str = ""
    fecha: str                    # YYYY-MM-DD
    observaciones: str = ""
    estudios: List[EstudioOrden]  # lista de plantilla_ids


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
    analitos: List[AnalitoResultado]
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
    check_negocio(user, negocio_id)
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
    check_negocio(user, body.negocio_id)
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
    check_negocio(user, plantilla["negocio_id"])

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
    check_negocio(user, plantilla["negocio_id"])
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
    check_negocio(user, negocio_id)
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
    busqueda: str = Query(""),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_negocio(user, negocio_id)
    filtro: dict = {"negocio_id": negocio_id}
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
    check_negocio(user, body.negocio_id)
    if not body.estudios:
        raise HTTPException(400, "Debe seleccionar al menos un estudio")

    # Obtener datos del paciente
    paciente = await validar_referencia(db.pacientes, body.paciente_id, body.negocio_id, "Paciente")
    if not paciente:
        raise HTTPException(404, "Paciente no encontrado")

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

    from datetime import date as dt_date
    edad = 0
    fn = paciente.get("fecha_nacimiento", "")
    if fn:
        try:
            nac = dt_date.fromisoformat(fn)
            hoy = dt_date.today()
            edad = hoy.year - nac.year - ((hoy.month, hoy.day) < (nac.month, nac.day))
        except Exception:
            pass

    orden_doc = {
        "negocio_id":          body.negocio_id,
        "folio":               folio,
        "paciente_id":         body.paciente_id,
        "paciente_nombre":     f"{paciente.get('nombre','')} {paciente.get('apellido_paterno','')} {paciente.get('apellido_materno','')}".strip(),
        "paciente_folio":      paciente.get("folio", ""),
        "paciente_sexo":       paciente.get("sexo", "masculino"),
        "paciente_edad":       edad,
        "medico_solicitante":  body.medico_solicitante.strip(),
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

    # Crear un registro de resultado por cada estudio
    sexo = paciente.get("sexo", "masculino")
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
                "flag":                    "pendiente",
            })
        await db.resultados_lab.insert_one({
            "negocio_id":       body.negocio_id,
            "orden_id":         orden_id,
            "paciente_id":      body.paciente_id,
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
    check_negocio(user, orden["negocio_id"])
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
    check_negocio(user, orden["negocio_id"])
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
    check_negocio(user, orden["negocio_id"])
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
    check_negocio(user, resultado["negocio_id"])
    if resultado.get("estado") == "validado":
        raise HTTPException(400, "El resultado ya está validado")

    sexo = resultado.get("paciente_sexo", "masculino")
    analitos_guardados = []
    for a in body.analitos:
        flag = calcular_flag(a.valor, a.model_dump(), sexo)
        analitos_guardados.append({**a.model_dump(), "flag": flag})

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
    check_negocio(user, resultado["negocio_id"])
    if resultado.get("estado") != "capturado":
        raise HTTPException(400, "Solo se pueden validar resultados ya capturados")

    now = datetime.now(timezone.utc)
    doc = await db.resultados_lab.find_one_and_update(
        {"_id": oid},
        {"$set": {
            "estado":            "validado",
            "validado_por":      validado_por.strip() or str(user.get("_id", "")),
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
    check_negocio(user, negocio_id)
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
        "ultimas_ordenes": [serializar(o) for o in ultimas],
    }


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
    aviso_pie: str = ""


@router.get("/config")
async def obtener_config(
    negocio_id: str = Query(...),
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_negocio(user, negocio_id)
    doc = await db.config_negocios.find_one({"_id": negocio_id}) or {}
    doc.pop("_id", None)
    return {"negocio_id": negocio_id, **doc}


@router.put("/config")
async def guardar_config(
    body: LabConfig,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_negocio(user, body.negocio_id)
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
    check_negocio(user, orden["negocio_id"])

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
