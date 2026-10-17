import { useNavigate } from 'react-router-dom'
import { useNegocio } from '../context/NegocioContext'

const MODULOS = [
  { ruta: '/crm',          label: 'CRM',           desc: 'Clientes y leads'       },
  { ruta: '/catalogo',     label: 'Catálogo',       desc: 'Productos y precios'    },
  { ruta: '/cotizaciones', label: 'Cotizaciones',   desc: 'PDF y pipeline'         },
  { ruta: '/pedidos',      label: 'Pedidos',        desc: 'Kanban de producción'   },
  { ruta: '/finanzas',     label: 'Finanzas',       desc: 'Cuentas y movimientos'  },
  { ruta: '/contabilidad', label: 'Contabilidad',   desc: 'Balance y reportes'     },
  { ruta: '/inventario',   label: 'Inventario',     desc: 'Stock y consignación'   },
  { ruta: '/reportes',     label: 'Reportes',       desc: 'KPIs y dashboard'       },
  { ruta: '/personal',     label: 'Personal',       desc: 'Empleados y nómina'     },
  { ruta: '/pacientes',    label: 'Pacientes',      desc: 'Expedientes clínicos'   },
  { ruta: '/resultados',   label: 'Resultados',     desc: 'Órdenes y captura'      },
]

export default function Dashboard() {
  const user = JSON.parse(localStorage.getItem('user') || '{}')
  const navigate = useNavigate()
  const { negocioId, negociosDisponibles } = useNegocio()

  return (
    <div>
      <h1 style={{ fontSize:22, fontWeight:500, color:'#1e293b', margin:'0 0 4px' }}>
        Bienvenido, {user.nombre || 'Erick'}
      </h1>
      <p style={{ color:'#64748b', fontSize:14, margin:'0 0 2rem' }}>
        Sistema de ventas · Teotihuacán
      </p>

      {/* Negocios activos */}
      <div style={{ display:'flex', gap:8, marginBottom:'2rem' }}>
        {negociosDisponibles.map(neg => (
          <span key={neg.id} style={{
            background: neg.id === negocioId ? '#dbeafe' : '#f1f5f9',
            color:      neg.id === negocioId ? '#1d4ed8' : '#475569',
            fontSize:12, padding:'3px 10px', borderRadius:100,
            border:'1px solid #e2e8f0',
          }}>
            {neg.nombre}
          </span>
        ))}
      </div>

      {/* Grid de módulos */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px,1fr))', gap:12 }}>
        {MODULOS.map(({ ruta, label, desc }) => (
          <button key={ruta} onClick={() => navigate(ruta)}
            style={{
              background:'#fff', border:'1px solid #e2e8f0', borderRadius:8,
              padding:'1rem', textAlign:'left', cursor:'pointer',
              transition:'border-color .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = '#94a3b8'}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#e2e8f0'}
          >
            <div style={{ fontWeight:500, color:'#1e293b', marginBottom:4 }}>{label}</div>
            <div style={{ fontSize:12, color:'#94a3b8' }}>{desc}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
