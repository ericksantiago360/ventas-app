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

// Perfiles fiscales IVA/IEPS 2026 (espejo de backend/app/modules/ecommerce/impuestos.py)
export const PERFILES_FISCALES = [
  { value: '', label: 'Sin desglose (IVA % de arriba)' },
  { value: 'general', label: 'General 16%' },
  { value: 'iva_cero', label: 'Tasa 0% (alimentos básicos)' },
  { value: 'exento', label: 'Exento de IVA' },
  { value: 'bebida_azucarada', label: 'Bebida azucarada (cuota por litro)' },
  { value: 'bebida_edulcorante', label: 'Bebida con edulcorante (por litro)' },
  { value: 'bebida_energizante', label: 'Bebida energizante' },
  { value: 'alta_densidad', label: 'Alta densidad ≥275 kcal/100 g' },
  { value: 'alcohol_14', label: 'Cerveza hasta 14° GL' },
  { value: 'alcohol_20', label: 'Bebida de 14° a 20° GL' },
  { value: 'alcohol_mas_20', label: 'Bebida de más de 20° GL' },
  { value: 'cigarros', label: 'Cigarros' },
  { value: 'puros_mano', label: 'Puros hechos a mano' },
];

// Helper para mostrar monto con símbolo
export function formatMonto(monto, moneda = 'MXN') {
  const m = MONEDAS.find(x => x.value === moneda) ?? MONEDAS[0];
  return `${m.simbolo}${Number(monto ?? 0).toLocaleString('es-MX', {
    minimumFractionDigits: m.decimales,
    maximumFractionDigits: m.decimales,
  })}`;
}
