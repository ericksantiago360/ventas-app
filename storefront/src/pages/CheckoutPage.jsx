import { useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { tiendaApi, dinero } from '../api'
import { useCarrito } from '../context/CartContext'
import PagoInstrucciones from '../components/PagoInstrucciones'

const PASOS = ['Tus datos', 'Entrega y pago', 'Confirmación']

const VACIO = {
  nombre: '', email: '', telefono: '', notas: '', cita: '',
  calle: '', numero: '', colonia: '', ciudad: '', estado: '', cp: '',
}

const ETIQUETA_METODO = { transferencia: 'Transferencia SPEI', oxxo_cie: 'Pago en OXXO (CIE)' }

// Indicador de pasos. `actual` = índice del paso activo; con PASOS.length todos quedan completados.
function Pasos({ actual }) {
  return (
    <ol className="stepper" aria-label="Pasos de tu pedido">
      {PASOS.map((nombre, i) => (
        <li
          key={nombre}
          className={i < actual ? 'hecho' : i === actual ? 'activo' : ''}
          aria-current={i === actual ? 'step' : undefined}
        >
          <span>{i < actual ? '✓' : i + 1}</span>
          {nombre}
        </li>
      ))}
    </ol>
  )
}

export default function CheckoutPage() {
  const { slug, config } = useOutletContext()
  const { items, total, vaciar } = useCarrito()
  const navigate = useNavigate()

  const [paso, setPaso] = useState(0)
  const [form, setForm] = useState(VACIO)
  const [metodo, setMetodo] = useState(config.metodos_pago[0]?.tipo || '')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  // Respuesta del servidor tras confirmar; mientras exista se muestra el paso 3 con instrucciones
  const [confirmada, setConfirmada] = useState(null)

  const propiedades = config.modo === 'propiedades'
  const cotizacion = !config.mostrar_precio && !propiedades
  const conPago = !propiedades && !cotizacion
  const hayServicio = items.some(i => i.tipo === 'servicio')
  const opcionesEntrega = [
    config.entrega_recoger && 'recoger',
    config.entrega_envio && 'envio',
  ].filter(Boolean)
  const [entrega, setEntrega] = useState(opcionesEntrega[0] || 'recoger')
  const conEnvio = conPago && entrega === 'envio'
  const sinMetodos = conPago && config.metodos_pago.length === 0
  // Vista previa: el servidor calcula el costo real al confirmar
  const envioGratis = config.monto_envio_gratis > 0 && total >= config.monto_envio_gratis
  const costoEnvioPreview = envioGratis ? 0 : Number(config.costo_envio) || 0
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const titulo = propiedades ? 'Quiero que me contacten' : cotizacion ? 'Solicitud de cotización' : 'Finalizar compra'

  // Paso 3 ya enviado: confirmación con instrucciones de pago (el carrito ya se vació)
  if (confirmada) {
    const instrucciones = confirmada.instrucciones_pago
    return (
      <div style={{ maxWidth: 720, margin: '16px auto' }}>
        <h1 style={{ fontSize: 20, marginTop: 0 }}>{titulo}</h1>
        <Pasos actual={PASOS.length} />
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="exito">¡Gracias! Tu orden <strong>{confirmada.folio}</strong> está registrada.</div>

          {instrucciones ? (
            <>
              <p style={{ marginTop: 0 }}>
                Para confirmar tu pedido, realiza el pago con estos datos. Incluye la referencia para que lo identifiquemos.
              </p>
              <PagoInstrucciones instrucciones={instrucciones} />
            </>
          ) : (
            <p style={{ marginTop: 0 }}>
              {confirmada.tipo === 'contacto'
                ? 'Recibimos tu interés. Un asesor se comunicará contigo.'
                : 'Recibimos tu solicitud de cotización. Te responderemos con el detalle y el precio.'}
            </p>
          )}

          <p className="muted" style={{ fontSize: 13 }}>
            Te enviamos estos datos a tu correo. Puedes consultar el estado de tu orden en cualquier momento.
          </p>
          <Link className="btn secundario" to={`/${slug}/orden/${confirmada.folio}`}>Consultar estado</Link>
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="panel" style={{ marginTop: 16 }}>
        <p style={{ marginTop: 0 }}>No hay nada en tu carrito.</p>
        <button className="btn" onClick={() => navigate(`/${slug}/catalogo`)}>Ir al catálogo</button>
      </div>
    )
  }

  const continuarDatos = (e) => {
    e.preventDefault()
    setError('')
    if (!form.nombre.trim()) { setError('Escribe tu nombre completo'); return }
    if (!form.email.includes('@')) { setError('Escribe un correo electrónico válido'); return }
    if (form.telefono.replace(/\D/g, '').length < 10) { setError('El teléfono debe tener al menos 10 dígitos'); return }
    setPaso(1)
  }

  const continuarEntrega = (e) => {
    e.preventDefault()
    setError('')
    if (conPago && !metodo) { setError('Elige un método de pago'); return }
    if (conEnvio && (!form.calle.trim() || !form.ciudad.trim() || !form.cp.trim())) {
      setError('Para envío a domicilio escribe calle, ciudad y C.P.')
      return
    }
    setPaso(2)
  }

  const volver = (destino) => () => {
    setError('')
    setPaso(destino)
  }

  const confirmar = async () => {
    setError('')
    setEnviando(true)
    const direccion = ['calle', 'numero', 'colonia', 'ciudad', 'estado', 'cp']
      .reduce((acc, k) => ({ ...acc, [k]: form[k].trim() }), {})
    const cuerpo = {
      cliente: {
        nombre: form.nombre.trim(), email: form.email.trim(), telefono: form.telefono.trim(),
        direccion_envio: direccion,
      },
      // Solo referencias: el precio lo calcula el servidor
      partidas: items.map(i => ({ producto_id: i.producto_id, variante_id: i.variante_id, cantidad: i.cantidad })),
      notas: form.notas,
      ...(conPago ? { metodo_pago: metodo, entrega } : {}),
      ...(hayServicio && form.cita ? { cita_solicitada: new Date(form.cita).toISOString() } : {}),
    }
    try {
      const respuesta = await tiendaApi.checkout(slug, cuerpo)
      vaciar()
      setConfirmada(respuesta)
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div style={{ maxWidth: 1000, margin: '16px auto' }}>
      <h1 style={{ fontSize: 20, marginTop: 0 }}>{titulo}</h1>
      <Pasos actual={paso} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 20, marginTop: 16 }}>
        <div className="panel">
          {error && <div className="error">{error}</div>}

          {/* Paso 1: datos del cliente */}
          {paso === 0 && (
            <form onSubmit={continuarDatos}>
              <div className="seccion" style={{ marginTop: 0 }}>Tus datos</div>
              <div className="dos">
                <div className="campo"><label htmlFor="ck-nombre">Nombre completo</label><input id="ck-nombre" required value={form.nombre} onChange={set('nombre')} /></div>
                <div className="campo"><label htmlFor="ck-telefono">Teléfono</label><input id="ck-telefono" required value={form.telefono} onChange={set('telefono')} /></div>
              </div>
              <div className="campo">
                <label htmlFor="ck-email">Correo (aquí recibirás el folio y las instrucciones)</label>
                <input id="ck-email" type="email" required value={form.email} onChange={set('email')} />
              </div>
              <div className="campo">
                <label htmlFor="ck-notas">Comentarios (opcional)</label>
                <textarea id="ck-notas" rows={3} value={form.notas} onChange={set('notas')} />
              </div>
              <div className="acciones">
                <button className="btn" type="submit">Continuar</button>
              </div>
            </form>
          )}

          {/* Paso 2: entrega y pago */}
          {paso === 1 && (
            <form onSubmit={continuarEntrega}>
              {hayServicio && (
                <>
                  <div className="seccion" style={{ marginTop: 0 }}>Agenda</div>
                  <div className="campo">
                    <label htmlFor="ck-cita">Fecha y hora preferida para tu cita</label>
                    <input id="ck-cita" type="datetime-local" value={form.cita} onChange={set('cita')} />
                  </div>
                </>
              )}

              {!conPago && (
                <p className="muted">Tu solicitud no requiere pago en línea. Revisa tus datos y envíala en el siguiente paso.</p>
              )}

              {conPago && opcionesEntrega.length > 0 && (
                <>
                  <div className="seccion" style={{ marginTop: hayServicio ? 16 : 0 }}>¿Cómo quieres recibir tu pedido?</div>
                  {opcionesEntrega.map(op => (
                    <label key={op} className="opcion-entrega">
                      <input type="radio" name="entrega" value={op} checked={entrega === op} onChange={() => setEntrega(op)} />
                      <div>
                        {op === 'recoger' ? (
                          <>
                            <strong>Recoger en tienda</strong>
                            <span>Sin costo adicional</span>
                          </>
                        ) : (
                          <>
                            <strong>Envío a domicilio</strong>
                            <span>
                              {envioGratis ? 'Gratis en tu pedido'
                                : costoEnvioPreview > 0 ? `${dinero(costoEnvioPreview)} ${config.moneda || 'MXN'}`
                                : 'Costo por confirmar'}
                            </span>
                            {config.tiempo_entrega && <span>{config.tiempo_entrega}</span>}
                          </>
                        )}
                      </div>
                    </label>
                  ))}
                </>
              )}

              {conEnvio && (
                <>
                  <div className="seccion">Dirección de envío</div>
                  <div className="dos">
                    <div className="campo"><label htmlFor="ck-calle">Calle</label><input id="ck-calle" value={form.calle} onChange={set('calle')} /></div>
                    <div className="campo"><label htmlFor="ck-numero">Número</label><input id="ck-numero" value={form.numero} onChange={set('numero')} /></div>
                    <div className="campo"><label htmlFor="ck-colonia">Colonia</label><input id="ck-colonia" value={form.colonia} onChange={set('colonia')} /></div>
                    <div className="campo"><label htmlFor="ck-ciudad">Ciudad</label><input id="ck-ciudad" value={form.ciudad} onChange={set('ciudad')} /></div>
                    <div className="campo"><label htmlFor="ck-estado">Estado</label><input id="ck-estado" value={form.estado} onChange={set('estado')} /></div>
                    <div className="campo"><label htmlFor="ck-cp">C.P.</label><input id="ck-cp" value={form.cp} onChange={set('cp')} /></div>
                  </div>
                </>
              )}

              {conPago && (
                <>
                  <div className="seccion">Método de pago</div>
                  {sinMetodos && (
                    <div className="error">Esta tienda aún no tiene métodos de pago. Escríbenos para completar tu compra.</div>
                  )}
                  {config.metodos_pago.map(m => (
                    <label key={m.tipo} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', cursor: 'pointer' }}>
                      <input type="radio" name="metodo" checked={metodo === m.tipo} onChange={() => setMetodo(m.tipo)} />
                      <span>{ETIQUETA_METODO[m.tipo] || m.tipo}</span>
                    </label>
                  ))}
                </>
              )}

              <div className="acciones">
                <button className="btn secundario" type="button" onClick={volver(0)}>Atrás</button>
                <button className="btn" type="submit" disabled={sinMetodos}>Continuar</button>
              </div>
            </form>
          )}

          {/* Paso 3: revisión y confirmación */}
          {paso === 2 && (
            <div>
              <div className="seccion" style={{ marginTop: 0 }}>Revisa tu pedido</div>

              <div className="resumen"><span className="muted">Nombre</span><span>{form.nombre}</span></div>
              <div className="resumen"><span className="muted">Correo</span><span>{form.email}</span></div>
              <div className="resumen"><span className="muted">Teléfono</span><span>{form.telefono}</span></div>
              {form.notas.trim() && (
                <div className="resumen"><span className="muted">Comentarios</span><span>{form.notas}</span></div>
              )}
              {hayServicio && form.cita && (
                <div className="resumen"><span className="muted">Cita</span><span>{new Date(form.cita).toLocaleString('es-MX')}</span></div>
              )}
              {conPago && (
                <>
                  <div className="resumen">
                    <span className="muted">Entrega</span>
                    <span>{entrega === 'envio' ? 'Envío a domicilio' : 'Recoger en tienda'}</span>
                  </div>
                  <div className="resumen">
                    <span className="muted">Pago</span>
                    <span>{ETIQUETA_METODO[metodo] || metodo}</span>
                  </div>
                </>
              )}

              {conPago && (
                <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
                  El total con impuestos{conEnvio ? ' y envío' : ''} se calcula al confirmar.
                </p>
              )}

              <div className="acciones">
                <button className="btn secundario" type="button" onClick={volver(1)} disabled={enviando}>Atrás</button>
                <button className="btn" type="button" onClick={confirmar} disabled={enviando || sinMetodos}>
                  {enviando
                    ? 'Enviando…'
                    : propiedades || cotizacion
                      ? 'Enviar'
                      : `Confirmar pedido${total ? ` · ${dinero(total)}` : ''}`}
                </button>
              </div>
            </div>
          )}
        </div>

        <aside className="panel" style={{ alignSelf: 'start' }}>
          <div className="seccion" style={{ marginTop: 0 }}>Tu selección</div>
          {items.map(i => (
            <div key={i.id} className="resumen"><span>{i.cantidad} × {i.nombre}</span></div>
          ))}
        </aside>
      </div>
    </div>
  )
}
