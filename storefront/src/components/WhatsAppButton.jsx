// Botón flotante de contacto rápido. Acepta el número con o sin signos, con lada.
export default function WhatsAppButton({ numero }) {
  const limpio = (numero || '').replace(/\D/g, '')
  if (!limpio) return null
  return (
    <a className="whatsapp" href={`https://wa.me/${limpio}`} target="_blank" rel="noreferrer">
      WhatsApp
    </a>
  )
}
