import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { useEscritorio } from './correctivos/useEscritorio'
import { C, s, MAX_DIAS, RANGOS, rangoDe, diasEntre, ddmm, hoyPY } from './trabajoEquipos/constantes'
import SelectorEquipo from './trabajoEquipos/SelectorEquipo'
import ResumenObras from './trabajoEquipos/ResumenObras'
import DetalleDias from './trabajoEquipos/DetalleDias'

// ============================================================
// TRABAJO DE EQUIPOS — cuánto trabajó un equipo, día por día, y a qué obras se cargó.
// Solo informa: SAP, parte, GPS y combustible lado a lado, sin alarmas ni diferencias
// (las alarmas siguen en Uso de equipos). Abierto a cualquier usuario activo.
// Datos: RPC trabajo_equipo_dias, trabajo_equipo_frescura y trabajo_equipos_lista
// (ver supabase/trabajo_equipos.sql). Nunca trae valores ni costos.
// ============================================================

function Sello({ f }) {
  if (!f) return null
  const items = [['SAP al', f.sap], ['partes al', f.parte], ['GPS al', f.gps], ['combustible al', f.combustible]]
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 6px', fontSize: 12, color: C.gris }}>
      {items.map(([label, fecha], i) => (
        <span key={label} style={{ whiteSpace: 'nowrap' }}>
          {i > 0 && <span style={{ marginRight: 6 }}>·</span>}
          {label} {ddmm(fecha)}
        </span>
      ))}
    </div>
  )
}

const RANGO_DEFECTO = '30d'

export default function ModuloTrabajoEquipos({ onVolver }) {
  const escritorio = useEscritorio()
  const [equipos, setEquipos] = useState([])
  const [frescura, setFrescura] = useState(null)
  const [errorBase, setErrorBase] = useState(null)
  const [equipo, setEquipo] = useState(null)
  const [chip, setChip] = useState(RANGO_DEFECTO)
  const [desde, setDesde] = useState(() => rangoDe(RANGO_DEFECTO).desde)
  const [hasta, setHasta] = useState(() => rangoDe(RANGO_DEFECTO).hasta)
  // Resultado de la última consulta, con la clave que lo originó (así "cargando" se deriva sin efectos)
  const [res, setRes] = useState({ clave: null, filas: [], error: null })

  // Lista de equipos y frescura de las fuentes: una vez
  useEffect(() => {
    let vivo = true
    Promise.all([supabase.rpc('trabajo_equipos_lista'), supabase.rpc('trabajo_equipo_frescura')])
      .then(([l, f]) => {
        if (!vivo) return
        if (l.error || f.error) { setErrorBase((l.error || f.error).message); return }
        setEquipos(l.data || [])
        setFrescura(f.data?.[0] || null)
      })
    return () => { vivo = false }
  }, [])

  const nDias = desde && hasta ? diasEntre(desde, hasta) : 0
  const errorRango = !desde || !hasta ? 'Elegí las dos fechas'
    : desde > hasta ? '"Desde" tiene que ser anterior o igual a "hasta"'
      : nDias > MAX_DIAS ? `El rango no puede superar ${MAX_DIAS} días (son ${nDias})` : null
  const clave = equipo && !errorRango ? `${equipo}|${desde}|${hasta}` : null

  useEffect(() => {
    if (!clave) return
    let vivo = true
    const [eq, d, h] = clave.split('|')
    supabase.rpc('trabajo_equipo_dias', { p_equipo: eq, p_desde: d, p_hasta: h }).then(({ data, error }) => {
      if (!vivo) return
      setRes({ clave, filas: data || [], error: error ? error.message : null })
    })
    return () => { vivo = false }
  }, [clave])

  const cargando = clave != null && res.clave !== clave
  const filas = useMemo(() => (res.clave === clave ? res.filas : []), [res, clave])

  function elegirChip(id) {
    const r = rangoDe(id)
    setChip(id)
    setDesde(r.desde)
    setHasta(r.hasta)
  }

  const fechaInput = { ...s.input, width: 'auto', minWidth: 150, flex: '1 1 150px' }

  return (
    <div style={{ minHeight: '100vh', background: C.fondo }}>
      <div style={s.wrap}>
        <div style={s.header}>
          <button style={s.boton} onClick={onVolver} aria-label="Volver">←</button>
          <div style={{ flex: 1, minWidth: 180 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Trabajo de equipos</h2>
            <Sello f={frescura} />
          </div>
        </div>

        {errorBase && <div style={{ ...s.aviso, background: C.rojoBg, color: C.rojo }}>No se pudo cargar: {errorBase}</div>}

        <div style={s.card}>
          <SelectorEquipo equipos={equipos} valor={equipo} onElegir={setEquipo} />

          <div style={{ ...s.chips, marginTop: 10 }}>
            {RANGOS.map(([id, label]) => (
              <button key={id} style={s.chipBtn(chip === id)} onClick={() => elegirChip(id)}>{label}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ ...s.meta, display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 200px' }}>
              Desde
              <input type="date" style={fechaInput} value={desde} max={hoyPY()}
                onChange={(e) => { setDesde(e.target.value); setChip(null) }} />
            </label>
            <label style={{ ...s.meta, display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 200px' }}>
              Hasta
              <input type="date" style={fechaInput} value={hasta}
                onChange={(e) => { setHasta(e.target.value); setChip(null) }} />
            </label>
            {!errorRango && <span style={s.meta}>{nDias} {nDias === 1 ? 'día' : 'días'}</span>}
          </div>
          {errorRango && <div style={{ ...s.aviso, marginTop: 8, marginBottom: 0 }}>{errorRango}</div>}
        </div>

        {!equipo && !errorBase && (
          <div style={s.vacio}>Elegí un equipo para ver su trabajo día por día.</div>
        )}
        {cargando && <div style={s.vacio}>Cargando…</div>}
        {!cargando && res.error && res.clave === clave && (
          <div style={{ ...s.aviso, background: C.rojoBg, color: C.rojo }}>No se pudo consultar: {res.error}</div>
        )}

        {clave && !cargando && !res.error && (
          <>
            <ResumenObras filas={filas} escritorio={escritorio} />
            <DetalleDias filas={filas} desde={desde} hasta={hasta} frescura={frescura} escritorio={escritorio} />
          </>
        )}
      </div>
    </div>
  )
}
