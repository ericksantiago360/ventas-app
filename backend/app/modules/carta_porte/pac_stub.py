"""
Timbrado ante el SAT: pendiente.

Para timbrar se necesita el CSD del negocio (.cer, .key y contraseña) para sellar el XML
(Sello, NoCertificado, Certificado) y un contrato con un PAC autorizado que devuelva el
TimbreFiscalDigital. Al integrarlo, guardar el resultado en `cartas_porte.timbrado`
{uuid, fecha_timbrado, pac, cadena_original, sello_sat, xml_timbrado}.
"""


async def timbrar_carta_porte(xml_sin_timbre: str, cer_path: str, key_path: str, password: str) -> dict:
    raise NotImplementedError(
        "Timbrado con PAC no implementado. "
        "Integrar un PAC autorizado (por ejemplo SW Sapien o Finkok) cuando se tenga CSD y contrato."
    )
