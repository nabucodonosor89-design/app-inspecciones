import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'

// Paleta de colores fijos por camión (índice consistente)
const PALETA = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#84cc16',
  '#6366f1', '#e11d48', '#0ea5e9', '#d97706', '#7c3aed',
]

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

// Devuelve el lunes de la semana que contiene `fecha`
function getLunes(fecha) {
  const d = new Date(fecha)
  const dia = d.getDay() // 0=dom, 1=lun...
  const diff = dia === 0 ? -6 : 1 - dia
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(fecha, n) {
  const d = new Date(fecha)
  d.setDate(d.getDate() + n)
  return d
}

function mismaFecha(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth() &&
    a.getDate()     === b.getDate()
  )
}

function formatFecha(d) {
  return d.toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit' })
}

function formatFechaLarga(d) {
  return d.toLocaleDateString('es-PY', { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function CalendarioLogistica({ onVolver }) {
  const [lunes, setLunes]             = useState(() => getLunes(new Date()))
  const [camiones, setCamiones]       = useState([])
  const [fletesMap, setFletesMap]     = useState({}) // equipoId → [{ fecha, estado, pedido }]
  const [cargando, setCargando]       = useState(true)
  const [diaSeleccionado, setDia]     = useState(() => {
    const hoy = new Date(); hoy.setHours(0,0,0,0); return hoy
  })

  // Colores fijos por camión (mismo orden siempre)
  const colorPorCamion = {}
  camiones.forEach((c, i) => { colorPorCamion[c.id] = PALETA[i % PALETA.length] })

  const dias = Array.from({ length: 7 }, (_, i) => addDays(lunes, i))

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      // Todos los camiones logísticos activos
      const { data: cams, error: eqErr } = await supabase
        .from('equipos')
        .select('id, denominacion, matricula, numero_identificacion')
        .eq('es_logistica', true)
        .eq('activo', true)
        .order('denominacion')
      if (eqErr) throw eqErr
      setCamiones(cams || [])

      // Fletes de la semana visible + activos sin entregar
      const inicioISO = lunes.toISOString()
      const finSemana = addDays(lunes, 6); finSemana.setHours(23, 59, 59, 999)
      const finISO    = finSemana.toISOString()

      const [{ data: fleteSemana, error: e1 }, { data: fleteActivos, error: e2 }] = await Promise.all([
        // Fletes cuya fecha_asignacion cae en la semana
        supabase
          .from('fletes')
          .select('id, equipo_id, estado, fecha_asignacion, fecha_entrega, pedido_id, pedidos_logistica(material, obras(nombre_obra))')
          .neq('estado', 'cancelado')
          .gte('fecha_asignacion', inicioISO)
          .lte('fecha_asignacion', finISO),
        // Fletes aún activos (sin entregar) que empezaron antes de la semana
        supabase
          .from('fletes')
          .select('id, equipo_id, estado, fecha_asignacion, fecha_entrega, pedido_id, pedidos_logistica(material, obras(nombre_obra))')
          .in('estado', ['asignado', 'en_transito'])
          .lt('fecha_asignacion', inicioISO),
      ])
      if (e1) throw e1
      if (e2) throw e2

      // Construir mapa equipoId → lista de { fecha, flete }
      const map = {}
      const agregar = (flete) => {
        if (!flete.equipo_id) return
        if (!map[flete.equipo_id]) map[flete.equipo_id] = []
        map[flete.equipo_id].push(flete)
      }
      ;(fleteSemana || []).forEach(agregar)
      ;(fleteActivos || []).forEach(agregar)
      setFletesMap(map)
    } catch (e) {
      console.error('Error cargando calendario:', e.message)
    } finally {
      setCargando(false)
    }
  }, [lunes])

  useEffect(() => { cargar() }, [cargar])

  // Para un día dado, obtener IDs de camiones ocupados
  const camionesOcupadosEnDia = (dia) => {
    const ocupados = new Set()
    Object.entries(fletesMap).forEach(([equipoId, fletes]) => {
      fletes.forEach(f => {
        const asig = new Date(f.fecha_asignacion)
        // Si el flete fue asignado ese día
        if (mismaFecha(asig, dia)) { ocupados.add(equipoId); return }
        // Si el flete sigue activo (sin entregar) y fue asignado antes del día
        if (['asignado', 'en_transito'].includes(f.estado) && asig < dia) {
          ocupados.add(equipoId)
        }
      })
    })
    return ocupados
  }

  // Para un día, fletes detallados de los camiones ocupados
  const fletesEnDia = (dia) => {
    const resultado = []
    camiones.forEach(c => {
      const fletes = fletesMap[c.id] || []
      fletes.forEach(f => {
        const asig = new Date(f.fecha_asignacion)
        const esDia   = mismaFecha(asig, dia)
        const sigueActivo = ['asignado', 'en_transito'].includes(f.estado) && asig < dia
        if (esDia || sigueActivo) {
          resultado.push({ camion: c, flete: f })
        }
      })
    })
    return resultado
  }

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)

  const ocupadosHoy  = camionesOcupadosEnDia(diaSeleccionado)
  const libresHoy    = camiones.filter(c => !ocupadosHoy.has(c.id))
  const detallesDia  = fletesEnDia(diaSeleccionado)

  const ESTADOS_LABEL = {
    asignado:    { label: 'Asignado',    color: '#1e40af', bg: '#dbeafe' },
    en_transito: { label: 'En tránsito', color: '#065f46', bg: '#d1fae5' },
    entregado:   { label: 'Entregado',   color: '#166534', bg: '#bbf7d0' },
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}>

      {/* Header semana */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setLunes(d => addDays(d, -7))}
            style={{ background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '16px' }}
          >←</button>
          <span style={{ fontSize: '14px', fontWeight: '600', color: '#374151', minWidth: '200px', textAlign: 'center' }}>
            {formatFecha(dias[0])} — {formatFecha(dias[6])}
          </span>
          <button
            onClick={() => setLunes(d => addDays(d, 7))}
            style={{ background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '16px' }}
          >→</button>
        </div>
        <button
          onClick={() => { setLunes(getLunes(new Date())); const h = new Date(); h.setHours(0,0,0,0); setDia(h) }}
          style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '6px 14px', fontSize: '13px', cursor: 'pointer', fontWeight: '600' }}
        >
          Hoy
        </button>
        {cargando && <span style={{ fontSize: '13px', color: '#9ca3af' }}>Cargando...</span>}
      </div>

      {/* Grilla semanal */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px', marginBottom: '24px' }}>
        {dias.map((dia, idx) => {
          const esHoy         = mismaFecha(dia, hoy)
          const esSeleccionado = mismaFecha(dia, diaSeleccionado)
          const ocupados      = camionesOcupadosEnDia(dia)
          const libres        = camiones.length - ocupados.size

          return (
            <div
              key={idx}
              onClick={() => setDia(new Date(dia))}
              style={{
                background: esSeleccionado ? '#eff6ff' : '#fff',
                border: esSeleccionado ? '2px solid #3b82f6' : esHoy ? '2px solid #93c5fd' : '1px solid #e5e7eb',
                borderRadius: '10px',
                padding: '10px 8px',
                cursor: 'pointer',
                transition: 'all 0.15s',
                minHeight: '110px',
              }}
            >
              {/* Nombre y fecha */}
              <div style={{ fontSize: '11px', fontWeight: '700', color: esHoy ? '#1d4ed8' : '#6b7280', textTransform: 'uppercase', marginBottom: '2px' }}>
                {DIAS_SEMANA[idx]}
              </div>
              <div style={{ fontSize: '15px', fontWeight: '700', color: esHoy ? '#1d4ed8' : '#111827', marginBottom: '8px' }}>
                {dia.getDate()}
              </div>

              {/* Puntos de camiones ocupados */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', minHeight: '28px' }}>
                {camiones
                  .filter(c => ocupados.has(c.id))
                  .slice(0, 10)
                  .map(c => (
                    <div
                      key={c.id}
                      title={c.denominacion}
                      style={{
                        width: '10px', height: '10px', borderRadius: '50%',
                        background: colorPorCamion[c.id],
                        flexShrink: 0,
                      }}
                    />
                  ))}
                {ocupados.size > 10 && (
                  <span style={{ fontSize: '10px', color: '#9ca3af' }}>+{ocupados.size - 10}</span>
                )}
              </div>

              {/* Contador */}
              <div style={{ marginTop: '6px', fontSize: '11px', color: '#6b7280' }}>
                {camiones.length > 0 ? (
                  <>
                    <span style={{ color: '#16a34a', fontWeight: '600' }}>{libres} libre{libres !== 1 ? 's' : ''}</span>
                    {ocupados.size > 0 && <span> · {ocupados.size} ocup.</span>}
                  </>
                ) : '—'}
              </div>
            </div>
          )
        })}
      </div>

      {/* Panel del día seleccionado */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

        {/* Camiones libres */}
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '12px', padding: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', color: '#166534', fontWeight: '700' }}>
            ✅ Camiones libres — {formatFechaLarga(diaSeleccionado)}
          </h3>
          {libresHoy.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: '13px', margin: 0 }}>
              {camiones.length === 0 ? 'Sin camiones en flota' : 'Todos ocupados este día'}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {libresHoy.map(c => (
                <div
                  key={c.id}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#111827' }}
                >
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: colorPorCamion[c.id], flexShrink: 0 }} />
                  <span>{c.denominacion}{c.matricula ? ` (${c.matricula})` : c.numero_identificacion ? ` (${c.numero_identificacion})` : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Camiones ocupados / detalle */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', color: '#374151', fontWeight: '700' }}>
            🚛 Ocupados — {formatFechaLarga(diaSeleccionado)}
          </h3>
          {detallesDia.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: '13px', margin: 0 }}>Sin fletes este día</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {detallesDia.map(({ camion, flete }) => {
                const est = ESTADOS_LABEL[flete.estado] || ESTADOS_LABEL.asignado
                return (
                  <div key={flete.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: colorPorCamion[camion.id], flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '600', color: '#111827' }}>
                        {camion.denominacion}{camion.matricula ? ` (${camion.matricula})` : ''}
                      </div>
                      <div style={{ color: '#6b7280' }}>
                        {flete.pedidos_logistica?.material || '—'}
                        {flete.pedidos_logistica?.obras?.nombre_obra ? ` → ${flete.pedidos_logistica.obras.nombre_obra}` : ''}
                      </div>
                    </div>
                    <span style={{ padding: '2px 8px', borderRadius: '8px', fontSize: '11px', fontWeight: '600', background: est.bg, color: est.color, whiteSpace: 'nowrap' }}>
                      {est.label}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>

      {/* Leyenda de colores */}
      {camiones.length > 0 && (
        <div style={{ marginTop: '20px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '14px 16px' }}>
          <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px', fontWeight: '600' }}>Referencia de colores</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {camiones.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: '#374151' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: colorPorCamion[c.id], flexShrink: 0 }} />
                <span>{c.denominacion}{c.matricula ? ` (${c.matricula})` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
