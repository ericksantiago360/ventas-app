import { useState } from 'react'
import { dinero } from '../api'

// Datos para pagar. La referencia es lo más importante: sin ella no se identifica el pago.
function Dato({ etiqueta, valor }) {
  const [copiado, setCopiado] = useState(false)
  if (!valor) return null
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(String(valor))
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    } catch {
      // Sin permiso de portapapeles el valor queda visible para copiarlo a mano
    }
  }
  return (
    <div className="instruccion">
      <div>
        <div className="muted" style={{ fontSize: 12 }}>{etiqueta}</div>
        <code>{valor}</code>
      </div>
      <button type="button" className="copiar" onClick={copiar}>{copiado ? 'Copiado' : 'Copiar'}</button>
    </div>
  )
}

export default function PagoInstrucciones({ instrucciones }) {
  if (!instrucciones) return null
  const esSpei = instrucciones.tipo === 'transferencia'
  return (
    <div className="panel">
      <strong>{instrucciones.etiqueta}</strong>
      <div style={{ marginTop: 8 }}>
        {esSpei ? (
          <>
            <Dato etiqueta="Banco" valor={instrucciones.banco} />
            <Dato etiqueta="Titular" valor={instrucciones.titular} />
            <Dato etiqueta="CLABE" valor={instrucciones.clabe} />
          </>
        ) : (
          <>
            <Dato etiqueta="Número de servicio (convenio CIE)" valor={instrucciones.convenio_cie} />
          </>
        )}
        <Dato etiqueta="Monto exacto" valor={dinero(instrucciones.monto)} />
        <Dato etiqueta="Referencia (inclúyela en el concepto)" valor={instrucciones.referencia} />
      </div>
      {instrucciones.instrucciones && <p className="muted" style={{ marginBottom: 0 }}>{instrucciones.instrucciones}</p>}
      <p className="muted" style={{ fontSize: 13 }}>
        {esSpei
          ? 'Tu pedido se confirma en 1 a 2 días hábiles después de recibir el pago.'
          : 'Pide en caja "pago de servicio CIE" y entrega estos datos. Tu pedido se confirma al recibir el pago.'}
      </p>
    </div>
  )
}
