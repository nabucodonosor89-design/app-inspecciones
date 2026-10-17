import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast, confirmar } from '../utils/ui'
import { C, s, ddmm, ddmmhhmm, num } from '../correctivos/constantes'
import { textoVencido, pct } from './constantes'
import Zonas from './Zonas.jsx'

// ============================================================
// PLANIFICADOR DE INSPECCIONES (solo admin)
// Reemplaza al Dashboard Ejecutivo y al Panel de Flota.
// Datos: RPC insp_* (ver supabase/planificador_inspecciones.sql). Todas validan admin adentro.
// ============================================================

export default function Planificador({ onVolver }) {
  const [tab, setTab] = useState('resumen')
  const [cargando, setCargando] = useState(true)
  const [generando, setGenerando] = useState(false)
  const [d, setD] = useState({ estado: [], serie: [], cumplimiento: [], carga: [], alertas: null })

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [estado, serie, cumplimiento, carga, alertas] = await Promise.all([
        supabase.rpc('insp_panel_estado'),
        supabase.rpc('insp_kpi_serie'),
        supabase.rpc('insp_cumplimiento'),
        supabase.rpc('insp_carga_zonas'),
        supabase.rpc('insp_alertas'),
      ])
      for (const r of [estado, serie, cumplimiento, carga, alertas]) if (r.error) throw r.error
      setD({ estado: estado.data || [], serie: serie.data || [], cumplimiento: cumplimiento.data || [],
        carga: carga.data || [], alertas: alertas.data })
    } catch (e) {
      console.error(e)
      toast('❌ Error al cargar el planificador: ' + e.message, 'error')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function generar() {
    setGenerando(true)
    try {
      let { data, error } = await supabase.rpc('insp_generar_plan', { p_semana: null, p_forzar: false })
      if (error) throw error
      if (data?.ok === false && data?.motivo === 'ya_existe') {
        const ok = await confirmar(`Ya hay un plan para la semana del ${ddmm(data.semana)}. ¿Reemplazarlo? Las listas de los inspectores cambian.`)
        if (!ok) return
        ;({ data, error } = await supabase.rpc('insp_generar_plan', { p_semana: null, p_forzar: true }))
        if (error) throw error
      }
      const det = (data?.zonas || []).map((z) => `${z.zona}: ${z.planificados}`).join(' · ')
      const sin = data?.sin_inspector?.length ? ` · Sin inspector: ${data.sin_inspector.join(', ')}` : ''
      toast(`✅ Plan generado (${det})${sin}`, 'success')
      cargar()
    } catch (e) {
      console.error(e)
      toast('❌ No se pudo generar el plan: ' + e.message, 'error')
    } finally {
      setGenerando(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: C.fondo }}>
      <div style={s.wrap}>
        <div style={s.header}>
          <button style={s.boton} onClick={onVolver} aria-label="Volver">←</button>
          <div style={{ flex: 1, minWidth: 180 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Planificador de inspecciones</h2>
            <div style={s.meta}>Objetivo: la menor cantidad posible de equipos con la inspección vencida</div>
          </div>
          <button style={{ ...s.boton, color: C.azul, fontWeight: 600 }} onClick={cargar} disabled={cargando}>
            {cargando ? 'Cargando…' : '↻ Refrescar'}
          </button>
          <button style={{ ...s.boton, background: C.azul, color: '#fff', fontWeight: 600, border: 'none' }}
            onClick={generar} disabled={generando}>
            {generando ? 'Generando…' : 'Generar plan ahora'}
          </button>
        </div>

        <div style={s.tabs}>
          {[['resumen', 'Resumen'], ['listas', 'Listas por zona'], ['zonas', 'Zonas']].map(([id, label]) => (
            <button key={id} style={s.tab(tab === id)} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {tab === 'resumen' && <Resumen d={d} cargando={cargando} />}
        {tab === 'listas' && <Listas semanas={[...new Set(d.cumplimiento.map((c) => c.semana))]} />}
        {tab === 'zonas' && <Zonas onCambio={cargar} />}
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// RESUMEN
// ------------------------------------------------------------
function Resumen({ d, cargando }) {
  const actual = useMemo(() => {
    const u = d.estado.length
    const venc = d.estado.filter((e) => e.estado === 'vencido').length
    const nunca = d.estado.filter((e) => e.estado === 'nunca').length
    return { u, venc, nunca, al_dia: u - venc - nunca, pct: pct(venc + nunca, u) }
  }, [d.estado])

  const serieFlota = useMemo(() => d.serie.filter((k) => !k.zona_id), [d.serie])

  // Cumplimiento: semana → zona
  const cumpl = useMemo(() => {
    const zonas = [...new Set(d.cumplimiento.map((c) => c.zona_nombre))].sort()
    const semanas = [...new Set(d.cumplimiento.map((c) => c.semana))].sort().reverse()
    const m = new Map(d.cumplimiento.map((c) => [`${c.semana}|${c.zona_nombre}`, c]))
    return { zonas, semanas, m }
  }, [d.cumplimiento])

  if (cargando && !d.estado.length) return <div style={s.vacio}>Cargando…</div>

  const a = d.alertas || {}
  const nAlertas = (a.ubicaciones_nuevas?.length || 0) + (a.ubicaciones_sin_zona?.length || 0) +
    (a.sin_ubicacion?.length || 0) + (a.zonas_sin_inspector?.length || 0)

  return (
    <>
      {/* 1. % de la flota vencida */}
      <div style={s.card}>
        <h3 style={s.subtitulo}>% de la flota con la inspección vencida</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 44, fontWeight: 800, color: actual.pct > 50 ? C.rojo : actual.pct > 20 ? C.ambar : C.verde, lineHeight: 1 }}>
              {actual.pct} %
            </div>
            <div style={s.meta}>hoy · {num(actual.venc + actual.nunca)} de {num(actual.u)} equipos</div>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 14 }}>
            <Dato label="Al día" n={actual.al_dia} color={C.verde} />
            <Dato label="Vencidos" n={actual.venc} color={C.ambar} />
            <Dato label="Nunca inspeccionados" n={actual.nunca} color={C.rojo} />
          </div>
        </div>
        <GraficoSerie serie={serieFlota} actual={actual.pct} />
      </div>

      {/* 2. Cumplimiento semanal por zona */}
      <div style={s.card}>
        <h3 style={s.subtitulo}>Cumplimiento semanal por zona (hechos / planificados)</h3>
        {!cumpl.semanas.length ? (
          <div style={s.vacio}>Todavía no hay planes generados.</div>
        ) : (
          <div style={s.scroll}>
            <table style={s.tabla}>
              <thead><tr>
                <th style={s.th}>Semana</th>
                {cumpl.zonas.map((z) => <th key={z} style={s.th}>{z}</th>)}
                <th style={s.th}>Total</th>
              </tr></thead>
              <tbody>
                {cumpl.semanas.map((sem) => {
                  let tp = 0, th = 0
                  return (
                    <tr key={sem}>
                      <td style={s.td}>{ddmm(sem)}</td>
                      {cumpl.zonas.map((z) => {
                        const c = cumpl.m.get(`${sem}|${z}`)
                        if (c) { tp += c.planificados; th += c.hechos }
                        return <td key={z} style={s.td}>{c ? <Cumpl h={c.hechos} p={c.planificados} /> : '—'}</td>
                      })}
                      <td style={{ ...s.td, fontWeight: 700 }}><Cumpl h={th} p={tp} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3. Carga por zona */}
      <div style={s.card}>
        <h3 style={s.subtitulo}>Carga por zona</h3>
        <div style={{ ...s.meta, marginBottom: 8 }}>
          Equipos de la zona ÷ (capacidad diaria × días hábiles del ciclo). Más de 100 % = no se llega a inspeccionar
          todo dentro de la frecuencia: hace falta otro inspector.
        </div>
        <div style={s.scroll}>
          <table style={s.tabla}>
            <thead><tr>
              <th style={s.th}>Zona</th><th style={s.th}>Equipos</th><th style={s.th}>Capacidad diaria</th>
              <th style={s.th}>Días hábiles del ciclo</th><th style={s.th}>Carga</th>
            </tr></thead>
            <tbody>
              {d.carga.map((z) => {
                const c = z.carga == null ? null : Math.round(Number(z.carga) * 100)
                const rojo = c == null || c > 100
                return (
                  <tr key={z.zona_id}>
                    <td style={s.td}>{z.zona_nombre} <span style={s.meta}>({z.zona_tipo})</span></td>
                    <td style={s.td}>{num(z.universo)}</td>
                    <td style={s.td}>{num(z.capacidad_diaria)}</td>
                    <td style={s.td}>{z.dias_habiles_ciclo}</td>
                    <td style={s.td}>
                      <span style={s.chip(rojo ? C.rojoBg : C.verdeBg, rojo ? C.rojo : C.verde)}>
                        {c == null ? 'Sin inspector' : `${c} %`}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Alertas */}
      <div style={s.card}>
        <h3 style={s.subtitulo}>Alertas {nAlertas ? `· ${nAlertas}` : ''}</h3>
        {!nAlertas && <div style={s.meta}>Sin alertas.</div>}
        {!!a.zonas_sin_inspector?.length && (
          <Alerta titulo="Zonas sin inspector esta semana" ayuda="No generan lista. Asigná un titular o suplente en Zonas.">
            {a.zonas_sin_inspector.join(' · ')}
          </Alerta>
        )}
        {!!a.ubicaciones_nuevas?.length && (
          <Alerta titulo="Ubicaciones nuevas de la IE36 (sin configurar)" ayuda="Sus equipos no entran en el planificador hasta que les definas si se inspeccionan y la zona (pestaña Zonas).">
            {a.ubicaciones_nuevas.map((u) => `${u.ubicacion} (${u.equipos})`).join(' · ')}
          </Alerta>
        )}
        {!!a.ubicaciones_sin_zona?.length && (
          <Alerta titulo="Ubicaciones que se inspeccionan pero no tienen zona" ayuda="Sus equipos cuentan en el KPI pero no entran en ninguna lista.">
            {a.ubicaciones_sin_zona.join(' · ')}
          </Alerta>
        )}
        {!!a.sin_ubicacion?.length && (
          <Alerta titulo={`Equipos sin ubicación en la IE36 · ${a.sin_ubicacion.length}`} ayuda="Cuentan en el KPI pero no se asignan a ninguna zona. Se corrige en SAP.">
            {a.sin_ubicacion.map((e) => e.equipo + (e.en_ie36 ? '' : ' (no está en la IE36)')).join(' · ')}
          </Alerta>
        )}
      </div>
    </>
  )
}

function Dato({ label, n, color }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{num(n)}</div>
      <div style={s.meta}>{label}</div>
    </div>
  )
}

function Cumpl({ h, p }) {
  if (!p) return '—'
  const v = pct(h, p)
  const [bg, fg] = v >= 90 ? [C.verdeBg, C.verde] : v >= 60 ? [C.ambarBg, C.ambar] : [C.rojoBg, C.rojo]
  return <span>{h}/{p} <span style={s.chip(bg, fg)}>{Math.round(v)} %</span></span>
}

function Alerta({ titulo, ayuda, children }) {
  return (
    <div style={{ borderTop: `1px solid ${C.borde}`, padding: '8px 0' }}>
      <strong style={{ color: C.ambar }}>⚠ {titulo}</strong>
      <div style={{ fontSize: 14, margin: '4px 0' }}>{children}</div>
      <div style={s.meta}>{ayuda}</div>
    </div>
  )
}

// Línea semanal del % vencido desde la línea base (+ punto de hoy)
function GraficoSerie({ serie, actual }) {
  const puntos = serie.map((k) => ({ label: ddmm(k.semana), v: pct(k.vencidos + k.nunca, k.universo), base: k.es_linea_base }))
  puntos.push({ label: 'Hoy', v: actual, hoy: true })
  if (puntos.length < 2) return null
  const W = 640, H = 180, pl = 36, pr = 12, pt = 12, pb = 28
  const x = (i) => pl + (i * (W - pl - pr)) / (puntos.length - 1)
  const y = (v) => pt + ((100 - v) * (H - pt - pb)) / 100
  const path = puntos.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.v)}`).join(' ')
  return (
    <div style={{ ...s.scroll, marginTop: 12 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 320, height: 'auto' }} role="img"
        aria-label="% de la flota vencida por semana">
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={pl} x2={W - pr} y1={y(t)} y2={y(t)} stroke={C.borde} />
            <text x={pl - 6} y={y(t) + 4} fontSize="11" textAnchor="end" fill={C.gris}>{t}%</text>
          </g>
        ))}
        <path d={path} fill="none" stroke={C.azul} strokeWidth="2.5" />
        {puntos.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.v)} r="4" fill={p.hoy ? '#fff' : C.azul} stroke={C.azul} strokeWidth="2" />
            <text x={x(i)} y={y(p.v) - 8} fontSize="11" textAnchor="middle" fill={C.texto}>{Math.round(p.v)}%</text>
            <text x={x(i)} y={H - 8} fontSize="11" textAnchor="middle" fill={C.gris}>{p.base ? `${p.label} (base)` : p.label}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

// ------------------------------------------------------------
// LISTAS POR ZONA (solo lectura)
// ------------------------------------------------------------
function Listas({ semanas }) {
  const [semana, setSemana] = useState('')
  const [zona, setZona] = useState('')
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      setCargando(true)
      const { data, error } = await supabase.rpc('insp_plan_detalle', { p_semana: semana || null })
      if (!vivo) return
      if (error) toast('❌ Error al cargar el plan: ' + error.message, 'error')
      setFilas(data || [])
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [semana])

  const zonas = [...new Set(filas.map((f) => f.zona_nombre))]
  const vis = filas.filter((f) => !zona || f.zona_nombre === zona)
  const generado = filas[0]?.generado_en

  return (
    <div style={s.card}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <select style={{ ...s.input, width: 'auto' }} value={semana} onChange={(e) => setSemana(e.target.value)}>
          <option value="">Semana actual</option>
          {semanas.map((w) => <option key={w} value={w}>Semana del {ddmm(w)}</option>)}
        </select>
        {generado && <span style={s.meta}>Generado {ddmmhhmm(generado)}</span>}
      </div>
      <div style={s.chips}>
        <button style={s.chipBtn(!zona)} onClick={() => setZona('')}>Todas · {filas.length}</button>
        {zonas.map((z) => (
          <button key={z} style={s.chipBtn(zona === z)} onClick={() => setZona(z)}>
            {z} · {filas.filter((f) => f.zona_nombre === z && f.hecho).length}/{filas.filter((f) => f.zona_nombre === z).length}
          </button>
        ))}
      </div>
      {cargando ? <div style={s.vacio}>Cargando…</div> : !vis.length ? (
        <div style={s.vacio}>No hay plan para esa semana.</div>
      ) : (
        <div style={s.scroll}>
          <table style={s.tabla}>
            <thead><tr>
              <th style={s.th}>#</th><th style={s.th}>Zona</th><th style={s.th}>Obra</th><th style={s.th}>Equipo</th>
              <th style={s.th}>Denominación</th><th style={s.th}>Al generar</th><th style={s.th}>Hecho</th>
            </tr></thead>
            <tbody>
              {vis.map((f) => (
                <tr key={f.equipo_id} style={{ opacity: f.hecho ? 0.6 : 1 }}>
                  <td style={s.td}>{f.orden}</td>
                  <td style={s.td}>{f.zona_nombre}</td>
                  <td style={s.td}>{f.ubicacion_sap || 'Sin ubicación'}</td>
                  <td style={{ ...s.td, fontWeight: 600 }}>{f.numero_identificacion}</td>
                  <td style={s.td}>{f.denominacion}</td>
                  <td style={s.td}>{textoVencido(f.dias_vencido_al_generar)}</td>
                  <td style={s.td}>{f.hecho ? <span style={{ color: C.verde, fontWeight: 700 }}>✓ {ddmm(f.hecho_en)}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
