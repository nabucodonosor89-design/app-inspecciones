import { BarraAvance } from './TarjetaEncargo'
import { ChipCamionRequerido, ChipCategoria } from './Tarjetas'
import { saldo, sugerencias } from './despacho'
import { estilos, fmtDiaCorto, fmtNum, hoyPY, sumarDias, unidadLabel } from './constantes'

/** Badge de urgencia: "Atrasado · lun 16", "Para hoy", "Para mañana", fecha, "Cuando se pueda". */
export function BadgeUrgencia({ e }) {
  const hoy = hoyPY()
  let texto, bg = '#f3f4f6', fg = '#6b7280'
  if (e.subestado === 'atrasado') {
    texto = e.fecha_requerida && e.fecha_requerida < hoy ? `Atrasado · ${fmtDiaCorto(e.fecha_requerida)}` : 'Atrasado'
    bg = '#fee2e2'; fg = '#b91c1c'
  } else if (e.fecha_requerida === hoy) { texto = 'Para hoy'; bg = '#ffedd5'; fg = '#c2410c' }
  else if (e.fecha_requerida === sumarDias(hoy, 1)) { texto = 'Para mañana'; bg = '#fef3c7'; fg = '#92400e' }
  else if (e.fecha_requerida) texto = `Para el ${fmtDiaCorto(e.fecha_requerida)}`
  else texto = 'Cuando se pueda'
  return <span style={{ padding: '1px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 800, background: bg, color: fg, whiteSpace: 'nowrap' }}>{texto}</span>
}

function TarjetaPorAsignar({ e, ctx, onAbrir, onAsignar, arrastrable }) {
  const sug = sugerencias(e, ctx)
  const pendienteSinEntregar = Number(e.n_atrasadas) > 0
  return (
    <div
      draggable={arrastrable}
      onDragStart={ev => {
        ev.dataTransfer.setData('text/plain', JSON.stringify({ tipo: 'encargo', id: e.id }))
        ev.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={onAbrir}
      style={{ background: '#fff', border: '1px solid #e5e7eb', borderLeft: `4px solid ${e.subestado === 'atrasado' ? '#dc2626' : '#f59e0b'}`,
        borderRadius: '10px', padding: '10px 12px', cursor: arrastrable ? 'grab' : 'pointer' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: '14px', color: '#111827' }}>{e.descripcion}</div>
          <div style={{ fontSize: '12px', color: '#4b5563', marginTop: '2px' }}>
            {e.origen_nombre} <span style={{ color: '#9ca3af' }}>→</span> {e.destino_nombre}
          </div>
        </div>
        <BadgeUrgencia e={e} />
      </div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
        <ChipCategoria categoria={e.categoria} />
        <ChipCamionRequerido tipo={e.tipo_camion_requerido} />
        {e.cantidad != null && (
          <span style={{ padding: '1px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, background: '#eef2ff', color: '#4338ca' }}>
            {e.n_asignaciones ? `Faltan ${fmtNum(saldo(e))}` : fmtNum(e.cantidad)} {unidadLabel(e.unidad)}
          </span>
        )}
      </div>
      {pendienteSinEntregar && (
        <div style={{ fontSize: '12px', color: '#b45309', marginTop: '6px', fontWeight: 600 }}>
          Tiene un viaje pendiente sin entregar: marcalo o reprogramalo desde el detalle.
        </div>
      )}
      {sug.lineas.map((l, i) => (
        <div key={i} style={{ fontSize: '12px', color: l.color, marginTop: '6px', fontWeight: 600 }}>💡 {l.texto}</div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
        <button onClick={ev => { ev.stopPropagation(); onAsignar(e, sug.primeraFecha) }}
          style={{ ...estilos.btnChico, minHeight: '32px', padding: '4px 12px', fontSize: '12px' }}>
          Asignar{sug.primeraFecha ? ` · ${sug.primeraFecha === ctx.hoy ? 'hoy' : fmtDiaCorto(sug.primeraFecha)}` : ''}
        </button>
      </div>
    </div>
  )
}

/**
 * Panel lateral del Tablero de despacho.
 * - Por asignar: sin camión + atrasados sin viaje planificado de hoy en adelante, con sugerencias
 * - Con saldo por mover: en curso con cantidad, sin viajes planificados después de hoy
 */
export default function PanelPorAsignar({ lista, conSaldo, ctx, onAbrir, onAsignar, arrastrable, lateral }) {
  return (
    <aside style={{
      width: lateral ? '330px' : '100%', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '12px',
      ...(lateral ? { position: 'sticky', top: '80px', maxHeight: 'calc(100vh - 100px)', overflowY: 'auto' } : {}),
    }}>
      <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '12px' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: 800, fontSize: '15px', color: '#111827' }}>⏳ Por asignar</span>
            <span style={{ background: lista.length ? '#92400e' : '#9ca3af', color: '#fff', borderRadius: '999px', padding: '1px 8px', fontSize: '12px', fontWeight: 700 }}>
              {lista.length}
            </span>
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
            Sugerencias con lo cargado para esta semana{arrastrable ? ' · podés arrastrarlos a la grilla' : ''}
          </div>
        </div>
        <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {lista.length === 0 && (
            <div style={{ textAlign: 'center', color: '#6b7280', fontSize: '13px', padding: '20px 8px' }}>🎉 Todos los encargos tienen camión.</div>
          )}
          {lista.map(e => (
            <TarjetaPorAsignar key={e.id} e={e} ctx={ctx} arrastrable={arrastrable}
              onAbrir={() => onAbrir(e.id)} onAsignar={onAsignar} />
          ))}
        </div>
      </div>

      {conSaldo.length > 0 && (
        <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '12px' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: 800, fontSize: '15px', color: '#111827' }}>📦 Con saldo por mover</span>
            <span style={{ background: '#1e40af', color: '#fff', borderRadius: '999px', padding: '1px 8px', fontSize: '12px', fontWeight: 700 }}>{conSaldo.length}</span>
          </div>
          <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {conSaldo.map(e => (
              <div key={e.id} onClick={() => onAbrir(e.id)}
                style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px 12px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: '14px', color: '#111827' }}>{e.descripcion}</div>
                    <div style={{ fontSize: '12px', color: '#4b5563', marginTop: '2px' }}>
                      {e.origen_nombre} <span style={{ color: '#9ca3af' }}>→</span> {e.destino_nombre}
                    </div>
                  </div>
                  <ChipCategoria categoria={e.categoria} />
                </div>
                <BarraAvance encargo={e} />
                <div style={{ fontSize: '12px', color: '#b45309', marginTop: '4px', fontWeight: 600 }}>Sin viajes planificados después de hoy</div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                  <button onClick={ev => { ev.stopPropagation(); onAsignar(e, sugerencias(e, ctx).primeraFecha) }}
                    style={{ ...estilos.btnChico, minHeight: '32px', padding: '4px 12px', fontSize: '12px' }}>Asignar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}
