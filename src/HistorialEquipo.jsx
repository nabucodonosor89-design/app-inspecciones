import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { toast } from './utils/ui'

// Historial de mantenimiento: equipo → órdenes SAP → componentes consumidos,
// y búsqueda inversa material → combinaciones equipo/material.
// Datos vía RPC SECURITY DEFINER (todos los roles, usuario activo): historial_equipo_ordenes,
// historial_orden_componentes, historial_equipo_materiales, historial_buscar_material.

const C = { azul: '#1d4ed8', gris: '#6b7280', borde: '#e5e7eb', fondo: '#f9fafb', texto: '#111827' }
const CLASES = { TCOC: 'Correctiva', TCPV: 'Preventiva', TCUR: 'Urgencia', TCFA: 'Falla' }
const FILTROS_CLASE = [
  { k: '', t: 'Todas' },
  { k: 'TCPV', t: 'TCPV' },
  { k: 'TCOC', t: 'TCOC' },
  { k: 'otras', t: 'Otras' },
]

const num = (n) => (n == null ? '–' : Number(n).toLocaleString('es-PY', { maximumFractionDigits: 3 }))
const fecha = (d) => {
  if (!d) return '–'
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y.slice(2)}`
}
const pasaClase = (clase, f) => !f || (f === 'otras' ? clase !== 'TCPV' && clase !== 'TCOC' : clase === f)
// Filtro por palabras: todas las palabras tienen que aparecer en alguno de los campos (en cualquier orden).
const palabras = (q) => q.trim().toUpperCase().split(/\s+/).filter(Boolean)
const coincide = (q, ...campos) => {
  const ps = palabras(q)
  if (!ps.length) return true
  const t = campos.map((c) => String(c ?? '')).join(' ').toUpperCase()
  return ps.every((p) => t.includes(p))
}

const s = {
  wrap: { maxWidth: 960, margin: '0 auto', padding: 12, fontFamily: 'inherit', color: C.texto },
  header: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 },
  volver: { minHeight: 44, minWidth: 44, border: `1px solid ${C.borde}`, background: '#fff', borderRadius: 8, fontSize: 18, cursor: 'pointer' },
  tabs: { display: 'flex', gap: 6, marginBottom: 12 },
  tab: (on) => ({ flex: 1, minHeight: 44, borderRadius: 8, cursor: 'pointer', fontWeight: 600,
    border: `1px solid ${on ? C.azul : C.borde}`, background: on ? C.azul : '#fff', color: on ? '#fff' : C.texto }),
  input: { width: '100%', minHeight: 44, padding: '8px 12px', fontSize: 16, border: `1px solid ${C.borde}`, borderRadius: 8, boxSizing: 'border-box' },
  filtro: { width: '100%', minHeight: 40, padding: '6px 12px', fontSize: 16, border: `1px solid ${C.borde}`, borderRadius: 8, boxSizing: 'border-box', marginBottom: 8, background: C.fondo },
  chips: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  chipBtn: (on) => ({ minHeight: 36, padding: '4px 14px', borderRadius: 18, cursor: 'pointer', fontWeight: 600, fontSize: 14,
    border: `1px solid ${on ? C.azul : C.borde}`, background: on ? C.azul : '#fff', color: on ? '#fff' : C.texto }),
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

function FiltroClase({ valor, onChange, contar }) {
  return (
    <div style={s.chips}>
      {FILTROS_CLASE.map((c) => (
        <button key={c.k || 'todas'} style={s.chipBtn(valor === c.k)} onClick={() => onChange(c.k)}
          title={c.k === 'otras' ? 'Urgencia, falla y otras' : CLASES[c.k] || 'Todas las clases'}>
          {c.t} · {contar(c.k)}
        </button>
      ))}
    </div>
  )
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
                {c.f ? c.f(f, i) : f[c.k] ?? '–'}
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
                { k: 'material', t: 'Código', nw: true },
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
  const [textoOrd, setTextoOrd] = useState('')
  const [textoMat, setTextoMat] = useState('')

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

  const porTexto = ordenes.filter((o) => coincide(textoOrd, o.orden, o.texto))
  const visibles = porTexto.filter((o) => pasaClase(o.clase_orden, filtroClase))
  const matsVisibles = materiales.filter((m) => coincide(textoMat, m.material, m.descripcion))
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
              <FiltroClase valor={filtroClase} onChange={setFiltroClase}
                contar={(k) => porTexto.filter((o) => pasaClase(o.clase_orden, k)).length} />
              <input style={s.filtro} value={textoOrd} onChange={(e) => setTextoOrd(e.target.value)}
                placeholder="Filtrar por texto o n° de orden (ej. motor, 4013521)" />
              {visibles.length === 0 ? <div style={s.vacio}>No hay órdenes con ese filtro.</div>
                : visibles.map((o) => <OrdenCard key={o.orden} o={o} />)}
            </>
          ) : (
            <>
              <input style={s.filtro} value={textoMat} onChange={(e) => setTextoMat(e.target.value)}
                placeholder="Filtrar por código o descripción (ej. filtro aire)" />
              {matsVisibles.length === 0 ? <div style={s.vacio}>No hay materiales con ese filtro.</div> : (
                <div style={s.card}>
                  <Tabla filas={matsVisibles} cols={[
                    { k: 'material', t: 'Código', nw: true },
                    { k: 'descripcion', t: 'Descripción' },
                    { k: 'cantidad_usada', t: 'Total', der: true, nw: true, f: (r) => `${num(r.cantidad_usada)} ${r.unidad || ''}` },
                    { k: 'n_ordenes', t: 'Órdenes', der: true },
                    { k: 'ultima', t: 'Última', nw: true, f: (r) => fecha(r.ultima) },
                  ]} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}

// Por material: combinaciones Equipo / Material sin repetir.
// - Con un equipo exacto: usa historial_equipo_materiales (lista completa del equipo) y filtra por texto al tipear.
// - Sin equipo: usa historial_buscar_material (300 consumos más recientes) y agrupa por equipo + material.
function VistaMaterial({ equipos }) {
  const [texto, setTexto] = useState('')
  const [equipoQ, setEquipoQ] = useState('')
  const [busqueda, setBusqueda] = useState(null) // filas de historial_buscar_material
  const [buscando, setBuscando] = useState(false)
  const [datosEquipo, setDatosEquipo] = useState({ equipo: null, filas: [] })

  const ids = useMemo(() => new Set(equipos.map((e) => e.numero_identificacion)), [equipos])
  const den = useMemo(() => new Map(equipos.map((e) => [e.numero_identificacion, e.denominacion])), [equipos])
  const eqNorm = equipoQ.trim().toUpperCase()
  const exacto = ids.has(eqNorm) ? eqNorm : null

  useEffect(() => {
    if (!exacto) return
    let vivo = true
    supabase.rpc('historial_equipo_materiales', { p_equipo: exacto }).then(({ data, error }) => {
      if (!vivo) return
      if (error) toast('Error al cargar materiales del equipo: ' + error.message, 'error')
      setDatosEquipo({ equipo: exacto, filas: data || [] })
    })
    return () => { vivo = false }
  }, [exacto])

  const buscar = async () => {
    // El servidor busca una sola palabra (la más larga); el resto se filtra acá.
    const clave = palabras(texto).sort((a, b) => b.length - a.length)[0] || ''
    if (clave.length < 3) { toast('Escribí al menos una palabra de 3 letras', 'error'); return }
    setBuscando(true)
    const { data, error } = await supabase.rpc('historial_buscar_material', { p_texto: clave })
    setBuscando(false)
    if (error) { toast('Error en la búsqueda: ' + error.message, 'error'); return }
    setBusqueda(data || [])
  }

  const cargandoEquipo = exacto && datosEquipo.equipo !== exacto

  const pares = useMemo(() => {
    if (exacto) {
      if (datosEquipo.equipo !== exacto) return []
      return datosEquipo.filas
        .filter((m) => coincide(texto, m.material, m.descripcion))
        .map((m) => ({ equipo: exacto, material: m.material, descripcion: m.descripcion, n_ordenes: m.n_ordenes, ultima: m.ultima }))
        .sort((a, b) => (a.descripcion || '').localeCompare(b.descripcion || ''))
    }
    if (!busqueda) return []
    const g = new Map()
    for (const r of busqueda) {
      const eq = r.equipo || 'Sin equipo'
      if (!coincide(texto, r.material, r.descripcion)) continue
      if (eqNorm && !eq.toUpperCase().includes(eqNorm) && !(den.get(eq) || '').toUpperCase().includes(eqNorm)) continue
      const k = eq + '|' + r.material
      if (!g.has(k)) g.set(k, { equipo: eq, material: r.material, descripcion: r.descripcion, ords: new Set(), ultima: null })
      const p = g.get(k)
      p.ords.add(r.orden)
      if (r.fecha_entrada && (!p.ultima || r.fecha_entrada > p.ultima)) p.ultima = r.fecha_entrada
    }
    return [...g.values()]
      .map((p) => ({ ...p, n_ordenes: p.ords.size }))
      .sort((a, b) => (a.equipo === 'Sin equipo') - (b.equipo === 'Sin equipo')
        || a.equipo.localeCompare(b.equipo) || (a.descripcion || '').localeCompare(b.descripcion || ''))
  }, [exacto, datosEquipo, busqueda, texto, eqNorm, den])

  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input style={{ ...s.input, flex: '2 1 240px', width: 'auto' }} value={texto} onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !exacto && buscar()}
          placeholder="Material: código o texto (ej. filtro aire, 1R1808)" />
        <input style={{ ...s.input, flex: '1 1 160px', width: 'auto' }} value={equipoQ} onChange={(e) => setEquipoQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !exacto && buscar()}
          list="historial-equipos" placeholder="Equipo (opcional, ej. BM-DA002)" />
        <datalist id="historial-equipos">
          {equipos.map((e) => <option key={e.numero_identificacion} value={e.numero_identificacion}>{e.denominacion}</option>)}
        </datalist>
        {!exacto && <button style={{ ...s.tab(true), flex: '0 0 96px' }} onClick={buscar}>Buscar</button>}
      </div>
      <div style={{ ...s.meta, margin: '6px 0 0' }}>
        {exacto
          ? <>Mostrando todos los materiales usados por <b>{exacto}</b> {den.get(exacto) ? `(${den.get(exacto)})` : ''}. El texto filtra al tipear.</>
          : 'Con un equipo, la lista es completa y filtra al tipear. Sin equipo, buscá un material en toda la flota.'}
      </div>

      {(buscando || cargandoEquipo) && <div style={s.vacio}>Cargando…</div>}
      {!buscando && !cargandoEquipo && (exacto || busqueda) && (
        pares.length === 0 ? <div style={s.vacio}>No hay combinaciones equipo/material con ese filtro.</div> : (
          <div style={{ ...s.card, marginTop: 12 }}>
            <div style={{ ...s.meta, padding: '8px 8px 0' }}>{pares.length} combinaciones equipo / material</div>
            <Tabla filas={pares} cols={[
              { k: 'n', t: '#', der: true, f: (_r, i) => i + 1 },
              { k: 'equipo', t: 'Equipo', nw: true, f: (r) => <b>{r.equipo}</b> },
              { k: 'material', t: 'Código', nw: true },
              { k: 'descripcion', t: 'Descripción' },
              { k: 'n_ordenes', t: 'Órdenes', der: true },
              { k: 'ultima', t: 'Última', nw: true, f: (r) => fecha(r.ultima) },
            ]} />
            {!exacto && busqueda?.length === 300 && (
              <div style={{ ...s.meta, padding: 8 }}>
                La búsqueda trajo los 300 consumos más recientes; puede faltar alguna combinación antigua. Indicá el equipo para ver su lista completa.
              </div>
            )}
          </div>
        )
      )}
    </>
  )
}

// onVolver: botón ← (desde el menú). onSalir: botón Cerrar sesión (rol compras, que entra directo acá).
export default function HistorialEquipo({ onVolver, onSalir, usuario }) {
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
        {onVolver && <button style={s.volver} onClick={onVolver} aria-label="Volver">←</button>}
        <h2 style={{ margin: 0, fontSize: 20, flex: 1 }}>Historial de equipos</h2>
        {onSalir && (
          <button style={{ ...s.volver, fontSize: 14, padding: '0 12px', color: '#b91c1c' }} onClick={onSalir}
            title={usuario?.nombre_completo}>Cerrar sesión</button>
        )}
      </div>
      <div style={s.tabs}>
        <button style={s.tab(tab === 'equipo')} onClick={() => setTab('equipo')}>Por equipo</button>
        <button style={s.tab(tab === 'material')} onClick={() => setTab('material')}>Por material</button>
      </div>
      {tab === 'equipo' ? <VistaEquipo equipos={equipos} /> : <VistaMaterial equipos={equipos} />}
    </div>
  )
}
