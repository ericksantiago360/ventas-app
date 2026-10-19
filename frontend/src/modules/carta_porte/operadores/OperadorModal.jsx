import { useState } from 'react'
import ModalFormulario from '../../../components/ModalFormulario'
import { req, s, Campo, useCatalogos, avisarCambioFlota } from '../comun'

const VACIO = { nombre: '', rfc: '', curp: '', num_licencia: '', tipo_licencia: 'B', fecha_vencimiento_licencia: '', telefono: '' }

export default function OperadorModal({ negocioId, operador, cerrar, onGuardado }) {
  const cat = useCatalogos()
  const [o, setO] = useState(() => Object.fromEntries(Object.keys(VACIO).map(k => [k, operador?.[k] ?? VACIO[k]])))
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const set = (k, v) => setO(x => ({ ...x, [k]: v }))

  async function guardar(ev) {
    ev.preventDefault()
    setGuardando(true); setError('')
    try {
      const r = operador
        ? await req(`/api/carta-porte/operadores/${operador.id}`, { method: 'PUT', body: JSON.stringify(o) })
        : await req('/api/carta-porte/operadores', { method: 'POST', body: JSON.stringify({ ...o, negocio_id: negocioId }) })
      avisarCambioFlota()
      onGuardado(r)
    } catch (e) { setError(e.message) }
    finally { setGuardando(false) }
  }

  return (
    <ModalFormulario titulo={operador ? `Editar ${operador.nombre}` : 'Nuevo operador'} subtitulo="En la carta porte van nombre, RFC y número de licencia"
      ancho={640} error={error} cerrar={cerrar} onSubmit={guardar} guardando={guardando} textoGuardar="Guardar">
      <div style={s.grid(200)}>
        <Campo label="Nombre completo *" style={{ gridColumn: '1 / -1' }}>
          <input style={s.input} value={o.nombre} onChange={e => set('nombre', e.target.value)} autoCapitalize="words" />
        </Campo>
        <Campo label="RFC (13 caracteres) *">
          <input style={s.input} value={o.rfc} maxLength={13} autoCapitalize="characters" onChange={e => set('rfc', e.target.value.toUpperCase())} />
        </Campo>
        <Campo label="CURP">
          <input style={s.input} value={o.curp} maxLength={18} autoCapitalize="characters" onChange={e => set('curp', e.target.value.toUpperCase())} />
        </Campo>
        <Campo label="Número de licencia *">
          <input style={s.input} value={o.num_licencia} maxLength={16} onChange={e => set('num_licencia', e.target.value)} />
        </Campo>
        <Campo label="Vencimiento de la licencia *">
          <input style={s.input} type="date" value={o.fecha_vencimiento_licencia} onChange={e => set('fecha_vencimiento_licencia', e.target.value)} />
        </Campo>
        <Campo label="Tipo de licencia" style={{ gridColumn: '1 / -1' }}>
          <select style={s.input} value={o.tipo_licencia} onChange={e => set('tipo_licencia', e.target.value)}>
            {(cat?.tipo_licencia || []).map(t => <option key={t.clave} value={t.clave}>{t.descripcion}</option>)}
          </select>
        </Campo>
        <Campo label="Teléfono">
          <input style={s.input} type="tel" value={o.telefono} onChange={e => set('telefono', e.target.value)} />
        </Campo>
      </div>
    </ModalFormulario>
  )
}
