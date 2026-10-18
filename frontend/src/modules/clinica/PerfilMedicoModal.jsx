import { useEffect, useRef, useState } from 'react'
import ModalFormulario from '../../components/ModalFormulario'
import FirmaCanvas from './FirmaCanvas'
import { req, s, Campo } from './comun'

const VACIO = { cedula_profesional: '', especialidad: '', cedula_especialidad: '', institucion: '', telefono: '', firma_base64: '' }
const MAX_FIRMA = 400_000

// Datos del médico que se imprimen en sus recetas (cédula, especialidad, firma)
export default function PerfilMedicoModal({ cerrar, onGuardado }) {
  const [perfil, setPerfil] = useState(VACIO)
  // El formulario aparece hasta tener el perfil guardado: si llegara después, borraría lo que ya se escribió
  const [cargado, setCargado] = useState(false)
  const [nombre, setNombre] = useState('')
  const [dibujando, setDibujando] = useState(false)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const archivo = useRef(null)

  useEffect(() => {
    req('/api/clinica/perfil-medico').then(({ nombre, ...p }) => { setNombre(nombre); setPerfil({ ...VACIO, ...p }) })
      .finally(() => setCargado(true))
      .catch(e => setError(e.message))
  }, [])

  const setP = (k, v) => setPerfil(p => ({ ...p, [k]: v }))

  function subirImagen(f) {
    if (!f) return
    if (!['image/png', 'image/jpeg'].includes(f.type)) { setError('La firma debe ser PNG o JPG'); return }
    const lector = new FileReader()
    lector.onload = () => {
      if (lector.result.length > MAX_FIRMA) setError('La imagen es demasiado grande (máx. ~300 KB)')
      else { setError(''); setP('firma_base64', lector.result) }
    }
    lector.readAsDataURL(f)
  }

  async function guardar(ev) {
    ev.preventDefault()
    if (!perfil.cedula_profesional.trim()) { setError('La cédula profesional es obligatoria para emitir recetas'); return }
    setGuardando(true); setError('')
    try { onGuardado(await req('/api/clinica/perfil-medico', { method: 'PUT', body: JSON.stringify(perfil) })) }
    catch (e) { setError(e.message) }
    finally { setGuardando(false) }
  }

  return (
    <ModalFormulario titulo="Mi perfil médico" subtitulo={`${nombre} · Estos datos aparecen en tus recetas`}
      ancho={620} error={error} cerrar={cerrar} onSubmit={guardar} guardando={guardando || !cargado} textoGuardar="Guardar perfil">
      {!cargado ? <div style={{ color: '#94a3b8', padding: 20 }}>Cargando…</div> : <>
      <div style={s.grid(200)}>
        <Campo label="Cédula profesional *">
          <input style={s.input} value={perfil.cedula_profesional} inputMode="numeric" onChange={e => setP('cedula_profesional', e.target.value)} />
        </Campo>
        <Campo label="Institución que expidió el título">
          <input style={s.input} placeholder="UNAM, IPN…" value={perfil.institucion} onChange={e => setP('institucion', e.target.value)} />
        </Campo>
        <Campo label="Especialidad">
          <input style={s.input} placeholder="Vacío = Médico general" value={perfil.especialidad} onChange={e => setP('especialidad', e.target.value)} />
        </Campo>
        <Campo label="Cédula de especialidad">
          <input style={s.input} value={perfil.cedula_especialidad} inputMode="numeric" onChange={e => setP('cedula_especialidad', e.target.value)} />
        </Campo>
        <Campo label="Teléfono de consultorio">
          <input style={s.input} type="tel" value={perfil.telefono} onChange={e => setP('telefono', e.target.value)} />
        </Campo>
      </div>

      <div style={s.sect}>Firma</div>
      {dibujando ? (
        <FirmaCanvas onListo={(f) => { setP('firma_base64', f); setDibujando(false) }} cancelar={() => setDibujando(false)} />
      ) : (
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ width: 220, height: 90, border: '1px solid #e2e8f0', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
            {perfil.firma_base64
              ? <img src={perfil.firma_base64} alt="Firma" style={{ maxWidth: 200, maxHeight: 80 }} />
              : <span style={{ fontSize: 12, color: '#94a3b8' }}>Sin firma</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button type="button" style={s.btn('ghost')} onClick={() => setDibujando(true)}>Dibujar firma</button>
            <button type="button" style={s.btn('ghost')} onClick={() => archivo.current?.click()}>Subir imagen</button>
            {perfil.firma_base64 && <button type="button" style={{ ...s.btn('ghost'), color: '#b91c1c' }} onClick={() => setP('firma_base64', '')}>Quitar</button>}
          </div>
          <input ref={archivo} type="file" accept="image/png,image/jpeg" style={{ display: 'none' }}
            onChange={e => { subirImagen(e.target.files?.[0]); e.target.value = '' }} />
        </div>
      )}
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>Las recetas ya emitidas conservan los datos con que se firmaron.</div>
      </>}
    </ModalFormulario>
  )
}
