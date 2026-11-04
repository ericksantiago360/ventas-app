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
import Compras from './pages/Compras'
import Mostrador from './pages/Mostrador'
import Fabricacion from './pages/Fabricacion'
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
import ConsentimientosPage from './modules/clinica/ConsentimientosPage'
import { RequierePermiso } from './modules/clinica/permisos'
import TiendaConfigPage     from './modules/ecommerce/TiendaConfigPage'
import TiendaProductosPage  from './modules/ecommerce/TiendaProductosPage'
import TiendaOrdenesPage    from './modules/ecommerce/TiendaOrdenesPage'
import TiendaOrdenDetalle   from './modules/ecommerce/TiendaOrdenDetalle'
import CartaPortePage       from './modules/carta_porte/CartaPortePage'
import NuevaCartaPortePage  from './modules/carta_porte/NuevaCartaPortePage'
import CartaPorteDetalle    from './modules/carta_porte/CartaPorteDetalle'
import FlotaPage            from './modules/carta_porte/flota/FlotaPage'
import OperadoresPage       from './modules/carta_porte/operadores/OperadoresPage'
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
              path="compras/*"
              element={<Compras />}
            />

            <Route
              path="mostrador/*"
              element={<Mostrador />}
            />

            <Route
              path="fabricacion/*"
              element={<Fabricacion />}
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

            <Route path="clinica/expedientes" element={<RequierePermiso permiso="expedientes:read"><ExpedientesPage /></RequierePermiso>} />
            <Route path="clinica/expedientes/:id" element={<RequierePermiso permiso="expedientes:read"><ExpedienteDetalle /></RequierePermiso>} />
            <Route path="clinica/agenda" element={<RequierePermiso permiso="citas:read"><AgendaPage /></RequierePermiso>} />
            <Route path="clinica/agenda/dia" element={<RequierePermiso permiso="citas:read"><AgendaDiaPage /></RequierePermiso>} />
            <Route path="clinica/recetas" element={<RequierePermiso permiso="recetas:read"><RecetasPage /></RequierePermiso>} />
            <Route path="clinica/farmacia" element={<RequierePermiso permiso="farmacia:read"><FarmaciaPage /></RequierePermiso>} />
            <Route path="tienda" element={<TiendaConfigPage />} />
            <Route path="tienda/productos" element={<TiendaProductosPage />} />
            <Route path="ecommerce/ordenes" element={<TiendaOrdenesPage />} />
            <Route path="ecommerce/ordenes/:id" element={<TiendaOrdenDetalle />} />
            <Route path="carta-porte" element={<CartaPortePage />} />
            <Route path="carta-porte/nueva" element={<NuevaCartaPortePage />} />
            <Route path="carta-porte/flota" element={<FlotaPage />} />
            <Route path="carta-porte/operadores" element={<OperadoresPage />} />
            <Route path="carta-porte/:id" element={<CartaPorteDetalle />} />
            <Route path="carta-porte/:id/editar" element={<NuevaCartaPortePage />} />
            <Route path="clinica/consentimientos" element={<RequierePermiso permiso="consentimientos:read"><ConsentimientosPage /></RequierePermiso>} />
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