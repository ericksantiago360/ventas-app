import { Link, useLocation, useOutletContext, useParams } from 'react-router-dom'
import PagoInstrucciones from '../components/PagoInstrucciones'

export default function ConfirmacionPage() {
  const { slug } = useOutletContext()
  const { folio } = useParams()
  const { state } = useLocation()
  const orden = state?.orden && state.orden.folio === folio ? state.orden : null

  if (!orden) {
    return (
      <div className="panel" style={{ marginTop: 16 }}>
        <h1 style={{ fontSize: 20, marginTop: 0 }}>Orden {folio}</h1>
        <p className="muted">Consulta el estado de tu orden con tu correo.</p>
        <Link className="btn" to={`/${slug}/orden/${folio}`}>Ver mi orden</Link>
      </div>
    )
  }

  const conPago = Boolean(orden.instrucciones_pago)
  return (
    <div style={{ maxWidth: 560, margin: '16px auto' }}>
      <div className="exito">¡Gracias! Tu orden <strong>{orden.folio}</strong> está registrada.</div>

      {conPago ? (
        <>
          <p>Para confirmar tu pedido, realiza el pago con estos datos. Incluye la referencia para que lo identifiquemos.</p>
          <PagoInstrucciones instrucciones={orden.instrucciones_pago} />
        </>
      ) : (
        <div className="panel">
          <p style={{ marginTop: 0 }}>
            {orden.tipo === 'contacto'
              ? 'Recibimos tu interés. Un asesor se comunicará contigo.'
              : 'Recibimos tu solicitud de cotización. Te responderemos con el detalle y el precio.'}
          </p>
        </div>
      )}

      <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
        Te enviamos estos datos a tu correo. Puedes consultar el estado de tu orden en cualquier momento.
      </p>
      <Link className="btn secundario" to={`/${slug}/orden/${orden.folio}`}>Consultar estado</Link>
    </div>
  )
}
