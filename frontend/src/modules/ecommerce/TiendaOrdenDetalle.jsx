import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { req, s, mxn, TIPOS_ORDEN, ChipOrden, fechaLocal } from './comun'

const ACCIONES = {
  pendiente_pago: [
    { etiqueta: 'Recibí el pago', accion: 'pago_recibido', variante: 'ghost' },
    { etiqueta: 'Confirmar orden', accion: 'confirmar' },
  ],
  solicitud: [{ etiqueta: 'Marcar como atendida', accion: 'confirmar' }],
  pago_en_revision: [{ etiqueta: 'Confirmar pedido', accion: 'confirmar' }],
}

// Lo siguiente depende del tipo de entrega: envío pasa por "enviada"; recoger va directo a "entregada"
function accionesDe(o) {
  if (o.estado === 'confirmada') {
    return o.entrega === 'envio'
      ? [{ etiqueta: 'Marcar enviada', accion: 'enviar' }]
      : [{ etiqueta: 'Marcar entregada', accion: 'entregar' }]
  }
  if (o.estado === 'enviada') return [{ etiqueta: 'Marcar entregada', accion: 'entregar' }]
  return ACCIONES[o.estado] || []
}

const ETIQUETA_METODO = { transferencia: 'Transferencia SPEI', oxxo_cie: 'Pago en OXXO (CIE)' }

export default function TiendaOrdenDetalle() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [orden, setOrden] = useState(null)
  const [error, setError] = useState('')
  const [ocupada, setOcupada] = useState(false)

  const cargar = useCallback(() => {
    return req(`/api/admin/tienda/ordenes/${id}`)
      .then(setOrden)
      .catch(e => setError(e.message))
  }, [id])

  useEffect(() => { cargar() }, [cargar])

  const ejecutar = async (accion) => {
    if (accion === 'cancelar' && !window.confirm(`¿Cancelar la orden ${orden.folio}?`)) return
    setOcupada(true); setError('')
    try {
      await req(`/api/admin/tienda/ordenes/${id}/${accion}`, { method: 'PUT' })
      await cargar()
    } catch (e) {
      setError(e.message)
    } finally {
      setOcupada(false)
    }
  }

  if (!orden) return <div style={s.page}>{error ? <div style={s.err}>{error}</div> : 'Cargando…'}</div>

  const conPrecio = orden.tipo === 'producto' || orden.tipo === 'servicio'
  const cancelable = !['cancelada', 'entregada'].includes(orden.estado)

  return (
    <div style={s.page}>
      <button style={{ ...s.btn('ghost'), marginBottom: 12 }} onClick={() => navigate('/ecommerce/ordenes')}>← Órdenes</button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={s.h1}>Orden {orden.folio}</h1>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
            {TIPOS_ORDEN[orden.tipo]} · creada {fechaLocal(orden.created_at)}
          </div>
        </div>
        <ChipOrden estado={orden.estado} />
      </div>

      {error && <div style={{ ...s.err, marginTop: 14 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16, marginTop: 16 }}>
        <div style={s.card}>
          <div style={s.sect}>Cliente</div>
          <div style={{ fontSize: 14 }}>{orden.cliente.nombre}</div>
          <div style={{ fontSize: 13, color: '#64748b' }}>{orden.cliente.email}</div>
          <div style={{ fontSize: 13, color: '#64748b' }}>{orden.cliente.telefono}</div>
          {orden.cliente.direccion_envio?.calle && (
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>
              {[orden.cliente.direccion_envio.calle, orden.cliente.direccion_envio.numero, orden.cliente.direccion_envio.colonia,
                orden.cliente.direccion_envio.ciudad, orden.cliente.direccion_envio.estado, orden.cliente.direccion_envio.cp]
                .filter(Boolean).join(', ')}
            </div>
          )}
          {orden.cita_solicitada && (
            <div style={{ fontSize: 13, marginTop: 10, color: '#b45309' }}>
              Cita preferida: {fechaLocal(orden.cita_solicitada)} (agéndala en la Agenda)
            </div>
          )}
          {orden.notas_cliente && <div style={{ fontSize: 13, marginTop: 10, fontStyle: 'italic' }}>“{orden.notas_cliente}”</div>}
        </div>

        <div style={s.card}>
          <div style={s.sect}>Pago</div>
          {orden.referencia_pago ? (
            <>
              <div style={{ fontSize: 13 }}>Método: {ETIQUETA_METODO[orden.metodo_pago_seleccionado] || '—'}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Referencia esperada: <strong>{orden.referencia_pago}</strong></div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Monto: <strong>{mxn(orden.total)}</strong></div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
                Busca esa referencia en el estado de cuenta antes de confirmar.
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: '#64748b' }}>Solicitud sin pago en línea.</div>
          )}
          {orden.pedido_id && (
            <button style={{ ...s.btn('ghost'), marginTop: 12 }} onClick={() => navigate('/pedidos')}>
              Ver en Pedidos
            </button>
          )}
        </div>
      </div>

      <div style={{ ...s.card, marginTop: 16, padding: 0, overflowX: 'auto' }}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Producto</th>
              <th style={{ ...s.th, textAlign: 'right' }}>Cantidad</th>
              {conPrecio && <th style={{ ...s.th, textAlign: 'right' }}>Importe</th>}
            </tr>
          </thead>
          <tbody>
            {orden.partidas.map((p, i) => (
              <tr key={i}>
                <td style={s.td}>{p.nombre}</td>
                <td style={{ ...s.td, textAlign: 'right' }}>{p.cantidad}</td>
                {conPrecio && <td style={{ ...s.td, textAlign: 'right' }}>{mxn(p.subtotal)}</td>}
              </tr>
            ))}
          </tbody>
          {conPrecio && (
            <tfoot>
              <tr><td style={s.td} colSpan={2}>Subtotal</td><td style={{ ...s.td, textAlign: 'right' }}>{mxn(orden.subtotal)}</td></tr>
              <tr><td style={s.td} colSpan={2}>IVA</td><td style={{ ...s.td, textAlign: 'right' }}>{mxn(orden.iva)}</td></tr>
              <tr><td style={{ ...s.td, fontWeight: 700 }} colSpan={2}>Total</td><td style={{ ...s.td, textAlign: 'right', fontWeight: 700 }}>{mxn(orden.total)}</td></tr>
            </tfoot>
          )}
        </table>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        {accionesDe(orden).map(a => (
          <button key={a.accion} style={s.btn(a.variante)} disabled={ocupada} onClick={() => ejecutar(a.accion)}>
            {a.etiqueta}
          </button>
        ))}
        {cancelable && (
          <button style={s.btn('danger')} disabled={ocupada} onClick={() => ejecutar('cancelar')}>Cancelar orden</button>
        )}
      </div>
    </div>
  )
}
