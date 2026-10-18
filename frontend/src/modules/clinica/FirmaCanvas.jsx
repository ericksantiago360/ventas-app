import { useEffect, useRef, useState } from 'react'
import { s } from './comun'

// Firma a mano en un lienzo (mouse, dedo o lápiz). Se guarda como PNG recortado al trazo.
export default function FirmaCanvas({ onListo, cancelar, alto = 160, textoListo = 'Usar esta firma' }) {
  const lienzo = useRef(null)
  const trazando = useRef(false)
  const [vacio, setVacio] = useState(true)

  useEffect(() => {
    const c = lienzo.current
    const escala = window.devicePixelRatio || 1
    c.width = c.offsetWidth * escala
    c.height = c.offsetHeight * escala
    const ctx = c.getContext('2d')
    ctx.scale(escala, escala)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0f172a'
  }, [])

  const punto = (e) => {
    const r = lienzo.current.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const empezar = (e) => {
    e.preventDefault()
    lienzo.current.setPointerCapture(e.pointerId)
    trazando.current = true
    const ctx = lienzo.current.getContext('2d')
    ctx.beginPath()
    ctx.moveTo(...punto(e))
  }
  const mover = (e) => {
    if (!trazando.current) return
    const ctx = lienzo.current.getContext('2d')
    ctx.lineTo(...punto(e))
    ctx.stroke()
    setVacio(false)
  }
  const terminar = () => { trazando.current = false }

  function limpiar() {
    const c = lienzo.current
    c.getContext('2d').clearRect(0, 0, c.width, c.height)
    setVacio(true)
  }

  function usar() {
    // Recorta el espacio en blanco alrededor del trazo
    const c = lienzo.current
    const { data, width, height } = c.getContext('2d').getImageData(0, 0, c.width, c.height)
    let x0 = width, y0 = height, x1 = 0, y1 = 0
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
    }
    const m = 6
    const recorte = document.createElement('canvas')
    recorte.width = x1 - x0 + m * 2
    recorte.height = y1 - y0 + m * 2
    recorte.getContext('2d').drawImage(c, x0 - m, y0 - m, recorte.width, recorte.height, 0, 0, recorte.width, recorte.height)
    onListo(recorte.toDataURL('image/png'))
  }

  return (
    <div>
      <canvas ref={lienzo} onPointerDown={empezar} onPointerMove={mover} onPointerUp={terminar} onPointerCancel={terminar}
        style={{ width: '100%', height: alto, border: '1px dashed #94a3b8', borderRadius: 8, background: '#fff', touchAction: 'none', cursor: 'crosshair', display: 'block' }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" style={s.btn('ghost')} onClick={limpiar}>Borrar</button>
        {cancelar && <button type="button" style={s.btn('ghost')} onClick={cancelar}>Cancelar</button>}
        <button type="button" style={{ ...s.btn(), marginLeft: 'auto' }} disabled={vacio} onClick={usar}>{textoListo}</button>
      </div>
    </div>
  )
}
