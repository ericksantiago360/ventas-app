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
  sku: '',
  nombre: '',
  precio: '',
  costo: '',
  activo: true,
  atributos: {},
  metadata: {},
}

function idProducto(producto) {
  return String(producto?._id ?? producto?.id ?? '')
}

function idVariante(variante) {
  return String(variante?._id ?? variante?.id ?? '')
}

function textoAtributos(atributos) {
  if (!atributos || typeof atributos !== 'object') {
    return '—'
  }

  const entradas = Object.entries(atributos)

  if (!entradas.length) {
    return '—'
  }

  return entradas
    .map(([clave, valor]) => `${clave}: ${Array.isArray(valor) ? valor.join(', ') : valor}`)
    .join(' · ')
}

export default function VariantesProducto({
  negocioId,
  producto,
  abierto,
  onClose,
}) {
  const [variantes, setVariantes] = useState([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [editandoId, setEditandoId] = useState(null)
  const [guardando, setGuardando] = useState(false)

  const [formulario, setFormulario] = useState(formularioInicial)

  const [atributoClave, setAtributoClave] = useState('')
  const [atributoValor, setAtributoValor] = useState('')

  const [metadataClave, setMetadataClave] = useState('')
  const [metadataValor, setMetadataValor] = useState('')

  const productoId = producto ? idProducto(producto) : ''

  const cargarVariantes = async () => {
    if (!productoId || !negocioId) return

    try {
      setCargando(true)
      setError('')

      const response = await api.get(
        `/api/catalogo/productos/${productoId}/variantes`,
        {
          params: {
            negocio_id: negocioId,
          },
        }
      )

      setVariantes(response.data?.data || [])
    } catch (err) {
      console.error(err)

      setError(
        err.response?.data?.detail ||
        'No fue posible cargar las variantes.'
      )
    } finally {
      setCargando(false)
    }
  }

  const abrirNueva = () => {
    setEditandoId(null)
    setFormulario(formularioInicial)
    setAtributoClave('')
    setAtributoValor('')
    setMetadataClave('')
    setMetadataValor('')
    setError('')
    setMostrarFormulario(true)
  }

  const abrirEditar = (variante) => {
    setEditandoId(idVariante(variante))

    setFormulario({
      sku: variante.sku || '',
      nombre: variante.nombre || '',
      precio: variante.precio ?? '',
      costo: variante.costo ?? '',
      activo: variante.activo !== false,
      atributos: variante.atributos || {},
      metadata: variante.metadata || {},
    })

    setAtributoClave('')
    setAtributoValor('')
    setMetadataClave('')
    setMetadataValor('')
    setError('')
    setMostrarFormulario(true)
  }

  const cerrarFormulario = () => {
    if (guardando) return

    setMostrarFormulario(false)
    setEditandoId(null)
    setFormulario(formularioInicial)
  }

  const agregarAtributo = () => {
    const clave = atributoClave.trim()

    if (!clave) return

    setFormulario((actual) => ({
      ...actual,
      atributos: {
        ...actual.atributos,
        [clave]: atributoValor.trim(),
      },
    }))

    setAtributoClave('')
    setAtributoValor('')
  }

  const eliminarAtributo = (clave) => {
    setFormulario((actual) => {
      const atributos = { ...actual.atributos }
      delete atributos[clave]

      return {
        ...actual,
        atributos,
      }
    })
  }

  const agregarMetadata = () => {
    const clave = metadataClave.trim()

    if (!clave) return

    setFormulario((actual) => ({
      ...actual,
      metadata: {
        ...actual.metadata,
        [clave]: metadataValor.trim(),
      },
    }))

    setMetadataClave('')
    setMetadataValor('')
  }

  const eliminarMetadata = (clave) => {
    setFormulario((actual) => {
      const metadata = { ...actual.metadata }
      delete metadata[clave]

      return {
        ...actual,
        metadata,
      }
    })
  }

  const guardar = async (e) => {
    e.preventDefault()

    if (!productoId) {
      setError('No se encontró el producto.')
      return
    }

    if (!formulario.sku.trim()) {
      setError('El SKU de la variante es obligatorio.')
      return
    }

    if (!formulario.nombre.trim()) {
      setError('El nombre de la variante es obligatorio.')
      return
    }

    try {
      setGuardando(true)
      setError('')

      const payload = {
        negocio_id: negocioId,
        sku: formulario.sku.trim(),
        nombre: formulario.nombre.trim(),
        atributos: formulario.atributos,
        precio:
          formulario.precio === ''
            ? null
            : Number(formulario.precio),
        costo:
          formulario.costo === ''
            ? null
            : Number(formulario.costo),
        activo: Boolean(formulario.activo),
        metadata: formulario.metadata,
      }

      if (editandoId) {
        await api.put(
          `/api/catalogo/variantes/${editandoId}`,
          payload
        )
      } else {
        await api.post(
          `/api/catalogo/productos/${productoId}/variantes`,
          payload
        )
      }

      cerrarFormulario()
      await cargarVariantes()
    } catch (err) {
      console.error(err)

      setError(
        err.response?.data?.detail ||
        'No fue posible guardar la variante.'
      )
    } finally {
      setGuardando(false)
    }
  }

  const cambiarEstado = async (variante) => {
    const id = idVariante(variante)

    if (!id) return

    try {
      setError('')

      await api.put(
        `/api/catalogo/variantes/${id}`,
        {
          negocio_id: negocioId,
          activo: variante.activo === false,
        }
      )

      await cargarVariantes()
    } catch (err) {
      console.error(err)

      setError(
        err.response?.data?.detail ||
        'No fue posible cambiar el estado.'
      )
    }
  }

  useMemo(() => {
    if (abierto) {
      cargarVariantes()
    }
  }, [abierto, productoId, negocioId])

  if (!abierto || !producto) {
    return null
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <div>
            <div style={styles.eyebrow}>
              VARIANTES DE PRODUCTO
            </div>

            <h2 style={styles.title}>
              {producto.nombre}
            </h2>

            <div style={styles.productInfo}>
              Código: {producto.codigo || '—'}
              {' · '}
              SKU: {producto.sku || '—'}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={styles.close}
          >
            ×
          </button>
        </div>

        {error && (
          <div style={styles.error}>
            {error}
          </div>
        )}

        <div style={styles.toolbar}>
          <div style={styles.summary}>
            <strong>{variantes.length}</strong>
            <span>
              {variantes.length === 1
                ? ' variante'
                : ' variantes'}
            </span>
          </div>

          <button
            type="button"
            onClick={abrirNueva}
            style={styles.primaryButton}
          >
            + Nueva variante
          </button>
        </div>

        <div style={styles.tableCard}>
          <div style={styles.tableHeader}>
            <div>SKU</div>
            <div>VARIANTE</div>
            <div>ATRIBUTOS</div>
            <div>COSTO</div>
            <div>PRECIO</div>
            <div>ESTADO</div>
            <div>ACCIONES</div>
          </div>

          {cargando ? (
            <div style={styles.empty}>
              Cargando variantes...
            </div>
          ) : variantes.length === 0 ? (
            <div style={styles.empty}>
              <strong>
                Este producto todavía no tiene variantes.
              </strong>

              <span>
                Crea la primera variante para manejar
                diferentes configuraciones del producto.
              </span>
            </div>
          ) : (
            variantes.map((variante) => (
              <div
                key={idVariante(variante)}
                style={styles.tableRow}
              >
                <div style={styles.sku}>
                  {variante.sku || '—'}
                </div>

                <div style={styles.name}>
                  {variante.nombre || '—'}
                </div>

                <div style={styles.attributes}>
                  {textoAtributos(variante.atributos)}
                </div>

                <div>
                  {variante.costo == null
                    ? '—'
                    : Number(variante.costo).toLocaleString(
                        'es-MX',
                        {
                          style: 'currency',
                          currency:
                            producto.moneda || 'MXN',
                        }
                      )}
                </div>

                <div style={styles.price}>
                  {variante.precio == null
                    ? '—'
                    : Number(variante.precio).toLocaleString(
                        'es-MX',
                        {
                          style: 'currency',
                          currency:
                            producto.moneda || 'MXN',
                        }
                      )}
                </div>

                <div>
                  <span
                    style={
                      variante.activo === false
                        ? styles.badgeInactive
                        : styles.badgeActive
                    }
                  >
                    {variante.activo === false
                      ? 'Inactiva'
                      : 'Activa'}
                  </span>
                </div>

                <div style={styles.actions}>
                  <button
                    type="button"
                    onClick={() =>
                      abrirEditar(variante)
                    }
                    style={styles.actionButton}
                  >
                    Editar
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      cambiarEstado(variante)
                    }
                    style={styles.actionButton}
                  >
                    {variante.activo === false
                      ? 'Activar'
                      : 'Desactivar'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {mostrarFormulario && (
          <div style={styles.formOverlay}>
            <div style={styles.formModal}>
              <div style={styles.formHeader}>
                <div>
                  <div style={styles.eyebrow}>
                    {editandoId
                      ? 'EDITAR VARIANTE'
                      : 'NUEVA VARIANTE'}
                  </div>

                  <h3 style={styles.formTitle}>
                    {editandoId
                      ? 'Editar variante'
                      : 'Crear variante'}
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={cerrarFormulario}
                  style={styles.close}
                >
                  ×
                </button>
              </div>

              <form onSubmit={guardar}>
                <div style={styles.formGrid}>
                  <label style={styles.field}>
                    <span>SKU *</span>

                    <input
                      value={formulario.sku}
                      onChange={(e) =>
                        setFormulario({
                          ...formulario,
                          sku: e.target.value,
                        })
                      }
                      placeholder="Ej. SAN-CNC-R-001-A"
                    />
                  </label>

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
                      placeholder="Ej. Área 1300 mm"
                    />
                  </label>

                  <label style={styles.field}>
                    <span>Costo</span>

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formulario.costo}
                      onChange={(e) =>
                        setFormulario({
                          ...formulario,
                          costo: e.target.value,
                        })
                      }
                      placeholder="0.00"
                    />
                  </label>

                  <label style={styles.field}>
                    <span>Precio</span>

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formulario.precio}
                      onChange={(e) =>
                        setFormulario({
                          ...formulario,
                          precio: e.target.value,
                        })
                      }
                      placeholder="0.00"
                    />
                  </label>

                  <div style={styles.fieldFull}>
                    <span>ATRIBUTOS</span>

                    <div style={styles.addRow}>
                      <input
                        value={atributoClave}
                        onChange={(e) =>
                          setAtributoClave(
                            e.target.value
                          )
                        }
                        placeholder="Atributo: color"
                      />

                      <input
                        value={atributoValor}
                        onChange={(e) =>
                          setAtributoValor(
                            e.target.value
                          )
                        }
                        placeholder="Valor: rojo"
                      />

                      <button
                        type="button"
                        onClick={agregarAtributo}
                        style={styles.secondaryButton}
                      >
                        + Agregar
                      </button>
                    </div>

                    <div style={styles.tags}>
                      {Object.entries(
                        formulario.atributos
                      ).map(([clave, valor]) => (
                        <div
                          key={clave}
                          style={styles.tag}
                        >
                          <strong>{clave}:</strong>{' '}
                          {String(valor)}

                          <button
                            type="button"
                            onClick={() =>
                              eliminarAtributo(clave)
                            }
                            style={styles.tagRemove}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={styles.fieldFull}>
                    <span>METADATA</span>

                    <div style={styles.addRow}>
                      <input
                        value={metadataClave}
                        onChange={(e) =>
                          setMetadataClave(
                            e.target.value
                          )
                        }
                        placeholder="Campo: fabricante"
                      />

                      <input
                        value={metadataValor}
                        onChange={(e) =>
                          setMetadataValor(
                            e.target.value
                          )
                        }
                        placeholder="Valor: INTEGRA"
                      />

                      <button
                        type="button"
                        onClick={agregarMetadata}
                        style={styles.secondaryButton}
                      >
                        + Agregar
                      </button>
                    </div>

                    <div style={styles.tags}>
                      {Object.entries(
                        formulario.metadata
                      ).map(([clave, valor]) => (
                        <div
                          key={clave}
                          style={styles.tag}
                        >
                          <strong>{clave}:</strong>{' '}
                          {String(valor)}

                          <button
                            type="button"
                            onClick={() =>
                              eliminarMetadata(clave)
                            }
                            style={styles.tagRemove}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <label style={styles.checkbox}>
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
                      Variante activa
                    </span>
                  </label>
                </div>

                <div style={styles.formActions}>
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
                        : 'Crear variante'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.48)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    zIndex: 1100,
  },

  modal: {
    width: 'min(1200px, 100%)',
    maxHeight: '92vh',
    overflowY: 'auto',
    background: '#fff',
    borderRadius: '16px',
    boxShadow: '0 30px 90px rgba(0,0,0,0.25)',
    padding: '22px',
  },

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '20px',
    alignItems: 'flex-start',
    marginBottom: '20px',
  },

  eyebrow: {
    fontSize: '10px',
    fontWeight: 800,
    letterSpacing: '1px',
    opacity: 0.55,
    marginBottom: '5px',
  },

  title: {
    margin: 0,
    fontSize: '22px',
  },

  productInfo: {
    marginTop: '6px',
    fontSize: '13px',
    opacity: 0.6,
  },

  close: {
    border: 0,
    background: 'transparent',
    fontSize: '30px',
    lineHeight: 1,
    cursor: 'pointer',
    opacity: 0.55,
  },

  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '14px',
    flexWrap: 'wrap',
  },

  summary: {
    display: 'flex',
    gap: '5px',
    alignItems: 'baseline',
    fontSize: '14px',
    opacity: 0.7,
  },

  primaryButton: {
    border: 0,
    borderRadius: '9px',
    padding: '10px 15px',
    background: '#111827',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
  },

  secondaryButton: {
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    padding: '9px 12px',
    background: '#fff',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },

  tableCard: {
    border: '1px solid #e5e7eb',
    borderRadius: '11px',
    overflowX: 'auto',
  },

  tableHeader: {
    minWidth: '1000px',
    display: 'grid',
    gridTemplateColumns:
      '150px 1.2fr 2fr 120px 120px 100px 170px',
    gap: '12px',
    padding: '11px 13px',
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
    fontSize: '10px',
    fontWeight: 800,
    letterSpacing: '.6px',
    opacity: .6,
  },

  tableRow: {
    minWidth: '1000px',
    display: 'grid',
    gridTemplateColumns:
      '150px 1.2fr 2fr 120px 120px 100px 170px',
    gap: '12px',
    padding: '13px',
    borderBottom: '1px solid #f0f0f0',
    alignItems: 'center',
    fontSize: '13px',
  },

  sku: {
    fontFamily: 'monospace',
    fontWeight: 700,
  },

  name: {
    fontWeight: 700,
  },

  attributes: {
    opacity: .72,
    lineHeight: 1.4,
  },

  price: {
    fontWeight: 700,
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
    opacity: .6,
    textAlign: 'center',
  },

  error: {
    marginBottom: '14px',
    padding: '10px 12px',
    borderRadius: '8px',
    background: '#fef2f2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    fontSize: '13px',
  },

  formOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    zIndex: 1200,
  },

  formModal: {
    width: 'min(760px, 100%)',
    maxHeight: '90vh',
    overflowY: 'auto',
    background: '#fff',
    borderRadius: '15px',
    padding: '22px',
    boxShadow: '0 25px 80px rgba(0,0,0,.25)',
  },

  formHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '20px',
  },

  formTitle: {
    margin: 0,
    fontSize: '20px',
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
    gap: '7px',
    fontSize: '13px',
    fontWeight: 600,
  },

  addRow: {
    display: 'grid',
    gridTemplateColumns:
      '1fr 1fr auto',
    gap: '8px',
  },

  tags: {
    display: 'flex',
    gap: '7px',
    flexWrap: 'wrap',
    marginTop: '3px',
  },

  tag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '7px 9px',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    background: '#f9fafb',
    fontSize: '12px',
  },

  tagRemove: {
    border: 0,
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '16px',
    lineHeight: 1,
    opacity: .55,
  },

  checkbox: {
    gridColumn: '1 / -1',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    fontWeight: 600,
  },

  formActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    marginTop: '22px',
  },
}
