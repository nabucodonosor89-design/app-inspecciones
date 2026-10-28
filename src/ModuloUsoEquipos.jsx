import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { toast } from './utils/ui'
import { C, s, num, coincide, diasDesde, TIPOS_HALLAZGO, ORDEN_TIPOS, TIPOS_EQUIPO, LOTE, LIMITE, BLOQUES, ORDEN_BLOQUES, magnitud } from './usoEquipos/constantes'
import { useEscritorio } from './correctivos/useEscritorio'
import SelloFrescura from './usoEquipos/SelloFrescura'
import Bandeja from './usoEquipos/Bandeja'
import DetalleObra from './usoEquipos/DetalleObra'
import Gerencia from './usoEquipos/Gerencia'

// ============================================================
// MÓDULO USO DE EQUIPOS — cruce rastreo · combustible · parte diario · SAP
// Gestión controla a las obras; Gerencia ve además escalados, ociosos e indicadores.
// Datos: vistas v_uso_* (ver supabase/uso_equipos_setup.sql). Escrituras solo por RPC.
// ============================================================

const COL_HALLAZGOS = 'id, equipo, denominacion, fecha, tipo, obra, obra_nombre, obra_origen, tipo_equipo, clase, unidad, rastreo_q, parte_q, sap_q, litros, periodo_desde, periodo_hasta, cantidad_sin_respaldo, costo_unitario, costo_por_clase, monto, detectado_at, caso_id, nuevo, monto_neto, bloque, monto_signado, monto_neto_signado'
const COL_BANDEJA = 'caso_id, obra, obra_nombre, estado, creado_at, ultima_gestion_at, escalado_at, abiertos, n_uso_sin_parte, n_combustible_sin_parte, n_parte_sin_sap, n_parte_sobre_rastreo, n_rastreo_sobre_parte, monto_abierto, fecha_mas_vieja, dias_mas_viejo, nuevos_desde_gestion, ultima_gestion_fecha, ultima_gestion_texto, ultima_gestion_tipo, n_sap_negativa, n_sap_imposible, n_sap_sobre_parte, n_sap_bajo_parte, monto_sap_falta, monto_sap_de_mas, monto_rastreo'
const COL_OCIOSOS = 'equipo, denominacion, tipo_equipo, clase, obra, obra_nombre, obra_origen, ultimo_uso, desde, hasta, dias, dias_con_rastreo, confirmado'
const COL_INDICADORES = 'obra, obra_nombre, abiertos, monto_abierto, resueltos, justificados, vencidos, nuevos_30d, dias_prom_resolucion, veces_escalada, monto_sap_falta, monto_sap_de_mas, monto_rastreo'
const COL_FALTANTES = 'equipo, denominacion, tipo, clase, unidad, unidad_origen, costo_unitario, centro, sin_unidad, sin_costo, sin_obra, sin_actividad_anio, gps_dudoso_dias_30, gps_sin_senal_dias_30'

// Trae todas las filas en páginas de LOTE (PostgREST corta en 1000), hasta LIMITE
async function traerTodo(armar) {
  const filas = []
  for (let desde = 0; desde < LIMITE; desde += LOTE) {
    const { data, error } = await armar().range(desde, desde + LOTE - 1)
    if (error) throw error
    filas.push(...(data || []))
    if (!data || data.length < LOTE) return { filas, tope: false }
  }
  return { filas, tope: true }
}

export default function ModuloUsoEquipos({ acceso, onVolver }) {
  const esGerencia = acceso === 'gerencia'
  const escritorio = useEscritorio()
  const [tab, setTab] = useState('bandeja')
  const [cargando, setCargando] = useState(true)
  const [d, setD] = useState({ frescura: null, bandeja: [], hallazgos: [], ociosos: [], indicadores: [], faltantes: [], tope: [] })
  const [obraSel, setObraSel] = useState(null)
  // Filtros globales (en el cliente)
  const [fObra, setFObra] = useState('')
  const [fTipos, setFTipos] = useState([])
  const [fClase, setFClase] = useState('')
  const [fHallazgo, setFHallazgo] = useState('')
  const [fBloque, setFBloque] = useState('')
  const [busqueda, setBusqueda] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const pedidos = {
        frescura: supabase.from('v_uso_frescura').select('corte_rastreo, corte_partes, corte_sap, corte_combustible, recalculado_at').limit(1),
        bandeja: traerTodo(() => supabase.from('v_uso_bandeja').select(COL_BANDEJA).order('caso_id')),
        hallazgos: traerTodo(() => supabase.from('v_uso_hallazgos_abiertos').select(COL_HALLAZGOS).order('id')),
      }
      if (esGerencia) {
        pedidos.ociosos = traerTodo(() => supabase.from('v_uso_ociosos').select(COL_OCIOSOS).order('equipo'))
        pedidos.indicadores = traerTodo(() => supabase.from('v_uso_indicadores_obra').select(COL_INDICADORES).order('obra'))
        pedidos.faltantes = traerTodo(() => supabase.from('v_uso_datos_faltantes').select(COL_FALTANTES).order('equipo'))
      }
      const claves = Object.keys(pedidos)
      const res = await Promise.all(claves.map((k) => pedidos[k]))
      const nuevo = { frescura: null, bandeja: [], hallazgos: [], ociosos: [], indicadores: [], faltantes: [], tope: [] }
      res.forEach((r, i) => {
        const k = claves[i]
        if (k === 'frescura') {
          if (r.error) throw r.error
          nuevo.frescura = r.data?.[0] || null
        } else {
          nuevo[k] = r.filas
          if (r.tope) nuevo.tope.push(k)
        }
      })
      setD(nuevo)
    } catch (e) {
      console.error(e)
      toast('❌ Error al cargar uso de equipos: ' + e.message, 'error')
    } finally {
      setCargando(false)
    }
  }, [esGerencia])

  useEffect(() => { cargar() }, [cargar])

  // Opciones de filtros
  const obras = useMemo(() => {
    const m = new Map()
    d.bandeja.forEach((b) => m.set(b.obra, b.obra_nombre))
    d.ociosos.forEach((o) => o.obra && !m.has(o.obra) && m.set(o.obra, o.obra_nombre))
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [d.bandeja, d.ociosos])
  const clases = useMemo(() => {
    const set = new Set()
    d.hallazgos.forEach((h) => h.clase && set.add(h.clase))
    d.ociosos.forEach((o) => o.clase && set.add(o.clase))
    return [...set].sort()
  }, [d.hallazgos, d.ociosos])

  const filtrando = !!(fObra || fTipos.length || fClase || fHallazgo || fBloque || busqueda.trim())
  const okEquipo = useCallback((obra, tipo, clase, ...texto) =>
    (!fObra || obra === fObra) && (!fTipos.length || fTipos.includes(tipo || 'S')) &&
    (!fClase || clase === fClase) && coincide(busqueda.trim(), ...texto), [fObra, fTipos, fClase, busqueda])

  // Combustible vs certificación: mismos filtros de tipo, clase y búsqueda (no tiene obra: un equipo pasa por varias en el mes)
  const okEquipoSinObra = useCallback((tipo, clase, ...texto) =>
    (!fTipos.length || fTipos.includes(tipo || 'S')) && (!fClase || clase === fClase) && coincide(busqueda.trim(), ...texto),
  [fTipos, fClase, busqueda])

  const hallazgosF = useMemo(() => d.hallazgos.filter((h) =>
    (!fHallazgo || h.tipo === fHallazgo) && (!fBloque || h.bloque === fBloque) &&
    okEquipo(h.obra, h.tipo_equipo, h.clase, h.equipo, h.denominacion)), [d.hallazgos, fHallazgo, fBloque, okEquipo])

  // Tarjetas por obra: con filtros se recalculan desde los hallazgos visibles.
  // m = montos por bloque (sin netear); se ordena por magnitud total.
  const tarjetas = useMemo(() => {
    const agg = new Map()
    hallazgosF.forEach((h) => {
      if (!agg.has(h.obra)) agg.set(h.obra, { porTipo: {}, abiertos: 0, m: { sap_falta: 0, sap_de_mas: 0, rastreo: 0 }, fechaMasVieja: h.fecha, nuevos: 0 })
      const a = agg.get(h.obra)
      a.porTipo[h.tipo] = (a.porTipo[h.tipo] || 0) + 1
      a.abiertos += 1
      if (h.bloque in a.m) a.m[h.bloque] += Number(h.monto_neto_signado) || 0
      if (h.fecha < a.fechaMasVieja) a.fechaMasVieja = h.fecha
      if (h.nuevo) a.nuevos += 1
    })
    return d.bandeja
      .map((c) => {
        const a = agg.get(c.obra)
        if (filtrando || d.tope.includes('hallazgos')) {
          if (!a) return null
          return { caso: c, ...a, diasMasViejo: diasDesde(a.fechaMasVieja) }
        }
        return {
          caso: c, abiertos: c.abiertos, fechaMasVieja: c.fecha_mas_vieja,
          m: { sap_falta: Number(c.monto_sap_falta) || 0, sap_de_mas: Number(c.monto_sap_de_mas) || 0, rastreo: Number(c.monto_rastreo) || 0 },
          diasMasViejo: c.dias_mas_viejo, nuevos: c.nuevos_desde_gestion,
          porTipo: Object.fromEntries(ORDEN_TIPOS.map((t) => [t, c[`n_${t}`]])),
        }
      })
      .filter(Boolean)
      .sort((x, y) => magnitud(y.m) - magnitud(x.m) || String(x.fechaMasVieja).localeCompare(String(y.fechaMasVieja)))
  }, [d.bandeja, d.tope, hallazgosF, filtrando])

  const ociososF = useMemo(() => d.ociosos.filter((o) => okEquipo(o.obra, o.tipo_equipo, o.clase, o.equipo, o.denominacion))
    .sort((a, b) => b.dias - a.dias), [d.ociosos, okEquipo])
  const faltantesF = useMemo(() => d.faltantes.filter((r) => (!fTipos.length || fTipos.includes(r.tipo || 'S')) &&
    (!fClase || r.clase === fClase) && coincide(busqueda.trim(), r.equipo, r.denominacion)), [d.faltantes, fTipos, fClase, busqueda])
  const indicadoresF = useMemo(() => d.indicadores.filter((r) => !fObra || r.obra === fObra)
    .map((r) => ({ ...r, m: { sap_falta: Number(r.monto_sap_falta) || 0, sap_de_mas: Number(r.monto_sap_de_mas) || 0, rastreo: Number(r.monto_rastreo) || 0 } }))
    .sort((a, b) => magnitud(b.m) - magnitud(a.m)), [d.indicadores, fObra])
  const escalados = useMemo(() => tarjetas.filter((t) => t.caso.estado === 'escalado'), [tarjetas])

  const casoSel = obraSel ? d.bandeja.find((b) => b.obra === obraSel) : null
  const toggleTipo = (t) => setFTipos((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]))
  const limpiar = () => { setFObra(''); setFTipos([]); setFClase(''); setFHallazgo(''); setFBloque(''); setBusqueda('') }
  const abrirObra = (obra) => { setObraSel(obra); setTab('bandeja'); window.scrollTo(0, 0) }

  const sel = { ...s.input, width: 'auto', flex: '1 1 160px', minWidth: 0 }

  return (
    <div style={{ minHeight: '100vh', background: C.fondo }}>
      <div style={s.wrap}>
        <div style={s.header}>
          <button style={s.boton} onClick={onVolver} aria-label="Volver">←</button>
          <div style={{ flex: 1, minWidth: 180 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Uso de equipos</h2>
            <SelloFrescura f={d.frescura} />
          </div>
          <button style={{ ...s.boton, color: C.azul, fontWeight: 600 }} onClick={cargar} disabled={cargando}>
            {cargando ? 'Cargando…' : '↻ Actualizar'}
          </button>
        </div>

        <div style={{ ...s.barra, position: escritorio ? 'sticky' : 'static' }}>
          {esGerencia && (
            <div style={s.tabs}>
              {[['bandeja', 'Bandeja'], ['gerencia', 'Gerencia']].map(([id, label]) => (
                <button key={id} style={s.tab(tab === id)} onClick={() => { setTab(id); setObraSel(null) }}>{label}</button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            <select style={sel} value={fObra} onChange={(e) => setFObra(e.target.value)} aria-label="Obra">
              <option value="">Todas las obras</option>
              {obras.map(([c, n]) => <option key={c} value={c}>{c}{n ? ` · ${n}` : ''}</option>)}
            </select>
            <select style={sel} value={fClase} onChange={(e) => setFClase(e.target.value)} aria-label="Clase">
              <option value="">Todas las clases</option>
              {clases.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select style={sel} value={fHallazgo} onChange={(e) => setFHallazgo(e.target.value)} aria-label="Tipo de hallazgo">
              <option value="">Todos los hallazgos</option>
              {ORDEN_TIPOS.map((t) => <option key={t} value={t}>{TIPOS_HALLAZGO[t].label}</option>)}
            </select>
            <select style={sel} value={fBloque} onChange={(e) => setFBloque(e.target.value)} aria-label="Bloque de monto">
              <option value="">Todos los bloques</option>
              {ORDEN_BLOQUES.map((b) => <option key={b} value={b}>{BLOQUES[b].label}</option>)}
            </select>
          </div>
          <div style={s.chips}>
            {TIPOS_EQUIPO.map((t) => (
              <button key={t.id} style={s.chipBtn(fTipos.includes(t.id))} onClick={() => toggleTipo(t.id)}>{t.label}</button>
            ))}
            {filtrando && <button style={{ ...s.chipBtn(false), color: C.rojo }} onClick={limpiar}>✕ Limpiar filtros</button>}
          </div>
          <input style={s.input} placeholder="Buscar equipo…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>

        {d.tope.length > 0 && (
          <div style={s.aviso}>⚠ Se alcanzó el límite de {num(LIMITE)} filas en: {d.tope.join(', ')}. Puede haber datos que no se muestran.</div>
        )}

        {cargando && !d.frescura && !d.bandeja.length ? <div style={s.vacio}>⏳ Cargando…</div>
          : tab === 'gerencia' && esGerencia ? (
            <Gerencia escalados={escalados} ociosos={ociososF} indicadores={indicadoresF} faltantes={faltantesF} hallazgos={d.hallazgos} filtroEquipo={okEquipoSinObra}
              onAbrirObra={abrirObra} onCambio={cargar} />
          ) : casoSel ? (
            <DetalleObra key={casoSel.caso_id} caso={casoSel} esGerencia={esGerencia}
              hallazgos={hallazgosF.filter((h) => h.obra === casoSel.obra)}
              onVolver={() => setObraSel(null)} onCambio={cargar} />
          ) : (
            <Bandeja obras={tarjetas} filtrando={filtrando} onAbrir={abrirObra} />
          )}
      </div>
    </div>
  )
}
