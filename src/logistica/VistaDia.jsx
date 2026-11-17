import { useMemo, useState } from 'react'
import AsignarSheet from './AsignarSheet'
import ConfirmarSheet from './ConfirmarSheet'
import Sheet from './Sheet'
import { ChipAsignacion, ChipCamionRequerido, ChipCategoria, TarjetaCopia, TarjetaHueco, TarjetaViaje } from './Tarjetas'
import { BadgeUrgencia } from './PanelPorAsignar'
import { useAsignacionesRango, useEncargosAbiertos } from './hooks'
import { destinoKey, huecosSemana, mapaOcupacion, ocupado, sinCamion } from './despacho'
import { nombreCamion, nombreOperador } from './datos'
import {
  estilos, fmtDiaCorto, fmtFecha, guardarPref, hoyPY, leerPref, sumarDias, tipoLabel,
} from './constantes'

const PREF_AGRUPAR = 'logistica.despachoDia.agrupar'

function Contador({ valor, label, color, onClick }) {
  return (
    <div role={onClick ? 'button' : undefined} onClick={onClick}
      style={{ flex: 1, border: '1px solid #e5e7eb', background: '#fff', borderRadius: '10px', padding: '8px 4px', textAlign: 'center', cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ fontSize: '20px', fontWeight: 800, color }}>{valor}</div>
      <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 600 }}>{label}{onClick ? ' ›' : ''}</div>
    </div>
  )
}

/**
 * Despacho — celular. Un día por vez (‹ ›, swipe, Hoy).
 * Resolver primero (solo hoy) + lista del día agrupada por frente (default) o por camión.
 */
export default function VistaDia({ catalogos, camiones, onAbrirEncargo, onAbrirCamiones, esAdmin, recargar, version }) {
  const hoy = hoyPY()
  const [fecha, setFecha] = useState(hoy)
  const [touchX, setTouchX] = useState(null)
  const [agrupar, setAgruparState] = useState(() => (leerPref(PREF_AGRUPAR, 'frente') === 'camion' ? 'camion' : 'frente'))
  const [sheet, setSheet] = useState(null)     // AsignarSheet { encargo?, preset }
  const [accion, setAccion] = useState(null)   // { tipo: 'confirmar' | 'reprogramar', asignacion }
  const [verSinCamion, setVerSinCamion] = useState(false)

  const { asignaciones, copias, encargos, cargando } = useAsignacionesRango(fecha, fecha, version)
  const abiertos = useEncargosAbiertos(version)
  const ocup = useMemo(() => mapaOcupacion(asignaciones, copias), [asignaciones, copias])
  const cat = { ...catalogos, camiones }
  const esHoy = fecha === hoy

  const setAgrupar = (v) => { setAgruparState(v); guardarPref(PREF_AGRUPAR, v) }
  const mover = (n) => setFecha(f => sumarDias(f, n))

  // Contadores
  const atrasados = abiertos.filter(e => e.subestado === 'atrasado')
  const sinCam = abiertos.filter(sinCamion)
  const libres = camiones.filter(c => !ocupado(ocup, c.id, fecha))

  // Resolver primero: atrasados sin ningún camión pendiente (los que tienen copia van arriba con Entregado/Reprogramar)
  const atrasadosSinCamion = atrasados.filter(e => Number(e.n_planificadas) === 0)
  const libreDelTipo = (e) => (e.tipo_camion_requerido
    ? camiones.find(c => c.tipo_camion === e.tipo_camion_requerido && !ocupado(ocup, c.id, hoy)) || null
    : null)

  // Huecos del día (mismas reglas que la grilla)
  const huecos = useMemo(() => huecosSemana(abiertos, [fecha], hoy), [abiertos, fecha, hoy])

  // Agrupado por frente
  const frentes = useMemo(() => {
    const m = new Map()
    const fila = (e) => {
      const k = destinoKey(e)
      if (!m.has(k)) m.set(k, { key: k, nombre: e.destino_nombre || '¿destino?', viajes: [], huecos: [], atrasado: false })
      return m.get(k)
    }
    asignaciones.forEach(a => {
      const e = encargos[a.encargo_id]; if (!e) return
      const f = fila(e); f.viajes.push(a)
      if (a.estado === 'planificada' && a.fecha < hoy) f.atrasado = true
    })
    if (!esHoy) copias.forEach(a => { const e = encargos[a.encargo_id]; if (!e) return; const f = fila(e); f.viajes.push(a); f.atrasado = true })
    huecos.forEach(h => { const f = fila(h.encargo); f.huecos.push(h); if (h.vencido) f.atrasado = true })
    return [...m.values()].sort((a, b) => (a.atrasado === b.atrasado ? a.nombre.localeCompare(b.nombre, 'es') : a.atrasado ? -1 : 1))
  }, [asignaciones, copias, encargos, huecos, esHoy, hoy])

  const porCamion = useMemo(() => {
    const m = {}
    asignaciones.forEach(a => { (m[a.equipo_id] ||= []).push(a) })
    return m
  }, [asignaciones])
  const copiasPorCamion = useMemo(() => {
    const m = {}
    copias.forEach(a => { m[a.equipo_id] = (m[a.equipo_id] || 0) + 1 })
    return m
  }, [copias])

  const vacio = !cargando && !asignaciones.length && !huecos.length && !(copias.length && !esHoy)

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', padding: '12px 12px 110px' }}
      onTouchStart={e => setTouchX(e.touches[0].clientX)}
      onTouchEnd={e => {
        if (touchX == null) return
        const dx = e.changedTouches[0].clientX - touchX
        if (Math.abs(dx) > 70) mover(dx < 0 ? 1 : -1)
        setTouchX(null)
      }}>
      {/* Header */}
      <div style={{ position: 'sticky', top: '64px', background: '#f9fafb', paddingBottom: '8px', zIndex: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <button onClick={() => mover(-1)} aria-label="Día anterior" style={{ ...estilos.btnSecundario, padding: '6px 14px' }}>‹</button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Despacho</div>
            <div style={{ fontSize: '18px', fontWeight: 800 }}>{esHoy ? `Hoy · ${fmtDiaCorto(fecha)}` : fecha === sumarDias(hoy, 1) ? `Mañana · ${fmtDiaCorto(fecha)}` : fmtFecha(fecha)}</div>
          </div>
          <button onClick={() => mover(1)} aria-label="Día siguiente" style={{ ...estilos.btnSecundario, padding: '6px 14px' }}>›</button>
          {esAdmin && (
            <button onClick={onAbrirCamiones} title="Camiones (tipos)" aria-label="Camiones"
              style={{ ...estilos.btnSecundario, padding: '6px 10px', fontSize: '18px' }}>🚚</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <Contador valor={atrasados.length} label="atrasados" color={atrasados.length ? '#b91c1c' : '#166534'} />
          <Contador valor={sinCam.length} label="sin camión" color={sinCam.length ? '#c2410c' : '#166534'}
            onClick={sinCam.length ? () => setVerSinCamion(true) : undefined} />
          <Contador valor={libres.length} label="camiones libres" color="#1e40af" />
        </div>
        {!esHoy && (
          <div style={{ textAlign: 'center', marginTop: '8px' }}>
            <button onClick={() => setFecha(hoy)} style={estilos.chip(false)}>Hoy</button>
          </div>
        )}
      </div>

      {/* Resolver primero (solo hoy) */}
      {esHoy && !cargando && (copias.length > 0 || atrasadosSinCamion.length > 0) && (
        <section style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 2px',
            fontSize: '14px', fontWeight: 800, color: '#b91c1c', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            ⚠️ Resolver primero
            <span style={{ background: '#b91c1c', color: '#fff', borderRadius: '999px', padding: '1px 8px', fontSize: '12px' }}>{copias.length + atrasadosSinCamion.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
            {copias.map(a => (
              <TarjetaCopia key={`${a.id}-${a.dia}`} a={a} encargo={encargos[a.encargo_id]}
                camion={nombreCamion(camiones, a)} chofer={nombreOperador(catalogos.operadores, a.operador_id)}
                onAbrir={() => onAbrirEncargo(a.encargo_id)}
                onEntregado={() => setAccion({ tipo: 'confirmar', asignacion: a })}
                onReprogramar={() => setAccion({ tipo: 'reprogramar', asignacion: a })} />
            ))}
            {atrasadosSinCamion.map(e => {
              const libre = libreDelTipo(e)
              return (
                <div key={e.id} onClick={() => onAbrirEncargo(e.id)}
                  style={{ background: '#fef2f2', border: '1px dashed #dc2626', borderRadius: '10px', padding: '10px 12px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: '14px', color: '#111827' }}>{e.descripcion}</div>
                      <div style={{ fontSize: '12px', color: '#4b5563', marginTop: '2px' }}>{e.origen_nombre} <span style={{ color: '#9ca3af' }}>→</span> {e.destino_nombre}</div>
                    </div>
                    <BadgeUrgencia e={e} />
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                    <ChipCategoria categoria={e.categoria} />
                    <ChipCamionRequerido tipo={e.tipo_camion_requerido} />
                  </div>
                  <button onClick={ev => { ev.stopPropagation(); setSheet({ encargo: e, preset: { fecha: hoy, ...(libre ? { equipo_id: libre.id } : {}) } }) }}
                    style={{ ...estilos.btnChico, marginTop: '8px', width: '100%' }}>
                    {libre ? `Asignar a ${libre.numero_identificacion} hoy` : 'Asignar'}
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Toggle agrupado */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 2px 8px' }}>
        <span style={{ fontSize: '14px', fontWeight: 800, color: '#374151', flex: 1 }}>Viajes del día</span>
        <div style={{ display: 'flex', border: '1px solid #d1d5db', borderRadius: '8px', overflow: 'hidden' }}>
          {[['frente', 'Por frente'], ['camion', 'Por camión']].map(([id, label]) => (
            <button key={id} onClick={() => setAgrupar(id)} style={{ padding: '6px 10px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 700,
              background: agrupar === id ? '#1d4ed8' : '#fff', color: agrupar === id ? '#fff' : '#374151' }}>{label}</button>
          ))}
        </div>
      </div>

      {cargando && <div style={{ textAlign: 'center', color: '#6b7280', padding: '30px' }}>Cargando…</div>}

      {vacio && agrupar === 'frente' && (
        <div style={{ ...estilos.card, textAlign: 'center', padding: '24px 14px' }}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#374151' }}>Nada planificado</div>
          <button onClick={() => mover(1)} style={{ ...estilos.chip(false), marginTop: '10px' }}>Ver {esHoy ? 'mañana' : fmtDiaCorto(sumarDias(fecha, 1))} ›</button>
        </div>
      )}

      {!cargando && agrupar === 'frente' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {frentes.map(f => (
            <div key={f.key} style={{ ...estilos.card, padding: '12px', borderLeft: f.atrasado ? '4px solid #dc2626' : '1px solid #e5e7eb' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
                <span style={{ fontWeight: 800, fontSize: '15px', flex: 1 }}>📍 {f.nombre}</span>
                {f.viajes.length >= 2 && (
                  <span style={{ fontSize: '11px', fontWeight: 800, color: '#1e40af', background: '#dbeafe', borderRadius: '6px', padding: '2px 6px' }}>
                    {f.viajes.length} viajes · {new Set(f.viajes.map(a => a.equipo_id)).size} camiones
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {f.huecos.map(h => (
                  <TarjetaHueco key={`h-${h.encargo.id}`} encargo={h.encargo} vencido={h.vencido}
                    onClick={() => setSheet({ encargo: h.encargo, preset: { fecha } })} />
                ))}
                {f.viajes.map(a => (
                  <TarjetaViaje key={a.copia ? `${a.id}-${a.dia}` : a.id} a={a} encargo={encargos[a.encargo_id]} camiones={camiones}
                    onClick={() => onAbrirEncargo(a.encargo_id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!cargando && agrupar === 'camion' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {camiones.map(c => {
            const lista = porCamion[c.id] || []
            const op = nombreOperador(catalogos.operadores, c.operador_asignado_id)
            return (
              <div key={c.id} style={{ ...estilos.card, padding: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: lista.length ? '8px' : 0 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 800, fontSize: '15px' }}>🚛 {c.numero_identificacion}</span>
                    <span style={{ fontSize: '12px', color: c.tipo_camion ? '#4338ca' : '#9ca3af' }}> · {tipoLabel(c.tipo_camion)}</span>
                    {op && <div style={{ fontSize: '12px', color: '#6b7280' }}>{op}</div>}
                  </div>
                  {lista.length === 0 && !copiasPorCamion[c.id] && <span style={{ fontSize: '13px', color: '#16a34a', fontWeight: 700 }}>Libre</span>}
                  {copiasPorCamion[c.id] > 0 && (
                    <span style={{ fontSize: '12px', color: '#b45309', fontWeight: 700 }}>↑ {copiasPorCamion[c.id]} pendiente{copiasPorCamion[c.id] > 1 ? 's' : ''}</span>
                  )}
                  <button onClick={() => setSheet({ preset: { fecha, equipo_id: c.id } })} aria-label={`Asignar a ${c.numero_identificacion}`}
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

      {verSinCamion && (
        <Sheet titulo="Sin camión" subtitulo={`${sinCam.length} encargo(s) sin ninguna asignación`} onCerrar={() => setVerSinCamion(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sinCam.map(e => (
              <div key={e.id} style={{ border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px 12px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: '14px' }}>{e.descripcion}</div>
                    <div style={{ fontSize: '12px', color: '#4b5563' }}>{e.origen_nombre} → {e.destino_nombre}</div>
                  </div>
                  <BadgeUrgencia e={e} />
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px', alignItems: 'center' }}>
                  <ChipCategoria categoria={e.categoria} />
                  <ChipCamionRequerido tipo={e.tipo_camion_requerido} />
                  <span style={{ flex: 1 }} />
                  <button onClick={() => { setVerSinCamion(false); setSheet({ encargo: e, preset: { fecha: e.fecha_requerida && e.fecha_requerida >= hoy ? e.fecha_requerida : hoy } }) }}
                    style={estilos.btnChico}>Asignar</button>
                </div>
              </div>
            ))}
          </div>
        </Sheet>
      )}

      {sheet && (
        <AsignarSheet catalogos={cat} encargo={sheet.encargo} preset={sheet.preset} onCerrar={() => setSheet(null)}
          onGuardado={() => { setSheet(null); recargar() }} />
      )}
      {accion?.tipo === 'reprogramar' && encargos[accion.asignacion.encargo_id] && (
        <AsignarSheet catalogos={cat} encargo={encargos[accion.asignacion.encargo_id]} asignacion={accion.asignacion}
          onCerrar={() => setAccion(null)} onGuardado={() => { setAccion(null); recargar() }} />
      )}
      {accion?.tipo === 'confirmar' && encargos[accion.asignacion.encargo_id] && (
        <ConfirmarSheet catalogos={cat} encargo={encargos[accion.asignacion.encargo_id]} asignacion={accion.asignacion}
          onCerrar={() => setAccion(null)} onGuardado={() => { setAccion(null); recargar() }} />
      )}
    </div>
  )
}
