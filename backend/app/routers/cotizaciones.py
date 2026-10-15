from datetime import date, datetime, timedelta

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pymongo import ReturnDocument

from ..core.database import get_db
from ..core.security import get_current_user
from ..models.base import serialize_list

from io import BytesIO
from fastapi.responses import StreamingResponse
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
router = APIRouter()


def user_businesses(user: dict):
    negocios = user.get("negocios") or user.get("businesses") or []

    if isinstance(negocios, str):
        negocios = [negocios]

    return set(negocios)


def check_business(user: dict, negocio_id: str):
    if negocio_id not in user_businesses(user):
        raise HTTPException(
            status_code=403,
            detail="No tienes acceso a este negocio",
        )


async def generar_numero_cotizacion(db, negocio_id: str) -> str:
    config = await db.config_negocios.find_one(
        {"_id": negocio_id},
        {"prefijo_cotizacion": 1},
    )

    if not config:
        raise HTTPException(
            status_code=404,
            detail="Configuración del negocio no encontrada",
        )

    prefijo = config.get("prefijo_cotizacion")

    if not prefijo:
        raise HTTPException(
            status_code=400,
            detail="El negocio no tiene prefijo de cotización configurado",
        )

    contador = await db.contadores_cotizaciones.find_one_and_update(
        {"_id": negocio_id},
        {
            "$inc": {"secuencia": 1},
            "$set": {"updated_at": datetime.utcnow()},
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )

    return f"{prefijo}-{contador['secuencia']:06d}"


@router.get("/")
async def listar_cotizaciones(
    negocio_id: str,
    estado: str | None = None,
    cliente_id: str | None = None,
    page: int = 1,
    limit: int = 20,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    check_business(user, negocio_id)

    filtro = {"negocio_id": negocio_id}

    if estado:
        filtro["estado"] = estado

    if cliente_id:
        filtro["cliente_id"] = cliente_id

    skip = (page - 1) * limit

    cursor = (
        db.cotizaciones
        .find(filtro)
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    )

    docs = await cursor.to_list(length=limit)
    total = await db.cotizaciones.count_documents(filtro)

    return {
        "data": serialize_list(docs),
        "total": total,
        "page": page,
        "limit": limit,
    }


@router.get("/{id}")
async def obtener_cotizacion(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        oid = ObjectId(id)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="ID inválido",
        )

    cotizacion = await db.cotizaciones.find_one({"_id": oid})

    if not cotizacion:
        raise HTTPException(
            status_code=404,
            detail="Cotización no encontrada",
        )

    check_business(user, cotizacion["negocio_id"])

    return serialize_list([cotizacion])[0]


@router.post("/", status_code=201)
async def crear_cotizacion(
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    negocio_id = body.get("negocio_id")

    if not negocio_id:
        raise HTTPException(
            status_code=400,
            detail="negocio_id es obligatorio",
        )

    check_business(user, negocio_id)

    numero = await generar_numero_cotizacion(
        db,
        negocio_id,
    )

    body["numero"] = numero
    body.setdefault("estado", "borrador")
    body.setdefault("items", [])
    body.setdefault("pagos", [])
    body.setdefault("historial", [])
    body.setdefault("fecha_emision", date.today().isoformat())

    vigencia = int(body.get("vigencia_dias", 15))

    body.setdefault(
        "fecha_vencimiento",
        (
            date.today() + timedelta(days=vigencia)
        ).isoformat(),
    )

    ahora = datetime.utcnow()

    body.setdefault("created_at", ahora)
    body.setdefault("updated_at", ahora)

    result = await db.cotizaciones.insert_one(body)

    return {
        "id": str(result.inserted_id),
        "numero": numero,
    }


@router.put("/{id}")
async def editar_cotizacion(
    id: str,
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        oid = ObjectId(id)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="ID inválido",
        )

    cotizacion = await db.cotizaciones.find_one({"_id": oid})

    if not cotizacion:
        raise HTTPException(
            status_code=404,
            detail="Cotización no encontrada",
        )

    negocio_id = cotizacion["negocio_id"]

    check_business(user, negocio_id)

    # El folio, negocio y fechas de creación no se modifican.
    campos_permitidos = {
        "cliente_id",
        "cliente_nombre",
        "vigencia_dias",
        "fecha_vencimiento",
        "items",
        "subtotal",
        "descuento_pct",
        "descuento",
        "iva_aplicable",
        "iva_pct",
        "iva",
        "total",
        "notas",
    }

    cambios = {
        clave: valor
        for clave, valor in body.items()
        if clave in campos_permitidos
    }

    if not cambios:
        raise HTTPException(
            status_code=400,
            detail="No hay datos para actualizar",
        )

    cambios["updated_at"] = datetime.utcnow()

    cambios_historial = {
        "fecha": datetime.utcnow().isoformat(),
        "accion": "editada",
        "estado": cotizacion.get("estado", "borrador"),
    }

    await db.cotizaciones.update_one(
        {"_id": oid},
        {
            "$set": cambios,
            "$push": {
                "historial": cambios_historial,
            },
        },
    )

    actualizada = await db.cotizaciones.find_one({"_id": oid})

    return serialize_list([actualizada])[0]


@router.patch("/{id}/estado")
async def cambiar_estado(
    id: str,
    body: dict,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        oid = ObjectId(id)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="ID inválido",
        )

    cotizacion = await db.cotizaciones.find_one({"_id": oid})

    if not cotizacion:
        raise HTTPException(
            status_code=404,
            detail="Cotización no encontrada",
        )

    check_business(
        user,
        cotizacion["negocio_id"],
    )

    estado = body.get("estado")

    estados_validos = {
        "borrador",
        "enviada",
        "aceptada",
        "rechazada",
        "vencida",
    }

    if estado not in estados_validos:
        raise HTTPException(
            status_code=400,
            detail="Estado de cotización inválido",
        )

    ahora = datetime.utcnow()

    await db.cotizaciones.update_one(
        {"_id": oid},
        {
            "$set": {
                "estado": estado,
                "updated_at": ahora,
            },
            "$push": {
                "historial": {
                    "fecha": ahora.isoformat(),
                    "accion": "cambio_estado",
                    "estado": estado,
                }
            },
        },
    )

    return {
        "ok": True,
        "estado": estado,
    }


@router.delete("/{id}")
async def eliminar_cotizacion(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        oid = ObjectId(id)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="ID inválido",
        )

    cotizacion = await db.cotizaciones.find_one({"_id": oid})

    if not cotizacion:
        raise HTTPException(
            status_code=404,
            detail="Cotización no encontrada",
        )

    check_business(
        user,
        cotizacion["negocio_id"],
    )

    resultado = await db.cotizaciones.delete_one(
        {"_id": oid}
    )

    if resultado.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Cotización no encontrada",
        )

    return {
        "ok": True,
        "message": "Cotización eliminada correctamente",
        "id": id,
    }
@router.get("/{id}/pdf")
async def generar_pdf_cotizacion(
    id: str,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        oid = ObjectId(id)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="ID inválido",
        )

    cotizacion = await db.cotizaciones.find_one({
        "_id": oid
    })

    if not cotizacion:
        raise HTTPException(
            status_code=404,
            detail="Cotización no encontrada",
        )

    negocio_id = cotizacion.get("negocio_id")

    check_business(user, negocio_id)

    # -------------------------------------------------
    # DATOS DEL NEGOCIO
    # -------------------------------------------------

    config = await db.config_negocios.find_one({
        "_id": negocio_id
    })

    nombre_negocio = (
        config.get("nombre")
        if config
        else negocio_id
    )

    # -------------------------------------------------
    # PDF
    # -------------------------------------------------

    buffer = BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=15 * mm,
        leftMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
    )

    styles = getSampleStyleSheet()

    titulo = ParagraphStyle(
        "Titulo",
        parent=styles["Heading1"],
        fontSize=20,
        leading=24,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#1e293b"),
        spaceAfter=8,
    )

    subtitulo = ParagraphStyle(
        "Subtitulo",
        parent=styles["Normal"],
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#64748b"),
    )

    normal = ParagraphStyle(
        "NormalCustom",
        parent=styles["Normal"],
        fontSize=9,
        leading=12,
    )

    derecha = ParagraphStyle(
        "Derecha",
        parent=normal,
        alignment=TA_RIGHT,
    )

    elementos = []

    # -------------------------------------------------
    # ENCABEZADO
    # -------------------------------------------------

    elementos.append(
        Paragraph(
            nombre_negocio,
            titulo,
        )
    )

    elementos.append(
        Paragraph(
            "COTIZACIÓN",
            ParagraphStyle(
                "CotizacionTitulo",
                parent=titulo,
                fontSize=15,
            ),
        )
    )

    numero = cotizacion.get(
        "numero",
        "SIN NÚMERO"
    )

    fecha_emision = cotizacion.get(
        "fecha_emision",
        "-"
    )

    fecha_vencimiento = cotizacion.get(
        "fecha_vencimiento",
        "-"
    )

    datos_cotizacion = [
        [
            Paragraph(
                f"<b>No. Cotización:</b><br/>{numero}",
                normal,
            ),
            Paragraph(
                f"<b>Fecha de emisión:</b><br/>{fecha_emision}",
                normal,
            ),
            Paragraph(
                f"<b>Vigencia hasta:</b><br/>{fecha_vencimiento}",
                normal,
            ),
        ]
    ]

    tabla_info = Table(
        datos_cotizacion,
        colWidths=[
            60 * mm,
            60 * mm,
            60 * mm,
        ],
    )

    tabla_info.setStyle(
        TableStyle([
            (
                "BACKGROUND",
                (0, 0),
                (-1, -1),
                colors.HexColor("#f8fafc"),
            ),
            (
                "BOX",
                (0, 0),
                (-1, -1),
                0.5,
                colors.HexColor("#cbd5e1"),
            ),
            (
                "INNERGRID",
                (0, 0),
                (-1, -1),
                0.5,
                colors.HexColor("#e2e8f0"),
            ),
            (
                "VALIGN",
                (0, 0),
                (-1, -1),
                "TOP",
            ),
            (
                "LEFTPADDING",
                (0, 0),
                (-1, -1),
                8,
            ),
            (
                "RIGHTPADDING",
                (0, 0),
                (-1, -1),
                8,
            ),
            (
                "TOPPADDING",
                (0, 0),
                (-1, -1),
                8,
            ),
            (
                "BOTTOMPADDING",
                (0, 0),
                (-1, -1),
                8,
            ),
        ])
    )

    elementos.append(tabla_info)
    elementos.append(Spacer(1, 8 * mm))

    # -------------------------------------------------
    # CLIENTE
    # -------------------------------------------------

    elementos.append(
        Paragraph(
            "<b>DATOS DEL CLIENTE</b>",
            normal,
        )
    )

    cliente = cotizacion.get(
        "cliente_nombre",
        "Cliente"
    )

    cliente_info = Table([
        [
            Paragraph(
                f"<b>Cliente:</b> {cliente}",
                normal,
            )
        ]
    ], colWidths=[180 * mm])

    cliente_info.setStyle(
        TableStyle([
            (
                "BACKGROUND",
                (0, 0),
                (-1, -1),
                colors.white,
            ),
            (
                "BOX",
                (0, 0),
                (-1, -1),
                0.5,
                colors.HexColor("#cbd5e1"),
            ),
            (
                "LEFTPADDING",
                (0, 0),
                (-1, -1),
                8,
            ),
            (
                "TOPPADDING",
                (0, 0),
                (-1, -1),
                8,
            ),
            (
                "BOTTOMPADDING",
                (0, 0),
                (-1, -1),
                8,
            ),
        ])
    )

    elementos.append(cliente_info)
    elementos.append(Spacer(1, 8 * mm))

    # -------------------------------------------------
    # PRODUCTOS
    # -------------------------------------------------

    encabezados = [
        "Producto",
        "Código",
        "Cant.",
        "Precio",
        "Importe",
    ]

    filas = [encabezados]

    for item in cotizacion.get("items", []):
        cantidad = float(
            item.get("cantidad", 0)
        )

        precio = float(
            item.get("precio_unitario", 0)
        )

        importe = float(
            item.get(
                "importe",
                cantidad * precio
            )
        )

        nombre = item.get(
            "nombre",
            "Producto"
        )

        codigo = item.get(
            "codigo",
            item.get("sku", "")
        )

        filas.append([
            Paragraph(
                str(nombre),
                normal,
            ),
            Paragraph(
                str(codigo),
                normal,
            ),
            Paragraph(
                f"{cantidad:g}",
                derecha,
            ),
            Paragraph(
                f"${precio:,.2f}",
                derecha,
            ),
            Paragraph(
                f"${importe:,.2f}",
                derecha,
            ),
        ])

    tabla_items = Table(
        filas,
        colWidths=[
            68 * mm,
            30 * mm,
            18 * mm,
            32 * mm,
            32 * mm,
        ],
        repeatRows=1,
    )

    tabla_items.setStyle(
        TableStyle([
            (
                "BACKGROUND",
                (0, 0),
                (-1, 0),
                colors.HexColor("#1e293b"),
            ),
            (
                "TEXTCOLOR",
                (0, 0),
                (-1, 0),
                colors.white,
            ),
            (
                "FONTNAME",
                (0, 0),
                (-1, 0),
                "Helvetica-Bold",
            ),
            (
                "FONTSIZE",
                (0, 0),
                (-1, -1),
                8,
            ),
            (
                "GRID",
                (0, 0),
                (-1, -1),
                0.4,
                colors.HexColor("#cbd5e1"),
            ),
            (
                "VALIGN",
                (0, 0),
                (-1, -1),
                "MIDDLE",
            ),
            (
                "LEFTPADDING",
                (0, 0),
                (-1, -1),
                5,
            ),
            (
                "RIGHTPADDING",
                (0, 0),
                (-1, -1),
                5,
            ),
            (
                "TOPPADDING",
                (0, 0),
                (-1, -1),
                5,
            ),
            (
                "BOTTOMPADDING",
                (0, 0),
                (-1, -1),
                5,
            ),
        ])
    )

    elementos.append(tabla_items)
    elementos.append(Spacer(1, 8 * mm))

    # -------------------------------------------------
    # TOTALES
    # -------------------------------------------------

    subtotal = float(
        cotizacion.get("subtotal", 0)
    )

    descuento = float(
        cotizacion.get("descuento", 0)
    )

    iva = float(
        cotizacion.get("iva", 0)
    )

    total = float(
        cotizacion.get("total", 0)
    )

    tabla_totales = Table([
        [
            Paragraph(
                "<b>Subtotal:</b>",
                normal,
            ),
            Paragraph(
                f"${subtotal:,.2f}",
                derecha,
            ),
        ],
        [
            Paragraph(
                "<b>Descuento:</b>",
                normal,
            ),
            Paragraph(
                f"-${descuento:,.2f}",
                derecha,
            ),
        ],
        [
            Paragraph(
                "<b>IVA:</b>",
                normal,
            ),
            Paragraph(
                f"${iva:,.2f}",
                derecha,
            ),
        ],
        [
            Paragraph(
                "<b>TOTAL:</b>",
                normal,
            ),
            Paragraph(
                f"<b>${total:,.2f} MXN</b>",
                derecha,
            ),
        ],
    ], colWidths=[130 * mm, 50 * mm])

    tabla_totales.setStyle(
        TableStyle([
            (
                "LINEABOVE",
                (0, 0),
                (-1, 0),
                0.5,
                colors.HexColor("#cbd5e1"),
            ),
            (
                "LINEABOVE",
                (0, 3),
                (-1, 3),
                1,
                colors.HexColor("#1e293b"),
            ),
            (
                "BACKGROUND",
                (0, 3),
                (-1, 3),
                colors.HexColor("#f1f5f9"),
            ),
            (
                "LEFTPADDING",
                (0, 0),
                (-1, -1),
                8,
            ),
            (
                "RIGHTPADDING",
                (0, 0),
                (-1, -1),
                8,
            ),
            (
                "TOPPADDING",
                (0, 0),
                (-1, -1),
                5,
            ),
            (
                "BOTTOMPADDING",
                (0, 0),
                (-1, -1),
                5,
            ),
        ])
    )

    elementos.append(tabla_totales)

    # -------------------------------------------------
    # NOTAS
    # -------------------------------------------------

    notas = cotizacion.get("notas")

    if notas:
        elementos.append(Spacer(1, 8 * mm))

        elementos.append(
            Paragraph(
                "<b>NOTAS Y CONDICIONES</b>",
                normal,
            )
        )

        elementos.append(
            Paragraph(
                str(notas).replace(
                    "\n",
                    "<br/>"
                ),
                normal,
            )
        )

    elementos.append(Spacer(1, 10 * mm))

    elementos.append(
        Paragraph(
            "Gracias por su preferencia.",
            ParagraphStyle(
                "Final",
                parent=normal,
                alignment=TA_CENTER,
                textColor=colors.HexColor("#64748b"),
            ),
        )
    )

    doc.build(elementos)

    buffer.seek(0)

    nombre_archivo = (
        f"cotizacion-{numero}.pdf"
    )

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={
            "Content-Disposition":
                f'inline; filename="{nombre_archivo}"'
        },
    )