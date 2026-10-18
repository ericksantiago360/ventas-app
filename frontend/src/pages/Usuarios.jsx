import { useEffect, useState, useCallback } from 'react'
import { usuariosApi } from '../api/client'
import { useNegocio } from '../context/NegocioContext'

const ROLES = [
  ['admin',    'Administrador'],
  ['vendedor', 'Vendedor'],
  ['usuario',  'Usuario'],
]
const NOMBRE_ROL = Object.fromEntries(ROLES)

// Rol en el módulo de clínica, por negocio (backend/app/core/permissions.py)
const ROLES_CLINICA = [
  ['',              'Sin acceso a clínica'],
  ['recepcion',     'Recepción'],
  ['medico',        'Médico'],
  ['laboratorista', 'Laboratorista'],
  ['farmacia',      'Farmacia'],
  ['admin_clinica', 'Administrador de clínica'],
]
const NOMBRE_ROL_CLINICA = Object.fromEntries(ROLES_CLINICA)

const VACIO = { nombre: '', email: '', password: '', rol: 'usuario', negocios: [], roles_clinica: {}, activo: true }

const mensajeDeError = (e, porDefecto) => {
  const detalle = e.response?.data?.detail
  return Array.isArray(detalle) ? 'Revisa los datos: nombre, email o contraseña (mínimo 8 caracteres) no válidos.' : (detalle || porDefecto)
}

export default function Usuarios() {
  const { negociosDisponibles } = useNegocio()
  const yo = JSON.parse(localStorage.getItem('user') || '{}')
  const esAdmin = yo.rol === 'admin'
  const nombreNegocio = Object.fromEntries(negociosDisponibles.map(n => [n.id, n.nombre]))

  const [usuarios, setUsuarios] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState(null)   // usuario en edición; null = alta
  const [form, setForm] = useState(VACIO)
  const [errorForm, setErrorForm] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true); setError('')
    try {
      const { data } = await usuariosApi.listar()
      setUsuarios(data)
    } catch (e) { setError(mensajeDeError(e, 'No se pudieron cargar los usuarios')) }
    finally { setCargando(false) }
  }, [])

  useEffect(() => { if (esAdmin) cargar() }, [esAdmin, cargar])

  function abrirAlta() {
    setEditando(null); setForm(VACIO); setErrorForm(''); setModal(true)
  }

  function abrirEdicion(u) {
    setEditando(u)
    setForm({ nombre: u.nombre, email: u.email, password: '', rol: u.rol, negocios: u.negocios, roles_clinica: u.roles_clinica || {}, activo: u.activo })
    setErrorForm(''); setModal(true)
  }

  function alternarNegocio(id) {
    setForm(f => ({
      ...f,
      negocios: f.negocios.includes(id) ? f.negocios.filter(n => n !== id) : [...f.negocios, id],
    }))
  }

  // Se manda el rol de cada negocio marcado ("" lo quita); los desmarcados lo pierden en el servidor
  const rolesClinica = () => Object.fromEntries(form.negocios.map(n => [n, form.roles_clinica[n] || '']))

  async function guardar(ev) {
    ev.preventDefault()
    setGuardando(true); setErrorForm('')
    try {
      if (editando) {
        const cambios = { nombre: form.nombre.trim(), rol: form.rol, negocios: form.negocios, roles_clinica: rolesClinica(), activo: form.activo }
        if (form.password) cambios.password = form.password   // vacío = no cambiar
        await usuariosApi.actualizar(editando.id, cambios)
      } else {
        const { activo, ...alta } = form
        const roles = Object.fromEntries(Object.entries(rolesClinica()).filter(([, r]) => r))
        await usuariosApi.crear({ ...alta, roles_clinica: roles, nombre: form.nombre.trim(), email: form.email.trim() })
      }
      setModal(false)
      await cargar()
    } catch (e) { setErrorForm(mensajeDeError(e, 'No se pudo guardar el usuario')) }
    finally { setGuardando(false) }
  }

  const editandoAMiMismo = editando && editando.id === yo.id

  const s = {
    h1:      { fontSize: 22, fontWeight: 700, margin: 0, color: '#1e293b' },
    card:    { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' },
    th:      { textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: 600, fontSize: 12 },
    td:      { padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontSize: 13, verticalAlign: 'middle' },
    btn:     (v = 'primary') => ({
      padding: '7px 16px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
      background: v === 'primary' ? '#3b82f6' : '#f1f5f9', color: v === 'primary' ? '#fff' : '#334155',
    }),
    chip:    { background: '#f1f5f9', color: '#475569', borderRadius: 20, padding: '2px 8px', fontSize: 11, marginRight: 4, display: 'inline-block', marginBottom: 2 },
    label:   { fontSize: 12, color: '#64748b', marginBottom: 4, display: 'block' },
    hint:    { fontSize: 11, color: '#94a3b8', marginTop: 3 },
    input:   { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' },
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    modal:   { background: '#fff', borderRadius: 12, padding: 28, width: 520, maxHeight: '90vh', overflowY: 'auto', maxWidth: '95vw' },
    err:     { background: '#fef2f2', color: '#b91c1c', borderRadius: 6, padding: '8px 12px', fontSize: 13, marginBottom: 12 },
    campo:   { marginBottom: 12 },
  }

  if (!esAdmin) {
    return <div style={{ color: '#64748b' }}>Solo un administrador puede administrar usuarios.</div>
  }

  return (
    <div style={{ fontFamily: 'system-ui,sans-serif', maxWidth: 1000 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={s.h1}>Usuarios</h1>
        <button style={s.btn()} onClick={abrirAlta}>+ Nuevo usuario</button>
      </div>

      {error && <div style={s.err}>{error}</div>}

      <div style={s.card}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{['Nombre', 'Email', 'Rol', 'Negocios', 'Estado', ''].map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {cargando && <tr><td colSpan={6} style={{ ...s.td, color: '#94a3b8' }}>Cargando…</td></tr>}
            {!cargando && usuarios.map(u => (
              <tr key={u.id} style={{ opacity: u.activo ? 1 : 0.5 }}>
                <td style={{ ...s.td, fontWeight: 600 }}>{u.nombre}{u.id === yo.id && <span style={{ color: '#94a3b8', fontWeight: 400 }}> (tú)</span>}</td>
                <td style={s.td}>{u.email}</td>
                <td style={s.td}>{NOMBRE_ROL[u.rol] || u.rol}</td>
                <td style={s.td}>
                  {u.negocios.length === 0
                    ? <span style={{ color: '#94a3b8' }}>Sin negocios</span>
                    : u.negocios.map(n => (
                      <span key={n} style={s.chip}>
                        {nombreNegocio[n] || n}
                        {u.roles_clinica?.[n] && <strong style={{ color: '#1d4ed8' }}> · {NOMBRE_ROL_CLINICA[u.roles_clinica[n]]}</strong>}
                      </span>
                    ))}
                </td>
                <td style={s.td}>{u.activo ? 'Activo' : 'Inactivo'}</td>
                <td style={{ ...s.td, textAlign: 'right' }}>
                  <button style={s.btn('ghost')} onClick={() => abrirEdicion(u)}>Editar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <div style={s.overlay} onClick={e => e.target === e.currentTarget && setModal(false)}>
          <form style={s.modal} onSubmit={guardar}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>
              {editando ? 'Editar usuario' : 'Nuevo usuario'}
            </div>
            {errorForm && <div style={s.err}>{errorForm}</div>}

            <div style={s.campo}>
              <label style={s.label}>Nombre</label>
              <input style={s.input} required minLength={2} value={form.nombre}
                onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} />
            </div>
            <div style={s.campo}>
              <label style={s.label}>Email</label>
              <input style={s.input} type="email" required disabled={Boolean(editando)} value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              {editando && <div style={s.hint}>El email no se puede cambiar.</div>}
            </div>
            <div style={s.campo}>
              <label style={s.label}>{editando ? 'Nueva contraseña' : 'Contraseña'}</label>
              <input style={s.input} type="password" minLength={8} required={!editando} value={form.password}
                autoComplete="new-password"
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
              <div style={s.hint}>{editando ? 'Déjala vacía para no cambiarla. ' : ''}Mínimo 8 caracteres.</div>
            </div>
            <div style={s.campo}>
              <label style={s.label}>Rol</label>
              <select style={s.input} value={form.rol} disabled={editandoAMiMismo}
                onChange={e => setForm(f => ({ ...f, rol: e.target.value }))}>
                {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {editandoAMiMismo && <div style={s.hint}>No puedes cambiar tu propio rol.</div>}
            </div>
            <div style={s.campo}>
              <label style={s.label}>Negocios</label>
              {negociosDisponibles.map(n => (
                <div key={n.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '3px 0' }}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <input type="checkbox" checked={form.negocios.includes(n.id)} onChange={() => alternarNegocio(n.id)} />
                    {n.nombre}
                  </label>
                  {form.negocios.includes(n.id) && (
                    <select style={{ ...s.input, width: 'auto', padding: '4px 8px', fontSize: 12 }} aria-label={`Rol de clínica en ${n.nombre}`}
                      value={form.roles_clinica[n.id] || ''}
                      onChange={e => setForm(f => ({ ...f, roles_clinica: { ...f.roles_clinica, [n.id]: e.target.value } }))}>
                      {ROLES_CLINICA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  )}
                </div>
              ))}
              <div style={s.hint}>
                Solo puedes asignar los negocios a los que tú tienes acceso. El rol de clínica define qué ve cada quien en
                expedientes, agenda, recetas, farmacia y consentimientos; los administradores ven todo.
              </div>
            </div>
            {editando && (
              <div style={s.campo}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" checked={form.activo} disabled={editandoAMiMismo}
                    onChange={e => setForm(f => ({ ...f, activo: e.target.checked }))} />
                  Activo (puede iniciar sesión)
                </label>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button type="button" style={s.btn('ghost')} onClick={() => setModal(false)}>Cancelar</button>
              <button type="submit" style={s.btn()} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
