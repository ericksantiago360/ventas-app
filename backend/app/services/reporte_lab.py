"""
Generación del reporte PDF de resultados de laboratorio.

Se usa desde el módulo interno (descarga del personal), el envío por
correo al paciente y el portal del paciente.
"""
from datetime import datetime, timezone
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
)

_FLAG_SYMBOL = {"alto": " ↑", "bajo": " ↓", "critico": " ↑↑", "normal": "", "pendiente": ""}
_FLAG_COLOR  = {"alto": colors.HexColor("#b45309"), "bajo": colors.HexColor("#1d4ed8"),
                "critico": colors.HexColor("#b91c1c"), "normal": colors.black, "pendiente": colors.HexColor("#94a3b8")}


def nombre_archivo_pdf(orden: dict) -> str:
    folio = orden.get("folio", "reporte").replace("/", "-")
    return f"resultado-{folio}.pdf"


async def generar_pdf_resultados(db, orden: dict, solo_validados: bool = False) -> bytes:
    """Devuelve el PDF de la orden. Con solo_validados=True omite estudios no validados
    (lo que ve el paciente); el personal ve también los capturados."""
    resultados = await db.resultados_lab.find(
        {"orden_id": str(orden["_id"])}
    ).sort("estudio_nombre", 1).to_list(50)

    config = await db.config_negocios.find_one({"_id": orden["negocio_id"]}) or {}
    lab_nombre       = config.get("nombre",          "Laboratorio de Análisis Clínico")
    lab_nombre_corto = config.get("nombre_corto",    "")
    lab_direccion    = config.get("direccion",        "")
    lab_colonia      = config.get("colonia",          "")
    lab_ciudad       = config.get("ciudad",           "")
    lab_estado_rep   = config.get("estado_rep",       "")
    lab_cp           = config.get("cp",               "")
    lab_tel          = config.get("telefono",         "")
    lab_email        = config.get("email",            "")
    lab_rfc          = config.get("rfc",              "")
    lab_director     = config.get("director",         "")
    lab_cedula       = config.get("cedula_director",  "")
    lab_aviso        = config.get("aviso_pie",        "Los resultados deben ser interpretados por un médico. Este reporte no tiene validez sin firma autorizada.")

    # Construir líneas de dirección
    dir_linea1 = lab_direccion
    dir_linea2_parts = [p for p in [lab_colonia, lab_ciudad, lab_estado_rep, f"C.P. {lab_cp}" if lab_cp else ""] if p]
    dir_linea2 = "  ·  ".join(dir_linea2_parts)
    contacto_parts = [p for p in [f"Tel: {lab_tel}" if lab_tel else "", f"Email: {lab_email}" if lab_email else "", f"RFC: {lab_rfc}" if lab_rfc else ""] if p]
    contacto_linea = "   ·   ".join(contacto_parts)

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        rightMargin=15 * mm, leftMargin=15 * mm,
        topMargin=14 * mm,   bottomMargin=14 * mm,
    )

    st = getSampleStyleSheet()

    def P(txt, style):
        return Paragraph(str(txt), style)

    # ── Estilos de texto ──────────────────────────────────────────────────────
    sLab  = ParagraphStyle("lab",  fontSize=16, fontName="Helvetica-Bold",  textColor=colors.HexColor("#0f172a"))
    sSub  = ParagraphStyle("sub",  fontSize=8.5, textColor=colors.HexColor("#64748b"))
    sTit  = ParagraphStyle("tit",  fontSize=9,  fontName="Helvetica-Bold",  textColor=colors.HexColor("#1e293b"))
    sVal  = ParagraphStyle("val",  fontSize=9,  textColor=colors.HexColor("#1e293b"))
    sSect = ParagraphStyle("sect", fontSize=10, fontName="Helvetica-Bold",  textColor=colors.HexColor("#1d4ed8"), spaceAfter=4)
    sNote = ParagraphStyle("note", fontSize=7.5, textColor=colors.HexColor("#94a3b8"), alignment=TA_CENTER)
    sFoot = ParagraphStyle("foot", fontSize=8,  textColor=colors.HexColor("#64748b"),  alignment=TA_CENTER)

    story = []

    # ── Cabecera del laboratorio ──────────────────────────────────────────────
    sDir = ParagraphStyle("dir", fontSize=8, textColor=colors.HexColor("#475569"), leading=12)
    sContact = ParagraphStyle("ct", fontSize=7.5, textColor=colors.HexColor("#94a3b8"), leading=11)

    dir_lines = "<br/>".join(filter(None, [dir_linea1, dir_linea2, contacto_linea]))

    header_data = [[
        P(lab_nombre, sLab),
        P(dir_lines or "", sDir),
    ]]
    header_tbl = Table(header_data, colWidths=["55%", "45%"])
    header_tbl.setStyle(TableStyle([
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ("ALIGN",         (1, 0), (1,  0),  "RIGHT"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(header_tbl)
    story.append(HRFlowable(width="100%", thickness=2, color=colors.HexColor("#1d4ed8"), spaceAfter=2))
    story.append(HRFlowable(width="100%", thickness=0.4, color=colors.HexColor("#93c5fd"), spaceAfter=6))

    # ── Título del reporte ────────────────────────────────────────────────────
    story.append(P("REPORTE DE RESULTADOS DE LABORATORIO", ParagraphStyle("rt", fontSize=11, fontName="Helvetica-Bold",
                                                            alignment=TA_CENTER, textColor=colors.HexColor("#1d4ed8"), spaceAfter=8)))

    # ── Datos del paciente y orden ────────────────────────────────────────────
    paciente_data = [
        [P("Paciente",        sTit), P(orden.get("paciente_nombre", ""), sVal),
         P("Folio expediente",sTit), P(orden.get("paciente_folio", "—"), sVal)],
        [P("Sexo / Edad",     sTit), P(f"{orden.get('paciente_sexo','—').capitalize()} · {orden.get('paciente_edad','')} años", sVal),
         P("Folio orden",     sTit), P(orden.get("folio", ""), sVal)],
        [P("Médico solicitante",sTit), P(orden.get("medico_solicitante", "—"), sVal),
         P("Fecha",           sTit), P(orden.get("fecha", "—"), sVal)],
    ]
    pac_tbl = Table(paciente_data, colWidths=["22%", "28%", "22%", "28%"])
    pac_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ("BOX",           (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("INNERGRID",     (0, 0), (-1, -1), 0.3, colors.HexColor("#e2e8f0")),
        ("PADDING",       (0, 0), (-1, -1), 5),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(pac_tbl)
    story.append(Spacer(1, 10))

    # ── Resultados por estudio ────────────────────────────────────────────────
    col_w = ["36%", "14%", "12%", "24%", "14%"]

    for res in resultados:
        estado = res.get("estado", "pendiente")
        if estado == "pendiente" or (solo_validados and estado != "validado"):
            continue  # omitir estudios sin captura

        story.append(P(res.get("estudio_nombre", ""), sSect))

        # Cabecera de la tabla
        header_row = [
            Paragraph("Analito",             ParagraphStyle("th", fontSize=8, fontName="Helvetica-Bold", textColor=colors.HexColor("#64748b"))),
            Paragraph("Resultado",           ParagraphStyle("th", fontSize=8, fontName="Helvetica-Bold", textColor=colors.HexColor("#64748b"), alignment=TA_RIGHT)),
            Paragraph("Unidad",              ParagraphStyle("th", fontSize=8, fontName="Helvetica-Bold", textColor=colors.HexColor("#64748b"))),
            Paragraph("Referencia",          ParagraphStyle("th", fontSize=8, fontName="Helvetica-Bold", textColor=colors.HexColor("#64748b"))),
            Paragraph("",                    ParagraphStyle("th", fontSize=8)),
        ]
        rows = [header_row]

        sexo = orden.get("paciente_sexo", "masculino")

        for a in res.get("analitos", []):
            flag = a.get("flag", "pendiente")
            valor_txt = a.get("valor", "—") or "—"
            simbolo   = _FLAG_SYMBOL.get(flag, "")
            fcolor    = _FLAG_COLOR.get(flag,  colors.black)
            is_abn    = flag in ("alto", "bajo", "critico")
            font_name = "Helvetica-Bold" if is_abn else "Helvetica"

            if a.get("tipo") == "cualitativo":
                ref_txt = a.get("referencia_texto") or "—"
            else:
                if sexo == "femenino":
                    rmin, rmax = a.get("referencia_mujer_min"), a.get("referencia_mujer_max")
                else:
                    rmin, rmax = a.get("referencia_hombre_min"), a.get("referencia_hombre_max")
                ref_txt = f"{rmin} – {rmax}" if rmin is not None and rmax is not None else "—"

            flag_style = ParagraphStyle("f", fontSize=8.5, fontName="Helvetica-Bold", textColor=fcolor, alignment=TA_CENTER)
            val_style  = ParagraphStyle("v", fontSize=9,   fontName=font_name,        textColor=fcolor, alignment=TA_RIGHT)

            flag_label = {"alto":"↑ Alto","bajo":"↓ Bajo","critico":"!! Crítico","normal":"","pendiente":""}
            rows.append([
                Paragraph(a.get("nombre", ""), ParagraphStyle("n", fontSize=9)),
                Paragraph(valor_txt + simbolo,  val_style),
                Paragraph(a.get("unidad", "") or "", ParagraphStyle("u", fontSize=8.5, textColor=colors.HexColor("#64748b"))),
                Paragraph(ref_txt,              ParagraphStyle("r", fontSize=8.5, textColor=colors.HexColor("#64748b"))),
                Paragraph(flag_label.get(flag, ""), flag_style),
            ])

        tbl = Table(rows, colWidths=col_w)
        row_count = len(rows)
        tbl_style = [
            ("BACKGROUND",  (0, 0), (-1, 0),  colors.HexColor("#f1f5f9")),
            ("LINEBELOW",   (0, 0), (-1, 0),  0.8, colors.HexColor("#e2e8f0")),
            ("LINEBELOW",   (0, 1), (-1, -1), 0.3, colors.HexColor("#f1f5f9")),
            ("TOPPADDING",  (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING",(0,0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING",(0, 0), (-1, -1), 5),
            ("VALIGN",      (0, 0), (-1, -1), "MIDDLE"),
            ("BOX",         (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ]
        # Fondo sutil en filas anormales
        for i, a in enumerate(res.get("analitos", []), start=1):
            if a.get("flag") == "critico":
                tbl_style.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#fef2f2")))
            elif a.get("flag") in ("alto", "bajo"):
                tbl_style.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#fffbeb")))

        tbl.setStyle(TableStyle(tbl_style))
        story.append(tbl)

        # Observaciones del estudio
        obs = res.get("observaciones", "").strip()
        if obs:
            story.append(Spacer(1, 3))
            story.append(P(f"Obs: {obs}", ParagraphStyle("ob", fontSize=8, textColor=colors.HexColor("#64748b"), leftIndent=4)))
        if res.get("tecnico_nombre"):
            story.append(P(f"Técnico: {res['tecnico_nombre']}", ParagraphStyle("tc", fontSize=7.5, textColor=colors.HexColor("#94a3b8"), leftIndent=4)))

        story.append(Spacer(1, 10))

    # ── Leyenda de flags ──────────────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#e2e8f0"), spaceBefore=4, spaceAfter=4))
    story.append(P("↑ Alto  ·  ↓ Bajo  ·  !! Crítico  —  Los valores de referencia pueden variar según el método analítico.", sNote))
    story.append(Spacer(1, 3))
    story.append(P(lab_aviso, sNote))

    # ── Firmas ────────────────────────────────────────────────────────────────
    story.append(Spacer(1, 16))
    director_label = lab_director or "Director del Laboratorio"
    if lab_cedula:
        director_label += f"\nCéd. Prof. {lab_cedula}"
    firma_data = [[
        P("_________________________________\nTécnico de laboratorio", sFoot),
        P(f"_________________________________\n{director_label}", sFoot),
    ]]
    firma_tbl = Table(firma_data, colWidths=["50%", "50%"])
    firma_tbl.setStyle(TableStyle([("VALIGN", (0,0),(-1,-1),"TOP"), ("ALIGN",(0,0),(-1,-1),"CENTER")]))
    story.append(firma_tbl)

    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=0.4, color=colors.HexColor("#e2e8f0"), spaceAfter=4))
    ahora = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M")
    story.append(P(f"Generado: {ahora}  ·  {orden.get('folio','')}  ·  {lab_nombre}", sFoot))

    doc.build(story)
    return buf.getvalue()
