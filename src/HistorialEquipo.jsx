import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { toast } from './utils/ui'

// Historial de mantenimiento: equipo → órdenes SAP → componentes consumidos.
// Datos vía RPC SECURITY DEFINER (solo rol admin): historial_equipo_ordenes,
// historial_orden_componentes, historial_equipo_materiales, historial_buscar_material.

const C = { azul: '#1d4ed8', gris: '#6b7280', borde: '#e5e7eb', fondo: '#f9fafb', texto: '#111827' }
const CLASES = { TCOC: 'Correctiva', TCPV: 'Preventiva', TCUR: 'Urgencia', TCFA: 'Falla' }

const num = (n) => (n == null ? '–' : Number(n).toLocaleString('es-PY', { maximumFractionDigits: 3 }))
const fecha = (d) => {
  if (!d) return '–'
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y.slice(2)}`
}

const s = {
  wrap: { maxWidth: 960, margin: '0 auto', padding: 12, fontFamily: 'inherit', color: C.texto },
  header: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 },
  volver: { minHeight: 44, minWidth: 44, border: `1px solid ${C.borde}`, background: '#fff', borderRadius: 8, fontSize: 18, cursor: 'pointer' },
  tabs: { display: 'flex', gap: 6, marginBottom: 12 },
  tab: (on) => ({ flex: 1, minHeight: 44, borderRadius: 8, cursor: 'pointer', fontWeight: 600,
    border: `1px solid ${on ? C.azul : C.borde}`, background: on ? C.azul : '#fff', color: on ? '#fff' : C.texto }),
  input: { width: '100%', minHeight: 44, padding: '8px 12px', fontSize: 16, border: `1px solid ${C.borde}`, borderRadius: 8, boxSizing: 'border-box' },
  lista: { border: `1px solid ${C.borde}`, borderRadius: 8, background: '#fff', marginTop: 4, maxHeight: 260, overflowY: 'auto' },
  opcion: { padding: '10px 12px', cursor: 'pointer', borderBottom: `1px solid ${C.borde}` },
  card: { background: '#fff', border: `1px solid ${C.borde}`, borderRadius: 10, marginBottom: 8 },
  fila: { padding: 12, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 },
  meta: { fontSize: 13, color: C.gris },
  chip: (bg, fg) => ({ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: bg, color: fg, fontWeight: 600 }),
  tabla: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: { textAlign: 'left', padding: '6px 8px', background: C.fondo, color: C.gris, fontWeight: 600, borderBottom: `1px solid ${C.borde}` },
  td: { padding: '6px 8px', borderBottom: `1px solid ${C.borde}`, verticalAlign: 'top' },
  vacio: { padding: 24, textAlign: 'center', color: C.gris },
}

function Tabla({ cols, filas }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={s.tabla}>
        <thead><tr>{cols.map((c) => <th key={c.k} style={{ ...s.th, textAlign: c.der ? 'right' : 'left' }}>{c.t}</th>)}</tr></thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i}>{cols.map((c) => (
              <td key={c.k} style={{ ...s.td, textAlign: c.der ? 'right' : 'left', whiteSpace: c.nw ? 'nowrap' : 'normal' }}>
                {c.f ? c.f(f) : f[c.k] ?? '–'}
              </td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SelectorEquipo({ equipos, valor, onElegir }) {
  const [q, setQ] = useState(valor || '')
  const [abierto, setAbierto] = useState(false)
  const filtrados = useMemo(() => {
    const t = q.trim().toUpperCase()
    if (!t) return []
    return equipos.filter((e) => e.numero_identificacion.includes(t) || (e.denominacion || '').toUpperCase().includes(t)).slice(0, 30)
  }, [q, equipos])

  return (
    <div style={{ position: 'relative' }}>
      <input style={s.input} value={q} placeholder="ID técnico o denominación (ej. VL-CN081)"
        onChange={(e) => { setQ(e.target.value); setAbierto(true) }} onFocus={() => setAbierto(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) { onElegir(q.trim().toUpperCase()); setAbierto(false) } }} />
      {abierto && filtrados.length > 0 && (
        <div style={s.lista}>
          {filtrados.map((e) => (
            <div key={e.numero_identificacion} style={s.opcion}
              onClick={() => { setQ(e.numero_identificacion); setAbierto(false); onElegir(e.numero_identificacion) }}>
              <b>{e.numero_identificacion}</b> <span style={s.meta}>{e.denominacion}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function OrdenCard({ o }) {
  const [abierta, setAbierta] = useState(false)
  const [comps, setComps] = useState(null)

  const toggle = async () => {
    const nuevo = !abierta
    setAbierta(nuevo)
    if (nuevo && comps === null) {
      const { data, error } = await supabase.rpc('historial_orden_componentes', { p_orden: o.orden })
      if (error) { toast('Error al cargar componentes: ' + error.message, 'error'); return }
      setComps(data || [])
    }
  }

  return (
    <div style={s.card}>
      <div style={s.fila} onClick={toggle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <b>{o.orden}</b>
          <div style={{ display: 'flex', gap: 6 }}>
            <span style={s.chip(o.clase_orden === 'TCPV' ? '#dbeafe' : '#fef3c7', o.clase_orden === 'TCPV' ? C.azul : '#92400e')}>
              {CLASES[o.clase_orden] || o.clase_orden}
            </span>
            {!o.cerrada && <span style={s.chip('#fee2e2', '#b91c1c')}>Abierta</span>}
          </div>
        </div>
        <div>{o.texto}</div>
        <div style={s.meta}>
          {fecha(o.fecha_entrada)}{o.fecha_fin_real ? ` – fin ${fecha(o.fecha_fin_real)}` : ''} ·{' '}
          {o.n_consumidos}/{o.n_materiales} materiales con consumo {abierta ? '▲' : '▼'}
        </div>
      </div>
      {abierta && (
        <div style={{ padding: '0 12px 12px' }}>
          {comps === null ? <div style={s.meta}>Cargando…</div>
            : comps.length === 0 ? <div style={s.meta}>Esta orden no tiene materiales reservados.</div>
            : <Tabla filas={comps} cols={[
                { k: 'material', t: 'Material', nw: true },
                { k: 'descripcion', t: 'Descripción' },
                { k: 'cantidad_usada', t: 'Usado', der: true, nw: true, f: (r) => `${num(r.cantidad_usada)} ${r.unidad || ''}` },
                { k: 'cantidad_pendiente', t: 'Pend.', der: true, f: (r) => (Number(r.cantidad_pendiente) > 0 ? num(r.cantidad_pendiente) : '–') },
              ]} />}
        </div>
      )}
    </div>
  )
}

function VistaEquipo({ equipos }) {
  const [equipo, setEquipo] = useState('')
  const [sub, setSub] = useState('ordenes')
  const [ordenes, setOrdenes] = useState([])
  const [materiales, setMateriales] = useState([])
  const [cargando, setCargando] = useState(false)
  const [filtroClase, setFiltroClase] = useState('')

  useEffect(() => {
    if (!equipo) return
    let vivo = true
    Promise.all([
      supabase.rpc('historial_equipo_ordenes', { p_equipo: equipo }),
      supabase.rpc('historial_equipo_materiales', { p_equipo: equipo }),
    ]).then(([o, m]) => {
      if (!vivo) return
      if (o.error || m.error) toast('Error al cargar el historial: ' + (o.error || m.error).message, 'error')
      setOrdenes(o.data || [])
      setMateriales(m.data || [])
      setCargando(false)
    })
    return () => { vivo = false }
  }, [equipo])

  const elegirEquipo = (eq) => {
    if (eq !== equipo) setCargando(true)
    setEquipo(eq)
  }

  const visibles = filtroClase ? ordenes.filter((o) => o.clase_orden === filtroClase) : ordenes
  const den = equipos.find((e) => e.numero_identificacion === equipo)?.denominacion

  return (
    <>
      <SelectorEquipo equipos={equipos} valor={equipo} onElegir={elegirEquipo} />
      {!equipo && <div style={s.vacio}>Elegí un equipo para ver sus órdenes y lo que se le cambió.</div>}
      {equipo && (
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 8 }}><b style={{ fontSize: 18 }}>{equipo}</b> <span style={s.meta}>{den}</span></div>
          <div style={s.tabs}>
            <button style={s.tab(sub === 'ordenes')} onClick={() => setSub('ordenes')}>Órdenes ({ordenes.length})</button>
            <button style={s.tab(sub === 'materiales')} onClick={() => setSub('materiales')}>Materiales ({materiales.length})</button>
          </div>
          {cargando ? <div style={s.vacio}>Cargando…</div> : sub === 'ordenes' ? (
            <>
              <select style={{ ...s.input, marginBottom: 8 }} value={filtroClase} onChange={(e) => setFiltroClase(e.target.value)}>
                <option value="">Todas las clases</option>
                {Object.entries(CLASES).map(([k, v]) => <option key={k} value={k}>{v} ({k})</option>)}
              </select>
              {visibles.length === 0 ? <div style={s.vacio}>No hay órdenes para este equipo.</div>
                : visibles.map((o) => <OrdenCard key={o.orden} o={o} />)}
            </>
          ) : materiales.length === 0 ? <div style={s.vacio}>No hay materiales consumidos registrados.</div> : (
            <div style={s.card}>
              <Tabla filas={materiales} cols={[
                { k: 'material', t: 'Material', nw: true },
                { k: 'descripcion', t: 'Descripción' },
                { k: 'cantidad_usada', t: 'Total', der: true, nw: true, f: (r) => `${num(r.cantidad_usada)} ${r.unidad || ''}` },
                { k: 'n_ordenes', t: 'Órdenes', der: true },
                { k: 'ultima', t: 'Última', nw: true, f: (r) => fecha(r.ultima) },
              ]} />
            </div>
          )}
        </div>
      )}
    </>
  )
}

function VistaMaterial() {
  const [q, setQ] = useState('')
  const [res, setRes] = useState(null)
  const [cargando, setCargando] = useState(false)

  const buscar = async () => {
    if (q.trim().length < 3) { toast('Escribí al menos 3 caracteres', 'error'); return }
    setCargando(true)
    const { data, error } = await supabase.rpc('historial_buscar_material', { p_texto: q })
    setCargando(false)
    if (error) { toast('Error en la búsqueda: ' + error.message, 'error'); return }
    setRes(data || [])
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8 }}>
        <input style={s.input} value={q} placeholder="Código de material o texto (ej. filtro aceite)"
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && buscar()} />
        <button style={{ ...s.tab(true), flex: '0 0 96px' }} onClick={buscar}>Buscar</button>
      </div>
      {cargando && <div style={s.vacio}>Buscando…</div>}
      {!cargando && res && res.length === 0 && <div style={s.vacio}>Ese material no aparece consumido en ninguna orden.</div>}
      {!cargando && res && res.length > 0 && (
        <div style={{ ...s.card, marginTop: 12 }}>
          <Tabla filas={res} cols={[
            { k: 'equipo', t: 'Equipo', nw: true, f: (r) => <b>{r.equipo || '–'}</b> },
            { k: 'fecha_entrada', t: 'Fecha', nw: true, f: (r) => fecha(r.fecha_entrada) },
            { k: 'orden', t: 'Orden', nw: true },
            { k: 'descripcion', t: 'Material' },
            { k: 'cantidad_usada', t: 'Usado', der: true, nw: true, f: (r) => `${num(r.cantidad_usada)} ${r.unidad || ''}` },
          ]} />
          {res.length === 300 && <div style={{ ...s.meta, padding: 8 }}>Se muestran los 300 más recientes. Afiná la búsqueda.</div>}
        </div>
      )}
    </>
  )
}

export default function HistorialEquipo({ onVolver }) {
  const [tab, setTab] = useState('equipo')
  const [equipos, setEquipos] = useState([])

  useEffect(() => {
    supabase.from('equipos').select('numero_identificacion, denominacion').order('numero_identificacion').limit(2000)
      .then(({ data, error }) => {
        if (error) toast('Error al cargar equipos: ' + error.message, 'error')
        setEquipos(data || [])
      })
  }, [])

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <button style={s.volver} onClick={onVolver} aria-label="Volver">←</button>
        <h2 style={{ margin: 0, fontSize: 20 }}>Historial de equipos</h2>
      </div>
      <div style={s.tabs}>
        <button style={s.tab(tab === 'equipo')} onClick={() => setTab('equipo')}>Por equipo</button>
        <button style={s.tab(tab === 'material')} onClick={() => setTab('material')}>Por material</button>
      </div>
      {tab === 'equipo' ? <VistaEquipo equipos={equipos} /> : <VistaMaterial />}
    </div>
  )
}
