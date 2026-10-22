// Constantes del módulo Trabajo de equipos (solo lectura, sin alarmas)
// Paleta y estilos base compartidos con Correctivos.
import { hoyPY } from '../correctivos/constantes'

export { C, s, hoyPY } from '../correctivos/constantes'

export const MAX_DIAS = 366
export const FUENTES = ['sap', 'parte', 'gps', 'combustible']
export const FUENTE_LABEL = { sap: 'SAP', parte: 'Parte', gps: 'GPS', combustible: 'Combustible' }

// ── Fechas YYYY-MM-DD (siempre como texto, sin zona horaria) ──────────
const aDate = (f) => new Date(f + 'T00:00:00Z')
const aTexto = (d) => d.toISOString().slice(0, 10)

export function sumarDias(fecha, n) {
  const d = aDate(fecha)
  d.setUTCDate(d.getUTCDate() + n)
  return aTexto(d)
}

export const diasEntre = (desde, hasta) => Math.round((aDate(hasta) - aDate(desde)) / 86400000) + 1

// Todos los días del rango, del más nuevo al más viejo
export function diasDelRango(desde, hasta) {
  const n = diasEntre(desde, hasta)
  if (!(n > 0)) return []
  return Array.from({ length: Math.min(n, MAX_DIAS) }, (_, i) => sumarDias(hasta, -i))
}

const DIAS_SEMANA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

// "jue 09/10"
export function diaCorto(fecha) {
  const d = aDate(fecha)
  return `${DIAS_SEMANA[d.getUTCDay()]} ${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`
}

// dd/mm (agrega /aa si no es del año en curso)
export function ddmm(fecha) {
  if (!fecha) return '—'
  const base = `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`
  return fecha.slice(0, 4) === hoyPY().slice(0, 4) ? base : `${base}/${fecha.slice(2, 4)}`
}

// Chips de rango → { desde, hasta }
export const RANGOS = [
  ['7d', '7 días'], ['30d', '30 días'], ['mes', 'Este mes'], ['mes_ant', 'Mes anterior'], ['anio', 'Este año'],
]
export function rangoDe(id) {
  const hoy = hoyPY()
  const [a, m] = hoy.split('-').map(Number)
  if (id === '7d') return { desde: sumarDias(hoy, -6), hasta: hoy }
  if (id === '30d') return { desde: sumarDias(hoy, -29), hasta: hoy }
  if (id === 'mes') return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy }
  if (id === 'mes_ant') {
    const ini = m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, '0')}-01`
    return { desde: ini, hasta: sumarDias(`${hoy.slice(0, 7)}-01`, -1) }
  }
  if (id === 'anio') return { desde: `${a}-01-01`, hasta: hoy }
  return null
}

// ── Cantidades ─────────────────────────────────────────────────────────
export const UNIDAD_LABEL = { h: 'h', km: 'km', viaje: 'viajes', l: 'L' }

export function num(n, dec = 1) {
  if (n == null) return '—'
  return Number(n).toLocaleString('es-PY', { maximumFractionDigits: dec })
}

// km y litros sin decimales; horas y viajes con 1
export function cant(q, unidad) {
  if (q == null) return '—'
  const dec = unidad === 'km' || unidad === 'l' ? 0 : 1
  return `${num(q, dec)} ${UNIDAD_LABEL[unidad] || unidad || ''}`.trim()
}

// "1036 · Obra PARACEL" / texto del parte / centro de la carga
export function obraTexto(obra, nombre) {
  if (!obra) return 'Sin obra'
  return nombre ? `${obra} · ${nombre}` : obra
}

// La denominación de la app suele repetir el ID técnico al principio: se saca
export function denominacionLimpia(equipo, denominacion) {
  if (!denominacion) return ''
  const d = denominacion.trim()
  return d.toUpperCase().startsWith(equipo.toUpperCase()) ? d.slice(equipo.length).trim() : d
}
