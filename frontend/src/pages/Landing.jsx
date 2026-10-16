import { Link } from 'react-router-dom'

const MODULOS = [
  {
    grupo: 'Laboratorio',
    color: '#0891b2',
    items: [
      ['Pacientes', 'Expediente con tipo de sangre, alergias y médico tratante.'],
      ['Resultados', 'Captura por analito con rangos de referencia y señalamiento automático de valores anormales.'],
    ],
  },
  {
    grupo: 'Comercial',
    color: '#7c3aed',
    items: [
      ['CRM', 'Prospectos por etapa y conversión a cliente.'],
      ['Catálogo', 'Productos y servicios con variantes y listas de precios.'],
      ['Cotizaciones', 'PDF con la imagen de cada negocio.'],
      ['Pedidos', 'Tablero Kanban, producción y registro de pagos.'],
      ['Facturación', 'Factura en un clic desde pedidos y órdenes de laboratorio.'],
    ],
  },
  {
    grupo: 'Administración',
    color: '#059669',
    items: [
      ['Finanzas', 'Cuentas de caja y banco con saldo en tiempo real.'],
      ['Contabilidad', 'Pólizas automáticas, balanza, estado de resultados y balance.'],
      ['Inventario', 'Existencias, entradas, salidas y consignación.'],
      ['Personal', 'Empleados, nómina y recibos.'],
    ],
  },
  {
    grupo: 'Análisis',
    color: '#ea580c',
    items: [
      ['Reportes', 'Indicadores clave, evolución mensual y productos más vendidos.'],
    ],
  },
]

const BENEFICIOS = [
  ['Varios negocios, una cuenta', 'Cambia de negocio con un clic. Cada usuario solo ve los negocios que tiene asignados.'],
  ['Cero doble captura', 'Lo que se vende genera el cobro, el movimiento de dinero y la póliza contable.'],
  ['Documentos listos', 'Cotizaciones, reportes de resultados y facturas en PDF para entregar.'],
  ['Se adapta al giro', 'Módulos clínicos para el laboratorio y módulos comerciales para el resto.'],
]

const FLUJO = ['Pedido u orden', 'Factura', 'Pago', 'Cobro en Finanzas', 'Póliza contable']

const s = {
  page:    { background: '#f8fafc', color: '#1e293b', minHeight: '100vh' },
  wrap:    { maxWidth: 1120, margin: '0 auto', padding: '0 16px' },
  nav:     { position: 'sticky', top: 0, zIndex: 10, background: 'rgba(15,23,42,.96)', borderBottom: '1px solid #1e293b' },
  navIn:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 },
  brand:   { color: '#fff', fontWeight: 600, fontSize: 17, textDecoration: 'none', letterSpacing: '-.01em' },
  btnPri:  { display: 'inline-block', background: '#38bdf8', color: '#0f172a', padding: '10px 20px', borderRadius: 8, fontWeight: 600, fontSize: 14, textDecoration: 'none' },
  btnSec:  { display: 'inline-block', border: '1px solid #475569', color: '#e2e8f0', padding: '10px 20px', borderRadius: 8, fontWeight: 500, fontSize: 14, textDecoration: 'none' },
  hero:    { background: 'linear-gradient(160deg, #0f172a 0%, #1e293b 60%, #0c4a6e 100%)', color: '#fff', padding: '88px 0 96px' },
  eyebrow: { display: 'inline-block', fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: '#7dd3fc', background: 'rgba(56,189,248,.12)', padding: '4px 10px', borderRadius: 999, marginBottom: 20 },
  h1:      { fontSize: 'clamp(32px, 5vw, 52px)', lineHeight: 1.1, fontWeight: 700, letterSpacing: '-.02em', maxWidth: 760, margin: '0 0 20px' },
  lead:    { fontSize: 'clamp(16px, 2vw, 19px)', lineHeight: 1.6, color: '#cbd5e1', maxWidth: 640, margin: '0 0 32px' },
  section: { padding: '72px 0' },
  h2:      { fontSize: 'clamp(24px, 3.5vw, 34px)', fontWeight: 700, letterSpacing: '-.01em', margin: '0 0 12px' },
  sub:     { fontSize: 16, color: '#64748b', margin: '0 0 40px', maxWidth: 620, lineHeight: 1.6 },
  grid:    min => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 20 }),
  card:    { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 24 },
}

export default function Landing() {
  const autenticado = !!localStorage.getItem('token')

  return (
    <div style={s.page}>

      {/* ── Navegación ── */}
      <header style={s.nav}>
        <div style={{ ...s.wrap, ...s.navIn }}>
          <Link to="/inicio" style={s.brand}>Ventas App</Link>
          {autenticado
            ? <Link to="/" style={{ ...s.btnPri, padding: '8px 16px' }}>Ir al panel</Link>
            : <Link to="/login" style={{ ...s.btnPri, padding: '8px 16px' }}>Iniciar sesión</Link>}
        </div>
      </header>

      {/* ── Hero ── */}
      <section style={s.hero}>
        <div style={s.wrap}>
          <span style={s.eyebrow}>Plataforma de gestión multi-negocio</span>
          <h1 style={s.h1}>Laboratorio clínico, ventas, finanzas y contabilidad en un solo sistema</h1>
          <p style={s.lead}>
            Una plataforma web que conecta toda la operación: del paciente o cliente
            hasta el cobro y la póliza contable, sin capturar la misma información dos veces.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link to={autenticado ? '/' : '/login'} style={s.btnPri}>
              {autenticado ? 'Ir al panel' : 'Entrar a la plataforma'}
            </Link>
            <a href="#modulos" style={s.btnSec}>Ver módulos</a>
          </div>
        </div>
      </section>

      {/* ── Beneficios ── */}
      <section style={s.section}>
        <div style={s.wrap}>
          <h2 style={s.h2}>Por qué una sola plataforma</h2>
          <p style={s.sub}>
            Hojas de cálculo, libretas y sistemas sueltos generan retrabajo y errores.
            Aquí cada dato se captura una vez y fluye a donde se necesita.
          </p>
          <div style={s.grid(240)}>
            {BENEFICIOS.map(([titulo, texto]) => (
              <div key={titulo} style={s.card}>
                <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px' }}>{titulo}</h3>
                <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6, margin: 0 }}>{texto}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Módulos ── */}
      <section id="modulos" style={{ ...s.section, background: '#fff', borderTop: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>
        <div style={s.wrap}>
          <h2 style={s.h2}>Doce módulos, un mismo flujo</h2>
          <p style={s.sub}>Activa lo que tu negocio necesita: desde resultados de laboratorio hasta nómina.</p>
          <div style={{ display: 'grid', gap: 36 }}>
            {MODULOS.map(({ grupo, color, items }) => (
              <div key={grupo}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: color }} />
                  <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: '#475569' }}>{grupo}</span>
                </div>
                <div style={s.grid(220)}>
                  {items.map(([nombre, desc]) => (
                    <div key={nombre} style={{ ...s.card, borderTop: `3px solid ${color}`, padding: 20 }}>
                      <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 6px' }}>{nombre}</h3>
                      <p style={{ fontSize: 13.5, color: '#64748b', lineHeight: 1.55, margin: 0 }}>{desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Todo conectado ── */}
      <section style={s.section}>
        <div style={s.wrap}>
          <h2 style={s.h2}>Todo conectado</h2>
          <p style={s.sub}>
            Un pago registrado en una factura actualiza el saldo bancario y la contabilidad
            sin capturar nada más. Si el pago se elimina, todo se revierte junto.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            {FLUJO.map((paso, i) => (
              <div key={paso} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ background: '#0f172a', color: '#fff', borderRadius: 8, padding: '12px 16px', fontSize: 14, fontWeight: 500 }}>
                  <span style={{ color: '#7dd3fc', marginRight: 8, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                  {paso}
                </div>
                {i < FLUJO.length - 1 && <span style={{ color: '#94a3b8', fontSize: 18 }}>→</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA final ── */}
      <section style={{ ...s.hero, padding: '64px 0' }}>
        <div style={{ ...s.wrap, textAlign: 'center' }}>
          <h2 style={{ ...s.h2, color: '#fff' }}>Una plataforma, todos los negocios, cero doble captura.</h2>
          <p style={{ ...s.lead, margin: '0 auto 28px' }}>Entra con tu usuario para empezar a trabajar.</p>
          <Link to={autenticado ? '/' : '/login'} style={s.btnPri}>
            {autenticado ? 'Ir al panel' : 'Iniciar sesión'}
          </Link>
        </div>
      </section>

      <footer style={{ padding: '24px 0', background: '#0f172a', color: '#64748b', fontSize: 13 }}>
        <div style={{ ...s.wrap, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span>© {new Date().getFullYear()} Ventas App</span>
          <span>Diagnóstico Plus · Santal Machinery · Dulce Tentación · Bienes Raíces</span>
        </div>
      </footer>
    </div>
  )
}
