import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast, confirmar } from '../utils/ui'
import Sheet from './Sheet'
import AsignarSheet from './AsignarSheet'
import ConfirmarSheet from './ConfirmarSheet'
import { BarraAvance, Ruta } from './TarjetaEncargo'
import { COLS_ENCARGO, COLS_ASIG, nombreCamion, nombreOperador } from './datos'
import {
  ESTADO_ASIG, estilos, fmtFecha, fmtFechaHora, fmtFechaRelativa, fmtNum, unidadLabel, hoyPY, msgError,
} from './constantes'

const TEXTO_EVENTO = {
  creado: 'Encargo cargado',
  editado: 'Encargo editado',
  asignado: 'Camión asignado',
  reprogramado: 'Reprogramado',
  desasignado: 'Asignación quitada',
  entregada: 'Entregado (cantidad sin confirmar)',
  confirmada: 'Entrega confirmada',
  entrega_deshecha: 'Entrega deshecha',
  cantidad_corregida: 'Cantidad corregida',
  cerrado: 'Encargo cerrado',
  cancelado: 'Encargo cancelado',
}

function detalleEvento(ev, unidad) {
  const d = ev.detalle || {}
  switch (ev.tipo) {
    case 'asignado':
    case 'desasignado':  return `${d.equipo || ''} · ${fmtFecha(d.fecha)}`
    case 'reprogramado': return `${d.de_equipo} ${fmtFecha(d.de_fecha)} → ${d.a_equipo} ${fmtFecha(d.a_fecha)}`
    case 'entregada':
    case 'confirmada':   return `${d.equipo || ''}${d.cantidad != null ? ` · ${fmtNum(d.cantidad)} ${unidad}` : ''}`
    case 'cantidad_corregida': return `${d.equipo} · ${fmtNum(d.de)} → ${fmtNum(d.a)} ${unidad}`
    case 'cancelado':    return d.motivo || ''
    case 'editado':      return Object.keys(d).join(', ')
    default:             return ''
  }
}

export default function DetalleEncargo({ encargoId, catalogos, onEditar, onCambio }) {
  const [encargo, setEncargo] = useState(null)
  const [asignaciones, setAsignaciones] = useState([])
  const [eventos, setEventos] = useState([])
  const [usuarios, setUsuarios] = useState({})
  const [sheet, setSheet] = useState(null)
  const [motivo, setMotivo] = useState('')
  const [recarga, setRecarga] = useState(0)

  useEffect(() => {
    let vivo = true
    ;(async () => {
    const [e, a, ev] = await Promise.all([
      supabase.from('v_encargos').select(COLS_ENCARGO).eq('id', encargoId).single(),
      supabase.from('asignaciones').select(COLS_ASIG).eq('encargo_id', encargoId).order('fecha').limit(500),
      supabase.from('logistica_eventos').select('id, tipo, detalle, usuario_id, created_at')
        .eq('encargo_id', encargoId).order('created_at', { ascending: false }).limit(100),
    ])
    const err = e.error || a.error || ev.error
    if (!vivo) return
    if (err) { toast('❌ ' + err.message); return }
    setEncargo(e.data); setAsignaciones(a.data); setEventos(ev.data)
    const ids = [...new Set(ev.data.map(x => x.usuario_id).filter(Boolean))]
    if (ids.length) {
      const { data } = await supabase.from('usuarios').select('id, nombre_completo').in('id', ids)
      if (vivo) setUsuarios(Object.fromEntries((data || []).map(u => [u.id, u.nombre_completo])))
    }
    })()
    return () => { vivo = false }
  }, [encargoId, recarga])

  const refrescar = () => { setSheet(null); setRecarga(r => r + 1); onCambio?.() }

  if (!encargo) return <div style={{ textAlign: 'center', color: '#6b7280', padding: '40px' }}>Cargando…</div>

  const abierto = encargo.estado === 'abierto'
  const unidad = unidadLabel(encargo.unidad)
  const hoy = hoyPY()
  const pendientes = encargo.n_planificadas + encargo.n_entregadas
  const puedeCancelar = abierto && encargo.n_entregadas === 0 && encargo.n_confirmadas === 0

  const cerrarEncargo = async () => {
    let msg = `¿Cerrar «${encargo.descripcion}»?`
    if (encargo.cantidad != null && Number(encargo.cantidad_confirmada) < Number(encargo.cantidad)) {
      msg += `\n\nSe confirmaron ${fmtNum(encargo.cantidad_confirmada)} de ${fmtNum(encargo.cantidad)} ${unidad}. Se cierra igual.`
    }
    if (!(await confirmar(msg))) return
    const { error } = await supabase.from('encargos').update({ estado: 'cerrado' }).eq('id', encargo.id)
    if (error) return toast('❌ ' + msgError(error))
    toast('✅ Encargo cerrado correctamente')
    refrescar()
  }

  const cancelarEncargo = async () => {
    if (!motivo.trim()) return toast('⚠️ Indicá el motivo')
    const { error } = await supabase.from('encargos')
      .update({ estado: 'cancelado', motivo_cancelacion: motivo.trim() }).eq('id', encargo.id)
    if (error) return toast('❌ ' + msgError(error))
    toast('✅ Encargo cancelado correctamente')
    setMotivo('')
    refrescar()
  }

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', padding: '12px 12px 110px' }}>
      {/* Cabecera */}
      <div style={{ ...estilos.card, marginBottom: '12px' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#111827' }}>{encargo.descripcion}</div>
            <div style={{ marginTop: '6px' }}><Ruta encargo={encargo} size={15} /></div>
          </div>
          {abierto && <button onClick={() => onEditar(encargo)} style={{ ...estilos.btnSecundario, minHeight: '40px', padding: '6px 12px' }}>✏️ Editar</button>}
        </div>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '12px', fontSize: '14px', color: '#374151' }}>
          <div><span style={{ color: '#6b7280' }}>Para: </span><strong>{fmtFechaRelativa(encargo.fecha_requerida)}</strong></div>
          {encargo.cantidad != null && <div><span style={{ color: '#6b7280' }}>Cantidad: </span><strong>{fmtNum(encargo.cantidad)} {unidad}</strong></div>}
          <div><span style={{ color: '#6b7280' }}>Estado: </span><strong>{abierto ? 'Abierto' : encargo.estado === 'cerrado' ? 'Cerrado' : 'Cancelado'}</strong></div>
        </div>
        {encargo.cantidad != null && <div style={{ marginTop: '10px' }}><BarraAvance encargo={encargo} grande /></div>}
        {encargo.notas && <div style={{ marginTop: '10px', fontSize: '14px', color: '#4b5563', background: '#f9fafb', borderRadius: '8px', padding: '8px 10px' }}>📝 {encargo.notas}</div>}
        {encargo.estado === 'cancelado' && encargo.motivo_cancelacion && (
          <div style={{ marginTop: '10px', fontSize: '14px', color: '#6b7280' }}>Motivo: {encargo.motivo_cancelacion}</div>
        )}
        <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '10px' }}>
          Cargado por {encargo.creado_por_nombre || '—'} · {fmtFechaHora(encargo.created_at)}
          {encargo.cerrado_at && <> · {encargo.estado === 'cerrado' ? 'Cerrado' : 'Cancelado'} por {encargo.cerrado_por_nombre || '—'} · {fmtFechaHora(encargo.cerrado_at)}</>}
        </div>
      </div>

      {/* Acciones */}
      {abierto && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <button onClick={() => setSheet({ tipo: 'asignar' })} style={{ ...estilos.btnPrimario, flex: '1 1 160px' }}>🚛 Asignar camión</button>
          <button onClick={cerrarEncargo} disabled={pendientes > 0 || encargo.n_confirmadas === 0}
            title={pendientes > 0 ? 'Hay asignaciones sin entregar o sin confirmar' : ''}
            style={{ ...estilos.btnSecundario, flex: '1 1 120px', opacity: pendientes > 0 || encargo.n_confirmadas === 0 ? 0.5 : 1, color: '#166534', borderColor: '#86efac' }}>
            ✅ Cerrar
          </button>
          {puedeCancelar && (
            <button onClick={() => setSheet({ tipo: 'cancelar' })} style={{ ...estilos.btnPeligro, flex: '1 1 120px' }}>Cancelar encargo</button>
          )}
        </div>
      )}

      {/* Asignaciones */}
      <h3 style={{ fontSize: '14px', fontWeight: 800, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.03em', margin: '0 0 8px' }}>
        Asignaciones ({asignaciones.length})
      </h3>
      {asignaciones.length === 0 && (
        <div style={{ ...estilos.card, color: '#6b7280', fontSize: '14px', marginBottom: '16px' }}>Todavía no tiene camión asignado.</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
        {asignaciones.map(a => {
          const est = ESTADO_ASIG[a.estado]
          const atrasada = a.estado === 'planificada' && a.fecha < hoy
          const chofer = nombreOperador(catalogos.operadores, a.operador_id)
          return (
            <div key={a.id} style={{ ...estilos.card, display: 'flex', gap: '10px', alignItems: 'center', borderLeft: `4px solid ${atrasada ? '#dc2626' : est.color}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '15px', fontWeight: 800 }}>
                  🚛 {nombreCamion(catalogos.camiones, a)}
                  <span style={{ fontWeight: 600, color: atrasada ? '#b91c1c' : '#4b5563' }}> · {fmtFecha(a.fecha)}</span>
                </div>
                <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '2px' }}>
                  {chofer ? `👤 ${chofer}` : 'Sin chofer'}
                  {a.cantidad_real != null && <> · <strong style={{ color: '#111827' }}>{fmtNum(a.cantidad_real)} {unidad}</strong></>}
                  {a.notas && <> · {a.notas}</>}
                </div>
                <span style={{ display: 'inline-block', marginTop: '6px', fontSize: '12px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', background: atrasada ? '#fee2e2' : est.bg, color: atrasada ? '#b91c1c' : est.color }}>
                  {atrasada ? 'Atrasada' : est.label}
                </span>
              </div>
              {abierto && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {a.estado === 'planificada' && <>
                    <button onClick={() => setSheet({ tipo: 'confirmar', asignacion: a })} style={{ ...estilos.btnChico, background: '#16a34a' }}>Entregado</button>
                    <button onClick={() => setSheet({ tipo: 'asignar', asignacion: a })} style={{ ...estilos.btnChico, background: '#fff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>Reprogramar</button>
                  </>}
                  {a.estado === 'entregada' && (
                    <button onClick={() => setSheet({ tipo: 'confirmar', asignacion: a })} style={{ ...estilos.btnChico, background: '#7c3aed' }}>Confirmar</button>
                  )}
                  {a.estado === 'confirmada' && encargo.cantidad != null && (
                    <button onClick={() => setSheet({ tipo: 'confirmar', asignacion: a })} style={{ ...estilos.btnChico, background: '#fff', color: '#374151', border: '1px solid #d1d5db' }}>Corregir</button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Historial */}
      <h3 style={{ fontSize: '14px', fontWeight: 800, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.03em', margin: '0 0 8px' }}>Historial</h3>
      <div style={{ ...estilos.card, padding: '4px 14px' }}>
        {eventos.map((ev, i) => (
          <div key={ev.id} style={{ padding: '10px 0', borderBottom: i < eventos.length - 1 ? '1px solid #f3f4f6' : 'none', fontSize: '13px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
              <strong style={{ color: '#111827' }}>{TEXTO_EVENTO[ev.tipo] || ev.tipo}</strong>
              <span style={{ color: '#9ca3af', flexShrink: 0 }}>{fmtFechaHora(ev.created_at)}</span>
            </div>
            <div style={{ color: '#6b7280' }}>
              {detalleEvento(ev, unidad)}{usuarios[ev.usuario_id] ? ` · ${usuarios[ev.usuario_id]}` : ''}
            </div>
          </div>
        ))}
      </div>

      {sheet?.tipo === 'asignar' && (
        <AsignarSheet catalogos={catalogos} encargo={encargo} asignacion={sheet.asignacion}
          onCerrar={() => setSheet(null)} onGuardado={refrescar} />
      )}
      {sheet?.tipo === 'confirmar' && (
        <ConfirmarSheet catalogos={catalogos} encargo={encargo} asignacion={sheet.asignacion}
          onCerrar={() => setSheet(null)} onGuardado={refrescar} />
      )}
      {sheet?.tipo === 'cancelar' && (
        <Sheet titulo="Cancelar encargo" subtitulo={encargo.descripcion} onCerrar={() => setSheet(null)}
          pie={<>
            <button onClick={() => setSheet(null)} style={{ ...estilos.btnSecundario, flex: 1 }}>Volver</button>
            <button onClick={cancelarEncargo} style={{ ...estilos.btnPrimario, background: '#dc2626', flex: 2 }}>Cancelar encargo</button>
          </>}>
          <label style={estilos.label}>Motivo</label>
          <input value={motivo} onChange={e => setMotivo(e.target.value)} autoFocus style={estilos.input}
            placeholder="Ej: la obra ya lo consiguió, se suspendió el pedido" />
          {encargo.n_planificadas > 0 && (
            <p style={{ fontSize: '13px', color: '#92400e', marginTop: '10px' }}>
              Se van a quitar {encargo.n_planificadas} asignación(es) planificada(s).
            </p>
          )}
        </Sheet>
      )}
    </div>
  )
}
