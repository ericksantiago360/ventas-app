"""
Constantes fiscales y de seguridad social 2026
Fuentes:
  - ISR: Anexo 8 RMF 2026, DOF 28-12-2025 (Art. 96 LISR, retención mensual)
  - UMA: INEGI, vigente desde 01-02-2026
  - IMSS: LSS (Ley del Seguro Social) cuotas obrero-patronales vigentes 2026
  - Subsidio al empleo: Decreto DOF 2026 (15.02% UMA mensual)

Reemplaza el bloque de constantes en backend/app/modules/nomina/constants.py
(o donde estén definidas actualmente).
"""

# ─── UMA 2026 ──────────────────────────────────────────────────────────────
# Vigente desde el 1 de febrero de 2026 (INEGI)
UMA_DIARIA   = 117.31
UMA_MENSUAL  = 3_566.22
UMA_ANUAL    = 42_794.64

# ─── Salario mínimo 2026 ───────────────────────────────────────────────────
# CONASAMI, vigente desde el 1 de enero de 2026
SALARIO_MINIMO_DIARIO      = 315.04   # resto del país
SALARIO_MINIMO_DIARIO_ZLFN = 440.87   # zona libre de la frontera norte

# ─── Tabla ISR mensual Art. 96 LISR 2026 ──────────────────────────────────
# Formato: (limite_inferior, limite_superior, cuota_fija, tasa_excedente)
# limite_superior de None = "en adelante"
# Fuente: Anexo 8 RMF 2026, DOF 28-12-2025
TABLA_ISR_MENSUAL_2026 = [
    (       0.01,     844.59,        0.00, 0.0192),
    (     844.60,   7_168.51,       16.22, 0.0640),
    (   7_168.52,  12_598.02,      420.95, 0.1088),
    (  12_598.03,  14_644.64,    1_011.68, 0.1600),
    (  14_644.65,  17_533.64,    1_339.14, 0.1792),
    (  17_533.65,  35_362.83,    1_856.84, 0.2136),
    (  35_362.84,  55_736.68,    5_665.16, 0.2352),
    (  55_736.69, 106_410.50,   10_457.09, 0.3000),
    ( 106_410.51, 141_880.66,   25_659.23, 0.3200),
    ( 141_880.67, 425_641.99,   37_009.69, 0.3400),
    ( 425_642.00,        None, 133_488.54, 0.3500),
]

# ─── Subsidio al empleo 2026 ───────────────────────────────────────────────
# Monto mensual = 15.02% de UMA mensual ($3,566.22)
# Solo aplica si ingreso gravable mensual <= SUBSIDIO_LIMITE_MENSUAL
SUBSIDIO_MENSUAL      = 535.65
SUBSIDIO_LIMITE_INGRESO = 11_492.66   # Si ingreso > este tope, subsidio = 0


# ─── Cuotas IMSS 2026 (obrero) ────────────────────────────────────────────
# Fuente: LSS vigente 2026; topes y primas confirmadas en RMF 2026
#
# La cuota obrera aplica sobre el SBC (Salario Base de Cotización).
# Tope máximo de SBC: 25 UMA diarias = 25 × $117.31 = $2,932.75/día
#                                                     = $89,155.60/mes
SBC_TOPE_DIARIO  = 25 * UMA_DIARIA        # $2,932.75
SBC_TOPE_MENSUAL = 25 * UMA_MENSUAL       # $89,155.50

# Enfermedades y Maternidad (EM)
# ┌ Cuota fija: solo patronal (20.40% sobre UMA), NO aplica al obrero
# ├ Cuota adicional (sobre SBC que excede 3 UMA)
EM_ADICIONAL_OBRERO       = 0.0040     # 0.40%  sobre (SBC - 3 UMA) si SBC > 3 UMA
EM_GASTOS_PENSION_OBRERO  = 0.00375    # 0.375% sobre SBC total
EM_PRESTACIONES_OBRERO    = 0.0025     # 0.25%  sobre SBC total

TRES_UMA_MENSUAL = 3 * UMA_MENSUAL     # $10,698.66 — umbral cuota adicional EM

# Invalidez y Vida (IV)
IV_OBRERO = 0.00625    # 0.625% sobre SBC total

# Cesantía en Edad Avanzada y Vejez (CEAV)
CEAV_OBRERO = 0.01125  # 1.125% sobre SBC total

# Retiro (RCV) — exclusivo patronal, obrero = 0
# Guarderías y Prestaciones Sociales — exclusivo patronal, obrero = 0


# ─── Función: calcular cuota obrera IMSS mensual ──────────────────────────
def cuota_obrera_imss(sbc_mensual: float) -> dict:
    """
    Calcula la cuota obrera IMSS para un SBC mensual dado (2026).

    Args:
        sbc_mensual: Salario Base de Cotización mensual (no puede exceder SBC_TOPE_MENSUAL).

    Returns:
        dict con desglose por ramo y total.

    Nota: El SBC diario se multiplica por 30.4 para calcular el mensual cuando
    se tiene el diario. Esta función recibe el mensual directamente.
    """
    sbc = min(sbc_mensual, SBC_TOPE_MENSUAL)

    # EM cuota adicional — solo sobre excedente de 3 UMA
    exceso_3uma = max(0.0, sbc - TRES_UMA_MENSUAL)
    em_adicional   = exceso_3uma * EM_ADICIONAL_OBRERO
    em_gastos_pens = sbc * EM_GASTOS_PENSION_OBRERO
    em_prestaciones = sbc * EM_PRESTACIONES_OBRERO
    iv             = sbc * IV_OBRERO
    ceav           = sbc * CEAV_OBRERO

    total = em_adicional + em_gastos_pens + em_prestaciones + iv + ceav

    return {
        "em_adicional":    round(em_adicional,   2),
        "em_gastos_pens":  round(em_gastos_pens, 2),
        "em_prestaciones": round(em_prestaciones,2),
        "invalidez_vida":  round(iv,             2),
        "ceav":            round(ceav,           2),
        "total":           round(total,          2),
    }


# ─── Función: calcular retención ISR mensual (Art. 96 LISR 2026) ──────────
def retener_isr_mensual(ingreso_gravable_mensual: float) -> dict:
    """
    Calcula la retención de ISR mensual para sueldos y salarios (Art. 96 LISR 2026).
    Aplica subsidio al empleo si el ingreso gravable <= SUBSIDIO_LIMITE_INGRESO.

    Args:
        ingreso_gravable_mensual: Ingreso gravable del periodo mensual.

    Returns:
        dict con: isr_tarifa, subsidio_aplicado, isr_retener

    El ingreso gravable = percepciones totales − exenciones (horas extra, PTU, etc.)
    """
    igm = ingreso_gravable_mensual

    # Buscar renglón de la tarifa
    isr_tarifa = 0.0
    for li, ls, cf, tasa in TABLA_ISR_MENSUAL_2026:
        if ls is None or igm <= ls:
            excedente = igm - li
            isr_tarifa = cf + excedente * tasa
            break

    # Subsidio al empleo
    subsidio = SUBSIDIO_MENSUAL if igm <= SUBSIDIO_LIMITE_INGRESO else 0.0

    # ISR a retener = ISR tarifa − subsidio  (nunca negativo)
    isr_retener = max(0.0, isr_tarifa - subsidio)

    return {
        "isr_tarifa":       round(isr_tarifa,  2),
        "subsidio_empleo":  round(subsidio,    2),
        "isr_retener":      round(isr_retener, 2),
    }


# ─── Ejemplo de uso ───────────────────────────────────────────────────────
if __name__ == "__main__":
    # Empleado con SBC = $12,000/mes, ingreso gravable = $11,000/mes
    sbc = 12_000.0
    ig  = 11_000.0

    imss = cuota_obrera_imss(sbc)
    isr  = retener_isr_mensual(ig)

    print("=== Cuota obrera IMSS 2026 ===")
    for k, v in imss.items():
        print(f"  {k:<20} ${v:>8.2f}")

    print("\n=== Retención ISR mensual 2026 ===")
    for k, v in isr.items():
        print(f"  {k:<20} ${v:>8.2f}")

    print(f"\n  Deducciones totales: ${imss['total'] + isr['isr_retener']:>8.2f}")
