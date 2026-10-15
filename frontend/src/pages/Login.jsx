import { useState } from 'react'
import { authApi } from '../api/client'

const s = {
  wrap:  { display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'#f8fafc' },
  card:  { background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:'2rem', width:360 },
  title: { margin:'0 0 1.5rem', fontSize:20, fontWeight:500, color:'#1e293b' },
  label: { fontSize:13, color:'#64748b', display:'block', marginBottom:4 },
  input: { width:'100%', padding:'8px 12px', border:'1px solid #e2e8f0', borderRadius:6, fontSize:14, outline:'none', boxSizing:'border-box' },
  btn:   { width:'100%', padding:'9px', background:'#0f172a', color:'#fff', border:'none', borderRadius:6, fontSize:14, cursor:'pointer', marginTop:4 },
  err:   { color:'#dc2626', fontSize:13, margin:'0 0 12px' },
}

export default function Login() {
  const [form, setForm]     = useState({ email: '', password: '' })
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async e => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { data } = await authApi.login(form.email, form.password)
      localStorage.setItem('token', data.access_token)
      localStorage.setItem('user', JSON.stringify(data.user))
      window.location.href = '/'
    } catch (err) {
      setError(err.response?.data?.detail || 'Error de conexión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <h1 style={s.title}>Ventas App</h1>
        <form onSubmit={submit}>
          <div style={{ marginBottom:12 }}>
            <label style={s.label}>Email</label>
            <input style={s.input} type="email" value={form.email}
              onChange={set('email')} required autoFocus />
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={s.label}>Contraseña</label>
            <input style={s.input} type="password" value={form.password}
              onChange={set('password')} required />
          </div>
          {error && <p style={s.err}>{error}</p>}
          <button style={s.btn} type="submit" disabled={loading}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
