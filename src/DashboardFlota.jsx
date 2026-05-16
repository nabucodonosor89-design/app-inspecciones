import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'

function DashboardFlota({ onVolver }) {
  const [loading, setLoading] = useState(true)
  const [datos, setDatos] = useState(null)
  const [ultimaActualizacion, setUltimaActualizacion] = useState(null)

  useEffect(() => { cargarDatos() }, [])

  async function cargarDatos() {
    setLoading(true)
    try {
      const ahora = new Date()
      const hace7dias = new Date(ahora - 7 * 24 * 60 * 60 * 1000).toISOString()
      const hace14dias = new Date(ahora - 14 * 24 * 60 * 60 * 1000).toISOString()
      const hace90dias = new Date(ahora - 90 * 24 * 60 * 60 * 1000).toISOString()
      const inicioDia = new Date(ahora); inicioDia.setHours(0, 0, 0, 0)

      const [equiposRes, inspeccionesRes, mantenimientosRes, fallasCriticasRes, inspeccionesHoyRes] = await Promise.all([
        supabase.from('equipos')
          .select('id, numero_identificacion, denominacion, tipo_equipo, estado_operativo, semaforo_actual, ubicacion_actual')
          .eq('activo', true),

        supabase.from('inspecciones')
          .select('id, equipo_id, fecha_hora, semaforo, tipo_inspeccion')
          .gte('fecha_hora', hace90dias)
          .order('fecha_hora', { ascending: false }),

        supabase.from('mantenimientos')
          .select('id, equipo_id, descripcion, estado, fecha_inicio, equipos(numero_identificacion, denominacion, tipo_equipo)')
          .in('estado', ['Taller Espera', 'Taller Entrada']),

        supabase.from('checklist_items')
          .select(`id, item_nombre, es_critico, observacion, inspeccion_id,
            inspecciones(equipo_id, fecha_hora, equipos(numero_identificacion, denominacion))`)
          .eq('estado', 'fail')
          .eq('es_critico', true)
          .gte('inspecciones.fecha_hora', hace7dias),

        supabase.from('inspecciones')
          .select('id, equipo_id, semaforo, tipo_inspeccion, fecha_hora, equipos(numero_identificacion, denominacion), usuarios(nombre_completo)')
          .gte('fecha_hora', inicioDia.toISOString())
          .order('fecha_hora', { ascending: false }),
      ])

      const equipos = equiposRes.data || []
      const inspecciones = inspeccionesRes.data || []
      const mantenimientos = mantenimientosRes.data || []
      const inspeccionesHoy = inspeccionesHoyRes.data || []

      // Filtrar fallas críticas correctamente (la FK join puede traer nulls si la inspeccion es anterior a 7d)
      const fallasCriticas = (fallasCriticasRes.data || []).filter(f =>
        f.inspecciones?.fecha_hora && f.inspecciones.fecha_hora >= hace7dias
      )

      // ── KPIs de estado operativo ──
      const totalEquipos = equipos.length
      const operativos = equipos.filter(e => e.estado_operativo === 'operativo').length
      const conRestriccion = equipos.filter(e => e.estado_operativo === 'con_restriccion').length
      const fueraServicio = equipos.filter(e => e.estado_operativo === 'fuera_servicio').length
      const enTallerCount = mantenimientos.length

      // ── Semáforo actual ──
      const semaforoVerde = equipos.filter(e => e.semaforo_actual === 'verde').length
      const semaforoAmarillo = equipos.filter(e => e.semaforo_actual === 'amarillo').length
      const semaforoRojo = equipos.filter(e => e.semaforo_actual === 'rojo').length
      const semaforoSinDatos = totalEquipos - semaforoVerde - semaforoAmarillo - semaforoRojo

      // ── Tendencia semáforo: semana actual vs semana anterior ──
      const inspSemanaActual = inspecciones.filter(i => i.fecha_hora >= hace7dias)
      const inspSemanaAnterior = inspecciones.filter(i => i.fecha_hora >= hace14dias && i.fecha_hora < hace7dias)
      const rojoActual = inspSemanaActual.filter(i => i.semaforo === 'rojo').length
      const rojoAnterior = inspSemanaAnterior.filter(i => i.semaforo === 'rojo').length
      const tendenciaRojo = rojoActual - rojoAnterior // positivo = empeora, negativo = mejora

      // ── Equipos sin actividad reciente (> 3 días sin inspección) ──
      const ultimaInspeccionPorEquipo = {}
      inspecciones.forEach(i => {
        if (!ultimaInspeccionPorEquipo[i.equipo_id] || i.fecha_hora > ultimaInspeccionPorEquipo[i.equipo_id]) {
          ultimaInspeccionPorEquipo[i.equipo_id] = i.fecha_hora
        }
      })

      const ahora_ms = ahora.getTime()
      const sinActividad = equipos
        .map(eq => {
          const ultima = ultimaInspeccionPorEquipo[eq.id]
          const diasSinInspeccion = ultima
            ? Math.floor((ahora_ms - new Date(ultima).getTime()) / (1000 * 60 * 60 * 24))
            : null
          return { ...eq, ultimaInspeccion: ultima || null, diasSinInspeccion }
        })
        .filter(eq => eq.diasSinInspeccion === null || eq.diasSinInspeccion > 3)
        .sort((a, b) => {
          if (a.diasSinInspeccion === null) return -1
          if (b.diasSinInspeccion === null) return 1
          return b.diasSinInspeccion - a.diasSinInspeccion
        })

      setDatos({
        totalEquipos, operativos, conRestriccion, fueraServicio, enTallerCount,
        semaforoVerde, semaforoAmarillo, semaforoRojo, semaforoSinDatos,
        tendenciaRojo, rojoActual, rojoAnterior,
        sinActividad,
        fallasCriticas,
        mantenimientos,
        inspeccionesHoy,
      })
      setUltimaActualizacion(ahora)
    } catch (err) {
      console.error('Error dashboard:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚡</div>
          <p style={{ fontSize: '1.2rem', color: '#475569' }}>Cargando panel de flota...</p>
        </div>
      </div>
    )
  }

  const { totalEquipos, operativos, conRestriccion, fueraServicio, enTallerCount,
    semaforoVerde, semaforoAmarillo, semaforoRojo, semaforoSinDatos,
    tendenciaRojo, rojoActual, rojoAnterior,
    sinActividad, fallasCriticas, mantenimientos, inspeccionesHoy } = datos

  const pctVerde = totalEquipos ? Math.round(semaforoVerde / totalEquipos * 100) : 0
  const pctAmarillo = totalEquipos ? Math.round(semaforoAmarillo / totalEquipos * 100) : 0
  const pctRojo = totalEquipos ? Math.round(semaforoRojo / totalEquipos * 100) : 0

  function formatHora(iso) {
    return new Date(iso).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' })
  }

  function estadoOperativoColor(estado) {
    if (estado === 'operativo') return { bg: '#dcfce7', color: '#166534', label: 'Operativo' }
    if (estado === 'con_restriccion') return { bg: '#fef3c7', color: '#92400e', label: 'Con restricción' }
    return { bg: '#fee2e2', color: '#991b1b', label: 'Fuera de servicio' }
  }

  const card = (content, extra = {}) => ({
    background: 'white',
    borderRadius: '16px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.06)',
    padding: '1.5rem',
    ...extra
  })

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>

      {/* ── Header ── */}
      <div style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)', padding: '1.25rem 2rem', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button onClick={onVolver} style={{ padding: '0.5rem 1rem', background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem' }}>
              ← Menú
            </button>
            <div>
              <h1 style={{ color: 'white', fontSize: '1.4rem', fontWeight: '700', margin: 0 }}>
                📊 Panel de Flota
              </h1>
              <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.8rem', margin: 0 }}>
                {ultimaActualizacion && `Actualizado ${ultimaActualizacion.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' })}`}
              </p>
            </div>
          </div>
          <button onClick={cargarDatos} style={{ padding: '0.5rem 1.25rem', background: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.4)', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem' }}>
            🔄 Actualizar
          </button>
        </div>
      </div>

      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: 'clamp(1rem, 2vw, 2rem)' }}>

        {/* ── Fila 1: KPIs de estado ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          {[
            { label: 'Total activos', valor: totalEquipos, color: '#2563eb', bg: '#eff6ff', emoji: '🚛' },
            { label: 'Operativos', valor: operativos, color: '#16a34a', bg: '#f0fdf4', emoji: '✅' },
            { label: 'Con restricción', valor: conRestriccion, color: '#d97706', bg: '#fffbeb', emoji: '⚠️' },
            { label: 'Fuera de servicio', valor: fueraServicio, color: '#dc2626', bg: '#fef2f2', emoji: '🔴' },
            { label: 'En taller', valor: enTallerCount, color: '#7c3aed', bg: '#f5f3ff', emoji: '🔧' },
          ].map(({ label, valor, color, bg, emoji }) => (
            <div key={label} style={{ background: bg, borderRadius: '14px', padding: '1.25rem', border: `2px solid ${color}22` }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>{emoji}</div>
              <div style={{ fontSize: '2.5rem', fontWeight: '800', color, lineHeight: 1 }}>{valor}</div>
              <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem', fontWeight: '600' }}>{label}</div>
            </div>
          ))}
        </div>

        {/* ── Fila 2: Semáforo + Sin actividad ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>

          {/* Semáforo de flota */}
          <div style={card({})}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: '700', margin: 0, color: '#111827' }}>🚦 Semáforo de flota</h2>
              <span style={{
                fontSize: '0.78rem', fontWeight: '700', padding: '0.25rem 0.6rem', borderRadius: '8px',
                background: tendenciaRojo > 0 ? '#fee2e2' : tendenciaRojo < 0 ? '#dcfce7' : '#f3f4f6',
                color: tendenciaRojo > 0 ? '#dc2626' : tendenciaRojo < 0 ? '#16a34a' : '#6b7280'
              }}>
                {tendenciaRojo > 0 ? `↑ +${tendenciaRojo} rojos` : tendenciaRojo < 0 ? `↓ ${tendenciaRojo} rojos` : '= Sin cambio'} vs sem. ant.
              </span>
            </div>

            {[
              { label: 'Verde', count: semaforoVerde, pct: pctVerde, color: '#10b981', bg: '#d1fae5' },
              { label: 'Amarillo', count: semaforoAmarillo, pct: pctAmarillo, color: '#f59e0b', bg: '#fde68a' },
              { label: 'Rojo', count: semaforoRojo, pct: pctRojo, color: '#ef4444', bg: '#fecaca' },
            ].map(({ label, count, pct, color, bg }) => (
              <div key={label} style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <span style={{ fontWeight: '600', fontSize: '0.9rem', color: '#374151' }}>{label}</span>
                  <span style={{ fontWeight: '700', fontSize: '0.9rem', color }}>{count} equipos ({pct}%)</span>
                </div>
                <div style={{ height: '10px', background: '#f3f4f6', borderRadius: '99px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '99px', transition: 'width 0.6s ease' }} />
                </div>
              </div>
            ))}

            {semaforoSinDatos > 0 && (
              <p style={{ fontSize: '0.8rem', color: '#9ca3af', margin: '0.5rem 0 0 0' }}>
                {semaforoSinDatos} equipo{semaforoSinDatos > 1 ? 's' : ''} sin inspección registrada
              </p>
            )}
          </div>

          {/* Sin actividad reciente */}
          <div style={card({})}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: '700', margin: 0, color: '#111827' }}>
                ⏱️ Sin inspección reciente
              </h2>
              <span style={{ background: sinActividad.length > 0 ? '#fef3c7' : '#dcfce7', color: sinActividad.length > 0 ? '#92400e' : '#166534', fontWeight: '700', fontSize: '0.78rem', padding: '0.25rem 0.6rem', borderRadius: '8px' }}>
                {sinActividad.length} equipos
              </span>
            </div>

            {sinActividad.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 0', color: '#6b7280' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✅</div>
                <p style={{ margin: 0, fontSize: '0.9rem' }}>Toda la flota inspeccionada en los últimos 3 días</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '260px', overflowY: 'auto' }}>
                {sinActividad.slice(0, 10).map(eq => {
                  const est = estadoOperativoColor(eq.estado_operativo)
                  return (
                    <div key={eq.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.75rem', background: '#f9fafb', borderRadius: '8px', gap: '0.5rem' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: '700', fontSize: '0.875rem', color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {eq.numero_identificacion}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {eq.denominacion}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                        <span style={{ background: est.bg, color: est.color, fontSize: '0.7rem', fontWeight: '600', padding: '0.2rem 0.5rem', borderRadius: '6px' }}>
                          {est.label}
                        </span>
                        <span style={{ fontWeight: '800', fontSize: '0.85rem', color: eq.diasSinInspeccion === null ? '#dc2626' : eq.diasSinInspeccion > 7 ? '#dc2626' : '#d97706' }}>
                          {eq.diasSinInspeccion === null ? 'Sin registro' : `${eq.diasSinInspeccion}d`}
                        </span>
                      </div>
                    </div>
                  )
                })}
                {sinActividad.length > 10 && (
                  <p style={{ textAlign: 'center', fontSize: '0.8rem', color: '#9ca3af', margin: '0.25rem 0 0 0' }}>
                    +{sinActividad.length - 10} equipos más
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Fila 3: Fallas críticas ── */}
        {fallasCriticas.length > 0 && (
          <div style={{ ...card({}), marginBottom: '1.5rem', borderLeft: '4px solid #dc2626' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: '700', margin: 0, color: '#dc2626' }}>
                🚨 Fallas críticas últimos 7 días
              </h2>
              <span style={{ background: '#fee2e2', color: '#dc2626', fontWeight: '700', fontSize: '0.78rem', padding: '0.25rem 0.6rem', borderRadius: '8px' }}>
                {fallasCriticas.length} ítem{fallasCriticas.length > 1 ? 's' : ''}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '0.75rem' }}>
              {fallasCriticas.map((f, i) => (
                <div key={i} style={{ background: '#fff5f5', border: '1px solid #fecaca', borderRadius: '10px', padding: '0.875rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.35rem' }}>
                    <span style={{ fontWeight: '700', fontSize: '0.875rem', color: '#111827', flex: 1 }}>
                      {f.inspecciones?.equipos?.numero_identificacion || '—'}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#9ca3af', marginLeft: '0.5rem', flexShrink: 0 }}>
                      {f.inspecciones?.fecha_hora ? new Date(f.inspecciones.fecha_hora).toLocaleDateString('es-PY', { day: '2-digit', month: 'short' }) : ''}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#374151', margin: '0 0 0.25rem 0' }}>
                    ❌ {f.item_nombre}
                  </p>
                  {f.observacion && (
                    <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: 0, fontStyle: 'italic' }}>
                      💬 {f.observacion}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Fila 4: En taller ── */}
        {mantenimientos.length > 0 && (
          <div style={{ ...card({}), marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: '700', margin: 0, color: '#111827' }}>
                🔧 Equipos en taller
              </h2>
              <span style={{ background: '#f5f3ff', color: '#7c3aed', fontWeight: '700', fontSize: '0.78rem', padding: '0.25rem 0.6rem', borderRadius: '8px' }}>
                {mantenimientos.length} equipo{mantenimientos.length > 1 ? 's' : ''}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
              {mantenimientos.map(m => {
                const diasEnTaller = m.fecha_inicio
                  ? Math.floor((Date.now() - new Date(m.fecha_inicio).getTime()) / (1000 * 60 * 60 * 24))
                  : null
                const esEspera = m.estado === 'Taller Espera'
                return (
                  <div key={m.id} style={{ background: esEspera ? '#fffbeb' : '#f5f3ff', border: `1px solid ${esEspera ? '#fde68a' : '#ddd6fe'}`, borderRadius: '10px', padding: '0.875rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <span style={{ fontWeight: '700', fontSize: '0.875rem', color: '#111827' }}>
                        {m.equipos?.numero_identificacion}
                      </span>
                      <span style={{ fontSize: '0.72rem', fontWeight: '700', padding: '0.2rem 0.5rem', borderRadius: '6px', background: esEspera ? '#fde68a' : '#ddd6fe', color: esEspera ? '#92400e' : '#5b21b6' }}>
                        {m.estado}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.8rem', color: '#374151', margin: '0 0 0.25rem 0' }}>
                      {m.equipos?.denominacion}
                    </p>
                    {m.descripcion && (
                      <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: '0 0 0.25rem 0', fontStyle: 'italic' }}>
                        {m.descripcion.substring(0, 80)}{m.descripcion.length > 80 ? '…' : ''}
                      </p>
                    )}
                    {diasEnTaller !== null && (
                      <p style={{ fontSize: '0.75rem', fontWeight: '700', color: diasEnTaller > 5 ? '#dc2626' : '#6b7280', margin: 0 }}>
                        {diasEnTaller === 0 ? 'Ingresó hoy' : `${diasEnTaller} día${diasEnTaller > 1 ? 's' : ''} en taller`}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Fila 5: Actividad de hoy ── */}
        <div style={card({})}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: '700', margin: 0, color: '#111827' }}>
              📅 Actividad de hoy
            </h2>
            <span style={{ background: inspeccionesHoy.length > 0 ? '#eff6ff' : '#f3f4f6', color: inspeccionesHoy.length > 0 ? '#1d4ed8' : '#9ca3af', fontWeight: '700', fontSize: '0.78rem', padding: '0.25rem 0.6rem', borderRadius: '8px' }}>
              {inspeccionesHoy.length} inspección{inspeccionesHoy.length !== 1 ? 'es' : ''}
            </span>
          </div>

          {inspeccionesHoy.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: '#9ca3af' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📭</div>
              <p style={{ margin: 0, fontSize: '0.9rem' }}>Sin inspecciones registradas hoy</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {inspeccionesHoy.map(insp => {
                const colorSem = insp.semaforo === 'verde' ? '#10b981' : insp.semaforo === 'amarillo' ? '#f59e0b' : '#ef4444'
                return (
                  <div key={insp.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.6rem 0.75rem', background: '#f9fafb', borderRadius: '8px', flexWrap: 'wrap' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: colorSem, flexShrink: 0 }} />
                    <span style={{ fontWeight: '700', fontSize: '0.875rem', color: '#111827', minWidth: '100px' }}>
                      {insp.equipos?.numero_identificacion}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: '#6b7280', flex: 1 }}>
                      {insp.tipo_inspeccion?.replace('_', ' ')}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                      👤 {insp.usuarios?.nombre_completo || 'N/A'}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: '#9ca3af', flexShrink: 0 }}>
                      {formatHora(insp.fecha_hora)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

export default DashboardFlota
