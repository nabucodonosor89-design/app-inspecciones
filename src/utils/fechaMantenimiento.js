// ============================================================
// Validación de la fecha de un mantenimiento (inspección, 🔧 Mantenimiento, Concluido en la bandeja)
// · Rechaza fechas futuras y anteriores a FECHA_MIN_MTTO (atrapa años mal tipeados, ej. 0026 en vez de 2026).
// · Pide confirmación si la fecha tiene más de DIAS_AVISO_MTTO días (puede ser real, pero conviene revisarla).
// ============================================================

export const FECHA_MIN_MTTO = '2020-01-01'
export const DIAS_AVISO_MTTO = 365

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const hoyISO = () => iso(new Date())

const fechaCorta = (f) => String(f).slice(0, 10).split('-').reverse().join('/')

// Mensaje de error, o null si la fecha sirve. Vacía = null (cada formulario decide si es obligatoria).
export function errorFechaMantenimiento(fecha) {
  if (!fecha) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return 'La fecha del mantenimiento no es válida'
  if (fecha < FECHA_MIN_MTTO) return `La fecha del mantenimiento (${fechaCorta(fecha)}) es anterior a 2020: revisá el año`
  if (fecha > hoyISO()) return 'La fecha del mantenimiento no puede ser futura'
  return null
}

// Texto de confirmación si la fecha es válida pero tiene más de un año; null si no hace falta confirmar.
export function avisoFechaVieja(fecha) {
  if (!fecha || errorFechaMantenimiento(fecha)) return null
  const limite = new Date()
  limite.setDate(limite.getDate() - DIAS_AVISO_MTTO)
  if (fecha >= iso(limite)) return null
  return `La fecha del mantenimiento (${fechaCorta(fecha)}) tiene más de un año. ¿Es correcta?`
}
