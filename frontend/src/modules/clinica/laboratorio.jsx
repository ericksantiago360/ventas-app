// Piezas del laboratorio clínico: rangos por edad y sexo, resultados críticos y toma de muestra.
// Las usa pages/Resultados.jsx; la lógica de rangos replica app/services/rangos_lab.py.
import { useEffect, useState } from 'react'
import ModalFormulario from '../../components/ModalFormulario'
import { req, qs, fechaHora, s, Campo } from './comun'

// ── Rangos (mismo criterio que el backend) ────────────────────────────────────

function referenciaDePlantilla(a, sexo) {
  const pre = sexo === 'femenino' ? 'referencia_mujer' : 'referencia_hombre'
  return { min: a[`${pre}_min`], max: a[`${pre}_max`], critico_min: null, critico_max: null, fuente: 'plantilla' }
}

// El rango fijado a la orden; en órdenes anteriores al catálogo, el de la plantilla
export const referenciaDe = (a, sexo) => a.referencia_aplicada || referenciaDePlantilla(a, sexo)

export function textoReferencia(a, sexo = 'masculino') {
  if (a.tipo === 'cualitativo') return a.referencia_texto || '—'
  const r = referenciaDe(a, sexo)
  return r.min != null && r.max != null ? `${r.min} – ${r.max}` : (a.referencia_texto || '—')
}

export function textoCritico(a, sexo = 'masculino') {
  const r = referenciaDe(a, sexo)
  const partes = [r.critico_min != null && `< ${r.critico_min}`, r.critico_max != null && `> ${r.critico_max}`].filter(Boolean)
  return partes.length ? `Crítico ${partes.join(' o ')}` : ''
}

export function calcularFlag(valor, a, sexo = 'masculino') {
  if (a.tipo === 'cualitativo') return 'normal'
  const num = parseFloat(String(valor ?? '').replace(',', '.'))
  if (String(valor ?? '').trim() === '' || isNaN(num)) return 'pendiente'
  const r = referenciaDe(a, sexo)
  const explicitos = r.fuente === 'catalogo' || r.critico_min != null || r.critico_max != null
  if ((r.critico_min != null && num < r.critico_min) || (r.critico_max != null && num > r.critico_max)) return 'critico'
  if (r.min == null || r.max == null) return 'pendiente'
  if (num < r.min) return !explicitos && r.min > 0 && num < r.min * 0.7 ? 'critico' : 'bajo'
  if (num > r.max) return !explicitos && num > r.max * 1.3 ? 'critico' : 'alto'
  return 'normal'
}

// ── Chips de la orden ─────────────────────────────────────────────────────────

export function ChipsOrden({ o }) {
  return (
    <>
      {o.urgente && <span style={{ background: '#dc2626', color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 800, letterSpacing: '.04em' }}>URGENTE</span>}
      {o.resultados_criticos && (
        <span title={o.notificado_medico ? 'Médico notificado' : 'Falta avisar al médico'} style={{
          background: o.notificado_medico ? '#fee2e2' : '#b91c1c', color: o.notificado_medico ? '#b91c1c' : '#fff',
          borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 800, letterSpacing: '.04em',
        }}>
          {o.notificado_medico ? 'CRÍTICO · AVISADO' : 'CRÍTICO'}
        </span>
      )}
    </>
  )
}

const MEDIOS = { telefono: 'Teléfono', en_persona: 'En persona', correo: 'Correo', mensaje: 'Mensaje', otro: 'Otro' }
const MUESTRAS = { sangre: 'Sangre', orina: 'Orina', heces: 'Heces', cultivo: 'Cultivo', otro: 'Otro' }

// ── Resultados críticos: aviso al médico ──────────────────────────────────────

export function AvisoCriticoModal({ orden, cerrar, onGuardado }) {
  const [form, setForm] = useState({ notificado_a: orden.medico_solicitante || '', medio: 'telefono', nota: '' })
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function guardar(ev) {
    ev.preventDefault()
    if (!form.notificado_a.trim()) { setError('Indica quién recibió el aviso'); return }
    setGuardando(true); setError('')
    try { onGuardado(await req(`/api/lab/ordenes/${orden.id}/notificar`, { method: 'POST', body: JSON.stringify(form) })) }
    catch (e) { setError(e.message) }
    finally { setGuardando(false) }
  }

  return (
    <ModalFormulario titulo="Avisar resultado crítico" subtitulo={`${orden.folio} · ${orden.paciente_nombre}`}
      ancho={520} error={error} cerrar={cerrar} onSubmit={guardar} guardando={guardando} textoGuardar="Registrar aviso">
      <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', marginBottom: 14 }}>
        {(orden.criticos || []).map((c, i) => (
          <div key={i} style={{ fontSize: 13, color: '#b91c1c' }}>
            <strong>{c.analito}: {c.valor} {c.unidad}</strong> <span style={{ color: '#991b1b' }}>· {c.estudio}</span>
          </div>
        ))}
      </div>
      <div style={s.grid(200)}>
        <Campo label="Quién recibió el aviso *">
          <input style={s.input} autoFocus value={form.notificado_a} placeholder="Dr(a). …" onChange={e => setForm(f => ({ ...f, notificado_a: e.target.value }))} />
        </Campo>
        <Campo label="Medio">
          <select style={s.input} value={form.medio} onChange={e => setForm(f => ({ ...f, medio: e.target.value }))}>
            {Object.entries(MEDIOS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Campo>
      </div>
      <Campo label="Nota" style={{ marginTop: 12 }}>
        <textarea style={{ ...s.input, minHeight: 60, resize: 'vertical' }} placeholder="Indicaciones recibidas, a quién se le leyó el resultado…"
          value={form.nota} onChange={e => setForm(f => ({ ...f, nota: e.target.value }))} />
      </Campo>
    </ModalFormulario>
  )
}

// Aviso rojo en el detalle de la orden, con el historial de avisos
export function PanelCriticos({ orden, onAvisar }) {
  if (!orden.resultados_criticos && !orden.notificaciones?.length) return null
  const pendiente = orden.resultados_criticos && !orden.notificado_medico
  return (
    <div style={{
      background: pendiente ? '#fef2f2' : '#fff', border: `1.5px solid ${pendiente ? '#dc2626' : '#fecaca'}`,
      borderRadius: 10, padding: '12px 16px', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 800, color: '#b91c1c', fontSize: 14 }}>
            {orden.resultados_criticos ? (pendiente ? '⚠ Resultado crítico: falta avisar al médico' : 'Resultado crítico · médico avisado') : 'Sin resultados críticos actualmente'}
          </div>
          {(orden.criticos || []).map((c, i) => (
            <div key={i} style={{ fontSize: 13, color: '#991b1b', marginTop: 2 }}>{c.estudio} · <strong>{c.analito}: {c.valor} {c.unidad}</strong></div>
          ))}
        </div>
        {orden.resultados_criticos && (
          <button style={{ ...s.btn(pendiente ? 'danger' : 'ghost') }} onClick={onAvisar}>
            {pendiente ? 'Registrar aviso al médico' : 'Registrar otro aviso'}
          </button>
        )}
      </div>
      {orden.notificaciones?.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #fecaca' }}>
          {[...orden.notificaciones].reverse().map((n, i) => (
            <div key={i} style={{ fontSize: 12, color: '#475569' }}>
              ✓ {fechaHora(n.fecha)} · avisado a <strong>{n.notificado_a}</strong> por {MEDIOS[n.medio]?.toLowerCase() || n.medio}
              {n.usuario ? ` · registró ${n.usuario}` : ''}{n.nota ? ` · ${n.nota}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Toma de muestra ───────────────────────────────────────────────────────────

const localInput = (d) => {
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return x.toISOString().slice(0, 16)
}

export function MuestraModal({ orden, cerrar, onGuardado }) {
  const actual = orden.muestra
  // Sugerida: la muestra de la plantilla del primer estudio ("Sangre", "Orina"…)
  const sugerida = (orden.estudios?.[0]?.muestra || 'sangre').toLowerCase()
  const [tipo, setTipo] = useState(actual?.tipo || (MUESTRAS[sugerida] ? sugerida : 'otro'))
  const [fecha, setFecha] = useState(localInput(actual?.fecha_toma ? new Date(actual.fecha_toma) : new Date()))
  const [obs, setObs] = useState(actual?.observaciones || '')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function guardar(ev) {
    ev.preventDefault()
    setGuardando(true); setError('')
    try {
      onGuardado(await req(`/api/lab/ordenes/${orden.id}/muestra`, {
        method: 'PUT', body: JSON.stringify({ tipo, fecha_toma: new Date(fecha).toISOString(), observaciones: obs }),
      }))
    } catch (e) { setError(e.message) }
    finally { setGuardando(false) }
  }

  return (
    <ModalFormulario titulo="Toma de muestra" subtitulo={`${orden.folio} · ${orden.paciente_nombre}`}
      ancho={480} error={error} cerrar={cerrar} onSubmit={guardar} guardando={guardando} textoGuardar="Registrar">
      <div style={s.grid(180)}>
        <Campo label="Tipo de muestra">
          <select style={s.input} value={tipo} onChange={e => setTipo(e.target.value)}>
            {Object.entries(MUESTRAS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Campo>
        <Campo label="Fecha y hora de toma">
          <input style={s.input} type="datetime-local" value={fecha} onChange={e => setFecha(e.target.value)} required />
        </Campo>
      </div>
      <Campo label="Observaciones" style={{ marginTop: 12 }}>
        <input style={s.input} placeholder="Ayuno de 12 h, muestra hemolizada…" value={obs} onChange={e => setObs(e.target.value)} />
      </Campo>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 10 }}>Queda registrada a tu nombre como técnico que tomó la muestra.</div>
    </ModalFormulario>
  )
}

export const textoMuestra = (m) => m
  ? `${MUESTRAS[m.tipo] || m.tipo} · ${fechaHora(m.fecha_toma)}${m.tecnico_nombre ? ` · ${m.tecnico_nombre}` : ''}`
  : ''

// ── Catálogo de rangos de referencia ──────────────────────────────────────────

const RANGO_VACIO = { sexo: 'ambos', edad_min: 0, edad_max: 999, min: '', max: '', critico_min: '', critico_max: '' }
const SEXOS = { ambos: 'Ambos', masculino: 'Hombres', femenino: 'Mujeres' }
const num = (v) => v === '' || v == null ? null : Number(v)

function RangoModal({ negocioId, parametro, cerrar, onGuardado }) {
  const [nombre, setNombre] = useState(parametro?.parametro || '')
  const [unidad, setUnidad] = useState(parametro?.unidad || '')
  const [aliases, setAliases] = useState((parametro?.aliases || []).join(', '))
  const [rangos, setRangos] = useState(parametro?.rangos?.map(r => ({ ...RANGO_VACIO, ...r, critico_min: r.critico_min ?? '', critico_max: r.critico_max ?? '' })) || [{ ...RANGO_VACIO }])
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const setR = (i, k, v) => setRangos(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r))

  async function guardar(ev) {
    ev.preventDefault()
    if (rangos.some(r => r.min === '' || r.max === '')) { setError('Cada rango necesita mínimo y máximo'); return }
    const cuerpo = {
      parametro: nombre, unidad, aliases: aliases.split(',').map(a => a.trim()).filter(Boolean),
      rangos: rangos.map(r => ({
        sexo: r.sexo, edad_min: Number(r.edad_min) || 0, edad_max: r.edad_max === '' ? 999 : Number(r.edad_max),
        min: Number(r.min), max: Number(r.max), critico_min: num(r.critico_min), critico_max: num(r.critico_max),
      })),
    }
    setGuardando(true); setError('')
    try {
      onGuardado(parametro
        ? await req(`/api/lab/rangos/${parametro.id}`, { method: 'PUT', body: JSON.stringify(cuerpo) })
        : await req('/api/lab/rangos', { method: 'POST', body: JSON.stringify({ ...cuerpo, negocio_id: negocioId }) }))
    } catch (e) { setError(e.message) }
    finally { setGuardando(false) }
  }

  const celda = { ...s.input, padding: '6px 8px' }
  return (
    <ModalFormulario titulo={parametro ? `Editar ${parametro.parametro}` : 'Nuevo parámetro'}
      editando={Boolean(parametro)} entidad={parametro ? `el parámetro ${parametro.parametro}` : undefined}
      subtitulo="Los cambios aplican a órdenes nuevas; las ya creadas conservan su rango"
      ancho={860} error={error} cerrar={cerrar} onSubmit={guardar} guardando={guardando} textoGuardar="Guardar">
      <div style={s.grid(200)}>
        <Campo label="Parámetro *"><input style={s.input} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Glucosa" required /></Campo>
        <Campo label="Unidad"><input style={s.input} value={unidad} onChange={e => setUnidad(e.target.value)} placeholder="mg/dL" /></Campo>
        <Campo label="Otros nombres (separados por coma)"><input style={s.input} value={aliases} onChange={e => setAliases(e.target.value)} placeholder="Glucosa en ayuno, Glucosa sérica" /></Campo>
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
        Se aplica a los analitos de las plantillas con este nombre (o un alias) y la misma unidad.
      </div>

      <div style={s.sect}>Rangos por edad y sexo</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ ...s.table, minWidth: 720 }}>
          <thead><tr>{['Sexo', 'Edad desde', 'hasta', 'Mínimo *', 'Máximo *', 'Crítico <', 'Crítico >', ''].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>
            {rangos.map((r, i) => (
              <tr key={i}>
                <td style={{ ...s.td, padding: 4 }}>
                  <select style={celda} value={r.sexo} onChange={e => setR(i, 'sexo', e.target.value)}>
                    {Object.entries(SEXOS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </td>
                {['edad_min', 'edad_max', 'min', 'max', 'critico_min', 'critico_max'].map(k => (
                  <td key={k} style={{ ...s.td, padding: 4 }}>
                    <input style={celda} type="number" step="any" inputMode="decimal" value={r[k]} onChange={e => setR(i, k, e.target.value)}
                      placeholder={k.startsWith('critico') ? '—' : ''} />
                  </td>
                ))}
                <td style={{ ...s.td, padding: 4 }}>
                  <button type="button" style={s.btn('ghost')} aria-label="Quitar rango" disabled={rangos.length === 1}
                    onClick={() => setRangos(rs => rs.filter((_, j) => j !== i))}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" style={{ ...s.btn('ghost'), marginTop: 8 }} onClick={() => setRangos(rs => [...rs, { ...RANGO_VACIO }])}>+ Agregar rango</button>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
        Edad en años (999 = sin límite). Si hay un rango del sexo del paciente, gana sobre "Ambos". Sin valores críticos, el resultado nunca se marca crítico.
      </div>
    </ModalFormulario>
  )
}

export function RangosReferencia({ negocioId }) {
  const [parametros, setParametros] = useState(null)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null)       // {} nuevo | { parametro }

  const cargar = () => req(`/api/lab/rangos?${qs({ negocio_id: negocioId })}`).then(setParametros).catch(e => setError(e.message))
  useEffect(() => { if (negocioId) cargar() }, [negocioId])

  async function seed() {
    try {
      const r = await req(`/api/lab/rangos/seed?${qs({ negocio_id: negocioId })}`, { method: 'POST' })
      alert(r.creados ? `Se agregaron ${r.creados} parámetros. Revísalos contra tus métodos antes de usarlos.` : 'Ya tienes todos los parámetros comunes.')
      cargar()
    } catch (e) { setError(e.message) }
  }

  async function eliminar(p) {
    if (!window.confirm(`¿Quitar el parámetro ${p.parametro}? Las órdenes nuevas usarán el rango de la plantilla.`)) return
    try { await req(`/api/lab/rangos/${p.id}`, { method: 'DELETE' }); cargar() }
    catch (e) { setError(e.message) }
  }

  const sexo = (k) => SEXOS[k] || k

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: '#64748b', flex: '1 1 300px' }}>
          Rangos por edad y sexo, con valores críticos. Al crear una orden, cada analito toma el rango que le corresponde al paciente.
        </div>
        <button style={s.btn('ghost')} onClick={seed}>Cargar parámetros comunes</button>
        <button style={s.btn()} onClick={() => setModal({})}>+ Nuevo parámetro</button>
      </div>
      {error && <div style={s.err}>{error}</div>}
      {!parametros ? <div style={{ color: '#94a3b8' }}>Cargando…</div> : !parametros.length ? (
        <div style={{ ...s.card, textAlign: 'center', color: '#94a3b8', fontSize: 14, padding: 40 }}>
          Sin parámetros: las órdenes usan los rangos de cada plantilla. Usa "Cargar parámetros comunes" para empezar.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {parametros.map(p => (
            <div key={p.id} style={{ ...s.card, padding: '14px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{p.parametro}</span>
                  {p.unidad && <span style={{ color: '#64748b', marginLeft: 8 }}>{p.unidad}</span>}
                  {p.aliases?.length > 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>También: {p.aliases.join(', ')}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={s.btn('ghost')} onClick={() => setModal({ parametro: p })}>Editar</button>
                  <button style={{ ...s.btn('ghost'), color: '#b91c1c' }} onClick={() => eliminar(p)}>Quitar</button>
                </div>
              </div>
              <div style={{ overflowX: 'auto', marginTop: 8 }}>
                <table style={{ ...s.table, fontSize: 12 }}>
                  <thead><tr>{['Sexo', 'Edad', 'Referencia', 'Crítico bajo', 'Crítico alto'].map(h => <th key={h} style={{ ...s.th, fontSize: 11 }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {p.rangos.map((r, i) => (
                      <tr key={i}>
                        <td style={{ ...s.td, padding: '5px 12px' }}>{sexo(r.sexo)}</td>
                        <td style={{ ...s.td, padding: '5px 12px' }}>{r.edad_max >= 999 ? `${r.edad_min}+ años` : `${r.edad_min}–${r.edad_max} años`}</td>
                        <td style={{ ...s.td, padding: '5px 12px', fontWeight: 600 }}>{r.min} – {r.max}</td>
                        <td style={{ ...s.td, padding: '5px 12px', color: '#b91c1c' }}>{r.critico_min != null ? `< ${r.critico_min}` : '—'}</td>
                        <td style={{ ...s.td, padding: '5px 12px', color: '#b91c1c' }}>{r.critico_max != null ? `> ${r.critico_max}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
      {modal && (
        <RangoModal negocioId={negocioId} parametro={modal.parametro} cerrar={() => setModal(null)}
          onGuardado={() => { setModal(null); cargar() }} />
      )}
    </div>
  )
}
