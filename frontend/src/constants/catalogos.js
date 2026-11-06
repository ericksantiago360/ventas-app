export const MONEDAS = [
  { value: 'MXN', label: 'MXN — Peso mexicano',      simbolo: '$',  decimales: 2 },
  { value: 'USD', label: 'USD — Dólar estadounidense', simbolo: 'US$', decimales: 2 },
  { value: 'EUR', label: 'EUR — Euro',                simbolo: '€',  decimales: 2 },
];

// Usos CFDI (c_UsoCFDI) más usados. Mismo listado para Facturación y Datos fiscales.
export const USOS_CFDI = [
  { value: 'S01', label: 'S01 · Sin efectos fiscales' },
  { value: 'G03', label: 'G03 · Gastos en general' },
  { value: 'D01', label: 'D01 · Honorarios médicos y gastos hospitalarios' },
  { value: 'G01', label: 'G01 · Adquisición de mercancías' },
  { value: 'CP01', label: 'CP01 · Pagos' },
];

// Helper para mostrar monto con símbolo
export function formatMonto(monto, moneda = 'MXN') {
  const m = MONEDAS.find(x => x.value === moneda) ?? MONEDAS[0];
  return `${m.simbolo}${Number(monto ?? 0).toLocaleString('es-MX', {
    minimumFractionDigits: m.decimales,
    maximumFractionDigits: m.decimales,
  })}`;
}
