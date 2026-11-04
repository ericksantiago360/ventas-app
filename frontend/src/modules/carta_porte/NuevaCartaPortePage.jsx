import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useNegocio } from '../../context/NegocioContext'
import useEsMovil from '../../hooks/useEsMovil'
import EmisorModal from './EmisorModal'
import { MONEDAS } from '../../constants/catalogos'
import {
  req, qs, s, Campo, Chip, ChipVence, useCatalogos, descripcion, DomicilioForm, DOMICILIO_VACIO, textoDomicilio,
  aInputFecha, desdeInputFecha,
} from './comun'

const PASOS = ['Origen y destinos', 'Mercancías', 'Vehículo y operador', 'Resumen']

const manana = (h) => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, 0, 0, 0); return aInputFecha(d.toISOString()) }
const DESTINO_VACIO = () => ({ nombre_destinatario: '', rfc_destinatario: '', distancia_recorrida: '', fecha_hora_llegada: manana(14), domicilio: { ...DOMICILIO_VACIO } })
const MERCANCIA_VACIA = () => ({
  bienes_transp: '', producto: null, descripcion: '', cantidad: '', clave_unidad: 'H87', peso_kg: '', valor_mercancia: '',
  moneda: 'MXN', material_peligroso: null, cve_material_peligroso: '', embalaje: '', destino: 1,
})

// Buscador sobre los catálogos grandes del SAT (productos, materiales peligrosos)
function Buscador({ url, valor, etiqueta, placeholder, onElegir }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState([])
  const [abierto, setAbierto] = useState(false)
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return }
    const t = setTimeout(() => req(`${url}?${qs({ q })}`).then(setRes).catch(() => setRes([])), 250)
    return () => clearTimeout(t)
  }, [q, url])
  return (
    <div style={{ position: 'relative' }}>
      {valor && !abierto ? (
        <button type="button" onClick={() => { setAbierto(true); setQ('') }} style={{
          ...s.input, textAlign: 'left', background: '#fff', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{valor}</span> {etiqueta}
        </button>
      ) : (
        <input style={s.input} autoFocus={abierto} placeholder={placeholder} value={q} onChange={e => setQ(e.target.value)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)} />
      )}
      {res.length > 0 && (abierto || !valor) && (
        <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, maxHeight: 260, overflowY: 'auto', boxShadow: '0 6px 18px rgba(15,23,42,.12)' }}>
          {res.map(r => (
            <div key={r.clave} onMouseDown={() => { onElegir(r); setRes([]); setQ(''); setAbierto(false) }}
              style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.clave}</span> {r.descripcion}
              {r.material_peligroso === '1' && <span style={{ color: '#b91c1c', fontWeight: 700, fontSize: 11 }}> · material peligroso</span>}
              {r.similares && <div style={{ fontSize: 11, color: '#94a3b8' }}>{r.similares}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PasoRuta({ datos, setDatos }) {
  const setOrigen = (k, v) => setDatos(d => ({ ...d, origen: { ...d.origen, [k]: v } }))
  const setDestino = (i, k, v) => setDatos(d => ({ ...d, destinos: d.destinos.map((x, j) => j === i ? { ...x, [k]: v } : x) }))
  return (
    <>
      <div style={s.sect}>Origen</div>
      <div style={s.grid(220)}>
        <Campo label="Salida (fecha y hora) *">
          <input style={s.input} type="datetime-local" value={datos.origen.fecha_hora_salida} onChange={e => setOrigen('fecha_hora_salida', e.target.value)} />
        </Campo>
        <Campo label="Nombre del remitente">
          <input style={s.input} placeholder="Vacío: el negocio" value={datos.origen.nombre_remitente} onChange={e => setOrigen('nombre_remitente', e.target.value)} />
        </Campo>
      </div>
      <div style={{ marginTop: 10 }}><DomicilioForm valor={datos.origen.domicilio} onChange={d => setOrigen('domicilio', d)} /></div>

      {datos.destinos.map((d, i) => (
        <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, marginTop: 14, background: '#fcfdfe' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ ...s.sect, margin: 0 }}>Destino {i + 1}</div>
            {datos.destinos.length > 1 && (
              <button type="button" style={{ ...s.btn('ghost'), color: '#b91c1c' }}
                onClick={() => setDatos(x => ({ ...x, destinos: x.destinos.filter((_, j) => j !== i), mercancias: x.mercancias.map(m => ({ ...m, destino: Math.min(m.destino, x.destinos.length - 1) })) }))}>
                Quitar
              </button>
            )}
          </div>
          <div style={{ ...s.grid(180), marginTop: 8 }}>
            <Campo label="Llegada (fecha y hora) *">
              <input style={s.input} type="datetime-local" value={d.fecha_hora_llegada} onChange={e => setDestino(i, 'fecha_hora_llegada', e.target.value)} />
            </Campo>
            <Campo label={`Km desde ${i ? `el destino ${i}` : 'el origen'} *`}>
              <input style={s.input} type="number" min={0.01} step="0.01" inputMode="decimal" value={d.distancia_recorrida} onChange={e => setDestino(i, 'distancia_recorrida', e.target.value)} />
            </Campo>
            <Campo label="Destinatario">
              <input style={s.input} placeholder="Vacío: el negocio" value={d.nombre_destinatario} onChange={e => setDestino(i, 'nombre_destinatario', e.target.value)} />
            </Campo>
          </div>
          <div style={{ marginTop: 10 }}><DomicilioForm valor={d.domicilio} onChange={dom => setDestino(i, 'domicilio', dom)} /></div>
        </div>
      ))}
      <button type="button" style={{ ...s.btn('ghost'), marginTop: 10 }} onClick={() => setDatos(d => ({ ...d, destinos: [...d.destinos, DESTINO_VACIO()] }))}>
        + Agregar destino
      </button>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>Traslado propio: si no indicas otro, remitente y destinatario son el mismo negocio.</div>
    </>
  )
}

function PasoMercancias({ datos, setDatos, negocioId, cat }) {
  const [pedidos, setPedidos] = useState(null)
  const setM = (i, cambios) => setDatos(d => ({ ...d, mercancias: d.mercancias.map((m, j) => j === i ? { ...m, ...cambios } : m) }))

  function verPedidos() {
    req(`/api/pedidos/?${qs({ negocio_id: negocioId, limit: 30 })}`).then(r => setPedidos(r.data || [])).catch(() => setPedidos([]))
  }
  function importar(p) {
    const nuevas = (p.items || []).map(it => ({ ...MERCANCIA_VACIA(), descripcion: it.descripcion || '', cantidad: it.cantidad || '', valor_mercancia: it.importe ?? '' }))
    setDatos(d => ({ ...d, pedido_id: p.id, mercancias: [...d.mercancias.filter(m => m.descripcion || m.bienes_transp), ...nuevas] }))
    setPedidos(null)
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <button type="button" style={s.btn('ghost')} onClick={verPedidos}>Importar de un pedido</button>
        {datos.pedido_id && <Chip texto="Vinculada a un pedido" bg="#dbeafe" color="#1d4ed8" />}
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Después de importar, asigna a cada artículo su clave SAT y su peso.</span>
      </div>
      {pedidos && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, maxHeight: 200, overflowY: 'auto', marginBottom: 10 }}>
          {!pedidos.length && <div style={{ padding: 10, fontSize: 13, color: '#94a3b8' }}>Sin pedidos</div>}
          {pedidos.map(p => (
            <button key={p.id} type="button" onClick={() => importar(p)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', borderBottom: '1px solid #f1f5f9', background: '#fff', cursor: 'pointer', fontSize: 13 }}>
              <b>{p.numero || p.folio}</b> · {p.cliente_nombre} · {(p.items || []).length} artículos
            </button>
          ))}
        </div>
      )}

      {datos.mercancias.map((m, i) => {
        const bandera = m.producto?.material_peligroso ?? '0'
        const peligroso = bandera === '1' || (bandera === '0,1' && m.material_peligroso)
        return (
          <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, marginTop: 10, background: '#fcfdfe' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ fontWeight: 800, color: '#94a3b8', paddingTop: 8, width: 16 }}>{i + 1}</span>
              <div style={{ flex: 1 }}>
                <Buscador url="/api/carta-porte/catalogos/productos" valor={m.bienes_transp} etiqueta={m.producto?.descripcion || ''}
                  placeholder="Clave SAT de producto (c_ClaveProdServCP): busca por nombre o clave…"
                  onElegir={p => setM(i, { bienes_transp: p.clave, producto: p, descripcion: m.descripcion || p.descripcion,
                    material_peligroso: p.material_peligroso === '1' ? true : p.material_peligroso === '0' ? null : false })} />
              </div>
              <button type="button" style={s.btn('ghost')} aria-label="Quitar mercancía"
                onClick={() => setDatos(d => ({ ...d, mercancias: d.mercancias.length > 1 ? d.mercancias.filter((_, j) => j !== i) : [MERCANCIA_VACIA()] }))}>×</button>
            </div>
            <div style={{ ...s.grid(130), marginTop: 8, paddingLeft: 24 }}>
              <Campo label="Descripción *" style={{ gridColumn: '1 / -1' }}>
                <input style={s.input} value={m.descripcion} onChange={e => setM(i, { descripcion: e.target.value })} />
              </Campo>
              <Campo label="Cantidad *"><input style={s.input} type="number" min={0} step="any" inputMode="decimal" value={m.cantidad} onChange={e => setM(i, { cantidad: e.target.value })} /></Campo>
              <Campo label="Unidad *">
                <select style={s.input} value={m.clave_unidad} onChange={e => setM(i, { clave_unidad: e.target.value })}>
                  {(cat?.unidades_frecuentes || []).map(u => <option key={u.clave} value={u.clave}>{u.clave} · {u.descripcion}</option>)}
                  {!cat?.unidades_frecuentes.some(u => u.clave === m.clave_unidad) && <option value={m.clave_unidad}>{m.clave_unidad}</option>}
                </select>
              </Campo>
              <Campo label="Peso total (kg) *"><input style={s.input} type="number" min={0} step="0.001" inputMode="decimal" value={m.peso_kg} onChange={e => setM(i, { peso_kg: e.target.value })} /></Campo>
              <Campo label="Valor"><input style={s.input} type="number" min={0} step="0.01" inputMode="decimal" value={m.valor_mercancia} onChange={e => setM(i, { valor_mercancia: e.target.value })} /></Campo>
              <Campo label="Moneda">
                <select style={s.input} value={m.moneda} onChange={e => setM(i, { moneda: e.target.value })}>
                  {MONEDAS.map(mon => <option key={mon.value} value={mon.value}>{mon.label}</option>)}
                </select>
                {m.moneda !== 'MXN' && (
                  <p style={{fontSize:'.8rem', color:'var(--color-warning, #92400E)', marginTop:4}}>
                    💱 Tipo de cambio no incluido — el monto se registra en {m.moneda} tal como
                    se capture. Verifica la paridad al emitir la factura (SAT requiere tipo de cambio
                    en CFDI con moneda extranjera).
                  </p>
                )}
              </Campo>
              {datos.destinos.length > 1 && (
                <Campo label="Va al destino *">
                  <select style={s.input} value={m.destino} onChange={e => setM(i, { destino: Number(e.target.value) })}>
                    {datos.destinos.map((_, j) => <option key={j} value={j + 1}>Destino {j + 1}</option>)}
                  </select>
                </Campo>
              )}
            </div>
            {bandera === '0,1' && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginTop: 8, paddingLeft: 24 }}>
                <input type="checkbox" checked={Boolean(m.material_peligroso)} onChange={e => setM(i, { material_peligroso: e.target.checked })} />
                Se traslada como material peligroso
              </label>
            )}
            {peligroso && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 10, marginTop: 8, marginLeft: 24 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#b91c1c', marginBottom: 6 }}>
                  Material peligroso{bandera === '1' ? ' (así lo marca el catálogo del SAT para esta clave)' : ''}
                </div>
                <div style={s.grid(200)}>
                  <Campo label="Clave de material peligroso *">
                    <Buscador url="/api/carta-porte/catalogos/material-peligroso" valor={m.cve_material_peligroso} etiqueta=""
                      placeholder="Busca por nombre o número ONU…" onElegir={x => setM(i, { cve_material_peligroso: x.clave })} />
                  </Campo>
                  <Campo label="Embalaje *">
                    <select style={s.input} value={m.embalaje} onChange={e => setM(i, { embalaje: e.target.value })}>
                      <option value="">—</option>
                      {(cat?.tipo_embalaje || []).map(t => <option key={t.clave} value={t.clave}>{t.clave} · {t.descripcion}</option>)}
                    </select>
                  </Campo>
                </div>
              </div>
            )}
          </div>
        )
      })}
      <button type="button" style={{ ...s.btn('ghost'), marginTop: 10 }} onClick={() => setDatos(d => ({ ...d, mercancias: [...d.mercancias, MERCANCIA_VACIA()] }))}>
        + Agregar mercancía
      </button>
    </>
  )
}

function PasoFlota({ datos, setDatos, vehiculos, operadores, cat }) {
  const set = (k, v) => setDatos(d => ({ ...d, [k]: v }))
  const salida = datos.origen.fecha_hora_salida.slice(0, 10)
  const vencidoEn = (fecha) => fecha && fecha < salida
  return (
    <>
      <div style={s.sect}>Vehículo</div>
      {!vehiculos.length && <div style={s.err}>No hay vehículos. Regístralos en Mi flota.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {vehiculos.map(v => (
          <label key={v.id} style={{ display: 'flex', gap: 10, alignItems: 'center', border: datos.vehiculo_id === v.id ? '2px solid #3b82f6' : '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', background: '#fff' }}>
            <input type="radio" name="vehiculo" checked={datos.vehiculo_id === v.id} onChange={() => set('vehiculo_id', v.id)} />
            <span style={{ flex: 1, fontSize: 13 }}>
              <b>{v.nombre}</b> · <span style={{ fontFamily: 'monospace' }}>{v.placa}</span> · {v.config_vehicular}
              <span style={{ color: '#94a3b8' }}> {descripcion(cat?.config_autotransporte, v.config_vehicular).slice(0, 60)}</span>
            </span>
            {vencidoEn(v.seguro_resp_civil.fecha_vencimiento)
              ? <Chip texto="Seguro RC vencido a la salida" bg="#fee2e2" color="#b91c1c" />
              : <ChipVence fecha={v.seguro_resp_civil.fecha_vencimiento} que="Seguro RC" />}
          </label>
        ))}
      </div>

      <div style={s.sect}>Operador(es)</div>
      {!operadores.length && <div style={s.err}>No hay operadores. Regístralos en Operadores.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {operadores.map(o => {
          const elegido = datos.operador_ids.includes(o.id)
          return (
            <label key={o.id} style={{ display: 'flex', gap: 10, alignItems: 'center', border: elegido ? '2px solid #3b82f6' : '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', background: '#fff' }}>
              <input type="checkbox" checked={elegido}
                onChange={() => set('operador_ids', elegido ? datos.operador_ids.filter(x => x !== o.id) : [...datos.operador_ids, o.id])} />
              <span style={{ flex: 1, fontSize: 13 }}><b>{o.nombre}</b> · Lic. {o.num_licencia}</span>
              {vencidoEn(o.fecha_vencimiento_licencia)
                ? <Chip texto="Licencia vencida a la salida" bg="#fee2e2" color="#b91c1c" />
                : <ChipVence fecha={o.fecha_vencimiento_licencia} que="Licencia" />}
            </label>
          )
        })}
      </div>

      <div style={{ ...s.grid(200), marginTop: 14 }}>
        <Campo label="Unidad del peso total">
          <select style={s.input} value={datos.unidad_peso} onChange={e => set('unidad_peso', e.target.value)}>
            {(cat?.unidad_peso || []).map(u => <option key={u.clave} value={u.clave}>{u.clave} · {u.descripcion}</option>)}
          </select>
        </Campo>
      </div>
      <Campo label="Observaciones" style={{ marginTop: 10 }}>
        <textarea style={{ ...s.input, minHeight: 60, resize: 'vertical' }} value={datos.observaciones} onChange={e => set('observaciones', e.target.value)} />
      </Campo>
    </>
  )
}

function PasoResumen({ datos, vehiculos, operadores, emisor }) {
  const v = vehiculos.find(x => x.id === datos.vehiculo_id)
  const ops = operadores.filter(o => datos.operador_ids.includes(o.id))
  const peso = datos.mercancias.reduce((n, m) => n + Number(m.peso_kg || 0), 0)
  const km = datos.destinos.reduce((n, d) => n + Number(d.distancia_recorrida || 0), 0)
  const fila = (k, v) => <div style={{ display: 'flex', gap: 12, padding: '5px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}><span style={{ color: '#94a3b8', width: 130, flexShrink: 0 }}>{k}</span><span>{v}</span></div>
  return (
    <div>
      {fila('Emisor', `${emisor?.nombre} · ${emisor?.rfc}`)}
      {fila('Salida', `${new Date(datos.origen.fecha_hora_salida).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })} · ${textoDomicilio(datos.origen.domicilio)}`)}
      {datos.destinos.map((d, i) => fila(`Destino ${i + 1}`, `${d.nombre_destinatario || 'El negocio'} · ${textoDomicilio(d.domicilio)} · ${d.distancia_recorrida} km · llega ${new Date(d.fecha_hora_llegada).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`))}
      {fila('Distancia total', `${km.toLocaleString('es-MX')} km`)}
      {fila('Mercancías', `${datos.mercancias.length} · ${peso.toLocaleString('es-MX', { maximumFractionDigits: 3 })} kg`)}
      {datos.mercancias.map((m, i) => fila('', `${m.bienes_transp} · ${m.descripcion} · ${m.cantidad} ${m.clave_unidad} · ${m.peso_kg} kg${m.material_peligroso || m.producto?.material_peligroso === '1' ? ' · MATERIAL PELIGROSO' : ''}`))}
      {fila('Vehículo', v ? `${v.nombre} · ${v.placa} · ${v.config_vehicular}` : '—')}
      {fila('Operador(es)', ops.map(o => o.nombre).join(', ') || '—')}
      <div style={{ background: '#fef9c3', border: '1px solid #fde047', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#713f12', marginTop: 14 }}>
        Se guardará como borrador y se generarán el XML y el PDF internos. No tienen timbre fiscal: para que valgan ante el SAT hay que timbrarlos con un PAC.
      </div>
    </div>
  )
}

// Wizard para crear (o editar en borrador) una carta porte de traslado propio
export default function NuevaCartaPortePage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const esMovil = useEsMovil()
  const { negocioId } = useNegocio()
  const cat = useCatalogos()
  const [paso, setPaso] = useState(0)
  const [datos, setDatos] = useState(null)
  const [emisor, setEmisor] = useState(null)
  const [vehiculos, setVehiculos] = useState([])
  const [operadores, setOperadores] = useState([])
  const [modalEmisor, setModalEmisor] = useState(false)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!negocioId) return
    Promise.all([
      req(`/api/carta-porte/emisor?${qs({ negocio_id: negocioId })}`),
      req(`/api/carta-porte/vehiculos?${qs({ negocio_id: negocioId })}`),
      req(`/api/carta-porte/operadores?${qs({ negocio_id: negocioId })}`),
      id ? req(`/api/carta-porte/${id}`) : Promise.resolve(null),
    ]).then(([em, vs, os, actual]) => {
      setEmisor(em); setVehiculos(vs); setOperadores(os)
      if (actual) {
        if (actual.estado !== 'borrador') { navigate(`/carta-porte/${id}`, { replace: true }); return }
        setDatos({
          origen: { ...actual.origen, fecha_hora_salida: aInputFecha(actual.origen.fecha_hora_salida), domicilio: { ...DOMICILIO_VACIO, ...actual.origen.domicilio } },
          destinos: actual.destinos.map(d => ({ ...d, fecha_hora_llegada: aInputFecha(d.fecha_hora_llegada), domicilio: { ...DOMICILIO_VACIO, ...d.domicilio } })),
          mercancias: actual.mercancias.map(m => ({ ...MERCANCIA_VACIA(), ...m, valor_mercancia: m.valor_mercancia ?? '', producto: null })),
          unidad_peso: actual.unidad_peso, vehiculo_id: actual.vehiculo_id, operador_ids: actual.operadores.map(o => o.operador_id),
          pedido_id: actual.pedido_id || '', observaciones: actual.observaciones || '',
        })
        // El catálogo dice qué claves son material peligroso: se vuelve a consultar para cada una
        actual.mercancias.forEach((m, i) => req(`/api/carta-porte/catalogos/productos?${qs({ q: m.bienes_transp })}`).then(r => {
          const p = r.find(x => x.clave === m.bienes_transp)
          if (p) setDatos(d => ({ ...d, mercancias: d.mercancias.map((x, j) => j === i ? { ...x, producto: p } : x) }))
        }))
      } else {
        setDatos({
          origen: { nombre_remitente: '', rfc_remitente: '', fecha_hora_salida: manana(8), domicilio: { ...DOMICILIO_VACIO, ...(em.domicilio_salida || {}) } },
          destinos: [DESTINO_VACIO()], mercancias: [MERCANCIA_VACIA()], unidad_peso: 'KGM',
          vehiculo_id: vs.length === 1 ? vs[0].id : '', operador_ids: os.length === 1 ? [os[0].id] : [],
          pedido_id: params.get('pedido') || '', observaciones: '',
        })
      }
    }).catch(e => setError(e.message))
  }, [negocioId, id])

  function validarPaso() {
    if (paso === 0) {
      if (!datos.origen.fecha_hora_salida || !datos.origen.domicilio.codigo_postal) return 'Indica la salida y el código postal de origen'
      for (const [i, d] of datos.destinos.entries()) {
        if (!d.domicilio.codigo_postal || !d.fecha_hora_llegada || !(Number(d.distancia_recorrida) > 0)) return `Completa el destino ${i + 1}: código postal, llegada y kilómetros`
        if (d.fecha_hora_llegada <= datos.origen.fecha_hora_salida) return `La llegada al destino ${i + 1} debe ser después de la salida`
      }
    }
    if (paso === 1) {
      for (const [i, m] of datos.mercancias.entries()) {
        if (!m.bienes_transp || !m.descripcion.trim() || !(Number(m.cantidad) > 0) || !(Number(m.peso_kg) > 0)) return `Completa la mercancía ${i + 1}: clave SAT, descripción, cantidad y peso`
      }
    }
    if (paso === 2) {
      if (!datos.vehiculo_id) return 'Elige el vehículo'
      if (!datos.operador_ids.length) return 'Elige al menos un operador'
    }
    return ''
  }

  function cuerpo() {
    const mercancias = datos.mercancias.map(({ producto, ...m }) => ({
      ...m, cantidad: Number(m.cantidad), peso_kg: Number(m.peso_kg),
      valor_mercancia: m.valor_mercancia === '' ? null : Number(m.valor_mercancia),
      material_peligroso: producto?.material_peligroso === '0' ? null : producto?.material_peligroso === '1' ? true : m.material_peligroso,
      destino: datos.destinos.length > 1 ? m.destino : null,
    }))
    return {
      ...datos, mercancias,
      origen: { ...datos.origen, fecha_hora_salida: desdeInputFecha(datos.origen.fecha_hora_salida) },
      destinos: datos.destinos.map(d => ({ ...d, distancia_recorrida: Number(d.distancia_recorrida), fecha_hora_llegada: desdeInputFecha(d.fecha_hora_llegada) })),
    }
  }

  async function siguiente(ev) {
    ev.preventDefault()
    const problema = validarPaso()
    if (problema) { setError(problema); return }
    setError('')
    if (paso < PASOS.length - 1) { setPaso(paso + 1); window.scrollTo(0, 0); return }
    setGuardando(true)
    try {
      const r = id
        ? await req(`/api/carta-porte/${id}`, { method: 'PUT', body: JSON.stringify(cuerpo()) })
        : await req('/api/carta-porte', { method: 'POST', body: JSON.stringify({ ...cuerpo(), negocio_id: negocioId }) })
      navigate(`/carta-porte/${r.id}`)
    } catch (e) { setError(e.message) }
    finally { setGuardando(false) }
  }

  if (!datos) return <div style={{ color: error ? '#b91c1c' : '#94a3b8' }}>{error || 'Cargando…'}</div>

  return (
    <div style={{ ...s.page, maxWidth: 900 }}>
      <button style={{ ...s.btn('ghost'), marginBottom: 12 }} onClick={() => navigate(id ? `/carta-porte/${id}` : '/carta-porte')}>← {id ? 'Volver al documento' : 'Cartas porte'}</button>
      <h1 style={s.h1}>{id ? 'Editar carta porte' : 'Nueva carta porte'}</h1>

      {!emisor?.configurado && (
        <div style={{ ...s.err, display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <span style={{ flex: 1 }}>Faltan los datos fiscales del negocio (RFC, razón social, régimen y código postal).</span>
          <button style={s.btn()} onClick={() => setModalEmisor(true)}>Registrar datos fiscales</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, margin: '16px 0', overflowX: 'auto' }}>
        {PASOS.map((p, i) => (
          <button key={p} type="button" disabled={i > paso} onClick={() => { setError(''); setPaso(i) }} style={{
            flex: 1, minWidth: esMovil ? 120 : 0, padding: '7px 4px', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: i === paso ? '#3b82f6' : i < paso ? '#dbeafe' : '#f1f5f9', color: i === paso ? '#fff' : i < paso ? '#1d4ed8' : '#94a3b8',
            cursor: i < paso ? 'pointer' : 'default', whiteSpace: 'nowrap',
          }}>{i + 1}. {p}</button>
        ))}
      </div>

      <form onSubmit={siguiente} style={{ ...s.card, padding: esMovil ? 14 : '20px 24px' }}>
        {paso === 0 && <PasoRuta datos={datos} setDatos={setDatos} />}
        {paso === 1 && <PasoMercancias datos={datos} setDatos={setDatos} negocioId={negocioId} cat={cat} />}
        {paso === 2 && <PasoFlota datos={datos} setDatos={setDatos} vehiculos={vehiculos} operadores={operadores} cat={cat} />}
        {paso === 3 && <PasoResumen datos={datos} vehiculos={vehiculos} operadores={operadores} emisor={emisor} />}

        {error && <div style={{ ...s.err, marginTop: 14, marginBottom: 0 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 20 }}>
          <button type="button" style={s.btn('ghost')} disabled={paso === 0} onClick={() => { setError(''); setPaso(paso - 1) }}>← Atrás</button>
          <button type="submit" style={s.btn()} disabled={guardando || (paso === PASOS.length - 1 && !emisor?.configurado)}>
            {paso < PASOS.length - 1 ? 'Siguiente →' : guardando ? 'Guardando…' : id ? 'Guardar cambios' : 'Crear carta porte'}
          </button>
        </div>
      </form>

      {modalEmisor && <EmisorModal negocioId={negocioId} cerrar={() => setModalEmisor(false)}
        onGuardado={(em) => { setEmisor(em); setModalEmisor(false); if (!datos.origen.domicilio.codigo_postal && em.domicilio_salida) setDatos(d => ({ ...d, origen: { ...d.origen, domicilio: { ...DOMICILIO_VACIO, ...em.domicilio_salida } } })) }} />}
    </div>
  )
}
