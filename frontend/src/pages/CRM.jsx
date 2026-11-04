import { useEffect, useState } from 'react'
import { crmApi } from '../api/client'
import { useNegocio } from '../context/NegocioContext'
import VentaRapida from '../components/VentaRapida'
import { AvisoEdicion, BadgeEdicion, estiloCabeceraEdicion, estiloPanelEdicion } from '../components/ModoEdicion'
import { useSmartDefaults, elegirClaves, completarVacios, setLastUsed } from '../hooks/useSmartDefaults'

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
  const { defaultsCliente } = useSmartDefaults()
  const [tab, setTab] = useState('clientes')

  const [clientes, setClientes] = useState([])
  const [columnas, setColumnas] = useState([])

  const [busqueda, setBusqueda] = useState('')
  const [tipoLead, setTipoLead] = useState('comprador')

  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(emptyCliente)
  const [editId, setEditId] = useState(null)

  const [loading, setLoading] = useState(false)
  const [clienteVenta, setClienteVenta] = useState(null)
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
    setForm(elegirClaves(defaultsCliente(), Object.keys(emptyCliente)))
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
    setForm(completarVacios(
      elegirClaves(defaultsCliente(), Object.keys(emptyCliente)),
      {
        empresa: cliente.empresa || '',
        contacto: cliente.contacto || '',
        telefono: cliente.telefono || '',
        correo: cliente.correo || '',
        canal_origen: cliente.canal_origen || '',
        notas: cliente.notas || '',
      },
    ))
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
        setLastUsed('cliente_canal_origen', form.canal_origen)
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

  // Arrastre: la tarjeta cambia de columna al instante y el servidor confirma.
  // Si el servidor rechaza el cambio, se vuelve al tablero anterior.
  async function moverArrastrando(op, nuevaEtapa) {
    const anterior = columnas
    setError('')
    setColumnas(prev => {
      const quitada = prev.map(c => ({
        ...c,
        oportunidades: c.oportunidades.filter(o => o._id !== op._id),
      }))
      return quitada.map(c => c.etapa === nuevaEtapa
        ? { ...c, oportunidades: [{ ...op, etapa: nuevaEtapa }, ...c.oportunidades] }
        : c)
    })

    try {
      await crmApi.oportunidades.moverEtapa(op._id, nuevaEtapa)
      const res = await crmApi.oportunidades.kanban(negocio, esBR ? tipoLead : null)
      setColumnas(res.data.data || [])
    } catch (e) {
      setColumnas(anterior)
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
        </button>
      </div>

      {tab !== 'leads' && (
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
      )}

      {loading ? (
        <div style={styles.empty}>
          Cargando...
        </div>
      ) : tab === 'clientes' ? (
        <Clientes
          key={negocio}
          clientes={clientes}
          editar={editarCliente}
          eliminar={eliminarCliente}
          vender={setClienteVenta}
        />
      ) : tab === 'leads' ? (
        <Leads negocio={negocio} />
      ) : (
        <Oportunidades
          columnas={columnas}
          clientesPorId={clientesPorId}
          editar={editarOportunidad}
          cambiarEtapa={cambiarEtapa}
          moverArrastrando={moverArrastrando}
          eliminar={eliminarOportunidad}
        />
      )}

      {clienteVenta && (
        <VentaRapida
          key={clienteVenta._id}
          negocioId={negocio}
          cliente={clienteVenta}
          onCerrar={() => setClienteVenta(null)}
        />
      )}

      {modal && (
        <div style={styles.overlay}>
          <form
            onSubmit={guardar}
            style={estiloPanelEdicion(Boolean(editId), styles.modal)}
          >
            <div style={estiloCabeceraEdicion(Boolean(editId), styles.modalHeader)}>
              <div>
                {editId && <BadgeEdicion />}
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

            {editId && (
              <AvisoEdicion entidad={modal === 'cliente' ? `el cliente ${form.empresa || ''}`.trim() : 'la oportunidad'} />
            )}

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


function Clientes({ clientes, editar, eliminar, vender }) {
  const [seleccion, setSeleccion] = useState(() => new Set())

  const ids = clientes.map(c => c._id)
  const seleccionados = ids.filter(id => seleccion.has(id)).length
  const todosMarcados = ids.length > 0 && seleccionados === ids.length

  function alternar(id) {
    setSeleccion(prev => {
      const siguiente = new Set(prev)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  // Marca o desmarca solo los clientes visibles; los demás conservan su selección
  function alternarTodos() {
    setSeleccion(prev => todosMarcados
      ? new Set([...prev].filter(id => !ids.includes(id)))
      : new Set([...prev, ...ids]))
  }

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

  const columnas = '36px 2fr 1.5fr 1.5fr 100px'

  return (
    <div>
      {seleccionados > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10,
          padding: '8px 14px', background: '#eff6ff', border: '1px solid #bfdbfe',
          borderRadius: 8, fontSize: 13, color: '#1e3a8a',
        }}>
          <strong>{seleccionados} seleccionado{seleccionados === 1 ? '' : 's'}</strong>
          <button onClick={() => setSeleccion(new Set())} style={{ ...styles.action, marginLeft: 'auto' }}>
            Limpiar selección
          </button>
        </div>
      )}

      <div style={styles.table}>
        <div style={{ ...styles.thead, gridTemplateColumns: columnas }}>
          <div>
            <input
              type="checkbox"
              checked={todosMarcados}
              onChange={alternarTodos}
              aria-label="Seleccionar todos los clientes visibles"
            />
          </div>
          <div>Empresa</div>
          <div>Contacto</div>
          <div>Teléfono</div>
          <div>Acciones</div>
        </div>

        {clientes.map(c => (
          <div
            key={c._id}
            style={{
              ...styles.tr,
              gridTemplateColumns: columnas,
              background: seleccion.has(c._id) ? '#f0f7ff' : '#fff',
            }}
          >
            <div>
              <input
                type="checkbox"
                checked={seleccion.has(c._id)}
                onChange={() => alternar(c._id)}
                aria-label={`Seleccionar ${c.empresa}`}
              />
            </div>

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
                onClick={() => vender(c)}
                style={{ ...styles.action, background: '#0f172a', color: '#fff', borderColor: '#0f172a' }}
              >
                Vender
              </button>

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
    </div>
  )
}


function Oportunidades({
  columnas,
  clientesPorId,
  editar,
  cambiarEtapa,
  moverArrastrando,
  eliminar,
}) {
  const [arrastrando, setArrastrando] = useState(null) // id de la oportunidad que se arrastra
  const [destino, setDestino] = useState(null)         // etapa bajo el cursor
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

  function soltar(columna) {
    const op = columnas
      .flatMap(c => c.oportunidades)
      .find(o => o._id === arrastrando)
    setArrastrando(null)
    setDestino(null)
    // Soltar en la misma columna no hace nada
    if (!op || op.etapa === columna.etapa) return
    moverArrastrando(op, columna.etapa)
  }

  return (
    <div style={styles.board}>
      {columnas.map(columna => (
        <div
          key={columna.etapa}
          style={{
            ...styles.column,
            ...(destino === columna.etapa ? styles.columnOver : {}),
          }}
          onDragOver={e => {
            if (!arrastrando) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDestino(columna.etapa)
          }}
          onDragLeave={e => {
            if (!e.currentTarget.contains(e.relatedTarget)) setDestino(null)
          }}
          onDrop={e => {
            e.preventDefault()
            soltar(columna)
          }}
        >
          <div style={styles.colTitle}>
            {columna.etapa} · {columna.oportunidades.length}
          </div>

          {columna.oportunidades.map(op => {
            const cliente = clientesPorId[op.cliente_id]

            return (
              <div
                key={op._id}
                draggable
                onDragStart={e => {
                  setArrastrando(op._id)
                  e.dataTransfer.effectAllowed = 'move'
                  // Firefox no inicia el arrastre sin datos
                  e.dataTransfer.setData('text/plain', op._id)
                }}
                onDragEnd={() => {
                  setArrastrando(null)
                  setDestino(null)
                }}
                style={{
                  ...styles.leadCard,
                  marginBottom: 12,
                  cursor: 'grab',
                  opacity: arrastrando === op._id ? 0.4 : 1,
                }}
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


const TIPOS_LEAD_BR = [
  ['propietario', 'Propietario'],
  ['comprador', 'Comprador'],
  ['arrendatario', 'Arrendatario'],
]
const FORM_LEAD_VACIO = {
  empresa: '', contacto: '', telefono: '', correo: '', canal_origen: 'directo', notas: '',
}

function Leads({ negocio }) {
  const [columnas, setColumnas]       = useState([])
  const [cargando, setCargando]       = useState(false)
  const [error, setError]             = useState('')
  const [modal, setModal]             = useState(null) // 'nuevo' | 'convertir'
  const [seleccion, setSeleccion]     = useState(null)
  const [form, setForm]               = useState(FORM_LEAD_VACIO)
  const [conversion, setConversion]   = useState({ tipo_lead: 'comprador', valor_estimado: '' })
  const [guardando, setGuardando]     = useState(false)
  const [arrastrando, setArrastrando] = useState(null) // id del lead que se arrastra
  const [destino, setDestino]         = useState(null) // etapa bajo el cursor

  const esBR = negocio === 'bienes_raices'
  const total = columnas.reduce((n, c) => n + c.leads.length, 0)

  async function cargarTablero(silencioso = false) {
    if (!silencioso) setCargando(true)
    try {
      const res = await crmApi.leads.kanban(negocio)
      setColumnas(res.data.data || [])
    } catch (e) {
      setError(mensajeError(e, 'No se pudo cargar los leads'))
    } finally {
      if (!silencioso) setCargando(false)
    }
  }

  useEffect(() => {
    setError('')
    cargarTablero()
  }, [negocio])

  // Arrastre: el lead cambia de columna al instante; si el servidor lo rechaza, vuelve
  async function moverLead(lead, etapa) {
    const anterior = columnas
    setError('')
    setColumnas(prev => prev
      .map(c => ({ ...c, leads: c.leads.filter(l => l._id !== lead._id) }))
      .map(c => c.etapa === etapa ? { ...c, leads: [{ ...lead, etapa }, ...c.leads] } : c))
    try {
      await crmApi.leads.moverEtapa(lead._id, etapa)
      await cargarTablero(true)
    } catch (e) {
      setColumnas(anterior)
      setError(mensajeError(e, 'No se pudo mover el lead'))
    }
  }

  function soltar(columna) {
    const lead = columnas.flatMap(c => c.leads).find(l => l._id === arrastrando)
    setArrastrando(null)
    setDestino(null)
    if (!lead || lead.etapa === columna.etapa) return
    moverLead(lead, columna.etapa)
  }

  async function guardarLead(e) {
    e.preventDefault()
    if (!form.empresa.trim() || !form.telefono.trim()) {
      setError('Empresa y teléfono son obligatorios.')
      return
    }
    setGuardando(true)
    setError('')
    try {
      await crmApi.leads.crear({
        negocio_id: negocio,
        empresa: form.empresa.trim(),
        contacto: form.contacto.trim(),
        telefono: form.telefono.trim(),
        correo: form.correo.trim() || null,
        canal_origen: form.canal_origen,
        notas: form.notas.trim(),
      })
      setModal(null)
      setForm(FORM_LEAD_VACIO)
      await cargarTablero(true)
    } catch (err) {
      setError(mensajeError(err, 'No se pudo guardar el lead'))
    } finally {
      setGuardando(false)
    }
  }

  function abrirConvertir(lead) {
    setSeleccion(lead)
    setConversion({ tipo_lead: 'comprador', valor_estimado: '' })
    setModal('convertir')
  }

  async function guardarConversion(e) {
    e.preventDefault()
    setGuardando(true)
    setError('')
    try {
      await crmApi.leads.convertir(seleccion._id, {
        tipo_lead: esBR ? conversion.tipo_lead : null,
        valor_estimado: conversion.valor_estimado === '' ? null : Number(conversion.valor_estimado),
      })
      setModal(null)
      await cargarTablero(true)
    } catch (err) {
      setError(mensajeError(err, 'No se pudo convertir el lead'))
    } finally {
      setGuardando(false)
    }
  }

  async function descartar(lead) {
    const motivo = window.prompt(`Motivo para descartar a "${lead.empresa}":`)
    if (!motivo || !motivo.trim()) return
    setError('')
    try {
      await crmApi.leads.descartar(lead._id, motivo.trim())
      await cargarTablero(true)
    } catch (err) {
      setError(mensajeError(err, 'No se pudo descartar el lead'))
    }
  }

  const etiquetaCanal = (valor) => Object.fromEntries(CANALES)[valor] || valor

  return (
    <div>
      <div style={styles.toolbar}>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => {
            setForm(FORM_LEAD_VACIO)
            setModal('nuevo')
          }}
          style={styles.primary}
        >
          + Nuevo lead
        </button>
      </div>

      {error && (
        <div style={styles.error}>
          {error}
        </div>
      )}

      {cargando ? (
        <div style={styles.empty}>Cargando...</div>
      ) : total === 0 ? (
        <div style={styles.empty}>
          <div style={styles.emptyTitle}>No hay leads abiertos</div>
          <div>Captura un prospecto con el botón de arriba. Al calificarlo, conviértelo en oportunidad.</div>
        </div>
      ) : (
        <div style={styles.board}>
          {columnas.map(columna => (
            <div
              key={columna.etapa}
              style={{
                ...styles.column,
                ...(destino === columna.etapa ? styles.columnOver : {}),
              }}
              onDragOver={e => {
                if (!arrastrando) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setDestino(columna.etapa)
              }}
              onDragLeave={e => {
                if (!e.currentTarget.contains(e.relatedTarget)) setDestino(null)
              }}
              onDrop={e => {
                e.preventDefault()
                soltar(columna)
              }}
            >
              <div style={styles.colTitle}>
                {columna.etapa} · {columna.leads.length}
              </div>

              {columna.leads.map(lead => (
                <div
                  key={lead._id}
                  draggable
                  onDragStart={e => {
                    setArrastrando(lead._id)
                    e.dataTransfer.effectAllowed = 'move'
                    // Firefox no inicia el arrastre sin datos
                    e.dataTransfer.setData('text/plain', lead._id)
                  }}
                  onDragEnd={() => {
                    setArrastrando(null)
                    setDestino(null)
                  }}
                  style={{
                    ...styles.leadCard,
                    marginBottom: 12,
                    cursor: 'grab',
                    opacity: arrastrando === lead._id ? 0.4 : 1,
                  }}
                >
                  <div style={styles.leadTop}>
                    <div>
                      <strong>{lead.empresa}</strong>
                      <div style={styles.muted}>{lead.contacto || 'Sin contacto'}</div>
                    </div>
                  </div>

                  <div style={styles.leadInfo}>
                    <span>📞 {lead.telefono}</span>
                    {lead.correo && <span>✉ {lead.correo}</span>}
                    <span>Canal: {etiquetaCanal(lead.canal_origen)}</span>
                  </div>

                  {lead.notas && <div style={{ ...styles.muted, marginTop: 8 }}>{lead.notas}</div>}

                  <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                    <button onClick={() => abrirConvertir(lead)} style={styles.primary}>
                      Convertir a oportunidad
                    </button>
                    <button
                      onClick={() => descartar(lead)}
                      style={{ ...styles.action, color: '#dc2626', borderColor: '#fecaca', background: '#fff' }}
                    >
                      Descartar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {modal === 'nuevo' && (
        <div style={styles.overlay}>
          <form onSubmit={guardarLead} style={styles.modal}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>Nuevo lead</h2>
              <button type="button" onClick={() => setModal(null)} style={styles.close}>×</button>
            </div>
            <div style={styles.grid}>
              <label style={styles.field}>
                <span>Empresa *</span>
                <input value={form.empresa} onChange={e => setForm(f => ({ ...f, empresa: e.target.value }))} />
              </label>
              <label style={styles.field}>
                <span>Contacto</span>
                <input value={form.contacto} onChange={e => setForm(f => ({ ...f, contacto: e.target.value }))} />
              </label>
              <label style={styles.field}>
                <span>Teléfono *</span>
                <input value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} />
              </label>
              <label style={styles.field}>
                <span>Correo</span>
                <input type="email" value={form.correo} onChange={e => setForm(f => ({ ...f, correo: e.target.value }))} />
              </label>
              <label style={styles.field}>
                <span>Canal de origen</span>
                <select value={form.canal_origen} onChange={e => setForm(f => ({ ...f, canal_origen: e.target.value }))}>
                  {CANALES.map(([id, texto]) => <option key={id} value={id}>{texto}</option>)}
                </select>
              </label>
              <label style={styles.field}>
                <span>Notas</span>
                <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
              </label>
            </div>
            <div style={styles.actions}>
              <button type="button" onClick={() => setModal(null)} style={styles.cancel}>Cancelar</button>
              <button type="submit" disabled={guardando} style={styles.primary}>
                {guardando ? 'Guardando...' : 'Guardar lead'}
              </button>
            </div>
          </form>
        </div>
      )}

      {modal === 'convertir' && seleccion && (
        <div style={styles.overlay}>
          <form onSubmit={guardarConversion} style={styles.modal}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>Convertir a oportunidad</h2>
              <button type="button" onClick={() => setModal(null)} style={styles.close}>×</button>
            </div>
            <p style={styles.muted}>
              Se crea el cliente "{seleccion.empresa}" (o se reutiliza si ya existe) y una oportunidad
              en la primera etapa del pipeline. El lead se cierra.
            </p>
            <div style={styles.grid}>
              {esBR && (
                <label style={styles.field}>
                  <span>Tipo de lead *</span>
                  <select value={conversion.tipo_lead} onChange={e => setConversion(c => ({ ...c, tipo_lead: e.target.value }))}>
                    {TIPOS_LEAD_BR.map(([id, texto]) => <option key={id} value={id}>{texto}</option>)}
                  </select>
                </label>
              )}
              <label style={styles.field}>
                <span>Valor estimado</span>
                <input
                  type="number" min={0} step="0.01" value={conversion.valor_estimado}
                  onChange={e => setConversion(c => ({ ...c, valor_estimado: e.target.value }))}
                />
              </label>
            </div>
            <div style={styles.actions}>
              <button type="button" onClick={() => setModal(null)} style={styles.cancel}>Cancelar</button>
              <button type="submit" disabled={guardando} style={styles.primary}>
                {guardando ? 'Convirtiendo...' : 'Convertir'}
              </button>
            </div>
          </form>
        </div>
      )}
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

  board: {
    display: 'flex',
    gap: 14,
    alignItems: 'flex-start',
    overflowX: 'auto',
    paddingBottom: 8,
  },

  column: {
    flex: '0 0 280px',
    minHeight: 160,
    background: '#f8fafc',
    border: '1px dashed #cbd5e1',
    borderRadius: 10,
    padding: 12,
    transition: 'background .15s, border-color .15s',
  },

  columnOver: {
    background: '#eff6ff',
    borderColor: '#2563eb',
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
