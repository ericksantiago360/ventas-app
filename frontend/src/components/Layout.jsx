import { useEffect, useState } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useNegocio } from '../context/NegocioContext'
import { req, qs } from '../modules/clinica/comun'
import { PermisosProvider, usePermisosClinica } from '../modules/clinica/permisos'
import useEsMovil from '../hooks/useEsMovil'

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
      { to: '/resultados', label: 'Resultados', badge: 'lab', permisoLab: 'lab:read' },
    ],
  },
  {
    label: 'Clínica',
    items: [
      { to: '/clinica/agenda',      label: 'Agenda',      permiso: 'citas:read' },
      { to: '/clinica/expedientes', label: 'Expedientes', permiso: 'expedientes:read' },
      { to: '/clinica/recetas',     label: 'Recetas',     permiso: 'recetas:read' },
      { to: '/clinica/farmacia',    label: 'Farmacia',    permiso: 'farmacia:read', badge: 'farmacia' },
      { to: '/clinica/consentimientos', label: 'Consentimientos', permiso: 'consentimientos:read' },
    ],
  },
  {
    label: 'Carta Porte',
    items: [
      { to: '/carta-porte',            label: 'Cartas porte', end: true },
      { to: '/carta-porte/flota',      label: 'Mi flota', badge: 'carta_porte' },
      { to: '/carta-porte/operadores', label: 'Operadores' },
    ],
  },
  {
    label: 'Comercial',
    items: [
      { to: '/crm',          label: 'CRM'          },
      { to: '/catalogo',     label: 'Catálogo'     },
      { to: '/cotizaciones', label: 'Cotizaciones' },
      { to: '/pedidos',      label: 'Pedidos'      },
      { to: '/mostrador',    label: 'Mostrador'    },
      { to: '/facturacion',  label: 'Facturación'  },
    ],
  },
  {
    label: 'Tienda en línea',
    items: [
      { to: '/tienda',           label: 'Configuración', end: true },
      { to: '/tienda/productos', label: 'Productos' },
      { to: '/tienda/ordenes',   label: 'Órdenes' },
    ],
  },
  {
    label: 'Administración',
    items: [
      { to: '/finanzas',     label: 'Finanzas'     },
      { to: '/contabilidad', label: 'Contabilidad' },
      { to: '/inventario',   label: 'Inventario'   },
      { to: '/fabricacion',  label: 'Fabricación'  },
      { to: '/compras',      label: 'Compras'      },
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

const ALTO_PESTANAS = 58
const ANCHO_BARRA = 220

// Trazos de 24×24 para las pestañas inferiores del celular
const ICONOS = {
  inicio:     'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  pacientes:  'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  resultados: 'M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7 15h10',
  pedidos:    'M6 2l-3 4v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0',
  crm:        'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M22 11h-6',
  cotizaciones: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
  mas:        'M3 6h18M3 12h18M3 18h18',
}

// Las pestañas muestran lo que más se usa en cada giro; el resto vive en "Más"
function pestanasPara(tipo) {
  const medio = tipo === 'laboratorio_clinico'
    ? [{ to: '/pacientes', label: 'Pacientes', icono: 'pacientes' }, { to: '/resultados', label: 'Resultados', icono: 'resultados' }]
    : [{ to: '/crm', label: 'Clientes', icono: 'crm' }, { to: '/cotizaciones', label: 'Cotizar', icono: 'cotizaciones' }]
  return [
    { to: '/', label: 'Inicio', icono: 'inicio', end: true },
    ...medio,
    { to: '/pedidos', label: 'Pedidos', icono: 'pedidos' },
  ]
}

function Icono({ nombre, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONOS[nombre]} />
    </svg>
  )
}

function useEnLinea() {
  const [enLinea, setEnLinea] = useState(() => navigator.onLine)
  useEffect(() => {
    const si = () => setEnLinea(true)
    const no = () => setEnLinea(false)
    window.addEventListener('online', si)
    window.addEventListener('offline', no)
    return () => {
      window.removeEventListener('online', si)
      window.removeEventListener('offline', no)
    }
  }, [])
  return enLinea
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

// Conteo para un badge del menú. Se actualiza al cambiar de negocio, cuando la página
// avisa con el evento `evento` y cada 5 minutos.
function useConteo(url, evento, contar) {
  const [total, setTotal] = useState(0)
  useEffect(() => {
    if (!url) return
    let vigente = true
    const cargar = () => req(url).then(d => { if (vigente) setTotal(contar(d)) }).catch(() => {})
    cargar()
    const t = setInterval(() => { if (!document.hidden) cargar() }, 5 * 60_000)
    window.addEventListener(evento, cargar)
    return () => { vigente = false; clearInterval(t); window.removeEventListener(evento, cargar) }
  }, [url])
  return total
}

export default function Layout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const user = JSON.parse(localStorage.getItem('user') || '{}')
  const { negocioActual, cargandoNegocios, errorNegocios } = useNegocio()
  const esMovil = useEsMovil()
  const instalar = useInstalarApp()
  const enLinea = useEnLinea()
  const [menuAbierto, setMenuAbierto] = useState(false)
  const negocio = negocioActual?.id
  const permisos = usePermisosClinica(negocio)
  const badges = {
    // Stock bajo, por caducar y caducados
    farmacia: useConteo(negocio && permisos.puede('farmacia:read') && `/api/clinica/farmacia/alertas?${qs({ negocio_id: negocio })}`, 'farmacia:cambio', a => a.total),
    // Órdenes con resultados críticos que el médico aún no conoce
    // Seguros y licencias vencidos o por vencer
    carta_porte: useConteo(negocio && `/api/carta-porte/alertas?${qs({ negocio_id: negocio })}`, 'carta-porte:cambio', a => a.total),
    lab: useConteo(negocio && permisos.puedeLab('lab:read') && `/api/lab/ordenes?${qs({ negocio_id: negocio, criticos: true })}`, 'lab:cambio', o => o.length),
  }

  // Al navegar desde el cajón del menú, se cierra solo
  useEffect(() => { setMenuAbierto(false) }, [pathname])

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    navigate('/login')
  }

  const titulo = negocioActual?.nombre || 'Gestión'

  // Opciones del menú que el rol de clínica permite; un grupo sin opciones no se muestra
  const grupos = NAV_GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => (!i.soloAdmin || user.rol === 'admin') && (!i.permiso || permisos.puede(i.permiso))
        && (!i.permisoLab || permisos.puedeLab(i.permisoLab))) }))
    .filter(g => g.items.length)

  return (
    <PermisosProvider value={permisos}>
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
            <Icono nombre="mas" />
          </button>
          <div style={{ fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {titulo}
          </div>
        </header>
      )}

      {/* ── Pestañas inferiores (celular) ── */}
      {esMovil && (
        <nav style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 900,
          background: 'rgba(255,255,255,.96)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          borderTop: '1px solid #e2e8f0',
          display: 'flex',
          height: `calc(${ALTO_PESTANAS}px + env(safe-area-inset-bottom))`,
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}>
          {pestanasPara(negocioActual?.tipo).map(({ to, label, icono, end }) => (
            <NavLink key={to} to={to} end={end} style={({ isActive }) => ({
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
              textDecoration: 'none', fontSize: 11, fontWeight: isActive ? 600 : 500,
              color: isActive ? '#1e40af' : '#64748b',
            })}>
              <Icono nombre={icono} />
              {label}
            </NavLink>
          ))}
          <button onClick={() => setMenuAbierto(true)} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
            background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 500, color: '#64748b',
          }}>
            <Icono nombre="mas" />
            Más
          </button>
        </nav>
      )}

      {/* Aviso sin conexión: los datos siempre vienen del servidor */}
      {!enLinea && (
        <div role="status" style={{
          position: 'fixed', left: 12, right: 12, zIndex: 1100,
          ...(esMovil ? { bottom: `calc(${ALTO_PESTANAS + 10}px + env(safe-area-inset-bottom))` } : { bottom: 16, left: ANCHO_BARRA + 16, right: 16 }),
          background: '#1e293b', color: '#f8fafc', borderRadius: 10, padding: '10px 14px',
          fontSize: 13, boxShadow: '0 8px 24px rgba(15,23,42,.3)', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: '#f59e0b', flexShrink: 0 }} />
          Sin conexión. Lo que veas puede no estar actualizado hasta que vuelva la señal.
        </div>
      )}

      {/* Fondo oscuro detrás del cajón */}
      {esMovil && menuAbierto && (
        <div onClick={() => setMenuAbierto(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 950,
        }} />
      )}

      {/* ── Sidebar ── */}
      <aside style={{
        width: esMovil ? 260 : ANCHO_BARRA, flexShrink: 0,
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
          {grupos.map((group, gi) => (
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
              {group.items.map(({ to, label, end, badge }) => (
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
                  {badges[badge] > 0 && (
                    <span title={{ lab: 'Resultados críticos sin avisar', farmacia: 'Alertas de farmacia', carta_porte: 'Seguros o licencias por vencer' }[badge]} style={{
                      marginLeft: 'auto', background: '#dc2626', color: '#fff', borderRadius: 999,
                      minWidth: 18, height: 18, padding: '0 5px', fontSize: 11, fontWeight: 700,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
                    }}>{badges[badge] > 99 ? '99+' : badges[badge]}</span>
                  )}
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
          padding: esMovil ? '1rem' : '1.5rem',
          paddingBottom: esMovil ? `calc(1rem + ${ALTO_PESTANAS}px + env(safe-area-inset-bottom))` : '1.5rem',
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
    </PermisosProvider>
  )
}
