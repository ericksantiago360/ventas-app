export const MONEDAS = [
  { value: 'MXN', label: 'MXN — Peso mexicano',      simbolo: '$',  decimales: 2 },
  { value: 'USD', label: 'USD — Dólar estadounidense', simbolo: 'US$', decimales: 2 },
  { value: 'EUR', label: 'EUR — Euro',                simbolo: '€',  decimales: 2 },
];

// Helper para mostrar monto con símbolo
export function formatMonto(monto, moneda = 'MXN') {
  const m = MONEDAS.find(x => x.value === moneda) ?? MONEDAS[0];
  return `${m.simbolo}${Number(monto ?? 0).toLocaleString('es-MX', {
    minimumFractionDigits: m.decimales,
    maximumFractionDigits: m.decimales,
  })}`;
}
