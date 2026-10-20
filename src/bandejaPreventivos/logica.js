// ============================================================
// Bandeja de preventivos — lectura del Excel IP30/IW39 y armado de listas
// La lectura del libro reutiliza src/completarOrdenes/logica.js (leerLibro, leerHoja, detectarTitulos, titulos).
// Al servidor (RPC ip30_subir) viajan solo filas: {orden, equipo_sap, equipo, clase, fecha_plan, texto}.
// ============================================================
import * as XLSX from 'xlsx'
import { leerLibro, leerHoja, detectarTitulos, titulos } from '../completarOrdenes/logica'

export { leerLibro }

// Columnas que se buscan en el Excel (las de la encargada — Estado, Próx. mantto, Falta/Pasó… — ya no se leen)
export const CAMPOS_IP30 = [
  { id: 'orden', label: 'N° de orden', obligatorio: true, pats: [/^orden$/i, /n[°º]?\s*orden|orden/i] },
  { id: 'equipo', label: 'Equipo (N° SAP o ID técnico)', obligatorio: true, pats: [/^equipo$/i, /equipo/i] },
  { id: 'fecha', label: 'Fecha plan (Fe/inic/extrema)', obligatorio: false, pats: [/fe.*inic/i, /fecha.*(plan|inic)/i, /inicio/i] },
  { id: 'texto', label: 'Denominación / texto', obligatorio: false, pats: [/denomina/i, /texto|descrip/i] },
  { id: 'clase', label: 'Clase de orden', obligatorio: false, pats: [/clase/i] },
]

export function mapearColumnas(aoa, fila) {
  const hs = titulos(aoa, fila)
  const map = {}
  for (const c of CAMPOS_IP30) {
    map[c.id] = -1
    for (const p of c.pats) { const i = hs.findIndex((h) => p.test(h)); if (i >= 0) { map[c.id] = i; break } }
  }
  // La clase suele venir en una columna sin título (TCPV, TCOC…): se busca por contenido
  if (map.clase < 0) {
    for (let col = 0; col < hs.length; col++) {
      let n = 0, ok = 0
      for (let r = fila + 1; r < Math.min(aoa.length, fila + 60); r++) {
        const v = aoa[r]?.[col]
        if (v == null || v === '') continue
        n++; if (/^TC[A-Z]{2}$/.test(String(v).trim())) ok++
      }
      if (n && ok / n > 0.8) { map.clase = col; break }
    }
  }
  return { hs, map }
}

export function prepararHoja(wb, nombre) {
  const { aoa } = leerHoja(wb, nombre)
  const fila = detectarTitulos(aoa)
  return { aoa, fila, ...mapearColumnas(aoa, fila) }
}

const pad = (n) => String(n).padStart(2, '0')
function aFechaISO(v) {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v)) {
    // SheetJS a veces devuelve 23:59:xx del día anterior por la zona horaria: se redondea al día más cercano
    const d = new Date(v.getTime() + 12 * 3600 * 1000)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  if (typeof v === 'number') { // serial de Excel
    const d = XLSX.SSF.parse_date_code(v)
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : null
  }
  const m = String(v).trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/)
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return `${y}-${pad(m[2])}-${pad(m[1])}` }
  const iso = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
}
const limpiar = (v) => (v == null ? null : String(v).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() || null)

// Filas para ip30_subir + resumen de lo que no se pudo leer
export function filasIP30({ aoa, fila, map }) {
  const filas = [], sinOrden = []
  for (let r = fila + 1; r < aoa.length; r++) {
    const row = aoa[r]
    if (!row || row.every((v) => v == null || v === '')) continue
    const ordenRaw = row[map.orden]
    const orden = Number(String(ordenRaw ?? '').replace(/\D/g, ''))
    if (!orden) { sinOrden.push(r + 1); continue }
    const eq = limpiar(row[map.equipo])
    const esNumero = eq && /^\d+$/.test(eq)
    filas.push({
      orden,
      equipo_sap: esNumero ? Number(eq) : null,
      equipo: esNumero ? null : eq,
      clase: map.clase >= 0 ? limpiar(row[map.clase]) : null,
      fecha_plan: map.fecha >= 0 ? aFechaISO(row[map.fecha]) : null,
      texto: map.texto >= 0 ? limpiar(row[map.texto]) : null,
    })
  }
  return { filas, sinOrden }
}

// ---------- semáforo de J ----------
export function colorJ(r) {
  if (r.j == null) return 'gris'
  const j = Number(r.j)
  if (j <= 0) return 'rojo'
  return j <= Number(r.umbral) ? 'ambar' : 'verde'
}
export const RANGO_COLOR = { rojo: 0, ambar: 1, verde: 2, gris: 3 }

// Orden abierta (para listas): no cerrada en SAP ni concluida/cancelada por la encargada
export const abierta = (r) => !['CTEC', 'CERR'].includes(r.estado_sap) && !['concluido', 'cancelado'].includes(r.estado_confirmado)

// ---------- exportaciones ----------
const ddmmyyyy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')
const den = (r) => (r.denominacion || r.texto || '').replace(/^\S+\s+/, '').trim()
export const ESTADO_TXT = { programado: 'Programado', reprogramado: 'Reprogramado', concluido: 'Concluido', cancelado: 'Cancelado', verificar: 'Verificar' }

function descargar(hojas, nombre) {
  const wb = XLSX.utils.book_new()
  for (const [titulo, filas, anchos] of hojas) {
    const ws = XLSX.utils.json_to_sheet(filas.length ? filas : [{ '': 'Sin datos' }])
    if (anchos) ws['!cols'] = anchos.map((w) => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, titulo.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))
  }
  XLSX.writeFile(wb, nombre)
}

const filaLista = (r) => ({
  Equipo: r.equipo,
  Denominación: den(r),
  Ubicación: r.ubicacion || '',
  'Próx. mantenimiento': r.h != null ? Number(r.h) : '',
  Unidad: r.unidad || '',
  'Lectura actual': r.lectura != null ? Number(r.lectura) : '',
  'Falta/Pasó': r.j != null ? Number(r.j) : '',
  'Fecha lectura': ddmmyyyy(r.lectura_fecha),
  Fuente: r.j_fuente || '',
  Estado: ESTADO_TXT[r.estado_confirmado] || (r.estado_sugerido ? `(${ESTADO_TXT[r.estado_sugerido]})` : ''),
  Orden: r.orden,
})
const ANCHOS_LISTA = [12, 30, 28, 12, 7, 12, 10, 12, 9, 14, 10]

// Próximos mantenimientos (ámbar y rojo) de órdenes abiertas
export function proximos(rows) {
  return rows.filter((r) => abierta(r) && ['rojo', 'ambar'].includes(colorJ(r)))
    .sort((a, b) => Number(a.j) - Number(b.j))
}

export function exportarListaObra(rows, obra, fecha) {
  const f = proximos(rows).filter((r) => (r.ubicacion || '(sin ubicación)') === obra)
  descargar([[obra, f.map(filaLista), ANCHOS_LISTA]], `Proximos mantenimientos ${obra} ${fecha}.xlsx`)
}

export function exportarListaGeneral(rows, fecha) {
  const f = proximos(rows).sort((a, b) => (a.ubicacion || '').localeCompare(b.ubicacion || '') || Number(a.j) - Number(b.j))
  descargar([['Todas las obras', f.map(filaLista), ANCHOS_LISTA]], `Proximos mantenimientos ${fecha}.xlsx`)
}

// Reprogramadas: para cambiar la fecha de cada orden en SAP
export function exportarReprogramadas(rows, fecha) {
  const f = rows.filter((r) => r.estado_confirmado === 'reprogramado' && !['CTEC', 'CERR'].includes(r.estado_sap))
    .sort((a, b) => String(a.nueva_fecha || '').localeCompare(String(b.nueva_fecha || '')) || a.orden - b.orden)
    .map((r) => ({
      Orden: r.orden, Equipo: r.equipo, Denominación: den(r), Ubicación: r.ubicacion || '',
      'Fecha plan SAP': ddmmyyyy(r.fecha_plan), 'Nueva fecha': ddmmyyyy(r.nueva_fecha),
      'Falta/Pasó': r.j != null ? Number(r.j) : '', Unidad: r.unidad || '', Notas: r.notas || '',
    }))
  descargar([['Reprogramadas', f, [10, 12, 30, 28, 13, 12, 10, 7, 40]]], `Ordenes reprogramadas ${fecha}.xlsx`)
}
