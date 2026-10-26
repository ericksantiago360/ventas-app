import { useEffect, useState } from 'react'
import { useNegocio } from '../../context/NegocioContext'
import { req, qs, s, Campo, subirImagen } from './comun'

const METODOS_BASE = [
  { tipo: 'transferencia', banco: '', titular: '', clabe: '', cuenta: '', instrucciones: '' },
  { tipo: 'oxxo_cie', banco: 'OXXO', titular: '', clabe: '', cuenta: '', instrucciones: '' },
]

const CAMPOS_TEXTO = [
  ['nombre_tienda', 'Nombre de la tienda'],
  ['whatsapp', 'WhatsApp (solo números, con lada)'],
  ['correo_contacto', 'Correo de contacto (recibe avisos de órdenes)'],
]

function Interruptor({ activo, onChange, texto }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' }}>
      <input type="checkbox" checked={activo} onChange={e => onChange(e.target.checked)} />
      {texto}
    </label>
  )
}

export default function TiendaConfigPage() {
  const { negocioId, negocioActual } = useNegocio()
  const [f, setF] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!negocioId) return
    setError(''); setMensaje('')
    req(`/api/admin/tienda/config?${qs({ negocio_id: negocioId })}`)
      .then(c => {
        const metodos = METODOS_BASE.map(base => c.metodos_pago?.find(m => m.tipo === base.tipo) || base)
        setF({ ...c, metodos_pago: metodos })
      })
      .catch(e => setError(e.message))
  }, [negocioId])

  if (!f) return <div style={s.page}>{error ? <div style={s.err}>{error}</div> : 'Cargando…'}</div>

  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }))
  const setMetodo = (tipo, k, v) => setF(prev => ({
    ...prev,
    metodos_pago: prev.metodos_pago.map(m => m.tipo === tipo ? { ...m, [k]: v } : m),
  }))

  const guardar = async () => {
    setGuardando(true); setError(''); setMensaje('')
    try {
      const cuerpo = {
        slug: f.slug || null,
        activa: f.activa,
        nombre_tienda: f.nombre_tienda,
        descripcion: f.descripcion,
        color_primario: f.color_primario,
        whatsapp: f.whatsapp,
        correo_contacto: f.correo_contacto,
        politica_envios: f.politica_envios,
        politica_devoluciones: f.politica_devoluciones,
        mostrar_precio: f.mostrar_precio,
        modo: f.modo,
        iva_incluido: f.iva_incluido,
        // Los métodos sin datos se guardan vacíos y no se ofrecen en el checkout
        metodos_pago: f.metodos_pago.filter(m => m.tipo === 'transferencia' ? m.clabe : m.cuenta),
      }
      const guardado = await req(`/api/admin/tienda/config?${qs({ negocio_id: negocioId })}`, {
        method: 'PUT', body: JSON.stringify(cuerpo),
      })
      setF(prev => ({ ...prev, ...guardado, metodos_pago: METODOS_BASE.map(b => guardado.metodos_pago?.find(m => m.tipo === b.tipo) || b) }))
      setMensaje('Cambios guardados')
    } catch (e) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  const subir = async (tipo, campo, archivo) => {
    if (!archivo) return
    setError('')
    try {
      const r = await subirImagen(negocioId, tipo, archivo)
      set(campo, r[campo])
    } catch (e) {
      setError(e.message)
    }
  }

  const enlace = f.slug ? `${window.location.origin}/tienda/${f.slug}` : ''
  const transferencia = f.metodos_pago.find(m => m.tipo === 'transferencia')
  const oxxo = f.metodos_pago.find(m => m.tipo === 'oxxo_cie')

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={s.h1}>Tienda en línea · {negocioActual?.nombre || ''}</h1>
        <button style={s.btn()} onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
      <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
        Los clientes compran desde un enlace público. Los pedidos llegan al tablero de órdenes y de ahí pasan al Kanban de Pedidos.
      </div>

      {error && <div style={{ ...s.err, marginTop: 14 }}>{error}</div>}
      {mensaje && <div style={{ background: '#dcfce7', color: '#15803d', borderRadius: 6, padding: '8px 12px', fontSize: 13, marginTop: 14 }}>{mensaje}</div>}

      <div style={{ ...s.card, marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Interruptor activo={f.activa} onChange={v => set('activa', v)} texto="Tienda activa (visible para clientes)" />
        <Campo label="Enlace de la tienda (slug: letras minúsculas, números y guiones)">
          <input style={s.input} value={f.slug || ''} placeholder="ej. santal-machinery"
            onChange={e => set('slug', e.target.value.toLowerCase())} />
        </Campo>
        {enlace && <div style={{ fontSize: 13, color: '#3b82f6' }}>{enlace}</div>}

        {CAMPOS_TEXTO.map(([k, label]) => (
          <Campo key={k} label={label}>
            <input style={s.input} value={f[k] || ''} onChange={e => set(k, e.target.value)} />
          </Campo>
        ))}
        <Campo label="Descripción corta (bajo el logo)">
          <textarea style={{ ...s.input, minHeight: 60 }} value={f.descripcion || ''} onChange={e => set('descripcion', e.target.value)} />
        </Campo>
        <Campo label="Color principal">
          <input type="color" value={f.color_primario || '#1F6FEB'} onChange={e => set('color_primario', e.target.value)} style={{ width: 60, height: 36 }} />
        </Campo>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Campo label="Logo">
            {f.logo_url && <img src={f.logo_url} alt="Logo" style={{ maxHeight: 64, marginBottom: 6 }} />}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => subir('logo', 'logo_url', e.target.files[0])} />
          </Campo>
          <Campo label="Imagen de encabezado">
            {f.banner_url && <img src={f.banner_url} alt="Banner" style={{ maxHeight: 64, marginBottom: 6 }} />}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => subir('banner', 'banner_url', e.target.files[0])} />
          </Campo>
        </div>

        <Campo label="Modo de la tienda">
          <select style={s.input} value={f.modo} onChange={e => set('modo', e.target.value)}>
            <option value="catalogo">Catálogo de productos o servicios</option>
            <option value="propiedades">Portal de propiedades (formulario de contacto)</option>
          </select>
        </Campo>
        <Interruptor activo={f.mostrar_precio} onChange={v => set('mostrar_precio', v)}
          texto="Mostrar precios (apagado = el cliente pide cotización)" />
        <Interruptor activo={f.iva_incluido} onChange={v => set('iva_incluido', v)}
          texto="Los precios ya incluyen IVA" />

        <div style={s.sect}>Pago por transferencia SPEI</div>
        <div style={{ ...s.grid(220) }}>
          <Campo label="Banco"><input style={s.input} value={transferencia.banco} onChange={e => setMetodo('transferencia', 'banco', e.target.value)} /></Campo>
          <Campo label="Titular de la cuenta"><input style={s.input} value={transferencia.titular} onChange={e => setMetodo('transferencia', 'titular', e.target.value)} /></Campo>
          <Campo label="CLABE (18 dígitos)"><input style={s.input} maxLength={18} value={transferencia.clabe} onChange={e => setMetodo('transferencia', 'clabe', e.target.value.replace(/\D/g, ''))} /></Campo>
        </div>
        <Campo label="Instrucciones para el cliente">
          <input style={s.input} value={transferencia.instrucciones} onChange={e => setMetodo('transferencia', 'instrucciones', e.target.value)} />
        </Campo>

        <div style={s.sect}>Pago en OXXO (CIE)</div>
        <div style={{ ...s.grid(220) }}>
          <Campo label="Número de convenio CIE (11 dígitos)"><input style={s.input} maxLength={11} value={oxxo.cuenta} onChange={e => setMetodo('oxxo_cie', 'cuenta', e.target.value.replace(/\D/g, ''))} /></Campo>
          <Campo label="Titular"><input style={s.input} value={oxxo.titular} onChange={e => setMetodo('oxxo_cie', 'titular', e.target.value)} /></Campo>
        </div>
        <Campo label="Instrucciones para el cliente">
          <input style={s.input} value={oxxo.instrucciones} onChange={e => setMetodo('oxxo_cie', 'instrucciones', e.target.value)} />
        </Campo>

        <Campo label="Política de envíos">
          <textarea style={{ ...s.input, minHeight: 60 }} value={f.politica_envios || ''} onChange={e => set('politica_envios', e.target.value)} />
        </Campo>
        <Campo label="Política de devoluciones">
          <textarea style={{ ...s.input, minHeight: 60 }} value={f.politica_devoluciones || ''} onChange={e => set('politica_devoluciones', e.target.value)} />
        </Campo>
      </div>
    </div>
  )
}
