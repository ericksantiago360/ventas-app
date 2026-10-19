"""
Genera los catálogos SAT que usa el módulo de Carta Porte a partir de los Excel oficiales.

    pip install xlrd==2.0.1          # solo para correr este script
    python scripts/generar_catalogos_sat.py CatalogosCartaPorte31.xls catCFDI_V_4_AAAAMMDD.xls

Descargas (SAT, Anexo 20 y complemento Carta Porte 3.1):
    http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/CatalogosCartaPorte31.xls
    http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/catCFDI_V_4_20240911.xls

Escribe en app/modules/carta_porte/datos_sat/. Se omiten las claves con fecha de fin de vigencia.
"""
import gzip
import json
import sys
from pathlib import Path

import xlrd

DESTINO = Path(__file__).resolve().parents[1] / "app" / "modules" / "carta_porte" / "datos_sat"


def texto(celda) -> str:
    if isinstance(celda, float):
        return str(int(celda)) if celda.is_integer() else str(celda)
    return " ".join(str(celda).replace("\xa0", " ").split())


def filas(libro, hojas, encabezado: str, ancho_clave: int = 0):
    """Filas de datos debajo del renglón cuyo primer valor es `encabezado`, en una o varias hojas."""
    for nombre in hojas:
        hoja = libro.sheet_by_name(nombre)
        inicio = next(i for i in range(hoja.nrows) if texto(hoja.cell_value(i, 0)).lower() == encabezado.lower())
        for i in range(inicio + 1, hoja.nrows):
            fila = [texto(c) for c in hoja.row_values(i)]
            if not fila[0] or fila[0].lower() == encabezado.lower():
                continue
            if ancho_clave:
                fila[0] = fila[0].zfill(ancho_clave)
            yield fila


def vigente(fecha_fin: str) -> bool:
    return not fecha_fin


def hoja(libro, nombre: str) -> str:
    """Algunas hojas traen espacios o mayúsculas distintas en el nombre."""
    return next(h for h in libro.sheet_names() if h.strip().lower() == nombre.lower())


def guardar(nombre: str, datos, comprimir: bool = False) -> None:
    contenido = json.dumps(datos, ensure_ascii=False, separators=(",", ":")).encode()
    ruta = DESTINO / (nombre + (".json.gz" if comprimir else ".json"))
    ruta.write_bytes(gzip.compress(contenido, mtime=0) if comprimir else contenido)
    print(f"  {ruta.name}: {len(datos)} registros, {ruta.stat().st_size // 1024} KB")


def main(xls_cp: str, xls_cfdi: str) -> None:
    cp = xlrd.open_workbook(xls_cp, on_demand=True)
    cfdi = xlrd.open_workbook(xls_cfdi, on_demand=True)
    DESTINO.mkdir(parents=True, exist_ok=True)

    config = [
        {"clave": f[0], "descripcion": f[1], "ejes": f[2], "llantas": f[3],   # texto: hay valores como "8 o 10"
         # "0": sin remolque, "1": requiere remolque, "0, 1": opcional
         "remolque": f[4].replace(" ", "")}
        for f in filas(cp, [hoja(cp, "c_ConfigAutotransporte")], "Clave nomenclatura") if vigente(f[6])
    ]
    permisos = [
        {"clave": f[0], "descripcion": f[1].rstrip("."), "transporte": f[2]}
        for f in filas(cp, [hoja(cp, "c_TipoPermiso")], "Clave") if vigente(f[4])
    ]
    pequenos = {
        "config_autotransporte": config,
        "tipo_permiso": [p for p in permisos if "01" in p["transporte"]],   # solo autotransporte
        "subtipo_remolque": [{"clave": f[0], "descripcion": f[1]}
                             for f in filas(cp, [hoja(cp, "c_SubTipoRem")], "Clave tipo remolque") if vigente(f[3])],
        "unidad_peso": [{"clave": f[0], "descripcion": f[1]}
                        for f in filas(cp, [hoja(cp, "c_ClaveUnidadPeso")], "Clave unidad") if vigente(f[5])],
        "figura_transporte": [{"clave": f[0], "descripcion": f[1]}
                              for f in filas(cp, [hoja(cp, "c_FiguraTransporte")], "Clave figura transporte") if vigente(f[3])],
        "tipo_embalaje": [{"clave": f[0], "descripcion": f[1]}
                          for f in filas(cp, [hoja(cp, "c_TipoEmbalaje")], "Clave de designación") if vigente(f[3])],
        "cve_transporte": [{"clave": f[0], "descripcion": f[1]}
                           for f in filas(cp, [hoja(cp, "c_CveTransporte")], "Clave transporte") if vigente(f[3])],
        "estado": [{"clave": f[0], "descripcion": f[2]}
                   for f in filas(cfdi, [hoja(cfdi, "c_Estado")], "c_Estado") if f[1] == "MEX" and vigente(f[4])],
        "regimen_fiscal": [{"clave": f[0], "descripcion": f[1], "fisica": f[2] == "Sí", "moral": f[3] == "Sí"}
                           for f in filas(cfdi, [hoja(cfdi, "c_RegimenFiscal")], "c_RegimenFiscal", 3) if vigente(f[5])],
        # El Excel escribe "Dx"; el XSD (que es lo que valida el PAC), "DX"
        "clave_unidad": [{"clave": {"Dx": "DX"}.get(f[0], f[0]), "descripcion": f[1]}
                         for f in filas(cfdi, [hoja(cfdi, "c_ClaveUnidad")], "c_ClaveUnidad") if vigente(f[5])],
        "municipio": [{"clave": f[0], "estado": f[1], "descripcion": f[2]}
                      for f in filas(cp, [hoja(cp, "c_Municipio")], "c_Municipio", 3) if vigente(f[4])],
        "localidad": [{"clave": f[0], "estado": f[1], "descripcion": f[2]}
                      for f in filas(cp, [hoja(cp, "c_Localidad")], "c_Localidad", 2) if vigente(f[4])],
    }
    for nombre, datos in pequenos.items():
        guardar(nombre, datos)

    # Productos Carta Porte: [clave, descripción, palabras similares, material peligroso "0" | "1" | "0,1"]
    guardar("productos_cp", [
        [f[0], f[1], f[2], f[3].replace(" ", "").replace(".0", "")]
        for f in filas(cp, [hoja(cp, "c_ClaveProdServCP")], "c_ClaveProdServ", 8) if vigente(f[5])
    ], comprimir=True)
    guardar("material_peligroso", [
        [f[0], f[1], f[2]] for f in filas(cp, [hoja(cp, "c_MaterialPeligroso")], "Clave material peligroso", 4) if vigente(f[6])
    ], comprimir=True)

    # Código postal → estado, municipio, localidad
    cps = {}
    for f in filas(cfdi, [h for h in cfdi.sheet_names() if h.lower().startswith("c_codigopostal")], "c_CodigoPostal", 5):
        if vigente(f[6]):
            cps[f[0]] = [f[1], f[2].zfill(3) if f[2] else "", f[3].zfill(2) if f[3] else ""]
    guardar("codigos_postales", cps, comprimir=True)

    # Código postal → colonias [clave, nombre]
    colonias = {}
    for f in filas(cp, [h for h in cp.sheet_names() if h.lower().startswith("c_colonia")], "c_Colonia", 4):
        colonias.setdefault(f[1].zfill(5), []).append([f[0], f[2]])
    guardar("colonias", colonias, comprimir=True)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
