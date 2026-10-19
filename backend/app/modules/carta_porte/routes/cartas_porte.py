import re
import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

from app.core.database import get_db
from app.core.negocios import negocio_autorizado, obtener_del_negocio, validar_referencia, verificar_acceso
from app.core.security import get_current_user
from app.modules.clinica.pdf import datos_clinica, fecha_larga, render_pdf

from .. import catalogos
from ..fechas import a_utc, desde_db, zona
from ..models.carta_porte import TRANSICIONES, CambioEstado, Cancelacion, CartaPorteCreate, CartaPorteUpdate, Emisor
from ..models.operador import validar_rfc
from ..xml_generator import generar_xml_carta_porte
from .operadores import alertas_operadores
from .vehiculos import alertas_vehiculos

router = APIRouter(prefix="/carta-porte", tags=["Carta Porte"])

SIN_XML = {"xml_interno": 0}


# ── Catálogos SAT (estáticos, iguales para todos los negocios) ────────────────

@router.get("/catalogos")
async def obtener_catalogos(user=Depends(get_current_user)):
    return catalogos.para_frontend()


@router.get("/catalogos/productos")
async def buscar_productos(q: str = Query(..., min_length=1), user=Depends(get_current_user)):
    """c_ClaveProdServCP por clave o descripción; incluye si aplica material peligroso."""
    return catalogos.buscar_productos(q)


@router.get("/catalogos/material-peligroso")
async def buscar_material_peligroso(q: str = Query(..., min_length=1), user=Depends(get_current_user)):
    return catalogos.buscar_material_peligroso(q)


@router.get("/catalogos/clave-unidad")
async def buscar_clave_unidad(q: str = Query(..., min_length=1), user=Depends(get_current_user)):
    return catalogos.buscar_clave_unidad(q)


@router.get("/catalogos/codigo-postal/{cp}")
async def consultar_codigo_postal(cp: str, user=Depends(get_current_user)):
    """Estado, municipio, localidad y colonias de un código postal."""
    datos = catalogos.codigo_postal(cp.strip())
    if not datos:
        raise HTTPException(404, f"El código postal {cp} no existe en el catálogo del SAT")
    return datos


# ── Datos fiscales del emisor ─────────────────────────────────────────────────

async def emisor_de(db, negocio_id: str) -> dict | None:
    config = await db.config_negocios.find_one({"_id": negocio_id}, {"carta_porte_emisor": 1}) or {}
    return config.get("carta_porte_emisor")


@router.get("/emisor")
async def obtener_emisor(
    negocio_id: str = Depends(negocio_autorizado),
    db=Depends(get_db),
):
    """Configurado, o una propuesta con lo que ya tiene el negocio (RFC, nombre, código postal)."""
    guardado = await emisor_de(db, negocio_id)
    if guardado:
        return {**guardado, "configurado": True}
    config = await db.config_negocios.find_one({"_id": negocio_id}) or {}
    return {"rfc": config.get("rfc", ""), "nombre": (config.get("nombre") or "").upper(), "regimen_fiscal": "",
            "codigo_postal": config.get("cp", ""), "domicilio_salida": None, "configurado": False}


@router.put("/emisor")
async def guardar_emisor(
    body: Emisor,
    negocio_id: str = Depends(negocio_autorizado),
    db=Depends(get_db),
):
    datos = body.model_dump()
    await db.config_negocios.update_one({"_id": negocio_id}, {"$set": {"carta_porte_emisor": datos}}, upsert=True)
    return {**datos, "configurado": True}


# ── Alertas de flota y operadores ─────────────────────────────────────────────

@router.get("/alertas")
async def alertas(
    negocio_id: str = Depends(negocio_autorizado),
    db=Depends(get_db),
):
    """Seguros y licencias vencidos o por vencer (30 días), para el badge del menú."""
    seguros = await alertas_vehiculos(negocio_id, db)
    licencias = await alertas_operadores(negocio_id, db)
    return {"seguros": seguros, "licencias": licencias, "total": len(seguros) + len(licencias)}


# ── Utilidades del documento ──────────────────────────────────────────────────

async def siguiente_folio(db, negocio_id: str) -> str:
    counter = await db.counters.find_one_and_update(
        {"_id": f"cartas_porte_{negocio_id}"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
    return f"CP-{str(counter['seq']).zfill(5)}"


def nuevo_id_ccp() -> str:
    """IdCCP: UUID (RFC 4122) con los 3 primeros caracteres sustituidos por CCC."""
    return "CCC" + str(uuid.uuid4())[3:]


def snapshot(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k not in ("_id", "negocio_id", "activo", "created_at", "updated_at")}


async def flota_del_documento(db, negocio_id: str, vehiculo_id: str, operador_ids: list[str]) -> tuple[dict, list[dict]]:
    vehiculo = await validar_referencia(db.vehiculos, vehiculo_id, negocio_id, "Vehículo")
    if not vehiculo.get("activo", True):
        raise HTTPException(400, f"El vehículo {vehiculo['nombre']} está dado de baja")
    operadores = []
    for oid in operador_ids:
        op = await validar_referencia(db.operadores, oid, negocio_id, "Operador")
        if not op.get("activo", True):
            raise HTTPException(400, f"El operador {op['nombre']} está dado de baja")
        operadores.append(op)
    return vehiculo, operadores


async def armar(db, body: CartaPorteCreate | CartaPorteUpdate, negocio_id: str) -> dict:
    """Campos del documento a partir de lo capturado; el emisor, la flota y los totales los pone el servidor."""
    emisor = await emisor_de(db, negocio_id)
    if not emisor:
        raise HTTPException(400, "Registra primero los datos fiscales del negocio (RFC, razón social, régimen y código postal)")
    vehiculo, operadores = await flota_del_documento(db, negocio_id, body.vehiculo_id, body.operador_ids)
    if any(m.material_peligroso for m in body.mercancias) and not vehiculo.get("seguro_medio_ambiente"):
        raise HTTPException(400, f"Para trasladar material peligroso, el vehículo {vehiculo['nombre']} necesita seguro de medio ambiente")
    if body.pedido_id:
        await validar_referencia(db.pedidos, body.pedido_id, negocio_id, "Pedido")

    origen = body.origen.model_dump()
    origen.update({
        "rfc_remitente":    validar_rfc(origen["rfc_remitente"]) if origen["rfc_remitente"] else emisor["rfc"],
        "nombre_remitente": origen["nombre_remitente"].strip() or emisor["nombre"],
        "fecha_hora_salida": a_utc(body.origen.fecha_hora_salida),
    })
    destinos = []
    for i, d in enumerate(body.destinos, start=1):
        dest = d.model_dump()
        dest.update({
            "num_destino":         i,
            "rfc_destinatario":    validar_rfc(dest["rfc_destinatario"]) if dest["rfc_destinatario"] else emisor["rfc"],
            "nombre_destinatario": dest["nombre_destinatario"].strip() or emisor["nombre"],
            "fecha_hora_llegada":  a_utc(d.fecha_hora_llegada),
        })
        destinos.append(dest)
    mercancias = [m.model_dump() for m in body.mercancias]
    return {
        "emisor":               {k: emisor[k] for k in ("rfc", "nombre", "regimen_fiscal", "codigo_postal")},
        "origen":               origen,
        "destinos":             destinos,
        "mercancias":           mercancias,
        "unidad_peso":          body.unidad_peso,
        "peso_bruto_total":     round(sum(m["peso_kg"] for m in mercancias), 3),     # en kg
        "num_total_mercancias": len(mercancias),
        "total_dist_rec":       round(sum(d["distancia_recorrida"] for d in destinos), 2),
        "vehiculo_id":          str(vehiculo["_id"]),
        "vehiculo_snapshot":    snapshot(vehiculo),
        "operadores":           [{"operador_id": str(o["_id"]), "snapshot": snapshot(o)} for o in operadores],
        "pedido_id":            body.pedido_id,
        "observaciones":        body.observaciones.strip(),
    }


def problemas_de_vigencia(doc: dict) -> list[str]:
    """Licencias y seguros que no estarán vigentes el día de salida, y licencias que no amparan el vehículo o la carga."""
    salida = desde_db(doc["origen"]["fecha_hora_salida"]).astimezone(zona()).date()
    problemas = []
    v = doc["vehiculo_snapshot"]
    hay_peligroso = any(m.get("material_peligroso") for m in doc["mercancias"])
    for campo, nombre in (("seguro_resp_civil", "responsabilidad civil"), ("seguro_carga", "carga"),
                          ("seguro_medio_ambiente", "medio ambiente")):
        seguro = v.get(campo)
        if not seguro or (campo == "seguro_medio_ambiente" and not hay_peligroso):
            continue
        if date.fromisoformat(seguro["fecha_vencimiento"]) < salida:
            problemas.append(f"El seguro de {nombre} del vehículo {v['placa']} vence el {seguro['fecha_vencimiento']}")
    for op in doc["operadores"]:
        o = op["snapshot"]
        if date.fromisoformat(o["fecha_vencimiento_licencia"]) < salida:
            problemas.append(f"La licencia de {o['nombre']} vence el {o['fecha_vencimiento_licencia']}")
        motivo = catalogos.problema_de_licencia(o.get("tipo_licencia", ""), v["config_vehicular"], hay_peligroso)
        if motivo:
            problemas.append(f"La licencia {o.get('tipo_licencia')} de {o['nombre']} no sirve: {motivo}")
    return problemas


def a_carta(doc: dict, completo: bool = True) -> dict:
    c = {k: v for k, v in doc.items() if k != "_id" and (completo or k != "xml_interno")}
    c["id"] = str(doc["_id"])
    c["origen"] = {**c["origen"], "fecha_hora_salida": desde_db(c["origen"]["fecha_hora_salida"])}
    c["destinos"] = [{**d, "fecha_hora_llegada": desde_db(d["fecha_hora_llegada"])} for d in c["destinos"]]
    for campo in ("created_at", "updated_at"):
        c[campo] = desde_db(c.get(campo))
    c["historial"] = [{**h, "fecha": desde_db(h["fecha"])} for h in c.get("historial", [])]
    if completo:
        c["vigencia"] = problemas_de_vigencia(doc)
    return c


async def obtener_carta(db, id: str, user: dict) -> dict:
    return await obtener_del_negocio(db.cartas_porte, id, user, "Carta porte")


# ── Cartas porte ──────────────────────────────────────────────────────────────

@router.get("")
async def listar_cartas_porte(
    negocio_id: str = Depends(negocio_autorizado),
    estado: str = Query(""),
    desde: date | None = Query(None, description="Fecha de salida desde (día local)"),
    hasta: date | None = Query(None, description="Fecha de salida hasta, inclusive"),
    operador_id: str = Query(""),
    q: str = Query("", description="Folio, destinatario o mercancía"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db=Depends(get_db),
):
    filtro: dict = {"negocio_id": negocio_id}
    if estado:
        filtro["estado"] = {"$in": estado.split(",")}
    if operador_id:
        filtro["operadores.operador_id"] = operador_id
    rango = {}
    if desde:
        rango["$gte"] = a_utc(datetime.combine(desde, datetime.min.time()))
    if hasta:
        rango["$lte"] = a_utc(datetime.combine(hasta, datetime.max.time()))
    if rango:
        filtro["origen.fecha_hora_salida"] = rango
    if q.strip():
        patron = {"$regex": re.escape(q.strip()), "$options": "i"}
        filtro["$or"] = [{"folio": patron}, {"destinos.nombre_destinatario": patron},
                         {"mercancias.descripcion": patron}, {"vehiculo_snapshot.placa": patron}]
    total = await db.cartas_porte.count_documents(filtro)
    docs = await db.cartas_porte.find(filtro, SIN_XML).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"items": [a_carta(d, completo=False) for d in docs], "total": total, "skip": skip, "limit": limit}


@router.post("", status_code=201)
async def crear_carta_porte(
    body: CartaPorteCreate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Se crea en borrador con su XML interno ya generado."""
    verificar_acceso(user, body.negocio_id)
    campos = await armar(db, body, body.negocio_id)
    now = datetime.now(timezone.utc)
    doc = {
        "negocio_id": body.negocio_id,
        "folio":      await siguiente_folio(db, body.negocio_id),
        "id_ccp":     nuevo_id_ccp(),
        "estado":     "borrador",
        **campos,
        "factura_id": "",
        "timbrado":   {"uuid": None, "fecha_timbrado": None, "pac": None, "cadena_original": None,
                       "sello_sat": None, "xml_timbrado": None},
        "historial":  [{"estado": "borrador", "fecha": now, "usuario": user.get("nombre", ""), "nota": "Creada"}],
        "motivo_cancelacion": "",
        "created_at": now,
        "updated_at": now,
        "created_by": user.get("nombre", ""),
    }
    doc["xml_interno"] = await run_in_threadpool(generar_xml_carta_porte, doc, now)
    doc["_id"] = (await db.cartas_porte.insert_one(doc)).inserted_id
    return a_carta(doc)


@router.get("/{id}")
async def obtener_carta_porte(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    return a_carta(await obtener_carta(db, id, user), completo=True)


@router.put("/{id}")
async def actualizar_carta_porte(
    id: str,
    body: CartaPorteUpdate,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Solo en borrador. Vuelve a tomar los datos actuales del vehículo y los operadores."""
    actual = await obtener_carta(db, id, user)
    if actual["estado"] != "borrador":
        raise HTTPException(400, f"Solo se edita en borrador; esta carta porte está {actual['estado'].replace('_', ' ')}")
    campos = await armar(db, body, actual["negocio_id"])
    now = datetime.now(timezone.utc)
    nuevo = {**actual, **campos, "updated_at": now}
    nuevo["xml_interno"] = await run_in_threadpool(generar_xml_carta_porte, nuevo, now)
    await db.cartas_porte.update_one({"_id": actual["_id"]}, {"$set": {**campos, "xml_interno": nuevo["xml_interno"], "updated_at": now}})
    return a_carta(nuevo)


@router.put("/{id}/estado")
async def cambiar_estado(
    id: str,
    body: CambioEstado,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """borrador → listo → en tránsito → entregado (y de listo se puede regresar a borrador)."""
    doc = await obtener_carta(db, id, user)
    anterior = doc["estado"]
    if body.estado == "cancelado":
        raise HTTPException(400, "Para cancelar usa la opción Cancelar (pide un motivo)")
    if body.estado not in TRANSICIONES[anterior]:
        raise HTTPException(400, f"No se puede pasar de {anterior.replace('_', ' ')} a {body.estado.replace('_', ' ')}")

    now = datetime.now(timezone.utc)
    cambios: dict = {"estado": body.estado, "updated_at": now}
    if body.estado == "listo":
        # Al cerrar el documento se toman los datos vigentes de la flota y se revisan las vigencias
        vehiculo, operadores = await flota_del_documento(
            db, doc["negocio_id"], doc["vehiculo_id"], [o["operador_id"] for o in doc["operadores"]])
        cambios["vehiculo_snapshot"] = snapshot(vehiculo)
        cambios["operadores"] = [{"operador_id": str(o["_id"]), "snapshot": snapshot(o)} for o in operadores]
        doc.update(cambios)
        problemas = problemas_de_vigencia(doc)
        if problemas:
            raise HTTPException(400, "No puede salir así: " + "; ".join(problemas))
        cambios["xml_interno"] = await run_in_threadpool(generar_xml_carta_porte, doc, now)
    entrada = {"estado": body.estado, "fecha": now, "usuario": user.get("nombre", ""), "nota": body.nota.strip()}
    # Solo si nadie lo cambió mientras tanto
    nuevo = await db.cartas_porte.find_one_and_update(
        {"_id": doc["_id"], "estado": anterior},
        {"$set": cambios, "$push": {"historial": entrada}}, return_document=True)
    if not nuevo:
        raise HTTPException(409, "La carta porte cambió de estado mientras tanto; recarga e intenta de nuevo")
    return a_carta(nuevo)


@router.post("/{id}/cancelar")
async def cancelar_carta_porte(
    id: str,
    body: Cancelacion,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    doc = await obtener_carta(db, id, user)
    if doc["estado"] in ("entregado", "cancelado"):
        raise HTTPException(400, f"La carta porte ya está {doc['estado']}")
    now = datetime.now(timezone.utc)
    nuevo = await db.cartas_porte.find_one_and_update(
        {"_id": doc["_id"]},
        {"$set": {"estado": "cancelado", "motivo_cancelacion": body.motivo.strip(), "updated_at": now},
         "$push": {"historial": {"estado": "cancelado", "fecha": now, "usuario": user.get("nombre", ""), "nota": body.motivo.strip()}}},
        return_document=True)
    return a_carta(nuevo)


@router.get("/{id}/xml")
async def descargar_xml(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """XML interno sin sello ni timbre: no tiene validez fiscal."""
    doc = await obtener_carta(db, id, user)
    return Response(doc["xml_interno"], media_type="application/xml", headers={
        "Content-Disposition": f'attachment; filename="carta-porte-{doc["folio"]}-sin-timbre.xml"'})


def domicilio_texto(d: dict) -> dict:
    """Nombres de los catálogos para imprimir (en el documento se guardan las claves)."""
    cp = catalogos.codigo_postal(d["codigo_postal"]) or {}
    colonia = next((c["descripcion"] for c in cp.get("colonias", []) if c["clave"] == d.get("colonia")), "")
    calle = " ".join(filter(None, [d.get("calle"), d.get("num_exterior"), f"int. {d['num_interior']}" if d.get("num_interior") else ""]))
    return {
        "linea1": calle,
        "linea2": ", ".join(filter(None, [colonia and f"Col. {colonia}", cp.get("municipio_nombre"),
                                          cp.get("estado_nombre"), f"C.P. {d['codigo_postal']}"])),
        "referencia": d.get("referencia", ""),
    }


@router.get("/{id}/pdf")
async def descargar_pdf(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """Representación impresa interna; se genera con los datos actuales del documento."""
    doc = await obtener_carta(db, id, user)
    config = await db.config_negocios.find_one({"_id": doc["negocio_id"]}) or {}
    contenido = await run_in_threadpool(render_pdf, "carta_porte.html", **contexto_pdf(doc, config))
    return Response(contenido, media_type="application/pdf", headers={
        "Content-Disposition": f'inline; filename="carta-porte-{doc["folio"]}.pdf"'})


def contexto_pdf(doc: dict, config: dict) -> dict:
    v = doc["vehiculo_snapshot"]
    return {
        "c": doc,
        "clinica": datos_clinica(config),
        "expedicion": fecha_larga(doc["created_at"]),
        "salida": fecha_larga(doc["origen"]["fecha_hora_salida"]),
        "origen_dom": domicilio_texto(doc["origen"]["domicilio"]),
        "destinos": [{**d, "llegada": fecha_larga(d["fecha_hora_llegada"]), "dom": domicilio_texto(d["domicilio"])}
                     for d in doc["destinos"]],
        "regimen": catalogos.regimen_fiscal().get(doc["emisor"]["regimen_fiscal"], {}).get("descripcion", ""),
        "config_vehicular": catalogos.config_autotransporte().get(v["config_vehicular"], {}).get("descripcion", ""),
        "permiso": catalogos.tipo_permiso().get(v["tipo_permiso_sct"], {}).get("descripcion", ""),
        "subtipos": {k: d["descripcion"] for k, d in catalogos.subtipo_remolque().items()},
        "unidades": {m["clave_unidad"]: catalogos.clave_unidad().get(m["clave_unidad"], {}).get("descripcion", "")
                     for m in doc["mercancias"]},
        "licencias": catalogos.TIPO_LICENCIA,
        "peso_total": doc["peso_bruto_total"] / catalogos.KG_POR_UNIDAD[doc["unidad_peso"]],
        "valor_total": sum(m.get("valor_mercancia") or 0 for m in doc["mercancias"] if m.get("moneda", "MXN") == "MXN"),
    }
