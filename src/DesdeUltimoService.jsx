import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from './lib/supabase'
import { toast } from './utils/ui'

// ============================================================
// DESDE EL ÚLTIMO SERVICE — solo lectura
// Equipos que trabajan (carga de combustible o uso en rastreo en 6 meses, o mantenimiento cargado)
// con el último mantenimiento (ficha de mantenimiento cargada en la inspección) y el trabajo
// desde entonces por dos fuentes, para que la encargada de preventivo compare y decida:
//   · por contador: última carga de combustible − contador del mantenimiento
//   · por rastreo (Monitor): horas de marcha, ralentí y km sumados desde el día siguiente al mantenimiento
// Datos: RPC service_desde_ultimo / service_frescura (ver supabase/desde_ultimo_service.sql)
// ============================================================

const C = {
  acento: '#7c3aed', acentoBg: '#ede9fe', fondo: '#f9fafb', borde: '#e5e7eb', gris: '#6b7280', texto: '#111827',
  rojo: '#b91c1c', ambar: '#b45309', ambarBg: '#fef3c7',
}
const s = {
  wrap: { maxWidth: 1250, margin: '0 auto', padding: '16px 16px 48px' },
  header: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 },
  boton: { background: 'white', border: `1px solid ${C.borde}`, borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 14 },
  input: { padding: '8px 10px', border: `1px solid ${C.borde}`, borderRadius: 8, fontSize: 14, background: 'white', minWidth: 0 },
  th: { position: 'sticky', top: 0, background: '#f3f4f6', textAlign: 'left', padding: '8px 10px', fontSize: 12, whiteSpace: 'nowrap', borderBottom: `1px solid ${C.borde}`, zIndex: 1 },
  td: { padding: '8px 10px', fontSize: 13, borderBottom: `1px solid ${C.borde}`, verticalAlign: 'top' },
  sub: { fontSize: 11, color: C.gris, marginTop: 2 },
}
const PAGINA = 1000

const fechaCorta = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—')
const num = (v, dec = 0) => (v == null ? '—' : Number(v).toLocaleString('es-PY', { maximumFractionDigits: dec }))

// Para ordenar: mayor trabajo conocido desde el mantenimiento (contador o motor del rastreo)
function trabajo(r) {
  const vals = []
  if (r.por_contador != null && (!r.carga_fecha || !r.service_fecha || r.carga_fecha >= r.service_fecha)) vals.push(Number(r.por_contador))
  if (r.rastreo_horas != null) vals.push(Number(r.rastreo_horas) + Number(r.rastreo_ralenti || 0))
  return vals.length ? Math.max(...vals) : -1
}

function CeldaService({ r }) {
  if (!r.service_fecha) return <span style={{ color: C.gris }}>sin dato</span>
  return (
    <>
      <div><b>{num(r.service_contador, 1)}</b> · {fechaCorta(r.service_fecha)}</div>
      <div style={s.sub}>inspección {fechaCorta(r.service_inspeccion_fecha)}{r.service_inspector ? ` · ${r.service_inspector}` : ''}</div>
    </>
  )
}

function CeldaContador({ r }) {
  if (r.carga_lectura == null) return <span style={{ color: C.gris }}>sin carga con contador</span>
  const anterior = r.service_fecha && r.carga_fecha && r.carga_fecha < r.service_fecha
  const negativo = r.por_contador != null && Number(r.por_contador) < 0
  return (
    <>
      {r.por_contador != null && !anterior && (
        <div style={{ fontWeight: 700, color: negativo ? C.rojo : C.texto }}>+{num(r.por_contador, 1)}</div>
      )}
      <div style={s.sub}>última carga {fechaCorta(r.carga_fecha)}: {num(r.carga_lectura, 1)}</div>
      {anterior && <div style={{ ...s.sub, color: C.ambar }}>la carga es anterior al mantenimiento</div>}
      {negativo && !anterior && <div style={{ ...s.sub, color: C.rojo }}>menor que el contador del mantenimiento: revisar</div>}
    </>
  )
}

function CeldaRastreo({ r }) {
  if (!r.tiene_rastreo) return <span style={{ color: C.gris }}>sin rastreo</span>
  if (!r.service_fecha) return <span style={{ color: C.gris }}>con rastreo · falta el mantenimiento</span>
  const motor = Number(r.rastreo_horas || 0) + Number(r.rastreo_ralenti || 0)
  return (
    <>
      <div style={{ fontWeight: 700 }}>{num(motor, 1)} h motor</div>
      <div style={s.sub}>{num(r.rastreo_horas, 1)} h marcha · {num(r.rastreo_ralenti, 1)} h ralentí · {num(r.rastreo_km, 0)} km</div>
      <div style={s.sub}>hasta {fechaCorta(r.rastreo_ultimo_dia)}</div>
      {r.rastreo_completo === false && (
        <div style={{ ...s.sub, color: C.ambar }}>el rastreo arranca el {fechaCorta(r.rastreo_desde)}: faltan días</div>
      )}
    </>
  )
}

export default function DesdeUltimoService({ onVolver }) {
  const [filas, setFilas] = useState([])
  const [frescura, setFrescura] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [ubicacion, setUbicacion] = useState('')
  const [dato, setDato] = useState('todos') // todos | con | sin

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const todas = []
      for (let desde = 0; ; desde += PAGINA) {
        const { data, error } = await supabase.rpc('service_desde_ultimo').range(desde, desde + PAGINA - 1)
        if (error) throw error
        todas.push(...(data || []))
        if (!data || data.length < PAGINA) break
      }
      const f = await supabase.rpc('service_frescura')
      if (f.error) throw f.error
      setFilas(todas)
      setFrescura((f.data || [])[0] || null)
    } catch (e) {
      console.error(e)
      toast('❌ Error al cargar: ' + e.message, 'error')
    } finally {
      setCargando(false)
    }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const ubicaciones = useMemo(
    () => [...new Set(filas.map((r) => r.ubicacion).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [filas])

  const conService = useMemo(() => filas.filter((r) => r.service_fecha).length, [filas])

  const vista = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return filas
      .filter((r) => !ubicacion || r.ubicacion === ubicacion)
      .filter((r) => dato === 'todos' || (dato === 'con' ? !!r.service_fecha : !r.service_fecha))
      .filter((r) => !q || [r.equipo, r.denominacion, r.ubicacion].some((v) => (v || '').toLowerCase().includes(q)))
      .map((r) => ({ ...r, _t: trabajo(r) }))
      .sort((a, b) => {
        const sa = a.service_fecha ? 1 : 0, sb = b.service_fecha ? 1 : 0
        if (sa !== sb) return sb - sa          // primero los que tienen mantenimiento
        if (b._t !== a._t) return b._t - a._t  // más trabajo acumulado primero
        return a.equipo.localeCompare(b.equipo)
      })
  }, [filas, busqueda, ubicacion, dato])

  return (
    <div style={{ minHeight: '100vh', background: C.fondo, color: C.texto }}>
      <div style={s.wrap}>
        <div style={s.header}>
          <button style={s.boton} onClick={onVolver} aria-label="Volver">←</button>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Desde el último mantenimiento</h2>
            {frescura && (
              <div style={{ fontSize: 12, color: C.gris }}>
                rastreo al {fechaCorta(frescura.rastreo)} · consumos SAP al {fechaCorta(frescura.consumos)} · IE36 al {fechaCorta(frescura.ie36)}
              </div>
            )}
          </div>
          <button style={{ ...s.boton, color: C.acento, fontWeight: 600 }} onClick={cargar} disabled={cargando}>
            {cargando ? 'Cargando…' : '↻ Refrescar'}
          </button>
        </div>

        <p style={{ color: C.gris, fontSize: 13, marginTop: 0 }}>
          El último mantenimiento sale de la ficha de mantenimiento de las inspecciones o de la carga en Gestión de Equipos (🔧 Mantenimiento). El trabajo desde entonces se muestra
          por dos fuentes para comparar: <b>por contador</b> (última carga de combustible SAP menos el contador del mantenimiento) y{' '}
          <b>por rastreo</b> (horas de motor y km de Monitor desde el día siguiente al mantenimiento).
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <input style={{ ...s.input, flex: '1 1 200px' }} placeholder="Buscar equipo, denominación…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          <select style={{ ...s.input, flex: '1 1 200px' }} value={ubicacion} onChange={(e) => setUbicacion(e.target.value)}>
            <option value="">Todas las ubicaciones</option>
            {ubicaciones.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <div style={{ display: 'flex', border: `1px solid ${C.borde}`, borderRadius: 8, overflow: 'hidden' }}>
            {[['todos', `Todos (${filas.length})`], ['con', `Con mantenimiento (${conService})`], ['sin', `Sin dato (${filas.length - conService})`]].map(([k, l]) => (
              <button key={k} onClick={() => setDato(k)}
                style={{ border: 'none', padding: '8px 12px', fontSize: 13, cursor: 'pointer', background: dato === k ? C.acento : 'white', color: dato === k ? 'white' : C.texto }}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflow: 'auto', maxHeight: '70vh', border: `1px solid ${C.borde}`, borderRadius: 8, background: 'white' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 820 }}>
            <thead>
              <tr>
                {['Equipo', 'Ubicación', 'Último mantenimiento (ficha)', 'Por contador', 'Por rastreo'].map((h) => <th key={h} style={s.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {vista.map((r) => (
                <tr key={r.equipo}>
                  <td style={s.td}>
                    <div style={{ fontWeight: 600 }}>{r.equipo}</div>
                    {r.denominacion && <div style={s.sub}>{r.denominacion.replace(/^\S+\s+/, '').trim()}</div>}
                  </td>
                  <td style={{ ...s.td, fontSize: 12 }}>{r.ubicacion || '—'}</td>
                  <td style={s.td}><CeldaService r={r} /></td>
                  <td style={s.td}><CeldaContador r={r} /></td>
                  <td style={s.td}><CeldaRastreo r={r} /></td>
                </tr>
              ))}
              {!vista.length && (
                <tr><td colSpan={5} style={{ ...s.td, textAlign: 'center', color: C.gris, padding: 24 }}>
                  {cargando ? 'Cargando…' : 'No hay equipos con ese filtro.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {conService === 0 && !cargando && (
          <p style={{ fontSize: 13, color: C.ambar, background: C.ambarBg, padding: '8px 12px', borderRadius: 8 }}>
            Todavía no hay mantenimientos cargados: se van sumando con la ficha de mantenimiento de las inspecciones y con la carga en Gestión de Equipos.
          </p>
        )}
      </div>
    </div>
  )
}
