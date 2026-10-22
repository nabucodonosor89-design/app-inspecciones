import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../utils/ui'
import { useEscritorio } from '../correctivos/useEscritorio'
import { C, s, num, hoyPY, TIPOS_HALLAZGO } from './constantes'
import DetalleDias from '../trabajoEquipos/DetalleDias'

// ============================================================
// COMBUSTIBLE VS CERTIFICACIÓN (Gerencia) — un punto por equipo: certificación neta SAP (Gs) contra
// litros cargados en SAP. Alarmas por mes cerrado (desde sep-2026, ver CC_INICIO):
//   comb_sin_cert = carga combustible y no certifica (o certifica en negativo)
//   cert_sin_comb = certifica y no carga combustible
// Sin reglas por condición del equipo: salta todo y se revisa caso por caso ("Revisado" con nota,
// para siempre o solo ese mes). Datos: RPC uso_cc_datos / uso_cc_revisar / uso_cc_anular
// (supabase/uso_combustible_certificacion.sql).
// ============================================================

const ALARMAS = {
  comb_sin_cert: { label: 'Carga y no certifica', corto: 'Sin certificar' },
  cert_sin_comb: { label: 'Certifica sin combustible', corto: 'Sin combustible' },
}
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const GRIS_PUNTO = '#94a3b8'

const mGs = (n) => (n == null ? '—' : `${num(Math.round(Number(n) / 1e5) / 10)} M`)
const lts = (n) => `${num(Math.round(Number(n) || 0))} L`
const denom = (r) => (r.denominacion || '').replace(r.equipo, '').trim()
const pad = (n) => String(n).padStart(2, '0')
const finMes = (a, m) => new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)

// Ticks "lindos" para un rango
function ticks(min, max, n = 5) {
  const span = max - min || 1
  const paso0 = span / n
  const mag = 10 ** Math.floor(Math.log10(paso0))
  const paso = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((p) => span / p <= n + 1) || mag * 10
  const out = []
  for (let v = Math.ceil(min / paso) * paso; v <= max + 1e-9; v += paso) out.push(Math.round(v / paso) * paso)
  return out
}

function Dispersion({ puntos, onElegir }) {
  const [hover, setHover] = useState(null)
  const escritorio = useEscritorio()
  // En celular un lienzo más angosto: el texto queda legible al escalar
  const W = escritorio ? 800 : 420, H = escritorio ? 420 : 380, M = { l: 56, r: 12, t: 16, b: 44 }
  if (!puntos.length) return <div style={s.vacio}>Sin datos en el período</div>
  const xs = puntos.map((p) => p.gs / 1e6), ys = puntos.map((p) => p.lit)
  const x0 = Math.min(0, ...xs), x1 = Math.max(1, ...xs), y1 = Math.max(10, ...ys)
  const sx = (v) => M.l + ((v - x0) / (x1 - x0)) * (W - M.l - M.r)
  const sy = (v) => H - M.b - (v / y1) * (H - M.t - M.b)
  const tx = ticks(x0, x1), ty = ticks(0, y1)
  // Primero los normales, encima los revisados y arriba de todo las alarmas pendientes
  const orden = [...puntos].sort((a, b) => (a.estado === 'pendiente') - (b.estado === 'pendiente') || (a.estado === 'revisada') - (b.estado === 'revisada'))
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img"
        aria-label="Dispersión: certificación neta contra litros de combustible por equipo">
        {tx.map((v) => <line key={'x' + v} x1={sx(v)} x2={sx(v)} y1={M.t} y2={H - M.b} stroke={C.borde} strokeWidth={1} />)}
        {ty.map((v) => <line key={'y' + v} x1={M.l} x2={W - M.r} y1={sy(v)} y2={sy(v)} stroke={C.borde} strokeWidth={1} />)}
        <line x1={sx(0)} x2={sx(0)} y1={M.t} y2={H - M.b} stroke={C.gris} strokeWidth={1.5} />
        {tx.map((v) => <text key={'tx' + v} x={sx(v)} y={H - M.b + 18} fontSize={12} textAnchor="middle" fill={C.gris}>{num(v)}</text>)}
        {ty.map((v) => <text key={'ty' + v} x={M.l - 8} y={sy(v) + 4} fontSize={12} textAnchor="end" fill={C.gris}>{num(v)}</text>)}
        <text x={(M.l + W - M.r) / 2} y={H - 6} fontSize={12} textAnchor="middle" fill={C.gris}>Certificación neta (M Gs)</text>
        <text x={14} y={(M.t + H - M.b) / 2} fontSize={12} textAnchor="middle" fill={C.gris} transform={`rotate(-90 14 ${(M.t + H - M.b) / 2})`}>Combustible SAP (L)</text>
        {orden.map((p) => {
          const cx = sx(p.gs / 1e6), cy = sy(p.lit)
          const pend = p.estado === 'pendiente', rev = p.estado === 'revisada'
          return (
            <g key={p.equipo} style={{ cursor: 'pointer' }} onClick={() => onElegir(p.equipo)}
              onMouseEnter={() => setHover({ p, cx, cy })} onMouseLeave={() => setHover(null)}>
              <circle cx={cx} cy={cy} r={14} fill="transparent" />
              <circle cx={cx} cy={cy} r={pend ? 6 : 5} fill={pend ? C.rojo : rev ? '#fff' : GRIS_PUNTO}
                stroke={pend ? '#fff' : rev ? C.gris : '#fff'} strokeWidth={2} />
              {(pend || p.gs < 0) && (
                <text x={cx > W - 90 ? cx - 9 : cx + 9} y={cy + 4} fontSize={11} fill={C.texto}
                  textAnchor={cx > W - 90 ? 'end' : 'start'}>{p.equipo}</text>
              )}
            </g>
          )
        })}
      </svg>
      {hover && (
        <div style={{ position: 'absolute', left: `${(hover.cx / W) * 100}%`, top: `${(hover.cy / H) * 100}%`,
          transform: 'translate(-50%, calc(-100% - 12px))', background: '#111827', color: '#fff', borderRadius: 8,
          padding: '6px 10px', fontSize: 12, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 3 }}>
          <b>{hover.p.equipo}</b> {hover.p.denom}<br />
          Certificado {mGs(hover.p.gs)} Gs · {lts(hover.p.lit)}
          {hover.p.terceros && <> · terceros</>}
          {hover.p.estado === 'pendiente' && <><br />⚠ {hover.p.alarmas.map((a) => ALARMAS[a].label).join(' · ')}</>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: C.gris, marginTop: 4 }}>
        <span><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill={C.rojo} /></svg> Alarma sin revisar</span>
        <span><svg width="12" height="12"><circle cx="6" cy="6" r="4" fill="#fff" stroke={C.gris} strokeWidth="2" /></svg> Revisada</span>
        <span><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill={GRIS_PUNTO} /></svg> Sin alarma</span>
      </div>
    </div>
  )
}

// Formulario "Revisado": nota obligatoria + alcance
function Revisar({ fila, anio, onHecho, onCancelar }) {
  const [nota, setNota] = useState('')
  const [alcance, setAlcance] = useState('mes')
  const [guardando, setGuardando] = useState(false)
  const valido = nota.trim().length >= 3
  async function guardar() {
    if (!valido || guardando) return
    setGuardando(true)
    const { error } = await supabase.rpc('uso_cc_revisar', {
      p_equipo: fila.equipo, p_alarma: fila.alarma, p_alcance: alcance, p_anio: anio, p_mes: fila.mes, p_nota: nota.trim(),
    })
    setGuardando(false)
    if (error) { toast('❌ ' + error.message, 'error'); return }
    toast('✅ Marcado como revisado', 'success')
    onHecho()
  }
  return (
    <div style={{ background: C.fondo, borderRadius: 8, padding: 10, marginTop: 6 }}>
      <textarea autoFocus value={nota} onChange={(e) => setNota(e.target.value)} rows={2}
        placeholder="Qué pasa (ej.: eléctrico · alquiler, combustible del cliente · pedir factura a X)"
        style={{ ...s.input, fontFamily: 'inherit', resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '8px 0', fontSize: 14 }}>
        <label><input type="radio" checked={alcance === 'mes'} onChange={() => setAlcance('mes')} /> Solo {MESES[fila.mes - 1]} {anio}</label>
        <label><input type="radio" checked={alcance === 'siempre'} onChange={() => setAlcance('siempre')} /> Siempre (no vuelve a saltar)</label>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={s.boton} onClick={onCancelar} disabled={guardando}>Cancelar</button>
        <button style={{ ...s.boton, background: valido ? C.azul : '#9ca3af', color: '#fff', border: 'none', fontWeight: 700 }}
          onClick={guardar} disabled={!valido || guardando}>{guardando ? 'Guardando…' : 'Marcar revisado'}</button>
      </div>
    </div>
  )
}

// Detalle de un equipo: sus alarmas, los hallazgos abiertos del período y el día por día
function Detalle({ equipo, filas, anio, mes, hallazgos, onCerrar, onCambio }) {
  const escritorio = useEscritorio()
  const hoy = hoyPY()
  const desde = mes ? `${anio}-${pad(mes)}-01` : `${anio}-01-01`
  const hastaTeor = mes ? finMes(anio, mes) : `${anio}-12-31`
  const hasta = hastaTeor > hoy ? hoy : hastaTeor
  const [dias, setDias] = useState({ clave: null, filas: [], frescura: null, error: null })
  const [revisando, setRevisando] = useState(null)
  const clave = `${equipo}|${desde}|${hasta}`

  useEffect(() => {
    let vivo = true
    Promise.all([
      supabase.rpc('trabajo_equipo_dias', { p_equipo: equipo, p_desde: desde, p_hasta: hasta }),
      supabase.rpc('trabajo_equipo_frescura'),
    ]).then(([d, f]) => {
      if (!vivo) return
      setDias({ clave, filas: d.data || [], frescura: f.data?.[0] || null, error: (d.error || f.error)?.message || null })
    })
    return () => { vivo = false }
  }, [clave, equipo, desde, hasta])

  const alarmas = filas.filter((r) => r.alarma)
  const hEq = hallazgos.filter((h) => h.equipo === equipo && h.fecha >= desde && h.fecha <= hasta)
  const r0 = filas[0] || {}
  const tot = filas.reduce((a, r) => ({ gs: a.gs + Number(r.cert_gs || 0), lit: a.lit + Number(r.litros || 0) }), { gs: 0, lit: 0 })

  async function anular(id) {
    const { error } = await supabase.rpc('uso_cc_anular', { p_id: id })
    if (error) { toast('❌ ' + error.message, 'error'); return }
    toast('Revisión anulada', 'info')
    onCambio()
  }

  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 2000, display: 'flex',
        alignItems: escritorio ? 'center' : 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: C.fondo, width: '100%', maxWidth: escritorio ? 1100 : '100%', maxHeight: '94vh',
        display: 'flex', flexDirection: 'column', borderRadius: escritorio ? 16 : '18px 18px 0 0' }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${C.borde}`, display: 'flex', gap: 10, background: '#fff',
          borderRadius: escritorio ? '16px 16px 0 0' : '18px 18px 0 0' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{equipo} <span style={{ ...s.meta, fontWeight: 400 }}>{denom(r0)}</span></div>
            <div style={s.meta}>
              {mes ? `${MESES[mes - 1]} ${anio}` : anio} · certificado {mGs(tot.gs)} Gs · combustible {lts(tot.lit)}
              {filas.some((r) => r.terceros) && <> · <span style={s.chip(C.azulBg, C.azul)}>Servicio a terceros</span></>}
            </div>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar"
            style={{ border: 'none', background: '#f3f4f6', borderRadius: 999, width: 36, height: 36, fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: 12, overflowY: 'auto' }}>
          {alarmas.length > 0 && (
            <div style={s.card}>
              <h3 style={s.subtitulo}>Alarmas</h3>
              {alarmas.map((r) => (
                <div key={`${r.mes}${r.alarma}`} style={{ padding: '6px 0', borderBottom: `1px solid ${C.borde}` }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <b>{MESES[r.mes - 1]}</b>
                    <span style={r.revision_id ? s.chip('#f3f4f6', C.gris) : s.chip(C.rojoBg, C.rojo)}>
                      {r.revision_id ? '✓ ' : '⚠ '}{ALARMAS[r.alarma].label}
                    </span>
                    <span style={s.meta}>certificado {mGs(r.cert_gs)} Gs · {lts(r.litros)}</span>
                    <span style={{ flex: 1 }} />
                    {r.revision_id
                      ? <button style={{ ...s.boton, minHeight: 34 }} onClick={() => anular(r.revision_id)}>Deshacer</button>
                      : revisando !== r.mes && <button style={{ ...s.boton, minHeight: 34, color: C.azul, fontWeight: 600 }} onClick={() => setRevisando(r.mes)}>Revisado</button>}
                  </div>
                  {r.revision_id && (
                    <div style={{ ...s.meta, marginTop: 2 }}>
                      “{r.revision_nota}” · {r.revision_alcance === 'siempre' ? 'para siempre' : 'solo este mes'}
                    </div>
                  )}
                  {revisando === r.mes && !r.revision_id && (
                    <Revisar fila={r} anio={anio} onCancelar={() => setRevisando(null)} onHecho={() => { setRevisando(null); onCambio() }} />
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={s.card}>
            <h3 style={s.subtitulo}>Hallazgos abiertos del período · {hEq.length}</h3>
            {!hEq.length ? <div style={s.meta}>Sin hallazgos abiertos de Uso de equipos en el período.</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {hEq.slice(0, 30).map((h) => (
                  <div key={h.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 14 }}>
                    <span style={{ minWidth: 48 }}>{h.fecha.slice(8, 10)}/{h.fecha.slice(5, 7)}</span>
                    <span style={s.chip(TIPOS_HALLAZGO[h.tipo]?.bg || '#f3f4f6', TIPOS_HALLAZGO[h.tipo]?.fg || C.gris)}>{TIPOS_HALLAZGO[h.tipo]?.label || h.tipo}</span>
                    <span style={s.meta}>obra {h.obra} · SAP {num(h.sap_q)} · parte {num(h.parte_q)} {h.unidad || ''}</span>
                  </div>
                ))}
                {hEq.length > 30 && <div style={s.meta}>… y {hEq.length - 30} más (ver en la bandeja de la obra)</div>}
              </div>
            )}
          </div>

          {dias.clave !== clave ? <div style={s.vacio}>Cargando el día por día…</div>
            : dias.error ? <div style={{ ...s.aviso, background: C.rojoBg, color: C.rojo }}>{dias.error}</div>
              : <DetalleDias filas={dias.filas} desde={desde} hasta={hasta} frescura={dias.frescura} escritorio={escritorio} />}
        </div>
      </div>
    </div>
  )
}

export default function CombustibleCertificacion({ hallazgos = [] }) {
  const anioActual = Number(hoyPY().slice(0, 4))
  const [anio, setAnio] = useState(anioActual)
  const [mes, setMes] = useState(0) // 0 = todo el año
  const [res, setRes] = useState({ clave: null, filas: [], error: null })
  const [version, setVersion] = useState(0)
  const [sel, setSel] = useState(null)
  const [verRevisadas, setVerRevisadas] = useState(false)
  const clave = `${anio}|${version}`

  useEffect(() => {
    let vivo = true
    supabase.rpc('uso_cc_datos', { p_anio: anio }).then(({ data, error }) => {
      if (vivo) setRes({ clave, filas: data || [], error: error?.message || null })
    })
    return () => { vivo = false }
  }, [anio, clave])

  const cargando = res.clave !== clave && res.clave?.split('|')[0] !== String(anio)
  const filas = useMemo(() => res.filas.filter((r) => !mes || r.mes === mes), [res.filas, mes])

  // Un punto por equipo (suma de los meses del filtro)
  const puntos = useMemo(() => {
    const m = new Map()
    for (const r of filas) {
      if (!m.has(r.equipo)) m.set(r.equipo, { equipo: r.equipo, denom: denom(r), gs: 0, lit: 0, terceros: false, alarmas: [], pend: false, rev: false })
      const p = m.get(r.equipo)
      p.gs += Number(r.cert_gs || 0); p.lit += Number(r.litros || 0); p.terceros ||= r.terceros
      if (r.alarma) {
        if (!p.alarmas.includes(r.alarma)) p.alarmas.push(r.alarma)
        if (r.revision_id) p.rev = true; else p.pend = true
      }
    }
    return [...m.values()].map((p) => ({ ...p, estado: p.pend ? 'pendiente' : p.rev ? 'revisada' : 'normal' }))
  }, [filas])

  const lista = useMemo(() => filas.filter((r) => r.alarma && (verRevisadas || !r.revision_id))
    .sort((a, b) => (!!a.revision_id - !!b.revision_id) || (a.alarma === 'comb_sin_cert' ? -1 : 1) - (b.alarma === 'comb_sin_cert' ? -1 : 1)
      || Number(b.litros) - Number(a.litros) || Number(b.cert_gs) - Number(a.cert_gs)), [filas, verRevisadas])
  const nPend = filas.filter((r) => r.alarma && !r.revision_id).length
  const nRev = filas.filter((r) => r.alarma && r.revision_id).length

  return (
    <div style={s.card}>
      <div style={s.subtitulo}>Combustible vs certificación</div>
      <div style={{ ...s.meta, marginBottom: 8 }}>
        Un punto por equipo: lo que certificó en SAP (neto, con anulaciones) contra los litros que cargó en SAP.
        Alarmas por mes cerrado desde sep-2026 (antes, las cargas de combustible SAP están incompletas). Tocá un punto o una fila para ver qué pasa.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <select style={{ ...s.input, width: 'auto' }} value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
          {[anioActual, anioActual - 1].map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select style={{ ...s.input, width: 'auto' }} value={mes} onChange={(e) => setMes(Number(e.target.value))}>
          <option value={0}>Todo el año</option>
          {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
      </div>

      {res.error && <div style={{ ...s.aviso, background: C.rojoBg, color: C.rojo }}>No se pudo cargar: {res.error}</div>}
      {cargando ? <div style={s.vacio}>Cargando…</div> : (
        <>
          <Dispersion puntos={puntos} onElegir={setSel} />

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '14px 0 6px' }}>
            <b>Alarmas sin revisar · {num(nPend)}</b>
            <span style={{ flex: 1 }} />
            {nRev > 0 && (
              <label style={{ ...s.meta, display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={verRevisadas} onChange={(e) => setVerRevisadas(e.target.checked)} /> Ver revisadas ({num(nRev)})
              </label>
            )}
          </div>
          {!lista.length ? <div style={s.meta}>Sin alarmas{mes ? ' en el mes' : ''}.</div> : (
            <div style={s.scroll}>
              <table style={s.tabla}>
                <thead>
                  <tr>
                    <th style={s.th}>Equipo</th><th style={s.th}>Mes</th><th style={s.th}>Alarma</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>Certificado</th><th style={{ ...s.th, textAlign: 'right' }}>Combustible</th><th style={s.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((r) => (
                    <tr key={`${r.equipo}${r.mes}${r.alarma}`} style={{ cursor: 'pointer', opacity: r.revision_id ? 0.6 : 1 }} onClick={() => setSel(r.equipo)}>
                      <td style={s.td}><b>{r.equipo}</b> <span style={s.meta}>{denom(r)}</span></td>
                      <td style={s.td}>{MESES[r.mes - 1]}</td>
                      <td style={s.td}>
                        <span style={r.revision_id ? s.chip('#f3f4f6', C.gris) : s.chip(C.rojoBg, C.rojo)}>{ALARMAS[r.alarma].corto}</span>
                        {r.terceros && <span style={{ ...s.chip(C.azulBg, C.azul), marginLeft: 4 }}>Terceros</span>}
                        {r.revision_id && <div style={s.meta}>“{r.revision_nota}”</div>}
                      </td>
                      <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>{mGs(r.cert_gs)} Gs</td>
                      <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>{lts(r.litros)}</td>
                      <td style={{ ...s.td, color: C.azul, fontWeight: 600, whiteSpace: 'nowrap' }}>Ver →</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {sel && (
        <Detalle equipo={sel} anio={anio} mes={mes || null} hallazgos={hallazgos}
          filas={res.filas.filter((r) => r.equipo === sel && (!mes || r.mes === mes))}
          onCerrar={() => setSel(null)} onCambio={() => setVersion((v) => v + 1)} />
      )}
    </div>
  )
}
