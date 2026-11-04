# XSLT del SAT (cadena original)

Árbol vendorizado de `cadenaoriginal_4_0.xslt` y sus includes (Carta Porte 2.0/3.0/3.1,
Comercio Exterior, complementos), descargado de http://www.sat.gob.mx/sitio_internet/cfd/.

- Son XSLT 2.0: se procesan con SaxonCHE (`saxonche` en requirements.txt). lxml solo hace 1.0.
- Los `xsl:include` apuntan a rutas relativas locales (el SAT usa URLs absolutas).
- Se vendorizaron para que el build no dependa de que el SAT responda (devuelve 403 a
  peticiones sin User-Agent de navegador).

Para actualizarlos, volver a descargar el árbol, reescribir los includes a rutas relativas
y verificar que `csd_signer.cadena_original` sigue produciendo la cadena esperada.
