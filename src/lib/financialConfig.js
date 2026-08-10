// Financiero es parte fija de todo proyecto (como Contactos en Entidades) —
// nunca se prende/apaga por campo custom. Cada pieza se activa o no por
// workspace desde Configuración → Financiero (workspaces.financial_config,
// jsonb). Moneda no está acá: es la base de todo lo demás, siempre activa.
export const FINANCIAL_FEATURES = [
  { key: 'hitos', label: 'Hitos', desc: 'Pagos parciales del deal, con monto y fecha (o "al cierre", "contra entrega"...).' },
  { key: 'historial_precio', label: 'Historial de precio', desc: 'Registro de cómo evolucionó el precio negociado a lo largo del proyecto.' },
  { key: 'volumen', label: 'Volumen / Cantidad', desc: 'Kg, unidades u otra medida — se combina con el precio para saber el valor real del deal.' },
  { key: 'condiciones_pago', label: 'Condiciones de pago', desc: 'Texto libre — "30 días", "50% anticipo", etc.' },
  { key: 'valor_estimado', label: 'Valor estimado del deal', desc: 'Una cifra a mano, para cuando todavía no definiste los hitos pero ya tenés un número en la cabeza.' },
]

const DEFAULTS = { hitos: true, historial_precio: true, volumen: true, condiciones_pago: true, valor_estimado: false }

export function resolveFinancialConfig(raw) {
  return { ...DEFAULTS, ...(raw || {}) }
}

export const UNIT_OPTIONS = [
  { value: 'kg', label: 'Kilogramo (kg)' },
  { value: 'litro', label: 'Litro (L)' },
  { value: 'unidad', label: 'Unidad' },
  { value: 'servicio', label: 'Servicio' },
  { value: 'proyecto', label: 'Proyecto completo' },
]
