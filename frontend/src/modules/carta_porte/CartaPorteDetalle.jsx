import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import useEsMovil from '../../hooks/useEsMovil'
import { req, s, Chip, fechaHora, abrirArchivo, ChipEstado, ESTADOS, FLUJO, textoDomicilio, useCatalogos, descripcion } from './comun'

const SIGUIENTE = {
  borrador:    [['listo', 'Marcar como lista', 'primary']],
  listo:       [['en_transito', 'Salió: en tránsito', 'primary'], ['borrador', 'Regresar a borrador', 'ghost']],
  en_transito: [['entregado', 'Marcar entregada', 'success']],
}

// Borrador → Listo → En tránsito → Entregado (o cancelado en cualquier punto antes de entregar)
function LineaDeTiempo({ c }) {
  const actual = c.estado === 'cancelado' ? -1 : FLUJO.indexOf(c.estado)
  const fechaDe = (estado) => [...(c.historial || [])].reverse().find(h => h.estado === estado)?.fecha
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', margin: '18px 0', overflowX: 'auto' }}>
      {FLUJO.map((estado, i) => {
        const hecho = c.estado !== 'cancelado' && i <= actual
        const e = ESTADOS[estado]
        return (
          <div key={estado} style={{ display: 'flex', alignItems: 'flex-start', flex: i < FLUJO.length - 1 ? 1 : 'none', minWidth: 110 }}>
            <div style={{ textAlign: 'center', width: 110 }}>
              <div style={{
                width: 26, height: 26, borderRadius: 999, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: hecho ? e.color : '#fff', border: `2px solid ${hecho ? e.color : '#cbd5e1'}`, color: '#fff', fontSize: 13, fontWeight: 800,
              }}>{hecho ? '✓' : ''}</div>
              <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4, color: hecho ? '#1e293b' : '#94a3b8' }}>{e.label}</div>
              {hecho && fechaDe(estado) && <div style={{ fontSize: 10.5, color: '#94a3b8' }}>{fechaHora(fechaDe(estado))}</div>}
            </div>
            {i < FLUJO.length - 1 && <div style={{ flex: 1, height: 2, marginTop: 12, background: c.estado !== 'cancelado' && i < actual ? ESTADOS[FLUJO[i + 1]].color : '#e2e8f0' }} />}
          </div>
        )
      })}
    </div>
  )
}

export default function CartaPorteDetalle() {
  const { id } = useParams()
  const navigate = useNavigate()
  const esMovil = useEsMovil()
  const cat = useCatalogos()
  const [c, setC] = useState(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const cargar = () => req(`/api/carta-porte/${id}`).then(setC).catch(e => setError(e.message))
  useEffect(() => { cargar() }, [id])

  async function cambiar(estado) {
    const nota = estado === 'entregado' ? (window.prompt('Nota de entrega (quién recibió, observaciones):') ?? null) : ''
    if (nota === null) return
    setOcupado(true); setError('')
    try { setC(await req(`/api/carta-porte/${id}/estado`, { method: 'PUT', body: JSON.stringify({ estado, nota }) })) }
    catch (e) { setError(e.message) }
    finally { setOcupado(false) }
  }

  async function cancelar() {
    const motivo = window.prompt(`Cancelar la carta porte ${c.folio}.\nMotivo:`)
    if (!motivo?.trim()) return
    setOcupado(true); setError('')
    try { setC(await req(`/api/carta-porte/${id}/cancelar`, { method: 'POST', body: JSON.stringify({ motivo }) })) }
    catch (e) { setError(e.message) }
    finally { setOcupado(false) }
  }

  async function descargarXml() {
    const res = await fetch(`/api/carta-porte/${id}/xml`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
    if (!res.ok) { setError('No se pudo descargar el XML'); return }
    const url = URL.createObjectURL(await res.blob())
    const a = Object.assign(document.createElement('a'), { href: url, download: `carta-porte-${c.folio}-sin-timbre.xml` })
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  if (!c) return <div style={{ color: error ? '#b91c1c' : '#94a3b8' }}>{error || 'Cargando…'}</div>
  const v = c.vehiculo_snapshot
  const caja = { ...s.card, padding: esMovil ? 14 : '16px 20px' }

  return (
    <div style={{ ...s.page, maxWidth: 1000 }}>
      <button style={{ ...s.btn('ghost'), marginBottom: 12 }} onClick={() => navigate('/carta-porte')}>← Cartas porte</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ ...s.h1, fontFamily: 'monospace' }}>{c.folio}</h1>
            <ChipEstado estado={c.estado} />
          </div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Creada {fechaHora(c.created_at)} por {c.created_by} · IdCCP <span style={{ fontFamily: 'monospace' }}>{c.id_ccp}</span></div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', width: esMovil ? '100%' : 'auto' }}>
          <button style={s.btn('ghost')} onClick={descargarXml}>Descargar XML</button>
          <button style={s.btn('ghost')} onClick={() => abrirArchivo(`/api/carta-porte/${id}/pdf`).catch(e => setError(e.message))}>Imprimir PDF</button>
          {c.estado === 'borrador' && <button style={s.btn('ghost')} onClick={() => navigate(`/carta-porte/${id}/editar`)}>Editar</button>}
          {(SIGUIENTE[c.estado] || []).map(([estado, texto, variante]) => (
            <button key={estado} style={s.btn(variante)} disabled={ocupado} onClick={() => cambiar(estado)}>{texto}</button>
          ))}
          {!['entregado', 'cancelado'].includes(c.estado) && (
            <button style={{ ...s.btn('ghost'), color: '#b91c1c' }} disabled={ocupado} onClick={cancelar}>Cancelar</button>
          )}
        </div>
      </div>

      {error && <div style={{ ...s.err, marginTop: 14 }}>{error}</div>}
      {c.vigencia?.length > 0 && !['entregado', 'cancelado'].includes(c.estado) && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '8px 12px', marginTop: 14, fontSize: 13 }}>
          <b>No puede salir así:</b> {c.vigencia.join('; ')}. Actualízalo en Mi flota u Operadores.
        </div>
      )}
      {c.estado === 'cancelado' && (
        <div style={{ ...s.err, marginTop: 14 }}><b>Cancelada:</b> {c.motivo_cancelacion}</div>
      )}

      <LineaDeTiempo c={c} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={caja}>
          <div style={{ ...s.sect, marginTop: 0 }}>Ruta · {c.total_dist_rec} km</div>
          <div style={{ display: 'flex', flexDirection: esMovil ? 'column' : 'row', gap: 10, alignItems: 'stretch' }}>
            <div style={{ flex: 1, border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 8, padding: 10, fontSize: 13 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8' }}>ORIGEN</div>
              <div style={{ fontWeight: 600 }}>{c.origen.nombre_remitente}</div>
              <div style={{ color: '#64748b' }}>{textoDomicilio(c.origen.domicilio)}</div>
              <div style={{ marginTop: 4 }}>Salida: <b>{fechaHora(c.origen.fecha_hora_salida)}</b></div>
            </div>
            {c.destinos.map(d => (
              <div key={d.num_destino} style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, fontSize: 13 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>DESTINO {d.num_destino} · {d.distancia_recorrida} km</div>
                <div style={{ fontWeight: 600 }}>{d.nombre_destinatario}</div>
                <div style={{ color: '#64748b' }}>{textoDomicilio(d.domicilio)}</div>
                <div style={{ marginTop: 4 }}>Llegada: <b>{fechaHora(d.fecha_hora_llegada)}</b></div>
              </div>
            ))}
          </div>
        </div>

        <div style={caja}>
          <div style={{ ...s.sect, marginTop: 0 }}>Mercancías · {c.num_total_mercancias} · {c.peso_bruto_total.toLocaleString('es-MX')} kg</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={s.table}>
              <thead><tr>{['Clave SAT', 'Descripción', 'Cantidad', 'Peso (kg)', 'Valor', ...(c.destinos.length > 1 ? ['Destino'] : [])].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {c.mercancias.map((m, i) => (
                  <tr key={i}>
                    <td style={{ ...s.td, fontFamily: 'monospace' }}>{m.bienes_transp}</td>
                    <td style={s.td}>{m.descripcion}{m.material_peligroso && <div><Chip texto={`Material peligroso ${m.cve_material_peligroso} · ${m.embalaje}`} bg="#fee2e2" color="#b91c1c" /></div>}</td>
                    <td style={s.td}>{m.cantidad} {m.clave_unidad}</td>
                    <td style={s.td}>{m.peso_kg.toLocaleString('es-MX')}</td>
                    <td style={s.td}>{m.valor_mercancia != null ? `${m.valor_mercancia.toLocaleString('es-MX', { minimumFractionDigits: 2 })} ${m.moneda}` : '—'}</td>
                    {c.destinos.length > 1 && <td style={s.td}>{m.destino}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: esMovil ? 'column' : 'row', gap: 14 }}>
          <div style={{ ...caja, flex: 1 }}>
            <div style={{ ...s.sect, marginTop: 0 }}>Vehículo</div>
            <div style={{ fontWeight: 600 }}>{v.nombre} · <span style={{ fontFamily: 'monospace' }}>{v.placa}</span> · {v.anio_modelo}</div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{v.config_vehicular} · {descripcion(cat?.config_autotransporte, v.config_vehicular)}</div>
            <div style={{ fontSize: 13, color: '#64748b' }}>Permiso {v.tipo_permiso_sct} · No. {v.num_permiso_sct} · {v.peso_bruto_vehicular} t</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>RC: {v.seguro_resp_civil.aseguradora} · {v.seguro_resp_civil.num_poliza} (vence {v.seguro_resp_civil.fecha_vencimiento})</div>
            {v.remolques.map((r, i) => <div key={i} style={{ fontSize: 13 }}>Remolque: {r.placa} · {descripcion(cat?.subtipo_remolque, r.subtipo) || r.subtipo}</div>)}
          </div>
          <div style={{ ...caja, flex: 1 }}>
            <div style={{ ...s.sect, marginTop: 0 }}>Operador{c.operadores.length > 1 ? 'es' : ''}</div>
            {c.operadores.map(o => (
              <div key={o.operador_id} style={{ fontSize: 13, marginBottom: 6 }}>
                <div style={{ fontWeight: 600 }}>{o.snapshot.nombre}</div>
                <div style={{ color: '#64748b' }}>RFC {o.snapshot.rfc} · Licencia {o.snapshot.num_licencia} (vence {o.snapshot.fecha_vencimiento_licencia})</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...caja, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', background: '#f8fafc' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ ...s.sect, marginTop: 0 }}>Timbrado SAT</div>
            <div style={{ fontSize: 13 }}><b>Pendiente — requiere PAC.</b> El XML y el PDF son internos, sin sello ni folio fiscal.</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Para timbrar se necesitan el CSD del negocio y un contrato con un PAC autorizado.</div>
          </div>
          <button style={s.btn()} disabled title="Disponible cuando se integre un PAC">Timbrar</button>
        </div>

        {c.historial?.length > 0 && (
          <div style={caja}>
            <div style={{ ...s.sect, marginTop: 0 }}>Historial</div>
            {[...c.historial].reverse().map((h, i) => (
              <div key={i} style={{ fontSize: 13, padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
                <ChipEstado estado={h.estado} /> <span style={{ color: '#64748b' }}>{fechaHora(h.fecha)} · {h.usuario}</span>{h.nota && ` · ${h.nota}`}
              </div>
            ))}
          </div>
        )}
        {c.observaciones && <div style={caja}><div style={{ ...s.sect, marginTop: 0 }}>Observaciones</div><div style={{ fontSize: 13 }}>{c.observaciones}</div></div>}
      </div>
    </div>
  )
}
