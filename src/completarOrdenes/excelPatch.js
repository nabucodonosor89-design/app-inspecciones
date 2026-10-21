// ============================================================
// Escribe valores en celdas de un .xlsx SIN tocar el resto del archivo.
// Abre el zip (jszip), edita solo el XML de la hoja y, si hace falta un
// formato de fecha, agrega un estilo a styles.xml. Formato, anchos, filtros,
// colores y demás hojas quedan exactamente como venían del IP30.
// ============================================================
import JSZip from 'jszip'

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const FORMATO_FECHA = 'dd/mm/yyyy'

export function colLetra(n) { // 1 → A
  let s = ''
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) }
  return s
}
function colNum(ref) { // "AB12" → 28
  const m = /^([A-Z]+)/.exec(ref)
  let n = 0
  for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64
  return n
}
const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml')
const serializar = (doc) => {
  const s = new XMLSerializer().serializeToString(doc)
  return s.startsWith('<?xml') ? s : DECL + s
}
const hijos = (el, nombre) => Array.from(el.childNodes).filter((n) => n.nodeType === 1 && n.localName === nombre)
function crear(doc, nombre) {
  const pre = doc.documentElement.prefix
  return doc.createElementNS(NS, pre ? `${pre}:${nombre}` : nombre)
}

// Fecha JS (se usa año/mes/día locales) → número de serie de Excel
export function serieExcel(d) {
  return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000
}

async function rutaHoja(zip, nombreHoja) {
  const wb = parse(await zip.file('xl/workbook.xml').async('string'))
  const hoja = Array.from(wb.getElementsByTagNameNS(NS, 'sheet')).find((s) => s.getAttribute('name') === nombreHoja)
  if (!hoja) throw new Error(`No encontré la hoja "${nombreHoja}" en el archivo`)
  const rid = hoja.getAttributeNS(NS_R, 'id') || hoja.getAttribute('r:id')
  const rels = parse(await zip.file('xl/_rels/workbook.xml.rels').async('string'))
  const rel = Array.from(rels.getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === rid)
  if (!rel) throw new Error('No pude ubicar la hoja dentro del archivo')
  const t = rel.getAttribute('Target')
  return t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '')
}

// ---------- estilos: un estilo con formato de fecha por cada estilo original ----------
const FECHAS_INTEGRADAS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57])
function crearGestorEstilos(stylesDoc) {
  if (!stylesDoc) return null
  const root = stylesDoc.documentElement
  const cellXfs = hijos(root, 'cellXfs')[0]
  if (!cellXfs) return null
  let numFmts = hijos(root, 'numFmts')[0]
  const formatos = new Map() // id → código
  if (numFmts) hijos(numFmts, 'numFmt').forEach((n) => formatos.set(+n.getAttribute('numFmtId'), n.getAttribute('formatCode') || ''))
  const esFecha = (id) => FECHAS_INTEGRADAS.has(id) ||
    (formatos.has(id) && /[dy]/i.test(formatos.get(id).replace(/\[[^\]]*\]|"[^"]*"/g, '')))

  let idFecha = null
  const cache = new Map()
  let cambio = false
  return {
    get cambio() { return cambio },
    // Devuelve un índice de estilo que muestra fecha y conserva fuente/borde/relleno del original
    fecha(sOriginal) {
      const xfs = hijos(cellXfs, 'xf')
      const base = xfs[sOriginal] || xfs[0]
      if (base && esFecha(+(base.getAttribute('numFmtId') || 0))) return sOriginal
      if (cache.has(sOriginal)) return cache.get(sOriginal)
      if (idFecha == null) {
        for (const [id, cod] of formatos) if (cod === FORMATO_FECHA) idFecha = id
        if (idFecha == null) {
          idFecha = Math.max(163, ...formatos.keys()) + 1
          if (!numFmts) {
            numFmts = crear(stylesDoc, 'numFmts')
            root.insertBefore(numFmts, hijos(root, 'fonts')[0] || root.firstChild)
          }
          const nf = crear(stylesDoc, 'numFmt')
          nf.setAttribute('numFmtId', String(idFecha))
          nf.setAttribute('formatCode', FORMATO_FECHA)
          numFmts.appendChild(nf)
          numFmts.setAttribute('count', String(hijos(numFmts, 'numFmt').length))
          formatos.set(idFecha, FORMATO_FECHA)
        }
      }
      const nuevo = base ? base.cloneNode(true) : crear(stylesDoc, 'xf')
      nuevo.setAttribute('numFmtId', String(idFecha))
      nuevo.setAttribute('applyNumberFormat', '1')
      cellXfs.appendChild(nuevo)
      const idx = hijos(cellXfs, 'xf').length - 1
      cellXfs.setAttribute('count', String(idx + 1))
      cache.set(sOriginal, idx)
      cambio = true
      return idx
    },
  }
}

// ---------- celdas ----------
function filaDe(doc, sheetData, r) {
  const filas = hijos(sheetData, 'row')
  let sig = null
  for (const f of filas) {
    const n = +f.getAttribute('r')
    if (n === r) return f
    if (n > r) { sig = f; break }
  }
  const nueva = crear(doc, 'row')
  nueva.setAttribute('r', String(r))
  sheetData.insertBefore(nueva, sig)
  return nueva
}
function celdaDe(doc, fila, c, r) {
  const ref = colLetra(c) + r
  let sig = null
  for (const cel of hijos(fila, 'c')) {
    const rr = cel.getAttribute('r')
    const n = rr ? colNum(rr) : 0
    if (n === c) return cel
    if (n > c) { sig = cel; break }
  }
  const nueva = crear(doc, 'c')
  nueva.setAttribute('r', ref)
  // estilo de la fila (si la fila tiene formato propio)
  if (fila.getAttribute('customFormat') === '1' && fila.getAttribute('s')) nueva.setAttribute('s', fila.getAttribute('s'))
  fila.insertBefore(nueva, sig)
  fila.removeAttribute('spans') // es solo una pista de columnas; se quita para no dejarla desactualizada
  return nueva
}

/**
 * @param {ArrayBuffer} buf  archivo original
 * @param {string} hoja      nombre de la hoja a modificar
 * @param {Array<{row:number,col:number,kind:'text'|'num'|'date'|'formula',v:any,f?:string}>} escrituras  fila/columna base 1
 *        kind 'formula': f = fórmula sin '='; v = valor ya calculado (o null) para que se vea aunque no se recalcule
 * @returns {Promise<Blob>}
 */
export async function escribirCeldas(buf, hoja, escrituras) {
  const zip = await JSZip.loadAsync(buf)
  const ruta = await rutaHoja(zip, hoja)
  const doc = parse(await zip.file(ruta).async('string'))
  const sheetData = doc.getElementsByTagNameNS(NS, 'sheetData')[0]
  if (!sheetData) throw new Error('La hoja no tiene datos')

  const stylesFile = zip.file('xl/styles.xml')
  const stylesDoc = stylesFile ? parse(await stylesFile.async('string')) : null
  const estilos = crearGestorEstilos(stylesDoc)
  let quitoFormula = false
  let hayFormulas = false

  for (const w of escrituras) {
    const fila = filaDe(doc, sheetData, w.row)
    const cel = celdaDe(doc, fila, w.col, w.row)
    for (const h of Array.from(cel.childNodes)) {
      if (h.nodeType === 1 && h.localName === 'f') quitoFormula = true
      cel.removeChild(h)
    }
    cel.removeAttribute('t')
    if (w.kind === 'formula') {
      hayFormulas = true
      const f = crear(doc, 'f')
      f.textContent = w.f
      cel.appendChild(f)
      const v = crear(doc, 'v')
      if (w.v == null || !Number.isFinite(Number(w.v))) cel.setAttribute('t', 'str')
      else v.textContent = String(w.v)
      cel.appendChild(v)
    } else if (w.kind === 'text') {
      cel.setAttribute('t', 'inlineStr')
      const is = crear(doc, 'is'), t = crear(doc, 't')
      t.textContent = String(w.v)
      if (/^\s|\s$/.test(t.textContent)) t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
      is.appendChild(t); cel.appendChild(is)
    } else {
      const v = crear(doc, 'v')
      v.textContent = String(w.kind === 'date' ? serieExcel(w.v) : w.v)
      cel.appendChild(v)
      if (w.kind === 'date' && estilos) cel.setAttribute('s', String(estilos.fecha(+(cel.getAttribute('s') || 0))))
    }
  }

  zip.file(ruta, serializar(doc))

  // Con fórmulas nuevas, se pide a Excel que recalcule todo al abrir
  if (hayFormulas) {
    const wbDoc = parse(await zip.file('xl/workbook.xml').async('string'))
    let calcPr = wbDoc.getElementsByTagNameNS(NS, 'calcPr')[0]
    if (!calcPr) { calcPr = crear(wbDoc, 'calcPr'); wbDoc.documentElement.appendChild(calcPr) }
    calcPr.setAttribute('fullCalcOnLoad', '1')
    zip.file('xl/workbook.xml', serializar(wbDoc))
  }
  if (estilos?.cambio) zip.file('xl/styles.xml', serializar(stylesDoc))

  // Si se pisó alguna fórmula, la cadena de cálculo queda vieja: se quita (Excel la regenera)
  if (quitoFormula && zip.file('xl/calcChain.xml')) {
    zip.remove('xl/calcChain.xml')
    const ct = parse(await zip.file('[Content_Types].xml').async('string'))
    Array.from(ct.getElementsByTagName('Override'))
      .filter((o) => o.getAttribute('PartName') === '/xl/calcChain.xml')
      .forEach((o) => o.parentNode.removeChild(o))
    zip.file('[Content_Types].xml', serializar(ct))
    const rels = parse(await zip.file('xl/_rels/workbook.xml.rels').async('string'))
    Array.from(rels.getElementsByTagName('Relationship'))
      .filter((r) => /calcChain/.test(r.getAttribute('Target') || ''))
      .forEach((r) => r.parentNode.removeChild(r))
    zip.file('xl/_rels/workbook.xml.rels', serializar(rels))
  }

  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
