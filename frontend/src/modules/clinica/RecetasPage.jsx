import { useEffect, useState } from 'react'
import { useNegocio } from '../../context/NegocioContext'
import useEsMovil from '../../hooks/useEsMovil'
import PerfilMedicoModal from './PerfilMedicoModal'
import { req, qs, s } from './comun'
import { RecetaFila } from './recetas'

const POR_PAGINA = 30

// Las recetas se emiten desde el expediente (o desde una nota); aquí se consultan y reimprimen
export default function RecetasPage() {
  const { negocioId } = useNegocio()
  const esMovil = useEsMovil()
  const [busqueda, setBusqueda] = useState('')
  const [q, setQ] = useState('')
  const [pagina, setPagina] = useState(0)
  const [datos, setDatos] = useState({ items: [], total: 0 })
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [perfil, setPerfil] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => { setQ(busqueda.trim()); setPagina(0) }, 300)
    return () => clearTimeout(t)
  }, [busqueda])

  useEffect(() => {
    if (!negocioId) return
    let vigente = true
    setCargando(true); setError('')
    req(`/api/clinica/recetas?${qs({ negocio_id: negocioId, q, skip: pagina * POR_PAGINA, limit: POR_PAGINA })}`)
      .then(d => { if (vigente) setDatos(d) })
      .catch(e => { if (vigente) setError(e.message) })
      .finally(() => { if (vigente) setCargando(false) })
    return () => { vigente = false }
  }, [negocioId, q, pagina])

  const reemplazar = (r) => setDatos(d => ({ ...d, items: d.items.map(x => x.id === r.id ? r : x) }))
  const paginas = Math.max(1, Math.ceil(datos.total / POR_PAGINA))

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={s.h1}>Recetas</h1>
        <button style={s.btn('ghost')} onClick={() => setPerfil(true)}>Mi perfil médico</button>
      </div>
      <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Para emitir una receta, abre el expediente del paciente.</div>

      <div style={{ display: 'flex', gap: 10, margin: '18px 0 14px', alignItems: 'center' }}>
        <input style={{ ...s.input, maxWidth: esMovil ? 'none' : 360 }} placeholder="Buscar por folio, paciente o medicamento…"
          value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        <span style={{ marginLeft: 'auto', fontSize: 13, color: '#64748b', whiteSpace: 'nowrap' }}>{datos.total} recetas</span>
      </div>

      {error && <div style={s.err}>{error}</div>}
      {cargando && !datos.items.length ? (
        <div style={{ color: '#94a3b8', padding: 20 }}>Cargando…</div>
      ) : !datos.items.length ? (
        <div style={{ ...s.card, textAlign: 'center', color: '#94a3b8', fontSize: 14, padding: 40 }}>{q ? 'Sin coincidencias' : 'Aún no hay recetas'}</div>
      ) : (
        <div style={{ ...s.card, padding: 0, overflow: 'hidden', opacity: cargando ? 0.6 : 1 }}>
          {datos.items.map(r => <RecetaFila key={r.id} r={r} conPaciente onCambio={reemplazar} />)}
        </div>
      )}

      {paginas > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 16, fontSize: 13 }}>
          <button style={s.btn('ghost')} disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>← Anterior</button>
          <span style={{ color: '#64748b' }}>Página {pagina + 1} de {paginas}</span>
          <button style={s.btn('ghost')} disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente →</button>
        </div>
      )}

      {perfil && <PerfilMedicoModal cerrar={() => setPerfil(false)} onGuardado={() => setPerfil(false)} />}
    </div>
  )
}
