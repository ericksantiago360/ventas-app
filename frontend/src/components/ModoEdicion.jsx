// Patrón "modo edición" compartido por todos los formularios de entidades.
//
// VISTA (por defecto): encabezado con colores normales del sistema.
// EDICIÓN: encabezado ámbar con borde inferior de 3px, panel con borde izquierdo
// ámbar, badge "✏️ MODO EDICIÓN" con pulso y un aviso al inicio del formulario.

export const COLORES_EDICION = {
  fondo: '#FEF3C7',
  borde: '#F59E0B',
}

const ANIMACION_ID = 'modo-edicion-pulse'

// Estilo del encabezado de la tarjeta/modal. `base` son los estilos normales
// del encabezado de cada pantalla; en edición se le suman los colores ámbar.
export function estiloCabeceraEdicion(editando, base = {}) {
  if (!editando) return base
  return {
    ...base,
    background: COLORES_EDICION.fondo,
    borderBottom: `3px solid ${COLORES_EDICION.borde}`,
    borderRadius: 8,
    padding: '10px 14px',
  }
}

// Borde izquierdo ámbar para el panel del formulario.
export function estiloPanelEdicion(editando, base = {}) {
  if (!editando) return base
  return { ...base, borderLeft: `3px solid ${COLORES_EDICION.borde}` }
}

// Badge "✏️ MODO EDICIÓN" con animación pulse. Inyecta su keyframes una sola vez.
export function BadgeEdicion() {
  return (
    <>
      <style>{`@keyframes ${ANIMACION_ID}{0%,100%{opacity:1}50%{opacity:.55}}`}</style>
      <span
        style={{
          display: 'inline-block',
          alignSelf: 'flex-start',
          background: COLORES_EDICION.borde,
          color: '#fff',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '.04em',
          borderRadius: 999,
          padding: '3px 10px',
          animation: `${ANIMACION_ID} 1.6s ease-in-out infinite`,
        }}
      >
        ✏️ MODO EDICIÓN
      </span>
    </>
  )
}

// Aviso que aparece en la parte superior del formulario en modo edición.
export function AvisoEdicion({ entidad }) {
  return (
    <div
      role="status"
      style={{
        background: COLORES_EDICION.fondo,
        border: `1px solid ${COLORES_EDICION.borde}`,
        color: '#92400e',
        borderRadius: 6,
        padding: '8px 12px',
        fontSize: 13,
        marginBottom: 14,
      }}
    >
      Estás editando los datos de {entidad || 'este registro'}. Los cambios pueden afectar
      otros registros y documentos relacionados.
    </div>
  )
}
