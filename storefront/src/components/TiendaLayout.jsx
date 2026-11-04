import { useEffect } from 'react'
import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { CartProvider, useCarrito } from '../context/CartContext'
import useTienda from '../hooks/useTienda'
import WhatsAppButton from './WhatsAppButton'
import InstallBanner from './InstallBanner'

function Encabezado({ slug, config }) {
  const { piezas } = useCarrito()
  const propiedades = config.modo === 'propiedades'
  return (
    <header className="header">
      <div className="contenedor">
        <Link to={`/${slug}`} className="marca">
          {config.logo_url && <img src={config.logo_url} alt="" />}
          <span>{config.nombre_tienda}</span>
        </Link>
        <nav>
          <NavLink to={`/${slug}/catalogo`}>{propiedades ? 'Propiedades' : 'Catálogo'}</NavLink>
          {!propiedades && (
            <NavLink to={`/${slug}/carrito`}>
              Carrito{piezas > 0 && <span className="badge">{piezas}</span>}
            </NavLink>
          )}
          <NavLink to={`/${slug}/orden`}>Mi orden</NavLink>
        </nav>
      </div>
    </header>
  )
}

// Marco común de la tienda: carga la configuración y aplica el color de la marca.
export default function TiendaLayout() {
  const { slug } = useParams()
  const { config, error } = useTienda(slug)

  useEffect(() => {
    if (config) {
      document.documentElement.style.setProperty('--brand', config.color_primario)
      document.title = config.nombre_tienda
    }
  }, [config])

  if (error) {
    return (
      <div className="contenedor" style={{ padding: '48px 0' }}>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Tienda no disponible</h2>
          <p className="muted">Revisa el enlace o intenta más tarde.</p>
        </div>
      </div>
    )
  }
  if (!config) return <div className="contenedor" style={{ padding: '48px 0' }}>Cargando…</div>

  return (
    <CartProvider slug={slug}>
      <Encabezado slug={slug} config={config} />
      <main className="contenedor">
        <Outlet context={{ slug, config }} />
      </main>
      <footer className="contenedor muted" style={{ padding: '32px 16px', fontSize: 13 }}>
        {config.correo_contacto && <div>Contacto: {config.correo_contacto}</div>}
        {config.politica_envios && <div style={{ marginTop: 6 }}><strong>Envíos:</strong> {config.politica_envios}</div>}
        {config.politica_devoluciones && <div style={{ marginTop: 6 }}><strong>Devoluciones:</strong> {config.politica_devoluciones}</div>}
      </footer>
      <WhatsAppButton numero={config.whatsapp} />
      <InstallBanner />
    </CartProvider>
  )
}
