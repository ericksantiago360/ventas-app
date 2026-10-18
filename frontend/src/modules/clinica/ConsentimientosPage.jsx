import { useEffect, useState } from 'react'
import { useNegocio } from '../../context/NegocioContext'
import useEsMovil from '../../hooks/useEsMovil'
import ModalFormulario from '../../components/ModalFormulario'
import { req, qs, s, Campo, Chip } from './comun'
import { ConsentimientoFila } from './consentimientos'
import { usePuede } from './permisos'

const POR_PAGINA = 30
const MARCADORES = ['paciente', 'edad', 'firmante', 'medico', 'cedula', 'clinica', 'fecha', 'procedimiento', 'riesgos', 'beneficios', 'alternativas']

function PlantillaModal({ negocioId, plantilla, cerrar, onGuardado }) {
  // Una incluida se "edita" creando una propia del mismo tipo, que la reemplaza en el negocio
  const nueva = !plantilla?.propia
  const [tipo, setTipo] = useState(plantilla?.tipo || '')
  const [titulo, setTitulo] = useState(plantilla?.titulo || '')
  const [texto, setTexto] = useState(plantilla?.texto || '')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function guardar(ev) {
    ev.preventDefault()
    setGuardando(true); setError('')
    try {
      onGuardado(nueva
        ? await req('/api/clinica/consentimientos/plantillas', { method: 'POST', body: JSON.stringify({ negocio_id: negocioId, tipo, titulo, texto }) })
        : await req(`/api/clinica/consentimientos/plantillas/${plantilla.id}`, { method: 'PUT', body: JSON.stringify({ titulo, texto }) }))
    } catch (e) { setError(e.message) }
    finally { setGuardando(false) }
  }

  return (
    <ModalFormulario titulo={plantilla ? 'Editar plantilla' : 'Nueva plantilla'}
      subtitulo={plantilla && !plantilla.propia ? 'Se guardará como plantilla propia y reemplazará a la incluida' : 'Los consentimientos ya firmados no cambian'}
      ancho={820} error={error} cerrar={cerrar} onSubmit={guardar} guardando={guardando} textoGuardar="Guardar">
      <div style={s.grid(220)}>
        <Campo label="Tipo (clave) *">
          <input style={s.input} value={tipo} disabled={Boolean(plantilla)} placeholder="endoscopia" onChange={e => setTipo(e.target.value)} required />
        </Campo>
        <Campo label="Título *">
          <input style={s.input} value={titulo} onChange={e => setTitulo(e.target.value)} required />
        </Campo>
      </div>
      <Campo label="Texto *" style={{ marginTop: 12 }}>
        <textarea style={{ ...s.input, minHeight: 320, resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
          value={texto} onChange={e => setTexto(e.target.value)} required />
      </Campo>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
        Marcadores que se llenan al firmar: {MARCADORES.map(m => <code key={m} style={{ background: '#f1f5f9', borderRadius: 4, padding: '0 4px', marginRight: 4 }}>{`{${m}}`}</code>)}
      </div>
    </ModalFormulario>
  )
}

function Plantillas({ negocioId }) {
  const [plantillas, setPlantillas] = useState(null)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null)       // {} nueva | { plantilla }

  const cargar = () => req(`/api/clinica/consentimientos/plantillas?${qs({ negocio_id: negocioId })}`).then(setPlantillas).catch(e => setError(e.message))
  useEffect(() => { if (negocioId) cargar() }, [negocioId])

  async function quitar(p) {
    if (!window.confirm(`¿Quitar la plantilla "${p.titulo}"? Si reemplazaba a una incluida, se vuelve a usar la incluida.`)) return
    try { await req(`/api/clinica/consentimientos/plantillas/${p.id}`, { method: 'DELETE' }); cargar() }
    catch (e) { setError(e.message) }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button style={s.btn()} onClick={() => setModal({})}>+ Nueva plantilla</button>
      </div>
      {error && <div style={s.err}>{error}</div>}
      {!plantillas ? <div style={{ color: '#94a3b8' }}>Cargando…</div> : (
        <div style={{ ...s.card, padding: 0, overflow: 'hidden' }}>
          {plantillas.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 16px', borderTop: i ? '1px solid #f1f5f9' : 'none', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600 }}>{p.titulo}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>{p.tipo}</div>
              </div>
              {p.propia ? <Chip texto="Propia" bg="#dbeafe" color="#1d4ed8" /> : <Chip texto="Incluida" />}
              <button style={s.btn('ghost')} onClick={() => setModal({ plantilla: p })}>{p.propia ? 'Editar' : 'Personalizar'}</button>
              {p.propia && <button style={{ ...s.btn('ghost'), color: '#b91c1c' }} onClick={() => quitar(p)}>Quitar</button>}
            </div>
          ))}
        </div>
      )}
      {modal && <PlantillaModal negocioId={negocioId} plantilla={modal.plantilla} cerrar={() => setModal(null)} onGuardado={() => { setModal(null); cargar() }} />}
    </div>
  )
}

// Los consentimientos se firman desde el expediente del paciente; aquí se consultan y se administran las plantillas
export default function ConsentimientosPage() {
  const puede = usePuede()
  const { negocioId } = useNegocio()
  const esMovil = useEsMovil()
  const [tab, setTab] = useState('firmados')
  const [busqueda, setBusqueda] = useState('')
  const [q, setQ] = useState('')
  const [pagina, setPagina] = useState(0)
  const [datos, setDatos] = useState({ items: [], total: 0 })
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const t = setTimeout(() => { setQ(busqueda.trim()); setPagina(0) }, 300)
    return () => clearTimeout(t)
  }, [busqueda])

  useEffect(() => {
    if (!negocioId || tab !== 'firmados') return
    let vigente = true
    setCargando(true); setError('')
    req(`/api/clinica/consentimientos?${qs({ negocio_id: negocioId, q, skip: pagina * POR_PAGINA, limit: POR_PAGINA })}`)
      .then(d => { if (vigente) setDatos(d) })
      .catch(e => { if (vigente) setError(e.message) })
      .finally(() => { if (vigente) setCargando(false) })
    return () => { vigente = false }
  }, [negocioId, q, pagina, tab])

  const reemplazar = (c) => setDatos(d => ({ ...d, items: d.items.map(x => x.id === c.id ? c : x) }))
  const paginas = Math.max(1, Math.ceil(datos.total / POR_PAGINA))

  return (
    <div style={s.page}>
      <h1 style={s.h1}>Consentimientos informados</h1>
      <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Para recabar uno nuevo, abre el expediente del paciente.</div>

      <div style={s.tabs}>
        {[['firmados', 'Firmados'], ...(puede('consentimientos:config') ? [['plantillas', 'Plantillas']] : [])].map(([k, l]) => (
          <button key={k} style={s.tab(tab === k)} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'plantillas' ? <Plantillas negocioId={negocioId} /> : (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
            <input style={{ ...s.input, maxWidth: esMovil ? 'none' : 360 }} placeholder="Buscar por folio, paciente o procedimiento…"
              value={busqueda} onChange={e => setBusqueda(e.target.value)} />
            <span style={{ marginLeft: 'auto', fontSize: 13, color: '#64748b', whiteSpace: 'nowrap' }}>{datos.total} documentos</span>
          </div>
          {error && <div style={s.err}>{error}</div>}
          {cargando && !datos.items.length ? <div style={{ color: '#94a3b8', padding: 20 }}>Cargando…</div>
            : !datos.items.length ? (
              <div style={{ ...s.card, textAlign: 'center', color: '#94a3b8', fontSize: 14, padding: 40 }}>{q ? 'Sin coincidencias' : 'Aún no hay consentimientos firmados'}</div>
            ) : (
              <div style={{ ...s.card, padding: 0, overflow: 'hidden', opacity: cargando ? 0.6 : 1 }}>
                {datos.items.map(c => <ConsentimientoFila key={c.id} c={c} conPaciente onCambio={reemplazar} />)}
              </div>
            )}
          {paginas > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 16, fontSize: 13 }}>
              <button style={s.btn('ghost')} disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>← Anterior</button>
              <span style={{ color: '#64748b' }}>Página {pagina + 1} de {paginas}</span>
              <button style={s.btn('ghost')} disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente →</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
