import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../utils/ui'
import AsignarSheet from './AsignarSheet'
import { COLS_ASIG, COLS_ENCARGO, nombreOperador } from './datos'
import {
  ESTADO_ASIG, estilos, fmtFecha, fmtFechaRelativa, fmtNum, hoyPY, lunesDe, msgError, necesitaAgenda, sumarDias, unidadLabel, useEsEscritorio,
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

function usePorAgendar(recarga) {
  const [lista, setLista] = useState([])
  useEffect(() => {
    let vivo = true
    supabase.from('v_encargos').select(COLS_ENCARGO)
      .eq('estado', 'abierto').eq('n_planificadas', 0)
      .order('fecha_requerida', { ascending: true, nullsFirst: false }).order('created_at')
      .limit(300)
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) { toast('❌ ' + error.message); return }
        setLista(data.filter(necesitaAgenda))
      })
    return () => { vivo = false }
  }, [recarga])
  return lista
}

/** Camiones de logística, releídos al entrar (por si se marcaron nuevos en Gestión de Equipos). */
function useCamiones(inicial, recarga) {
  const [camiones, setCamiones] = useState(inicial)
  useEffect(() => {
    let vivo = true
    supabase.from('equipos')
      .select('id, numero_identificacion, denominacion, operador_asignado_id')
      .eq('es_logistica', true).eq('activo', true).order('numero_identificacion').limit(200)
      .then(({ data, error }) => { if (vivo && !error && data) setCamiones(data) })
    return () => { vivo = false }
  }, [recarga])
  return camiones
}

function TarjetaPorAgendar({ e, onAbrir, onAsignar, arrastrable }) {
  const hoy = hoyPY()
  const vencido = e.fecha_requerida && e.fecha_requerida < hoy
  const esHoy = e.fecha_requerida === hoy
  const faltan = e.cantidad != null
    ? Number(e.cantidad) - Number(e.cantidad_confirmada || 0) - Number(e.cantidad_sin_confirmar || 0)
    : null
  return (
    <div
      draggable={arrastrable}
      onDragStart={ev => {
        ev.dataTransfer.setData('text/plain', JSON.stringify({ tipo: 'encargo', id: e.id }))
        ev.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={onAbrir}
      style={{
        background: '#fff', border: '1px solid #e5e7eb', borderLeft: `4px solid ${vencido ? '#dc2626' : esHoy ? '#ea580c' : '#93c5fd'}`,
        borderRadius: '10px', padding: '10px 12px', cursor: arrastrable ? 'grab' : 'pointer',
        display: 'flex', gap: '8px', alignItems: 'flex-start',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: '14px', color: '#111827' }}>{e.descripcion}</div>
        <div style={{ fontSize: '12px', color: '#4b5563', marginTop: '2px' }}>
          {e.origen_nombre} <span style={{ color: '#9ca3af' }}>→</span> {e.destino_nombre}
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px', fontSize: '11px', fontWeight: 700 }}>
          <span style={{ padding: '1px 7px', borderRadius: '999px',
            background: vencido ? '#fee2e2' : esHoy ? '#ffedd5' : '#f3f4f6',
            color: vencido ? '#b91c1c' : esHoy ? '#c2410c' : '#6b7280' }}>
            {fmtFechaRelativa(e.fecha_requerida)}
          </span>
          {faltan != null && (
            <span style={{ padding: '1px 7px', borderRadius: '999px', background: '#eef2ff', color: '#4338ca' }}>
              {e.n_asignaciones ? `Faltan ${fmtNum(faltan)}` : fmtNum(e.cantidad)} {unidadLabel(e.unidad)}
            </span>
          )}
        </div>
      </div>
      <button onClick={ev => { ev.stopPropagation(); onAsignar() }}
        style={{ ...estilos.btnChico, minHeight: '32px', padding: '4px 10px', fontSize: '12px' }}>Asignar</button>
    </div>
  )
}

// ── Celular: un día ──────────────────────────────────────────────────────────
function VistaDia({ catalogos, camiones, porAgendar, onAbrirEncargo, recargar, version }) {
  const [fecha, setFecha] = useState(hoyPY())
  const [sheet, setSheet] = useState(null)
  const [touchX, setTouchX] = useState(null)
  const [verPendientes, setVerPendientes] = useState(true)
  const { asignaciones, encargos, cargando } = useAsignacionesRango(fecha, fecha, version)

  const porCamion = useMemo(() => {
    const m = {}
    asignaciones.forEach(a => { (m[a.equipo_id] ||= []).push(a) })
    return m
  }, [asignaciones])

  const hoy = hoyPY()
  const mover = (n) => setFecha(f => sumarDias(f, n))
  const ocupados = camiones.filter(c => porCamion[c.id]).length
  const cat = { ...catalogos, camiones }

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
          <div style={{ fontSize: '12px', color: '#6b7280' }}>{fecha === hoy ? `${fmtFecha(fecha)} · ` : ''}{ocupados} de {camiones.length} camiones con trabajo</div>
        </div>
        <button onClick={() => mover(1)} style={{ ...estilos.btnSecundario, padding: '6px 14px' }}>›</button>
      </div>
      {fecha !== hoy && (
        <div style={{ textAlign: 'center', marginBottom: '10px' }}>
          <button onClick={() => setFecha(hoy)} style={estilos.chip(false)}>Volver a hoy</button>
        </div>
      )}

      {porAgendar.length > 0 && (
        <section style={{ marginBottom: '14px' }}>
          <button onClick={() => setVerPendientes(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', background: 'none', border: 'none', padding: '6px 2px',
              cursor: 'pointer', fontSize: '14px', fontWeight: 800, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            ⏳ Por agendar
            <span style={{ background: '#92400e', color: '#fff', borderRadius: '999px', padding: '1px 8px', fontSize: '12px' }}>{porAgendar.length}</span>
            <span style={{ flex: 1 }} />
            <span style={{ color: '#9ca3af' }}>{verPendientes ? '▾' : '▸'}</span>
          </button>
          {verPendientes && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
              {porAgendar.map(e => (
                <TarjetaPorAgendar key={e.id} e={e} onAbrir={() => onAbrirEncargo(e.id)}
                  onAsignar={() => setSheet({ encargo: e, preset: { fecha } })} />
              ))}
            </div>
          )}
        </section>
      )}

      {cargando ? <div style={{ textAlign: 'center', color: '#6b7280', padding: '30px' }}>Cargando…</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {camiones.map(c => {
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
                  <button onClick={() => setSheet({ preset: { fecha, equipo_id: c.id } })}
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
        <AsignarSheet catalogos={cat} encargo={sheet.encargo} preset={sheet.preset} onCerrar={() => setSheet(null)}
          onGuardado={() => { setSheet(null); recargar() }} />
      )}
    </div>
  )
}

// ── Escritorio: grilla semanal + panel "Por agendar" ─────────────────────────
function GrillaSemana({ catalogos, camiones, porAgendar, onAbrirEncargo, recargar, version }) {
  const [lunes, setLunes] = useState(lunesDe(hoyPY()))
  const [sheet, setSheet] = useState(null)
  const [sobre, setSobre] = useState(null) // celda bajo el arrastre
  const [guardando, setGuardando] = useState(false)
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i))
  const { asignaciones, encargos, cargando } = useAsignacionesRango(dias[0], dias[6], version)
  const hoy = hoyPY()
  const cat = { ...catalogos, camiones }

  const celdas = useMemo(() => {
    const m = {}
    asignaciones.forEach(a => { (m[`${a.equipo_id}|${a.fecha}`] ||= []).push(a) })
    return m
  }, [asignaciones])

  // Asignaciones de la semana en camiones que ya no están marcados como logística
  const huerfanas = asignaciones.filter(a => !camiones.some(c => c.id === a.equipo_id))

  const soltar = async (fecha, equipoId, dato) => {
    if (guardando) return
    setGuardando(true)
    let error
    if (dato.tipo === 'encargo') {
      const chofer = camiones.find(c => c.id === equipoId)?.operador_asignado_id || null
      ;({ error } = await supabase.from('asignaciones')
        .insert({ encargo_id: dato.id, fecha, equipo_id: equipoId, operador_id: chofer }))
      if (!error) toast('✅ Camión asignado correctamente')
    } else if (dato.tipo === 'asig') {
      if (dato.fecha === fecha && dato.equipo_id === equipoId) { setGuardando(false); return }
      const cambios = { fecha, equipo_id: equipoId }
      if (dato.equipo_id !== equipoId) cambios.operador_id = camiones.find(c => c.id === equipoId)?.operador_asignado_id || null
      ;({ error } = await supabase.from('asignaciones').update(cambios).eq('id', dato.id))
      if (!error) toast('✅ Asignación reprogramada correctamente')
    }
    setGuardando(false)
    if (error) return toast('❌ ' + msgError(error))
    if (fecha < hoy) toast('⚠️ Quedó asignada en un día pasado: aparecerá como atrasada')
    recargar()
  }

  const leerDato = (ev) => {
    try { return JSON.parse(ev.dataTransfer.getData('text/plain')) } catch { return null }
  }

  return (
    <div style={{ padding: '16px 20px 40px', display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
      {/* Grilla */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <button onClick={() => setLunes(sumarDias(lunes, -7))} style={{ ...estilos.btnSecundario, padding: '6px 14px' }}>‹ Anterior</button>
          <button onClick={() => setLunes(lunesDe(hoy))} style={estilos.chip(lunes === lunesDe(hoy))}>Esta semana</button>
          <button onClick={() => setLunes(sumarDias(lunes, 7))} style={{ ...estilos.btnSecundario, padding: '6px 14px' }}>Siguiente ›</button>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: '13px', color: '#6b7280' }}>
            {cargando ? 'Cargando…' : `${asignaciones.length} asignaciones · ${fmtFecha(dias[0], { conDia: false })} al ${fmtFecha(dias[6], { conDia: false })}`}
          </span>
        </div>

        <div style={{ overflowX: 'auto', background: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: '820px' }}>
            <thead>
              <tr>
                <th style={{ width: '120px', textAlign: 'left', padding: '10px 12px', fontSize: '12px', color: '#6b7280', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>Camión</th>
                {dias.map(d => (
                  <th key={d} style={{ padding: '10px 6px', fontSize: '13px', borderBottom: '1px solid #e5e7eb', borderLeft: '1px solid #f1f5f9',
                    background: d === hoy ? '#eff6ff' : '#f9fafb', color: d === hoy ? '#1d4ed8' : '#374151', fontWeight: 700 }}>
                    {fmtFecha(d)}{d === hoy && ' · hoy'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {camiones.map(c => (
                <tr key={c.id}>
                  <td style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                    <div style={{ fontWeight: 800, fontSize: '14px' }}>{c.numero_identificacion}</div>
                    <div style={{ fontSize: '11px', color: '#9ca3af' }}>{nombreOperador(catalogos.operadores, c.operador_asignado_id) || 'sin chofer fijo'}</div>
                  </td>
                  {dias.map(d => {
                    const key = `${c.id}|${d}`
                    const lista = celdas[key] || []
                    const activo = sobre === key
                    return (
                      <td key={d}
                        onClick={() => { if (!lista.length) setSheet({ preset: { fecha: d, equipo_id: c.id } }) }}
                        onDragOver={ev => { ev.preventDefault(); if (sobre !== key) setSobre(key) }}
                        onDragLeave={() => setSobre(s => (s === key ? null : s))}
                        onDrop={ev => { ev.preventDefault(); setSobre(null); const dato = leerDato(ev); if (dato) soltar(d, c.id, dato) }}
                        style={{ padding: '4px', borderBottom: '1px solid #f1f5f9', borderLeft: '1px solid #f1f5f9', verticalAlign: 'top',
                          background: activo ? '#dbeafe' : d === hoy ? '#f8fbff' : '#fff',
                          outline: activo ? '2px dashed #1d4ed8' : 'none', outlineOffset: '-3px',
                          cursor: lista.length ? 'default' : 'pointer', height: '58px', transition: 'background 0.1s' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          {lista.map(a => (
                            <div key={a.id}
                              draggable={a.estado === 'planificada'}
                              onDragStart={ev => {
                                ev.dataTransfer.setData('text/plain', JSON.stringify({ tipo: 'asig', id: a.id, fecha: a.fecha, equipo_id: a.equipo_id }))
                                ev.dataTransfer.effectAllowed = 'move'
                              }}
                              style={{ cursor: a.estado === 'planificada' ? 'grab' : 'pointer' }}>
                              <ChipAsignacion a={a} encargo={encargos[a.encargo_id]} compacto
                                onClick={(e) => { e.stopPropagation(); onAbrirEncargo(a.encargo_id) }} />
                            </div>
                          ))}
                          {lista.length > 0 && (
                            <button onClick={(e) => { e.stopPropagation(); setSheet({ preset: { fecha: d, equipo_id: c.id } }) }}
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

        {huerfanas.length > 0 && (
          <div style={{ marginTop: '10px', padding: '10px 12px', borderRadius: '10px', background: '#fffbeb', color: '#92400e', fontSize: '13px' }}>
            ⚠️ {huerfanas.length} asignación(es) de esta semana están en camiones que ya no figuran como logística activos:{' '}
            {huerfanas.map(a => encargos[a.encargo_id]?.descripcion || '¿?').join(', ')}
          </div>
        )}

        <div style={{ display: 'flex', gap: '14px', marginTop: '10px', fontSize: '12px', color: '#6b7280', flexWrap: 'wrap' }}>
          {Object.entries(ESTADO_ASIG).map(([k, v]) => (
            <span key={k}><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', background: v.bg, border: `1px solid ${v.color}`, marginRight: '4px' }} />{v.label}</span>
          ))}
          <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', background: '#fee2e2', border: '1px solid #b91c1c', marginRight: '4px' }} />Atrasada</span>
          <span>· Arrastrá un encargo a una celda para asignarlo · Arrastrá una asignación planificada para reprogramarla</span>
        </div>
      </div>

      {/* Panel: por agendar */}
      <aside style={{ width: '300px', flexShrink: 0, position: 'sticky', top: '80px', maxHeight: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column',
        background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '12px' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: 800, fontSize: '15px', color: '#111827' }}>⏳ Por agendar</span>
            <span style={{ background: porAgendar.length ? '#92400e' : '#9ca3af', color: '#fff', borderRadius: '999px', padding: '1px 8px', fontSize: '12px', fontWeight: 700 }}>
              {porAgendar.length}
            </span>
          </div>
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>Arrastrá cada uno al camión y día</div>
        </div>
        <div style={{ overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {porAgendar.length === 0 && (
            <div style={{ textAlign: 'center', color: '#6b7280', fontSize: '13px', padding: '20px 8px' }}>
              🎉 Todos los encargos tienen camión.
            </div>
          )}
          {porAgendar.map(e => (
            <TarjetaPorAgendar key={e.id} e={e} arrastrable
              onAbrir={() => onAbrirEncargo(e.id)}
              onAsignar={() => setSheet({ encargo: e })} />
          ))}
        </div>
      </aside>

      {sheet && (
        <AsignarSheet catalogos={cat} encargo={sheet.encargo} preset={sheet.preset} onCerrar={() => setSheet(null)}
          onGuardado={() => { setSheet(null); recargar() }} />
      )}
    </div>
  )
}

export default function Planificacion({ catalogos, onAbrirEncargo, version }) {
  const escritorio = useEsEscritorio()
  const [recarga, setRecarga] = useState(0)
  const camiones = useCamiones(catalogos.camiones, recarga)
  const porAgendar = usePorAgendar(`${version}-${recarga}`)
  const props = {
    catalogos, camiones, porAgendar, onAbrirEncargo,
    version: `${version}-${recarga}`,
    recargar: () => setRecarga(r => r + 1),
  }
  return escritorio ? <GrillaSemana {...props} /> : <VistaDia {...props} />
}
