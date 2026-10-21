// ============================================================
// Lógica del cruce: Excel de órdenes IP30 × datos SAP (ip30_datos_equipos)
// Portado de la herramienta HTML "completar_ordenes" (sin parte diario).
// ============================================================
import * as XLSX from 'xlsx'
import { colLetra } from './excelPatch'

export const DIAS_LECTURA_VIEJA = 30

const KEYP = [/^equipo$/i, /equipo|equipment|activo|asset|chapa|interno/i, /c[oó]d/i]
export const CAMPOS = [
  { id: 'key', label: 'Código de equipo', pats: KEYP },
  { id: 'loc', label: 'Ubicación técnica', pats: [/ubicaci.*t[eé]cn/i, /ubicaci/i] },
  { id: 'val', label: 'Última carga (contador)', pats: [/^(?!.*fecha).*[uú]ltim[ao].*carga/i, /^(?!.*fecha).*(contador|lectura|hkm)/i] },
  { id: 'date', label: 'Fecha de última carga', pats: [/fecha.*[uú]ltim[ao].*carga/i, /fecha.*(carga|contador|lectura)/i] },
  // Opcionales: si no se eligen, no se completan
  { id: 'prox', label: 'Próximo mantenimiento (opcional)', opcional: true, pats: [/pr[oó]x/i] },
  { id: 'falta', label: 'Falta/Pasó (opcional)', opcional: true, pats: [/falta|pas[oó]/i] },
]

export function normKey(v) {
  if (v == null) return ''
  return String(v).trim().toUpperCase().replace(/\s+/g, ' ').replace(/\.0+$/, '')
}
const sinCeros = (k) => k.replace(/^0+(?=\d)/, '')

const isBlankRow = (r) => !r || r.every((v) => v == null || v === '')

// ---------- lectura del Excel ----------
export function leerLibro(buf) {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  let mejor = wb.SheetNames[0], tam = -1
  for (const n of wb.SheetNames) {
    const ref = wb.Sheets[n]['!ref']; if (!ref) continue
    const r = XLSX.utils.decode_range(ref)
    const t = (r.e.r - r.s.r + 1) * (r.e.c - r.s.c + 1)
    if (t > tam) { tam = t; mejor = n }
  }
  return { wb, hojas: wb.SheetNames, hojaSugerida: mejor }
}

// Matriz de la hoja + desplazamiento real (por si la hoja no empieza en A1)
export function leerHoja(wb, nombre) {
  const ws = wb.Sheets[nombre]
  const ref = ws['!ref']
  if (!ref) return { aoa: [], r0: 0, c0: 0 }
  const rng = XLSX.utils.decode_range(ref)
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true })
  return { aoa, r0: rng.s.r, c0: rng.s.c }
}

export function detectarTitulos(aoa) {
  const lim = Math.min(30, aoa.length)
  const cnt = (i) => (aoa[i] || []).filter((v) => typeof v === 'string' && v.trim() !== '').length
  let mx = 0
  for (let i = 0; i < lim; i++) mx = Math.max(mx, cnt(i))
  for (let i = 0; i < lim; i++) if (cnt(i) >= Math.max(2, Math.floor(mx * 0.6))) return i
  return 0
}

export function titulos(aoa, fila) {
  let w = 0
  for (let i = 0; i < Math.min(60, aoa.length); i++) w = Math.max(w, (aoa[i] || []).length)
  const h = aoa[fila] || []
  return Array.from({ length: w }, (_, i) =>
    h[i] == null || String(h[i]).trim() === '' ? `(columna ${i + 1})` : String(h[i]).trim())
}

export function autoMapear(hs) {
  const map = {}
  for (const f of CAMPOS) {
    map[f.id] = -1
    for (const p of f.pats) { const i = hs.findIndex((h) => p.test(h)); if (i >= 0) { map[f.id] = i; break } }
  }
  return map
}

// ---------- datos SAP ----------
export function indexarDatos(filas) {
  const porEquipo = new Map(), porSap = new Map()
  for (const f of filas || []) {
    if (f.equipo) porEquipo.set(normKey(f.equipo), f)
    if (f.equipo_sap != null) porSap.set(sinCeros(String(f.equipo_sap)), f)
  }
  return { porEquipo, porSap }
}
function buscar(idx, k) {
  return idx.porEquipo.get(k) || (/^\d+$/.test(k) ? idx.porSap.get(sinCeros(k)) : undefined)
}

const fechaISO = (s) => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const diasEntre = (a, b) => Math.round((b - a) / 86400000)

// ---------- cruce ----------
// Devuelve las escrituras (fila/columna Excel base 1) y el resumen para la pantalla
export function cruzar({ aoa, r0, c0, filaTitulos, map, idx, hoy = new Date() }) {
  const st = {
    total: 0, conUbic: 0, conLect: 0, conProx: 0, proxYaCargado: 0,
    noIe36: new Set(), sinLectura: new Set(), viejas: new Map(), ubicDudosa: new Set(),
  }
  const escrituras = [], filas = []
  const hoy0 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  for (let r = filaTitulos + 1; r < aoa.length; r++) {
    const row = aoa[r]
    if (isBlankRow(row)) continue
    const kRaw = row[map.key], k = normKey(kRaw)
    if (!k) continue
    st.total++
    const filaExcel = r0 + r + 1
    const d = buscar(idx, k)
    const nombre = d?.equipo || k // si se buscó por N° SAP, se lista con el ID técnico
    const ubic = d?.en_ie36 ? (d.ubicacion || '') : ''
    if (!d?.en_ie36) st.noIe36.add(nombre)
    if (d?.ubicaciones_distintas > 1) st.ubicDudosa.add(nombre)
    if (ubic) { escrituras.push({ row: filaExcel, col: c0 + map.loc + 1, kind: 'text', v: ubic }); st.conUbic++ }

    const fecha = fechaISO(d?.fecha_lectura)
    let dias = null
    if (d && d.lectura != null && fecha) {
      escrituras.push({ row: filaExcel, col: c0 + map.val + 1, kind: 'num', v: Number(d.lectura) })
      escrituras.push({ row: filaExcel, col: c0 + map.date + 1, kind: 'date', v: fecha })
      st.conLect++
      dias = diasEntre(fecha, hoy0)
      if (dias > DIAS_LECTURA_VIEJA) st.viejas.set(nombre, dias)
    } else st.sinLectura.add(nombre)

    // Próximo mantenimiento: solo si la celda está vacía y la app lo puede calcular
    // (último mantenimiento con contador + período del equipo). Lo que ya cargó la encargada no se pisa.
    let prox = null
    if (map.prox >= 0) {
      const actual = row[map.prox]
      const vacia = actual == null || String(actual).trim() === ''
      if (!vacia) { st.proxYaCargado++; prox = Number.isFinite(Number(actual)) ? Number(actual) : null }
      else if (d?.prox_mantto != null) {
        prox = Number(d.prox_mantto)
        escrituras.push({ row: filaExcel, col: c0 + map.prox + 1, kind: 'num', v: prox })
        st.conProx++
      }
    }
    // Falta/Pasó: fórmula =H−I (se recalcula si la encargada corrige el próximo a mano)
    let falta = null
    if (map.falta >= 0 && map.prox >= 0) {
      const H = colLetra(c0 + map.prox + 1) + filaExcel, I = colLetra(c0 + map.val + 1) + filaExcel
      const lect = d?.lectura != null && fecha ? Number(d.lectura) : (typeof row[map.val] === 'number' ? row[map.val] : null)
      falta = prox != null && Number.isFinite(prox) && lect != null ? prox - lect : null
      escrituras.push({ row: filaExcel, col: c0 + map.falta + 1, kind: 'formula', f: `IF(OR(${H}="",${I}=""),"",${H}-${I})`, v: falta })
    }

    filas.push({ fila: filaExcel, equipo: String(kRaw).trim(), ubicacion: ubic, lectura: d?.lectura ?? null, fecha, dias, prox, falta })
  }
  return { escrituras, filas, st }
}
