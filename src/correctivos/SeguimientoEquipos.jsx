import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../utils/ui'
import { C, s, num, ddmm, ddmmhhmm, coincide, LIMITE } from './constantes'
import { SITUACIONES, SITUACION_POR_ID, ALERTAS, FRENOS, ALERTAS_ROJAS, refOrden } from './seguimientoConst'
import HiloSheet, { ChipSituacion, ChipsAlertas } from './HiloSheet'
import { AltaAviso } from './Seguimiento'

// ============================================================
// CORRECTIVOS — pestaña "Seguimiento" (fusión de Reunión + Seguimiento, 23/11/2026)
// Una fila por equipo con TODAS sus órdenes y avisos abiertos, cada uno en su línea
// con su situación (cargada a mano: manda) y el freno calculado de SAP (etiqueta gris).
// Datos: RPC corr_equipos_seguimiento() (solo admin / ve_correctivos),
//        corr_seg_listar() para abrir cada hilo en HiloSheet,
//        correctivos_parados_reservas(equipo) en el detalle.
// Ver supabase/correctivos_fusion_reunion_seguimiento.sql
// Los residentes siguen usando Seguimiento.jsx (modo residente), sin cambios.
// ============================================================

const SIN_OBRA = 'Sin ubicación'

const st = {
  fondo: { position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', zIndex: 40, display: 'flex', justifyContent: 'flex-end' },
  panel: { width: 'min(720px, 100%)', height: '100%', background: '#fff', overflowY: 'auto', padding: 16, boxSizing: 'border-box' },
  encabezado: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '10px 6px 4px', cursor: 'pointer', minHeight: 40 },
  linea: (resaltada, roja) => ({
    display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '6px 8px', margin: '0 0 4px 16px', borderRadius: 8, cursor: 'pointer',
    background: resaltada ? C.azulBg : roja ? '#fff7f7' : C.fondo, border: `1px solid ${resaltada ? C.azul : C.borde}`, fontSize: 14,
  }),
  texto: { flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.gris },
  freno: { ...s.chip('#f3f4f6', C.gris), fontSize: 11, fontWeight: 500 },
}

// La denominación SAP suele empezar con el ID técnico: no repetirlo
const quitarId = (texto, equipo) => {
  const d = (texto || '').trim()
  return (equipo && d.toUpperCase().startsWith(equipo.toUpperCase()) ? d.slice(equipo.length) : d).trim() || '—'
}
const sinId = (eq) => quitarId(eq.denominacion, eq.equipo)

const ref = (i) => (i.orden ? `Orden ${i.orden}` : `Aviso ${i.aviso || '—'}`)

function ChipFreno({ freno }) {
  if (!freno || !FRENOS[freno]) return null
  return <span style={st.freno} title="Qué la frena según SAP (calculado)">{FRENOS[freno]}</span>
}

function ChipSituacionItem({ i, compacto = false }) {
  if (i.situacion) return <ChipSituacion id={i.situacion} />
  // En la fila, si ya está la alerta "Sin seguimiento" el chip "sin novedades" dice lo mismo
  if (compacto && (i.alertas || []).includes('sin_seguimiento')) return null
  return <span style={s.chip('#f3f4f6', C.gris)}>{i.sin_hilo ? 'sin hilo' : 'sin novedades'}</span>
}

// ------------------------------------------------------------
// Línea de una orden / aviso dentro de la fila del equipo
// ------------------------------------------------------------
function LineaItem({ i, equipo, resaltada, onAbrir }) {
  const roja = (i.alertas || []).some((a) => ALERTAS_ROJAS.includes(a))
  return (
    <div style={st.linea(resaltada, roja)} role="button" tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onAbrir(i) }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onAbrir(i) } }}>
      <strong style={{ whiteSpace: 'nowrap' }}>{ref(i)}</strong>
      {i.status_sap && <span style={s.meta}>{i.status_sap}{i.abierta_sap === false ? ' (cerrada)' : ''}</span>}
      <span style={st.texto} title={i.texto || ''}>{quitarId(i.texto, equipo)}</span>
      <ChipSituacionItem i={i} compacto />
      {i.responsable && <span style={s.meta}>→ {i.responsable}</span>}
      {i.compromiso && <span style={s.meta}>· para {ddmm(i.compromiso)}</span>}
      {!i.sin_hilo && i.dias_sin_novedad != null && <span style={s.meta}>· hace {num(i.dias_sin_novedad)} d</span>}
      <ChipFreno freno={i.freno} />
      <ChipsAlertas alertas={i.alertas} />
    </div>
  )
}

// ------------------------------------------------------------
// Fila de un equipo: encabezado + una línea por cada orden/aviso
// ------------------------------------------------------------
function FilaEquipo({ eq, coincideItem, hayFiltroItem, onAbrirEquipo, onAbrirItem }) {
  return (
    <div style={{ borderBottom: `1px solid ${C.borde}`, paddingBottom: 6 }}>
      <div style={st.encabezado} onClick={() => onAbrirEquipo(eq.equipo)} role="button" tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onAbrirEquipo(eq.equipo)}>
        <strong style={{ fontSize: 17, minWidth: 96 }}>{eq.equipo}</strong>
        <span style={{ flex: '1 1 160px', color: C.gris, minWidth: 0 }}>{sinId(eq)}</span>
        {eq.cant_ordenes > 0 && <span style={s.chip(C.azulBg, C.azul)}>{eq.cant_ordenes} {eq.cant_ordenes === 1 ? 'orden' : 'órdenes'}</span>}
        {eq.cant_avisos > 0 && <span style={s.chip(C.ambarBg, C.ambar)}>{eq.cant_avisos} {eq.cant_avisos === 1 ? 'aviso' : 'avisos'}</span>}
        {eq.parado && (
          <span style={s.chip(C.rojoBg, C.rojo)} title={`Parado desde ${ddmm(eq.parado_desde)}${eq.motivo_parado === 'app' || eq.motivo_parado === 'app_y_sap' ? ' · aviso abierto en taller (app)' : ''}`}>
            parado {eq.dias_parado != null ? `${num(eq.dias_parado)} d` : ''}
          </span>
        )}
      </div>
      {(eq.items || []).map((i, k) => (
        <LineaItem key={i.seguimiento_id || `${i.orden || ''}-${i.aviso || ''}-${k}`} i={i} equipo={eq.equipo}
          resaltada={hayFiltroItem && coincideItem(i)} onAbrir={onAbrirItem} />
      ))}
    </div>
  )
}

// ------------------------------------------------------------
// Detalle del equipo: cada orden/aviso con su historial + reservas y stock
// ------------------------------------------------------------
function Historial({ hiloId, version }) {
  const [datos, setDatos] = useState(null)
  useEffect(() => {
    let vivo = true
    supabase.rpc('corr_seg_novedades', { p_id: hiloId }).then(({ data, error }) => {
      if (!vivo) return
      if (error) toast('❌ ' + error.message, 'error')
      else setDatos(data || [])
    })
    return () => { vivo = false }
  }, [hiloId, version])
  if (datos === null) return <div style={s.meta}>⏳ Cargando historial…</div>
  if (datos.length === 0) return <div style={s.meta}>Todavía no hay novedades.</div>
  return datos.map((n) => (
    <div key={n.id} style={{ borderLeft: `3px solid ${SITUACION_POR_ID[n.situacion]?.fg || C.borde}`, padding: '4px 10px', marginBottom: 6, background: C.fondo, borderRadius: 6 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <ChipSituacion id={n.situacion} />
        {n.responsable && <span style={s.meta}>→ {n.responsable}</span>}
        {n.fecha_compromiso && <span style={s.meta}>· para {ddmm(n.fecha_compromiso)}</span>}
      </div>
      <div style={{ marginTop: 2, whiteSpace: 'pre-wrap', fontSize: 14 }}>{n.texto}</div>
      <div style={{ ...s.meta, fontSize: 12 }}>{n.autor || '—'} · {ddmmhhmm(n.creado_en)}</div>
    </div>
  ))
}

function Reservas({ eq }) {
  const [reservas, setReservas] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let vivo = true
    supabase.rpc('correctivos_parados_reservas', { p_equipo: eq.equipo }).then(({ data, error: e }) => {
      if (!vivo) return
      if (e) setError(e.message)
      else setReservas(data || [])
    })
    return () => { vivo = false }
  }, [eq.equipo])

  return (
    <>
      <div style={{ ...s.subtitulo, marginTop: 16 }}>
        Repuestos pendientes · stock por centro{' '}
        <span style={{ textTransform: 'none' }}>{eq.centro ? <>(centro del equipo: <strong>{eq.centro}</strong>)</> : '(equipo sin centro en SAP)'}</span>
      </div>
      {error && <div style={s.aviso}>No se pudieron cargar las reservas: {error}</div>}
      {!error && reservas === null && <div style={s.meta}>⏳ Cargando…</div>}
      {reservas && reservas.length === 0 && <div style={s.meta}>Sin reservas pendientes.</div>}
      {reservas && reservas.length > 0 && (
        <div style={s.scroll}>
          <table style={s.tabla}>
            <thead><tr>{['Orden', 'Material', 'Pendiente', 'Centro reserva', 'Stock por centro'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>
              {reservas.map((r) => (
                <tr key={`${r.orden}-${r.posicion}`}>
                  <td style={s.td}>{r.orden}</td>
                  <td style={s.td}><strong>{r.material}</strong><br /><span style={s.meta}>{r.descripcion}</span></td>
                  <td style={s.td}>{num(r.cantidad_pendiente)} {r.unidad}</td>
                  <td style={s.td}>{r.centro_reserva || '—'}</td>
                  <td style={s.td}>
                    {(r.stock_por_centro || []).length === 0
                      ? <span style={s.chip(C.rojoBg, C.rojo)}>sin stock</span>
                      : r.stock_por_centro.map((x) => {
                        const propio = x.centro === eq.centro
                        return (
                          <span key={x.centro} title={`al ${ddmm(x.a_fecha)}`}
                            style={{ ...s.chip(propio ? C.verdeBg : '#f3f4f6', propio ? C.verde : C.texto), marginRight: 4, marginBottom: 2, border: propio ? `1px solid ${C.verde}` : 'none' }}>
                            {x.centro}: {num(x.stock)}
                          </span>
                        )
                      })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function DetalleEquipo({ eq, version, puedeCargarEn, onAbrirHilo, onCerrar, hiloAbierto }) {
  useEffect(() => {
    if (hiloAbierto) return undefined // la tecla Escape la maneja el hilo que está encima
    const esc = (e) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onCerrar, hiloAbierto])

  return (
    <div style={st.fondo} onClick={onCerrar}>
      <div style={st.panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Equipo ${eq.equipo}`}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{eq.equipo}</div>
            <div style={s.meta}>{sinId(eq)} · {eq.ubicacion || SIN_OBRA}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {eq.parado
                ? <span style={s.chip(C.rojoBg, C.rojo)}>parado desde {ddmm(eq.parado_desde)}{eq.dias_parado != null ? ` · ${num(eq.dias_parado)} d` : ''}</span>
                : eq.estado_actividad === 'trabajando' ? <span style={s.chip(C.verdeBg, C.verde)}>trabajando</span>
                  : eq.estado_actividad === 'sin_datos' ? <span style={s.chip(C.ambarBg, C.ambar)}>sin datos de actividad</span> : null}
              {(eq.motivo_parado === 'app' || eq.motivo_parado === 'app_y_sap') && <span style={s.chip(C.ambarBg, C.ambar)}>aviso en taller (app)</span>}
            </div>
          </div>
          <button style={s.boton} onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>

        <div style={{ ...s.subtitulo, marginTop: 14 }}>Órdenes y avisos abiertos · {(eq.items || []).length}</div>
        {(eq.items || []).map((i, k) => (
          <div key={i.seguimiento_id || `${i.orden || ''}-${i.aviso || ''}-${k}`} style={{ ...s.card, padding: 10 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <strong>{ref(i)}</strong>
              {i.orden && i.aviso && <span style={s.meta}>aviso {i.aviso}</span>}
              {i.status_sap && <span style={s.meta}>· SAP {i.status_sap}{i.abierta_sap === false ? ' (cerrada)' : ''}</span>}
              {i.fecha_entrada && <span style={s.meta}>· entrada {ddmm(i.fecha_entrada)}</span>}
              <span style={{ flex: 1 }} />
              <ChipSituacionItem i={i} />
              <ChipFreno freno={i.freno} />
            </div>
            <div style={{ marginTop: 4, fontSize: 14 }}>{i.texto || '—'}</div>
            {i.alertas?.length > 0 && <div style={{ marginTop: 6 }}><ChipsAlertas alertas={i.alertas} /></div>}
            {i.sin_hilo ? (
              <div style={{ ...s.meta, marginTop: 6 }}>
                Sin hilo de seguimiento: {i.orden ? 'la orden no es TCOC/TCUR o todavía no corrió la sincronización (cada 2 h).' : 'el aviso de la app todavía no tiene hilo.'}
              </div>
            ) : (
              <>
                <div style={{ ...s.subtitulo, marginTop: 10, fontSize: 12 }}>Novedades</div>
                <Historial hiloId={i.seguimiento_id} version={version} />
                <button style={{ ...s.boton, marginTop: 4, color: C.azul, fontWeight: 600, borderColor: C.azul }} onClick={() => onAbrirHilo(i.seguimiento_id)}>
                  {puedeCargarEn(eq) ? '+ Agregar novedad' : 'Ver hilo'}
                </button>
              </>
            )}
          </div>
        ))}

        <Reservas eq={eq} />
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Pestaña
// ------------------------------------------------------------
export default function SeguimientoEquipos({ recarga }) {
  const [equipos, setEquipos] = useState([])
  const [hilos, setHilos] = useState([]) // corr_seg_listar(): para abrir HiloSheet y los terminados
  const [permisos, setPermisos] = useState(null)
  const [responsables, setResponsables] = useState([])
  const [cargando, setCargando] = useState(true)
  const [version, setVersion] = useState(0) // refresca historiales del detalle
  const [equipoAbierto, setEquipoAbierto] = useState(null)
  const [hiloAbierto, setHiloAbierto] = useState(null)
  const [verAlta, setVerAlta] = useState(false)
  const [verTerminados, setVerTerminados] = useState(false)
  // filtros
  const [obra, setObra] = useState('')
  const [q, setQ] = useState('')
  const [situacion, setSituacion] = useState('')
  const [responsable, setResponsable] = useState('')
  const [alerta, setAlerta] = useState('')
  const [soloParados, setSoloParados] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [e, l, p, r] = await Promise.all([
        supabase.rpc('corr_equipos_seguimiento').limit(LIMITE),
        supabase.rpc('corr_seg_listar').limit(LIMITE),
        supabase.rpc('corr_seg_permisos'),
        supabase.rpc('corr_seg_responsables'),
      ])
      if (e.error) throw new Error(e.error.message)
      if (l.error) throw new Error(l.error.message)
      setEquipos(e.data || [])
      setHilos(l.data || [])
      setPermisos(p.data || null)
      setResponsables(r.data || [])
      setVersion((v) => v + 1)
    } catch (err) {
      console.error(err)
      toast('❌ Error al cargar el seguimiento: ' + err.message, 'error')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar, recarga])

  // ---------- filtros por línea (situación, responsable, alerta) ----------
  const hayFiltroItem = !!(situacion || responsable || alerta)
  const coincideItem = useCallback((i) =>
    (!situacion || (situacion === '_sin' ? !i.situacion : i.situacion === situacion))
    && (!responsable || i.responsable === responsable)
    && (!alerta || (alerta === '_alguna' ? (i.alertas || []).length > 0 : (i.alertas || []).includes(alerta)))
  , [situacion, responsable, alerta])

  const obras = useMemo(() => [...new Set(equipos.map((e) => e.ubicacion || SIN_OBRA))].sort((a, b) => a.localeCompare(b)), [equipos])
  const qq = q.trim()

  const visibles = useMemo(() => equipos.filter((e) =>
    (!obra || (e.ubicacion || SIN_OBRA) === obra)
    && (!soloParados || e.parado)
    && (!qq || coincide(qq, e.equipo, e.denominacion) || (e.items || []).some((i) => coincide(qq, i.orden, i.aviso)))
    && (!hayFiltroItem || (e.items || []).some(coincideItem))
  ), [equipos, obra, soloParados, qq, hayFiltroItem, coincideItem])

  // ---------- indicadores (cuentan hilos, salvo "parados" que cuenta equipos) ----------
  const abiertos = useMemo(() => hilos.filter((h) => !h.terminado), [hilos])
  const cuenta = (a) => abiertos.filter((h) => h.alertas?.includes(a)).length
  const conNovedadHoy = abiertos.filter((h) => h.dias_sin_novedad === 0 && h.cant_novedades > 0).length
  const parados = equipos.filter((e) => e.parado).length
  const terminados = hilos.filter((h) => h.terminado)

  // ---------- orden y agrupado por obra ----------
  const grupos = useMemo(() => {
    const rojo = (e) => (e.alertas || []).some((a) => ALERTAS_ROJAS.includes(a))
    const cmp = (a, b) => (Number(rojo(b)) - Number(rojo(a)))
      || (Number(b.parado) - Number(a.parado))
      || (a.parado && b.parado ? (b.dias_parado ?? -1) - (a.dias_parado ?? -1) : 0)
      || ((b.dias_sin_novedad ?? -1) - (a.dias_sin_novedad ?? -1))
      || a.equipo.localeCompare(b.equipo)
    const m = new Map()
    visibles.forEach((e) => {
      const k = e.ubicacion || SIN_OBRA
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(e)
    })
    return [...m.entries()]
      .map(([nombre, lista]) => ({ nombre, lista: lista.sort(cmp), rojos: lista.filter(rojo).length, parados: lista.filter((e) => e.parado).length }))
      .sort((a, b) => b.rojos - a.rojos || b.lista.length - a.lista.length || a.nombre.localeCompare(b.nombre))
  }, [visibles])

  // Si el filtro de equipo deja un solo equipo, se abre su detalle (como en Reunión)
  const unico = qq && visibles.length === 1 ? visibles[0].equipo : null
  useEffect(() => { if (unico) setEquipoAbierto(unico) }, [unico])

  const eqAbierto = equipoAbierto ? equipos.find((e) => e.equipo === equipoAbierto) : null
  const hilo = hiloAbierto ? hilos.find((h) => h.id === hiloAbierto) : null
  const puedeAlta = permisos?.gestiona
  const puedeCargarEn = (eq) => permisos?.gestiona || (permisos?.ubicaciones || []).includes(eq.ubicacion)

  const abrirItem = (i) => {
    if (i.seguimiento_id) setHiloAbierto(i.seguimiento_id)
    else setEquipoAbierto(equipos.find((e) => (e.items || []).includes(i))?.equipo || null)
  }

  if (cargando && !equipos.length) return <div style={s.vacio}>⏳ Cargando…</div>

  const limpiarFiltros = () => { setObra(''); setQ(''); setSituacion(''); setResponsable(''); setAlerta(''); setSoloParados(false) }
  const filtrando = obra || qq || hayFiltroItem || soloParados

  return (
    <div>
      {/* Indicadores (tocables = filtro) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
        {[
          { label: 'órdenes y avisos abiertos', n: abiertos.length, color: C.texto, on: !alerta && !soloParados, click: () => { setAlerta(''); setSoloParados(false) } },
          { label: 'con novedad hoy', n: conNovedadHoy, color: C.verde, click: null },
          { label: 'equipos parados', n: parados, color: C.rojo, on: soloParados, click: () => setSoloParados(!soloParados) },
          ...['sin_seguimiento', 'compromiso_vencido', 'cerrada_sap_con_seguimiento', 'otes_con_trabajo'].map((a) => ({
            label: a === 'sin_seguimiento' ? 'sin seguimiento (> 3 d)' : a === 'compromiso_vencido' ? 'compromisos vencidos' : a === 'cerrada_sap_con_seguimiento' ? 'cerradas en SAP' : '0TES con trabajo',
            n: cuenta(a), color: a === 'sin_seguimiento' ? C.ambar : C.rojo, on: alerta === a, click: () => setAlerta(alerta === a ? '' : a),
          })),
        ].map((k) => (
          <button key={k.label} disabled={!k.click} onClick={k.click || undefined}
            style={{ textAlign: 'left', background: k.on ? C.azulBg : '#fff', border: `1px solid ${k.on ? C.azul : C.borde}`, borderRadius: 10, padding: 10, cursor: k.click ? 'pointer' : 'default', color: 'inherit' }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: k.color }}>{num(k.n)}</div>
            <div style={{ fontSize: 13, color: C.gris }}>{k.label}</div>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <input style={{ ...s.input, flex: '2 1 200px', width: 'auto' }} placeholder="Equipo (ej. VL-CN081), denominación, orden o aviso…"
          value={q} onChange={(e) => setQ(e.target.value)} aria-label="Equipo" />
        <select style={{ ...s.input, flex: '1 1 180px', width: 'auto' }} value={obra} onChange={(e) => setObra(e.target.value)} aria-label="Obra">
          <option value="">Todas las obras</option>
          {obras.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <select style={{ ...s.input, flex: '1 1 160px', width: 'auto' }} value={situacion} onChange={(e) => setSituacion(e.target.value)} aria-label="Situación">
          <option value="">Toda situación</option>
          <option value="_sin">Sin seguimiento</option>
          {SITUACIONES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        <select style={{ ...s.input, flex: '1 1 160px', width: 'auto' }} value={responsable} onChange={(e) => setResponsable(e.target.value)} aria-label="Responsable">
          <option value="">Cualquier responsable</option>
          {responsables.map((r) => <option key={r.id} value={r.nombre}>{r.nombre}</option>)}
        </select>
        <select style={{ ...s.input, flex: '1 1 160px', width: 'auto' }} value={alerta} onChange={(e) => setAlerta(e.target.value)} aria-label="Alerta">
          <option value="">Con o sin alertas</option>
          <option value="_alguna">Con alguna alerta</option>
          {Object.entries(ALERTAS).map(([id, a]) => <option key={id} value={id}>{a.label}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
          <input type="checkbox" checked={soloParados} onChange={(e) => setSoloParados(e.target.checked)} /> Solo parados
        </label>
        <span style={s.meta}>{num(visibles.length)} de {num(equipos.length)} equipos</span>
        {filtrando && <button style={{ ...s.boton, minHeight: 34 }} onClick={limpiarFiltros}>✕ Limpiar filtros</button>}
        <span style={{ flex: 1 }} />
        {puedeAlta && !verAlta && (
          <button style={{ ...s.boton, background: C.azul, color: '#fff', border: 'none', fontWeight: 700 }} onClick={() => setVerAlta(true)}>+ Aviso</button>
        )}
        <button style={s.boton} onClick={cargar} disabled={cargando} aria-label="Recargar">{cargando ? '…' : '↻'}</button>
      </div>
      {(equipos.length >= LIMITE || hilos.length >= LIMITE) && <div style={s.aviso}>⚠ Se llegó al límite de {num(LIMITE)} filas: puede faltar información.</div>}
      {permisos && !permisos.gestiona && <div style={{ ...s.meta, marginBottom: 8 }}>Solo lectura: cargan novedades el encargado y los residentes de cada obra.</div>}

      {verAlta && (
        <AltaAviso responsables={responsables} onCancelar={() => setVerAlta(false)}
          onCreado={async (id) => { setVerAlta(false); await cargar(); if (id) setHiloAbierto(id) }} />
      )}

      {/* Equipos agrupados por obra */}
      {grupos.length === 0 && <div style={{ ...s.card, ...s.vacio }}>No hay equipos con estos filtros.</div>}
      {grupos.map((g) => (
        <div key={g.nombre} style={s.card}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 2 }}>
            <span style={{ fontSize: 18, fontWeight: 700 }}>{g.nombre}</span>
            <span style={s.meta}>{g.lista.length} {g.lista.length === 1 ? 'equipo' : 'equipos'}</span>
            {g.parados > 0 && <span style={s.chip(C.rojoBg, C.rojo)}>{g.parados} parados</span>}
          </div>
          {g.lista.map((eq) => (
            <FilaEquipo key={eq.equipo} eq={eq} coincideItem={coincideItem} hayFiltroItem={hayFiltroItem}
              onAbrirEquipo={setEquipoAbierto} onAbrirItem={abrirItem} />
          ))}
        </div>
      ))}

      {/* Terminados en los últimos 7 días (para reabrir) */}
      {terminados.length > 0 && (
        <div style={s.card}>
          <button onClick={() => setVerTerminados(!verTerminados)}
            style={{ background: 'none', border: 'none', padding: 0, width: '100%', textAlign: 'left', cursor: 'pointer', fontWeight: 700, fontSize: 16, minHeight: 36 }}>
            {verTerminados ? '▾' : '▸'} Terminados en los últimos 7 días · {terminados.length}
          </button>
          {verTerminados && terminados.map((h) => (
            <div key={h.id} style={st.linea(false, false)} role="button" tabIndex={0}
              onClick={() => setHiloAbierto(h.id)} onKeyDown={(e) => e.key === 'Enter' && setHiloAbierto(h.id)}>
              <strong>{h.equipo}</strong>
              <span style={s.meta}>{refOrden(h)}</span>
              <span style={st.texto}>{h.motivo_termino || '—'}</span>
              <span style={s.meta}>{ddmm(h.terminado_en)}</span>
              <ChipsAlertas alertas={h.alertas} />
            </div>
          ))}
        </div>
      )}

      {eqAbierto && (
        <DetalleEquipo eq={eqAbierto} version={version} puedeCargarEn={puedeCargarEn} hiloAbierto={!!hilo}
          onAbrirHilo={setHiloAbierto} onCerrar={() => setEquipoAbierto(null)} />
      )}
      {hilo && (
        <HiloSheet hilo={hilo} permisos={permisos} responsables={responsables}
          onCerrar={() => setHiloAbierto(null)} onCambio={cargar} />
      )}
    </div>
  )
}
