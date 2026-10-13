import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../utils/ui'
import { C, s, num, ddmm, hoyPY, LIMITE } from './constantes'

// ============================================================
// CORRECTIVOS — pestaña "Reunión" (reunión semanal de equipos parados)
// Datos: v_correctivos_parados, correctivos_parados_reservas(equipo) y
// correctivos_tareas (ver supabase/correctivos_reunion_setup.sql).
// Pensada para proyectar: letra grande, poco ruido.
// ============================================================

const FRENOS = {
  compras: { label: 'Compras', area: 'Compras', fg: C.rojo, bg: C.rojoBg },
  traslado: { label: 'Traslado', area: 'Depósito/Transporte', fg: C.ambar, bg: C.ambarBg },
  retirar: { label: 'Retirar de depósito', area: 'Taller', fg: C.azul, bg: C.azulBg },
  liberar: { label: 'Liberar orden', area: 'Taller', fg: C.azul, bg: C.azulBg },
  definir_repuestos: { label: 'Definir repuestos', area: 'Taller', fg: C.azul, bg: C.azulBg },
  ejecutar: { label: 'Ejecutar reparación', area: 'Taller', fg: C.azul, bg: C.azulBg },
}

const AREAS = [
  { id: 'Compras', fg: C.rojo, bg: C.rojoBg },
  { id: 'Depósito/Transporte', label: 'Traslado', fg: C.ambar, bg: C.ambarBg },
  { id: 'Taller', fg: C.azul, bg: C.azulBg },
]

// Días entre dos fechas YYYY-MM-DD (b − a)
const diasEntre = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86400000) : null)

const st = {
  base: { fontSize: 16 },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 12 },
  kpi: { background: '#fff', border: `1px solid ${C.borde}`, borderRadius: 10, padding: 14 },
  kpiValor: { fontSize: 34, fontWeight: 800, lineHeight: 1.1 },
  kpiLabel: { fontSize: 15, color: C.gris },
  titulo: { fontSize: 18, fontWeight: 700, margin: '0 0 10px' },
  fila: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 4px', cursor: 'pointer', minHeight: 44 },
  btnChico: { minHeight: 36, padding: '0 12px', border: `1px solid ${C.borde}`, background: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 },
}

function FrenoChip({ freno }) {
  const f = FRENOS[freno]
  if (!f) return null
  return <span style={{ ...s.chip(f.bg, f.fg), fontSize: 13 }}>{f.label}{f.area !== f.label ? ` · ${f.area}` : ''}</span>
}

// ------------------------------------------------------------
// Detalle desplegable de un equipo
// ------------------------------------------------------------
function DetalleEquipo({ eq, tareas, puede, onTareaCreada, onCerrar }) {
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
    <div style={{ padding: '4px 4px 14px 28px', borderTop: `1px dashed ${C.borde}` }}>
      <div style={{ ...s.subtitulo, marginTop: 10 }}>Órdenes abiertas</div>
      <div style={s.scroll}>
        <table style={s.tabla}>
          <thead><tr>{['Orden', 'Texto', 'Status', 'Entrada', 'Qué la frena'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>
            {(eq.ordenes || []).map((o) => (
              <tr key={o.orden}>
                <td style={s.td}>{o.orden}</td>
                <td style={s.td}>{o.texto || '—'}</td>
                <td style={s.td}>{o.status_usuario || '—'}</td>
                <td style={s.td}>{ddmm(o.fecha_entrada)}</td>
                <td style={s.td}><FrenoChip freno={o.freno} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ ...s.subtitulo, marginTop: 14 }}>
        Repuestos pendientes · stock por centro {eq.centro ? <span style={{ textTransform: 'none' }}>(centro del equipo: <strong>{eq.centro}</strong>)</span> : <span style={{ textTransform: 'none' }}>(equipo sin centro en SAP)</span>}
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

      <div style={{ ...s.subtitulo, marginTop: 14 }}>Tareas</div>
      {tareas.length === 0 && <div style={s.meta}>Sin tareas.</div>}
      {tareas.map((t) => <TareaFila key={t.id} t={t} puede={puede} onCerrar={onCerrar} mostrarEquipo={false} />)}
      {puede && <NuevaTarea eq={eq} onCreada={onTareaCreada} />}
    </div>
  )
}

function NuevaTarea({ eq, onCreada }) {
  const [descripcion, setDescripcion] = useState('')
  const [fecha, setFecha] = useState('')
  const [orden, setOrden] = useState('')
  const [guardando, setGuardando] = useState(false)

  const guardar = async (e) => {
    e.preventDefault()
    if (!descripcion.trim() || !fecha) return toast('Completá la descripción y la fecha objetivo', 'error')
    setGuardando(true)
    const { error } = await supabase.from('correctivos_tareas').insert({
      equipo: eq.equipo,
      descripcion: descripcion.trim(),
      fecha_objetivo: fecha,
      orden: orden ? Number(orden) : null,
    })
    setGuardando(false)
    if (error) return toast('❌ No se pudo crear la tarea: ' + error.message, 'error')
    toast('✅ Tarea creada')
    setDescripcion(''); setFecha(''); setOrden('')
    onCreada()
  }

  return (
    <form onSubmit={guardar} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
      <input style={{ ...s.input, flex: '3 1 260px', width: 'auto' }} placeholder="Nueva tarea: qué hay que hacer…"
        value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
      <input type="date" style={{ ...s.input, flex: '1 1 150px', width: 'auto' }} value={fecha} min={hoyPY()}
        onChange={(e) => setFecha(e.target.value)} aria-label="Fecha objetivo" />
      <select style={{ ...s.input, flex: '1 1 150px', width: 'auto' }} value={orden} onChange={(e) => setOrden(e.target.value)} aria-label="Orden relacionada">
        <option value="">Sin orden</option>
        {(eq.ordenes || []).map((o) => <option key={o.orden} value={o.orden}>{o.orden}</option>)}
      </select>
      <button type="submit" disabled={guardando} style={{ ...s.boton, background: C.azul, color: '#fff', fontWeight: 600, border: 'none' }}>
        {guardando ? 'Guardando…' : '+ Agregar'}
      </button>
    </form>
  )
}

function TareaFila({ t, puede, onCerrar, mostrarEquipo = true }) {
  const hoy = hoyPY()
  const atraso = t.estado === 'pendiente' ? diasEntre(t.fecha_objetivo, hoy) : null
  const vencida = atraso != null && atraso > 0
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', marginBottom: 6, borderRadius: 8,
      background: t.estado === 'hecha' ? '#f3f4f6' : vencida ? C.rojoBg : '#fff', border: `1px solid ${vencida ? C.rojo : C.borde}` }}>
      {mostrarEquipo && <strong style={{ minWidth: 100 }}>{t.equipo}</strong>}
      <span style={{ flex: '1 1 240px', textDecoration: t.estado === 'hecha' ? 'line-through' : 'none' }}>
        {t.descripcion}{t.orden ? <span style={s.meta}> · orden {t.orden}</span> : null}
      </span>
      <span style={s.meta}>objetivo {ddmm(t.fecha_objetivo)}</span>
      {vencida && <span style={s.chip(C.rojo, '#fff')}>{atraso} d de atraso</span>}
      {t.estado === 'hecha' && <span style={s.chip(C.verdeBg, C.verde)}>hecha {ddmm(t.cerrado_en)}</span>}
      {puede && t.estado === 'pendiente' && (
        <button style={{ ...st.btnChico, color: C.verde, borderColor: C.verde }} onClick={() => onCerrar(t)}>✓ Hecha</button>
      )}
    </div>
  )
}

function TarjetaEquipo({ eq, abierto, onToggle, tareasEq, puede, onTareaCreada, onCerrar }) {
  const pendientes = tareasEq.filter((t) => t.estado === 'pendiente').length
  return (
    <div style={{ borderBottom: `1px solid ${C.borde}` }}>
      <div style={st.fila} onClick={onToggle}>
        <span style={{ color: C.azul, width: 14 }}>{abierto ? '▾' : '▸'}</span>
        <strong style={{ fontSize: 17, minWidth: 100 }}>{eq.equipo}</strong>
        <span style={{ flex: '1 1 200px', color: C.gris }}>{eq.denominacion || '—'}</span>
        {eq.estado_actividad === 'parado' && (
          <span style={s.meta}>desde {ddmm(eq.parado_desde)} · <strong style={{ color: C.texto }}>{num(eq.dias_parado)} d</strong></span>
        )}
        {eq.estado_actividad === 'sin_datos' && <span style={s.chip(C.ambarBg, C.ambar)}>sin datos de actividad</span>}
        <FrenoChip freno={eq.freno} />
        <span style={s.meta}>{eq.cant_ordenes} {eq.cant_ordenes === 1 ? 'orden' : 'órdenes'}</span>
        {pendientes > 0 && <span style={s.chip('#ede9fe', '#6d28d9')}>{pendientes} {pendientes === 1 ? 'tarea' : 'tareas'}</span>}
      </div>
      {abierto && <DetalleEquipo eq={eq} tareas={tareasEq} puede={puede} onTareaCreada={onTareaCreada} onCerrar={onCerrar} />}
    </div>
  )
}

// ------------------------------------------------------------
// Pestaña
// ------------------------------------------------------------
export default function Reunion({ recarga }) {
  const [filas, setFilas] = useState([])
  const [tareas, setTareas] = useState([])
  const [puede, setPuede] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [obra, setObra] = useState('')
  const [abierto, setAbierto] = useState(null)
  const [verSinDatos, setVerSinDatos] = useState(false)

  const cargarTareas = useCallback(async () => {
    const desde = new Date(Date.now() - 30 * 86400000).toISOString()
    const { data, error } = await supabase.from('correctivos_tareas')
      .select('id, equipo, orden, descripcion, fecha_objetivo, estado, creado_en, cerrado_en')
      .or(`estado.eq.pendiente,cerrado_en.gte.${desde}`)
      .order('fecha_objetivo', { ascending: true })
      .limit(LIMITE)
    if (error) throw new Error('tareas: ' + error.message)
    setTareas(data || [])
  }, [])

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [p, g] = await Promise.all([
        supabase.from('v_correctivos_parados')
          .select('equipo, denominacion, ubicacion, centro, estado_actividad, fuente_actividad, ult_hora, ult_carga, parado_desde, dias_parado, corte_obra, freno, area_freno, cant_ordenes, ordenes, tiene_candidata_cierre')
          .limit(LIMITE),
        supabase.rpc('correctivos_puede_gestionar'),
        cargarTareas(),
      ])
      if (p.error) throw new Error('parados: ' + p.error.message)
      setFilas(p.data || [])
      setPuede(!g.error && g.data === true)
    } catch (e) {
      console.error(e)
      toast('❌ Error al cargar la reunión: ' + e.message, 'error')
    } finally {
      setCargando(false)
    }
  }, [cargarTareas])

  useEffect(() => { cargar() }, [cargar, recarga])

  const cerrarTarea = async (t) => {
    const { error } = await supabase.from('correctivos_tareas').update({ estado: 'hecha' }).eq('id', t.id)
    if (error) return toast('❌ No se pudo cerrar: ' + error.message, 'error')
    toast('✅ Tarea cerrada')
    cargarTareas().catch((e) => toast('❌ ' + e.message, 'error'))
  }
  const recargarTareas = () => cargarTareas().catch((e) => toast('❌ ' + e.message, 'error'))

  const obras = useMemo(() => [...new Set(filas.map((f) => f.ubicacion))].sort((a, b) => a.localeCompare(b)), [filas])
  const obraDeEquipo = useMemo(() => new Map(filas.map((f) => [f.equipo, f.ubicacion])), [filas])
  const visibles = useMemo(() => (obra ? filas.filter((f) => f.ubicacion === obra) : filas), [filas, obra])
  const parados = visibles.filter((f) => f.estado_actividad === 'parado')
  const sinDatos = visibles.filter((f) => f.estado_actividad === 'sin_datos')
  const candidatas = visibles.filter((f) => f.tiene_candidata_cierre)

  const tareasPorEquipo = useMemo(() => tareas.reduce((m, t) => ((m[t.equipo] ||= []).push(t), m), {}), [tareas])
  const pendientes = tareas
    .filter((t) => t.estado === 'pendiente')
    .filter((t) => !obra || obraDeEquipo.get(t.equipo) === obra)

  // Indicadores
  const promedio = (lista) => (lista.length ? Math.round(lista.reduce((a, f) => a + (f.dias_parado || 0), 0) / lista.length) : null)
  const porObra = Object.entries(parados.reduce((m, f) => ((m[f.ubicacion] ||= []).push(f), m), {}))
    .map(([nombre, lista]) => ({
      nombre, lista: lista.sort((a, b) => (b.dias_parado ?? 0) - (a.dias_parado ?? 0)),
      promedio: promedio(lista),
      corte: lista.reduce((mx, f) => (f.corte_obra && (!mx || f.corte_obra > mx) ? f.corte_obra : mx), null),
    }))
    .sort((a, b) => b.lista.length - a.lista.length || a.nombre.localeCompare(b.nombre))
  const porArea = AREAS.map((a) => ({ ...a, n: parados.filter((f) => f.area_freno === a.id).length }))

  if (cargando && !filas.length) return <div style={s.vacio}>⏳ Cargando…</div>

  const tarjeta = (eq) => (
    <TarjetaEquipo key={eq.equipo} eq={eq} abierto={abierto === eq.equipo}
      onToggle={() => setAbierto(abierto === eq.equipo ? null : eq.equipo)}
      tareasEq={tareasPorEquipo[eq.equipo] || []} puede={puede} onTareaCreada={recargarTareas} onCerrar={cerrarTarea} />
  )

  return (
    <div style={st.base}>
      {/* Filtro por obra */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <label htmlFor="reunion-obra" style={{ fontWeight: 600 }}>Obra</label>
        <select id="reunion-obra" style={{ ...s.input, width: 'auto', minWidth: 240, flex: '0 1 360px' }} value={obra} onChange={(e) => setObra(e.target.value)}>
          <option value="">Todas las obras</option>
          {obras.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {!puede && <span style={s.meta}>Solo lectura</span>}
      </div>

      {/* 1. Indicadores */}
      <div style={st.kpiGrid}>
        <div style={st.kpi}>
          <div style={{ ...st.kpiValor, color: C.rojo }}>{num(parados.length)}</div>
          <div style={st.kpiLabel}>equipos parados con orden correctiva abierta</div>
          {sinDatos.length > 0 && <div style={{ ...s.meta, marginTop: 4 }}>+ {sinDatos.length} sin datos de actividad</div>}
        </div>
        <div style={st.kpi}>
          <div style={st.kpiValor}>{promedio(parados) == null ? '—' : `${num(promedio(parados))} d`}</div>
          <div style={st.kpiLabel}>promedio parados</div>
          <div style={{ marginTop: 6, fontSize: 13, color: C.gris, maxHeight: 96, overflowY: 'auto' }}>
            {porObra.map((o) => <div key={o.nombre}>{o.nombre}: <strong style={{ color: C.texto }}>{num(o.promedio)} d</strong> ({o.lista.length})</div>)}
          </div>
        </div>
        <div style={st.kpi}>
          <div style={st.kpiLabel}>Qué los frena</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            {porArea.map((a) => (
              <div key={a.id} style={{ flex: '1 1 70px', background: a.bg, color: a.fg, borderRadius: 8, padding: '6px 10px' }}>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{a.n}</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{a.label || a.id}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Tareas pendientes */}
      <div style={s.card}>
        <div style={st.titulo}>
          Tareas pendientes · {pendientes.length}
          {pendientes.some((t) => diasEntre(t.fecha_objetivo, hoyPY()) > 0) && (
            <span style={{ ...s.chip(C.rojoBg, C.rojo), marginLeft: 8 }}>
              {pendientes.filter((t) => diasEntre(t.fecha_objetivo, hoyPY()) > 0).length} vencidas
            </span>
          )}
        </div>
        {pendientes.length === 0
          ? <div style={s.meta}>No hay tareas pendientes.</div>
          : pendientes.map((t) => <TareaFila key={t.id} t={t} puede={puede} onCerrar={cerrarTarea} />)}
      </div>

      {/* 3. Parados por obra */}
      <div style={st.titulo}>Equipos parados por obra</div>
      {porObra.length === 0 && <div style={{ ...s.card, ...s.vacio }}>No hay equipos parados con estos filtros.</div>}
      {porObra.map((o) => (
        <div key={o.nombre} style={s.card}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontSize: 18, fontWeight: 700 }}>{o.nombre}</span>
            <span style={s.chip(C.rojoBg, C.rojo)}>{o.lista.length} parados</span>
            <span style={s.meta}>horas cargadas hasta {ddmm(o.corte)}</span>
          </div>
          {o.lista.map(tarjeta)}
        </div>
      ))}

      {/* 4. Sin datos de actividad */}
      {sinDatos.length > 0 && (
        <div style={s.card}>
          <button onClick={() => setVerSinDatos(!verSinDatos)}
            style={{ background: 'none', border: 'none', padding: 0, width: '100%', textAlign: 'left', cursor: 'pointer', fontWeight: 700, fontSize: 18, minHeight: 36 }}>
            {verSinDatos ? '▾' : '▸'} Sin datos de actividad · {sinDatos.length}
          </button>
          <div style={{ ...s.meta, marginTop: 2 }}>Sin horas ni cargas de combustible en SAP: confirmar en la reunión si está parado.</div>
          {verSinDatos && sinDatos.sort((a, b) => a.ubicacion.localeCompare(b.ubicacion) || a.equipo.localeCompare(b.equipo)).map((eq) => (
            <div key={eq.equipo}>
              <div style={{ ...s.meta, marginTop: 8 }}>{eq.ubicacion}</div>
              {tarjeta(eq)}
            </div>
          ))}
        </div>
      )}

      {/* 5. Candidatas a cierre */}
      <div style={s.card}>
        <div style={st.titulo}>Candidatas a cierre · {candidatas.reduce((n, f) => n + f.ordenes.filter((x) => x.status_usuario === '0TES').length, 0)}</div>
        <div style={{ ...s.meta, marginBottom: 6 }}>Órdenes 0TES (no liberadas) de equipos que siguen trabajando.</div>
        {candidatas.length === 0 ? <div style={s.meta}>Ninguna.</div> : (
          <div style={s.scroll}>
            <table style={s.tabla}>
              <thead><tr>{['Equipo', 'Obra', 'Orden', 'Texto', 'Última actividad'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {candidatas.flatMap((f) => f.ordenes.filter((x) => x.status_usuario === '0TES').map((x) => (
                  <tr key={x.orden}>
                    <td style={s.td}><strong>{f.equipo}</strong></td>
                    <td style={s.td}>{f.ubicacion}</td>
                    <td style={s.td}>{x.orden}</td>
                    <td style={s.td}>{x.texto || '—'}</td>
                    <td style={s.td}>{ddmm(f.ult_hora || f.ult_carga)}{f.fuente_actividad === 'combustible' ? ' (combustible)' : ''}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
