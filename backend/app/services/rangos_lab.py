"""
Rangos de referencia del laboratorio y cálculo del estado de cada resultado.

Colección `rangos_referencia` (por negocio):
    negocio_id, parametro, clave (nombre normalizado), aliases, unidad,
    rangos [{sexo: ambos|masculino|femenino, edad_min, edad_max, min, max,
             critico_min, critico_max}], activo, created_at, updated_at

Al crear una orden, a cada analito numérico se le fija `referencia_aplicada`
según la edad y el sexo del paciente: el rango del catálogo si el parámetro
coincide (por nombre o alias, y con la misma unidad), si no, el de la plantilla
del estudio. La captura, la pantalla y el PDF usan ese mismo rango.
"""
import unicodedata

# Sin límites críticos explícitos se usa la regla anterior: 30 % fuera del rango
FACTOR_CRITICO_BAJO = 0.7
FACTOR_CRITICO_ALTO = 1.3


def normalizar(texto: str) -> str:
    """'Glucosa ' → 'glucosa'; 'Ácido Úrico' → 'acido urico'."""
    sin_acentos = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode()
    return " ".join(sin_acentos.lower().split())


def misma_unidad(a: str, b: str) -> bool:
    """Una unidad vacía no se compara (el catálogo o la plantilla no la indicó)."""
    if not a or not b:
        return True
    return normalizar(a).replace(" ", "") == normalizar(b).replace(" ", "")


def rango_para(parametro: dict, edad: int, sexo: str) -> dict | None:
    """El rango del parámetro que corresponde a la edad; el de su sexo gana sobre 'ambos'."""
    candidatos = [r for r in parametro.get("rangos", [])
                  if r.get("edad_min", 0) <= edad <= r.get("edad_max", 999) and r.get("sexo", "ambos") in (sexo, "ambos")]
    candidatos.sort(key=lambda r: r.get("sexo") != sexo)
    return candidatos[0] if candidatos else None


def referencia_de_plantilla(analito: dict, sexo: str) -> dict:
    pre = "referencia_mujer" if sexo == "femenino" else "referencia_hombre"
    return {
        "min": analito.get(f"{pre}_min"), "max": analito.get(f"{pre}_max"),
        "critico_min": None, "critico_max": None, "fuente": "plantilla",
    }


async def catalogo_de_rangos(db, negocio_id: str) -> dict[str, dict]:
    """Índice clave/alias normalizado → parámetro, para resolver muchos analitos con una consulta."""
    indice = {}
    async for p in db.rangos_referencia.find({"negocio_id": negocio_id, "activo": True}):
        for nombre in [p["parametro"], *p.get("aliases", [])]:
            indice.setdefault(normalizar(nombre), p)
    return indice


def resolver_referencia(analito: dict, catalogo: dict[str, dict], edad: int, sexo: str) -> dict | None:
    if analito.get("tipo") == "cualitativo":
        return None
    parametro = catalogo.get(normalizar(analito.get("nombre", "")))
    if parametro and misma_unidad(parametro.get("unidad", ""), analito.get("unidad", "")):
        rango = rango_para(parametro, edad, sexo)
        if rango:
            return {
                "min": rango.get("min"), "max": rango.get("max"),
                "critico_min": rango.get("critico_min"), "critico_max": rango.get("critico_max"),
                "fuente": "catalogo", "parametro": parametro["parametro"],
            }
    return referencia_de_plantilla(analito, sexo)


def calcular_flag(valor: str, analito: dict, referencia: dict | None) -> str:
    """normal | alto | bajo | critico | pendiente (sin valor o sin rango)."""
    if analito.get("tipo") == "cualitativo":
        return "normal"
    try:
        num = float(str(valor).replace(",", "."))
    except (ValueError, TypeError):
        return "pendiente"
    ref = referencia or {}
    rmin, rmax = ref.get("min"), ref.get("max")
    cmin, cmax = ref.get("critico_min"), ref.get("critico_max")
    # Un rango del catálogo define sus críticos (o que no los tiene); la regla del 30 % es solo para plantillas
    explicitos = ref.get("fuente") == "catalogo" or cmin is not None or cmax is not None

    if explicitos:
        if (cmin is not None and num < cmin) or (cmax is not None and num > cmax):
            return "critico"
    if rmin is None or rmax is None:
        return "pendiente"
    if num < rmin:
        return "critico" if not explicitos and rmin > 0 and num < rmin * FACTOR_CRITICO_BAJO else "bajo"
    if num > rmax:
        return "critico" if not explicitos and num > rmax * FACTOR_CRITICO_ALTO else "alto"
    return "normal"


def texto_referencia(analito: dict, sexo: str = "masculino") -> str:
    """Rango a mostrar: el aplicado a la orden o, en órdenes anteriores, el de la plantilla."""
    if analito.get("tipo") == "cualitativo":
        return analito.get("referencia_texto") or "—"
    ref = analito.get("referencia_aplicada") or referencia_de_plantilla(analito, sexo)
    if ref.get("min") is None or ref.get("max") is None:
        return analito.get("referencia_texto") or "—"
    return f"{ref['min']:g} – {ref['max']:g}"


# ── Valores iniciales ─────────────────────────────────────────────────────────
# Referencias usuales en adultos y pediatría con valores críticos (de pánico) comunes.
# Son un punto de partida: el responsable sanitario del laboratorio debe revisarlos
# contra sus métodos y equipos antes de usarlos.

RANGOS_SEED = [
    {"parametro": "Glucosa", "unidad": "mg/dL", "aliases": ["Glucosa en ayuno", "Glucosa sérica"], "rangos": [
        {"sexo": "ambos", "edad_min": 0, "edad_max": 17, "min": 70, "max": 100, "critico_min": 40, "critico_max": 400},
        {"sexo": "ambos", "edad_min": 18, "edad_max": 999, "min": 70, "max": 110, "critico_min": 40, "critico_max": 400},
    ]},
    {"parametro": "Hemoglobina", "unidad": "g/dL", "aliases": ["Hb"], "rangos": [
        {"sexo": "ambos", "edad_min": 0, "edad_max": 17, "min": 11.0, "max": 15.5, "critico_min": 7.0, "critico_max": 20.0},
        {"sexo": "masculino", "edad_min": 18, "edad_max": 999, "min": 13.5, "max": 17.5, "critico_min": 7.0, "critico_max": 20.0},
        {"sexo": "femenino", "edad_min": 18, "edad_max": 999, "min": 12.0, "max": 15.5, "critico_min": 7.0, "critico_max": 20.0},
    ]},
    {"parametro": "Leucocitos", "unidad": "x10³/µL", "aliases": ["Glóbulos blancos", "WBC"], "rangos": [
        {"sexo": "ambos", "edad_min": 0, "edad_max": 17, "min": 5.0, "max": 14.5, "critico_min": 2.0, "critico_max": 30.0},
        {"sexo": "ambos", "edad_min": 18, "edad_max": 999, "min": 4.5, "max": 11.0, "critico_min": 2.0, "critico_max": 30.0},
    ]},
    {"parametro": "Plaquetas", "unidad": "x10³/µL", "aliases": ["PLT"], "rangos": [
        {"sexo": "ambos", "edad_min": 0, "edad_max": 999, "min": 150, "max": 400, "critico_min": 50, "critico_max": 1000},
    ]},
    {"parametro": "Creatinina", "unidad": "mg/dL", "aliases": [], "rangos": [
        {"sexo": "ambos", "edad_min": 0, "edad_max": 17, "min": 0.3, "max": 0.7, "critico_min": None, "critico_max": 4.0},
        {"sexo": "masculino", "edad_min": 18, "edad_max": 999, "min": 0.7, "max": 1.3, "critico_min": None, "critico_max": 4.0},
        {"sexo": "femenino", "edad_min": 18, "edad_max": 999, "min": 0.5, "max": 1.1, "critico_min": None, "critico_max": 4.0},
    ]},
    {"parametro": "Potasio", "unidad": "mmol/L", "aliases": ["K"], "rangos": [
        {"sexo": "ambos", "edad_min": 0, "edad_max": 999, "min": 3.5, "max": 5.1, "critico_min": 2.8, "critico_max": 6.2},
    ]},
    {"parametro": "Sodio", "unidad": "mmol/L", "aliases": ["Na"], "rangos": [
        {"sexo": "ambos", "edad_min": 0, "edad_max": 999, "min": 136, "max": 145, "critico_min": 120, "critico_max": 160},
    ]},
    {"parametro": "TSH", "unidad": "µUI/mL", "aliases": [], "rangos": [
        {"sexo": "ambos", "edad_min": 18, "edad_max": 999, "min": 0.27, "max": 4.2, "critico_min": None, "critico_max": None},
    ]},
    {"parametro": "HbA1c", "unidad": "%", "aliases": ["Hemoglobina glucosilada"], "rangos": [
        {"sexo": "ambos", "edad_min": 0, "edad_max": 999, "min": 4.0, "max": 5.7, "critico_min": None, "critico_max": None},
    ]},
]
