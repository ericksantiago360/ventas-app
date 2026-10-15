import { useEffect, useState } from 'react'
import { crmApi } from '../api/client'

const NEGOCIOS = [
  { id: 'santal', label: 'Santal Machinery' },
  { id: 'dulce_tentacion', label: 'Dulce Tentación' },
  { id: 'bienes_raices', label: 'Bienes Raíces' },
  { id: 'diagnostico_plus', label: 'Diagnostico Plus Laboratorio Clinico' },
]

const ETAPAS = [
  ['nuevo', 'Nuevo'],
  ['contactado', 'Contactado'],
  ['calificado', 'Calificado'],
  ['cotizacion', 'Cotización'],
  ['ganado', 'Ganado'],
  ['perdido', 'Perdido'],
]

const emptyCliente = {
  nombre: '',
  empresa: '',
  telefono: '',
  whatsapp: '',
  email: '',
  direccion: '',
  notas: '',
}

const emptyLead = {
  nombre: '',
  empresa: '',
  telefono: '',
  whatsapp: '',
  email: '',
  origen: '',
  valor_estimado: '',
  notas: '',
  etapa: 'nuevo',
}

export default function CRM() {
  const [negocio, setNegocio] = useState('santal')
  const [tab, setTab] = useState('clientes')

  const [clientes, setClientes] = useState([])
  const [leads, setLeads] = useState([])

  const [busqueda, setBusqueda] = useState('')
  const [etapa, setEtapa] = useState('')

  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(emptyCliente)
  const [editId, setEditId] = useState(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    cargar()
  }, [negocio, tab, etapa])

  async function cargar() {
    setLoading(true)
    setError('')

    try {
      if (tab === 'clientes') {
        const res = await crmApi.clientes.listar({
          negocio_id: negocio,
          q: busqueda || undefined,
        })

        setClientes(res.data.data || [])
      } else {
        const res = await crmApi.leads.listar({
          negocio_id: negocio,
          q: busqueda || undefined,
          etapa: etapa || undefined,
        })

        setLeads(res.data.data || [])
      }
    } catch (e) {
      setError(
        e.response?.data?.detail ||
        'No se pudo cargar la información'
      )
    } finally {
      setLoading(false)
    }
  }

  function nuevoCliente() {
    setEditId(null)
    setForm(emptyCliente)
    setModal('cliente')
  }

  function nuevoLead() {
    setEditId(null)
    setForm(emptyLead)
    setModal('lead')
  }

  function editarCliente(cliente) {
    setEditId(cliente._id)
    setForm({
      nombre: cliente.nombre || '',
      empresa: cliente.empresa || '',
      telefono: cliente.telefono || '',
      whatsapp: cliente.whatsapp || '',
      email: cliente.email || '',
      direccion: cliente.direccion || '',
      notas: cliente.notas || '',
    })
    setModal('cliente')
  }

  async function eliminarCliente(cliente) {
    const confirmado = window.confirm(
      `¿Deseas eliminar al cliente "${cliente.nombre}"?`
    )

    if (!confirmado) return

    try {
      setError('')

      await crmApi.clientes.eliminar(cliente._id)

      await cargar()
    } catch (e) {
      console.error(e)
      setError(
        e.response?.data?.detail ||
        'No se pudo eliminar el cliente'
      )
    }
  }

  function editarLead(lead) {
    setEditId(lead._id)
    setForm({
      nombre: lead.nombre || '',
      empresa: lead.empresa || '',
      telefono: lead.telefono || '',
      whatsapp: lead.whatsapp || '',
      email: lead.email || '',
      origen: lead.origen || '',
      valor_estimado: lead.valor_estimado || '',
      notas: lead.notas || '',
      etapa: lead.etapa || 'nuevo',
    })
    setModal('lead')
  }

  async function eliminarLead(lead) {
    const confirmado = window.confirm(
      `¿Deseas eliminar el lead "${lead.nombre}"?`
    )

    if (!confirmado) return

    try {
      setError('')

      await crmApi.leads.eliminar(lead._id)

      await cargar()
    } catch (e) {
      console.error(e)
      setError(
        e.response?.data?.detail ||
        'No se pudo eliminar el lead'
      )
    }
  }

  async function guardar(e) {
    e.preventDefault()
    setError('')

    try {
      if (modal === 'cliente') {
        const body = {
          ...form,
          negocio_id: negocio,
        }

        if (editId) {
          await crmApi.clientes.editar(editId, body)
        } else {
          await crmApi.clientes.crear(body)
        }
      }

      if (modal === 'lead') {
        const body = {
          ...form,
          negocio_id: negocio,
          valor_estimado: form.valor_estimado
            ? Number(form.valor_estimado)
            : 0,
        }

        if (editId) {
          await fetchLeadEditar(editId, body)
        } else {
          await crmApi.leads.crear(body)
        }
      }

      setModal(null)
      setEditId(null)
      await cargar()
    } catch (e) {
      setError(
        e.response?.data?.detail ||
        'No se pudo guardar'
      )
    }
  }

  async function fetchLeadEditar(id, body) {
    await fetch(`/api/crm/leads/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify(body),
    })
  }

  async function cambiarEtapa(lead, nuevaEtapa) {
    try {
      await crmApi.leads.avanzarEtapa(
        lead._id,
        nuevaEtapa
      )

      await cargar()
    } catch (e) {
      setError(
        e.response?.data?.detail ||
        'No se pudo cambiar la etapa'
      )
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

  return (
    <div>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>CRM</h1>
          <p style={styles.subtitle}>
            Clientes y prospectos
          </p>
        </div>

        <select
          value={negocio}
          onChange={e => setNegocio(e.target.value)}
          style={styles.select}
        >
          {NEGOCIOS.map(n => (
            <option key={n.id} value={n.id}>
              {n.label}
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
            setEtapa('')
            setBusqueda('')
          }}
          style={
            tab === 'clientes'
              ? styles.tabActive
              : styles.tab
          }
        >
          Clientes
          <b>{clientes.length}</b>
        </button>

        <button
          onClick={() => {
            setTab('leads')
            setBusqueda('')
          }}
          style={
            tab === 'leads'
              ? styles.tabActive
              : styles.tab
          }
        >
          Leads
          <b>{leads.length}</b>
        </button>
      </div>

      <div style={styles.toolbar}>
        <input
          placeholder={
            tab === 'clientes'
              ? 'Buscar cliente...'
              : 'Buscar prospecto...'
          }
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') cargar()
          }}
          style={styles.search}
        />

        {tab === 'leads' && (
          <select
            value={etapa}
            onChange={e => setEtapa(e.target.value)}
            style={styles.filter}
          >
            <option value="">Todas las etapas</option>
            {ETAPAS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        )}

        <button
          onClick={
            tab === 'clientes'
              ? nuevoCliente
              : nuevoLead
          }
          style={styles.primary}
        >
          + {tab === 'clientes'
            ? 'Nuevo cliente'
            : 'Nuevo lead'}
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
        <Leads
          leads={leads}
          editar={editarLead}
          cambiarEtapa={cambiarEtapa}
          eliminar={eliminarLead}
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
                    : 'lead'}
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

            <div style={styles.grid}>
              {campo('Nombre *', 'nombre')}
              {campo('Empresa', 'empresa')}
              {campo('Teléfono', 'telefono')}
              {campo('WhatsApp', 'whatsapp')}
              {campo('Correo electrónico', 'email')}

              {modal === 'cliente'
                ? campo('Dirección', 'direccion')
                : campo('Origen', 'origen')}

              {modal === 'lead' &&
                campo(
                  'Valor estimado',
                  'valor_estimado',
                  'number'
                )}

              {modal === 'lead' && (
                <label style={styles.field}>
                  <span>Etapa</span>
                  <select
                    value={form.etapa}
                    onChange={e =>
                      setForm({
                        ...form,
                        etapa: e.target.value,
                      })
                    }
                  >
                    {ETAPAS.map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

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
        <div>Cliente</div>
        <div>Contacto</div>
        <div>Empresa</div>
        <div>Acciones</div>
      </div>

      {clientes.map(c => (
        <div key={c._id} style={styles.tr}>
          <div>
            <strong>{c.nombre}</strong>
            {c.email && (
              <small>{c.email}</small>
            )}
          </div>

          <div>
            {c.telefono || c.whatsapp || '—'}
          </div>

          <div>
            {c.empresa || '—'}
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


function Leads({
  leads,
  editar,
  cambiarEtapa, eliminar,
}) {
  if (!leads.length) {
    return (
      <div style={styles.empty}>
        <div style={styles.emptyTitle}>
          No hay leads
        </div>
        <div>
          Registra un nuevo prospecto para comenzar.
        </div>
      </div>
    )
  }

  return (
    <div style={styles.leads}>
      {leads.map(lead => (
        <div
          key={lead._id}
          style={styles.leadCard}
        >
          <div style={styles.leadTop}>
            <div>
              <strong>{lead.nombre}</strong>
              <div style={styles.muted}>
                {lead.empresa || 'Sin empresa'}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                onClick={() => editar(lead)}
                style={styles.action}
              >
                Editar
              </button>

              <button
                onClick={() => eliminar(lead)}
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
              📞 {lead.telefono || 'Sin teléfono'}
            </span>

            <span>
              ✉ {lead.email || 'Sin correo'}
            </span>

            {lead.origen && (
              <span>
                Origen: {lead.origen}
              </span>
            )}

            {lead.valor_estimado > 0 && (
              <span>
                Valor: $
                {Number(
                  lead.valor_estimado
                ).toLocaleString('es-MX')}
              </span>
            )}
          </div>

          <div style={styles.stageRow}>
            {ETAPAS.map(([id, label]) => (
              <button
                key={id}
                onClick={() =>
                  cambiarEtapa(lead, id)
                }
                style={
                  lead.etapa === id
                    ? styles.stageActive
                    : styles.stage
                }
              >
                {label}
              </button>
            ))}
          </div>
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

  stageRow: {
    display: 'flex',
    gap: 5,
    flexWrap: 'wrap',
    marginTop: 16,
  },

  stage: {
    padding: '6px 9px',
    border: '1px solid #cbd5e1',
    background: '#fff',
    borderRadius: 6,
    color: '#64748b',
    fontSize: 12,
    cursor: 'pointer',
  },

  stageActive: {
    padding: '6px 9px',
    border: '1px solid #2563eb',
    background: '#eff6ff',
    borderRadius: 6,
    color: '#2563eb',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 600,
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
    zIndex: 100,
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
