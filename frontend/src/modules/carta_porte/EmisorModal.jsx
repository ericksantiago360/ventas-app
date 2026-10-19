import { useEffect, useState } from 'react'
import ModalFormulario from '../../components/ModalFormulario'
import { req, qs, s, Campo, useCatalogos, DomicilioForm, DOMICILIO_VACIO } from './comun'

// Datos fiscales del negocio: en traslado propio es emisor, receptor, remitente y destinatario
export default function EmisorModal({ negocioId, cerrar, onGuardado }) {
  const cat = useCatalogos()
  const [e, setE] = useState(null)
  const [conSalida, setConSalida] = useState(false)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    req(`/api/carta-porte/emisor?${qs({ negocio_id: negocioId })}`).then(d => {
      setE({ ...d, domicilio_salida: d.domicilio_salida || { ...DOMICILIO_VACIO } })
      setConSalida(Boolean(d.domicilio_salida))
    }).catch(err => setError(err.message))
  }, [negocioId])

  const set = (k, v) => setE(x => ({ ...x, [k]: v }))
  const moral = e?.rfc?.length === 12
  const regimenes = (cat?.regimen_fiscal || []).filter(r => !e?.rfc || e.rfc.length < 12 || (moral ? r.moral : r.fisica))

  async function guardar(ev) {
    ev.preventDefault()
    const { configurado, ...datos } = e
    setGuardando(true); setError('')
    try {
      onGuardado(await req(`/api/carta-porte/emisor?${qs({ negocio_id: negocioId })}`, {
        method: 'PUT', body: JSON.stringify({ ...datos, domicilio_salida: conSalida ? datos.domicilio_salida : null }),
      }))
    } catch (err) { setError(err.message) }
    finally { setGuardando(false) }
  }

  return (
    <ModalFormulario titulo="Datos fiscales del negocio" subtitulo="Tal como aparecen en tu constancia de situación fiscal"
      ancho={720} error={error} cerrar={cerrar} onSubmit={guardar} guardando={guardando || !e} textoGuardar="Guardar">
      {!e || !cat ? <div style={{ color: '#94a3b8' }}>Cargando…</div> : <>
        <div style={s.grid(200)}>
          <Campo label="RFC *">
            <input style={s.input} value={e.rfc} maxLength={13} autoCapitalize="characters" onChange={x => set('rfc', x.target.value.toUpperCase())} />
          </Campo>
          <Campo label="Código postal del domicilio fiscal *">
            <input style={s.input} value={e.codigo_postal} maxLength={5} inputMode="numeric" onChange={x => set('codigo_postal', x.target.value.replace(/\D/g, ''))} />
          </Campo>
          <Campo label="Nombre o razón social *" style={{ gridColumn: '1 / -1' }}>
            <input style={s.input} value={e.nombre} onChange={x => set('nombre', x.target.value.toUpperCase())} placeholder="Sin régimen de capital (SA DE CV)" />
          </Campo>
          <Campo label="Régimen fiscal *" style={{ gridColumn: '1 / -1' }}>
            <select style={s.input} value={e.regimen_fiscal} onChange={x => set('regimen_fiscal', x.target.value)}>
              <option value="">—</option>
              {regimenes.map(r => <option key={r.clave} value={r.clave}>{r.clave} · {r.descripcion}</option>)}
            </select>
          </Campo>
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
          Para CFDI 4.0 el nombre va como en la constancia y sin el régimen de capital: «EMPRESA EJEMPLO», no «EMPRESA EJEMPLO SA DE CV».
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 600, marginTop: 16 }}>
          <input type="checkbox" checked={conSalida} onChange={x => setConSalida(x.target.checked)} />
          Domicilio de salida habitual (bodega), para prellenar el origen
        </label>
        {conSalida && <div style={{ marginTop: 10 }}><DomicilioForm valor={e.domicilio_salida} onChange={d => set('domicilio_salida', d)} /></div>}
      </>}
    </ModalFormulario>
  )
}
