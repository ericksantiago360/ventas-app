import { Routes, Route } from 'react-router-dom'
import TiendaLayout from './components/TiendaLayout'
import TiendaHome from './pages/TiendaHome'
import CatalogPage from './pages/CatalogPage'
import ProductoPage from './pages/ProductoPage'
import CartPage from './pages/CartPage'
import CheckoutPage from './pages/CheckoutPage'
import ConfirmacionPage from './pages/ConfirmacionPage'
import OrdenStatusPage from './pages/OrdenStatusPage'

// Cada negocio vive en /tienda/{slug}/... (basename en main.jsx)
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<div className="contenedor" style={{ padding: '48px 0' }}>
        <div className="panel"><p style={{ margin: 0 }}>Abre el enlace de la tienda que te compartieron.</p></div>
      </div>} />
      <Route path=":slug" element={<TiendaLayout />}>
        <Route index element={<TiendaHome />} />
        <Route path="catalogo" element={<CatalogPage />} />
        <Route path="producto/:id" element={<ProductoPage />} />
        <Route path="carrito" element={<CartPage />} />
        <Route path="checkout" element={<CheckoutPage />} />
        <Route path="confirmacion/:folio" element={<ConfirmacionPage />} />
        <Route path="orden" element={<OrdenStatusPage />} />
        <Route path="orden/:folio" element={<OrdenStatusPage />} />
      </Route>
    </Routes>
  )
}
