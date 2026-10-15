import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login     from './pages/Login'
import Dashboard from './pages/Dashboard'
import CRM       from './pages/CRM'
import Catalogo   from './pages/Catalogo'
import Cotizaciones from './pages/Cotizaciones'
import Pedidos from './pages/Pedidos'
import Finanzas from './pages/Finanzas'
import Contabilidad from './pages/Contabilidad'
import Inventario from './pages/Inventario'
import Reportes  from './pages/Reportes'
import Personal   from './pages/Personal'
import Pacientes   from './pages/Pacientes'
import Resultados  from './pages/Resultados'
import Layout    from './components/Layout'
import { NegocioProvider } from './context/NegocioContext'

function RequireAuth({ children }) {
  return localStorage.getItem('token')
    ? children
    : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <NegocioProvider>
      <BrowserRouter>
        <Routes>

          <Route path="/login" element={<Login />} />

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

            <Route
              path="pacientes/*"
              element={<Pacientes />}
            />

            <Route
              path="resultados/*"
              element={<Resultados />}
            />
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