import { useMemo, useState } from 'react'
import axios from 'axios'

const api = axios.create({
  baseURL: '',
  timeout: 15000,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

const formularioInicial = {
  nombre: '',
  codigo: '',
  descripcion: '',
  categoria_padre_id: '',
  activo: true,
  orden: 0,
}

function idCategoria(categoria) {
  return String(categoria?._id ?? categoria?.id ?? '')
}

function ordenarCategorias(a, b) {
  const ordenA = Number(a.orden ?? 0)
  const ordenB = Number(b.orden ?? 0)

  if (ordenA !== ordenB) {
    return ordenA - ordenB
  }

  return String(a.nombre ?? '').localeCompare(
    String(b.nombre ?? ''),
    'es',
    { sensitivity: 'base' }
  )
}

function construirArbol(categorias) {
  const mapa = new Map()
  const hijos = new Map()
  const raices = []

  categorias.forEach((categoria) => {
    mapa.set(idCategoria(categoria), categoria)
  })

  categorias.forEach((categoria) => {
    const id = idCategoria(categoria)
    const padre = categoria.categoria_padre_id
      ? String(categoria.categoria_padre_id)
      : ''

    if (padre && mapa.has(padre) && padre !== id) {
      if (!hijos.has(padre)) {
        hijos.set(padre, [])
      }
      hijos.get(padre).push(categoria)
    } else {
      raices.push(categoria)
    }
  })

  raices.sort(ordenarCategorias)

  hijos.forEach((lista) => {
    lista.sort(ordenarCategorias)
  })

  const resultado = []

  function recorrer(categoria, nivel) {
    resultado.push({
      categoria,
      nivel,
    })

    const id = idCategoria(categoria)
    const listaHijos = hijos.get(id) || []

    listaHijos.forEach((hijo) => {
      recorrer(hijo, nivel + 1)
    })
  }

  raices.forEach((raiz) => recorrer(raiz, 0))

  return resultado
}

function obtenerDescendientes(id, categorias) {
  const resultado = new Set()
  const pendientes = [String(id)]

  while (pendientes.length) {
    const actual = pendientes.pop()

    categorias.forEach((categoria) => {
      const padre = categoria.categoria_padre_id
        ? String(categoria.categoria_padre_id)
        : ''

      if (padre === actual) {
        const hijoId = idCategoria(categoria)

        if (!resultado.has(hijoId)) {
          resultado.add(hijoId)
          pendientes.push(hijoId)
        }
      }
    })
  }

  return resultado
}

export default function Categorias({
  negocioId,
  categorias = [],
  productos = [],
  onRefresh,
}) {
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('todas')
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [editandoId, setEditandoId] = useState(null)
  const [formulario, setFormulario] = useState(formularioInicial)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const arbol = useMemo(
    () => construirArbol(categorias),
    [categorias]
  )

  const productosPorCategoria = useMemo(() => {
    const conteo = new Map()

    productos.forEach((producto) => {
      if (!producto.categoria_id) return

      const categoriaId = String(producto.categoria_id)

      conteo.set(
        categoriaId,
        (conteo.get(categoriaId) || 0) + 1
      )
    })

    return conteo
  }, [productos])

  const categoriasVisibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()

    const coincideEstado = (categoria) => {
      if (filtroEstado === 'activas') {
        return categoria.activo !== false
      }

      if (filtroEstado === 'inactivas') {
        return categoria.activo === false
      }

      return true
    }

    const coincideTexto = (categoria) => {
      if (!texto) return true

      const padre = categorias.find(
        (item) =>
          idCategoria(item) ===
          String(categoria.categoria_padre_id || '')
      )

      return [
        categoria.nombre,
        categoria.codigo,
        categoria.descripcion,
        padre?.nombre,
      ]
        .filter(Boolean)
        .some((valor) =>
          String(valor).toLowerCase().includes(texto)
        )
    }

    const idsCoincidentes = new Set()

    categorias.forEach((categoria) => {
      if (
        coincideEstado(categoria) &&
        coincideTexto(categoria)
      ) {
        idsCoincidentes.add(idCategoria(categoria))
      }
    })

    // Cuando hay búsqueda, agregamos los padres de los resultados
    // para conservar la estructura jerárquica.
    if (texto) {
      let huboCambios = true

      while (huboCambios) {
        huboCambios = false

        categorias.forEach((categoria) => {
          const id = idCategoria(categoria)
          const padre = categoria.categoria_padre_id
            ? String(categoria.categoria_padre_id)
            : ''

          if (
            idsCoincidentes.has(id) &&
            padre &&
            !idsCoincidentes.has(padre)
          ) {
            idsCoincidentes.add(padre)
            huboCambios = true
          }
        })
      }
    }

    return arbol.filter(({ categoria }) =>
      idsCoincidentes.has(idCategoria(categoria))
    )
  }, [
    arbol,
    categorias,
    busqueda,
    filtroEstado,
  ])

  const total = categorias.length

  const activas = categorias.filter(
    (categoria) => categoria.activo !== false
  ).length

  const inactivas = total - activas

  const categoriasRaiz = categorias.filter(
    (categoria) => !categoria.categoria_padre_id
  ).length

  const abrirNueva = () => {
    setError('')
    setEditandoId(null)
    setFormulario(formularioInicial)
    setMostrarFormulario(true)
  }

  const abrirEditar = (categoria) => {
    setError('')
    setEditandoId(idCategoria(categoria))

    setFormulario({
      nombre: categoria.nombre || '',
      codigo: categoria.codigo || '',
      descripcion: categoria.descripcion || '',
      categoria_padre_id: categoria.categoria_padre_id
        ? String(categoria.categoria_padre_id)
        : '',
      activo: categoria.activo !== false,
      orden: Number(categoria.orden ?? 0),
    })

    setMostrarFormulario(true)
  }

  const cerrarFormulario = () => {
    if (guardando) return

    setMostrarFormulario(false)
    setEditandoId(null)
    setFormulario(formularioInicial)
    setError('')
  }

  const guardarCategoria = async (e) => {
    e.preventDefault()

    if (!formulario.nombre.trim()) {
      setError('El nombre de la categoría es obligatorio.')
      return
    }

    if (!negocioId) {
      setError('No hay un negocio seleccionado.')
      return
    }

    try {
      setGuardando(true)
      setError('')

      const payload = {
        negocio_id: negocioId,
        nombre: formulario.nombre.trim(),
        codigo: formulario.codigo.trim().toUpperCase(),
        descripcion: formulario.descripcion.trim(),
        categoria_padre_id:
          formulario.categoria_padre_id || null,
        activo: Boolean(formulario.activo),
        orden: Number(formulario.orden || 0),
      }

      if (editandoId) {
        await api.put(
          `/api/catalogo/categorias/${editandoId}`,
          payload
        )
      } else {
        await api.post(
          '/api/catalogo/categorias',
          payload
        )
      }

      cerrarFormulario()

      if (onRefresh) {
        await onRefresh()
      }
    } catch (err) {
      console.error(err)

      const detalle =
        err.response?.data?.detail ||
        'No fue posible guardar la categoría.'

      setError(String(detalle))
    } finally {
      setGuardando(false)
    }
  }

  const cambiarEstado = async (categoria) => {
    const id = idCategoria(categoria)

    if (!id) return

    try {
      setError('')

      await api.put(
        `/api/catalogo/categorias/${id}`,
        {
          negocio_id: negocioId,
          activo: categoria.activo === false,
        }
      )

      if (onRefresh) {
        await onRefresh()
      }
    } catch (err) {
      console.error(err)

      setError(
        err.response?.data?.detail ||
        'No fue posible cambiar el estado de la categoría.'
      )
    }
  }

  const padresDisponibles = useMemo(() => {
    const excluidas = new Set()

    if (editandoId) {
      excluidas.add(String(editandoId))

      obtenerDescendientes(
        editandoId,
        categorias
      ).forEach((id) => excluidas.add(id))
    }

    return arbol.filter(
      ({ categoria }) =>
        !excluidas.has(idCategoria(categoria))
    )
  }, [arbol, categorias, editandoId])

  const nombrePadre = (categoria) => {
    if (!categoria.categoria_padre_id) {
      return '—'
    }

    const padre = categorias.find(
      (item) =>
        idCategoria(item) ===
        String(categoria.categoria_padre_id)
    )

    return padre?.nombre || '—'
  }

  return (
    <section style={styles.section}>
      <div style={styles.sectionHeader}>
        <div>
          <div style={styles.eyebrow}>CATÁLOGO</div>
          <h2 style={styles.title}>Categorías</h2>
          <p style={styles.subtitle}>
            Organiza productos y servicios mediante categorías
            jerárquicas.
          </p>
        </div>

        <button
          type="button"
          onClick={abrirNueva}
          style={styles.primaryButton}
        >
          + Nueva categoría
        </button>
      </div>

      {error && (
        <div style={styles.error}>
          {error}
        </div>
      )}

      <div style={styles.stats}>
        <div style={styles.stat}>
          <span style={styles.statLabel}>TOTAL</span>
          <strong style={styles.statValue}>{total}</strong>
        </div>

        <div style={styles.stat}>
          <span style={styles.statLabel}>ACTIVAS</span>
          <strong style={styles.statValue}>{activas}</strong>
        </div>

        <div style={styles.stat}>
          <span style={styles.statLabel}>INACTIVAS</span>
          <strong style={styles.statValue}>{inactivas}</strong>
        </div>

        <div style={styles.stat}>
          <span style={styles.statLabel}>CATEGORÍAS RAÍZ</span>
          <strong style={styles.statValue}>
            {categoriasRaiz}
          </strong>
        </div>
      </div>

      <div style={styles.toolbar}>
        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, código o descripción..."
          style={styles.search}
        />

        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value)}
          style={styles.select}
        >
          <option value="todas">Todas</option>
          <option value="activas">Activas</option>
          <option value="inactivas">Inactivas</option>
        </select>

        <button
          type="button"
          onClick={onRefresh}
          style={styles.secondaryButton}
        >
          Actualizar
        </button>
      </div>

      <div style={styles.tableCard}>
        <div style={styles.tableHeader}>
          <div>CÓDIGO</div>
          <div>CATEGORÍA</div>
          <div>PADRE</div>
          <div>PRODUCTOS</div>
          <div>ORDEN</div>
          <div>ESTADO</div>
          <div>ACCIONES</div>
        </div>

        {categoriasVisibles.length === 0 ? (
          <div style={styles.empty}>
            <strong>No hay categorías para mostrar.</strong>
            <span>
              Crea una categoría para comenzar a organizar
              el catálogo.
            </span>
          </div>
        ) : (
          categoriasVisibles.map(({ categoria, nivel }) => {
            const id = idCategoria(categoria)
            const cantidad =
              productosPorCategoria.get(id) || 0

            return (
              <div
                key={id}
                style={styles.tableRow}
              >
                <div style={styles.code}>
                  {categoria.codigo || '—'}
                </div>

                <div
                  style={{
                    ...styles.categoryName,
                    paddingLeft: `${12 + nivel * 24}px`,
                  }}
                >
                  {nivel > 0 && (
                    <span style={styles.treeLine}>
                      ↳
                    </span>
                  )}

                  <span>
                    {categoria.nombre}
                  </span>
                </div>

                <div style={styles.cell}>
                  {nombrePadre(categoria)}
                </div>

                <div style={styles.cell}>
                  {cantidad}
                </div>

                <div style={styles.cell}>
                  {Number(categoria.orden ?? 0)}
                </div>

                <div>
                  <span
                    style={
                      categoria.activo === false
                        ? styles.badgeInactive
                        : styles.badgeActive
                    }
                  >
                    {categoria.activo === false
                      ? 'Inactiva'
                      : 'Activa'}
                  </span>
                </div>

                <div style={styles.actions}>
                  <button
                    type="button"
                    onClick={() =>
                      abrirEditar(categoria)
                    }
                    style={styles.actionButton}
                  >
                    Editar
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      cambiarEstado(categoria)
                    }
                    style={styles.actionButton}
                  >
                    {categoria.activo === false
                      ? 'Activar'
                      : 'Desactivar'}
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {mostrarFormulario && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <div>
                <div style={styles.eyebrow}>
                  {editandoId
                    ? 'EDITAR CATEGORÍA'
                    : 'NUEVA CATEGORÍA'}
                </div>

                <h3 style={styles.modalTitle}>
                  {editandoId
                    ? 'Editar categoría'
                    : 'Crear categoría'}
                </h3>
              </div>

              <button
                type="button"
                onClick={cerrarFormulario}
                style={styles.closeButton}
              >
                ×
              </button>
            </div>

            <form onSubmit={guardarCategoria}>
              <div style={styles.formGrid}>
                <label style={styles.field}>
                  <span>Nombre *</span>
                  <input
                    value={formulario.nombre}
                    onChange={(e) =>
                      setFormulario({
                        ...formulario,
                        nombre: e.target.value,
                      })
                    }
                    placeholder="Ej. Máquinas CNC"
                    autoFocus
                  />
                </label>

                <label style={styles.field}>
                  <span>Código</span>
                  <input
                    value={formulario.codigo}
                    onChange={(e) =>
                      setFormulario({
                        ...formulario,
                        codigo: e.target.value,
                      })
                    }
                    placeholder="Ej. CNC"
                  />
                </label>

                <label style={styles.fieldFull}>
                  <span>Descripción</span>
                  <textarea
                    value={formulario.descripcion}
                    onChange={(e) =>
                      setFormulario({
                        ...formulario,
                        descripcion: e.target.value,
                      })
                    }
                    placeholder="Descripción de la categoría..."
                    rows={3}
                  />
                </label>

                <label style={styles.field}>
                  <span>Categoría padre</span>

                  <select
                    value={
                      formulario.categoria_padre_id
                    }
                    onChange={(e) =>
                      setFormulario({
                        ...formulario,
                        categoria_padre_id:
                          e.target.value,
                      })
                    }
                  >
                    <option value="">
                      Sin categoría padre
                    </option>

                    {padresDisponibles.map(
                      ({ categoria, nivel }) => (
                        <option
                          key={idCategoria(categoria)}
                          value={idCategoria(categoria)}
                        >
                          {'— '.repeat(nivel)}
                          {categoria.nombre}
                        </option>
                      )
                    )}
                  </select>
                </label>

                <label style={styles.field}>
                  <span>Orden</span>
                  <input
                    type="number"
                    value={formulario.orden}
                    onChange={(e) =>
                      setFormulario({
                        ...formulario,
                        orden: e.target.value,
                      })
                    }
                  />
                </label>

                <label style={styles.checkboxField}>
                  <input
                    type="checkbox"
                    checked={Boolean(
                      formulario.activo
                    )}
                    onChange={(e) =>
                      setFormulario({
                        ...formulario,
                        activo: e.target.checked,
                      })
                    }
                  />

                  <span>
                    Categoría activa
                  </span>
                </label>
              </div>

              {error && (
                <div style={styles.formError}>
                  {error}
                </div>
              )}

              <div style={styles.modalActions}>
                <button
                  type="button"
                  onClick={cerrarFormulario}
                  disabled={guardando}
                  style={styles.secondaryButton}
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={guardando}
                  style={styles.primaryButton}
                >
                  {guardando
                    ? 'Guardando...'
                    : editandoId
                      ? 'Guardar cambios'
                      : 'Crear categoría'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}

const styles = {
  section: {
    marginTop: '28px',
  },

  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '16px',
    marginBottom: '18px',
    flexWrap: 'wrap',
  },

  eyebrow: {
    fontSize: '11px',
    fontWeight: 800,
    letterSpacing: '1.2px',
    opacity: 0.55,
    marginBottom: '5px',
  },

  title: {
    margin: 0,
    fontSize: '22px',
  },

  subtitle: {
    margin: '6px 0 0',
    opacity: 0.65,
    fontSize: '14px',
  },

  stats: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '12px',
    marginBottom: '14px',
  },

  stat: {
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '14px 16px',
    background: '#fff',
  },

  statLabel: {
    display: 'block',
    fontSize: '10px',
    fontWeight: 800,
    letterSpacing: '0.8px',
    opacity: 0.55,
    marginBottom: '5px',
  },

  statValue: {
    fontSize: '22px',
  },

  toolbar: {
    display: 'flex',
    gap: '10px',
    marginBottom: '14px',
    flexWrap: 'wrap',
  },

  search: {
    flex: '1 1 280px',
    minWidth: '220px',
    padding: '11px 13px',
    border: '1px solid #d1d5db',
    borderRadius: '9px',
    fontSize: '14px',
  },

  select: {
    padding: '11px 13px',
    border: '1px solid #d1d5db',
    borderRadius: '9px',
    background: '#fff',
    fontSize: '14px',
  },

  primaryButton: {
    border: '0',
    borderRadius: '9px',
    padding: '11px 16px',
    background: '#111827',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
  },

  secondaryButton: {
    border: '1px solid #d1d5db',
    borderRadius: '9px',
    padding: '11px 15px',
    background: '#fff',
    color: '#111827',
    fontWeight: 600,
    cursor: 'pointer',
  },

  tableCard: {
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    background: '#fff',
    overflow: 'hidden',
  },

  tableHeader: {
    display: 'grid',
    gridTemplateColumns:
      '100px minmax(220px, 1.7fr) minmax(150px, 1fr) 100px 70px 100px 180px',
    gap: '12px',
    padding: '12px 14px',
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
    fontSize: '10px',
    fontWeight: 800,
    letterSpacing: '0.6px',
    opacity: 0.6,
    alignItems: 'center',
  },

  tableRow: {
    display: 'grid',
    gridTemplateColumns:
      '100px minmax(220px, 1.7fr) minmax(150px, 1fr) 100px 70px 100px 180px',
    gap: '12px',
    padding: '13px 14px',
    borderBottom: '1px solid #f0f0f0',
    alignItems: 'center',
    fontSize: '13px',
  },

  code: {
    fontWeight: 700,
    fontFamily: 'monospace',
  },

  categoryName: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    fontWeight: 700,
    minWidth: 0,
  },

  treeLine: {
    opacity: 0.4,
    fontWeight: 400,
  },

  cell: {
    opacity: 0.75,
  },

  badgeActive: {
    display: 'inline-block',
    padding: '5px 9px',
    borderRadius: '999px',
    background: '#ecfdf3',
    color: '#166534',
    fontSize: '11px',
    fontWeight: 700,
  },

  badgeInactive: {
    display: 'inline-block',
    padding: '5px 9px',
    borderRadius: '999px',
    background: '#f3f4f6',
    color: '#6b7280',
    fontSize: '11px',
    fontWeight: 700,
  },

  actions: {
    display: 'flex',
    gap: '7px',
    flexWrap: 'wrap',
  },

  actionButton: {
    border: '1px solid #d1d5db',
    borderRadius: '7px',
    padding: '6px 9px',
    background: '#fff',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 600,
  },

  empty: {
    padding: '45px 20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '7px',
    opacity: 0.6,
    textAlign: 'center',
  },

  error: {
    marginBottom: '14px',
    padding: '11px 13px',
    borderRadius: '9px',
    background: '#fef2f2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    fontSize: '13px',
  },

  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.42)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    zIndex: 1000,
  },

  modal: {
    width: 'min(700px, 100%)',
    maxHeight: '90vh',
    overflowY: 'auto',
    background: '#fff',
    borderRadius: '16px',
    padding: '22px',
    boxShadow: '0 25px 70px rgba(0,0,0,0.2)',
  },

  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '20px',
  },

  modalTitle: {
    margin: 0,
    fontSize: '21px',
  },

  closeButton: {
    border: 0,
    background: 'transparent',
    fontSize: '28px',
    cursor: 'pointer',
    lineHeight: 1,
    opacity: 0.6,
  },

  formGrid: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(2, minmax(0, 1fr))',
    gap: '15px',
  },

  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    fontSize: '13px',
    fontWeight: 600,
  },

  fieldFull: {
    gridColumn: '1 / -1',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    fontSize: '13px',
    fontWeight: 600,
  },

  checkboxField: {
    gridColumn: '1 / -1',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    fontWeight: 600,
  },

  formError: {
    marginTop: '15px',
    padding: '10px 12px',
    borderRadius: '8px',
    background: '#fef2f2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    fontSize: '13px',
  },

  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    marginTop: '22px',
  },
}
