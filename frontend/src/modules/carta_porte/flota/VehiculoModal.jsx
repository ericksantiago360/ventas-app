import { useState } from 'react'
import ModalFormulario from '../../../components/ModalFormulario'
import { req, s, Campo, useCatalogos, avisarCambioFlota } from '../comun'

const SEGURO_VACIO = { aseguradora: '', num_poliza: '', fecha_vencimiento: '' }
const VACIO = {
  nombre: '', placa: '', anio_modelo: new Date().getFullYear(), config_vehicular: 'VL', peso_bruto_vehicular: '',
  tipo_permiso_sct: 'TPAF02', num_permiso_sct: '', seguro_resp_civil: SEGURO_VACIO, seguro_carga: null,
  seguro_medio_ambiente: null, remolques: [],
}

function Seguro({ titulo, valor, onChange, opcional }) {
  const activo = Boolean(valor)
  const set = (k, v) => onChange({ ...valor, [k]: v })
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, marginTop: 8 }}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 600 }}>
        {opcional && <input type="checkbox" checked={activo} onChange={e => onChange(e.target.checked ? { ...SEGURO_VACIO } : null)} />}
        {titulo}
      </label>
      {activo && (
        <div style={{ ...s.grid(150), marginTop: 8 }}>
          <Campo label="Aseguradora *"><input style={s.input} value={valor.aseguradora} onChange={e => set('aseguradora', e.target.value)} /></Campo>
          <Campo label="Póliza *"><input style={s.input} value={valor.num_poliza} onChange={e => set('num_poliza', e.target.value)} /></Campo>
          <Campo label="Vence *"><input style={s.input} type="date" value={valor.fecha_vencimiento} onChange={e => set('fecha_vencimiento', e.target.value)} /></Campo>
        </div>
      )}
    </div>
  )
}

export default function VehiculoModal({ negocioId, vehiculo, cerrar, onGuardado }) {
  const cat = useCatalogos()
  const [v, setV] = useState(() => vehiculo ? { ...VACIO, ...vehiculo } : VACIO)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const set = (k, val) => setV(x => ({ ...x, [k]: val }))

  const config = cat?.config_autotransporte.find(c => c.clave === v.config_vehicular)
  const regla = config?.remolque ?? '0,1'          // "0" sin remolque, "1" requerido, "0,1" opcional
  const setRemolque = (i, k, val) => set('remolques', v.remolques.map((r, j) => j === i ? { ...r, [k]: val } : r))

  async function guardar(ev) {
    ev.preventDefault()
    const remolques = regla === '0' ? [] : v.remolques
    if (regla === '1' && !remolques.length) { setError(`La configuración ${v.config_vehicular} requiere remolque`); return }
    // Solo los campos del formulario (el vehículo guardado trae id, alertas, fechas…)
    const cuerpo = {
      ...Object.fromEntries(Object.keys(VACIO).map(k => [k, v[k]])),
      remolques, anio_modelo: Number(v.anio_modelo), peso_bruto_vehicular: Number(v.peso_bruto_vehicular),
    }
    setGuardando(true); setError('')
    try {
      const r = vehiculo
        ? await req(`/api/carta-porte/vehiculos/${vehiculo.id}`, { method: 'PUT', body: JSON.stringify(cuerpo) })
        : await req('/api/carta-porte/vehiculos', { method: 'POST', body: JSON.stringify({ ...cuerpo, negocio_id: negocioId }) })
      avisarCambioFlota()
      onGuardado(r)
    } catch (e) { setError(e.message) }
    finally { setGuardando(false) }
  }

  return (
    <ModalFormulario titulo={vehiculo ? `Editar ${vehiculo.nombre}` : 'Nuevo vehículo'}
      subtitulo="Las cartas porte ya hechas conservan los datos con que se crearon"
      ancho={760} error={error} cerrar={cerrar} onSubmit={guardar} guardando={guardando || !cat} textoGuardar="Guardar">
      {!cat ? <div style={{ color: '#94a3b8' }}>Cargando catálogos…</div> : <>
        <div style={s.grid(170)}>
          <Campo label="Nombre interno *"><input style={s.input} placeholder="Camión 1 - Blanco" value={v.nombre} onChange={e => set('nombre', e.target.value)} /></Campo>
          <Campo label="Placa *">
            <input style={s.input} value={v.placa} autoCapitalize="characters" placeholder="ABC123X"
              onChange={e => set('placa', e.target.value.toUpperCase())} />
          </Campo>
          <Campo label="Año del modelo *"><input style={s.input} type="number" min={1900} max={new Date().getFullYear() + 1} value={v.anio_modelo} onChange={e => set('anio_modelo', e.target.value)} /></Campo>
          <Campo label="Peso bruto vehicular (t) *">
            <input style={s.input} type="number" step="0.01" min={0} inputMode="decimal" placeholder="3.5" value={v.peso_bruto_vehicular} onChange={e => set('peso_bruto_vehicular', e.target.value)} />
          </Campo>
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>La placa se guarda sin guiones ni espacios (5 a 7 caracteres), como la pide el SAT.</div>

        <div style={s.sect}>Configuración y permiso SCT</div>
        <Campo label="Configuración vehicular (c_ConfigAutotransporte) *">
          <select style={s.input} value={v.config_vehicular} onChange={e => set('config_vehicular', e.target.value)}>
            {cat.config_autotransporte.map(c => <option key={c.clave} value={c.clave}>{c.clave} · {c.descripcion}</option>)}
          </select>
        </Campo>
        <div style={{ ...s.grid(200), marginTop: 10 }}>
          <Campo label="Tipo de permiso SCT *">
            <select style={s.input} value={v.tipo_permiso_sct} onChange={e => set('tipo_permiso_sct', e.target.value)}>
              {cat.tipo_permiso.map(p => <option key={p.clave} value={p.clave}>{p.clave} · {p.descripcion}</option>)}
            </select>
          </Campo>
          <Campo label="Número de permiso SCT *"><input style={s.input} value={v.num_permiso_sct} onChange={e => set('num_permiso_sct', e.target.value)} /></Campo>
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Para traslado de mercancía propia suele ser TPAF02 (transporte privado de carga).</div>

        <div style={s.sect}>Seguros</div>
        <Seguro titulo="Responsabilidad civil (obligatorio)" valor={v.seguro_resp_civil} onChange={x => set('seguro_resp_civil', x)} />
        <Seguro titulo="Seguro de la carga" opcional valor={v.seguro_carga} onChange={x => set('seguro_carga', x)} />
        <Seguro titulo="Medio ambiente (requerido para material peligroso)" opcional valor={v.seguro_medio_ambiente} onChange={x => set('seguro_medio_ambiente', x)} />

        {regla !== '0' && (
          <>
            <div style={s.sect}>Remolques {regla === '1' ? '(requerido)' : '(opcional)'}</div>
            {v.remolques.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <select style={{ ...s.input, flex: 2 }} value={r.subtipo} onChange={e => setRemolque(i, 'subtipo', e.target.value)}>
                  {cat.subtipo_remolque.map(t => <option key={t.clave} value={t.clave}>{t.clave} · {t.descripcion}</option>)}
                </select>
                <input style={{ ...s.input, flex: 1 }} placeholder="Placa" value={r.placa} onChange={e => setRemolque(i, 'placa', e.target.value.toUpperCase())} />
                <button type="button" style={s.btn('ghost')} aria-label="Quitar remolque" onClick={() => set('remolques', v.remolques.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            {v.remolques.length < 2 && (
              <button type="button" style={s.btn('ghost')} onClick={() => set('remolques', [...v.remolques, { subtipo: 'CTR007', placa: '' }])}>+ Agregar remolque</button>
            )}
          </>
        )}
      </>}
    </ModalFormulario>
  )
}
