import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { toast } from '../utils/ui'

// ============================================================
// Pestaña «Insumos» de la Bandeja de preventivos (28/11/2026).
// Qué insumos necesitan los próximos mantenimientos preventivos, por centro y material, contra el stock:
// necesario · stock · gap (lo que falta comprar o traer) · stock en 1002. Tocar un insumo despliega las órdenes
// y equipos que lo usan. Excel para compartir con Depósito.
// Universo y reglas: RPC ip30_insumos() (supabase/bandeja_insumos.sql): órdenes Programado abiertas + equipos
// próximos (parte diario, o telemetría JD/CAT si tiene lectura de 7 días; ≤ 70 h / 1.000 km).
// ============================================================

const C = {
  azul: '#0f766e', azulBg: '#ccfbf1', borde: '#e5e7eb', gris: '#6b7280', texto: '#111827',
  rojo: '#b91c1c', rojoBg: '#fee2e2', ambar: '#b45309', ambarBg: '#fef3c7', violeta: '#6d28d9', violetaBg: '#ede9fe',
}
const s = {
  input: { padding: '8px 10px', border: `1px solid ${C.borde}`, borderRadius: 8, fontSize: 14, background: 'white', minWidth: 0 },
  boton: { background: 'white', border: `1px solid ${C.borde}`, borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 14 },
  th: { position: 'sticky', top: 0, background: '#f3f4f6', textAlign: 'left', padding: '8px 10px', fontSize: 12, whiteSpace: 'nowrap', borderBottom: `1px solid ${C.borde}`, zIndex: 1 },
  td: { padding: '8px 10px', fontSize: 13, borderBottom: `1px solid ${C.borde}`, verticalAlign: 'top' },
  sub: { fontSize: 11, color: C.gris, marginTop: 2 },
  badge: { borderRadius: 6, padding: '1px 6px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-block', marginRight: 4 },
}
const PAGINA = 1000
const num = (v, dec = 1) => (v == null ? '—' : Number(v).toLocaleString('es-PY', { maximumFractionDigits: dec }))
const fecha = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—')
const FUENTE_LECTURA = { parte: 'parte', jd: 'JD', cat: 'CAT' }

function textoMotivo(d) {
  if (d.motivo === 'programado') return 'Programado'
  const u = d.falta_unidad === 'km' ? 'km' : 'h'
  const f = Number(d.falta)
  const t = f < 0 ? `pasado ${num(-f)} ${u}` : `falta ${num(f)} ${u}`
  return `Próximo · ${t} (${FUENTE_LECTURA[d.lectura_fuente] || d.lectura_fuente || '—'})`
}
const textoOrigen = (d) => (d.fuente_insumo === 'reserva' ? 'reserva SAP' : `propuesta de ${d.orden_origen}`)

async function leerTodo() {
  const todas = []
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await supabase.rpc('ip30_insumos').range(desde, desde + PAGINA - 1)
    if (error) throw error
    todas.push(...(data || []))
    if (!data || data.length < PAGINA) break
  }
  return todas
}

function exportar(lineas, sinInsumos, corte) {
  const hoy = new Date()
  const f = `${String(hoy.getDate()).padStart(2, '0')}.${String(hoy.getMonth() + 1).padStart(2, '0')}.${hoy.getFullYear()}`
  const resumen = lineas.map((l) => ({
    Centro: l.centro || '', Material: l.material, Descripción: l.descripcion || '', Unidad: l.unidad || '',
    Necesario: l.necesario, Stock: l.stock, Gap: l.gap, 'Stock 1002': l.gap > 0 && l.centro !== '1002' ? l.stock_1002 : '',
    Mantenimientos: l.detalle.length,
  }))
  const detalle = lineas.flatMap((l) => l.detalle.map((d) => ({
    Centro: l.centro || '', Material: l.material, Descripción: l.descripcion || '', Cantidad: Number(d.cantidad), Unidad: d.unidad || '',
    Equipo: d.equipo, Ubicación: d.ubicacion || '', Orden: d.orden || 'sin orden', 'Fecha plan': fecha(d.fecha_plan),
    Motivo: textoMotivo(d), Insumo: textoOrigen(d),
  })))
  const sin = sinInsumos.map((d) => ({ Equipo: d.equipo, Ubicación: d.ubicacion || '', Orden: d.orden || 'sin orden', Motivo: textoMotivo(d) }))
  const wb = XLSX.utils.book_new()
  for (const [titulo, filas, anchos] of [
    ['Insumos', resumen, [8, 16, 40, 7, 11, 9, 9, 10, 15]],
    ['Detalle', detalle, [8, 16, 40, 9, 7, 12, 30, 11, 11, 34, 22]],
    ['Sin insumos pendientes', sin, [12, 30, 11, 34]],
  ]) {
    const ws = XLSX.utils.json_to_sheet(filas.length ? filas : [{ '': 'Sin datos' }])
    ws['!cols'] = anchos.map((w) => ({ wch: w }))
    if (filas.length && ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] }
    XLSX.utils.book_append_sheet(wb, ws, titulo)
  }
  XLSX.writeFile(wb, `Insumos preventivos ${f}${corte ? ` (stock al ${fecha(corte).replaceAll('/', '.')})` : ''}.xlsx`)
}

export default function Insumos() {
  const [filas, setFilas] = useState(null)
  const [centro, setCentro] = useState('')
  const [soloGap, setSoloGap] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [abierto, setAbierto] = useState(null)

  useEffect(() => {
    leerTodo().then(setFilas).catch((e) => { console.error(e); toast('❌ No se pudieron calcular los insumos: ' + e.message, 'error'); setFilas([]) })
  }, [])

  const { lineas, sinInsumos, corte, nEquipos } = useMemo(() => {
    const m = new Map()
    const sin = []
    const eqs = new Set()
    let corteF = null
    for (const r of filas || []) {
      eqs.add(r.equipo)
      if (r.stock_corte) corteF = r.stock_corte
      if (!r.material) { sin.push(r); continue }
      const k = `${r.centro}|${r.material}`
      let l = m.get(k)
      if (!l) {
        l = { key: k, centro: r.centro, material: r.material, descripcion: r.descripcion, unidad: r.unidad, necesario: 0,
          stock: Number(r.stock || 0), stock_1002: Number(r.stock_1002 || 0), detalle: [] }
        m.set(k, l)
      }
      l.necesario += Number(r.cantidad || 0)
      l.detalle.push(r)
    }
    const ls = [...m.values()].map((l) => ({ ...l, necesario: Math.round(l.necesario * 1000) / 1000, gap: Math.max(0, Math.round((l.necesario - l.stock) * 1000) / 1000) }))
    ls.forEach((l) => l.detalle.sort((a, b) => String(a.equipo).localeCompare(String(b.equipo))))
    ls.sort((a, b) => (b.gap > 0) - (a.gap > 0) || String(a.centro).localeCompare(String(b.centro)) || b.gap - a.gap || String(a.material).localeCompare(String(b.material)))
    sin.sort((a, b) => String(a.equipo).localeCompare(String(b.equipo)))
    return { lineas: ls, sinInsumos: sin, corte: corteF, nEquipos: eqs.size }
  }, [filas])

  const centros = useMemo(() => [...new Set(lineas.map((l) => l.centro || '—'))].sort(), [lineas])
  const vista = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return lineas.filter((l) => (!centro || (l.centro || '—') === centro) && (!soloGap || l.gap > 0)
      && (!q || [l.material, l.descripcion, ...l.detalle.map((d) => d.equipo)].some((v) => (v || '').toLowerCase().includes(q))))
  }, [lineas, centro, soloGap, busqueda])

  if (filas === null) return <div style={{ padding: 24, textAlign: 'center', color: C.gris }}>Calculando insumos…</div>

  const conGap = vista.filter((l) => l.gap > 0).length
  return (
    <div>
      <p style={{ fontSize: 13, color: C.gris, margin: '0 0 8px' }}>
        Insumos de los próximos mantenimientos preventivos: órdenes <b>Programado</b> abiertas y equipos <b>próximos</b> (parte diario, o
        telemetría JD/CAT si tiene lectura de los últimos 7 días; faltan ≤ 70 h / 1.000 km). Si la orden tiene reserva en SAP cuenta lo pendiente;
        si no, la propuesta de su preventiva anterior. Gap = necesario − stock. {nEquipos} equipos ·{' '}
        <b style={{ color: C.ambar }}>stock al {fecha(corte)}</b>.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <input style={{ ...s.input, flex: '1 1 200px' }} placeholder="Buscar material, descripción o equipo…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        <select style={s.input} value={centro} onChange={(e) => setCentro(e.target.value)} aria-label="Centro">
          <option value="">Todos los centros</option>
          {centros.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={soloGap} onChange={(e) => setSoloGap(e.target.checked)} /> Solo con gap
        </label>
        <span style={{ fontSize: 13, color: C.gris }}>{vista.length} insumos · {conGap} con gap</span>
        <span style={{ flex: 1 }} />
        <button style={{ ...s.boton, color: C.azul, fontWeight: 600 }} onClick={() => exportar(vista, sinInsumos, corte)}>⬇ Excel</button>
      </div>

      <div style={{ overflow: 'auto', maxHeight: '64vh', border: `1px solid ${C.borde}`, borderRadius: 8, background: 'white' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 820 }}>
          <thead>
            <tr>{['Centro', 'Insumo', 'Necesario', 'Stock', 'Gap', 'En 1002', 'Mant.'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {vista.map((l) => {
              const ab = abierto === l.key
              return [
                <tr key={l.key} onClick={() => setAbierto(ab ? null : l.key)} style={{ cursor: 'pointer', background: l.gap > 0 ? '#fff7f7' : undefined }}>
                  <td style={s.td}>{l.centro || '—'}</td>
                  <td style={s.td}>
                    <span style={{ color: C.azul }}>{ab ? '▾' : '▸'}</span> <b>{l.material}</b>
                    <div style={s.sub}>{l.descripcion}</div>
                  </td>
                  <td style={s.td}>{num(l.necesario, 3)} {l.unidad}</td>
                  <td style={s.td}>{num(l.stock, 3)}</td>
                  <td style={s.td}>{l.gap > 0 ? <span style={{ ...s.badge, background: C.rojoBg, color: C.rojo, fontSize: 12 }}>{num(l.gap, 3)}</span> : <span style={{ color: C.gris }}>—</span>}</td>
                  <td style={s.td}>{l.gap > 0 && l.centro !== '1002' ? num(l.stock_1002, 3) : ''}</td>
                  <td style={s.td}>{l.detalle.length}</td>
                </tr>,
                ab && (
                  <tr key={l.key + '-d'}>
                    <td colSpan={7} style={{ ...s.td, background: '#f9fafb', padding: '6px 10px 10px 34px' }}>
                      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                        <thead><tr>{['Equipo', 'Orden', 'Cant.', 'Motivo', 'Insumo', 'Fecha plan'].map((h) => <th key={h} style={{ ...s.th, position: 'static', background: 'transparent' }}>{h}</th>)}</tr></thead>
                        <tbody>
                          {l.detalle.map((d, i) => (
                            <tr key={i}>
                              <td style={s.td}><b>{d.equipo}</b><div style={s.sub}>{d.ubicacion || '—'}</div></td>
                              <td style={s.td}>{d.orden || <span style={{ color: C.gris }}>sin orden</span>}</td>
                              <td style={s.td}>{num(d.cantidad, 3)} {d.unidad}</td>
                              <td style={s.td}>
                                <span style={{ ...s.badge, ...(d.motivo === 'programado' ? { background: C.azulBg, color: C.azul } : { background: C.ambarBg, color: C.ambar }) }}>{textoMotivo(d)}</span>
                              </td>
                              <td style={s.td}>{d.fuente_insumo === 'reserva'
                                ? <span style={{ ...s.badge, background: '#dcfce7', color: '#15803d' }}>reserva SAP</span>
                                : <span style={{ ...s.badge, background: C.violetaBg, color: C.violeta }}>propuesta de {d.orden_origen}</span>}</td>
                              <td style={s.td}>{fecha(d.fecha_plan)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                ),
              ]
            })}
            {!vista.length && <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', color: C.gris, padding: 24 }}>No hay insumos con ese filtro.</td></tr>}
          </tbody>
        </table>
      </div>

      {sinInsumos.length > 0 && (
        <details style={{ marginTop: 10, fontSize: 13 }}>
          <summary style={{ cursor: 'pointer', color: C.ambar, fontWeight: 600 }}>Sin insumos pendientes ({sinInsumos.length}): sin reserva ni preventiva anterior con reserva, o la reserva ya se retiró completa</summary>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {sinInsumos.map((d) => (
              <li key={d.equipo}><b>{d.equipo}</b> · {d.ubicacion || '—'} · {d.orden ? `orden ${d.orden}` : 'sin orden'} · {textoMotivo(d)}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
