import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import { toast } from './utils/ui'

// ============================================================
// ANALISTA DE MANTENIMIENTO CORRECTIVO
// Vistas: En Curso | Dashboard | Repuestos
// ============================================================

export default function AnalistaCorrectivo({ onVolver, onEditar }) {
  const [loading, setLoading] = useState(true)
  const [correctivos, setCorrectivos] = useState([])
  const [vista, setVista] = useState('en-curso') // 'en-curso' | 'dashboard' | 'repuestos'
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('activos') // 'activos' | 'todos' | 'Taller Espera' | 'Taller Entrada' | 'Taller Salida'
  const [filtroPrioridad, setFiltroPrioridad] = useState('todos')
  const [actualizando, setActualizando] = useState(null)
  const [expandido, setExpandido] = useState(null)

  useEffect(() => { cargarDatos() }, [])

  // ============================================================
  // CARGA DE DATOS
  // ============================================================
  async function cargarDatos() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('mantenimientos')
        .select(`
          *,
          equipos (
            id, numero_identificacion, denominacion, tipo_equipo,
            estado_operativo, es_critico, notas_criticidad
          )
        `)
        .eq('tipo_mantenimiento', 'Correctivo')
        .order('fecha_ingreso_taller', { ascending: false })

      if (error) throw error
      setCorrectivos(data || [])
    } catch (e) {
      toast('Error al cargar correctivos: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // ============================================================
  // CÁLCULOS
  // ============================================================
  function calcularDias(c) {
    const ingreso = new Date(c.fecha_ingreso_taller)
    const fin = c.fecha_liberacion ? new Date(c.fecha_liberacion) : new Date()
    return Math.max(0, Math.floor((fin - ingreso) / 86400000))
  }

  function calcularDowntime(c) {
    if (!c.fecha_inicio_averia) return null
    const inicio = new Date(c.fecha_inicio_averia)
    const fin = c.fecha_liberacion ? new Date(c.fecha_liberacion) : new Date()
    return Math.max(0, Math.floor((fin - inicio) / 86400000))
  }

  function calcularMTTR() {
    const cerrados = correctivos.filter(c => c.estado === 'Taller Salida' && c.fecha_liberacion)
    if (cerrados.length === 0) return null
    const suma = cerrados.reduce((acc, c) => acc + calcularDias(c), 0)
    return (suma / cerrados.length).toFixed(1)
  }

  function getDiasColor(dias, activo = true) {
    if (!activo) return { bg: '#f0fdf4', text: '#166534', border: '#bbf7d0' }
    if (dias <= 4)  return { bg: '#f0fdf4', text: '#166534', border: '#bbf7d0' }
    if (dias <= 9)  return { bg: '#fefce8', text: '#854d0e', border: '#fef08a' }
    if (dias <= 20) return { bg: '#fff7ed', text: '#9a3412', border: '#fed7aa' }
    return { bg: '#fef2f2', text: '#991b1b', border: '#fca5a5' }
  }

  function getPrioridadConfig(p) {
    switch (p) {
      case 'Muy Elevado': return { label: 'Muy Elevado', bg: '#fee2e2', text: '#991b1b', dot: '#ef4444' }
      case 'Alto':        return { label: 'Alto',        bg: '#fed7aa', text: '#9a3412', dot: '#f97316' }
      case 'Medio':
      case '3- Medio':   return { label: 'Medio',        bg: '#fef9c3', text: '#854d0e', dot: '#eab308' }
      case 'Bajo':       return { label: 'Bajo',         bg: '#d1fae5', text: '#065f46', dot: '#10b981' }
      default:           return { label: p || '—',       bg: '#f3f4f6', text: '#4b5563', dot: '#9ca3af' }
    }
  }

  function getEstadoConfig(e) {
    switch (e) {
      case 'Taller Espera':  return { label: 'En Espera',  bg: '#fef9c3', text: '#854d0e', icon: '⏳' }
      case 'Taller Entrada': return { label: 'En Taller',  bg: '#dbeafe', text: '#1e40af', icon: '🔧' }
      case 'Taller Salida':  return { label: 'Liberado',   bg: '#d1fae5', text: '#065f46', icon: '✅' }
      default:               return { label: e,            bg: '#f3f4f6', text: '#4b5563', icon: '❓' }
    }
  }

  function getSiguienteEstado(actual) {
    if (actual === 'Taller Espera')  return 'Taller Entrada'
    if (actual === 'Taller Entrada') return 'Taller Salida'
    return null
  }

  function getSiguienteLabel(actual) {
    if (actual === 'Taller Espera')  return '🔧 Iniciar reparación'
    if (actual === 'Taller Entrada') return '✅ Liberar equipo'
    return null
  }

  // ============================================================
  // ACCIONES
  // ============================================================
  async function cambiarEstado(c, nuevoEstado) {
    setActualizando(c.id)
    try {
      const updates = { estado: nuevoEstado }
      if (nuevoEstado === 'Taller Salida') {
        updates.fecha_liberacion = new Date().toISOString().split('T')[0]
      }
      const { error } = await supabase
        .from('mantenimientos').update(updates).eq('id', c.id)
      if (error) throw error
      toast(nuevoEstado === 'Taller Salida' ? '✅ Equipo liberado' : '✅ Estado actualizado')
      await cargarDatos()
    } catch (e) {
      toast('Error: ' + e.message)
    } finally {
      setActualizando(null)
    }
  }

  async function togglePedido(c) {
    try {
      const { error } = await supabase
        .from('mantenimientos')
        .update({ pedido: !c.pedido })
        .eq('id', c.id)
      if (error) throw error
      await cargarDatos()
    } catch (e) {
      toast('Error: ' + e.message)
    }
  }

  // ============================================================
  // FILTROS Y LISTAS DERIVADAS
  // ============================================================
  const activos = correctivos.filter(c => c.estado !== 'Taller Salida')
  const cerrados = correctivos.filter(c => c.estado === 'Taller Salida')

  const filtrados = correctivos.filter(c => {
    if (filtroEstado === 'activos' && c.estado === 'Taller Salida') return false
    if (filtroEstado !== 'activos' && filtroEstado !== 'todos' && c.estado !== filtroEstado) return false
    if (filtroPrioridad !== 'todos' && c.prioridad !== filtroPrioridad) return false
    if (busqueda) {
      const q = busqueda.toLowerCase()
      const match =
        c.equipos?.numero_identificacion?.toLowerCase().includes(q) ||
        c.equipos?.denominacion?.toLowerCase().includes(q) ||
        c.numero_aviso?.toLowerCase().includes(q) ||
        c.numero_orden?.toLowerCase().includes(q) ||
        c.descripcion_averia?.toLowerCase().includes(q)
      if (!match) return false
    }
    return true
  })

  // Ordenar: primero críticos, luego por prioridad, luego por días desc
  const prioridadOrden = { 'Muy Elevado': 0, 'Alto': 1, 'Medio': 2, '3- Medio': 2, 'Bajo': 3 }
  const ordenados = [...filtrados].sort((a, b) => {
    const aActivo = a.estado !== 'Taller Salida'
    const bActivo = b.estado !== 'Taller Salida'
    if (aActivo !== bActivo) return bActivo ? 1 : -1
    const pA = prioridadOrden[a.prioridad] ?? 4
    const pB = prioridadOrden[b.prioridad] ?? 4
    if (pA !== pB) return pA - pB
    return calcularDias(b) - calcularDias(a)
  })

  // ============================================================
  // KPIs
  // ============================================================
  const mttr = calcularMTTR()
  const kpis = {
    enTaller:        activos.length,
    enEspera:        activos.filter(c => c.estado === 'Taller Espera').length,
    enReparacion:    activos.filter(c => c.estado === 'Taller Entrada').length,
    sinOrden:        activos.filter(c => !c.numero_orden).length,
    sinPedido:       activos.filter(c => !c.pedido).length,
    criticosDetenidos: activos.filter(c => c.equipos?.es_critico).length,
    urgentes:        activos.filter(c => calcularDias(c) > 10).length,
    mttr,
    totalCerrados:   cerrados.length,
  }

  // Top equipos por correctivos
  const porEquipo = {}
  correctivos.forEach(c => {
    const key = c.equipos?.numero_identificacion || 'N/A'
    if (!porEquipo[key]) porEquipo[key] = { codigo: key, denominacion: c.equipos?.denominacion, total: 0, activos: 0, diasTotal: 0 }
    porEquipo[key].total++
    if (c.estado !== 'Taller Salida') porEquipo[key].activos++
    porEquipo[key].diasTotal += calcularDias(c)
  })
  const topEquipos = Object.values(porEquipo)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)

  // Aging buckets de activos
  const aging = { '0-4 días': 0, '5-9 días': 0, '10-20 días': 0, '+20 días': 0 }
  activos.forEach(c => {
    const d = calcularDias(c)
    if (d <= 4) aging['0-4 días']++
    else if (d <= 9) aging['5-9 días']++
    else if (d <= 20) aging['10-20 días']++
    else aging['+20 días']++
  })
  const agingMax = Math.max(...Object.values(aging), 1)

  if (loading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⚙️</div>
        <p style={{ color: '#6b7280', fontSize: '1.1rem' }}>Cargando correctivos...</p>
      </div>
    )
  }

  // ============================================================
  // RENDER HEADER + KPI STRIP
  // ============================================================
  const renderHeader = () => (
    <div style={{ marginBottom: '1.5rem' }}>
      {/* Barra superior */}
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: '1.25rem 1.5rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        marginBottom: '1rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: '700', margin: 0, color: '#1f2937' }}>
            🔴 Analista de Mantenimiento Correctivo
          </h1>
          <p style={{ margin: '0.25rem 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
            Seguimiento de reparaciones · Minimizar downtime
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Tabs */}
          {[
            { id: 'en-curso',   icon: '📋', label: 'En Curso' },
            { id: 'dashboard',  icon: '📊', label: 'Dashboard' },
            { id: 'repuestos',  icon: '🔩', label: 'Repuestos' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setVista(tab.id)}
              style={{
                padding: '0.5rem 1rem',
                background: vista === tab.id ? '#f97316' : '#f3f4f6',
                color: vista === tab.id ? 'white' : '#4b5563',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '0.875rem',
                transition: 'all 0.15s'
              }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
          <button
            onClick={onVolver}
            style={{
              padding: '0.5rem 1rem',
              background: '#6b7280',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '0.875rem'
            }}
          >
            ← Volver
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: '0.75rem'
      }}>
        {[
          { valor: kpis.enTaller,          label: 'En Taller',         color: '#f97316', bg: '#fff7ed', icon: '🔧' },
          { valor: kpis.enEspera,           label: 'En Espera',         color: '#eab308', bg: '#fefce8', icon: '⏳' },
          { valor: kpis.enReparacion,       label: 'En Reparación',     color: '#3b82f6', bg: '#eff6ff', icon: '⚙️' },
          { valor: kpis.urgentes,           label: '>10 días',           color: '#ef4444', bg: '#fef2f2', icon: '🚨', alerta: kpis.urgentes > 0 },
          { valor: kpis.criticosDetenidos,  label: 'Críticos',          color: '#dc2626', bg: '#fef2f2', icon: '⚠️', alerta: kpis.criticosDetenidos > 0 },
          { valor: kpis.sinOrden,           label: 'Sin N° Orden',      color: '#8b5cf6', bg: '#f5f3ff', icon: '📄' },
          { valor: kpis.sinPedido,          label: 'Sin Repuesto',      color: '#6b7280', bg: '#f9fafb', icon: '🔩' },
          { valor: kpis.mttr != null ? `${kpis.mttr}d` : '—', label: 'MTTR', color: '#0891b2', bg: '#ecfeff', icon: '📈' },
        ].map((kpi, i) => (
          <div key={i} style={{
            background: kpi.alerta ? kpi.bg : 'white',
            border: `2px solid ${kpi.alerta ? kpi.color : '#e5e7eb'}`,
            borderRadius: '10px',
            padding: '0.75rem 1rem',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
          }}>
            <div style={{ fontSize: '1.2rem', marginBottom: '0.15rem' }}>{kpi.icon}</div>
            <div style={{ fontSize: '1.6rem', fontWeight: '700', color: kpi.color, lineHeight: 1 }}>
              {kpi.valor}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#6b7280', marginTop: '0.2rem', fontWeight: '500' }}>
              {kpi.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  // ============================================================
  // VISTA: EN CURSO
  // ============================================================
  const renderEnCurso = () => (
    <div>
      {/* Filtros */}
      <div style={{
        background: 'white',
        borderRadius: '10px',
        padding: '1rem 1.25rem',
        boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
        marginBottom: '1rem',
        display: 'flex',
        gap: '0.75rem',
        flexWrap: 'wrap',
        alignItems: 'center'
      }}>
        <input
          type="text"
          placeholder="🔍 Buscar equipo, aviso, orden, descripción..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          style={{
            flex: 1, minWidth: '220px',
            padding: '0.5rem 0.75rem',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            fontSize: '0.875rem'
          }}
        />
        <select
          value={filtroEstado}
          onChange={e => setFiltroEstado(e.target.value)}
          style={{ padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '0.875rem', background: 'white' }}
        >
          <option value="activos">Activos (todos)</option>
          <option value="Taller Espera">Solo En Espera</option>
          <option value="Taller Entrada">Solo En Reparación</option>
          <option value="Taller Salida">Liberados</option>
          <option value="todos">Todos (historial)</option>
        </select>
        <select
          value={filtroPrioridad}
          onChange={e => setFiltroPrioridad(e.target.value)}
          style={{ padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '0.875rem', background: 'white' }}
        >
          <option value="todos">Todas las prioridades</option>
          <option value="Muy Elevado">🔴 Muy Elevado</option>
          <option value="Alto">🟠 Alto</option>
          <option value="Medio">🟡 Medio</option>
          <option value="Bajo">🟢 Bajo</option>
        </select>
        <button
          onClick={cargarDatos}
          style={{
            padding: '0.5rem 1rem',
            background: '#f3f4f6',
            color: '#374151',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: '500'
          }}
        >
          🔄 Actualizar
        </button>
        <span style={{ fontSize: '0.8rem', color: '#9ca3af', marginLeft: 'auto' }}>
          {ordenados.length} registro{ordenados.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Tabla */}
      {ordenados.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
          <p style={{ fontSize: '1.1rem' }}>Sin correctivos para los filtros actuales</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {ordenados.map(c => {
            const dias = calcularDias(c)
            const downtime = calcularDowntime(c)
            const activo = c.estado !== 'Taller Salida'
            const diasCol = getDiasColor(dias, activo)
            const prio = getPrioridadConfig(c.prioridad)
            const est = getEstadoConfig(c.estado)
            const sigEstado = getSiguienteEstado(c.estado)
            const sigLabel = getSiguienteLabel(c.estado)
            const esExpandido = expandido === c.id

            return (
              <div key={c.id} style={{
                background: 'white',
                borderRadius: '10px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
                border: c.equipos?.es_critico && activo ? '2px solid #ef4444' : '1px solid #e5e7eb',
                overflow: 'hidden',
                transition: 'box-shadow 0.15s'
              }}>
                {/* Fila principal */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto auto auto auto',
                    gap: '0',
                    alignItems: 'center',
                    padding: '0.75rem 1rem',
                    cursor: 'pointer'
                  }}
                  onClick={() => setExpandido(esExpandido ? null : c.id)}
                >
                  {/* Indicador días */}
                  <div style={{
                    background: diasCol.bg,
                    color: diasCol.text,
                    border: `1px solid ${diasCol.border}`,
                    borderRadius: '8px',
                    padding: '0.4rem 0.6rem',
                    textAlign: 'center',
                    minWidth: '60px',
                    marginRight: '1rem'
                  }}>
                    <div style={{ fontSize: '1.3rem', fontWeight: '700', lineHeight: 1 }}>{dias}</div>
                    <div style={{ fontSize: '0.65rem', fontWeight: '500' }}>días</div>
                  </div>

                  {/* Info principal */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: '700', color: '#1f2937', fontSize: '0.95rem' }}>
                        {c.equipos?.numero_identificacion || '—'}
                      </span>
                      {c.equipos?.denominacion && (
                        <span style={{ color: '#6b7280', fontSize: '0.85rem' }}>
                          · {c.equipos.denominacion}
                        </span>
                      )}
                      {c.equipos?.es_critico && activo && (
                        <span style={{ fontSize: '0.7rem', background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: '4px', padding: '0.1rem 0.4rem', fontWeight: '600' }}>
                          CRÍTICO
                        </span>
                      )}
                    </div>
                    <div style={{ color: '#4b5563', fontSize: '0.82rem', marginTop: '0.2rem' }}>
                      {c.descripcion_averia?.length > 90
                        ? c.descripcion_averia.slice(0, 90) + '…'
                        : c.descripcion_averia}
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.3rem', flexWrap: 'wrap' }}>
                      {c.numero_aviso && (
                        <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                          Aviso: <strong>{c.numero_aviso}</strong>
                        </span>
                      )}
                      {c.numero_orden && (
                        <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                          Orden: <strong>{c.numero_orden}</strong>
                        </span>
                      )}
                      {!c.numero_orden && activo && (
                        <span style={{ fontSize: '0.75rem', color: '#9a3412', background: '#fff7ed', borderRadius: '4px', padding: '0.1rem 0.35rem' }}>
                          ⚠️ Sin orden
                        </span>
                      )}
                      <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                        {c.ingresa_taller_ypane ? '🏭 Ypané' : `🏗️ ${c.taller_tercero || 'Tercero'}`}
                      </span>
                    </div>
                  </div>

                  {/* Prioridad */}
                  <div style={{
                    background: prio.bg, color: prio.text,
                    borderRadius: '6px', padding: '0.3rem 0.6rem',
                    fontSize: '0.75rem', fontWeight: '600',
                    marginLeft: '0.5rem', whiteSpace: 'nowrap'
                  }}>
                    <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: prio.dot, marginRight: '4px', verticalAlign: 'middle' }} />
                    {prio.label}
                  </div>

                  {/* Estado */}
                  <div style={{
                    background: est.bg, color: est.text,
                    borderRadius: '6px', padding: '0.3rem 0.6rem',
                    fontSize: '0.75rem', fontWeight: '600',
                    marginLeft: '0.5rem', whiteSpace: 'nowrap'
                  }}>
                    {est.icon} {est.label}
                  </div>

                  {/* Pedido badge */}
                  <div style={{ marginLeft: '0.5rem', whiteSpace: 'nowrap' }}>
                    {activo ? (
                      <span style={{
                        fontSize: '0.72rem', fontWeight: '600',
                        background: c.pedido ? '#d1fae5' : '#fef9c3',
                        color: c.pedido ? '#065f46' : '#854d0e',
                        borderRadius: '6px', padding: '0.25rem 0.5rem'
                      }}>
                        {c.pedido ? '🔩 Pedido' : '❌ Sin pedido'}
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>—</span>
                    )}
                  </div>

                  {/* Expandir */}
                  <div style={{ marginLeft: '0.5rem', color: '#9ca3af', fontSize: '1rem' }}>
                    {esExpandido ? '▲' : '▼'}
                  </div>
                </div>

                {/* Panel expandido */}
                {esExpandido && (
                  <div style={{
                    borderTop: '1px solid #f3f4f6',
                    padding: '1rem 1.25rem',
                    background: '#fafafa',
                    display: 'flex',
                    gap: '1rem',
                    flexWrap: 'wrap',
                    alignItems: 'flex-start'
                  }}>
                    {/* Datos del correctivo */}
                    <div style={{ flex: 1, minWidth: '220px' }}>
                      <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#6b7280', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Detalle
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem 1rem' }}>
                        {[
                          ['Ingreso taller', c.fecha_ingreso_taller],
                          ['Inicio avería', c.fecha_inicio_averia || '—'],
                          ['Liberación', c.fecha_liberacion || activo ? (activo ? 'Pendiente' : c.fecha_liberacion) : '—'],
                          ['Downtime total', downtime != null ? `${downtime} días` : '—'],
                          ['Tipo equipo', c.equipos?.tipo_equipo || '—'],
                          ['Taller', c.ingresa_taller_ypane ? 'Complejo Ypané' : (c.taller_tercero || 'Tercero')],
                        ].map(([lbl, val], i) => (
                          <div key={i}>
                            <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{lbl}: </span>
                            <span style={{ fontSize: '0.8rem', color: '#374151', fontWeight: '500' }}>{val}</span>
                          </div>
                        ))}
                      </div>
                      {c.descripcion_averia && (
                        <div style={{ marginTop: '0.5rem' }}>
                          <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Descripción: </span>
                          <span style={{ fontSize: '0.8rem', color: '#374151' }}>{c.descripcion_averia}</span>
                        </div>
                      )}
                    </div>

                    {/* Acciones */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '180px' }}>
                      <p style={{ margin: '0 0 0.25rem', fontSize: '0.8rem', color: '#6b7280', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Acciones
                      </p>
                      {sigEstado && (
                        <button
                          onClick={() => cambiarEstado(c, sigEstado)}
                          disabled={actualizando === c.id}
                          style={{
                            padding: '0.6rem 1rem',
                            background: sigEstado === 'Taller Salida' ? '#10b981' : '#3b82f6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontWeight: '600',
                            fontSize: '0.85rem',
                            opacity: actualizando === c.id ? 0.6 : 1
                          }}
                        >
                          {actualizando === c.id ? '⏳ Guardando...' : sigLabel}
                        </button>
                      )}
                      {activo && (
                        <button
                          onClick={() => togglePedido(c)}
                          style={{
                            padding: '0.6rem 1rem',
                            background: c.pedido ? '#fef9c3' : '#f3f4f6',
                            color: c.pedido ? '#854d0e' : '#374151',
                            border: `1px solid ${c.pedido ? '#fde68a' : '#d1d5db'}`,
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontWeight: '600',
                            fontSize: '0.85rem'
                          }}
                        >
                          {c.pedido ? '🔩 Marcar sin pedido' : '🔩 Marcar pedido realizado'}
                        </button>
                      )}
                      {onEditar && (
                        <button
                          onClick={() => onEditar(c)}
                          style={{
                            padding: '0.6rem 1rem',
                            background: '#f3f4f6',
                            color: '#374151',
                            border: '1px solid #d1d5db',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontWeight: '500',
                            fontSize: '0.85rem'
                          }}
                        >
                          ✏️ Editar
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  // ============================================================
  // VISTA: DASHBOARD
  // ============================================================
  const renderDashboard = () => {
    const agingColors = {
      '0-4 días':  { bg: '#d1fae5', bar: '#10b981', text: '#065f46' },
      '5-9 días':  { bg: '#fef9c3', bar: '#eab308', text: '#854d0e' },
      '10-20 días':{ bg: '#fed7aa', bar: '#f97316', text: '#9a3412' },
      '+20 días':  { bg: '#fee2e2', bar: '#ef4444', text: '#991b1b' },
    }

    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem' }}>

        {/* AGING */}
        <div style={{ background: 'white', borderRadius: '12px', padding: '1.25rem', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: '700', margin: '0 0 1rem', color: '#1f2937' }}>
            ⏱️ Aging de Reparaciones Activas
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {Object.entries(aging).map(([rango, qty]) => {
              const cfg = agingColors[rango]
              const pct = agingMax > 0 ? Math.round((qty / agingMax) * 100) : 0
              return (
                <div key={rango}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: '600', color: cfg.text }}>{rango}</span>
                    <span style={{ fontSize: '0.85rem', fontWeight: '700', color: cfg.text }}>{qty}</span>
                  </div>
                  <div style={{ height: '10px', background: '#f3f4f6', borderRadius: '99px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: cfg.bar,
                      borderRadius: '99px',
                      transition: 'width 0.4s ease'
                    }} />
                  </div>
                </div>
              )
            })}
            {activos.length === 0 && (
              <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: '0.875rem' }}>Sin activos</p>
            )}
          </div>
          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>Total activos</span>
            <span style={{ fontSize: '1.1rem', fontWeight: '700', color: '#f97316' }}>{activos.length}</span>
          </div>
        </div>

        {/* MTTR */}
        <div style={{ background: 'white', borderRadius: '12px', padding: '1.25rem', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: '700', margin: '0 0 1rem', color: '#1f2937' }}>
            📈 MTTR — Tiempo Medio de Reparación
          </h2>
          <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
            <div style={{
              fontSize: '3.5rem', fontWeight: '700',
              color: kpis.mttr != null ? '#0891b2' : '#9ca3af',
              lineHeight: 1
            }}>
              {kpis.mttr != null ? kpis.mttr : '—'}
            </div>
            <div style={{ fontSize: '1rem', color: '#6b7280', marginTop: '0.5rem' }}>
              {kpis.mttr != null ? 'días promedio en taller' : 'Sin datos de correctivos cerrados'}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.5rem' }}>
            {[
              { label: 'Completados', valor: kpis.totalCerrados, color: '#10b981' },
              { label: 'En proceso', valor: kpis.enTaller, color: '#f97316' },
            ].map((item, i) => (
              <div key={i} style={{
                background: '#f9fafb', borderRadius: '8px',
                padding: '0.75rem', textAlign: 'center'
              }}>
                <div style={{ fontSize: '1.5rem', fontWeight: '700', color: item.color }}>{item.valor}</div>
                <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{item.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* TOP EQUIPOS */}
        <div style={{ background: 'white', borderRadius: '12px', padding: '1.25rem', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', gridColumn: 'span 1' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: '700', margin: '0 0 1rem', color: '#1f2937' }}>
            🏆 Equipos con más Correctivos
          </h2>
          {topEquipos.length === 0 ? (
            <p style={{ color: '#9ca3af', textAlign: 'center' }}>Sin datos</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {topEquipos.map((eq, i) => (
                <div key={eq.codigo} style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: '0.6rem 0.75rem',
                  background: i === 0 ? '#fff7ed' : '#f9fafb',
                  borderRadius: '8px',
                  border: i === 0 ? '1px solid #fed7aa' : '1px solid #f3f4f6'
                }}>
                  <span style={{ fontSize: '1.1rem', minWidth: '24px', textAlign: 'center' }}>
                    {i === 0 ? '🔴' : i === 1 ? '🟠' : i === 2 ? '🟡' : '⚪'}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: '700', color: '#1f2937' }}>
                      {eq.codigo}
                    </div>
                    {eq.denominacion && (
                      <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{eq.denominacion}</div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1rem', fontWeight: '700', color: '#f97316' }}>{eq.total}</div>
                    {eq.activos > 0 && (
                      <div style={{ fontSize: '0.7rem', color: '#ef4444' }}>{eq.activos} activo{eq.activos !== 1 ? 's' : ''}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ESTADO GENERAL */}
        <div style={{ background: 'white', borderRadius: '12px', padding: '1.25rem', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: '700', margin: '0 0 1rem', color: '#1f2937' }}>
            📋 Estado General de Reparaciones
          </h2>
          {[
            { label: 'En Espera (sin iniciar)',  qty: kpis.enEspera,     color: '#eab308', bg: '#fefce8' },
            { label: 'En Reparación (activas)',  qty: kpis.enReparacion,  color: '#3b82f6', bg: '#eff6ff' },
            { label: 'Sin N° de Orden asignado', qty: kpis.sinOrden,      color: '#8b5cf6', bg: '#f5f3ff' },
            { label: 'Sin repuesto pedido',      qty: kpis.sinPedido,     color: '#6b7280', bg: '#f9fafb' },
            { label: 'Equipos críticos detenidos', qty: kpis.criticosDetenidos, color: '#ef4444', bg: '#fef2f2' },
            { label: 'Urgentes (>10 días)',      qty: kpis.urgentes,      color: '#dc2626', bg: '#fef2f2' },
          ].map((item, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '0.6rem 0.75rem',
              background: item.qty > 0 ? item.bg : '#f9fafb',
              borderRadius: '8px', marginBottom: '0.4rem'
            }}>
              <span style={{ fontSize: '0.85rem', color: item.qty > 0 ? item.color : '#9ca3af', fontWeight: item.qty > 0 ? '500' : '400' }}>
                {item.label}
              </span>
              <span style={{
                fontWeight: '700', fontSize: '1.1rem',
                color: item.qty > 0 ? item.color : '#d1d5db'
              }}>
                {item.qty}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ============================================================
  // VISTA: REPUESTOS
  // ============================================================
  const renderRepuestos = () => {
    const sinPedido = activos.filter(c => !c.pedido).sort((a, b) => {
      const pA = prioridadOrden[a.prioridad] ?? 4
      const pB = prioridadOrden[b.prioridad] ?? 4
      return pA - pB
    })
    const conPedido = activos.filter(c => c.pedido)

    const CardRepuesto = ({ c, pendiente }) => {
      const prio = getPrioridadConfig(c.prioridad)
      const est = getEstadoConfig(c.estado)
      const dias = calcularDias(c)
      return (
        <div style={{
          background: 'white',
          borderRadius: '10px',
          padding: '0.9rem 1.1rem',
          border: pendiente ? '1px solid #fed7aa' : '1px solid #bbf7d0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          display: 'flex',
          gap: '0.75rem',
          alignItems: 'center',
          flexWrap: 'wrap'
        }}>
          <div style={{ flex: 1, minWidth: '180px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: '700', color: '#1f2937' }}>{c.equipos?.numero_identificacion || '—'}</span>
              {c.equipos?.denominacion && <span style={{ color: '#6b7280', fontSize: '0.82rem' }}>· {c.equipos.denominacion}</span>}
              <span style={{
                fontSize: '0.7rem', background: prio.bg, color: prio.text,
                borderRadius: '4px', padding: '0.1rem 0.35rem', fontWeight: '600'
              }}>{prio.label}</span>
            </div>
            <div style={{ fontSize: '0.82rem', color: '#4b5563', marginTop: '0.2rem' }}>
              {c.descripcion_averia?.length > 80 ? c.descripcion_averia.slice(0, 80) + '…' : c.descripcion_averia}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.2rem' }}>
              {c.numero_aviso ? `Aviso ${c.numero_aviso}` : ''}
              {c.numero_aviso && c.numero_orden ? ' · ' : ''}
              {c.numero_orden ? `Orden ${c.numero_orden}` : ''}
              {' · '}{dias} día{dias !== 1 ? 's' : ''} en taller
              {' · '}{est.icon} {est.label}
            </div>
          </div>
          <button
            onClick={() => togglePedido(c)}
            style={{
              padding: '0.6rem 1rem',
              background: pendiente ? '#f97316' : '#d1fae5',
              color: pendiente ? 'white' : '#065f46',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '0.82rem',
              whiteSpace: 'nowrap'
            }}
          >
            {pendiente ? '🔩 Marcar como pedido' : '↩️ Desmarcar'}
          </button>
        </div>
      )
    }

    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1.5rem' }}>

        {/* Sin pedido */}
        <div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            marginBottom: '0.75rem'
          }}>
            <h2 style={{ fontSize: '1rem', fontWeight: '700', margin: 0, color: '#9a3412' }}>
              ⚠️ Sin Repuesto Pedido ({sinPedido.length})
            </h2>
          </div>
          {sinPedido.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af', background: 'white', borderRadius: '10px' }}>
              ✅ Todos los correctivos tienen repuesto pedido
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {sinPedido.map(c => <CardRepuesto key={c.id} c={c} pendiente={true} />)}
            </div>
          )}
        </div>

        {/* Con pedido */}
        <div>
          <h2 style={{ fontSize: '1rem', fontWeight: '700', margin: '0 0 0.75rem', color: '#065f46' }}>
            ✅ Repuesto Pedido ({conPedido.length})
          </h2>
          {conPedido.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af', background: 'white', borderRadius: '10px' }}>
              Sin correctivos con repuesto pedido
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {conPedido.map(c => <CardRepuesto key={c.id} c={c} pendiente={false} />)}
            </div>
          )}
        </div>

        {/* Nota informativa */}
        <div style={{
          background: '#eff6ff',
          border: '1px solid #bfdbfe',
          borderRadius: '10px',
          padding: '1rem 1.25rem',
          gridColumn: '1 / -1'
        }}>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#1e40af' }}>
            💡 <strong>Próxima mejora:</strong> Para rastrear los repuestos con más detalle (número de parte, descripción, proveedor, fecha estimada de arribo), se puede agregar una tabla <code>repuestos_mantenimiento</code> en Supabase y vincularla a cada correctivo. Pedime que te prepare la migración SQL y el formulario de carga cuando estés listo.
          </p>
        </div>
      </div>
    )
  }

  // ============================================================
  // RENDER PRINCIPAL
  // ============================================================
  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', padding: 'clamp(1rem, 2vw, 1.5rem)' }}>
      {renderHeader()}
      {vista === 'en-curso'  && renderEnCurso()}
      {vista === 'dashboard' && renderDashboard()}
      {vista === 'repuestos' && renderRepuestos()}
    </div>
  )
}
