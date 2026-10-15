import { useEffect, useState } from 'react'
import axios from 'axios'
import { useNegocio } from '../context/NegocioContext'

const api = axios.create({ baseURL: '' })
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

const ESTADO_COLOR = {
  confirmado: '#2563eb',
  en_proceso: '#d97706',
  listo:      '#16a34a',
  entregado:  '#7c3aed',
  cobrado:    '#059669',
  cancelado:  '#dc2626',
}
const ESTADO_LABEL = {
  confirmado: 'Confirmado',
  en_proceso: 'En proceso',
  listo:      'Listo',
  entregado:  'Entregado',
  cobrado:    'Cobrado',
  cancelado:  'Cancelado',
}

function mesActual() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function money(v) {
  return Number(v || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

export default function Reportes() {
  const { negocioId, setNegocioId, negociosDisponibles } = useNegocio()
  const [mes, setMes]         = useState(mesActual)
  const [resumen, setResumen] = useState(null)
  const [evolucion, setEvolucion] = useState([])
  const [cargando, setCargando]   = useState(false)
  const [error, setError]         = useState('')

  const cargar = async () => {
    setCargando(true)
    setError('')
    try {
      const [r, e] = await Promise.all([
        api.get('/api/reportes/resumen',  { params: { negocio_id: negocioId, mes } }),
        api.get('/api/reportes/evolucion', { params: { negocio_id: negocioId, meses: 6 } }),
      ])
      setResumen(r.data)
      setEvolucion(e.data || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Error al cargar los reportes.')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar() }, [negocioId, mes])

  const maxVentas = Math.max(...evolucion.map(d => d.ventas), 1)
  const maxProductoImporte = Math.max(...(resumen?.top_productos || []).map(p => p.importe), 1)
  const maxClienteTotal    = Math.max(...(resumen?.top_clientes  || []).map(c => c.total),   1)

  return (
    <div>

      {/* HEADER */}
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Reportes</h1>
          <p style={s.subtitle}>KPIs y análisis de negocio</p>
        </div>
        <div style={s.headerActions}>
          <select value={negocioId} onChange={e => setNegocioId(e.target.value)} style={s.select}>
            {negociosDisponibles.map(n => (
              <option key={n.id} value={n.id}>{n.nombre}</option>
            ))}
          </select>
          <input
            type="month"
            value={mes}
            onChange={e => setMes(e.target.value)}
            style={s.select}
          />
          <button onClick={cargar} disabled={cargando} style={s.primaryBtn}>
            {cargando ? 'Cargando...' : 'Actualizar'}
          </button>
        </div>
      </div>

      {/* ERROR */}
      {error && (
        <div style={s.errorBox}>
          <span>{error}</span>
          <button onClick={() => setError('')} style={s.closeBtn}>×</button>
        </div>
      )}

      {cargando && !resumen && (
        <div style={s.loading}>Cargando reportes...</div>
      )}

      {resumen && (
        <>
          {/* KPI CARDS — fila 1 */}
          <div style={s.cardGrid}>
            <KpiCard
              titulo="Ventas del mes"
              valor={money(resumen.ventas_total)}
              sub={`${resumen.pedidos_total} pedidos`}
              color="#0f172a"
            />
            <KpiCard
              titulo="Cobrado en el mes"
              valor={money(resumen.cobrado_mes)}
              sub={`${resumen.pedidos_por_estado?.cobrado || 0} pedidos cobrados`}
              color="#059669"
            />
            <KpiCard
              titulo="Saldo pendiente"
              valor={money(resumen.saldo_pendiente_total)}
              sub="Total por cobrar (todos los meses)"
              color={resumen.saldo_pendiente_total > 0 ? '#dc2626' : '#059669'}
            />
            <KpiCard
              titulo="Pedidos creados"
              valor={resumen.pedidos_total}
              sub={`${resumen.pedidos_por_estado?.cancelado || 0} cancelados`}
              color="#2563eb"
            />
          </div>

          {/* KPI CARDS — fila 2 */}
          <div style={{ ...s.cardGrid, marginTop: 12 }}>
            <KpiCard
              titulo="Ingresos financieros"
              valor={money(resumen.ingresos_mes)}
              sub="Movimientos tipo ingreso"
              color="#16a34a"
            />
            <KpiCard
              titulo="Egresos financieros"
              valor={money(resumen.egresos_mes)}
              sub="Movimientos tipo egreso"
              color="#d97706"
            />
            <KpiCard
              titulo="Clientes nuevos"
              valor={resumen.clientes_nuevos}
              sub="Registrados en el mes"
              color="#7c3aed"
            />
            <KpiCard
              titulo="Alertas de stock"
              valor={resumen.alertas_inventario}
              sub="Productos con stock bajo o sin stock"
              color={resumen.alertas_inventario > 0 ? '#dc2626' : '#059669'}
            />
          </div>

          {/* SECCIÓN MEDIA: estado + evolución */}
          <div style={s.twoCol}>

            {/* Pedidos por estado */}
            <div style={s.panel}>
              <h3 style={s.panelTitle}>Pedidos por estado</h3>
              <div style={{ marginTop: 8 }}>
                {Object.entries(resumen.pedidos_por_estado).map(([estado, count]) => {
                  const total = resumen.pedidos_total || 1
                  const pct   = Math.round((count / total) * 100)
                  const color = ESTADO_COLOR[estado] || '#64748b'
                  return (
                    <div key={estado} style={{ marginBottom: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 13 }}>
                        <span style={{ color: '#334155' }}>{ESTADO_LABEL[estado] || estado}</span>
                        <span style={{ fontWeight: 600, color }}>{count} <span style={{ color: '#94a3b8', fontWeight: 400 }}>({pct}%)</span></span>
                      </div>
                      <div style={{ height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${pct}%`,
                          background: color,
                          borderRadius: 4,
                          transition: 'width .4s ease',
                        }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Evolución de ventas */}
            <div style={s.panel}>
              <h3 style={s.panelTitle}>Evolución de ventas (6 meses)</h3>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 130, marginTop: 16 }}>
                {evolucion.map(d => (
                  <div key={d.mes} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                    <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4, textAlign: 'center' }}>
                      {money(d.ventas).replace('$', '').replace(',000', 'k').trim()}
                    </div>
                    <div style={{
                      width: '100%',
                      background: d.mes === mes ? '#2563eb' : '#0f172a',
                      borderRadius: '4px 4px 0 0',
                      height: maxVentas > 0 ? `${Math.max((d.ventas / maxVentas) * 100, 4)}%` : '4px',
                      minHeight: 4,
                      transition: 'height .4s ease',
                    }} />
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, textAlign: 'center' }}>
                      {d.label}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 16, fontSize: 12, color: '#64748b' }}>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#2563eb', borderRadius: 2, marginRight: 4 }} />Mes seleccionado</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#0f172a', borderRadius: 2, marginRight: 4 }} />Otros meses</span>
              </div>
            </div>

          </div>

          {/* TOP PRODUCTOS */}
          {resumen.top_productos.length > 0 && (
            <div style={{ ...s.panel, marginTop: 20 }}>
              <h3 style={s.panelTitle}>Top productos del mes</h3>
              <div style={{ marginTop: 8 }}>
                <div style={{ ...s.tableHead, gridTemplateColumns: '2fr 1fr 1fr 2fr' }}>
                  <span>Producto</span>
                  <span style={{ textAlign: 'right' }}>Cantidad</span>
                  <span style={{ textAlign: 'right' }}>Importe</span>
                  <span></span>
                </div>
                {resumen.top_productos.map((p, i) => (
                  <div key={i} style={{ ...s.tableRow, gridTemplateColumns: '2fr 1fr 1fr 2fr' }}>
                    <div style={{ fontWeight: 500 }}>{p.nombre}</div>
                    <div style={{ textAlign: 'right', color: '#64748b' }}>{p.cantidad}</div>
                    <div style={{ textAlign: 'right', fontWeight: 600 }}>{money(p.importe)}</div>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <div style={{ flex: 1, height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${(p.importe / maxProductoImporte) * 100}%`,
                          background: '#0f172a',
                          borderRadius: 3,
                        }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TOP CLIENTES */}
          {resumen.top_clientes.length > 0 && (
            <div style={{ ...s.panel, marginTop: 20 }}>
              <h3 style={s.panelTitle}>Top clientes del mes</h3>
              <div style={{ marginTop: 8 }}>
                <div style={{ ...s.tableHead, gridTemplateColumns: '2fr .8fr 1.2fr 2fr' }}>
                  <span>Cliente</span>
                  <span style={{ textAlign: 'right' }}>Pedidos</span>
                  <span style={{ textAlign: 'right' }}>Total</span>
                  <span></span>
                </div>
                {resumen.top_clientes.map((c, i) => (
                  <div key={i} style={{ ...s.tableRow, gridTemplateColumns: '2fr .8fr 1.2fr 2fr' }}>
                    <div style={{ fontWeight: 500 }}>{c.nombre || 'Sin nombre'}</div>
                    <div style={{ textAlign: 'right', color: '#64748b' }}>{c.pedidos}</div>
                    <div style={{ textAlign: 'right', fontWeight: 600 }}>{money(c.total)}</div>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <div style={{ flex: 1, height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${(c.total / maxClienteTotal) * 100}%`,
                          background: '#2563eb',
                          borderRadius: 3,
                        }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {resumen.top_productos.length === 0 && resumen.top_clientes.length === 0 && (
            <div style={{ ...s.panel, marginTop: 20, textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
              No hay pedidos registrados en este mes para mostrar productos o clientes.
            </div>
          )}
        </>
      )}
    </div>
  )
}

function KpiCard({ titulo, valor, sub, color }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: 8,
      padding: '16px 20px',
    }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {titulo}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || '#0f172a', marginBottom: 4 }}>
        {valor}
      </div>
      {sub && <div style={{ fontSize: 12, color: '#94a3b8' }}>{sub}</div>}
    </div>
  )
}

const s = {
  header:        { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  title:         { margin: 0, fontSize: 26, fontWeight: 600, color: '#0f172a' },
  subtitle:      { margin: '5px 0 0', color: '#64748b', fontSize: 14 },
  headerActions: { display: 'flex', gap: 8, alignItems: 'center' },
  select:        { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, background: '#fff' },
  primaryBtn:    { border: 'none', background: '#0f172a', color: '#fff', padding: '9px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  errorBox:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '10px 12px', borderRadius: 6, marginBottom: 16, fontSize: 13 },
  closeBtn:      { border: 'none', background: 'transparent', color: '#991b1b', cursor: 'pointer', fontSize: 18 },
  loading:       { padding: 40, textAlign: 'center', color: '#64748b' },
  cardGrid:      { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 8 },
  twoCol:        { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 20 },
  panel:         { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '18px 20px' },
  panelTitle:    { margin: 0, fontSize: 15, fontWeight: 600, color: '#0f172a' },
  tableHead:     { display: 'grid', gap: 8, padding: '8px 12px', background: '#f8fafc', borderRadius: '6px 6px 0 0', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' },
  tableRow:      { display: 'grid', gap: 8, alignItems: 'center', padding: '10px 12px', borderTop: '1px solid #f1f5f9', fontSize: 13, color: '#334155' },
}
