"""
Catálogos SAT del complemento Carta Porte 3.1 (y del CFDI 4.0 que lo contiene).

Los datos salen de los Excel oficiales del SAT con scripts/generar_catalogos_sat.py y
viven en datos_sat/ (no en MongoDB: son estáticos y cambian solo cuando el SAT publica
una revisión). Se cargan la primera vez que se usan.

Solo se modela autotransporte: el traslado propio de mercancía por carretera.
"""
import gzip
import json
import unicodedata
from functools import lru_cache
from pathlib import Path

DATOS = Path(__file__).resolve().parent / "datos_sat"


@lru_cache(maxsize=None)
def _json(nombre: str):
    ruta = DATOS / f"{nombre}.json"
    if ruta.exists():
        return json.loads(ruta.read_text(encoding="utf-8"))
    return json.loads(gzip.decompress((DATOS / f"{nombre}.json.gz").read_bytes()))


def _dict(nombre: str) -> dict[str, dict]:
    return {d["clave"]: d for d in _json(nombre)}


def normalizar(texto: str) -> str:
    sin_acentos = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode()
    return " ".join(sin_acentos.lower().split())


# ── Catálogos chicos (clave → registro) ───────────────────────────────────────

def config_autotransporte() -> dict[str, dict]:
    """c_ConfigAutotransporte. `remolque`: "0" sin remolque, "1" lo requiere, "0,1" opcional."""
    return _dict("config_autotransporte")


def tipo_permiso() -> dict[str, dict]:
    """c_TipoPermiso de autotransporte. Traslado propio: normalmente TPAF02 (transporte privado de carga)."""
    return _dict("tipo_permiso")


def subtipo_remolque() -> dict[str, dict]:
    return _dict("subtipo_remolque")


def unidad_peso() -> dict[str, dict]:
    return _dict("unidad_peso")


def estados() -> dict[str, dict]:
    """c_Estado de México (en el XML va la clave: JAL, CMX…)."""
    return _dict("estado")


def regimen_fiscal() -> dict[str, dict]:
    return _dict("regimen_fiscal")


def clave_unidad() -> dict[str, dict]:
    """c_ClaveUnidad del CFDI: unidad de la cantidad de cada mercancía (pieza, caja, kilo…)."""
    return _dict("clave_unidad")


def tipo_embalaje() -> dict[str, dict]:
    return _dict("tipo_embalaje")


def figura_transporte() -> dict[str, dict]:
    return _dict("figura_transporte")


# Unidades de la cantidad más usadas; el catálogo completo se busca con buscar_clave_unidad
UNIDADES_FRECUENTES = ["H87", "XBX", "KGM", "XPK", "LTR", "MTR", "XUN", "SET", "TNE", "XBG", "MTK", "MTQ"]

# Unidad de peso del documento → kilogramos (PesoEnKg siempre va en kg)
KG_POR_UNIDAD = {"KGM": 1.0, "TNE": 1000.0, "GRM": 0.001, "LBR": 0.45359237}

# No es catálogo del SAT (no va en el XML). Categorías de la licencia federal de conductor según el
# "ACUERDO por el que se establecen las categorías de la licencia federal de conductor atendiendo al
# tipo de vehículo y clase de servicio" (SCT, DOF, febrero de 2016).
TIPO_LICENCIA = {
    "A": "Federal A: pasajeros y turismo, y transporte privado de personas",
    "B": "Federal B: carga general (excepto doblemente articulados y materiales peligrosos)",
    "C": "Federal C: carga en camión de 2 o 3 ejes, rabón o torton (excepto materiales peligrosos)",
    "D": "Federal D: turismo en modalidad chofer-guía",
    "E": "Federal E: tractocamión doblemente articulado y/o materiales y residuos peligrosos",
    "F": "Federal F: pasajeros de o hacia puertos marítimos y aeropuertos federales",
    "ESTATAL": "Licencia estatal (vehículo ligero de carga)",
}

# Configuraciones de tractocamión doblemente articulado (TSR y TSS): T…S…R… y T…S…S…
def doblemente_articulado(config: str) -> bool:
    return config.startswith("T") and (config.count("S") == 2 or "R" in config)


def problema_de_licencia(tipo: str, config: str, material_peligroso: bool) -> str:
    """Por qué esa licencia no permite conducir ese vehículo con esa carga ("" si sí lo permite)."""
    if tipo in ("A", "D", "F"):
        return "es de pasajeros, no de carga"
    if material_peligroso and tipo != "E":
        return "el material peligroso requiere licencia federal E"
    if doblemente_articulado(config) and tipo != "E":
        return f"un tractocamión doblemente articulado ({config}) requiere licencia federal E"
    if tipo == "C" and config not in ("C2", "C3", "VL"):
        return f"la C es para camiones de 2 o 3 ejes, no para {config}"
    if tipo == "ESTATAL" and config != "VL":
        return f"una licencia estatal no ampara un {config}; se requiere licencia federal"
    return ""

# Solo autotransporte (c_CveTransporte 01)
CVE_TRANSPORTE = {"01": "Autotransporte"}


def remolque_requerido(config: str) -> str:
    """"0": no lleva remolque, "1": lo requiere, "0,1": opcional."""
    return config_autotransporte().get(config, {}).get("remolque", "0,1")


# ── Catálogos grandes: búsqueda ───────────────────────────────────────────────

@lru_cache(maxsize=None)
def _productos() -> dict[str, tuple]:
    """c_ClaveProdServCP: clave → (descripción, palabras similares, material peligroso "0" | "1" | "0,1")."""
    return {p[0]: (p[1], p[2], p[3]) for p in _json("productos_cp")}


@lru_cache(maxsize=None)
def _indice_productos() -> list[tuple[str, str]]:
    return [(clave, normalizar(f"{d} {s}")) for clave, (d, s, _) in _productos().items()]


def producto(clave: str) -> dict | None:
    p = _productos().get(clave)
    if not p:
        return None
    return {"clave": clave, "descripcion": p[0], "similares": p[1], "material_peligroso": p[2]}


def buscar_productos(q: str, limite: int = 20) -> list[dict]:
    """Por clave (prefijo) o por palabras de la descripción y de las palabras similares."""
    q = q.strip()
    if not q:
        return []
    if q.isdigit():
        claves = [c for c in _productos() if c.startswith(q)]
    else:
        terminos = normalizar(q).split()
        claves = [c for c, texto in _indice_productos() if all(t in texto for t in terminos)]
    return [producto(c) for c in claves[:limite]]


@lru_cache(maxsize=None)
def _materiales() -> dict[str, tuple]:
    return {m[0]: (m[1], m[2]) for m in _json("material_peligroso")}


def material_peligroso(clave: str) -> dict | None:
    m = _materiales().get(clave)
    return {"clave": clave, "descripcion": m[0], "clase": m[1]} if m else None


def buscar_material_peligroso(q: str, limite: int = 20) -> list[dict]:
    q = q.strip()
    if q.isdigit():
        claves = [c for c in _materiales() if c.startswith(q.zfill(4) if len(q) >= 4 else q)]
    else:
        terminos = normalizar(q).split()
        claves = [c for c, (d, _) in _materiales().items() if all(t in normalizar(d) for t in terminos)]
    return [material_peligroso(c) for c in claves[:limite]]


def buscar_clave_unidad(q: str, limite: int = 20) -> list[dict]:
    q = q.strip()
    unidades = clave_unidad()
    if q.upper() in unidades:
        return [unidades[q.upper()]]
    terminos = normalizar(q).split()
    return [u for u in unidades.values() if all(t in normalizar(u["descripcion"]) for t in terminos)][:limite]


@lru_cache(maxsize=None)
def _municipios() -> dict[tuple[str, str], str]:
    return {(m["estado"], m["clave"]): m["descripcion"] for m in _json("municipio")}


@lru_cache(maxsize=None)
def _localidades() -> dict[tuple[str, str], str]:
    return {(l["estado"], l["clave"]): l["descripcion"] for l in _json("localidad")}


def municipios_de(estado: str) -> list[dict]:
    return [{"clave": c, "descripcion": d} for (e, c), d in sorted(_municipios().items()) if e == estado]


def municipio(estado: str, clave: str) -> str:
    return _municipios().get((estado, clave), "")


def codigo_postal(cp: str) -> dict | None:
    """Estado, municipio, localidad y colonias de un código postal (c_CodigoPostal y c_Colonia)."""
    datos = _json("codigos_postales").get(cp)
    if not datos:
        return None
    estado, mun, loc = datos
    return {
        "codigo_postal": cp,
        "estado": estado,
        "estado_nombre": estados().get(estado, {}).get("descripcion", ""),
        "municipio": mun,
        "municipio_nombre": municipio(estado, mun),
        "localidad": loc,
        "localidad_nombre": _localidades().get((estado, loc), ""),
        "colonias": [{"clave": c, "descripcion": n} for c, n in sorted(_json("colonias").get(cp, []), key=lambda x: x[1])],
    }


def colonia_valida(cp: str, clave: str) -> bool:
    return any(c == clave for c, _ in _json("colonias").get(cp, []))


def para_frontend() -> dict:
    """Catálogos chicos para llenar los selectores; los grandes se buscan aparte."""
    def lista(d):
        return [{"clave": k, "descripcion": v["descripcion"] if isinstance(v, dict) else v} for k, v in d.items()]
    unidades = clave_unidad()
    return {
        "config_autotransporte": list(config_autotransporte().values()),
        "tipo_permiso": lista(tipo_permiso()),
        "subtipo_remolque": lista(subtipo_remolque()),
        "unidad_peso": [unidad_peso()[k] for k in KG_POR_UNIDAD],
        "estados": lista(estados()),
        "regimen_fiscal": list(regimen_fiscal().values()),
        "tipo_licencia": lista(TIPO_LICENCIA),
        "cve_transporte": lista(CVE_TRANSPORTE),
        "unidades_frecuentes": [unidades[k] for k in UNIDADES_FRECUENTES if k in unidades],
        "tipo_embalaje": lista(tipo_embalaje()),
    }
