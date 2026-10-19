import { useEffect, useState } from 'react'
import { useNegocio } from '../../../context/NegocioContext'
import useEsMovil from '../../../hooks/useEsMovil'
import OperadorModal from './OperadorModal'
import { req, qs, s, ChipVence, useCatalogos, descripcion, avisarCambioFlota } from '../comun'

export default function OperadoresPage() {
  const { negocioId } = useNegocio()
  const esMovil = useEsMovil()
  const cat = useCatalogos()
  const [operadores, setOperadores] = useState(null)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null)

  const cargar = () => req(`/api/carta-porte/operadores?${qs({ negocio_id: negocioId })}`).then(setOperadores).catch(e => setError(e.message))
  useEffect(() => { if (negocioId) cargar() }, [negocioId])

  async function baja(o) {
    if (!window.confirm(`¿Dar de baja a ${o.nombre}?`)) return
    try { await req(`/api/carta-porte/operadores/${o.id}`, { method: 'DELETE' }); avisarCambioFlota(); cargar() }
    catch (e) { setError(e.message) }
  }

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 style={s.h1}>Operadores</h1>
        <button style={{ ...s.btn(), whiteSpace: 'nowrap' }} onClick={() => setModal({})}>+ Nuevo operador</button>
      </div>
      <div style={{ fontSize: 13, color: '#64748b', margin: '4px 0 18px' }}>Choferes que pueden figurar en las cartas porte. Se avisa cuando una licencia vence en 30 días o menos.</div>
      {error && <div style={s.err}>{error}</div>}
      {!operadores ? <div style={{ color: '#94a3b8' }}>Cargando…</div> : !operadores.length ? (
        <div style={{ ...s.card, textAlign: 'center', color: '#94a3b8', fontSize: 14, padding: 40 }}>Aún no hay operadores</div>
      ) : esMovil ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {operadores.map(o => (
            <div key={o.id} style={{ ...s.card, padding: '12px 14px' }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{o.nombre}</div>
              <div style={{ fontSize: 12, color: '#64748b', fontFamily: 'monospace' }}>{o.rfc} · Lic. {o.num_licencia}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Vence {o.fecha_vencimiento_licencia} <ChipVence fecha={o.fecha_vencimiento_licencia} que="Licencia" /></div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button style={s.btn('ghost')} onClick={() => setModal({ operador: o })}>Editar</button>
                <button style={{ ...s.btn('ghost'), color: '#b91c1c' }} onClick={() => baja(o)}>Dar de baja</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ ...s.card, padding: 0, overflow: 'hidden' }}>
          <table style={s.table}>
            <thead><tr>{['Nombre', 'RFC', 'Licencia', 'Tipo', 'Vence', 'Teléfono', ''].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>
              {operadores.map(o => (
                <tr key={o.id}>
                  <td style={{ ...s.td, fontWeight: 600 }}>{o.nombre}</td>
                  <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 12 }}>{o.rfc}</td>
                  <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 12 }}>{o.num_licencia}</td>
                  <td style={{ ...s.td, fontSize: 12, color: '#64748b' }} title={descripcion(cat?.tipo_licencia, o.tipo_licencia)}>{o.tipo_licencia}</td>
                  <td style={s.td}>
                    <div>{o.fecha_vencimiento_licencia}</div>
                    <ChipVence fecha={o.fecha_vencimiento_licencia} que="Licencia" />
                  </td>
                  <td style={s.td}>{o.telefono || '—'}</td>
                  <td style={s.td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button style={s.btn('ghost')} onClick={() => setModal({ operador: o })}>Editar</button>
                      <button style={{ ...s.btn('ghost'), color: '#b91c1c' }} onClick={() => baja(o)}>Baja</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal && <OperadorModal negocioId={negocioId} operador={modal.operador} cerrar={() => setModal(null)} onGuardado={() => { setModal(null); cargar() }} />}
    </div>
  )
}
