import { useEffect, useState } from 'react'
import { useNegocio } from '../../../context/NegocioContext'
import useEsMovil from '../../../hooks/useEsMovil'
import VehiculoModal from './VehiculoModal'
import { req, qs, s, Chip, ChipVence, useCatalogos, descripcion, avisarCambioFlota } from '../comun'

export default function FlotaPage() {
  const { negocioId } = useNegocio()
  const esMovil = useEsMovil()
  const cat = useCatalogos()
  const [vehiculos, setVehiculos] = useState(null)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null)       // {} nuevo | { vehiculo }

  const cargar = () => req(`/api/carta-porte/vehiculos?${qs({ negocio_id: negocioId })}`).then(setVehiculos).catch(e => setError(e.message))
  useEffect(() => { if (negocioId) cargar() }, [negocioId])

  async function baja(v) {
    if (!window.confirm(`¿Dar de baja ${v.nombre} (${v.placa})? Las cartas porte que ya lo usan no cambian.`)) return
    try { await req(`/api/carta-porte/vehiculos/${v.id}`, { method: 'DELETE' }); avisarCambioFlota(); cargar() }
    catch (e) { setError(e.message) }
  }

  const seguros = (v) => [['seguro_resp_civil', 'RC'], ['seguro_carga', 'Carga'], ['seguro_medio_ambiente', 'Ambiental']]
    .filter(([k]) => v[k]).map(([k, nombre]) => ({ nombre, ...v[k] }))

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 style={s.h1}>Mi flota</h1>
        <button style={{ ...s.btn(), whiteSpace: 'nowrap' }} onClick={() => setModal({})}>+ Nuevo vehículo</button>
      </div>
      <div style={{ fontSize: 13, color: '#64748b', margin: '4px 0 18px' }}>Vehículos propios para el traslado de mercancía. Se avisa cuando un seguro vence en 30 días o menos.</div>
      {error && <div style={s.err}>{error}</div>}
      {!vehiculos ? <div style={{ color: '#94a3b8' }}>Cargando…</div> : !vehiculos.length ? (
        <div style={{ ...s.card, textAlign: 'center', color: '#94a3b8', fontSize: 14, padding: 40 }}>Aún no hay vehículos</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: esMovil ? '1fr' : 'repeat(auto-fill, minmax(360px, 1fr))', gap: 12 }}>
          {vehiculos.map(v => (
            <div key={v.id} style={{ ...s.card, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{v.nombre}</div>
                  <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1e293b' }}>{v.placa}</span> · {v.anio_modelo} · {v.peso_bruto_vehicular} t
                  </div>
                </div>
                <Chip texto={v.config_vehicular} bg="#e0e7ff" color="#3730a3" />
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>{descripcion(cat?.config_autotransporte, v.config_vehicular)}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                Permiso {v.tipo_permiso_sct} · No. {v.num_permiso_sct}
                {v.remolques.length > 0 && <> · Remolque: {v.remolques.map(r => `${r.placa} (${descripcion(cat?.subtipo_remolque, r.subtipo) || r.subtipo})`).join(', ')}</>}
              </div>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {seguros(v).map(sg => (
                  <div key={sg.nombre} style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ color: '#94a3b8', width: 62 }}>{sg.nombre}</span>
                    <span>{sg.aseguradora} · {sg.num_poliza} · vence {sg.fecha_vencimiento}</span>
                    <ChipVence fecha={sg.fecha_vencimiento} que="Seguro" />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <button style={s.btn('ghost')} onClick={() => setModal({ vehiculo: v })}>Editar</button>
                <button style={{ ...s.btn('ghost'), color: '#b91c1c' }} onClick={() => baja(v)}>Dar de baja</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {modal && <VehiculoModal negocioId={negocioId} vehiculo={modal.vehiculo} cerrar={() => setModal(null)} onGuardado={() => { setModal(null); cargar() }} />}
    </div>
  )
}
