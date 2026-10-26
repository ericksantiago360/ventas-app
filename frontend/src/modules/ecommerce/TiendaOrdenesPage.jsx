import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNegocio } from '../../context/NegocioContext'
import { req, qs, s, mxn, TIPOS_ORDEN, ChipOrden, minutosDesde } from './comun'

const COLUMNAS = [
  { id: 'pendiente', titulo: '💳 Pendientes', estados: ['pendiente_pago', 'solicitud'] },
  { id: 'revision', titulo: '👁️ Pago en revisión', estados: ['pago_en_revision'] },
  { id: 'confirmada', titulo: '✅ Confirmadas', estados: ['confirmada'] },
  { id: 'cancelada', titulo: '❌ Canceladas', estados: ['cancelada'] },
]

const ACCIONES = {
  pendiente_pago: [
    { etiqueta: 'Recibí el pago', accion: 'pago_recibido', variante: 'ghost' },
    { etiqueta: 'Confirmar', accion: 'confirmar' },
  ],
  solicitud: [{ etiqueta: 'Confirmar', accion: 'confirmar' }],
  pago_en_revision: [{ etiqueta: 'Confirmar pedido', accion: 'confirmar' }],
}

export default function TiendaOrdenesPage() {
  const { negocioId } = useNegocio()
  const navigate = useNavigate()
  const [ordenes, setOrdenes] = useState([])
  const [buscar, setBuscar] = useState('')
  const [tipo, setTipo] = useState('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [ocupada, setOcupada] = useState(null)

  const cargar = useCallback(() => {
    if (!negocioId) return Promise.resolve()
    setCargando(true); setError('')
    return req(`/api/admin/tienda/ordenes?${qs({ negocio_id: negocioId, buscar, tipo, limite: 200 })}`)
      .then(d => setOrdenes(d.data))
      .catch(e => setError(e.message))
      .finally(() => setCargando(false))
  }, [negocioId, buscar, tipo])

  useEffect(() => {
    const t = setTimeout(cargar, 250)
    return () => clearTimeout(t)
  }, [cargar])

  const ejecutar = async (orden, accion) => {
    if (accion === 'cancelar' && !window.confirm(`¿Cancelar la orden ${orden.folio}?`)) return
    setOcupada(orden._id); setError('')
    try {
      await req(`/api/admin/tienda/ordenes/${orden._id}/${accion}`, { method: 'PUT' })
      await cargar()
    } catch (e) {
      setError(e.message)
    } finally {
      setOcupada(null)
    }
  }

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={s.h1}>Órdenes de la tienda</h1>
        <button style={s.btn('ghost')} onClick={() => navigate('/tienda')}>Configurar tienda</button>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <input style={{ ...s.input, maxWidth: 320 }} placeholder="Buscar por folio, cliente, correo o referencia"
          value={buscar} onChange={e => setBuscar(e.target.value)} />
        <select style={{ ...s.input, maxWidth: 200 }} value={tipo} onChange={e => setTipo(e.target.value)}>
          <option value="">Todos los tipos</option>
          {Object.entries(TIPOS_ORDEN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {error && <div style={{ ...s.err, marginTop: 14 }}>{error}</div>}

      <div style={{ ...s.grid(240), marginTop: 16, alignItems: 'start' }}>
        {COLUMNAS.map(col => {
          const lista = ordenes.filter(o => col.estados.includes(o.estado))
          return (
            <div key={col.id} style={{ background: '#f8fafc', borderRadius: 10, padding: 12, minHeight: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
                {col.titulo} <span style={{ color: '#94a3b8', fontWeight: 400 }}>({lista.length})</span>
              </div>
              {cargando && lista.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>Cargando…</div>}
              {lista.map(o => (
                <div key={o._id} style={{ ...s.card, padding: 12, marginBottom: 10, opacity: ocupada === o._id ? 0.5 : 1 }}>
                  <div onClick={() => navigate(`/tienda/ordenes/${o._id}`)} style={{ cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <strong style={{ fontSize: 13 }}>{o.folio}</strong>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{minutosDesde(o.created_at)}</span>
                    </div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>{o.cliente.nombre}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{o.cliente.email}</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                      <ChipOrden estado={o.estado} />
                      <span style={{ fontSize: 11, color: '#64748b' }}>{TIPOS_ORDEN[o.tipo]}</span>
                    </div>
                    {o.tipo !== 'cotizacion' && o.tipo !== 'contacto' && (
                      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>{mxn(o.total)}</div>
                    )}
                    {o.referencia_pago && (
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Ref: {o.referencia_pago}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    {(ACCIONES[o.estado] || []).map(a => (
                      <button key={a.accion} style={{ ...s.btn(a.variante), padding: '5px 10px', fontSize: 12 }}
                        disabled={ocupada === o._id} onClick={() => ejecutar(o, a.accion)}>
                        {a.etiqueta}
                      </button>
                    ))}
                    {o.estado !== 'cancelada' && (
                      <button style={{ ...s.btn('danger'), padding: '5px 10px', fontSize: 12 }}
                        disabled={ocupada === o._id} onClick={() => ejecutar(o, 'cancelar')}>
                        Cancelar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
