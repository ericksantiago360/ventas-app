import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useNegocio } from '../context/NegocioContext'

// Subtítulo del menú según el giro del negocio (config_negocios.tipo)
const GIROS = {
  laboratorio_clinico: 'Laboratorio clínico',
  fabricacion_cnc:     'Fabricación',
  distribucion:        'Distribución',
  inmobiliario:        'Inmobiliaria',
  servicios:           'Servicios',
}

const NAV_GROUPS = [
  {
    label: null,
    items: [
      { to: '/', label: 'Dashboard', end: true },
    ],
  },
  {
    label: 'Laboratorio',
    items: [
      { to: '/pacientes',  label: 'Pacientes'   },
      { to: '/resultados', label: 'Resultados'  },
    ],
  },
  {
    label: 'Comercial',
    items: [
      { to: '/crm',          label: 'CRM'          },
      { to: '/catalogo',     label: 'Catálogo'     },
      { to: '/cotizaciones', label: 'Cotizaciones' },
      { to: '/pedidos',      label: 'Pedidos'      },
      { to: '/facturacion',  label: 'Facturación'  },
    ],
  },
  {
    label: 'Administración',
    items: [
      { to: '/finanzas',     label: 'Finanzas'     },
      { to: '/contabilidad', label: 'Contabilidad' },
      { to: '/inventario',   label: 'Inventario'   },
      { to: '/personal',     label: 'Personal'     },
      { to: '/negocios',     label: 'Negocios', soloAdmin: true },
      { to: '/usuarios',     label: 'Usuarios', soloAdmin: true },
    ],
  },
  {
    label: 'Análisis',
    items: [
      { to: '/reportes', label: 'Reportes' },
    ],
  },
]

export default function Layout() {
  const navigate = useNavigate()
  const user = JSON.parse(localStorage.getItem('user') || '{}')
  const { negocioActual, cargandoNegocios, errorNegocios } = useNegocio()

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    navigate('/login')
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>

      {/* ── Sidebar ── */}
      <aside style={{
        width: 220, flexShrink: 0,
        background: '#0f172a',
        display: 'flex', flexDirection: 'column',
        position: 'sticky', top: 0, height: '100vh',
      }}>
        {/* Logo */}
        <div style={{ padding: '1.25rem 1.25rem 1rem', borderBottom: '1px solid #1e293b' }}>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{negocioActual?.nombre || 'Gestión'}</div>
          <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>
            {GIROS[negocioActual?.tipo] || 'Plataforma multi-negocio'}
          </div>
        </div>

        {/* Nav scrollable */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 0.75rem' }}>
          {NAV_GROUPS.map((group, gi) => (
            <div key={gi} style={{ marginBottom: 4 }}>
              {group.label && (
                <div style={{
                  fontSize: 10, fontWeight: 700, color: '#475569',
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                  padding: '10px 10px 4px',
                }}>
                  {group.label}
                </div>
              )}
              {group.items.filter(i => !i.soloAdmin || user.rol === 'admin').map(({ to, label, end }) => (
                <NavLink key={to} to={to} end={end}
                  style={({ isActive }) => ({
                    display:        'flex',
                    alignItems:     'center',
                    padding:        '7px 10px',
                    borderRadius:   6,
                    marginBottom:   1,
                    fontSize:       13.5,
                    textDecoration: 'none',
                    fontWeight:     isActive ? 600 : 400,
                    color:          isActive ? '#fff' : '#94a3b8',
                    background:     isActive ? '#1e40af' : 'transparent',
                    transition:     'background 0.1s, color 0.1s',
                  })}
                >
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Pie */}
        <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid #1e293b' }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {user.nombre || 'Usuario'}
          </div>
          <button onClick={logout} style={{
            width: '100%', padding: '6px 10px', background: 'none',
            border: '1px solid #1e293b', borderRadius: 6,
            color: '#64748b', fontSize: 12, cursor: 'pointer', textAlign: 'left',
          }}>
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* ── Contenido ── */}
      <main style={{ flex: 1, overflow: 'auto', background: '#f8fafc' }}>
        <div style={{ padding: '2rem' }}>
          {/* Las páginas esperan la lista de negocios para no pedir datos de uno no asignado */}
          {cargandoNegocios ? (
            <div style={{ color: '#94a3b8' }}>Cargando…</div>
          ) : errorNegocios ? (
            <div style={{ background: '#fef2f2', color: '#b91c1c', borderRadius: 6, padding: '8px 12px', fontSize: 13 }}>
              {errorNegocios}
            </div>
          ) : !negocioActual ? (
            <div style={{ color: '#64748b' }}>Tu usuario no tiene negocios asignados.</div>
          ) : (
            <Outlet />
          )}
        </div>
      </main>

    </div>
  )
}
