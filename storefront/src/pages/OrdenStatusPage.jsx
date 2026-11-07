import { useEffect, useState } from 'react'
import useNoindex from '../hooks/useNoindex'
import { useOutletContext, useParams } from 'react-router-dom'
import { tiendaApi, dinero } from '../api'

const ESTADOS = {
  pendiente_pago: 'Esperando tu pago',
  pago_en_revision: 'Estamos revisando tu pago',
  solicitud: 'Recibimos tu solicitud',
  confirmada: 'Confirmada',
  enviada: 'Enviada',
  entregada: 'Entregada',
  cancelada: 'Cancelada',
}

const TIPOS = { producto: 'Producto', servicio: 'Servicio', cotizacion: 'Cotización', contacto: 'Contacto' }

export default function OrdenStatusPage() {
  useNoindex()
  const { slug, config } = useOutletContext()
  const { folio: folioUrl } = useParams()
  const [folio, setFolio] = useState(folioUrl || '')
  const [email, setEmail] = useState('')
  const [orden, setOrden] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  useEffect(() => { if (folioUrl) setFolio(folioUrl) }, [folioUrl])

  const consultar = async (e) => {
    e?.preventDefault()
    setError(''); setOrden(null); setCargando(true)
    try {
      setOrden(await tiendaApi.estadoOrden(slug, folio.trim(), email.trim()))
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }

  return (
    <div style={{ maxWidth: 620, margin: '16px auto' }}>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Estado de tu orden</h1>
      <form className="panel" onSubmit={consultar}>
        <div className="dos">
          <div className="campo"><label>Folio (ej. ECO-0001)</label>
            <input required value={folio} onChange={e => setFolio(e.target.value)} /></div>
          <div className="campo"><label>Correo con el que compraste</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></div>
        </div>
        <button className="btn" type="submit" disabled={cargando}>{cargando ? 'Consultando…' : 'Consultar'}</button>
      </form>

      {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}

      {orden && (
        <div className="panel" style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <strong>{orden.folio}</strong>
            <span>{ESTADOS[orden.estado] || orden.estado}</span>
          </div>
          <div className="muted" style={{ fontSize: 13 }}>{TIPOS[orden.tipo]}</div>

          <div style={{ marginTop: 12 }}>
            {orden.partidas.map((p, i) => (
              <div key={i} className="resumen"><span>{p.cantidad} × {p.nombre}</span>
                {p.subtotal > 0 && <span>{dinero(p.subtotal)}</span>}</div>
            ))}
          </div>

          {orden.total > 0 && (
            <>
              {orden.subtotal > 0 && <div className="resumen"><span className="muted">Subtotal sin impuestos</span><span>{dinero(orden.subtotal)}</span></div>}
              {orden.ieps > 0 && <div className="resumen"><span className="muted">IEPS</span><span>{dinero(orden.ieps)}</span></div>}
              {orden.iva > 0 && <div className="resumen"><span className="muted">IVA</span><span>{dinero(orden.iva)}</span></div>}
              {orden.costo_envio > 0 && <div className="resumen"><span className="muted">Envío</span><span>{dinero(orden.costo_envio)}</span></div>}
              <div className="resumen total"><span>Total</span><span>{dinero(orden.total)}</span></div>
            </>
          )}

          {orden.estado === 'pendiente_pago' && orden.referencia_pago && (
            <p style={{ fontSize: 14 }}>
              Recuerda incluir la referencia <strong>{orden.referencia_pago}</strong> en tu pago.
              {orden.clabe_terminacion && <> La CLABE termina en {orden.clabe_terminacion}.</>}
            </p>
          )}
          {orden.estado === 'pago_en_revision' && <p style={{ fontSize: 14 }}>En cuanto validemos tu pago te confirmamos por correo.</p>}
          {orden.estado === 'confirmada' && orden.tipo !== 'cotizacion' && orden.tipo !== 'contacto' && (
            <p style={{ fontSize: 14 }}>Tu pedido está en preparación.</p>
          )}
          {config.correo_contacto && <p className="muted" style={{ fontSize: 13 }}>¿Dudas? Escribe a {config.correo_contacto}.</p>}
        </div>
      )}
    </div>
  )
}
