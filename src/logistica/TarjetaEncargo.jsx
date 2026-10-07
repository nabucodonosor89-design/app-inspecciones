import { estilos, fmtFechaRelativa, fmtNum, unidadLabel, hoyPY, fmtFecha, TIPO_LUGAR } from './constantes'

export function BarraAvance({ encargo, grande }) {
  if (encargo.cantidad == null) return null
  const total = Number(encargo.cantidad)
  const conf = Number(encargo.cantidad_confirmada || 0)
  const sc = Number(encargo.cantidad_sin_confirmar || 0)
  const pConf = Math.min(100, (conf / total) * 100)
  const pSc = Math.min(100 - pConf, (sc / total) * 100)
  const u = unidadLabel(encargo.unidad)
  return (
    <div style={{ marginTop: grande ? '4px' : '10px' }}>
      <div style={{ height: grande ? '12px' : '8px', borderRadius: '999px', background: '#e5e7eb', overflow: 'hidden', display: 'flex' }}>
        <div style={{ width: `${pConf}%`, background: '#16a34a' }} />
        <div style={{ width: `${pSc}%`, background: '#fbbf24' }} />
      </div>
      <div style={{ fontSize: grande ? '14px' : '12px', color: '#4b5563', marginTop: '4px' }}>
        <strong style={{ color: '#166534' }}>{fmtNum(conf)}</strong> conf.
        {sc > 0 && <> + <strong style={{ color: '#92400e' }}>{fmtNum(sc)}</strong> s/c</>}
        {encargo.n_entregadas > 0 && sc === 0 && <> + {encargo.n_entregadas} entrega(s) s/c</>}
        {' / '}{fmtNum(total)} {u}
      </div>
    </div>
  )
}

export function Ruta({ encargo, size = 13 }) {
  const eo = TIPO_LUGAR[encargo.origen_tipo]?.emoji || ''
  const ed = TIPO_LUGAR[encargo.destino_tipo]?.emoji || ''
  return (
    <div style={{ fontSize: `${size}px`, color: '#4b5563' }}>
      {eo} {encargo.origen_nombre} <span style={{ color: '#9ca3af' }}>→</span> {ed} {encargo.destino_nombre}
    </div>
  )
}

/**
 * Tarjeta de encargo para la bandeja.
 * asignaciones: asignaciones pendientes del encargo (planificadas / entregadas) para mostrar camiones.
 */
export default function TarjetaEncargo({ encargo, asignaciones = [], nombreCamion, accion, onAbrir }) {
  const hoy = hoyPY()
  const vencido = encargo.fecha_requerida && encargo.fecha_requerida < hoy
  const esHoy = encargo.fecha_requerida === hoy
  const proximas = asignaciones.filter(a => a.estado === 'planificada').slice(0, 3)

  return (
    <div onClick={onAbrir} style={{ ...estilos.card, cursor: 'pointer', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '16px', fontWeight: 800, color: '#111827' }}>{encargo.descripcion}</span>
          {encargo.estado === 'abierto' && (
            <span style={{
              fontSize: '12px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px',
              background: vencido ? '#fee2e2' : esHoy ? '#ffedd5' : '#f3f4f6',
              color: vencido ? '#b91c1c' : esHoy ? '#c2410c' : '#6b7280',
            }}>
              {fmtFechaRelativa(encargo.fecha_requerida)}
            </span>
          )}
          {encargo.estado !== 'abierto' && (
            <span style={{ fontSize: '12px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px',
              background: encargo.estado === 'cerrado' ? '#dcfce7' : '#f3f4f6',
              color: encargo.estado === 'cerrado' ? '#166534' : '#6b7280' }}>
              {encargo.estado === 'cerrado' ? 'Cerrado' : 'Cancelado'}
            </span>
          )}
        </div>
        <div style={{ marginTop: '4px' }}><Ruta encargo={encargo} /></div>
        <BarraAvance encargo={encargo} />
        {proximas.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
            {proximas.map(a => (
              <span key={a.id} style={{
                fontSize: '12px', padding: '3px 8px', borderRadius: '6px',
                background: a.fecha < hoy ? '#fee2e2' : '#dbeafe', color: a.fecha < hoy ? '#b91c1c' : '#1e40af', fontWeight: 600,
              }}>
                🚛 {nombreCamion(a.equipo_id)} · {fmtFecha(a.fecha)}
              </span>
            ))}
          </div>
        )}
      </div>
      {accion && (
        <button
          onClick={(e) => { e.stopPropagation(); accion.onClick() }}
          style={{ ...estilos.btnChico, background: accion.color || estilos.btnChico.background, flexShrink: 0, minHeight: '40px' }}
        >
          {accion.label}
        </button>
      )}
    </div>
  )
}
