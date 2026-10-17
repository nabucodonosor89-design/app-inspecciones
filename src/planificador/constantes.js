// Constantes del Planificador de inspecciones

// Días vencido al generar el plan: null = nunca inspeccionado; ≤ 0 = vence esta semana
export function textoVencido(dias) {
  if (dias == null) return 'Nunca'
  if (dias > 0) return `${dias} d vencido`
  if (dias === 0) return 'Vence hoy'
  return `Vence en ${-dias} d`
}

export const ESTADOS = {
  al_dia: { label: 'Al día' },
  vencido: { label: 'Vencido' },
  nunca: { label: 'Nunca' },
}

export const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0)
