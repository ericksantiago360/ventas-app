import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { tiendaApi } from '../api'
import ProductCard from '../components/ProductCard'

export default function TiendaHome() {
  const { slug, config } = useOutletContext()
  const [categorias, setCategorias] = useState([])
  const [destacados, setDestacados] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([tiendaApi.categorias(slug), tiendaApi.productos(slug, { limite: 8 })])
      .then(([cat, prod]) => { setCategorias(cat.data); setDestacados(prod.data) })
      .catch(e => setError(e.message))
  }, [slug])

  const propiedades = config.modo === 'propiedades'

  return (
    <>
      {config.banner_url && <img className="banner" src={config.banner_url} alt="" />}
      <section className="hero">
        <h1>{config.nombre_tienda}</h1>
        {config.descripcion && <p>{config.descripcion}</p>}
      </section>

      {error && <div className="error">{error}</div>}

      {categorias.length > 0 && (
        <div className="categorias">
          {categorias.map(c => (
            <Link key={c.id} className="chip" to={`/${slug}/catalogo?categoria=${c.id}`}>
              {c.nombre} <span className="muted">({c.productos})</span>
            </Link>
          ))}
        </div>
      )}

      <div className="seccion">{propiedades ? 'Propiedades destacadas' : 'Destacados'}</div>
      <div className="grid-productos">
        {destacados.map(p => <ProductCard key={p.id} slug={slug} producto={p} config={config} />)}
      </div>
      {destacados.length === 0 && !error && <p className="muted">Pronto publicaremos el catálogo.</p>}
      <div style={{ marginBottom: 24 }}>
        <Link className="btn secundario" to={`/${slug}/catalogo`}>Ver todo</Link>
      </div>
    </>
  )
}
