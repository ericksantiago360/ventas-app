import axios from 'axios'

const api = axios.create({
  baseURL: '',
  timeout: 15_000,
})

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export const authApi = {
  login: (email, password) => {
    const body = new URLSearchParams({
      username: email,
      password,
    })
    return api.post('/auth/login', body)
  },

  me: () => api.get('/auth/me'),
}

export const negociosApi = {
  listar: (params) => api.get('/api/negocios', { params }),
  crear: (datos) => api.post('/api/negocios', datos),
  actualizar: (id, datos) => api.put(`/api/negocios/${id}`, datos),
}

export const usuariosApi = {
  listar:     () => api.get('/api/usuarios'),
  crear:      (datos) => api.post('/api/usuarios', datos),
  actualizar: (id, datos) => api.put(`/api/usuarios/${id}`, datos),
}

export const crmApi = {
  resumen: (params) =>
    api.get('/api/crm/resumen', { params }),

  clientes: {
    listar: (params) =>
      api.get('/api/crm/clientes', { params }),

    crear: (body) =>
      api.post('/api/crm/clientes', body),

    obtener: (id) =>
      api.get(`/api/crm/clientes/${id}`),

    editar: (id, body) =>
      api.put(`/api/crm/clientes/${id}`, body),

    eliminar: (id) =>
      api.patch(`/api/crm/clientes/${id}/estado`, {
        activo: false,
      }),
  },

  oportunidades: {
    kanban: (negocioId, tipoLead) =>
      api.get(`/api/crm/kanban/${negocioId}`, {
        params: { tipo_lead: tipoLead || undefined },
      }),

    crear: (body) =>
      api.post('/api/crm/oportunidades', body),

    editar: (id, body) =>
      api.put(`/api/crm/oportunidades/${id}`, body),

    moverEtapa: (id, etapa) =>
      api.put(`/api/crm/oportunidades/${id}/etapa`, { etapa }),

    eliminar: (id) =>
      api.delete(`/api/crm/oportunidades/${id}`),
  },

  leads: {
    kanban: (negocioId) =>
      api.get(`/api/crm/leads/kanban/${negocioId}`),

    crear: (body) =>
      api.post('/api/crm/leads', body),

    moverEtapa: (id, etapa) =>
      api.put(`/api/crm/leads/${id}/etapa`, { etapa }),

    convertir: (id, body) =>
      api.post(`/api/crm/leads/${id}/convertir`, body),

    descartar: (id, motivo) =>
      api.post(`/api/crm/leads/${id}/descartar`, { motivo }),
  },
}
export const cotizacionesApi = {
  listar: (params) =>
    api.get('/api/cotizaciones/', { params }),

  obtener: (id) =>
    api.get(`/api/cotizaciones/${id}`),

  crear: (body) =>
    api.post('/api/cotizaciones/', body),

  editar: (id, body) =>
    api.put(`/api/cotizaciones/${id}`, body),

  cambiarEstado: (id, estado) =>
    api.patch(`/api/cotizaciones/${id}/estado`, {
      estado,
    }),

  eliminar: (id) =>
    api.delete(`/api/cotizaciones/${id}`),

  pdf: (id) =>
    api.get(`/api/cotizaciones/${id}/pdf`, {
      responseType: 'blob',
    }),
}