import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Landing   from './pages/Landing'
import Login     from './pages/Login'
import Dashboard from './pages/Dashboard'
import CRM       from './pages/CRM'
import Catalogo   from './pages/Catalogo'
import Cotizaciones from './pages/Cotizaciones'
import Pedidos from './pages/Pedidos'
import Facturacion from './pages/Facturacion'
import Finanzas from './pages/Finanzas'
import Contabilidad from './pages/Contabilidad'
import Inventario from './pages/Inventario'
import Reportes  from './pages/Reportes'
import Personal   from './pages/Personal'
import Negocios   from './pages/Negocios'
import Usuarios   from './pages/Usuarios'
import Pacientes   from './pages/Pacientes'
import Resultados  from './pages/Resultados'
import Portal, { PortalAcceso } from './pages/Portal'
import ExpedientesPage   from './modules/clinica/ExpedientesPage'
import ExpedienteDetalle from './modules/clinica/ExpedienteDetalle'
import AgendaPage        from './modules/clinica/AgendaPage'
import AgendaDiaPage     from './modules/clinica/AgendaDiaPage'
import RecetasPage       from './modules/clinica/RecetasPage'
import VerificarReceta   from './modules/clinica/VerificarReceta'
import FarmaciaPage      from './modules/clinica/FarmaciaPage'
import Layout    from './components/Layout'
import { NegocioProvider } from './context/NegocioContext'

function RequireAuth({ children }) {
  const { pathname } = useLocation()
  if (localStorage.getItem('token')) return children
  // Visitantes sin sesión en la raíz ven la landing; en rutas internas, el login
  return <Navigate to={pathname === '/' ? '/inicio' : '/login'} replace />
}

export default function App() {
  return (
    <NegocioProvider>
      <BrowserRouter>
        <Routes>

          <Route path="/inicio" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/portal" element={<Portal />} />
          <Route path="/portal/acceso" element={<PortalAcceso />} />
          <Route path="/rx/verificar/:folio" element={<VerificarReceta />} />

          <Route
            path="/"
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Dashboard />} />

            <Route path="crm/*" element={<CRM />} />

            <Route
              path="catalogo/*"
              element={<Catalogo />}
            />

            <Route
              path="cotizaciones/*"
              element={<Cotizaciones />}
            />

            <Route
              path="pedidos/*"
              element={<Pedidos />}
            />

            <Route
              path="facturacion/*"
              element={<Facturacion />}
            />

            <Route
              path="finanzas/*"
              element={<Finanzas />}
            />

            <Route
              path="contabilidad/*"
              element={<Contabilidad />}
            />

            <Route
              path="inventario/*"
              element={<Inventario />}
            />

            <Route
              path="reportes/*"
              element={<Reportes />}
            />

            <Route
              path="personal/*"
              element={<Personal />}
            />

            <Route path="negocios" element={<Negocios />} />
            <Route path="usuarios" element={<Usuarios />} />

            <Route
              path="pacientes/*"
              element={<Pacientes />}
            />

            <Route
              path="resultados/*"
              element={<Resultados />}
            />

            <Route path="clinica/expedientes" element={<ExpedientesPage />} />
            <Route path="clinica/expedientes/:id" element={<ExpedienteDetalle />} />
            <Route path="clinica/agenda" element={<AgendaPage />} />
            <Route path="clinica/agenda/dia" element={<AgendaDiaPage />} />
            <Route path="clinica/recetas" element={<RecetasPage />} />
            <Route path="clinica/farmacia" element={<FarmaciaPage />} />
          </Route>

          <Route
            path="*"
            element={<Navigate to="/" replace />}
          />

        </Routes>
      </BrowserRouter>
    </NegocioProvider>
  )
}

function Stub({ nombre }) {
  return (
    <div
      style={{
        padding: '2rem',
        color: '#64748b',
        fontSize: 14,
      }}
    >
      <strong
        style={{
          color: '#1e293b',
          fontSize: 18,
        }}
      >
        {nombre}
      </strong>

      <p style={{ marginTop: 8 }}>
        Módulo en construcción — scaffold listo.
      </p>
    </div>
  )
}