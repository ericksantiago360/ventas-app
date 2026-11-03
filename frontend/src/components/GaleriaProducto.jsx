import { useState } from 'react'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, rectSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// Miniatura de un medio: imagen o video de YouTube (thumbnail + ícono de play)
export function miniatura(medio) {
  return medio.tipo === 'youtube' ? medio.thumbnail : medio.url
}

function MedioSortable({ medio, principal, onQuitar }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: medio.id })

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        position: 'relative',
        width: 96,
        height: 96,
        borderRadius: 8,
        overflow: 'hidden',
        border: principal ? '2px solid #1F6FEB' : '1px solid #e2e8f0',
        cursor: 'grab',
        flexShrink: 0,
        touchAction: 'none',
        background: '#f8fafc',
      }}
    >
      <img src={miniatura(medio)} alt="" draggable={false}
        style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />

      {medio.tipo === 'youtube' && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.35)', pointerEvents: 'none',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,0,0,.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ color: '#fff', fontSize: 12, marginLeft: 2 }}>▶</span>
          </div>
        </div>
      )}

      {principal && (
        <span style={{
          position: 'absolute', left: 4, bottom: 4, background: '#1F6FEB', color: '#fff',
          fontSize: 10, borderRadius: 4, padding: '1px 5px', pointerEvents: 'none',
        }}>Principal</span>
      )}

      <button
        type="button"
        aria-label="Quitar"
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onQuitar(medio.id) }}
        style={{
          position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,.6)', color: '#fff',
          border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', fontSize: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >✕</button>
    </div>
  )
}

function AgregarYoutube({ onAgregar }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function agregar() {
    if (!url.trim()) return
    setEnviando(true)
    setError('')
    try {
      await onAgregar(url.trim())
      setUrl('')
    } catch (err) {
      setError(err?.message || 'No fue posible agregar el video.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <label style={{ fontWeight: 600, display: 'block', marginBottom: 4, fontSize: 13 }}>
        Agregar video de YouTube
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="url"
          value={url}
          onChange={e => { setUrl(e.target.value); setError('') }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregar() } }}
          placeholder="https://youtube.com/watch?v=... o youtu.be/..."
          style={{ flex: 1, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6 }}
        />
        <button type="button" onClick={agregar} disabled={enviando || !url.trim()}
          style={{ whiteSpace: 'nowrap', padding: '6px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>
          {enviando ? 'Agregando…' : '+ Agregar'}
        </button>
      </div>
      {error && <p style={{ color: '#ef4444', fontSize: 12, margin: '4px 0 0' }}>{error}</p>}
      <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
        Soporta links de YouTube, YouTube Shorts y youtu.be
      </p>
    </div>
  )
}

/**
 * Galería controlada de imágenes y videos mezclados. `medios` es la lista ordenada
 * (el primero es el principal). El padre persiste:
 *   onReordenar(nuevaLista), onQuitar(id), onSubir(archivos), onAgregarYoutube(url)
 */
export default function GaleriaProducto({ medios, subiendo = false, onReordenar, onQuitar, onSubir, onAgregarYoutube }) {
  const sensors = useSensors(
    // El umbral de distancia evita que un clic normal se confunda con un arrastre
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const ids = medios.map(m => m.id)

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const desde = ids.indexOf(active.id)
    const hasta = ids.indexOf(over.id)
    if (desde < 0 || hasta < 0) return
    onReordenar(arrayMove(medios, desde, hasta))
  }

  return (
    <div>
      <p style={{ margin: '0 0 8px', color: '#64748b', fontSize: 12 }}>
        Arrastra para reordenar · El primer elemento es el principal
      </p>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {medios.map((medio, i) => (
              <MedioSortable key={medio.id} medio={medio} principal={i === 0} onQuitar={onQuitar} />
            ))}

            <label style={{
              width: 96, height: 96, borderRadius: 8, border: '2px dashed #cbd5e1',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              cursor: subiendo ? 'wait' : 'pointer', flexShrink: 0, color: '#64748b', fontSize: 12, gap: 4,
            }}>
              <span style={{ fontSize: 24, lineHeight: 1 }}>+</span>
              Imagen
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                hidden
                disabled={subiendo}
                onChange={e => {
                  const archivos = Array.from(e.target.files || [])
                  e.target.value = ''
                  if (archivos.length) onSubir(archivos)
                }}
              />
            </label>
          </div>
        </SortableContext>
      </DndContext>

      <AgregarYoutube onAgregar={onAgregarYoutube} />
    </div>
  )
}
