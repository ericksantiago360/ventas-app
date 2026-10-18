import { useEffect, useState } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
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

const ANCHO_MOVIL = 768

function useEsMovil() {
  const consulta = `(max-width: ${ANCHO_MOVIL}px)`
  const [esMovil, setEsMovil] = useState(() => window.matchMedia(consulta).matches)
  useEffect(() => {
    const mq = window.matchMedia(consulta)
    const cambio = (e) => setEsMovil(e.matches)
    mq.addEventListener('change', cambio)
    return () => mq.removeEventListener('change', cambio)
  }, [consulta])
  return esMovil
}

// Chrome/Android ofrece instalar la app; iOS no tiene este evento (se instala desde Compartir)
function useInstalarApp() {
  const [aviso, setAviso] = useState(null)
  useEffect(() => {
    const guardar = (e) => { e.preventDefault(); setAviso(e) }
    const instalada = () => setAviso(null)
    window.addEventListener('beforeinstallprompt', guardar)
    window.addEventListener('appinstalled', instalada)
    return () => {
      window.removeEventListener('beforeinstallprompt', guardar)
      window.removeEventListener('appinstalled', instalada)
    }
  }, [])
  if (!aviso) return null
  return () => { aviso.prompt(); aviso.userChoice.finally(() => setAviso(null)) }
}

export default function Layout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const user = JSON.parse(localStorage.getItem('user') || '{}')
  const { negocioActual, cargandoNegocios, errorNegocios } = useNegocio()
  const esMovil = useEsMovil()
  const instalar = useInstalarApp()
  const [menuAbierto, setMenuAbierto] = useState(false)

  // Al navegar desde el cajón del menú, se cierra solo
  useEffect(() => { setMenuAbierto(false) }, [pathname])

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    navigate('/login')
  }

  const titulo = negocioActual?.nombre || 'Gestión'

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>

      {/* ── Barra superior (celular) ── */}
      {esMovil && (
        <header style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 900,
          background: '#0f172a', color: '#fff',
          display: 'flex', alignItems: 'center', gap: 10,
          padding: 'env(safe-area-inset-top) 12px 0',
          paddingLeft: 'max(12px, env(safe-area-inset-left))',
          height: 'calc(52px + env(safe-area-inset-top))',
        }}>
          <button onClick={() => setMenuAbierto(true)} aria-label="Abrir menú" style={{
            background: 'none', border: 'none', color: '#fff', cursor: 'pointer',
            width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <div style={{ fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {titulo}
          </div>
        </header>
      )}

      {/* Fondo oscuro detrás del cajón */}
      {esMovil && menuAbierto && (
        <div onClick={() => setMenuAbierto(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 950,
        }} />
      )}

      {/* ── Sidebar ── */}
      <aside style={{
        width: esMovil ? 260 : 220, flexShrink: 0,
        background: '#0f172a',
        display: 'flex', flexDirection: 'column',
        ...(esMovil ? {
          position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 1000,
          transform: menuAbierto ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.2s ease',
          boxShadow: menuAbierto ? '0 0 30px rgba(0,0,0,.4)' : 'none',
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        } : {
          position: 'sticky', top: 0, height: '100vh',
        }),
      }}>
        {/* Logo */}
        <div style={{ padding: '1.25rem 1.25rem 1rem', borderBottom: '1px solid #1e293b' }}>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{titulo}</div>
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
                    padding:        esMovil ? '11px 10px' : '7px 10px',
                    borderRadius:   6,
                    marginBottom:   1,
                    fontSize:       esMovil ? 15 : 13.5,
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
          {instalar && (
            <button onClick={instalar} style={{
              width: '100%', padding: '8px 10px', marginBottom: 8,
              background: '#1e40af', border: 'none', borderRadius: 6,
              color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>
              Instalar app
            </button>
          )}
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {user.nombre || 'Usuario'}
          </div>
          <button onClick={logout} style={{
            width: '100%', padding: esMovil ? '10px' : '6px 10px', background: 'none',
            border: '1px solid #1e293b', borderRadius: 6,
            color: '#64748b', fontSize: esMovil ? 14 : 12, cursor: 'pointer', textAlign: 'left',
          }}>
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* ── Contenido ── */}
      <main style={{
        flex: 1, minWidth: 0, overflow: 'auto', background: '#f8fafc',
        paddingTop: esMovil ? 'calc(52px + env(safe-area-inset-top))' : 0,
      }}>
        <div style={{
          padding: esMovil ? '1rem' : '2rem',
          paddingBottom: esMovil ? 'calc(1rem + env(safe-area-inset-bottom))' : '2rem',
        }}>
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
