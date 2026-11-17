import { nombreCamion } from './datos'
import {
  ESTADO_ASIG, ESTILO_COPIA, categoriaDe, estilos, fmtDiaCorto, fmtFecha, fmtNum, hoyPY, tipoLabel, unidadLabel,
} from './constantes'

/** Chip de una asignación en la grilla camión × día (vista v2). */
export function ChipAsignacion({ a, encargo, onClick, compacto }) {
  const hoy = hoyPY()
  const copia = !!a.copia
  const atrasada = !copia && a.estado === 'planificada' && a.fecha < hoy
  const est = ESTADO_ASIG[a.estado]
  const color = copia ? ESTILO_COPIA.color : atrasada ? '#b91c1c' : est.color
  const bg = copia ? ESTILO_COPIA.bg : atrasada ? '#fee2e2' : est.bg
  if (!encargo) return null
  const etiqueta = copia ? `Pendiente desde ${fmtFecha(a.fecha)}` : atrasada ? 'No cumplida' : est.label
  const cat = categoriaDe(encargo.categoria)
  return (
    <div onClick={onClick} title={`${encargo.descripcion} · ${encargo.origen_nombre} → ${encargo.destino_nombre} · ${cat.label} · ${etiqueta}`}
      style={{ background: bg, color, borderRadius: '8px', padding: compacto ? '4px 6px' : '8px 10px', cursor: 'pointer',
        fontSize: compacto ? '11px' : '14px', lineHeight: 1.3,
        ...(copia ? { border: `1px dashed ${ESTILO_COPIA.borde}` } : { borderLeft: `3px solid ${color}` }) }}>
      <div style={{ fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: compacto ? 'nowrap' : 'normal' }}>
        <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '2px', background: cat.fg, marginRight: '4px', verticalAlign: 'middle' }} />
        {encargo.descripcion}
      </div>
      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: compacto ? 'nowrap' : 'normal' }}>
        → {encargo.destino_nombre}
        {a.cantidad_real != null && ` · ${fmtNum(a.cantidad_real)} ${unidadLabel(encargo.unidad)}`}
        {!compacto && ` · ${etiqueta}`}
      </div>
      {compacto && (copia || atrasada) && <div style={{ fontWeight: 700, fontSize: '10px' }}>{etiqueta}</div>}
    </div>
  )
}

/** Copia de una asignación pendiente de un día anterior, con sus acciones. */
export function TarjetaCopia({ a, encargo, camion, chofer, onAbrir, onEntregado, onReprogramar }) {
  if (!encargo) return null
  return (
    <div onClick={onAbrir} style={{ background: ESTILO_COPIA.bg, border: `1px dashed ${ESTILO_COPIA.borde}`, borderRadius: '10px',
      padding: '10px 12px', cursor: 'pointer', display: 'flex', gap: '10px', alignItems: 'center' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '11px', fontWeight: 800, color: '#b45309', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
          Pendiente desde {fmtFecha(a.fecha)}
        </div>
        <div style={{ fontWeight: 800, fontSize: '14px', color: '#111827', marginTop: '2px' }}>{encargo.descripcion}</div>
        <div style={{ fontSize: '12px', color: '#4b5563', marginTop: '2px' }}>
          {encargo.origen_nombre} <span style={{ color: '#9ca3af' }}>→</span> {encargo.destino_nombre}
        </div>
        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>🚛 {camion} · {chofer ? `👤 ${chofer}` : 'Sin chofer'}</div>
      </div>
      {encargo.estado === 'abierto' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <button onClick={ev => { ev.stopPropagation(); onEntregado() }} style={{ ...estilos.btnChico, background: '#16a34a' }}>Entregado</button>
          <button onClick={ev => { ev.stopPropagation(); onReprogramar() }}
            style={{ ...estilos.btnChico, background: '#fff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>Reprogramar</button>
        </div>
      )}
    </div>
  )
}

// Descripción en la grilla: hasta 2 líneas, después puntos suspensivos
const DOS_LINEAS = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', wordBreak: 'break-word' }

const pill = { display: 'inline-block', padding: '1px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, whiteSpace: 'nowrap' }

export function ChipCategoria({ categoria }) {
  const c = categoriaDe(categoria)
  return <span style={{ ...pill, background: c.bg, color: c.fg }}>{c.label}</span>
}

export function ChipCamionRequerido({ tipo }) {
  return (
    <span style={{ ...pill, background: tipo ? '#eef2ff' : '#f9fafb', color: tipo ? '#3730a3' : '#6b7280', border: tipo ? 'none' : '1px solid #e5e7eb' }}>
      {tipo ? `Necesita ${tipoLabel(tipo).toLowerCase()}` : 'Cualquier camión'}
    </span>
  )
}

/**
 * Viaje en el tablero por frente: color de la categoría, descripción y camión.
 * Estados del addendum: "No cumplida" (rojo) y copia "Pendiente desde …" (punteada gris).
 */
export function TarjetaViaje({ a, encargo, camiones, onClick, compacto }) {
  if (!encargo) return null
  const hoy = hoyPY()
  const copia = !!a.copia
  const noCumplida = !copia && a.estado === 'planificada' && a.fecha < hoy
  const cat = categoriaDe(encargo.categoria)
  const camion = nombreCamion(camiones, a)
  let estilo = { background: cat.bg, borderLeft: `3px solid ${cat.fg}` }
  let etiqueta = a.estado === 'entregada' ? 'Sin confirmar' : a.estado === 'confirmada' ? '✓ Confirmada' : null
  let colorEtiqueta = a.estado === 'entregada' ? '#92400e' : '#166534'
  if (copia) {
    estilo = { background: ESTILO_COPIA.bg, border: `1px dashed ${ESTILO_COPIA.borde}` }
    etiqueta = `Pendiente desde ${fmtDiaCorto(a.fecha)}`; colorEtiqueta = '#4b5563'
  } else if (noCumplida) {
    estilo = { background: '#fee2e2', borderLeft: '3px solid #b91c1c' }
    etiqueta = 'No cumplida'; colorEtiqueta = '#b91c1c'
  }
  return (
    <div onClick={onClick} title={`${encargo.descripcion} · ${encargo.origen_nombre} → ${encargo.destino_nombre} · ${camion}`}
      style={{ ...estilo, borderRadius: '8px', padding: compacto ? '4px 6px' : '8px 10px', cursor: 'pointer',
        fontSize: compacto ? '11px' : '13px', lineHeight: 1.3, color: cat.fg }}>
      <div style={{ fontWeight: 700, color: '#111827', overflow: 'hidden', ...(compacto ? DOS_LINEAS : {}) }}>
        {encargo.descripcion}
      </div>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline', overflow: 'hidden' }}>
        <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>🚛 {camion}</span>
        {!compacto && <span style={{ color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>desde {encargo.origen_nombre}</span>}
      </div>
      {etiqueta && <div style={{ fontWeight: 800, fontSize: compacto ? '10px' : '11px', color: colorEtiqueta }}>{etiqueta}</div>}
    </div>
  )
}

/** Hueco: encargo sin camión. Rojo si ya venció (va en hoy), naranja si es para ese día. */
export function TarjetaHueco({ encargo, vencido, onClick, compacto }) {
  const color = vencido ? '#b91c1c' : '#c2410c'
  const bg = vencido ? '#fef2f2' : '#fff7ed'
  return (
    <div onClick={onClick} title={`${encargo.descripcion} · ${encargo.origen_nombre} → ${encargo.destino_nombre} · tocar para asignar`}
      style={{ background: bg, border: `1px dashed ${color}`, borderRadius: '8px', padding: compacto ? '4px 6px' : '8px 10px',
        cursor: 'pointer', fontSize: compacto ? '11px' : '13px', lineHeight: 1.3 }}>
      <div style={{ fontWeight: 800, color, fontSize: compacto ? '10px' : '11px' }}>
        {vencido ? `Sin camión · era ${fmtDiaCorto(encargo.fecha_requerida)}` : 'Sin camión'}
      </div>
      <div style={{ fontWeight: 700, color: '#111827', overflow: 'hidden', ...(compacto ? DOS_LINEAS : {}) }}>
        {encargo.descripcion}
      </div>
      {encargo.tipo_camion_requerido && (
        <div style={{ color: '#6b7280', fontSize: compacto ? '10px' : '11px' }}>Pide {tipoLabel(encargo.tipo_camion_requerido).toLowerCase()}</div>
      )}
    </div>
  )
}
