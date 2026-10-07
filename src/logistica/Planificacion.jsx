import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../utils/ui'
import AsignarSheet from './AsignarSheet'
import { COLS_ASIG, COLS_ENCARGO, nombreOperador } from './datos'
import {
  ESTADO_ASIG, estilos, fmtFecha, fmtNum, hoyPY, lunesDe, sumarDias, unidadLabel, useEsEscritorio,
} from './constantes'

/** Asignaciones en un rango de fechas + los encargos a los que pertenecen. */
function useAsignacionesRango(desde, hasta, version) {
  const [asignaciones, setAsignaciones] = useState([])
  const [encargos, setEncargos] = useState({})
  const [cargando, setCargando] = useState(true)
  const [recarga, setRecarga] = useState(0)

  useEffect(() => {
    let vivo = true
    ;(async () => {
    const { data, error } = await supabase.from('asignaciones').select(COLS_ASIG)
      .gte('fecha', desde).lte('fecha', hasta).order('fecha').limit(1000)
    if (!vivo) return
    if (error) { toast('❌ ' + error.message); setCargando(false); return }
    const ids = [...new Set(data.map(a => a.encargo_id))]
    let mapa = {}
    if (ids.length) {
      const r = await supabase.from('v_encargos').select(COLS_ENCARGO).in('id', ids)
      if (r.error) toast('❌ ' + r.error.message)
      mapa = Object.fromEntries((r.data || []).map(e => [e.id, e]))
    }
    if (!vivo) return
    setAsignaciones(data); setEncargos(mapa); setCargando(false)
    })()
    return () => { vivo = false }
  }, [desde, hasta, version, recarga])
  return { asignaciones, encargos, cargando, recargar: () => setRecarga(r => r + 1) }
}

function ChipAsignacion({ a, encargo, onClick, compacto }) {
  const hoy = hoyPY()
  const atrasada = a.estado === 'planificada' && a.fecha < hoy
  const est = ESTADO_ASIG[a.estado]
  const color = atrasada ? '#b91c1c' : est.color
  const bg = atrasada ? '#fee2e2' : est.bg
  if (!encargo) return null
  return (
    <div onClick={onClick} title={`${encargo.descripcion} · ${encargo.origen_nombre} → ${encargo.destino_nombre}`}
      style={{ background: bg, color, borderRadius: '8px', padding: compacto ? '4px 6px' : '8px 10px', cursor: 'pointer',
        fontSize: compacto ? '11px' : '14px', lineHeight: 1.3, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: compacto ? 'nowrap' : 'normal' }}>
        {encargo.descripcion}
      </div>
      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: compacto ? 'nowrap' : 'normal' }}>
        → {encargo.destino_nombre}
        {a.cantidad_real != null && ` · ${fmtNum(a.cantidad_real)} ${unidadLabel(encargo.unidad)}`}
        {!compacto && ` · ${atrasada ? 'Atrasada' : est.label}`}
      </div>
    </div>
  )
}

// ── Celular: un día ──────────────────────────────────────────────────────────
function VistaDia({ catalogos, onAbrirEncargo, version }) {
  const [fecha, setFecha] = useState(hoyPY())
  const [sheet, setSheet] = useState(null)
  const [touchX, setTouchX] = useState(null)
  const { asignaciones, encargos, cargando, recargar } = useAsignacionesRango(fecha, fecha, version)

  const porCamion = useMemo(() => {
    const m = {}
    asignaciones.forEach(a => { (m[a.equipo_id] ||= []).push(a) })
    return m
  }, [asignaciones])

  const hoy = hoyPY()
  const mover = (n) => setFecha(f => sumarDias(f, n))
  const ocupados = catalogos.camiones.filter(c => porCamion[c.id]).length

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', padding: '12px 12px 110px' }}
      onTouchStart={e => setTouchX(e.touches[0].clientX)}
      onTouchEnd={e => {
        if (touchX == null) return
        const dx = e.changedTouches[0].clientX - touchX
        if (Math.abs(dx) > 70) mover(dx < 0 ? 1 : -1)
        setTouchX(null)
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', position: 'sticky', top: 0, background: '#f9fafb', paddingBottom: '8px', zIndex: 5 }}>
        <button onClick={() => mover(-1)} style={{ ...estilos.btnSecundario, padding: '6px 14px' }}>‹</button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 800 }}>{fecha === hoy ? 'Hoy' : fmtFecha(fecha)}</div>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>{fecha === hoy ? `${fmtFecha(fecha)} · ` : ''}{ocupados} de {catalogos.camiones.length} camiones con trabajo</div>
        </div>
        <button onClick={() => mover(1)} style={{ ...estilos.btnSecundario, padding: '6px 14px' }}>›</button>
      </div>
      {fecha !== hoy && (
        <div style={{ textAlign: 'center', marginBottom: '10px' }}>
          <button onClick={() => setFecha(hoy)} style={estilos.chip(false)}>Volver a hoy</button>
        </div>
      )}

      {cargando ? <div style={{ textAlign: 'center', color: '#6b7280', padding: '30px' }}>Cargando…</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {catalogos.camiones.map(c => {
            const lista = porCamion[c.id] || []
            const op = nombreOperador(catalogos.operadores, c.operador_asignado_id)
            return (
              <div key={c.id} style={{ ...estilos.card, padding: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: lista.length ? '8px' : 0 }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 800, fontSize: '15px' }}>🚛 {c.numero_identificacion}</span>
                    {op && <span style={{ fontSize: '12px', color: '#6b7280' }}> · {op}</span>}
                  </div>
                  {lista.length === 0 && <span style={{ fontSize: '13px', color: '#16a34a', fontWeight: 700 }}>Libre</span>}
                  <button onClick={() => setSheet({ fecha, equipo_id: c.id })}
                    style={{ ...estilos.btnChico, background: '#fff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>＋</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {lista.map(a => <ChipAsignacion key={a.id} a={a} encargo={encargos[a.encargo_id]} onClick={() => onAbrirEncargo(a.encargo_id)} />)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {sheet && (
        <AsignarSheet catalogos={catalogos} preset={sheet} onCerrar={() => setSheet(null)}
          onGuardado={() => { setSheet(null); recargar() }} />
      )}
    </div>
  )
}

// ── Escritorio: grilla semanal ───────────────────────────────────────────────
function GrillaSemana({ catalogos, onAbrirEncargo, version }) {
  const [lunes, setLunes] = useState(lunesDe(hoyPY()))
  const [sheet, setSheet] = useState(null)
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i))
  const { asignaciones, encargos, cargando, recargar } = useAsignacionesRango(dias[0], dias[6], version)
  const hoy = hoyPY()

  const celdas = useMemo(() => {
    const m = {}
    asignaciones.forEach(a => { (m[`${a.equipo_id}|${a.fecha}`] ||= []).push(a) })
    return m
  }, [asignaciones])

  return (
    <div style={{ padding: '16px 20px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
        <button onClick={() => setLunes(sumarDias(lunes, -7))} style={{ ...estilos.btnSecundario, padding: '6px 14px' }}>‹ Semana anterior</button>
        <button onClick={() => setLunes(lunesDe(hoy))} style={estilos.chip(lunes === lunesDe(hoy))}>Esta semana</button>
        <button onClick={() => setLunes(sumarDias(lunes, 7))} style={{ ...estilos.btnSecundario, padding: '6px 14px' }}>Semana siguiente ›</button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '13px', color: '#6b7280' }}>
          {cargando ? 'Cargando…' : `${asignaciones.length} asignaciones · ${fmtFecha(dias[0], { conDia: false })} al ${fmtFecha(dias[6], { conDia: false })}`}
        </span>
      </div>

      <div style={{ overflowX: 'auto', background: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: '980px' }}>
          <thead>
            <tr>
              <th style={{ width: '150px', textAlign: 'left', padding: '10px 12px', fontSize: '12px', color: '#6b7280', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>Camión</th>
              {dias.map(d => (
                <th key={d} style={{ padding: '10px 6px', fontSize: '13px', borderBottom: '1px solid #e5e7eb', borderLeft: '1px solid #f1f5f9',
                  background: d === hoy ? '#eff6ff' : '#f9fafb', color: d === hoy ? '#1d4ed8' : '#374151', fontWeight: 700 }}>
                  {fmtFecha(d)}{d === hoy && ' · hoy'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {catalogos.camiones.map(c => (
              <tr key={c.id}>
                <td style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                  <div style={{ fontWeight: 800, fontSize: '14px' }}>{c.numero_identificacion}</div>
                  <div style={{ fontSize: '11px', color: '#9ca3af' }}>{nombreOperador(catalogos.operadores, c.operador_asignado_id) || 'sin chofer fijo'}</div>
                </td>
                {dias.map(d => {
                  const lista = celdas[`${c.id}|${d}`] || []
                  return (
                    <td key={d} onClick={() => { if (!lista.length) setSheet({ fecha: d, equipo_id: c.id }) }}
                      className="celda-logistica"
                      style={{ padding: '4px', borderBottom: '1px solid #f1f5f9', borderLeft: '1px solid #f1f5f9', verticalAlign: 'top',
                        background: d === hoy ? '#f8fbff' : '#fff', cursor: lista.length ? 'default' : 'pointer', height: '58px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        {lista.map(a => (
                          <ChipAsignacion key={a.id} a={a} encargo={encargos[a.encargo_id]} compacto
                            onClick={(e) => { e.stopPropagation(); onAbrirEncargo(a.encargo_id) }} />
                        ))}
                        {lista.length > 0 && (
                          <button onClick={(e) => { e.stopPropagation(); setSheet({ fecha: d, equipo_id: c.id }) }}
                            style={{ border: 'none', background: 'none', color: '#93c5fd', fontSize: '11px', cursor: 'pointer', padding: '2px', textAlign: 'left' }}>＋ agregar</button>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: '14px', marginTop: '10px', fontSize: '12px', color: '#6b7280', flexWrap: 'wrap' }}>
        {Object.entries(ESTADO_ASIG).map(([k, v]) => (
          <span key={k}><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', background: v.bg, border: `1px solid ${v.color}`, marginRight: '4px' }} />{v.label}</span>
        ))}
        <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', background: '#fee2e2', border: '1px solid #b91c1c', marginRight: '4px' }} />Atrasada</span>
        <span>· Click en una celda vacía para asignar</span>
      </div>

      {sheet && (
        <AsignarSheet catalogos={catalogos} preset={sheet} onCerrar={() => setSheet(null)}
          onGuardado={() => { setSheet(null); recargar() }} />
      )}
    </div>
  )
}

export default function Planificacion(props) {
  const escritorio = useEsEscritorio()
  return escritorio ? <GrillaSemana {...props} /> : <VistaDia {...props} />
}
