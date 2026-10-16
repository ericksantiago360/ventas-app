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

const WHATSAPP_URL = 'https://wa.me/525568789597?text=' +
  encodeURIComponent('Hola, me interesa la plataforma de gestión')

function IconoWhatsApp({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35zM12.05 21.5h-.01a9.4 9.4 0 0 1-4.79-1.31l-.34-.2-3.56.93.95-3.47-.22-.36a9.38 9.38 0 0 1-1.44-5.01c0-5.19 4.22-9.41 9.42-9.41 2.52 0 4.88.98 6.66 2.76a9.35 9.35 0 0 1 2.75 6.66c0 5.19-4.23 9.41-9.42 9.41zm8.01-17.42A11.26 11.26 0 0 0 12.05.75C5.81.75.73 5.83.73 12.07c0 2 .52 3.95 1.51 5.66L.64 23.25l5.65-1.48a11.3 11.3 0 0 0 5.75 1.47h.01c6.24 0 11.32-5.08 11.32-11.32 0-3.03-1.18-5.87-3.31-8z" />
    </svg>
  )
}

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
          <p style={{ ...s.lead, margin: '0 auto 28px' }}>Entra con tu usuario o escríbenos para conocer la plataforma.</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Link to={autenticado ? '/' : '/login'} style={s.btnPri}>
              {autenticado ? 'Ir al panel' : 'Iniciar sesión'}
            </Link>
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer"
              style={{ ...s.btnPri, background: '#25d366', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <IconoWhatsApp size={18} /> Escríbenos por WhatsApp
            </a>
          </div>
        </div>
      </section>

      <footer style={{ padding: '24px 0', background: '#0f172a', color: '#64748b', fontSize: 13 }}>
        <div style={{ ...s.wrap, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span>© {new Date().getFullYear()} Ventas App</span>
          <span>Diagnóstico Plus · Santal Machinery · Dulce Tentación · Bienes Raíces</span>
        </div>
      </footer>

      {/* ── WhatsApp flotante ── */}
      <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" aria-label="Escríbenos por WhatsApp" title="Escríbenos por WhatsApp"
        style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 20, width: 56, height: 56, borderRadius: 999, background: '#25d366', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 20px rgba(0,0,0,.25)' }}>
        <IconoWhatsApp size={30} />
      </a>
    </div>
  )
}
