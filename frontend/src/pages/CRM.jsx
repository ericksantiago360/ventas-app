import { useEffect, useState } from 'react'
import { crmApi } from '../api/client'
import { useNegocio } from '../context/NegocioContext'

const CANALES = [
  ['whatsapp', 'WhatsApp'],
  ['referido', 'Referido'],
  ['instagram', 'Instagram'],
  ['directo', 'Directo'],
  ['visita', 'Visita'],
  ['otro', 'Otro'],
]

const TIPOS_LEAD = [
  ['propietario', 'Propietario'],
  ['comprador', 'Comprador'],
  ['arrendatario', 'Arrendatario'],
]

const emptyCliente = {
  empresa: '',
  contacto: '',
  telefono: '',
  correo: '',
  canal_origen: 'directo',
  notas: '',
}

const emptyOportunidad = {
  cliente_id: '',
  etapa: '',
  tipo_lead: 'comprador',
  valor_estimado: '',
  fecha_cierre_estimada: '',
}

function mensajeError(e, respaldo) {
  const detalle = e.response?.data?.detail
  return typeof detalle === 'string' ? detalle : respaldo
}

export default function CRM() {
  const { negocioId: negocio, setNegocioId: setNegocio, negociosDisponibles } = useNegocio()
  const [tab, setTab] = useState('clientes')

  const [clientes, setClientes] = useState([])
  const [columnas, setColumnas] = useState([])

  const [busqueda, setBusqueda] = useState('')
  const [tipoLead, setTipoLead] = useState('comprador')

  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(emptyCliente)
  const [editId, setEditId] = useState(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const esBR = negocio === 'bienes_raices'
  const etapas = columnas.map(c => c.etapa)
  const totalOportunidades = columnas.reduce((n, c) => n + c.oportunidades.length, 0)
  const clientesPorId = Object.fromEntries(clientes.map(c => [c._id, c]))

  useEffect(() => {
    cargar()
  }, [negocio, tab, tipoLead])

  async function cargar() {
    setLoading(true)
    setError('')

    try {
      if (tab === 'clientes') {
        const res = await crmApi.clientes.listar({
          negocio_id: negocio,
          q: busqueda || undefined,
          limit: 100,
        })

        setClientes(res.data.data || [])
      } else {
        const [resClientes, resKanban] = await Promise.all([
          crmApi.clientes.listar({ negocio_id: negocio, limit: 100 }),
          crmApi.oportunidades.kanban(negocio, esBR ? tipoLead : null),
        ])

        setClientes(resClientes.data.data || [])
        setColumnas(resKanban.data.data || [])
      }
    } catch (e) {
      setError(mensajeError(e, 'No se pudo cargar la información'))
    } finally {
      setLoading(false)
    }
  }

  function nuevoCliente() {
    setEditId(null)
    setForm(emptyCliente)
    setModal('cliente')
  }

  function nuevaOportunidad() {
    if (!clientes.length) {
      setError('Primero registra un cliente en la pestaña Clientes')
      return
    }

    setEditId(null)
    setForm({
      ...emptyOportunidad,
      cliente_id: clientes[0]._id,
      etapa: etapas[0] || '',
      tipo_lead: tipoLead,
    })
    setModal('oportunidad')
  }

  function editarCliente(cliente) {
    setEditId(cliente._id)
    setForm({
      empresa: cliente.empresa || '',
      contacto: cliente.contacto || '',
      telefono: cliente.telefono || '',
      correo: cliente.correo || '',
      canal_origen: cliente.canal_origen || 'directo',
      notas: cliente.notas || '',
    })
    setModal('cliente')
  }

  async function eliminarCliente(cliente) {
    const confirmado = window.confirm(
      `¿Deseas eliminar al cliente "${cliente.empresa}"?`
    )

    if (!confirmado) return

    try {
      setError('')

      await crmApi.clientes.eliminar(cliente._id)

      await cargar()
    } catch (e) {
      console.error(e)
      setError(mensajeError(e, 'No se pudo eliminar el cliente'))
    }
  }

  function editarOportunidad(op) {
    setEditId(op._id)
    setForm({
      ...emptyOportunidad,
      valor_estimado: op.valor_estimado || '',
      fecha_cierre_estimada: fechaCorta(op.fecha_cierre_estimada),
    })
    setModal('oportunidad')
  }

  async function eliminarOportunidad(op) {
    const cliente = clientesPorId[op.cliente_id]
    const confirmado = window.confirm(
      `¿Deseas eliminar la oportunidad de "${cliente?.empresa || 'este cliente'}"?`
    )

    if (!confirmado) return

    try {
      setError('')

      await crmApi.oportunidades.eliminar(op._id)

      await cargar()
    } catch (e) {
      console.error(e)
      setError(mensajeError(e, 'No se pudo eliminar la oportunidad'))
    }
  }

  async function guardar(e) {
    e.preventDefault()
    setError('')

    try {
      if (modal === 'cliente') {
        const body = {
          ...form,
          correo: form.correo || null,
        }

        if (editId) {
          await crmApi.clientes.editar(editId, body)
        } else {
          const res = await crmApi.clientes.crear(body)

          if (res.data.duplicate_warning) {
            setError(res.data.mensaje || 'Ya existe un cliente con esta empresa y teléfono')
            return
          }
        }
      }

      if (modal === 'oportunidad') {
        const valor = form.valor_estimado === '' ? null : Number(form.valor_estimado)
        const fecha = form.fecha_cierre_estimada || null

        if (editId) {
          await crmApi.oportunidades.editar(editId, {
            valor_estimado: valor,
            fecha_cierre_estimada: fecha,
          })
        } else {
          await crmApi.oportunidades.crear({
            cliente_id: form.cliente_id,
            negocio_id: negocio,
            etapa: form.etapa,
            tipo_lead: esBR ? form.tipo_lead : null,
            valor_estimado: valor,
            fecha_cierre_estimada: fecha,
          })
        }
      }

      setModal(null)
      setEditId(null)
      await cargar()
    } catch (e) {
      setError(mensajeError(e, 'No se pudo guardar'))
    }
  }

  async function cambiarEtapa(op, nuevaEtapa) {
    try {
      setError('')

      await crmApi.oportunidades.moverEtapa(op._id, nuevaEtapa)

      await cargar()
    } catch (e) {
      setError(mensajeError(e, 'No se pudo cambiar la etapa'))
    }
  }

  function campo(label, name, type = 'text') {
    return (
      <label style={styles.field}>
        <span>{label}</span>
        <input
          type={type}
          value={form[name] ?? ''}
          onChange={e =>
            setForm({
              ...form,
              [name]: e.target.value,
            })
          }
        />
      </label>
    )
  }

  function selector(label, name, opciones) {
    return (
      <label style={styles.field}>
        <span>{label}</span>
        <select
          value={form[name] ?? ''}
          onChange={e =>
            setForm({
              ...form,
              [name]: e.target.value,
            })
          }
        >
          {opciones.map(([id, texto]) => (
            <option key={id} value={id}>
              {texto}
            </option>
          ))}
        </select>
      </label>
    )
  }

  return (
    <div>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>CRM</h1>
          <p style={styles.subtitle}>
            Clientes y oportunidades
          </p>
        </div>

        <select
          value={negocio}
          onChange={e => setNegocio(e.target.value)}
          style={styles.select}
        >
          {negociosDisponibles.map(n => (
            <option key={n.id} value={n.id}>
              {n.nombre}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div style={styles.error}>
          {error}
        </div>
      )}

      <div style={styles.tabs}>
        <button
          onClick={() => {
            setTab('clientes')
            setBusqueda('')
          }}
          style={
            tab === 'clientes'
              ? styles.tabActive
              : styles.tab
          }
        >
          Clientes
          <b>{tab === 'clientes' ? clientes.length : ''}</b>
        </button>

        <button
          onClick={() => {
            setTab('oportunidades')
            setBusqueda('')
          }}
          style={
            tab === 'oportunidades'
              ? styles.tabActive
              : styles.tab
          }
        >
          Oportunidades
          <b>{tab === 'oportunidades' ? totalOportunidades : ''}</b>
        </button>
      </div>

      <div style={styles.toolbar}>
        {tab === 'clientes' ? (
          <input
            placeholder="Buscar cliente..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') cargar()
            }}
            style={styles.search}
          />
        ) : esBR ? (
          <select
            value={tipoLead}
            onChange={e => setTipoLead(e.target.value)}
            style={styles.filter}
          >
            {TIPOS_LEAD.map(([id, texto]) => (
              <option key={id} value={id}>
                {texto}
              </option>
            ))}
          </select>
        ) : (
          <div style={{ flex: 1 }} />
        )}

        <button
          onClick={
            tab === 'clientes'
              ? nuevoCliente
              : nuevaOportunidad
          }
          style={styles.primary}
        >
          + {tab === 'clientes'
            ? 'Nuevo cliente'
            : 'Nueva oportunidad'}
        </button>
      </div>

      {loading ? (
        <div style={styles.empty}>
          Cargando...
        </div>
      ) : tab === 'clientes' ? (
        <Clientes
          clientes={clientes}
          editar={editarCliente}
          eliminar={eliminarCliente}
        />
      ) : (
        <Oportunidades
          columnas={columnas}
          clientesPorId={clientesPorId}
          editar={editarOportunidad}
          cambiarEtapa={cambiarEtapa}
          eliminar={eliminarOportunidad}
        />
      )}

      {modal && (
        <div style={styles.overlay}>
          <form
            onSubmit={guardar}
            style={styles.modal}
          >
            <div style={styles.modalHeader}>
              <div>
                <h2 style={styles.modalTitle}>
                  {editId
                    ? 'Editar'
                    : 'Nuevo'}{' '}
                  {modal === 'cliente'
                    ? 'cliente'
                    : 'oportunidad'}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setModal(null)}
                style={styles.close}
              >
                ×
              </button>
            </div>

            {modal === 'cliente' && (
              <div style={styles.grid}>
                {campo('Empresa *', 'empresa')}
                {campo('Contacto', 'contacto')}
                {campo('Teléfono *', 'telefono')}
                {campo('Correo electrónico', 'correo', 'email')}
                {selector('Canal de origen', 'canal_origen', CANALES)}
              </div>
            )}

            {modal === 'oportunidad' && (
              <div style={styles.grid}>
                {!editId && (
                  selector(
                    'Cliente *',
                    'cliente_id',
                    clientes.map(c => [c._id, c.empresa])
                  )
                )}

                {!editId && etapas.length > 0 && selector(
                  'Etapa *',
                  'etapa',
                  etapas.map(e => [e, e])
                )}

                {!editId && esBR && selector('Tipo *', 'tipo_lead', TIPOS_LEAD)}

                {campo('Valor estimado', 'valor_estimado', 'number')}
                {campo('Fecha de cierre estimada', 'fecha_cierre_estimada', 'date')}
              </div>
            )}

            {modal === 'cliente' && (
              <label style={styles.field}>
                <span>Notas</span>
                <textarea
                  rows="4"
                  value={form.notas}
                  onChange={e =>
                    setForm({
                      ...form,
                      notas: e.target.value,
                    })
                  }
                />
              </label>
            )}

            <div style={styles.actions}>
              <button
                type="button"
                onClick={() => setModal(null)}
                style={styles.cancel}
              >
                Cancelar
              </button>

              <button
                type="submit"
                style={styles.primary}
              >
                Guardar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}


function fechaCorta(valor) {
  return valor ? String(valor).slice(0, 10) : ''
}


function Clientes({ clientes, editar, eliminar }) {
  if (!clientes.length) {
    return (
      <div style={styles.empty}>
        <div style={styles.emptyTitle}>
          No hay clientes
        </div>
        <div>
          Crea el primer cliente para este negocio.
        </div>
      </div>
    )
  }

  return (
    <div style={styles.table}>
      <div style={styles.thead}>
        <div>Empresa</div>
        <div>Contacto</div>
        <div>Teléfono</div>
        <div>Acciones</div>
      </div>

      {clientes.map(c => (
        <div key={c._id} style={styles.tr}>
          <div>
            <strong>{c.empresa}</strong>
            {c.correo && (
              <small>{c.correo}</small>
            )}
          </div>

          <div>
            {c.contacto || '—'}
          </div>

          <div>
            {c.telefono || '—'}
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={() => editar(c)}
              style={styles.action}
            >
              Editar
            </button>

            <button
              onClick={() => eliminar(c)}
              style={{
                ...styles.action,
                color: '#dc2626',
                borderColor: '#fecaca',
                background: '#fff',
              }}
            >
              Eliminar
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}


function Oportunidades({
  columnas,
  clientesPorId,
  editar,
  cambiarEtapa,
  eliminar,
}) {
  const total = columnas.reduce((n, c) => n + c.oportunidades.length, 0)

  if (!total) {
    return (
      <div style={styles.empty}>
        <div style={styles.emptyTitle}>
          No hay oportunidades abiertas
        </div>
        <div>
          Registra una oportunidad para un cliente existente.
        </div>
      </div>
    )
  }

  return (
    <div style={styles.leads}>
      {columnas.map(columna => (
        <div key={columna.etapa}>
          <div style={styles.colTitle}>
            {columna.etapa} · {columna.oportunidades.length}
          </div>

          {columna.oportunidades.map(op => {
            const cliente = clientesPorId[op.cliente_id]

            return (
              <div
                key={op._id}
                style={{ ...styles.leadCard, marginBottom: 12 }}
              >
                <div style={styles.leadTop}>
                  <div>
                    <strong>{cliente?.empresa || 'Cliente no disponible'}</strong>
                    <div style={styles.muted}>
                      {cliente?.contacto || 'Sin contacto'}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      onClick={() => editar(op)}
                      style={styles.action}
                    >
                      Editar
                    </button>

                    <button
                      onClick={() => eliminar(op)}
                      style={{
                        ...styles.action,
                        color: '#dc2626',
                        borderColor: '#fecaca',
                        background: '#fff',
                      }}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>

                <div style={styles.leadInfo}>
                  <span>
                    📞 {cliente?.telefono || 'Sin teléfono'}
                  </span>

                  <span>
                    ✉ {cliente?.correo || 'Sin correo'}
                  </span>

                  {op.valor_estimado > 0 && (
                    <span>
                      Valor: $
                      {Number(
                        op.valor_estimado
                      ).toLocaleString('es-MX')}
                    </span>
                  )}

                  {op.fecha_cierre_estimada && (
                    <span>
                      Cierre: {fechaCorta(op.fecha_cierre_estimada)}
                    </span>
                  )}
                </div>

                <div style={{ marginTop: 14 }}>
                  <select
                    value={op.etapa}
                    onChange={e =>
                      cambiarEtapa(op, e.target.value)
                    }
                    style={styles.filter}
                  >
                    {columnas.map(c => (
                      <option key={c.etapa} value={c.etapa}>
                        {c.etapa}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}


const styles = {
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },

  title: {
    margin: 0,
    fontSize: 28,
    color: '#1e293b',
  },

  subtitle: {
    margin: '5px 0 0',
    color: '#64748b',
  },

  select: {
    padding: '10px 14px',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: '#fff',
    fontSize: 14,
  },

  error: {
    background: '#fef2f2',
    color: '#b91c1c',
    border: '1px solid #fecaca',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },

  tabs: {
    display: 'flex',
    gap: 4,
    borderBottom: '1px solid #e2e8f0',
  },

  tab: {
    padding: '12px 18px',
    border: 0,
    background: 'transparent',
    color: '#64748b',
    cursor: 'pointer',
    fontSize: 14,
  },

  tabActive: {
    padding: '12px 18px',
    border: 0,
    borderBottom: '2px solid #2563eb',
    background: 'transparent',
    color: '#1e293b',
    cursor: 'pointer',
    fontSize: 14,
  },

  toolbar: {
    display: 'flex',
    gap: 10,
    margin: '20px 0',
  },

  search: {
    flex: 1,
    padding: '11px 14px',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    fontSize: 14,
  },

  filter: {
    padding: '11px 14px',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: '#fff',
  },

  primary: {
    padding: '10px 16px',
    border: 0,
    borderRadius: 8,
    background: '#2563eb',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 500,
  },

  table: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    overflow: 'hidden',
  },

  thead: {
    display: 'grid',
    gridTemplateColumns: '2fr 1.5fr 1.5fr 100px',
    padding: '12px 16px',
    background: '#f8fafc',
    color: '#64748b',
    fontSize: 12,
    fontWeight: 600,
  },

  tr: {
    display: 'grid',
    gridTemplateColumns: '2fr 1.5fr 1.5fr 100px',
    padding: '15px 16px',
    borderTop: '1px solid #e2e8f0',
    alignItems: 'center',
    fontSize: 14,
    color: '#334155',
  },

    "tr small": {
    display: 'block',
  },

  action: {
    padding: '6px 10px',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    background: '#fff',
    color: '#475569',
    cursor: 'pointer',
  },

  leads: {
    display: 'grid',
    gap: 12,
  },

  colTitle: {
    fontWeight: 600,
    color: '#334155',
    fontSize: 14,
    margin: '8px 0',
  },

  leadCard: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: 18,
  },

  leadTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },

  muted: {
    color: '#64748b',
    fontSize: 13,
    marginTop: 4,
  },

  leadInfo: {
    display: 'flex',
    gap: 18,
    flexWrap: 'wrap',
    color: '#64748b',
    fontSize: 13,
    marginTop: 14,
  },

  empty: {
    padding: 60,
    textAlign: 'center',
    color: '#94a3b8',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
  },

  emptyTitle: {
    color: '#334155',
    fontWeight: 600,
    marginBottom: 6,
  },

  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15,23,42,.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 1000,
  },

  modal: {
    width: 'min(700px, 100%)',
    maxHeight: '90vh',
    overflow: 'auto',
    background: '#fff',
    borderRadius: 12,
    padding: 24,
    boxShadow: '0 20px 50px rgba(0,0,0,.2)',
  },

  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },

  modalTitle: {
    margin: 0,
    color: '#1e293b',
  },

  close: {
    border: 0,
    background: 'transparent',
    fontSize: 28,
    color: '#64748b',
    cursor: 'pointer',
  },

  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 14,
  },

  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginBottom: 14,
    color: '#475569',
    fontSize: 13,
  },

  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 10,
  },

  cancel: {
    padding: '10px 16px',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: '#fff',
    color: '#475569',
    cursor: 'pointer',
  },
}
