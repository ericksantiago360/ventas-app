import { useEffect, useState } from 'react'
import { req, s, Campo, useCatalogos } from '../carta_porte/comun'

// Mismos usos que el selector de Facturación (pages/Facturacion.jsx); no hay catálogo CFDI en el backend.
const USOS_CFDI = [
  ['S01', 'Sin efectos fiscales'], ['G03', 'Gastos en general'],
  ['D01', 'Honorarios médicos y gastos hospitalarios'], ['G01', 'Adquisición de mercancías'],
  ['CP01', 'Pagos'],
]

// Datos fiscales del negocio: emisor de todas sus facturas y cartas porte. Solo admin los edita.
export default function DatosFiscalesPanel({ negocioId }) {
  const cat = useCatalogos()
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    setD(null); setError(''); setMensaje('')
    req(`/api/negocios/${encodeURIComponent(negocioId)}/datos-fiscales`)
      .then(setD)
      .catch(err => setError(err.message))
  }, [negocioId])

  const set = (k, v) => setD(x => ({ ...x, [k]: v }))
  const moral = d?.rfc?.length === 12
  const regimenes = (cat?.regimen_fiscal || []).filter(r => !d?.rfc || d.rfc.length < 12 || (moral ? r.moral : r.fisica))

  async function guardar(ev) {
    ev.preventDefault()
    setGuardando(true); setError(''); setMensaje('')
    try {
      const { configurado, ...datos } = d
      const actualizado = await req(`/api/negocios/${encodeURIComponent(negocioId)}/datos-fiscales`, {
        method: 'PUT', body: JSON.stringify(datos),
      })
      setD(actualizado)
      setMensaje('Datos fiscales guardados. Las facturas nuevas usarán este RFC.')
    } catch (err) { setError(err.message) }
    finally { setGuardando(false) }
  }

  const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px' }

  return (
    <form style={card} onSubmit={guardar}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Datos fiscales</div>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
        Tal como aparecen en la constancia de situación fiscal. Se configuran una vez y facturación los usa sin preguntar.
      </div>
      {error && <div style={{ background: '#fef2f2', color: '#b91c1c', borderRadius: 6, padding: '8px 12px', fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {mensaje && <div style={{ background: '#f0fdf4', color: '#15803d', borderRadius: 6, padding: '8px 12px', fontSize: 13, marginBottom: 12 }}>{mensaje}</div>}

      {!d || !cat ? <div style={{ color: '#94a3b8' }}>Cargando…</div> : <>
        {!d.configurado && <div style={{ fontSize: 13, color: '#b45309', marginBottom: 12 }}>
          Este negocio aún no tiene datos fiscales. Sin ellos no se puede timbrar ni generar cartas porte.
        </div>}
        <div style={s.grid(200)}>
          <Campo label="RFC *">
            <input style={s.input} required value={d.rfc} maxLength={13} autoCapitalize="characters"
              onChange={x => set('rfc', x.target.value.toUpperCase())} />
          </Campo>
          <Campo label="Código postal fiscal *">
            <input style={s.input} required value={d.codigo_postal} maxLength={5} inputMode="numeric"
              onChange={x => set('codigo_postal', x.target.value.replace(/\D/g, ''))} />
          </Campo>
          <Campo label="Razón social o nombre *" style={{ gridColumn: '1 / -1' }}>
            <input style={s.input} required value={d.nombre} placeholder="Sin régimen de capital (SA DE CV)"
              onChange={x => set('nombre', x.target.value.toUpperCase())} />
          </Campo>
          <Campo label="Régimen fiscal *" style={{ gridColumn: '1 / -1' }}>
            <select style={s.input} required value={d.regimen_fiscal} onChange={x => set('regimen_fiscal', x.target.value)}>
              <option value="">—</option>
              {regimenes.map(r => <option key={r.clave} value={r.clave}>{r.clave} · {r.descripcion}</option>)}
            </select>
          </Campo>
          <Campo label="Serie de facturas">
            <input style={{ ...s.input, fontFamily: 'monospace' }} required value={d.serie_factura} maxLength={10}
              onChange={x => set('serie_factura', x.target.value.toUpperCase())} />
          </Campo>
          <Campo label="Uso CFDI para clientes nuevos">
            <select style={s.input} value={d.uso_cfdi_default} onChange={x => set('uso_cfdi_default', x.target.value)}>
              {USOS_CFDI.map(([clave, desc]) => <option key={clave} value={clave}>{clave} · {desc}</option>)}
            </select>
          </Campo>
        </div>
        {d.rfc && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(d.rfc) && (
          <p style={{ color: '#ef4444', fontSize: 13, marginTop: 8 }}>⚠ El RFC no tiene el formato correcto (12 caracteres moral o 13 física)</p>
        )}
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
          Para CFDI 4.0 la razón social va como en la constancia y sin el régimen de capital: «EMPRESA EJEMPLO», no «EMPRESA EJEMPLO SA DE CV».
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="submit" disabled={guardando} style={{ padding: '7px 16px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, background: '#3b82f6', color: '#fff' }}>
            {guardando ? 'Guardando…' : 'Guardar datos fiscales'}
          </button>
        </div>
      </>}
    </form>
  )
}
