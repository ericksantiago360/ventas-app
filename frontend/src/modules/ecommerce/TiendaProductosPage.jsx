import { useEffect, useState } from 'react'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNegocio } from '../../context/NegocioContext'
import { req, qs, s } from './comun'

// Una fila arrastrable del catálogo en la tienda
function FilaProducto({ producto, posicion }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: producto._id || producto.id })
  const imagen = producto.medios?.[0]?.url || producto.imagen
  return (
    <div ref={setNodeRef} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '8px 4px', borderBottom: '1px solid #f1f5f9',
      transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1,
      background: isDragging ? '#f8fafc' : undefined, touchAction: 'none',
    }}>
      <span {...attributes} {...listeners} aria-label="Arrastrar" style={{ cursor: 'grab', color: '#94a3b8', userSelect: 'none', fontSize: 18, padding: '0 4px' }}>⠿</span>
      <span style={{ width: 22, color: '#94a3b8', fontSize: 12 }}>{posicion + 1}</span>
      {imagen
        ? <img src={imagen} alt="" draggable={false} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6 }} />
        : <div style={{ width: 40, height: 40, borderRadius: 6, background: '#f1f5f9' }} />}
      <span style={{ flex: 1, fontSize: 14 }}>{producto.nombre}</span>
      <span style={{ fontSize: 13, color: '#64748b' }}>{producto.precio_base ? `$${producto.precio_base}` : '—'}</span>
    </div>
  )
}

// Qué categorías del catálogo interno se ven en la tienda. Sin selección = todas.
export default function TiendaProductosPage() {
  const { negocioId } = useNegocio()
  const [categorias, setCategorias] = useState([])
  const [seleccion, setSeleccion] = useState(new Set())
  const [productos, setProductos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    if (!negocioId) return
    setCargando(true); setError(''); setMensaje('')
    Promise.all([
      req(`/api/admin/tienda/categorias?${qs({ negocio_id: negocioId })}`),
      req(`/api/admin/tienda/config?${qs({ negocio_id: negocioId })}`),
      req(`/api/catalogo/productos?${qs({ negocio_id: negocioId, limit: 200 })}`),
    ])
      .then(([cat, cfg, prods]) => {
        setCategorias(cat.data)
        setSeleccion(new Set(cfg.categorias_visibles || []))
        // Orden de la tienda; los no ordenados van al final, por nombre
        const ordenados = [...prods.data].sort((a, b) =>
          (a.posicion_tienda ?? Infinity) - (b.posicion_tienda ?? Infinity) || (a.nombre || '').localeCompare(b.nombre || ''))
        setProductos(ordenados)
      })
      .catch(e => setError(e.message))
      .finally(() => setCargando(false))
  }, [negocioId])

  // Guarda el nuevo orden al soltar; si falla, regresa al orden anterior
  const reordenar = async ({ active, over }) => {
    if (!over || active.id === over.id) return
    const idOf = p => p._id || p.id
    const anterior = productos
    const desde = anterior.findIndex(p => idOf(p) === active.id)
    const hasta = anterior.findIndex(p => idOf(p) === over.id)
    const nuevo = arrayMove(anterior, desde, hasta)
    setProductos(nuevo)
    setError(''); setMensaje('')
    try {
      await req(`/api/admin/tienda/productos/orden?${qs({ negocio_id: negocioId })}`, {
        method: 'PUT', body: JSON.stringify({ ids: nuevo.map(idOf) }),
      })
      setMensaje('Orden del catálogo guardado')
    } catch (e) {
      setProductos(anterior)
      setError(e.message)
    }
  }

  const alternar = (id) => setSeleccion(prev => {
    const nueva = new Set(prev)
    nueva.has(id) ? nueva.delete(id) : nueva.add(id)
    return nueva
  })

  const guardar = async () => {
    setGuardando(true); setError(''); setMensaje('')
    try {
      await req(`/api/admin/tienda/config?${qs({ negocio_id: negocioId })}`, {
        method: 'PUT', body: JSON.stringify({ categorias_visibles: [...seleccion] }),
      })
      setMensaje('Categorías guardadas')
    } catch (e) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={s.h1}>Productos en la tienda</h1>
        <button style={s.btn()} onClick={guardar} disabled={guardando || cargando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
      <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
        Elige las categorías del catálogo que se muestran al público. Si no eliges ninguna, se muestran todas.
        Los productos se editan en Catálogo; aquí solo decides qué se publica.
      </div>

      {error && <div style={{ ...s.err, marginTop: 14 }}>{error}</div>}
      {mensaje && <div style={{ background: '#dcfce7', color: '#15803d', borderRadius: 6, padding: '8px 12px', fontSize: 13, marginTop: 14 }}>{mensaje}</div>}

      <div style={{ ...s.card, marginTop: 16 }}>
        {cargando && <div style={{ color: '#64748b' }}>Cargando…</div>}
        {!cargando && categorias.length === 0 && (
          <div style={{ color: '#64748b' }}>Este negocio aún no tiene categorías. Créalas en Catálogo.</div>
        )}
        {categorias.map(c => (
          <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={seleccion.has(c.id)} onChange={() => alternar(c.id)} />
            {c.nombre}
          </label>
        ))}
      </div>

      <div style={{ ...s.card, marginTop: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Orden del catálogo</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
          Arrastra para cambiar el orden en que aparecen los productos en la tienda.
        </div>
        {!cargando && productos.length === 0 && (
          <div style={{ color: '#64748b' }}>No hay productos activos en el catálogo.</div>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reordenar}>
          <SortableContext items={productos.map(p => p._id || p.id)} strategy={verticalListSortingStrategy}>
            {productos.map((p, i) => <FilaProducto key={p._id || p.id} producto={p} posicion={i} />)}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  )
}
