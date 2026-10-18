"""
Generación del reporte PDF de resultados de laboratorio (templates/resultado_lab.html).

Se usa desde el módulo interno (descarga del personal), el envío por
correo al paciente y el portal del paciente.
"""
from datetime import datetime, timezone

from fastapi.concurrency import run_in_threadpool

from app.modules.clinica.pdf import datos_clinica, fecha_larga, render_pdf
from app.services.rangos_lab import texto_referencia

ETIQUETA_FLAG = {"alto": "Alto ↑", "bajo": "Bajo ↓", "critico": "CRÍTICO", "normal": "Normal", "pendiente": ""}
AVISO_PIE = "Los resultados deben ser interpretados por un médico. Este reporte no tiene validez sin firma autorizada."


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
    sexo = orden.get("paciente_sexo", "masculino")

    secciones = []
    for res in resultados:
        estado = res.get("estado", "pendiente")
        if estado == "pendiente" or (solo_validados and estado != "validado"):
            continue
        secciones.append({
            "nombre":         res.get("estudio_nombre", ""),
            "categoria":      res.get("estudio_categoria", ""),
            "validado":       estado == "validado",
            "observaciones":  (res.get("observaciones") or "").strip(),
            "tecnico":        res.get("tecnico_nombre", ""),
            "validado_por":   res.get("validado_por", ""),
            "analitos": [{
                "nombre":     a.get("nombre", ""),
                "valor":      a.get("valor") or "—",
                "unidad":     a.get("unidad", ""),
                "referencia": texto_referencia(a, sexo),
                "flag":       a.get("flag", "pendiente"),
                "etiqueta":   ETIQUETA_FLAG.get(a.get("flag", ""), ""),
            } for a in res.get("analitos", [])],
        })

    validaciones = [r["fecha_validacion"] for r in resultados if r.get("fecha_validacion")]
    muestra = orden.get("muestra") or {}
    validadores = sorted({s["validado_por"] for s in secciones if s["validado_por"]})
    contexto = {
        "orden":        orden,
        "clinica":      datos_clinica(config),
        "secciones":    secciones,
        "hay_criticos": any(a["flag"] == "critico" for s in secciones for a in s["analitos"]),
        "parcial":      len(secciones) < len(resultados),
        "fecha_toma":   fecha_larga(muestra["fecha_toma"]) if muestra.get("fecha_toma") else "—",
        "tipo_muestra": (muestra.get("tipo") or "").capitalize(),
        "fecha_reporte": fecha_larga(max(validaciones) if validaciones else datetime.now(timezone.utc)),
        "generado":     fecha_larga(datetime.now(timezone.utc)),
        "director":     config.get("director", ""),
        "cedula":       config.get("cedula_director", ""),
        "firma":        config.get("firma_director_base64", "") if (config.get("firma_director_base64") or "").startswith("data:image/") else "",
        "validadores":  ", ".join(validadores),
        "aviso":        config.get("aviso_pie") or AVISO_PIE,
    }
    return await run_in_threadpool(render_pdf, "resultado_lab.html", **contexto)
