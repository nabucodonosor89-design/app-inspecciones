// Constantes del módulo Repuestos (kits de mantenimiento y cobertura de stock)
// Paleta y estilos base compartidos con Correctivos.
import { C, s } from '../correctivos/constantes'

export { C, s }

export const LIMITE = 2000 // filas por consulta

export const GRIS_BG = '#f3f4f6'

export const ESTADOS = [
  { id: 'riesgo', label: 'Riesgo', fg: C.rojo, bg: C.rojoBg },
  { id: 'atencion', label: 'Atención', fg: C.ambar, bg: C.ambarBg },
  { id: 'ok', label: 'OK', fg: C.verde, bg: C.verdeBg },
  { id: 'sin_consumo', label: 'Sin consumo', fg: C.gris, bg: GRIS_BG },
]
export const ESTADO = Object.fromEntries(ESTADOS.map((e) => [e.id, e]))
export const ESTADOS_DEFECTO = ['riesgo', 'atencion']

export const LECTURAS = [
  { id: 'trabado', label: 'Trabado', fg: C.rojo, bg: C.rojoBg },
  { id: 'en_curso', label: 'En curso', fg: C.ambar, bg: C.ambarBg },
  { id: 'cerrada_sin_consumo', label: 'Cerrada sin consumo', fg: C.gris, bg: GRIS_BG },
]
export const LECTURA = Object.fromEntries(LECTURAS.map((l) => [l.id, l]))

// Mismo orden que rep.tipo_material() en supabase/repuestos_setup.sql
export const TIPOS = [
  'Aceite', 'Grasa', 'Análisis de aceite', 'Filtro trampa de agua', 'Filtro de aceite', 'Filtro de aire',
  'Filtro de combustible', 'Filtro hidráulico', 'Filtro refrigerante', 'Otro',
]

export const ORIGEN_SIN_REVISAR = ['sugerido', 'app']

export function hoyPY() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' })
}

// Número es-PY (1.303,2). dec = máximo de decimales.
export function num(n, dec = 1) {
  if (n == null || n === '') return '—'
  return Number(n).toLocaleString('es-PY', { maximumFractionDigits: dec })
}

// Cantidad con unidad: 1.303,2 L
export function cant(n, unidad, dec = 1) {
  if (n == null) return '—'
  return unidad ? `${num(n, dec)} ${unidad}` : num(n, dec)
}

// dd/mm (agrega /aa si no es del año en curso). Las fechas YYYY-MM-DD se leen tal cual.
export function ddmm(fecha) {
  if (!fecha) return '—'
  const anioActual = hoyPY().slice(0, 4)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha)
  if (m && fecha.length === 10) return m[1] === anioActual ? `${m[3]}/${m[2]}` : `${m[3]}/${m[2]}/${m[1].slice(2)}`
  const d = new Date(fecha)
  if (isNaN(d)) return '—'
  const anio = d.toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' }).slice(0, 4)
  return d.toLocaleDateString('es-PY', {
    day: '2-digit', month: '2-digit', ...(anio !== anioActual ? { year: '2-digit' } : {}), timeZone: 'America/Asuncion',
  })
}

// Búsqueda libre en varios campos
export function coincide(texto, ...campos) {
  if (!texto) return true
  const t = texto.toLowerCase()
  return campos.some((c) => c != null && String(c).toLowerCase().includes(t))
}

export const listaFamilias = (txt) => (txt ? txt.split(', ').filter(Boolean) : [])

// Orden de materiales: cobertura ascendente, sin consumo al final
export function ordenCobertura(a, b) {
  const ca = a.cobertura_meses == null ? Infinity : Number(a.cobertura_meses)
  const cb = b.cobertura_meses == null ? Infinity : Number(b.cobertura_meses)
  return ca - cb || String(a.material).localeCompare(String(b.material))
}
