import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'

const api = axios.create({ baseURL: '' })
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

const dinero = (v) => Number(v || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
const TIPOS = [
  { value: 'cotizacion', label: 'Cotización' },
  { value: 'pedido', label: 'Pedido' },
  { value: 'mostrador', label: 'Venta de mostrador' },
]
const METODOS = [['efectivo', 'Efectivo'], ['tarjeta', 'Tarjeta'], ['transferencia', 'Transferencia']]

function mensajeError(err, fallback) {
  const detalle = err.response?.data?.detail
  if (Array.isArray(detalle)) return detalle.map(d => d.msg).join('. ') || fallback
  return detalle || fallback
}

// Venta rápida desde CRM: intereses del cliente, más vendidos y líneas para generar cotización, pedido o venta de mostrador
export default function VentaRapida({ negocioId, cliente, onCerrar }) {
  const clienteId = cliente._id
  const [productos, setProductos] = useState([])   // catálogo del negocio
  const [cuentas, setCuentas] = useState([])
  const [intereses, setIntereses] = useState([])   // { id, nombre, precio }
  const [masVendidos, setMasVendidos] = useState([])
  const [lineas, setLineas] = useState([])         // { producto_id, nombre, precio, iva_aplicable, iva_pct, cantidad }
  const [tipo, setTipo] = useState('cotizacion')
  const [cuentaId, setCuentaId] = useState('')
  const [metodo, setMetodo] = useState('efectivo')
  const [recibido, setRecibido] = useState('')
  const [notas, setNotas] = useState('')
  const [agregar, setAgregar] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [resultado, setResultado] = useState(null)
  const [listas, setListas] = useState([])
  const [listaEnvio, setListaEnvio] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    api.get('/api/catalogo/listas-precios', { params: { negocio_id: negocioId } })
      .then(({ data }) => {
        const lista = data?.data || []
        setListas(lista)
        setListaEnvio(lista[0]?._id || '')
      })
      .catch(() => setListas([]))
  }, [negocioId])

  useEffect(() => {
    (async () => {
      try {
        const [prod, interes, top, cuen] = await Promise.all([
          api.get('/api/catalogo/productos', { params: { negocio_id: negocioId } }),
          api.get(`/api/crm/clientes/${clienteId}/productos-interes`, { params: { negocio_id: negocioId } }),
          api.get('/api/crm/productos-mas-vendidos', { params: { negocio_id: negocioId } }),
          api.get('/api/finanzas/cuentas', { params: { negocio_id: negocioId, activo: true } }),
        ])
        const lista = prod.data?.data || []
        setProductos(lista.filter(p => p.activo !== false))
        setIntereses(interes.data || [])
        setMasVendidos(top.data || [])
        setCuentas(cuen.data || [])
        setCuentaId(cuen.data?.[0]?.id || cuen.data?.[0]?._id || '')
      } catch (err) {
        setError(mensajeError(err, 'No se pudieron cargar los datos de venta.'))
      }
    })()
  }, [negocioId, clienteId])

  const datosDeProducto = (id) => productos.find(p => (p._id || p.id) === id)

  async function enviarLista(canal) {
    if (!listaEnvio) { setError('Elige la lista que quieres enviar.'); return }
    setError('')
    setAviso('')
    // WhatsApp: la pestaña se abre al instante (los navegadores bloquean ventanas abiertas después de una espera)
    const ventana = canal === 'whatsapp' ? window.open('', '_blank') : null
    setEnviando(true)
    try {
      const { data } = await api.post(`/api/crm/clientes/${clienteId}/enviar-lista`, {
        negocio_id: negocioId, lista_id: listaEnvio, canal,
      })
      if (data.canal === 'whatsapp') {
        if (ventana) ventana.location.href = data.url
        else window.open(data.url, '_blank', 'noopener')
        setAviso('Se abrió WhatsApp con la lista lista para enviar.')
      } else {
        ventana?.close()
        setAviso(`Lista enviada a ${data.destinatario}.`)
      }
    } catch (err) {
      ventana?.close()
      setError(mensajeError(err, 'No se pudo enviar la lista.'))
    } finally {
      setEnviando(false)
    }
  }

  async function guardarIntereses(nuevos) {
    setError('')
    try {
      await api.put(`/api/crm/clientes/${clienteId}/productos-interes`, {
        negocio_id: negocioId, producto_ids: nuevos.map(p => p.id),
      })
      setIntereses(nuevos)
    } catch (err) {
      setError(mensajeError(err, 'No se pudieron guardar los intereses.'))
    }
  }

  function quitarInteres(id) {
    guardarIntereses(intereses.filter(p => p.id !== id))
  }

  function agregarInteres(id) {
    if (!id || intereses.some(p => p.id === id)) return
    const p = datosDeProducto(id)
    if (!p) return
    guardarIntereses([...intereses, { id, nombre: p.nombre, precio: Number(p.precio_base || 0) }])
    setAgregar('')
  }

  function agregarLinea(id) {
    if (!id) return
    const p = datosDeProducto(id) || masVendidos.find(m => m.id === id)
    if (!p) return
    setLineas(prev => {
      if (prev.some(l => l.producto_id === id)) {
        return prev.map(l => l.producto_id === id ? { ...l, cantidad: l.cantidad + 1 } : l)
      }
      return [...prev, {
        producto_id: id,
        nombre: p.nombre,
        precio: Number(p.precio_base ?? p.precio ?? 0),
        iva_aplicable: p.iva_aplicable !== false,
        iva_pct: Number(p.iva_pct ?? 16),
        cantidad: 1,
      }]
    })
  }

  const totales = useMemo(() => {
    const subtotal = lineas.reduce((n, l) => n + l.precio * l.cantidad, 0)
    // Mostrador: el precio ya incluye IVA. Cotización y pedido: IVA sobre el precio base
    const iva = tipo === 'mostrador' ? 0 : lineas.reduce((n, l) => n + (l.iva_aplicable ? l.precio * l.cantidad * l.iva_pct / 100 : 0), 0)
    return { subtotal, iva, total: tipo === 'mostrador' ? subtotal : subtotal + iva }
  }, [lineas, tipo])

  async function generar(e) {
    e.preventDefault()
    setError('')
    if (lineas.length === 0) { setError('Agrega al menos un producto.'); return }
    if (tipo === 'mostrador' && !cuentaId) { setError('Elige la cuenta donde entra el dinero.'); return }
    if (tipo === 'mostrador' && metodo === 'efectivo' && (recibido === '' || Number(recibido) < totales.total)) {
      setError(`El monto recibido debe ser al menos ${dinero(totales.total)}.`); return
    }
    setGuardando(true)
    try {
      const { data } = await api.post(`/api/crm/clientes/${clienteId}/venta`, {
        negocio_id: negocioId,
        tipo,
        items: lineas.map(l => ({ producto_id: l.producto_id, cantidad: l.cantidad })),
        notas,
        ...(tipo === 'mostrador' ? {
          cuenta_id: cuentaId,
          metodo_pago: metodo,
          monto_recibido: metodo === 'efectivo' ? Number(recibido) : null,
        } : {}),
      })
      setResultado(data)
      setLineas([])
      setNotas('')
      setRecibido('')
    } catch (err) {
      setError(mensajeError(err, 'No se pudo generar la venta.'))
    } finally {
      setGuardando(false)
    }
  }

  const etiquetaTipo = TIPOS.find(t => t.value === (resultado?.tipo || tipo))?.label || ''

  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        <div style={s.header}>
          <div>
            <h2 style={s.titulo}>Venta rápida</h2>
            <div style={s.muted}>Cliente: <strong>{cliente.empresa}</strong></div>
          </div>
          <button onClick={onCerrar} style={s.cerrar}>×</button>
        </div>

        <div style={s.cuerpo}>
          {error && <div style={s.error}>{error}</div>}

          {resultado && (
            <div style={s.exito}>
              <strong>{etiquetaTipo} {resultado.numero} generada.</strong> Total {dinero(resultado.total)}.
              <button onClick={() => setResultado(null)} style={{ ...s.secundario, marginLeft: 12 }}>Hacer otra</button>
            </div>
          )}

          <div style={s.dosColumnas}>
            <section>
              <h3 style={s.subtitulo}>Productos de interés</h3>
              <div style={s.chips}>
                {intereses.length === 0 && <span style={s.muted}>Aún no hay productos de interés.</span>}
                {intereses.map(p => (
                  <span key={p.id} style={s.chip}>
                    {p.nombre}
                    <button onClick={() => agregarLinea(p.id)} style={s.chipAccion} title="Agregar a la venta">+</button>
                    <button onClick={() => quitarInteres(p.id)} style={s.chipAccion} title="Quitar de intereses">×</button>
                  </span>
                ))}
              </div>
              <select value={agregar} onChange={e => agregarInteres(e.target.value)} style={s.input}>
                <option value="">+ Agregar producto de interés…</option>
                {productos.filter(p => !intereses.some(i => i.id === (p._id || p.id))).map(p => (
                  <option key={p._id || p.id} value={p._id || p.id}>{p.nombre} · {dinero(p.precio_base)}</option>
                ))}
              </select>
            </section>

            <section>
              <h3 style={s.subtitulo}>Más vendidos</h3>
              <div style={s.chips}>
                {masVendidos.length === 0 && <span style={s.muted}>Aún no hay ventas registradas.</span>}
                {masVendidos.map(p => (
                  <button key={p.id} onClick={() => agregarLinea(p.id)} style={s.chipBoton}>
                    {p.nombre} <span style={s.muted}>· {p.unidades} u.</span>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <h3 style={s.subtitulo}>Productos de la venta</h3>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <select value="" onChange={e => agregarLinea(e.target.value)} style={{ ...s.input, flex: 1 }}>
              <option value="">Agregar producto…</option>
              {productos.map(p => <option key={p._id || p.id} value={p._id || p.id}>{p.nombre} · {dinero(p.precio_base)}</option>)}
            </select>
          </div>

          {lineas.length === 0 ? (
            <div style={s.vacio}>Agrega productos desde los intereses, los más vendidos o el selector.</div>
          ) : (
            <div style={s.tabla}>
              <div style={{ ...s.fila, ...s.filaCabecera }}>
                <span>Producto</span><span>Precio</span><span>Cantidad</span><span>Importe</span><span></span>
              </div>
              {lineas.map(l => (
                <div key={l.producto_id} style={s.fila}>
                  <span>{l.nombre}</span>
                  <span>{dinero(l.precio)}</span>
                  <input type="number" min={1} step={tipo === 'mostrador' ? 1 : 'any'} value={l.cantidad} style={s.input}
                    onChange={e => setLineas(prev => prev.map(x => x.producto_id === l.producto_id ? { ...x, cantidad: Math.max(0, Number(e.target.value)) } : x))} />
                  <span>{dinero(l.precio * l.cantidad)}</span>
                  <button onClick={() => setLineas(prev => prev.filter(x => x.producto_id !== l.producto_id))} style={s.quitar}>×</button>
                </div>
              ))}
            </div>
          )}

          <div style={s.envio}>
            <h3 style={s.subtitulo}>Enviar lista de precios</h3>
            {listas.length === 0 ? (
              <div style={s.muted}>Aún no hay listas de precios. Genéralas desde Catálogo.</div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select value={listaEnvio} onChange={e => setListaEnvio(e.target.value)} style={{ ...s.input, flex: 1, minWidth: 180 }}>
                  {listas.map(l => <option key={l._id} value={l._id}>{l.nombre}</option>)}
                </select>
                <button type="button" disabled={enviando} onClick={() => enviarLista('whatsapp')} style={s.secundario}>WhatsApp</button>
                <button type="button" disabled={enviando} onClick={() => enviarLista('correo')} style={s.secundario}>Correo</button>
              </div>
            )}
            {aviso && <div style={{ ...s.exito, marginTop: 10, marginBottom: 0 }}>{aviso}</div>}
          </div>

          <form onSubmit={generar} style={{ marginTop: 18 }}>
            <div style={s.tipos}>
              {TIPOS.map(t => (
                <button type="button" key={t.value} onClick={() => setTipo(t.value)}
                  style={{ ...s.tipo, ...(tipo === t.value ? s.tipoActivo : {}) }}>{t.label}</button>
              ))}
            </div>

            {tipo === 'mostrador' && (
              <div style={s.grid3}>
                <label style={s.campo}><span>Cuenta</span>
                  <select value={cuentaId} onChange={e => setCuentaId(e.target.value)} style={s.input}>
                    {cuentas.length === 0 && <option value="">Sin cuentas activas</option>}
                    {cuentas.map(c => <option key={c.id || c._id} value={c.id || c._id}>{c.nombre}</option>)}
                  </select>
                </label>
                <label style={s.campo}><span>Método</span>
                  <select value={metodo} onChange={e => setMetodo(e.target.value)} style={s.input}>
                    {METODOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                {metodo === 'efectivo' && (
                  <label style={s.campo}><span>Monto recibido</span>
                    <input type="number" min={0} step="0.01" value={recibido} onChange={e => setRecibido(e.target.value)} style={s.input} />
                  </label>
                )}
              </div>
            )}

            <label style={{ ...s.campo, marginTop: 12 }}><span>Notas</span>
              <input value={notas} onChange={e => setNotas(e.target.value)} style={s.input} />
            </label>

            <div style={s.pie}>
              <div style={{ marginRight: 'auto', fontSize: 13, color: '#475569' }}>
                Subtotal {dinero(totales.subtotal)} · IVA {dinero(totales.iva)} ·{' '}
                <strong style={{ color: '#0f172a', fontSize: 15 }}>Total {dinero(totales.total)}</strong>
              </div>
              <button type="submit" disabled={guardando || lineas.length === 0} style={{ ...s.principal, opacity: lineas.length === 0 ? 0.5 : 1 }}>
                {guardando ? 'Generando…' : `Generar ${TIPOS.find(t => t.value === tipo).label.toLowerCase()}`}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

const s = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 1000 },
  modal: { width: '100%', maxWidth: 860, maxHeight: '92vh', background: '#fff', borderRadius: 10, boxShadow: '0 20px 50px rgba(0,0,0,.2)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid #e2e8f0' },
  titulo: { margin: 0, fontSize: 18, color: '#0f172a' },
  cerrar: { border: 'none', background: 'transparent', fontSize: 24, cursor: 'pointer', color: '#64748b' },
  cuerpo: { padding: 20, overflowY: 'auto' },
  subtitulo: { fontSize: 14, margin: '0 0 8px', color: '#334155' },
  muted: { color: '#64748b', fontSize: 13 },
  error: { background: '#fef2f2', color: '#b91c1c', borderRadius: 6, padding: '8px 12px', fontSize: 13, marginBottom: 12 },
  exito: { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', borderRadius: 6, padding: '10px 12px', fontSize: 13, marginBottom: 14 },
  dosColumnas: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 18 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8, minHeight: 28 },
  chip: { display: 'inline-flex', alignItems: 'center', gap: 4, background: '#eff6ff', color: '#1e3a8a', borderRadius: 16, padding: '4px 4px 4px 10px', fontSize: 12 },
  chipAccion: { border: 'none', background: 'transparent', cursor: 'pointer', color: '#1e40af', fontSize: 14, padding: '0 4px' },
  chipBoton: { border: '1px solid #cbd5e1', background: '#fff', borderRadius: 16, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: '#334155' },
  input: { width: '100%', boxSizing: 'border-box', padding: '7px 9px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, background: '#fff' },
  campo: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: '#475569' },
  grid3: { display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 12, marginTop: 14 },
  vacio: { border: '1px dashed #cbd5e1', borderRadius: 8, padding: 18, textAlign: 'center', color: '#64748b', fontSize: 13 },
  tabla: { border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' },
  fila: { display: 'grid', gridTemplateColumns: '2.4fr 1fr .8fr 1fr 30px', gap: 8, alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#334155' },
  filaCabecera: { background: '#f8fafc', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' },
  quitar: { border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer', fontSize: 16 },
  tipos: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  tipo: { border: '1px solid #cbd5e1', background: '#fff', borderRadius: 6, padding: '7px 12px', fontSize: 13, cursor: 'pointer', color: '#334155' },
  tipoActivo: { borderColor: '#0f172a', background: '#0f172a', color: '#fff' },
  pie: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 18, paddingTop: 14, borderTop: '1px solid #e2e8f0' },
  principal: { background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  secundario: { background: '#fff', border: '1px solid #cbd5e1', color: '#334155', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 13 },
  envio: { marginTop: 18, paddingTop: 14, borderTop: '1px solid #e2e8f0' },
}
