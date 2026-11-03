import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { tiendaApi, dinero } from '../api'
import { useCarrito } from '../context/CartContext'

// Visor de un video: el iframe no se carga hasta que el cliente hace clic en el thumbnail
function VideoYoutube({ youtubeId, thumbnail, nombre }) {
  const [reproducir, setReproducir] = useState(false)

  if (reproducir) {
    return (
      <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0 }}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&modestbranding=1&autoplay=1`}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title={`Video de ${nombre}`}
        />
      </div>
    )
  }

  return (
    <button type="button" onClick={() => setReproducir(true)} aria-label="Reproducir video"
      style={{ position: 'relative', display: 'block', width: '100%', padding: 0, border: 'none', background: '#000', cursor: 'pointer', aspectRatio: '16 / 9' }}>
      <img src={thumbnail} alt={nombre} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.9 }} />
      <span style={{
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 64, height: 46, borderRadius: 12, background: 'rgba(255,0,0,.9)', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
      }}>▶</span>
    </button>
  )
}

// Carrusel de imágenes y videos mezclados
function GaleriaTienda({ medios, nombre }) {
  const [activo, setActivo] = useState(0)
  const medio = medios[activo]

  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      {!medio && (
        <div className="muted" style={{ aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Sin imagen</div>
      )}

      {medio?.tipo === 'youtube' && (
        <VideoYoutube key={medio.id} youtubeId={medio.youtube_id} thumbnail={medio.thumbnail} nombre={nombre} />
      )}
      {medio?.tipo === 'imagen' && (
        <img src={medio.url} alt={nombre} style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover' }} />
      )}

      {medios.length > 1 && (
        <div style={{ display: 'flex', gap: 6, padding: 8, overflowX: 'auto' }}>
          {medios.map((m, i) => (
            <button key={m.id} type="button" onClick={() => setActivo(i)} aria-label={m.tipo === 'youtube' ? 'Video' : 'Imagen'}
              style={{
                position: 'relative', width: 56, height: 56, padding: 0, flexShrink: 0, borderRadius: 6, overflow: 'hidden', cursor: 'pointer',
                border: i === activo ? '2px solid var(--brand)' : '2px solid var(--line)', background: 'none',
              }}>
              <img src={m.tipo === 'youtube' ? m.thumbnail : m.url} alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              {m.tipo === 'youtube' && (
                <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.3)', color: '#fff', fontSize: 16 }}>▶</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

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
      <GaleriaTienda medios={producto.medios ?? (producto.imagen ? [{ id: 'img-0', tipo: 'imagen', url: producto.imagen }] : [])} nombre={producto.nombre} />

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
