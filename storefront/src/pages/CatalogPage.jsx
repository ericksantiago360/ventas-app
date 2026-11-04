import { useEffect, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { tiendaApi } from '../api'
import ProductCard from '../components/ProductCard'

const POR_PAGINA = 24

export default function CatalogPage() {
  const { slug, config } = useOutletContext()
  const [params, setParams] = useSearchParams()
  const categoria = params.get('categoria') || ''
  const [buscarTexto, setBuscarTexto] = useState(params.get('buscar') || '')
  const [categorias, setCategorias] = useState([])
  const [productos, setProductos] = useState([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    tiendaApi.categorias(slug).then(c => setCategorias(c.data)).catch(() => {})
  }, [slug])

  // Búsqueda con pausa para no pedir en cada tecla
  useEffect(() => {
    const t = setTimeout(() => {
      setPagina(1)
      setParams(p => {
        const n = new URLSearchParams(p)
        buscarTexto ? n.set('buscar', buscarTexto) : n.delete('buscar')
        return n
      }, { replace: true })
    }, 300)
    return () => clearTimeout(t)
  }, [buscarTexto, setParams])

  const buscar = params.get('buscar') || ''

  useEffect(() => {
    let vigente = true
    setCargando(true); setError('')
    tiendaApi.productos(slug, { categoria, buscar, pagina, limite: POR_PAGINA })
      .then(r => {
        if (!vigente) return
        setTotal(r.total)
        setProductos(prev => (pagina === 1 ? r.data : [...prev, ...r.data]))
      })
      .catch(e => { if (vigente) setError(e.message) })
      .finally(() => { if (vigente) setCargando(false) })
    return () => { vigente = false }
  }, [slug, categoria, buscar, pagina])

  const cambiarCategoria = (id) => {
    setPagina(1)
    setProductos([])
    setParams(p => {
      const n = new URLSearchParams(p)
      id ? n.set('categoria', id) : n.delete('categoria')
      return n
    })
  }

  return (
    <>
      <div className="seccion">{config.modo === 'propiedades' ? 'Propiedades' : 'Catálogo'}</div>
      <div className="campo" style={{ marginBottom: 8 }}>
        <input placeholder="Buscar…" value={buscarTexto} onChange={e => setBuscarTexto(e.target.value)} />
      </div>
      <div className="categorias">
        <button className={`chip ${!categoria ? 'activo' : ''}`} onClick={() => cambiarCategoria('')}>Todas</button>
        {categorias.map(c => (
          <button key={c.id} className={`chip ${categoria === c.id ? 'activo' : ''}`} onClick={() => cambiarCategoria(c.id)}>
            {c.nombre}
          </button>
        ))}
      </div>

      {error && <div className="error">{error}</div>}
      <div className="grid-productos">
        {productos.map(p => <ProductCard key={p.id} slug={slug} producto={p} config={config} />)}
      </div>
      {!cargando && productos.length === 0 && !error && (
        <p className="muted">No encontramos productos con esos filtros.</p>
      )}
      {productos.length < total && (
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <button className="btn secundario" disabled={cargando} onClick={() => setPagina(p => p + 1)}>
            {cargando ? 'Cargando…' : 'Cargar más'}
          </button>
        </div>
      )}
    </>
  )
}
