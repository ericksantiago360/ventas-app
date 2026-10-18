import useEsMovil from '../hooks/useEsMovil'

const btn = (primario) => ({
  padding: '7px 16px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
  background: primario ? '#3b82f6' : '#f1f5f9', color: primario ? '#fff' : '#334155',
})

// Modal con formulario. En escritorio es la ventana centrada de siempre; en celular
// ocupa toda la pantalla con el título arriba y los botones fijos abajo, para que
// "Guardar" esté a la mano sin bajar hasta el final del formulario.
export default function ModalFormulario({
  titulo, subtitulo, ancho = 680, error, cerrar, onSubmit,
  textoGuardar, textoGuardando = 'Guardando…', guardando, resumen, children,
}) {
  const esMovil = useEsMovil()

  const botones = (
    <>
      <button type="button" onClick={cerrar}
        style={esMovil ? { ...btn(false), flex: 1, padding: 12, fontSize: 15 } : btn(false)}>
        Cancelar
      </button>
      <button type="submit" disabled={guardando}
        style={esMovil ? { ...btn(true), flex: 2, padding: 12, fontSize: 15 } : btn(true)}>
        {guardando ? textoGuardando : textoGuardar}
      </button>
    </>
  )

  const encabezado = (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
      ...(esMovil
        ? { background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '12px 16px', paddingTop: 'calc(12px + env(safe-area-inset-top))' }
        : { marginBottom: 20 }),
    }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{titulo}</h2>
        {subtitulo && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{subtitulo}</div>}
      </div>
      <button type="button" onClick={cerrar} aria-label="Cerrar"
        style={{ ...btn(false), fontSize: esMovil ? 20 : 18, lineHeight: 1, padding: esMovil ? '6px 12px' : '2px 10px' }}>
        ×
      </button>
    </div>
  )

  const avisoError = error && (
    <div style={{ background: '#fef2f2', color: '#b91c1c', borderRadius: 6, padding: '8px 12px', fontSize: 13, marginBottom: 12 }}>
      {error}
    </div>
  )

  if (esMovil) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: '#f8fafc' }}>
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {encabezado}
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            {avisoError}
            {children}
          </div>
          <div style={{ background: '#fff', borderTop: '1px solid #e2e8f0', padding: '10px 16px', paddingBottom: 'calc(10px + env(safe-area-inset-bottom))' }}>
            {resumen && <div style={{ marginBottom: 10 }}>{resumen}</div>}
            <div style={{ display: 'flex', gap: 10 }}>{botones}</div>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div onClick={e => e.target === e.currentTarget && cerrar()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: ancho, maxHeight: '90vh', overflowY: 'auto', maxWidth: '96vw' }}>
        {encabezado}
        {avisoError}
        <form onSubmit={onSubmit}>
          {children}
          {resumen && <div style={{ marginTop: 10 }}>{resumen}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>{botones}</div>
        </form>
      </div>
    </div>
  )
}
