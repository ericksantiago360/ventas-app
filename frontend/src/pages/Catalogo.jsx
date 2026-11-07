import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import VariantesProducto from '../components/VariantesProducto'
import GaleriaProducto from '../components/GaleriaProducto'
import ListasPrecios from '../components/ListasPrecios'
import Categorias from '../components/Categorias'
import { useNegocio } from '../context/NegocioContext'
import { AvisoEdicion, BadgeEdicion, estiloCabeceraEdicion, estiloPanelEdicion } from '../components/ModoEdicion'
import { useSmartDefaults, elegirClaves, setLastUsed } from '../hooks/useSmartDefaults'
import { MONEDAS, PERFILES_FISCALES } from '../constants/catalogos'

const api = axios.create({
  baseURL: '',
  timeout: 15_000,
})

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

const TIPOS = [
  ['producto', 'Producto'],
  ['servicio', 'Servicio'],
  ['paquete', 'Paquete'],
  ['suscripcion', 'Suscripción'],
  ['renta', 'Renta'],
  ['otro', 'Otro'],
]

export default function Catalogo() {
  const { negocioId, setNegocioId, negociosDisponibles } = useNegocio()

  const [productos, setProductos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [busqueda, setBusqueda] = useState('')
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [productoEditando, setProductoEditando] = useState(null)
  const [productoVariantes, setProductoVariantes] = useState(null)
  const [subiendoImagen, setSubiendoImagen] = useState(false)
  const [mostrarListas, setMostrarListas] = useState(false)
  // Stock actual del ítem de inventario ligado (solo lectura al editar un producto con control)
  const [stockActual, setStockActual] = useState(null)

  const { defaultsProducto } = useSmartDefaults()
  const [form, setForm] = useState(formularioNuevoProducto)

  useEffect(() => {
    cargarCatalogo()
  }, [negocioId])

  async function cargarCatalogo() {
    setLoading(true)
    setError('')

    try {
      const [productosRes, categoriasRes] = await Promise.all([
        api.get(`/api/catalogo/productos?negocio_id=${negocioId}`),
        api.get(`/api/catalogo/categorias?negocio_id=${negocioId}`),
      ])

      setProductos(productosRes.data?.data || [])
      setCategorias(categoriasRes.data?.data || [])
    } catch (err) {
      console.error(err)
      setError(
        err?.response?.data?.detail ||
        'No fue posible cargar el catálogo.'
      )
    } finally {
      setLoading(false)
    }
  }

  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()

    if (!q) return productos

    return productos.filter((p) =>
      [
        p.nombre,
        p.codigo,
        p.sku,
        p.descripcion,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    )
  }, [productos, busqueda])

  // Formulario de alta: valores base + sugerencias (último tipo y categoría usados).
  // La categoría sugerida solo se usa si todavía existe en el catálogo.
  function formularioNuevoProducto() {
    const base = {
      codigo: '',
      sku: '',
      nombre: '',
      descripcion: '',
      tipo: 'producto',
      categoria_id: '',
      unidad: 'pieza',
      activo: true,
      costo: '',
      precio_base: '',
      iva_aplicable: true,
      iva_pct: 16,
      tax_profile: '',
      ieps_units: 0,
      sat_product_key: '',
      sat_unit_key: 'H87',
      moneda: 'MXN',
      control_inventario: true,
      stock_inicial: 0,
      permite_variantes: false,
      especificaciones: {},
      metadata: {},
    }
    const sugeridos = elegirClaves(defaultsProducto(), Object.keys(base))
    if (sugeridos.categoria_id && !categorias.some(c => (c._id || c.id) === sugeridos.categoria_id)) {
      sugeridos.categoria_id = ''
    }
    return { ...base, ...sugeridos }
  }

  function actualizarCampo(campo, valor) {
    setForm((actual) => ({
      ...actual,
      [campo]: valor,
    }))
  }

  // Galería: `medios` es la lista ordenada (imágenes y videos); el primero es el principal
  const mediosDe = (p) => {
    if (p?.medios) return p.medios
    if (p?.imagenes) return p.imagenes.map((u, i) => ({ id: `img-${i}`, tipo: 'imagen', url: u }))
    return p?.imagen ? [{ id: 'img-0', tipo: 'imagen', url: p.imagen }] : []
  }

  async function agregarYoutubeProducto(url) {
    const productoId = productoEditando._id || productoEditando.id
    const res = await api.post(
      `/api/catalogo/productos/${productoId}/medios/youtube?negocio_id=${encodeURIComponent(negocioId)}`,
      { url }
    )
    setProductoEditando(prev => ({ ...prev, imagen: res.data.data.imagen, medios: res.data.data.medios }))
    await cargarCatalogo()
  }

  async function subirImagenesProducto(archivos) {
    if (!archivos?.length || !productoEditando) return

    const productoId = productoEditando._id || productoEditando.id

    try {
      setError('')
      setSubiendoImagen(true)

      for (const archivo of archivos) {
        const datos = new FormData()
        datos.append('archivo', archivo)

        const res = await api.post(
          `/api/catalogo/productos/${productoId}/imagenes?negocio_id=${encodeURIComponent(negocioId)}`,
          datos
        )

        setProductoEditando(prev => ({
          ...prev,
          imagen: res.data.data.imagen,
          medios: res.data.data.medios,
        }))
      }

      await cargarCatalogo()
    } catch (err) {
      console.error(err)
      setError(
        err?.response?.data?.detail ||
        'No fue posible subir la imagen.'
      )
    } finally {
      setSubiendoImagen(false)
    }
  }

  // Sirve para reordenar y para quitar: el servidor borra las imágenes que ya no están en la lista
  async function guardarGaleria(nuevos) {
    if (!productoEditando) return

    const productoId = productoEditando._id || productoEditando.id
    const anteriores = mediosDe(productoEditando)

    setError('')
    setProductoEditando(prev => ({ ...prev, medios: nuevos, imagen: nuevos.find(m => m.tipo === 'imagen')?.url || '' }))

    try {
      const res = await api.put(
        `/api/catalogo/productos/${productoId}/medios?negocio_id=${encodeURIComponent(negocioId)}`,
        { ids: nuevos.map(m => m.id) }
      )
      setProductoEditando(prev => ({ ...prev, medios: res.data.data.medios, imagen: res.data.data.imagen }))
      await cargarCatalogo()
    } catch (err) {
      console.error(err)
      setProductoEditando(prev => ({ ...prev, medios: anteriores, imagen: anteriores.find(m => m.tipo === 'imagen')?.url || '' }))
      setError(
        err?.response?.data?.detail ||
        'No fue posible guardar la galería de imágenes.'
      )
    }
  }

  async function guardarProducto(e) {
    e.preventDefault()
    setError('')

    try {
      const payload = {
        ...form,
        negocio_id: negocioId,
        costo: form.costo === '' ? null : Number(form.costo),
        precio_base:
          form.precio_base === '' ? null : Number(form.precio_base),
        iva_pct: Number(form.iva_pct),
        ieps_units: Number(form.ieps_units) || 0,
        categoria_id: form.categoria_id || null,
        // El servidor solo lo usa al crear o al activar el control; en edición lo ignora
        stock_inicial: Number(form.stock_inicial) || 0,
      }

      if (productoEditando) {
        const productoId =
          productoEditando._id || productoEditando.id

        await api.put(
          `/api/catalogo/productos/${productoId}`,
          payload
        )
      } else {
        await api.post(
          '/api/catalogo/productos',
          payload
        )
      }

      setLastUsed('producto_tipo', form.tipo)
      setLastUsed('producto_categoria', form.categoria_id || null)

      setMostrarFormulario(false)
      setProductoEditando(null)

      setForm(formularioNuevoProducto())

      await cargarCatalogo()
    } catch (err) {
      console.error(err)
      setError(
        err?.response?.data?.detail ||
        'No fue posible guardar el producto.'
      )
    }
  }

  async function cargarStockProducto(productoId) {
    setStockActual(null)
    try {
      const res = await api.get(`/api/inventario/producto/${productoId}/stock`, {
        params: { negocio_id: negocioId },
      })
      setStockActual(res.data?.stock_actual ?? 0)
    } catch (err) {
      console.error(err)
      setStockActual(null)
    }
  }

  function editarProducto(producto) {
    setProductoEditando(producto)
    cargarStockProducto(producto._id || producto.id)

    setForm({
      codigo: producto.codigo || '',
      sku: producto.sku || '',
      nombre: producto.nombre || '',
      descripcion: producto.descripcion || '',
      tipo: producto.tipo || 'producto',
      categoria_id: producto.categoria_id || '',
      unidad: producto.unidad || 'pieza',
      activo: producto.activo !== false,
      costo:
        producto.costo == null ? '' : producto.costo,
      precio_base:
        producto.precio_base == null
          ? ''
          : producto.precio_base,
      iva_aplicable:
        producto.iva_aplicable !== false,
      iva_pct:
        producto.iva_pct == null
          ? 16
          : producto.iva_pct,
      tax_profile: producto.tax_profile || '',
      ieps_units: producto.ieps_units ?? 0,
      sat_product_key: producto.sat_product_key || '',
      sat_unit_key: producto.sat_unit_key || 'H87',
      moneda: producto.moneda || 'MXN',
      control_inventario:
        producto.control_inventario === true,
      stock_inicial: 0,
      permite_variantes:
        producto.permite_variantes === true,
      especificaciones:
        producto.especificaciones || {},
      metadata:
        producto.metadata || {},
    })

    setMostrarFormulario(true)
  }

  async function borrarProducto(producto) {
    const productoId =
      producto._id || producto.id

    const confirmado = window.confirm(
      `¿Deseas borrar el producto "${producto.nombre}"?`
    )

    if (!confirmado) return

    try {
      setError('')

      await api.delete(
        `/api/catalogo/productos/${productoId}?negocio_id=${encodeURIComponent(negocioId)}`
      )

      await cargarCatalogo()
    } catch (err) {
      console.error(err)
      setError(
        err?.response?.data?.detail ||
        'No fue posible borrar el producto.'
      )
    }
  }

  function nombreCategoria(id) {
    const categoria = categorias.find(
      (c) => String(c._id || c.id) === String(id)
    )

    return categoria?.nombre || '—'
  }

  return (
    <div style={styles.page}>

      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Catálogo</h1>
          <p style={styles.subtitle}>
            Productos, servicios, paquetes, variantes y precios
          </p>
        </div>

        <div style={styles.headerActions}>
          <select
            value={negocioId}
            onChange={(e) => setNegocioId(e.target.value)}
            style={styles.select}
          >
            {negociosDisponibles.map(n => (
              <option key={n.id} value={n.id}>{n.nombre}</option>
            ))}
          </select>

          <button
            onClick={() => {
              setProductoEditando(null)
              setForm(formularioNuevoProducto())
              setMostrarFormulario(true)
            }}
            style={styles.primaryButton}
          >
            + Nuevo producto
          </button>

          <button
            onClick={() => setMostrarListas(true)}
            style={{ ...styles.primaryButton, background: '#fff', color: '#0f172a', border: '1px solid #cbd5e1' }}
          >
            Listas de precios
          </button>
        </div>
      </div>

      {mostrarListas && (
        <ListasPrecios
          negocioId={negocioId}
          categorias={categorias}
          onCerrar={() => setMostrarListas(false)}
        />
      )}

      {error && (
        <div style={styles.error}>
          {error}
        </div>
      )}

      <div style={styles.stats}>
        <div style={styles.statCard}>
          <div style={styles.statNumber}>{productos.length}</div>
          <div style={styles.statLabel}>Productos</div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statNumber}>{categorias.length}</div>
          <div style={styles.statLabel}>Categorías</div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statNumber}>
            {productos.filter((p) => p.activo !== false).length}
          </div>
          <div style={styles.statLabel}>Activos</div>
        </div>
      </div>

      <div style={styles.toolbar}>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, código o SKU..."
          style={styles.search}
        />

        <button
          onClick={cargarCatalogo}
          style={styles.secondaryButton}
        >
          Actualizar
        </button>
      </div>

      <div style={styles.card}>
        {loading ? (
          <div style={styles.empty}>
            Cargando catálogo...
          </div>
        ) : productosFiltrados.length === 0 ? (
          <div style={styles.empty}>
            <div style={styles.emptyTitle}>
              No hay productos
            </div>

            <div style={styles.emptyText}>
              El catálogo de esta empresa todavía no tiene productos
              registrados.
            </div>

            <button
              onClick={() => {
                setProductoEditando(null)
                setForm(formularioNuevoProducto())
                setMostrarFormulario(true)
              }}
              style={styles.primaryButton}
            >
              Crear primer producto
            </button>
          </div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Código</th>
                  <th style={styles.th}>SKU</th>
                  <th style={styles.th}>Nombre</th>
                  <th style={styles.th}>Tipo</th>
                  <th style={styles.th}>Categoría</th>
                  <th style={styles.th}>Precio</th>
                  <th style={styles.th}>Estado</th>
                  <th style={styles.th}>Acciones</th>
                </tr>
              </thead>

              <tbody>
                {productosFiltrados.map((producto) => (
                  <tr key={producto._id || producto.id}>
                    <td style={styles.td}>
                      {producto.codigo || '—'}
                    </td>

                    <td style={styles.td}>
                      {producto.sku || '—'}
                    </td>

                    <td style={styles.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {producto.imagen ? (
                          <img
                            src={producto.imagen}
                            alt=""
                            loading="lazy"
                            style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, border: '1px solid #e2e8f0', flexShrink: 0 }}
                          />
                        ) : (
                          <div style={{ width: 36, height: 36, borderRadius: 6, border: '1px dashed #cbd5e1', flexShrink: 0 }} />
                        )}
                        <strong>{producto.nombre}</strong>
                      </div>
                    </td>

                    <td style={styles.td}>
                      {TIPOS.find(
                        ([valor]) => valor === producto.tipo
                      )?.[1] || producto.tipo || '—'}
                    </td>

                    <td style={styles.td}>
                      {nombreCategoria(producto.categoria_id)}
                    </td>

                    <td style={styles.td}>
                      {producto.precio_base != null
                        ? `${producto.moneda || 'MXN'} ${Number(
                            producto.precio_base
                          ).toLocaleString('es-MX', {
                            minimumFractionDigits: 2,
                          })}`
                        : '—'}
                    </td>

                    <td style={styles.td}>
                      <span
                        style={
                          producto.activo !== false
                            ? styles.active
                            : styles.inactive
                        }
                      >
                        {producto.activo !== false
                          ? 'Activo'
                          : 'Inactivo'}
                      </span>
                    </td>

                    <td style={styles.td}>
                      <div
                        style={{
                          display: 'flex',
                          gap: '8px',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => editarProducto(producto)}
                          style={styles.secondaryButton}
                        >
                          Actualizar
                        </button>

                        <button
                          type="button"
                          onClick={() => borrarProducto(producto)}
                          style={{
                            ...styles.secondaryButton,
                            color: '#dc2626',
                            borderColor: '#fecaca',
                            background: '#fff',
                          }}
                        >
                          Borrar
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setProductoVariantes(producto)
                          }
                          style={styles.secondaryButton}
                        >
                          Variantes
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Categorias
        negocioId={negocioId}
        categorias={categorias}
        productos={productos}
        onRefresh={cargarCatalogo}
      />

      {productoVariantes && (
        <VariantesProducto
          negocioId={negocioId}
          producto={productoVariantes}
          abierto={Boolean(productoVariantes)}
          onClose={() => setProductoVariantes(null)}
        />
      )}

      {mostrarFormulario && (
        <div style={styles.overlay}>
          <div style={estiloPanelEdicion(Boolean(productoEditando), styles.modal)}>
            <div style={estiloCabeceraEdicion(Boolean(productoEditando), styles.modalHeader)}>
              <div>
                {productoEditando && <BadgeEdicion />}
                <h2 style={styles.modalTitle}>
                  {productoEditando
                    ? 'Actualizar producto'
                    : 'Nuevo producto'}
                </h2>

                <p style={styles.modalSubtitle}>
                  Alta de producto en el catálogo
                </p>
              </div>

              <button
                onClick={() => setMostrarFormulario(false)}
                style={styles.closeButton}
              >
                ×
              </button>
            </div>

            {productoEditando && (
              <AvisoEdicion entidad={`el producto ${productoEditando.nombre || ''}`.trim()} />
            )}

            <form onSubmit={guardarProducto}>
              <div style={styles.formGrid}>

                <div>
                  <label style={styles.label}>Código</label>
                  <input
                    value={form.codigo}
                    onChange={(e) =>
                      actualizarCampo('codigo', e.target.value)
                    }
                    style={styles.input}
                  />
                </div>

                <div>
                  <label style={styles.label}>SKU *</label>
                  <input
                    required
                    value={form.sku}
                    onChange={(e) =>
                      actualizarCampo('sku', e.target.value)
                    }
                    style={styles.input}
                  />
                </div>

                <div style={styles.full}>
                  <label style={styles.label}>Nombre *</label>
                  <input
                    required
                    value={form.nombre}
                    onChange={(e) =>
                      actualizarCampo('nombre', e.target.value)
                    }
                    style={styles.input}
                  />
                </div>

                <div style={styles.full}>
                  <label style={styles.label}>
                    Descripción
                  </label>

                  <textarea
                    value={form.descripcion}
                    onChange={(e) =>
                      actualizarCampo(
                        'descripcion',
                        e.target.value
                      )
                    }
                    style={styles.textarea}
                    rows={3}
                  />
                </div>

                <div style={styles.full}>
                  <label style={styles.label}>Imágenes</label>

                  {productoEditando ? (
                    <>
                      <GaleriaProducto
                        medios={mediosDe(productoEditando)}
                        subiendo={subiendoImagen}
                        onReordenar={guardarGaleria}
                        onQuitar={(id) => guardarGaleria(mediosDe(productoEditando).filter(m => m.id !== id))}
                        onSubir={subirImagenesProducto}
                        onAgregarYoutube={agregarYoutubeProducto}
                      />
                      <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: 12 }}>
                        {subiendoImagen ? 'Subiendo...' : 'JPG, PNG o WebP. Máximo 5 MB por imagen.'}
                      </p>
                    </>
                  ) : (
                    <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>
                      Guarda el producto primero; después podrás subir su imagen.
                    </p>
                  )}
                </div>

                <div>
                  <label style={styles.label}>Tipo</label>

                  <select
                    value={form.tipo}
                    onChange={(e) =>
                      actualizarCampo('tipo', e.target.value)
                    }
                    style={styles.input}
                  >
                    {TIPOS.map(([valor, nombre]) => (
                      <option key={valor} value={valor}>
                        {nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={styles.label}>
                    Categoría
                  </label>

                  <select
                    value={form.categoria_id}
                    onChange={(e) =>
                      actualizarCampo(
                        'categoria_id',
                        e.target.value
                      )
                    }
                    style={styles.input}
                  >
                    <option value="">
                      Sin categoría
                    </option>

                    {categorias.map((categoria) => (
                      <option
                        key={categoria._id || categoria.id}
                        value={categoria._id || categoria.id}
                      >
                        {categoria.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={styles.label}>
                    Unidad
                  </label>

                  <input
                    value={form.unidad}
                    onChange={(e) =>
                      actualizarCampo(
                        'unidad',
                        e.target.value
                      )
                    }
                    style={styles.input}
                  />
                </div>

                <div>
                  <label style={styles.label}>
                    Moneda
                  </label>

                  <select
                    name="moneda"
                    value={form.moneda}
                    onChange={(e) =>
                      actualizarCampo('moneda', e.target.value)
                    }
                    style={styles.input}
                  >
                    {MONEDAS.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                  {form.moneda !== 'MXN' && (
                    <p style={{fontSize:'.8rem', color:'var(--color-warning, #92400E)', marginTop:4}}>
                      💱 Tipo de cambio no incluido — el monto se registra en {form.moneda} tal como
                      se capture. Verifica la paridad al emitir la factura (SAT requiere tipo de cambio
                      en CFDI con moneda extranjera).
                    </p>
                  )}
                </div>

                <div>
                  <label style={styles.label}>
                    Costo
                  </label>

                  <input
                    type="number"
                    step="0.01"
                    value={form.costo}
                    onChange={(e) =>
                      actualizarCampo(
                        'costo',
                        e.target.value
                      )
                    }
                    style={styles.input}
                  />
                </div>

                <div>
                  <label style={styles.label}>
                    Precio base
                  </label>

                  <input
                    type="number"
                    step="0.01"
                    value={form.precio_base}
                    onChange={(e) =>
                      actualizarCampo(
                        'precio_base',
                        e.target.value
                      )
                    }
                    style={styles.input}
                  />
                </div>

                <div>
                  <label style={styles.label}>
                    IVA %
                  </label>

                  <input
                    type="number"
                    step="0.01"
                    value={form.iva_pct}
                    onChange={(e) =>
                      actualizarCampo(
                        'iva_pct',
                        e.target.value
                      )
                    }
                    style={styles.input}
                  />
                </div>

              </div>

              <div>
                <label style={styles.label}>
                  Desglose fiscal (IVA / IEPS 2026)
                </label>
                <select
                  value={form.tax_profile}
                  onChange={(e) => actualizarCampo('tax_profile', e.target.value)}
                  style={styles.input}
                >
                  {PERFILES_FISCALES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>

              {form.tax_profile && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  <div>
                    <label style={styles.label}>Unidades IEPS (litros o cigarros por pieza)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.ieps_units}
                      onChange={(e) => actualizarCampo('ieps_units', e.target.value)}
                      style={styles.input}
                    />
                  </div>
                  <div>
                    <label style={styles.label}>Clave SAT producto (8 dígitos)</label>
                    <input
                      type="text"
                      maxLength={8}
                      value={form.sat_product_key}
                      onChange={(e) => actualizarCampo('sat_product_key', e.target.value)}
                      style={styles.input}
                    />
                  </div>
                  <div>
                    <label style={styles.label}>Clave SAT unidad</label>
                    <input
                      type="text"
                      value={form.sat_unit_key}
                      onChange={(e) => actualizarCampo('sat_unit_key', e.target.value)}
                      style={styles.input}
                    />
                  </div>
                </div>
              )}

              <div style={styles.checks}>
                <label>
                  <input
                    type="checkbox"
                    checked={form.iva_aplicable}
                    onChange={(e) =>
                      actualizarCampo(
                        'iva_aplicable',
                        e.target.checked
                      )
                    }
                  />{' '}
                  IVA aplicable
                </label>

                <label>
                  <input
                    type="checkbox"
                    checked={form.permite_variantes}
                    onChange={(e) =>
                      actualizarCampo(
                        'permite_variantes',
                        e.target.checked
                      )
                    }
                  />{' '}
                  Permite variantes
                </label>
              </div>

              <section style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e2e8f0' }}>
                <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Inventario</h3>

                <label>
                  <input
                    type="checkbox"
                    checked={form.control_inventario ?? false}
                    onChange={(e) =>
                      actualizarCampo('control_inventario', e.target.checked)
                    }
                  />{' '}
                  Controlar existencias de este producto
                </label>

                <p style={{ fontSize: '.8rem', color: '#64748b', margin: '4px 0 0' }}>
                  Si está activo, el producto solo aparece en tienda cuando tiene stock mayor a 0.
                </p>

                {form.control_inventario && !productoEditando?.control_inventario && (
                  <div style={{ marginTop: 12 }}>
                    <label style={styles.label}>Stock inicial</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={form.stock_inicial ?? 0}
                      onChange={(e) => actualizarCampo('stock_inicial', e.target.value)}
                      style={styles.input}
                    />
                    <p style={{ fontSize: '.8rem', color: '#64748b', margin: '4px 0 0' }}>
                      Después puedes ajustar existencias desde el módulo de Inventario.
                    </p>
                  </div>
                )}

                {form.control_inventario && productoEditando?.control_inventario && (
                  <p style={{ fontSize: '.9rem', marginTop: 8 }}>
                    Stock actual: <strong>{stockActual ?? '—'}</strong> unidades
                    {' — '}ajústalo desde <a href="/inventario">Inventario</a>
                  </p>
                )}
              </section>

              <div style={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() =>
                    setMostrarFormulario(false)
                  }
                  style={styles.secondaryButton}
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  style={styles.primaryButton}
                >
                  Guardar producto
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  page: {
    padding: '28px',
    maxWidth: '1400px',
    margin: '0 auto',
  },

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '20px',
    marginBottom: '24px',
  },

  title: {
    margin: 0,
    fontSize: '28px',
    color: '#0f172a',
  },

  subtitle: {
    margin: '6px 0 0',
    color: '#64748b',
  },

  headerActions: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
  },

  select: {
    padding: '10px 12px',
    border: '1px solid #cbd5e1',
    borderRadius: '8px',
    background: 'white',
  },

  primaryButton: {
    border: 'none',
    borderRadius: '8px',
    padding: '10px 16px',
    background: '#0f172a',
    color: 'white',
    cursor: 'pointer',
    fontWeight: 600,
  },

  secondaryButton: {
    border: '1px solid #cbd5e1',
    borderRadius: '8px',
    padding: '10px 16px',
    background: 'white',
    color: '#334155',
    cursor: 'pointer',
    fontWeight: 600,
  },

  error: {
    marginBottom: '18px',
    padding: '12px 16px',
    borderRadius: '8px',
    background: '#fee2e2',
    color: '#991b1b',
  },

  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '16px',
    marginBottom: '20px',
  },

  statCard: {
    background: 'white',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '18px',
  },

  statNumber: {
    fontSize: '26px',
    fontWeight: 700,
    color: '#0f172a',
  },

  statLabel: {
    marginTop: '4px',
    color: '#64748b',
    fontSize: '13px',
  },

  toolbar: {
    display: 'flex',
    gap: '10px',
    marginBottom: '16px',
  },

  search: {
    flex: 1,
    padding: '11px 14px',
    border: '1px solid #cbd5e1',
    borderRadius: '8px',
    fontSize: '14px',
  },

  card: {
    background: 'white',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    overflow: 'hidden',
  },

  tableWrap: {
    overflowX: 'auto',
  },

  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },

  th: {
    textAlign: 'left',
    padding: '13px 15px',
    borderBottom: '1px solid #e2e8f0',
    color: '#64748b',
    fontSize: '12px',
    textTransform: 'uppercase',
  },

  td: {
    padding: '14px 15px',
    borderBottom: '1px solid #f1f5f9',
    color: '#334155',
    fontSize: '14px',
  },

  active: {
    display: 'inline-block',
    padding: '4px 8px',
    borderRadius: '999px',
    background: '#dcfce7',
    color: '#166534',
    fontSize: '12px',
    fontWeight: 600,
  },

  inactive: {
    display: 'inline-block',
    padding: '4px 8px',
    borderRadius: '999px',
    background: '#f1f5f9',
    color: '#64748b',
    fontSize: '12px',
  },

  empty: {
    padding: '60px 30px',
    textAlign: 'center',
    color: '#64748b',
  },

  emptyTitle: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#0f172a',
    marginBottom: '8px',
  },

  emptyText: {
    marginBottom: '20px',
  },

  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    zIndex: 1000,
  },

  modal: {
    width: 'min(800px, 100%)',
    maxHeight: '90vh',
    overflowY: 'auto',
    background: 'white',
    borderRadius: '14px',
    padding: '24px',
    boxShadow: '0 20px 60px rgba(0,0,0,.2)',
  },

  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '22px',
  },

  modalTitle: {
    margin: 0,
    color: '#0f172a',
  },

  modalSubtitle: {
    margin: '5px 0 0',
    color: '#64748b',
    fontSize: '13px',
  },

  closeButton: {
    border: 'none',
    background: 'transparent',
    fontSize: '28px',
    color: '#64748b',
    cursor: 'pointer',
  },

  formGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },

  full: {
    gridColumn: '1 / -1',
  },

  label: {
    display: 'block',
    marginBottom: '6px',
    fontSize: '13px',
    fontWeight: 600,
    color: '#334155',
  },

  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    border: '1px solid #cbd5e1',
    borderRadius: '8px',
  },

  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    border: '1px solid #cbd5e1',
    borderRadius: '8px',
    resize: 'vertical',
  },

  checks: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '18px',
    marginTop: '20px',
    paddingTop: '18px',
    borderTop: '1px solid #e2e8f0',
    color: '#334155',
    fontSize: '13px',
  },

  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    marginTop: '24px',
    paddingTop: '18px',
    borderTop: '1px solid #e2e8f0',
  },
}
