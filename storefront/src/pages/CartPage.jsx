import { Link, useOutletContext, useNavigate } from 'react-router-dom'
import { dinero } from '../api'
import { useCarrito } from '../context/CartContext'

export default function CartPage() {
  const { slug, config } = useOutletContext()
  const { items, cambiarCantidad, total, piezas } = useCarrito()
  const navigate = useNavigate()
  const cotizacion = !config.mostrar_precio

  if (items.length === 0) {
    return (
      <div className="panel" style={{ marginTop: 16 }}>
        <p style={{ marginTop: 0 }}>Tu carrito está vacío.</p>
        <Link className="btn" to={`/${slug}/catalogo`}>Ir al catálogo</Link>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 16 }}>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>{cotizacion ? 'Tu solicitud' : 'Carrito'}</h1>
      <div className="panel">
        {items.map(i => (
          <div key={i.id} className="fila">
            <div className="info">
              <div style={{ fontWeight: 600 }}>{i.nombre}</div>
              {!cotizacion && i.precio != null && <div className="muted">{dinero(i.precio)} c/u</div>}
            </div>
            <div className="cantidad">
              <button type="button" onClick={() => cambiarCantidad(i.id, i.cantidad - 1)}>−</button>
              <span style={{ minWidth: 24, textAlign: 'center' }}>{i.cantidad}</span>
              <button type="button" onClick={() => cambiarCantidad(i.id, i.cantidad + 1)}>+</button>
            </div>
            {!cotizacion && i.precio != null && (
              <div style={{ width: 90, textAlign: 'right', fontWeight: 600 }}>{dinero(i.precio * i.cantidad)}</div>
            )}
            <button type="button" className="copiar" onClick={() => cambiarCantidad(i.id, 0)}>Quitar</button>
          </div>
        ))}

        {!cotizacion && (
          <div style={{ marginTop: 12 }}>
            <div className="resumen"><span>{piezas} pieza(s)</span></div>
            <div className="resumen total"><span>Subtotal</span><span>{dinero(total)}</span></div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              El total final con impuestos se muestra en el siguiente paso.
            </p>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <Link className="btn secundario" to={`/${slug}/catalogo`}>Seguir viendo</Link>
        <button className="btn" onClick={() => navigate(`/${slug}/checkout`)}>
          {cotizacion ? 'Enviar solicitud' : 'Continuar'}
        </button>
      </div>
    </div>
  )
}
