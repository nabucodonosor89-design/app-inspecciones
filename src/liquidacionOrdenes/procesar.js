// Lógica del módulo Liquidación de órdenes (todo en el navegador, no se guarda nada).
// Misma lógica que la página liquidacion-ordenes.html que se usaba antes.
import * as XLSX from 'xlsx'

export const TIPOS = ['TCPV', 'TCOC']
export const STATUS_CERRADA = '9EQL'

// Lee un archivo .xlsx/.xls → workbook de SheetJS
export function leerLibro(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        resolve(XLSX.read(new Uint8Array(e.target.result), { type: 'array' }))
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

// ── reporteSaldos ──
// SheetJS omite la col A vacía, por lo que los índices son:
//   row[0] = texto de orden (col B en Excel)
//   row[1] = Cargo (col C), row[2] = Abono (col D), row[4] = Saldo (col F)
// Solo órdenes de trabajo: número que empieza con 4 (4xxxxxxx)
export function parseSaldos(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
  const map = {}

  for (const row of rows) {
    const colOrden = row[0] != null ? String(row[0]).trim() : ''
    const match = colOrden.match(/^\s*(4\d+)/)
    if (!match) continue

    const num = match[1]
    const cargo = parseFloat(row[1]) || 0
    const abono = parseFloat(row[2]) || 0
    const saldo = row[4]

    if (saldo == null || saldo === 0 || saldo === '') continue
    const saldoNum = parseFloat(saldo)
    if (saldoNum === 0 || isNaN(saldoNum)) continue

    map[num] = { cargo, abono, saldo: saldoNum }
  }
  return map
}

// ── ordenes ──
// Fila 0 = encabezados. A=Orden, B=Equipo, C=Clase de orden, E=Texto breve,
// K=Denominación equipo, L=Status sistema, M=Status usuario
export function parseOrdenes(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
  const map = {}

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row[0]) continue
    const num = String(row[0]).trim()
    if (!/^\d+$/.test(num)) continue

    map[num] = {
      equipo: String(row[1] || '').trim(),
      tipo: String(row[2] || '').trim().toUpperCase(),
      textoBreve: String(row[4] || '').trim(),
      denomEquipo: String(row[10] || '').replace(/\xa0/g, ' ').trim(),
      statusSistema: String(row[11] || '').trim(),
      statusUsuario: String(row[12] || '').trim(),
    }
  }
  return map
}

// Cruce → { abiertas, cerradas, sinCruce }
export function procesar(wbSaldos, wbOrdenes) {
  const saldos = parseSaldos(wbSaldos)
  const ordenes = parseOrdenes(wbOrdenes)
  const abiertas = []
  const cerradas = []
  let sinCruce = 0

  for (const [num, sd] of Object.entries(saldos)) {
    const o = ordenes[num]
    if (!o) { sinCruce++; continue }
    if (!TIPOS.includes(o.tipo)) continue

    const fila = {
      orden: num,
      tipo: o.tipo,
      equipo: o.equipo,
      textoBreve: o.textoBreve || o.denomEquipo || '—',
      statusSistema: o.statusSistema,
      statusUsuario: o.statusUsuario,
      cargo: sd.cargo,
      abono: sd.abono,
      saldo: sd.saldo,
    }
    ;(o.statusUsuario === STATUS_CERRADA ? cerradas : abiertas).push(fila)
  }
  return { abiertas, cerradas, sinCruce }
}

// Filtro por tipo + orden por columna
export function filtrarOrdenar(filas, tipo, orden) {
  const r = tipo === 'all' ? [...filas] : filas.filter((f) => f.tipo === tipo)
  r.sort((a, b) => {
    let av = a[orden.col]
    let bv = b[orden.col]
    if (typeof av === 'number' && typeof bv === 'number') return orden.dir === 'asc' ? av - bv : bv - av
    av = String(av ?? '').toLowerCase()
    bv = String(bv ?? '').toLowerCase()
    if (av < bv) return orden.dir === 'asc' ? -1 : 1
    if (av > bv) return orden.dir === 'asc' ? 1 : -1
    return 0
  })
  return r
}

export const totales = (filas) => filas.reduce(
  (t, f) => ({ cargo: t.cargo + f.cargo, abono: t.abono + f.abono, saldo: t.saldo + f.saldo }),
  { cargo: 0, abono: 0, saldo: 0 },
)

export const monto = (n) => (n == null || n === ''
  ? '—'
  : Number(n).toLocaleString('es-PY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

// Excel con encabezado informativo, tabla y fila de totales
export function exportarExcel(filas, cual, tipo) {
  const estado = cual === 'abiertas' ? 'Abiertas' : 'Cerradas'
  const hoy = new Date().toLocaleDateString('es-PY', { timeZone: 'America/Asuncion' })
  const t = totales(filas)

  const aoa = [
    [`Liquidación de Órdenes — ${estado} con Saldo`],
    [`Generado: ${hoy}   |   Filtro tipo: ${tipo === 'all' ? 'Todas (TCPV + TCOC)' : tipo}   |   Total: ${filas.length} órdenes`],
    [],
    ['N° Orden', 'Tipo', 'Equipo', 'Descripción', 'Status', 'Cargo', 'Abono', 'Saldo'],
    ...filas.map((f) => [f.orden, f.tipo, f.equipo || '', f.textoBreve || '', f.statusUsuario || '', f.cargo, f.abono, f.saldo]),
    [],
    [`TOTAL (${filas.length})`, '', '', '', '', t.cargo, t.abono, t.saldo],
  ]

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [
    { wch: 12 }, { wch: 7 }, { wch: 12 }, { wch: 45 },
    { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, estado)

  const fecha = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' })
  XLSX.writeFile(wb, `Ordenes_${estado}_${tipo === 'all' ? 'TCPV-TCOC' : tipo}_${fecha}.xlsx`)
}
