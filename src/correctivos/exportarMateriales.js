import * as XLSX from 'xlsx'
import { SITUACION, hoyPY } from './constantes'

const n = (v) => (v == null || v === '' ? null : Number(v))

// Exporta a Excel las líneas de materiales visibles (respeta filtros de tipo, búsqueda y origen).
// Hoja 1 "Por material": una fila por material y centro, para Depósito / Compras.
// Hoja 2 "Detalle": una fila por línea de reserva, con la orden y el equipo.
export function exportarMateriales(filas) {
  const orden = { bloqueo: 0, parcial: 1, despacho: 2 }

  const detalle = [...filas]
    .sort((a, b) => (a.centro || '').localeCompare(b.centro || '') || orden[a.situacion] - orden[b.situacion]
      || String(a.orden).localeCompare(String(b.orden)))
    .map((f) => ({
      'Centro': f.centro,
      'Situación': SITUACION[f.situacion]?.label || f.situacion,
      'Equipo': f.equipo || '(sin código)',
      'Denominación': f.denominacion || '',
      'Orden': n(f.orden),
      'Aviso': n(f.aviso),
      'Texto de la orden': f.texto_orden || '',
      'Origen': f.origen,
      'Taller / ubicación': f.taller_o_ubicacion || '',
      'Crítico': f.es_critico ? 'Sí' : 'No',
      'Días': n(f.dias),
      'Material': f.material,
      'Descripción': f.descripcion || '',
      'Unidad': f.unidad || '',
      'Pendiente': n(f.cantidad_pendiente),
      'Stock centro': n(f.stock_centro) ?? 0,
      'Cubierto': n(f.cantidad_cubierta),
      'A comprar': n(f.cantidad_faltante),
    }))

  const grupos = {}
  filas.forEach((f) => {
    const k = `${f.centro}|${f.material}`
    const g = (grupos[k] ||= {
      centro: f.centro, material: f.material, descripcion: f.descripcion, unidad: f.unidad,
      stock: n(f.stock_centro) ?? 0, pendiente: 0, cubierto: 0, faltante: 0,
      ordenes: new Set(), equipos: new Set(), critico: false, diasMax: 0,
    })
    g.pendiente += n(f.cantidad_pendiente) || 0
    g.cubierto += n(f.cantidad_cubierta) || 0
    g.faltante += n(f.cantidad_faltante) || 0
    g.ordenes.add(f.orden)
    if (f.equipo) g.equipos.add(f.equipo)
    g.critico ||= !!f.es_critico
    g.diasMax = Math.max(g.diasMax, n(f.dias) || 0)
  })
  const porMaterial = Object.values(grupos)
    .map((g) => ({
      'Centro': g.centro,
      'Situación': g.cubierto <= 0 ? SITUACION.bloqueo.label : g.faltante > 0 ? SITUACION.parcial.label : SITUACION.despacho.label,
      'Material': g.material,
      'Descripción': g.descripcion || '',
      'Unidad': g.unidad || '',
      'Stock centro': g.stock,
      'Pendiente total': g.pendiente,
      'A despachar': g.cubierto,
      'A comprar': g.faltante,
      'Órdenes': [...g.ordenes].join(', '),
      'Equipos': [...g.equipos].join(', '),
      'Algún crítico': g.critico ? 'Sí' : 'No',
      'Días máx. esperando': g.diasMax,
    }))
    .sort((a, b) => a['Centro'].localeCompare(b['Centro']) || b['A comprar'] - a['A comprar'] || b['Días máx. esperando'] - a['Días máx. esperando'])

  const wb = XLSX.utils.book_new()
  const h1 = XLSX.utils.json_to_sheet(porMaterial)
  h1['!cols'] = [8, 18, 16, 40, 7, 11, 13, 11, 10, 28, 28, 12, 16].map((w) => ({ wch: w }))
  const h2 = XLSX.utils.json_to_sheet(detalle)
  h2['!cols'] = [8, 18, 12, 30, 10, 10, 40, 9, 26, 7, 6, 16, 40, 7, 10, 11, 9, 10].map((w) => ({ wch: w }))
  XLSX.utils.book_append_sheet(wb, h1, 'Por material')
  XLSX.utils.book_append_sheet(wb, h2, 'Detalle')
  XLSX.writeFile(wb, `correctivos_materiales_${hoyPY()}.xlsx`)
}
