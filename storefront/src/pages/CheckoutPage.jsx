import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { tiendaApi, dinero } from '../api'
import { useCarrito } from '../context/CartContext'

const VACIO = { nombre: '', email: '', telefono: '', notas: '', cita: '',
  calle: '', numero: '', colonia: '', ciudad: '', estado: '', cp: '' }

export default function CheckoutPage() {
  const { slug, config } = useOutletContext()
  const { items, total, vaciar } = useCarrito()
  const navigate = useNavigate()
  const [form, setForm] = useState(VACIO)
  const [metodo, setMetodo] = useState(config.metodos_pago[0]?.tipo || '')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  const propiedades = config.modo === 'propiedades'
  const cotizacion = !config.mostrar_precio && !propiedades
  const conPago = !propiedades && !cotizacion
  const hayServicio = items.some(i => i.tipo === 'servicio')
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  if (items.length === 0) {
    return <div className="panel" style={{ marginTop: 16 }}><p style={{ marginTop: 0 }}>No hay nada en tu carrito.</p>
      <button className="btn" onClick={() => navigate(`/${slug}/catalogo`)}>Ir al catálogo</button></div>
  }

  const enviar = async (e) => {
    e.preventDefault()
    setError('')
    if (conPago && !metodo) { setError('Elige un método de pago'); return }
    setEnviando(true)
    const direccion = ['calle', 'numero', 'colonia', 'ciudad', 'estado', 'cp'].reduce((acc, k) => ({ ...acc, [k]: form[k].trim() }), {})
    const cuerpo = {
      cliente: {
        nombre: form.nombre.trim(), email: form.email.trim(), telefono: form.telefono.trim(),
        direccion_envio: direccion,
      },
      // Solo referencias: el precio lo calcula el servidor
      partidas: items.map(i => ({ producto_id: i.producto_id, variante_id: i.variante_id, cantidad: i.cantidad })),
      notas: form.notas,
      ...(conPago ? { metodo_pago: metodo } : {}),
      ...(hayServicio && form.cita ? { cita_solicitada: new Date(form.cita).toISOString() } : {}),
    }
    try {
      const orden = await tiendaApi.checkout(slug, cuerpo)
      vaciar()
      navigate(`/${slug}/confirmacion/${orden.folio}`, { state: { orden } })
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  const titulo = propiedades ? 'Quiero que me contacten' : cotizacion ? 'Solicitud de cotización' : 'Finalizar compra'
  const sinMetodos = conPago && config.metodos_pago.length === 0

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 20, marginTop: 16 }}>
      <form className="panel" onSubmit={enviar}>
        <h1 style={{ fontSize: 20, marginTop: 0 }}>{titulo}</h1>
        {error && <div className="error">{error}</div>}
        {sinMetodos && <div className="error">Esta tienda aún no tiene métodos de pago. Escríbenos para completar tu compra.</div>}

        <div className="dos">
          <div className="campo"><label>Nombre completo</label><input required value={form.nombre} onChange={set('nombre')} /></div>
          <div className="campo"><label>Teléfono</label><input required value={form.telefono} onChange={set('telefono')} /></div>
        </div>
        <div className="campo"><label>Correo (aquí recibirás el folio y las instrucciones)</label>
          <input type="email" required value={form.email} onChange={set('email')} /></div>

        {hayServicio && (
          <div className="campo"><label>Fecha y hora preferida para tu cita</label>
            <input type="datetime-local" value={form.cita} onChange={set('cita')} /></div>
        )}

        {conPago && (
          <>
            <div className="seccion">Dirección de envío (opcional)</div>
            <div className="dos">
              <div className="campo"><label>Calle</label><input value={form.calle} onChange={set('calle')} /></div>
              <div className="campo"><label>Número</label><input value={form.numero} onChange={set('numero')} /></div>
              <div className="campo"><label>Colonia</label><input value={form.colonia} onChange={set('colonia')} /></div>
              <div className="campo"><label>Ciudad</label><input value={form.ciudad} onChange={set('ciudad')} /></div>
              <div className="campo"><label>Estado</label><input value={form.estado} onChange={set('estado')} /></div>
              <div className="campo"><label>C.P.</label><input value={form.cp} onChange={set('cp')} /></div>
            </div>
          </>
        )}

        {conPago && config.metodos_pago.length > 0 && (
          <>
            <div className="seccion">Método de pago</div>
            {config.metodos_pago.map(m => (
              <label key={m.tipo} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', cursor: 'pointer' }}>
                <input type="radio" name="metodo" checked={metodo === m.tipo} onChange={() => setMetodo(m.tipo)} />
                <span>{m.tipo === 'transferencia' ? 'Transferencia SPEI' : 'Pago en OXXO (CIE)'}</span>
              </label>
            ))}
          </>
        )}

        <div className="campo" style={{ marginTop: 12 }}><label>Comentarios (opcional)</label>
          <textarea rows={3} value={form.notas} onChange={set('notas')} /></div>

        <button className="btn bloque" type="submit" disabled={enviando || sinMetodos}>
          {enviando ? 'Enviando…' : propiedades || cotizacion ? 'Enviar' : `Confirmar pedido${total ? ` · ${dinero(total)}` : ''}`}
        </button>
      </form>

      <aside className="panel" style={{ alignSelf: 'start' }}>
        <div className="seccion" style={{ marginTop: 0 }}>Tu selección</div>
        {items.map(i => (
          <div key={i.id} className="resumen"><span>{i.cantidad} × {i.nombre}</span></div>
        ))}
        {conPago && <p className="muted" style={{ fontSize: 12 }}>El total con impuestos aparece al confirmar.</p>}
      </aside>
    </div>
  )
}
