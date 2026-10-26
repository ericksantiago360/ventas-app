import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { tiendaApi, dinero } from '../api'
import { useCarrito } from '../context/CartContext'

export default function ProductoPage() {
  const { id } = useParams()
  const { slug, config } = useOutletContext()
  const { agregar } = useCarrito()
  const navigate = useNavigate()
  const [producto, setProducto] = useState(null)
  const [variante, setVariante] = useState(null)
  const [cantidad, setCantidad] = useState(1)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    setError('')
    tiendaApi.producto(slug, id)
      .then(p => { setProducto(p); setVariante(p.variantes[0] || null) })
      .catch(e => setError(e.message))
  }, [slug, id])

  if (error) return <div className="error" style={{ marginTop: 16 }}>{error}</div>
  if (!producto) return <p className="muted">Cargando…</p>

  const propiedades = config.modo === 'propiedades'
  const cotizable = producto.cotizable
  const puedeComprar = cotizable || propiedades || producto.disponible
  const precio = variante?.precio ?? producto.precio
  const muestraPrecio = config.mostrar_precio && precio != null

  const pedir = () => {
    agregar(producto, variante, cantidad)
    setAviso('Agregado a tu carrito')
    setTimeout(() => setAviso(''), 1500)
  }

  const etiqueta = propiedades ? 'Me interesa' : cotizable ? 'Solicitar cotización' : 'Agregar al carrito'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 24, marginTop: 16 }}>
      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        {producto.imagen
          ? <img src={producto.imagen} alt={producto.nombre} style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover' }} />
          : <div className="muted" style={{ aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Sin imagen</div>}
      </div>

      <div>
        <h1 style={{ marginTop: 0, fontSize: 24 }}>{producto.nombre}</h1>
        {muestraPrecio && <div className="precio" style={{ fontSize: 22 }}>{dinero(precio)}</div>}
        {!muestraPrecio && <div className="muted">Pide una cotización sin compromiso.</div>}
        {producto.descripcion && <p style={{ marginTop: 14, whiteSpace: 'pre-line' }}>{producto.descripcion}</p>}

        {producto.variantes.length > 0 && (
          <div className="campo" style={{ marginTop: 12 }}>
            <label>Opción</label>
            <select value={variante?.id || ''} onChange={e => setVariante(producto.variantes.find(v => v.id === e.target.value))}>
              {producto.variantes.map(v => (
                <option key={v.id} value={v.id}>{v.nombre}{config.mostrar_precio && v.precio != null ? ` · ${dinero(v.precio)}` : ''}</option>
              ))}
            </select>
          </div>
        )}

        {!producto.disponible && !cotizable && !propiedades && (
          <div className="error" style={{ marginTop: 12 }}>Por el momento no hay existencias.</div>
        )}

        {puedeComprar && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
            {!propiedades && (
              <div className="cantidad">
                <button type="button" onClick={() => setCantidad(c => Math.max(1, c - 1))}>−</button>
                <span style={{ minWidth: 24, textAlign: 'center' }}>{cantidad}</span>
                <button type="button" onClick={() => setCantidad(c => Math.min(999, c + 1))}>+</button>
              </div>
            )}
            <button className="btn" onClick={pedir}>{etiqueta}</button>
            {(propiedades || cotizable) && (
              <button className="btn secundario" onClick={() => { pedir(); navigate(`/${slug}/checkout`) }}>
                Continuar
              </button>
            )}
          </div>
        )}
        {aviso && <div className="exito" style={{ marginTop: 12 }}>{aviso}</div>}
      </div>
    </div>
  )
}
