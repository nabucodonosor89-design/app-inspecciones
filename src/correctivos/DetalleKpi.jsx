import * as XLSX from 'xlsx'
import { C, s, num, ddmm, hoyPY, MOTIVOS, SITUACION, evidencia } from './constantes'
import TablaResponsive from './TablaResponsive'

// Lista detrás de cada indicador del Resumen. Cada columna tiene `txt` (valor plano para el Excel).
const equipoCol = {
  key: 'equipo', label: 'Equipo', tarjeta: 'titulo', txt: (f) => f.equipo || '(sin código)',
  render: (f) => <span><strong>{f.equipo || '(sin código)'}</strong>{f.es_critico && <span style={{ ...s.chip(C.rojoBg, C.rojo), marginLeft: 6 }}>crítico</span>}<br /><span style={s.meta}>{f.denominacion || ''}</span></span>,
}
const nowrap = (v) => <span style={{ whiteSpace: 'nowrap' }}>{v}</span>

const COLS = {
  ypane: [
    equipoCol,
    { key: 'dias', label: 'Días', txt: (f) => f.dias_taller, render: (f) => nowrap(`${num(f.dias_taller)} d`) },
    { key: 'estado', label: 'Estado', txt: (f) => f.estado_label },
    { key: 'taller', label: 'Taller', txt: (f) => f.taller },
    { key: 'aviso', label: 'Aviso', txt: (f) => f.numero_aviso || '' },
    { key: 'orden', label: 'Orden', txt: (f) => f.numero_orden || f.orden_cruzada || '' },
    { key: 'status', label: 'Status SAP', txt: (f) => f.status_sap || 'sin orden SAP' },
    { key: 'pedido', label: 'Pedido', txt: (f) => (f.pedido ? 'Sí' : 'No') },
    { key: 'averia', label: 'Avería', txt: (f) => f.descripcion_averia || '', tarjeta: 'oculta' },
  ],
  inc: [
    equipoCol,
    { key: 'motivo', label: 'Motivo', txt: (f) => MOTIVOS[f.motivo]?.label || f.motivo },
    { key: 'taller', label: 'Taller', txt: (f) => f.taller },
    { key: 'aviso', label: 'Aviso', txt: (f) => f.numero_aviso || '' },
    { key: 'orden', label: 'Orden', txt: (f) => f.numero_orden || f.orden_cruzada || '' },
    { key: 'dias', label: 'Días', txt: (f) => f.dias_taller, render: (f) => nowrap(`${num(f.dias_taller)} d`) },
  ],
  sap: [
    equipoCol,
    { key: 'dias', label: 'Días', txt: (f) => f.dias_abierta, render: (f) => nowrap(`${num(f.dias_abierta)} d`) },
    { key: 'creada', label: 'Creada', txt: (f) => f.fecha_entrada, render: (f) => nowrap(ddmm(f.fecha_entrada)) },
    { key: 'orden', label: 'Orden', txt: (f) => f.orden },
    { key: 'aviso', label: 'Aviso', txt: (f) => f.aviso || '' },
    { key: 'status', label: 'Status', txt: (f) => f.status_usuario || '' },
    { key: 'ubicacion', label: 'Ubicación', txt: (f) => f.ubicacion },
    { key: 'texto', label: 'Texto', txt: (f) => f.texto || '' },
  ],
  dup: [
    equipoCol,
    { key: 'cantidad', label: 'Abiertas', txt: (f) => f.cantidad },
    { key: 'origen', label: 'Origen', txt: (f) => f.origen },
    { key: 'aviso', label: 'Aviso', txt: (f) => f.aviso || '' },
    { key: 'orden', label: 'Orden', txt: (f) => f.orden || '' },
    { key: 'ubicacion', label: 'Ubicación / taller', txt: (f) => f.ubicacion },
    { key: 'dias', label: 'Días', txt: (f) => f.dias, render: (f) => nowrap(`${num(f.dias)} d`) },
    { key: 'status', label: 'Status', txt: (f) => f.status || '' },
  ],
  mat: [
    equipoCol,
    { key: 'orden', label: 'Orden', txt: (f) => f.orden },
    { key: 'material', label: 'Material', txt: (f) => `${f.material} ${f.descripcion || ''}`,
      render: (f) => <span><strong>{f.descripcion || f.material}</strong><br /><span style={s.meta}>{f.material}</span></span> },
    { key: 'pend', label: 'Pendiente', txt: (f) => f.cantidad_pendiente, render: (f) => nowrap(`${num(f.cantidad_pendiente)} ${f.unidad || ''}`) },
    { key: 'stock', label: 'Stock centro', txt: (f) => f.stock_centro ?? 0, render: (f) => nowrap(`${num(f.stock_centro ?? 0)} (${f.centro})`) },
    { key: 'falta', label: 'A comprar', txt: (f) => f.cantidad_faltante },
    { key: 'taller', label: 'Taller / ubicación', txt: (f) => f.taller_o_ubicacion },
    { key: 'dias', label: 'Días', txt: (f) => f.dias, render: (f) => nowrap(`${num(f.dias)} d`) },
  ],
  outl: [
    equipoCol,
    { key: 'taller', label: 'Taller', txt: (f) => f.taller },
    { key: 'ingreso', label: 'Ingreso', txt: (f) => f.ingreso, render: (f) => nowrap(ddmm(f.ingreso)) },
    { key: 'lib', label: 'Liberación', txt: (f) => f.liberacion, render: (f) => nowrap(ddmm(f.liberacion)) },
    { key: 'dias', label: 'Días', txt: (f) => f.dias },
  ],
}
const colEvidencia = { key: 'evidencia', label: 'Evidencia', txt: evidencia, render: (f) => <span style={{ color: C.verde }}>{evidencia(f)}</span> }

function definicion(id, d) {
  const porDiasYp = (a, b) => (b.dias_taller ?? -1) - (a.dias_taller ?? -1)
  const porDiasSap = (a, b) => (b.dias_abierta ?? -1) - (a.dias_abierta ?? -1)
  const yp = (titulo, f) => ({ titulo, tipo: 'ypane', filas: d.ypane.filter(f).sort(porDiasYp) })
  const sap = (titulo, f) => ({ titulo, tipo: 'sap', filas: d.abiertas.filter(f).sort(porDiasSap) })
  const mat = (sit) => ({ titulo: SITUACION[sit].label, tipo: 'mat',
    filas: d.materiales.filter((m) => m.situacion === sit).sort((a, b) => (b.es_critico - a.es_critico) || ((b.dias ?? 0) - (a.dias ?? 0))) })
  switch (id) {
    case 'yp_en_taller': return yp('En taller', () => true)
    case 'yp_terceros': return yp('En talleres terceros', (f) => f.taller_tipo === 'Tercero')
    case 'yp_criticos': return yp('Críticos detenidos', (f) => f.es_critico)
    case 'yp_urgentes': return yp('Urgentes (> 10 días)', (f) => f.dias_taller > 10)
    case 'yp_sin_orden': return yp('Sin N° de orden', (f) => !f.numero_orden)
    case 'yp_sin_pedido': return yp('Sin pedido', (f) => !f.pedido)
    case 'yp_inc': return { titulo: 'Inconsistencias', tipo: 'inc', filas: [...d.inconsistencias].sort(porDiasYp) }
    case 'yp_mttr': return { titulo: 'Cierres de más de 60 días (fuera del MTTR)', tipo: 'outl', filas: [...d.outliers].sort((a, b) => b.dias - a.dias) }
    case 'sap_abiertas': return sap('Correctivos abiertos en SAP', () => true)
    case 'sap_en_app': return sap('Órdenes SAP que están en la app', (f) => f.en_app)
    case 'sap_solo_sap': return sap('Solo SAP (no están en la app)', (f) => !f.en_app)
    case 'sap_cierre': return { ...sap('Candidatas a cierre', (f) => !f.en_app && f.accion === 'cierre_candidato'), evidencia: true }
    case 'sap_sin_equipo': return sap('Órdenes sin código de equipo', (f) => !f.equipo)
    case 'sap_multi': return { titulo: 'Equipos con más de una orden/aviso abierto', tipo: 'dup',
      filas: [...d.duplicados].sort((a, b) => (b.cantidad - a.cantidad) || a.equipo.localeCompare(b.equipo) || ((b.dias ?? 0) - (a.dias ?? 0))) }
    case 'mat_bloqueo': return mat('bloqueo')
    case 'mat_parcial': return mat('parcial')
    case 'mat_despacho': return mat('despacho')
    default: return null
  }
}

function exportar(def, cols) {
  const datos = def.filas.map((f) => Object.fromEntries(cols.map((c) => [c.label, c.txt(f) ?? ''])))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(datos), def.titulo.replace(/[\\/?*[\]:]/g, '').slice(0, 31))
  const nombre = def.titulo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  XLSX.writeFile(wb, `correctivos_${nombre}_${hoyPY()}.xlsx`)
}

export default function DetalleKpi({ id, datos, filtrando, onCerrar }) {
  const def = definicion(id, datos)
  if (!def) return null
  const cols = [...COLS[def.tipo], ...(def.evidencia ? [colEvidencia] : [])]
    .map((c) => (c.render ? c : { ...c, render: (f) => c.txt(f) || '—' }))
  return (
    <div style={{ marginTop: 12, borderTop: `1px solid ${C.borde}`, paddingTop: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <strong>{def.titulo}</strong> <span style={s.meta}>· {def.filas.length}{filtrando ? ' (con filtros)' : ''}</span>
        </div>
        <button style={{ ...s.boton, color: C.azul, fontWeight: 600 }} disabled={!def.filas.length} onClick={() => exportar(def, cols)}>⬇ Excel</button>
        <button style={s.boton} onClick={onCerrar} aria-label="Cerrar">✕</button>
      </div>
      <TablaResponsive filas={def.filas} columnas={cols}
        getKey={(f) => f.id || `${f.orden || ''}-${f.posicion || ''}-${f.aviso || ''}-${f.equipo || ''}-${f.ingreso || ''}`}
        vacio="No hay filas con los filtros actuales" />
    </div>
  )
}
