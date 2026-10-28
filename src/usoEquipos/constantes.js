// Constantes del módulo Uso de equipos (estilos y formatos compartidos con Correctivos)
import { C, num, hoyPY } from '../correctivos/constantes'

export { C, s, num, ddmm, ddmmhhmm, coincide, hoyPY } from '../correctivos/constantes'

export const TIPOS_HALLAZGO = {
  uso_sin_parte: {
    label: 'Uso sin parte', corto: 'Sin parte', fg: C.rojo, bg: C.rojoBg,
    ayuda: 'El rastreo muestra trabajo y no hay parte. Pedir el parte a la obra.',
  },
  combustible_sin_parte: {
    label: 'Combustible sin parte', corto: 'Combustible', fg: '#7c2d12', bg: '#ffedd5',
    ayuda: 'Cargó combustible y no hay partes en esos días. Pedir los partes o la justificación.',
  },
  parte_sin_sap: {
    label: 'Parte sin SAP', corto: 'Sin SAP', fg: C.azul, bg: C.azulBg,
    ayuda: 'Hay parte pero no está imputado en SAP. Pedir la imputación a la obra.',
  },
  parte_sobre_rastreo: {
    label: 'Parte > rastreo', corto: 'Parte > rastreo', fg: '#6d28d9', bg: '#ede9fe',
    ayuda: 'El parte declara más de lo que muestra el rastreo. Pedir explicación antes de certificar.',
  },
  rastreo_sobre_parte: {
    label: 'Rastreo > parte', corto: 'Rastreo > parte', fg: C.ambar, bg: C.ambarBg,
    ayuda: 'El equipo trabajó más de lo declarado. Posibles horas sin certificar.',
  },
  // Imputaciones SAP anómalas (22/10/2026, ver supabase/uso_sap_anomalias.sql)
  sap_negativa: {
    label: 'SAP negativa', corto: 'SAP −', fg: '#9f1239', bg: '#ffe4e6',
    ayuda: 'Imputación negativa sin otra igual que la anule: la obra cargó al revés (ej. el horómetro como cantidad). Pedir que la anulen y la carguen bien.',
  },
  sap_imposible: {
    label: 'SAP imposible', corto: 'SAP > 24 h', fg: '#9f1239', bg: '#ffe4e6',
    ayuda: 'Más de 24 h o 1.500 km imputados en un día. Revisar con la obra la cantidad cargada.',
  },
  sap_sobre_parte: {
    label: 'SAP > parte', corto: 'SAP > parte', fg: '#0e7490', bg: '#cffafe',
    ayuda: 'SAP imputa más del doble que el parte (en el día y en la semana). Pedir el respaldo de lo imputado.',
  },
  sap_bajo_parte: {
    label: 'SAP < parte', corto: 'SAP < parte', fg: '#0e7490', bg: '#cffafe',
    ayuda: 'El parte dice más del doble de lo imputado (en el día y en la semana). Pedir a la obra que impute lo que falta.',
  },
}
export const ORDEN_TIPOS = ['sap_negativa', 'sap_imposible', 'uso_sin_parte', 'parte_sobre_rastreo', 'rastreo_sobre_parte', 'sap_sobre_parte', 'parte_sin_sap', 'sap_bajo_parte', 'combustible_sin_parte']

export const ESTADOS_CASO = {
  nuevo: { label: 'Nuevo', fg: C.rojo, bg: C.rojoBg },
  en_gestion: { label: 'En gestión', fg: C.azul, bg: C.azulBg },
  escalado: { label: 'Escalado', fg: '#6d28d9', bg: '#ede9fe' },
  cerrado: { label: 'Cerrado', fg: C.verde, bg: C.verdeBg },
}

export const TIPOS_EQUIPO = [
  { id: 'V', label: 'Vehículos' },
  { id: 'P', label: 'Pesados' },
  { id: 'M', label: 'Menores' },
  { id: 'B', label: 'Embarcaciones' },
  { id: 'S', label: 'Sin clasificar' },
]

export const ORIGEN_OBRA = {
  1: 'parte del día',
  2: 'imputación SAP del día',
  3: 'último parte o imputación anterior',
  4: 'ubicación técnica actual',
}

export const GESTION_LABEL = {
  gestion: 'Gestión', escalado: 'Escalado', devuelto: 'Devuelto', justificacion: 'Justificación',
  nota_gerencia: 'Nota de gerencia', auto: 'Automático',
}

// Bloques de monto (28/10/2026, ver supabase/uso_monto_bloques.sql). No se netean entre sí:
// lo imputado de más no compensa lo que falta imputar.
export const BLOQUES = {
  sap_falta: { label: 'Falta imputar en SAP', corto: 'Falta imputar', fg: C.azul, ayuda: 'Partes sin imputar o imputados de menos. Pedir a la obra que impute.' },
  sap_de_mas: { label: 'Imputado de más en SAP', corto: 'Imputado de más', fg: '#9f1239', ayuda: 'SAP imputa más que el parte (duplicados, cantidades imposibles). Pedir a la obra que anule.' },
  rastreo: { label: 'Rastreo vs parte (indicio)', corto: 'Rastreo (indicio)', fg: C.gris, ayuda: 'Diferencias entre rastreo y parte diario. No es un monto a regularizar en SAP.' },
}
export const ORDEN_BLOQUES = ['sap_falta', 'sap_de_mas', 'rastreo']

// Suma montos netos con signo por bloque: { sap_falta, sap_de_mas (negativo), rastreo }
export function montosPorBloque(hallazgos) {
  const m = { sap_falta: 0, sap_de_mas: 0, rastreo: 0 }
  hallazgos.forEach((h) => { if (h.bloque in m) m[h.bloque] += Number(h.monto_neto_signado) || 0 })
  return m
}
// Magnitud total (para ordenar por importancia sin que lo de más reste)
export const magnitud = (m) => Math.abs(m.sap_falta || 0) + Math.abs(m.sap_de_mas || 0) + Math.abs(m.rastreo || 0)

// Montos
export const gs = (n) => (n == null ? '—' : (Number(n) < 0 ? '−' : '') + 'Gs. ' + Math.abs(Math.round(Number(n))).toLocaleString('es-PY'))
export function gsCorto(n) {
  if (n == null) return '—'
  const v = Number(n)
  const sig = v < 0 ? '−' : ''
  const a = Math.abs(v)
  if (a < 1e6) return a > 0 ? sig + '< Gs. 1 M' : 'Gs. 0'
  return '~Gs. ' + sig + Math.round(a / 1e6).toLocaleString('es-PY') + ' M'
}

// Cantidades en la unidad del equipo
export function cant(q, unidad) {
  if (q == null) return '—'
  const v = Number(q)
  if (unidad === 'km') return `${Math.round(v).toLocaleString('es-PY')} km`
  return `${v.toLocaleString('es-PY', { maximumFractionDigits: 1 })} h`
}
export const litros = (l) => (l == null ? '—' : `${num(Math.round(l))} L`)

// Días entre una fecha YYYY-MM-DD y hoy (Asunción)
export function diasDesde(fecha) {
  if (!fecha) return null
  const a = new Date(fecha + 'T00:00:00Z')
  const b = new Date(hoyPY() + 'T00:00:00Z')
  return Math.round((b - a) / 86400000)
}

export const LOTE = 1000       // filas por página (PostgREST corta en 1000)
export const LIMITE = 20000    // tope total por consulta (aviso visible si se alcanza)
