import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from './lib/supabase'
import { toast } from './utils/ui'
import ServicesEquipoModal from './ServicesEquipoModal.jsx'

// ============================================================
// DESDE EL ÚLTIMO SERVICE — solo lectura
// Equipos que trabajan (carga de combustible o uso en rastreo en 6 meses, o mantenimiento cargado)
// con el último mantenimiento (ficha de mantenimiento cargada en la inspección) y el trabajo
// desde entonces por dos fuentes, para que la encargada de preventivo compare y decida:
//   · por contador: última carga de combustible − contador del mantenimiento
//   · por rastreo (Monitor): horas de marcha, ralentí y km sumados desde el día siguiente al mantenimiento
// Con período de mantenimiento cargado (Gestión de Equipos) muestra cuánto falta / cuánto se pasó.
// Datos: RPC mantenimiento_seguimiento / service_frescura (ver supabase/periodo_mantenimiento.sql)
// ============================================================

const C = {
  acento: '#7c3aed', acentoBg: '#ede9fe', fondo: '#f9fafb', borde: '#e5e7eb', gris: '#6b7280', texto: '#111827',
  rojo: '#b91c1c', rojoBg: '#fee2e2', ambar: '#b45309', ambarBg: '#fef3c7', verde: '#15803d', verdeBg: '#dcfce7',
}
const UMBRAL_AVISO = 0.1 // ámbar cuando falta el 10 % del período o menos
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

// Cuánto falta para el próximo mantenimiento, por cada fuente (null si no se puede calcular)
function proximo(r) {
  if (!r.periodo || !r.service_fecha) return null
  const p = Number(r.periodo)
  const fuentes = []
  const cargaAnterior = r.carga_fecha && r.carga_fecha < r.service_fecha
  if (r.por_contador != null && !cargaAnterior) fuentes.push({ fuente: 'contador', falta: p - Number(r.por_contador) })
  if (r.tiene_rastreo && r.rastreo_horas != null) {
    const usado = r.periodo_unidad === 'km' ? Number(r.rastreo_km || 0) : Number(r.rastreo_horas || 0) + Number(r.rastreo_ralenti || 0)
    fuentes.push({ fuente: 'rastreo', falta: p - usado })
  }
  if (!fuentes.length) return { fuentes, estado: 'sin', peor: null }
  const peor = Math.min(...fuentes.map((x) => x.falta))
  const estado = peor < 0 ? 'rojo' : peor <= p * UMBRAL_AVISO ? 'ambar' : 'verde'
  return { fuentes, estado, peor }
}
const RANGO_ESTADO = { rojo: 0, ambar: 1, verde: 2, sin: 3 }

function CeldaProximo({ r, px }) {
  if (!r.periodo) return <span style={{ color: C.gris }}>sin período</span>
  const u = r.periodo_unidad === 'km' ? 'km' : 'h'
  const cab = <div style={s.sub}>cada {num(r.periodo)} {u}</div>
  if (!r.service_fecha) return <>{cab}<span style={{ color: C.gris }}>falta el último mantenimiento</span></>
  if (!px || !px.fuentes.length) return <>{cab}<span style={{ color: C.gris }}>sin datos de uso</span></>
  return (
    <>
      {px.fuentes.map((f) => (
        <div key={f.fuente} style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 2 }}>
          <span style={{ background: f.falta < 0 ? C.rojoBg : f.falta <= Number(r.periodo) * UMBRAL_AVISO ? C.ambarBg : C.verdeBg,
            color: f.falta < 0 ? C.rojo : f.falta <= Number(r.periodo) * UMBRAL_AVISO ? C.ambar : C.verde,
            borderRadius: 10, padding: '1px 8px', fontWeight: 700, whiteSpace: 'nowrap' }}>
            {f.falta < 0 ? `pasado ${num(-f.falta, 1)} ${u}` : `falta ${num(f.falta, 1)} ${u}`}
          </span>
          <span style={{ fontSize: 11, color: C.gris }}>{f.fuente}</span>
        </div>
      ))}
      {cab}
    </>
  )
}

function CeldaService({ r }) {
  if (!r.service_fecha) return <span style={{ color: C.gris }}>sin dato</span>
  return (
    <>
      <div><b>{num(r.service_contador, 1)}</b> · {fechaCorta(r.service_fecha)}</div>
      <div style={s.sub}>cargado {fechaCorta(r.service_inspeccion_fecha)}{r.service_inspector ? ` · ${r.service_inspector}` : ''}</div>
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
  const [dato, setDato] = useState('todos') // todos | con | sin | sinper
  const [equipoModal, setEquipoModal] = useState(null) // equipo de la app (tabla equipos) para cargar mantenimiento/período
  const [abriendo, setAbriendo] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const todas = []
      for (let desde = 0; ; desde += PAGINA) {
        const { data, error } = await supabase.rpc('mantenimiento_seguimiento').range(desde, desde + PAGINA - 1)
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

  // La fila viene por ID técnico (SAP); la ventana necesita el equipo de la app (Gestión de Equipos)
  async function abrirCarga(r) {
    setAbriendo(r.equipo)
    const { data, error } = await supabase.from('equipos')
      .select('id, numero_identificacion, denominacion')
      .ilike('numero_identificacion', r.equipo)
      .order('activo', { ascending: false })
      .limit(1)
    setAbriendo('')
    if (error) { toast('❌ ' + error.message, 'error'); return }
    if (!data?.length) { toast(`⚠️ ${r.equipo} no está dado de alta en Gestión de Equipos: hay que crearlo ahí primero`, 'warning'); return }
    setEquipoModal(data[0])
  }

  const ubicaciones = useMemo(
    () => [...new Set(filas.map((r) => r.ubicacion).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [filas])

  const conService = useMemo(() => filas.filter((r) => r.service_fecha).length, [filas])
  const sinPeriodo = useMemo(() => filas.filter((r) => !r.periodo).length, [filas])

  const vista = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return filas
      .filter((r) => !ubicacion || r.ubicacion === ubicacion)
      .filter((r) => dato === 'todos' || (dato === 'con' ? !!r.service_fecha : dato === 'sin' ? !r.service_fecha : !r.periodo))
      .filter((r) => !q || [r.equipo, r.denominacion, r.ubicacion].some((v) => (v || '').toLowerCase().includes(q)))
      .map((r) => ({ ...r, _t: trabajo(r), _px: proximo(r) }))
      .sort((a, b) => {
        // primero los vencidos (rojo), después los próximos (ámbar), y dentro de cada uno el que más se pasó / menos le falta
        const ea = RANGO_ESTADO[a._px?.estado ?? 'sin'], eb = RANGO_ESTADO[b._px?.estado ?? 'sin']
        if (ea !== eb) return ea - eb
        if (a._px?.peor != null && b._px?.peor != null && a._px.peor !== b._px.peor) return a._px.peor - b._px.peor
        const sa = a.service_fecha ? 1 : 0, sb = b.service_fecha ? 1 : 0
        if (sa !== sb) return sb - sa          // primero los que tienen mantenimiento
        if (b._t !== a._t) return b._t - a._t  // más trabajo acumulado primero
        return a.equipo.localeCompare(b.equipo)
      })
  }, [filas, busqueda, ubicacion, dato])

  return (
    <div style={{ minHeight: '100vh', background: C.fondo, color: C.texto }}>
      {equipoModal && (
        <ServicesEquipoModal equipo={equipoModal} onCerrar={() => { setEquipoModal(null); cargar() }} />
      )}
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
          <div style={{ display: 'flex', border: `1px solid ${C.borde}`, borderRadius: 8, overflow: 'hidden', flexWrap: 'wrap' }}>
            {[['todos', `Todos (${filas.length})`], ['con', `Con mantenimiento (${conService})`], ['sin', `Sin mantenimiento (${filas.length - conService})`], ['sinper', `Sin período (${sinPeriodo})`]].map(([k, l]) => (
              <button key={k} onClick={() => setDato(k)}
                style={{ border: 'none', padding: '8px 12px', fontSize: 13, cursor: 'pointer', background: dato === k ? C.acento : 'white', color: dato === k ? 'white' : C.texto }}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflow: 'auto', maxHeight: '70vh', border: `1px solid ${C.borde}`, borderRadius: 8, background: 'white' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1060 }}>
            <thead>
              <tr>
                {['', 'Equipo', 'Ubicación', 'Próximo mantenimiento', 'Último mantenimiento', 'Por contador', 'Por rastreo'].map((h) => <th key={h} style={s.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {vista.map((r) => (
                <tr key={r.equipo}>
                  <td style={{ ...s.td, width: 1 }}>
                    <button onClick={() => abrirCarga(r)} disabled={abriendo === r.equipo} title="Cargar último mantenimiento o período"
                      style={{ border: 'none', background: C.acento, color: 'white', borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      {abriendo === r.equipo ? '…' : '🔧 Cargar'}
                    </button>
                  </td>
                  <td style={s.td}>
                    <div style={{ fontWeight: 600 }}>{r.equipo}</div>
                    {r.denominacion && <div style={s.sub}>{r.denominacion.replace(/^\S+\s+/, '').trim()}</div>}
                  </td>
                  <td style={{ ...s.td, fontSize: 12 }}>{r.ubicacion || '—'}</td>
                  <td style={s.td}><CeldaProximo r={r} px={r._px} /></td>
                  <td style={s.td}><CeldaService r={r} /></td>
                  <td style={s.td}><CeldaContador r={r} /></td>
                  <td style={s.td}><CeldaRastreo r={r} /></td>
                </tr>
              ))}
              {!vista.length && (
                <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', color: C.gris, padding: 24 }}>
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
