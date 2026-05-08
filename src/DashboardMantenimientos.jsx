import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'

function DashboardMantenimientos({ onVolver }) {
  const [loading, setLoading] = useState(true)
  const [mantenimientos, setMantenimientos] = useState([])
  const [equipos, setEquipos] = useState([])
  const [vista, setVista] = useState('overview') // 'overview', 'planner', 'analisis'
  
  // Filtros
  const [filtroTipoEquipo, setFiltroTipoEquipo] = useState('todos')
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [filtroPrioridad, setFiltroPrioridad] = useState('todos')
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('')
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('')
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    cargarDatos()
  }, [])

  async function cargarDatos() {
    try {
      setLoading(true)

      // Cargar mantenimientos con relaciones
      const { data: mantData, error: errorMant } = await supabase
        .from('mantenimientos')
        .select(`
          *,
          equipos (
            id,
            numero_identificacion,
            tipo_equipo,
            denominacion,
            estado_operativo,
            es_critico,
            notas_criticidad
          )
        `)
        .order('created_at', { ascending: false })

      if (errorMant) throw errorMant

      // Cargar todos los equipos para estadísticas
      const { data: equiposData, error: errorEquipos } = await supabase
        .from('equipos')
        .select('*')

      if (errorEquipos) throw errorEquipos

      setMantenimientos(mantData || [])
      setEquipos(equiposData || [])

    } catch (error) {
      console.error('Error:', error)
      alert('Error al cargar datos: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  // ============================================
  // FUNCIONES DE CÁLCULO
  // ============================================

  function calcularDiasEnEspera(mantenimiento) {
    if (!mantenimiento.fecha_inicio_averia || !mantenimiento.fecha_ingreso_taller) return 0
    const inicio = new Date(mantenimiento.fecha_inicio_averia)
    const ingreso = new Date(mantenimiento.fecha_ingreso_taller)
    const diff = Math.floor((ingreso - inicio) / (1000 * 60 * 60 * 24))
    return diff >= 0 ? diff : 0
  }

  function calcularDiasEnTaller(mantenimiento) {
    const ingreso = new Date(mantenimiento.fecha_ingreso_taller)
    const salida = mantenimiento.fecha_liberacion 
      ? new Date(mantenimiento.fecha_liberacion)
      : new Date()
    const diff = Math.floor((salida - ingreso) / (1000 * 60 * 60 * 24))
    return diff >= 0 ? diff : 0
  }

  function calcularTiempoTotal(mantenimiento) {
    if (!mantenimiento.fecha_inicio_averia) return 0
    const inicio = new Date(mantenimiento.fecha_inicio_averia)
    const fin = mantenimiento.fecha_liberacion 
      ? new Date(mantenimiento.fecha_liberacion)
      : new Date()
    const diff = Math.floor((fin - inicio) / (1000 * 60 * 60 * 24))
    return diff >= 0 ? diff : 0
  }

  // Filtrar mantenimientos
  const mantenimientosFiltrados = mantenimientos.filter(mant => {
    const matchTipoEquipo = filtroTipoEquipo === 'todos' || 
      mant.equipos?.tipo_equipo === filtroTipoEquipo
    
    const matchEstado = filtroEstado === 'todos' || mant.estado === filtroEstado
    
    const matchPrioridad = filtroPrioridad === 'todos' || mant.prioridad === filtroPrioridad
    
    const matchBusqueda = !busqueda || 
      mant.equipos?.numero_identificacion?.toLowerCase().includes(busqueda.toLowerCase()) ||
      mant.numero_aviso?.toLowerCase().includes(busqueda.toLowerCase()) ||
      mant.descripcion_averia?.toLowerCase().includes(busqueda.toLowerCase())

    // Filtro de fechas
    let matchFecha = true
    if (filtroFechaDesde) {
      const fechaInicio = new Date(mant.fecha_inicio_averia)
      const desde = new Date(filtroFechaDesde)
      matchFecha = fechaInicio >= desde
    }
    if (filtroFechaHasta && matchFecha) {
      const fechaInicio = new Date(mant.fecha_inicio_averia)
      const hasta = new Date(filtroFechaHasta)
      matchFecha = fechaInicio <= hasta
    }

    return matchTipoEquipo && matchEstado && matchPrioridad && matchBusqueda && matchFecha
  })

  // ============================================
  // ESTADÍSTICAS
  // ============================================

  const stats = {
    // Mantenimientos activos (no completados)
    activos: mantenimientosFiltrados.filter(m => m.estado !== 'Taller Salida'),
    
    // Por estado
    esperandoTurno: mantenimientosFiltrados.filter(m => m.estado === 'Taller Espera').length,
    enTaller: mantenimientosFiltrados.filter(m => m.estado === 'Taller Entrada').length,
    completados: mantenimientosFiltrados.filter(m => m.estado === 'Taller Salida').length,
    
    // Por prioridad
    muyElevado: mantenimientosFiltrados.filter(m => m.prioridad === 'Muy Elevado' && m.estado !== 'Taller Salida').length,
    alto: mantenimientosFiltrados.filter(m => m.prioridad === 'Alto' && m.estado !== 'Taller Salida').length,
    
    // Equipos críticos afectados
    criticosAfectados: mantenimientosFiltrados.filter(m => 
      m.equipos?.es_critico && m.estado !== 'Taller Salida'
    ).length,
    
    // Avisos con más de 5 días
    masde5Dias: mantenimientosFiltrados.filter(m => {
      const dias = calcularTiempoTotal(m)
      return dias > 5 && m.estado !== 'Taller Salida'
    }).length,

    // Tiempo promedio de reparación (solo completados)
    tiempoPromedioReparacion: (() => {
      const completados = mantenimientos.filter(m => m.estado === 'Taller Salida' && m.fecha_liberacion)
      if (completados.length === 0) return 0
      const suma = completados.reduce((acc, m) => acc + calcularDiasEnTaller(m), 0)
      return (suma / completados.length).toFixed(1)
    })(),

    // Equipos detenidos (únicos)
    equiposDetenidos: new Set(
      mantenimientosFiltrados
        .filter(m => m.estado === 'Taller Espera' || m.estado === 'Taller Entrada')
        .map(m => m.equipo_id)
    ).size
  }

  // Avisos por tipo de equipo
  const avisosPorTipo = {}
  mantenimientosFiltrados.filter(m => m.estado !== 'Taller Salida').forEach(m => {
    const tipo = m.equipos?.tipo_equipo || 'Sin especificar'
    avisosPorTipo[tipo] = (avisosPorTipo[tipo] || 0) + 1
  })

  const tiposOrdenados = Object.entries(avisosPorTipo)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10) // Top 10

  // Tipos de equipo únicos para filtro
  const tiposEquipoUnicos = [...new Set(mantenimientos.map(m => m.equipos?.tipo_equipo).filter(Boolean))]

  // ============================================
  // FUNCIONES AUXILIARES
  // ============================================

  function getPrioridadColor(prioridad) {
    switch(prioridad) {
      case 'Muy Elevado': return { bg: '#fee2e2', text: '#991b1b', border: '#ef4444' }
      case 'Alto': return { bg: '#fed7aa', text: '#9a3412', border: '#f97316' }
      case 'Medio': return { bg: '#fef3c7', text: '#92400e', border: '#f59e0b' }
      case 'Bajo': return { bg: '#d1fae5', text: '#065f46', border: '#10b981' }
      default: return { bg: '#f3f4f6', text: '#4b5563', border: '#9ca3af' }
    }
  }

  function getEstadoColor(estado) {
    switch(estado) {
      case 'Taller Espera': return { bg: '#fef3c7', text: '#92400e' }
      case 'Taller Entrada': return { bg: '#dbeafe', text: '#1e40af' }
      case 'Taller Salida': return { bg: '#d1fae5', text: '#065f46' }
      default: return { bg: '#f3f4f6', text: '#4b5563' }
    }
  }

  function getPrioridadEmoji(prioridad) {
    switch(prioridad) {
      case 'Muy Elevado': return '🔴'
      case 'Alto': return '🟠'
      case 'Medio': return '🟡'
      case 'Bajo': return '🟢'
      default: return '⚪'
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <p style={{ fontSize: '1.2rem', color: '#6b7280' }}>Cargando dashboard...</p>
      </div>
    )
  }

  // ============================================
  // RENDER: HEADER
  // ============================================

  const renderHeader = () => (
    <div style={{
      background: 'white',
      padding: '1.5rem',
      borderRadius: '12px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
      marginBottom: '2rem'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 'bold', margin: 0, marginBottom: '0.5rem' }}>
            🔧 Dashboard de Mantenimientos
          </h1>
          <p style={{ color: '#6b7280', margin: 0 }}>
            Gestión y seguimiento de avisos de mantenimiento
          </p>
        </div>
        
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {/* Pestañas */}
          <div style={{ display: 'flex', gap: '0.5rem', background: '#f3f4f6', padding: '0.25rem', borderRadius: '8px' }}>
            <button
              onClick={() => setVista('overview')}
              style={{
                padding: '0.5rem 1rem',
                background: vista === 'overview' ? '#667eea' : 'transparent',
                color: vista === 'overview' ? 'white' : '#4b5563',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '0.875rem'
              }}
            >
              📊 Overview
            </button>
            <button
              onClick={() => setVista('planner')}
              style={{
                padding: '0.5rem 1rem',
                background: vista === 'planner' ? '#667eea' : 'transparent',
                color: vista === 'planner' ? 'white' : '#4b5563',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '0.875rem'
              }}
            >
              🔧 Planner
            </button>
            <button
              onClick={() => setVista('analisis')}
              style={{
                padding: '0.5rem 1rem',
                background: vista === 'analisis' ? '#667eea' : 'transparent',
                color: vista === 'analisis' ? 'white' : '#4b5563',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '0.875rem'
              }}
            >
              📈 Análisis
            </button>
          </div>

          <button
            onClick={onVolver}
            style={{
              padding: '0.75rem 1.5rem',
              background: '#6b7280',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600'
            }}
          >
            ← Volver
          </button>
        </div>
      </div>
    </div>
  )

  // ============================================
  // RENDER: VISTA OVERVIEW (GERENTE)
  // ============================================

  if (vista === 'overview') {
    return (
      <div style={{ maxWidth: '1600px', margin: '0 auto', padding: 'clamp(1rem, 2vw, 2rem)' }}>
        {renderHeader()}

        {/* ALERTAS CRÍTICAS */}
        {(stats.criticosAfectados > 0 || stats.muyElevado > 0 || stats.masde5Dias > 0) && (
          <div style={{
            background: '#fef2f2',
            border: '2px solid #ef4444',
            borderRadius: '12px',
            padding: '1.5rem',
            marginBottom: '2rem'
          }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: '600', color: '#991b1b', margin: '0 0 1rem 0' }}>
              🚨 Alertas Críticas
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
              {stats.criticosAfectados > 0 && (
                <div style={{ padding: '1rem', background: 'white', borderRadius: '8px', borderLeft: '4px solid #ef4444' }}>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#ef4444' }}>
                    {stats.criticosAfectados}
                  </div>
                  <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                    Equipos Críticos Detenidos
                  </div>
                </div>
              )}
              
              {stats.muyElevado > 0 && (
                <div style={{ padding: '1rem', background: 'white', borderRadius: '8px', borderLeft: '4px solid #f97316' }}>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#f97316' }}>
                    {stats.muyElevado}
                  </div>
                  <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                    Avisos Prioridad Muy Elevada
                  </div>
                </div>
              )}

              {stats.masde5Dias > 0 && (
                <div style={{ padding: '1rem', background: 'white', borderRadius: '8px', borderLeft: '4px solid #f59e0b' }}>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#f59e0b' }}>
                    {stats.masde5Dias}
                  </div>
                  <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                    Avisos con +5 días
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* KPIs PRINCIPALES */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
          gap: '1.5rem',
          marginBottom: '2rem'
        }}>
          <div style={{
            background: 'white',
            padding: '1.5rem',
            borderRadius: '12px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            border: '3px solid #ef4444'
          }}>
            <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem', fontWeight: '600' }}>
              🚫 EQUIPOS DETENIDOS
            </div>
            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#ef4444' }}>
              {stats.equiposDetenidos}
            </div>
            <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
              {equipos.length > 0 ? ((stats.equiposDetenidos / equipos.length) * 100).toFixed(1) : 0}% de la flota
            </div>
          </div>

          <div style={{
            background: 'white',
            padding: '1.5rem',
            borderRadius: '12px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            border: '3px solid #f59e0b'
          }}>
            <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem', fontWeight: '600' }}>
              ⏳ ESPERANDO TURNO
            </div>
            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#f59e0b' }}>
              {stats.esperandoTurno}
            </div>
            <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
              avisos en cola
            </div>
          </div>

          <div style={{
            background: 'white',
            padding: '1.5rem',
            borderRadius: '12px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            border: '3px solid #3b82f6'
          }}>
            <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem', fontWeight: '600' }}>
              🔧 EN TALLER
            </div>
            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#3b82f6' }}>
              {stats.enTaller}
            </div>
            <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
              en reparación
            </div>
          </div>

          <div style={{
            background: 'white',
            padding: '1.5rem',
            borderRadius: '12px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            border: '3px solid #8b5cf6'
          }}>
            <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem', fontWeight: '600' }}>
              ⏱️ TIEMPO PROM. REPARACIÓN
            </div>
            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#8b5cf6' }}>
              {stats.tiempoPromedioReparacion}
            </div>
            <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
              días promedio
            </div>
          </div>
        </div>

        {/* GRÁFICOS */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '2rem', marginBottom: '2rem' }}>
          
          {/* Avisos por tipo de equipo */}
          <div style={{
            background: 'white',
            padding: '1.5rem',
            borderRadius: '12px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '600', marginBottom: '1.5rem' }}>
              🚜 Avisos Activos por Tipo de Equipo
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {tiposOrdenados.length > 0 ? (
                tiposOrdenados.map(([tipo, cantidad], index) => {
                  const maxCantidad = tiposOrdenados[0][1]
                  const porcentaje = (cantidad / maxCantidad) * 100

                  return (
                    <div key={tipo}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>{tipo}</span>
                        <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>
                          {cantidad} {cantidad === 1 ? 'aviso' : 'avisos'}
                        </span>
                      </div>
                      <div style={{
                        background: '#e5e7eb',
                        height: '28px',
                        borderRadius: '6px',
                        overflow: 'hidden'
                      }}>
                        <div style={{
                          background: `hsl(${220 - index * 15}, 70%, 50%)`,
                          height: '100%',
                          width: `${porcentaje}%`,
                          transition: 'width 0.5s ease',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          fontSize: '0.875rem',
                          fontWeight: '600'
                        }}>
                          {cantidad}
                        </div>
                      </div>
                    </div>
                  )
                })
              ) : (
                <p style={{ textAlign: 'center', color: '#9ca3af', fontStyle: 'italic' }}>
                  No hay avisos activos
                </p>
              )}
            </div>
          </div>

          {/* Avisos por estado */}
          <div style={{
            background: 'white',
            padding: '1.5rem',
            borderRadius: '12px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '600', marginBottom: '1.5rem' }}>
              📊 Distribución por Estado
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {[
                { estado: 'Taller Espera', cantidad: stats.esperandoTurno, color: '#f59e0b', emoji: '⏳' },
                { estado: 'Taller Entrada', cantidad: stats.enTaller, color: '#3b82f6', emoji: '🔧' },
                { estado: 'Taller Salida', cantidad: stats.completados, color: '#10b981', emoji: '✅' }
              ].map(item => {
                const total = stats.esperandoTurno + stats.enTaller + stats.completados
                const porcentaje = total > 0 ? (item.cantidad / total) * 100 : 0

                return (
                  <div key={item.estado}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>
                        {item.emoji} {item.estado}
                      </span>
                      <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>
                        {item.cantidad} ({porcentaje.toFixed(0)}%)
                      </span>
                    </div>
                    <div style={{
                      background: '#e5e7eb',
                      height: '28px',
                      borderRadius: '6px',
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        background: item.color,
                        height: '100%',
                        width: `${porcentaje}%`,
                        transition: 'width 0.5s ease',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontSize: '0.875rem',
                        fontWeight: '600'
                      }}>
                        {item.cantidad > 0 && item.cantidad}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* AVISOS CRÍTICOS - TABLA RESUMIDA */}
        {stats.activos.length > 0 && (
          <div style={{
            background: 'white',
            padding: '1.5rem',
            borderRadius: '12px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '600', marginBottom: '1rem' }}>
              🔔 Avisos que Requieren Atención
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {stats.activos
                .filter(m => 
                  m.prioridad === 'Muy Elevado' || 
                  m.prioridad === 'Alto' || 
                  m.equipos?.es_critico ||
                  calcularTiempoTotal(m) > 5
                )
                .slice(0, 10)
                .map(mant => {
                  const dias = calcularTiempoTotal(mant)
                  const prioColor = getPrioridadColor(mant.prioridad)
                  const estadoColor = getEstadoColor(mant.estado)

                  return (
                    <div
                      key={mant.id}
                      style={{
                        padding: '1rem',
                        background: '#f9fafb',
                        borderRadius: '8px',
                        border: mant.equipos?.es_critico ? '2px solid #ef4444' : '1px solid #e5e7eb',
                        display: 'grid',
                        gridTemplateColumns: 'auto 1fr auto auto',
                        gap: '1rem',
                        alignItems: 'center'
                      }}
                    >
                      {/* Prioridad */}
                      <div style={{
                        padding: '0.5rem',
                        background: prioColor.bg,
                        color: prioColor.text,
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        textAlign: 'center',
                        minWidth: '90px'
                      }}>
                        {getPrioridadEmoji(mant.prioridad)} {mant.prioridad}
                      </div>

                      {/* Info */}
                      <div>
                        <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>
                          {mant.equipos?.es_critico && <span style={{ color: '#ef4444', marginRight: '0.5rem' }}>⚠️ CRÍTICO</span>}
                          {mant.equipos?.numero_identificacion} - {mant.equipos?.tipo_equipo}
                        </div>
                        <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                          {mant.descripcion_averia?.substring(0, 80)}
                          {mant.descripcion_averia?.length > 80 && '...'}
                        </div>
                        {mant.numero_aviso && (
                          <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' }}>
                            Aviso SAP: {mant.numero_aviso}
                          </div>
                        )}
                      </div>

                      {/* Estado */}
                      <div style={{
                        padding: '0.5rem 1rem',
                        background: estadoColor.bg,
                        color: estadoColor.text,
                        borderRadius: '6px',
                        fontSize: '0.875rem',
                        fontWeight: '600',
                        whiteSpace: 'nowrap'
                      }}>
                        {mant.estado}
                      </div>

                      {/* Días */}
                      <div style={{ 
                        textAlign: 'right',
                        minWidth: '80px'
                      }}>
                        <div style={{ 
                          fontSize: '1.5rem', 
                          fontWeight: 'bold',
                          color: dias > 5 ? '#ef4444' : dias > 3 ? '#f59e0b' : '#6b7280'
                        }}>
                          {dias}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                          {dias === 1 ? 'día' : 'días'}
                        </div>
                      </div>
                    </div>
                  )
                })}
            </div>

            {stats.activos.filter(m => 
              m.prioridad === 'Muy Elevado' || 
              m.prioridad === 'Alto' || 
              m.equipos?.es_critico ||
              calcularTiempoTotal(m) > 5
            ).length === 0 && (
              <p style={{ textAlign: 'center', color: '#9ca3af', fontStyle: 'italic', padding: '2rem' }}>
                ✅ No hay avisos activos que requieran atención
              </p>
            )}
          </div>
        )}
      </div>
    )
  }

  // RENDER: VISTA PLANNER (OPERATIVA)
  // ============================================

  if (vista === 'planner') {
    return (
      <div style={{ maxWidth: '1600px', margin: '0 auto', padding: 'clamp(1rem, 2vw, 2rem)' }}>
        {renderHeader()}

        {/* FILTROS */}
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          marginBottom: '2rem'
        }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '1rem' }}>
            🔍 Filtros
          </h3>
          
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', 
            gap: '1rem',
            marginBottom: '1rem'
          }}>
            {/* Tipo de Equipo */}
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.5rem' }}>
                Tipo de Equipo
              </label>
              <select
                value={filtroTipoEquipo}
                onChange={(e) => setFiltroTipoEquipo(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '2px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '0.875rem'
                }}
              >
                <option value="todos">Todos</option>
                {tiposEquipoUnicos.sort().map(tipo => (
                  <option key={tipo} value={tipo}>{tipo}</option>
                ))}
              </select>
            </div>

            {/* Estado */}
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.5rem' }}>
                Estado
              </label>
              <select
                value={filtroEstado}
                onChange={(e) => setFiltroEstado(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '2px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '0.875rem'
                }}
              >
                <option value="todos">Todos</option>
                <option value="Taller Espera">⏳ Taller Espera</option>
                <option value="Taller Entrada">🔧 Taller Entrada</option>
                <option value="Taller Salida">✅ Taller Salida</option>
              </select>
            </div>

            {/* Prioridad */}
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.5rem' }}>
                Prioridad
              </label>
              <select
                value={filtroPrioridad}
                onChange={(e) => setFiltroPrioridad(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '2px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '0.875rem'
                }}
              >
                <option value="todos">Todas</option>
                <option value="Muy Elevado">🔴 Muy Elevado</option>
                <option value="Alto">🟠 Alto</option>
                <option value="Medio">🟡 Medio</option>
                <option value="Bajo">🟢 Bajo</option>
              </select>
            </div>

            {/* Fecha Desde */}
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.5rem' }}>
                Fecha Desde
              </label>
              <input
                type="date"
                value={filtroFechaDesde}
                onChange={(e) => setFiltroFechaDesde(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '2px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '0.875rem'
                }}
              />
            </div>

            {/* Fecha Hasta */}
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.5rem' }}>
                Fecha Hasta
              </label>
              <input
                type="date"
                value={filtroFechaHasta}
                onChange={(e) => setFiltroFechaHasta(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '2px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '0.875rem'
                }}
              />
            </div>

            {/* Búsqueda */}
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.5rem' }}>
                Buscar
              </label>
              <input
                type="text"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Equipo, aviso, descripción..."
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '2px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '0.875rem'
                }}
              />
            </div>
          </div>

          {/* Botón limpiar filtros */}
          {(filtroTipoEquipo !== 'todos' || filtroEstado !== 'todos' || filtroPrioridad !== 'todos' || 
            filtroFechaDesde || filtroFechaHasta || busqueda) && (
            <button
              onClick={() => {
                setFiltroTipoEquipo('todos')
                setFiltroEstado('todos')
                setFiltroPrioridad('todos')
                setFiltroFechaDesde('')
                setFiltroFechaHasta('')
                setBusqueda('')
              }}
              style={{
                padding: '0.5rem 1rem',
                background: '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: '600'
              }}
            >
              🗑️ Limpiar Filtros
            </button>
          )}

          <div style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#6b7280' }}>
            Mostrando {mantenimientosFiltrados.length} de {mantenimientos.length} avisos
          </div>
        </div>

        {/* RESUMEN RÁPIDO */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '1rem',
          marginBottom: '2rem'
        }}>
          <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', textAlign: 'center', border: '2px solid #f59e0b' }}>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#f59e0b' }}>
              {stats.esperandoTurno}
            </div>
            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>Esperando Turno</div>
          </div>
          
          <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', textAlign: 'center', border: '2px solid #3b82f6' }}>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#3b82f6' }}>
              {stats.enTaller}
            </div>
            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>En Taller</div>
          </div>
          
          <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', textAlign: 'center', border: '2px solid #10b981' }}>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#10b981' }}>
              {stats.completados}
            </div>
            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>Completados</div>
          </div>
        </div>

        {/* TABLA DETALLADA */}
        <div style={{
          background: 'white',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          overflow: 'hidden'
        }}>
          <div style={{ padding: '1.5rem', borderBottom: '2px solid #e5e7eb' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '600', margin: 0 }}>
              📋 Lista de Avisos
            </h3>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600', color: '#4b5563' }}>
                    Prio
                  </th>
                  <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600', color: '#4b5563' }}>
                    Equipo
                  </th>
                  <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600', color: '#4b5563' }}>
                    Aviso SAP
                  </th>
                  <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600', color: '#4b5563' }}>
                    Tipo Mant.
                  </th>
                  <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600', color: '#4b5563' }}>
                    Descripción
                  </th>
                  <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600', color: '#4b5563' }}>
                    Estado
                  </th>
                  <th style={{ padding: '1rem', textAlign: 'center', fontSize: '0.875rem', fontWeight: '600', color: '#4b5563' }}>
                    Días Total
                  </th>
                  <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600', color: '#4b5563' }}>
                    Taller
                  </th>
                </tr>
              </thead>
              <tbody>
                {mantenimientosFiltrados.map(mant => {
                  const prioColor = getPrioridadColor(mant.prioridad)
                  const estadoColor = getEstadoColor(mant.estado)
                  const dias = calcularTiempoTotal(mant)

                  return (
                    <tr 
                      key={mant.id}
                      style={{ 
                        borderBottom: '1px solid #e5e7eb',
                        background: mant.equipos?.es_critico ? '#fef2f2' : 'white'
                      }}
                    >
                      <td style={{ padding: '1rem' }}>
                        <div style={{
                          display: 'inline-block',
                          padding: '0.25rem 0.5rem',
                          background: prioColor.bg,
                          color: prioColor.text,
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: '600'
                        }}>
                          {getPrioridadEmoji(mant.prioridad)}
                        </div>
                      </td>
                      
                      <td style={{ padding: '1rem' }}>
                        <div style={{ fontWeight: '600', fontSize: '0.875rem' }}>
                          {mant.equipos?.es_critico && (
                            <span style={{ color: '#ef4444', marginRight: '0.25rem' }}>⚠️</span>
                          )}
                          {mant.equipos?.numero_identificacion}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                          {mant.equipos?.tipo_equipo}
                        </div>
                      </td>
                      
                      <td style={{ padding: '1rem', fontSize: '0.875rem' }}>
                        {mant.numero_aviso || '-'}
                      </td>
                      
                      <td style={{ padding: '1rem' }}>
                        <div style={{
                          display: 'inline-block',
                          padding: '0.25rem 0.75rem',
                          background: mant.tipo_mantenimiento === 'Preventivo' ? '#dbeafe' : '#fef3c7',
                          color: mant.tipo_mantenimiento === 'Preventivo' ? '#1e40af' : '#92400e',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: '600'
                        }}>
                          {mant.tipo_mantenimiento}
                        </div>
                      </td>
                      
                      <td style={{ padding: '1rem', fontSize: '0.875rem', maxWidth: '300px' }}>
                        {mant.descripcion_averia?.substring(0, 60)}
                        {mant.descripcion_averia?.length > 60 && '...'}
                      </td>
                      
                      <td style={{ padding: '1rem' }}>
                        <div style={{
                          display: 'inline-block',
                          padding: '0.25rem 0.75rem',
                          background: estadoColor.bg,
                          color: estadoColor.text,
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: '600'
                        }}>
                          {mant.estado}
                        </div>
                      </td>
                      
                      <td style={{ 
                        padding: '1rem', 
                        textAlign: 'center',
                        fontWeight: 'bold',
                        fontSize: '1.1rem',
                        color: dias > 5 ? '#ef4444' : dias > 3 ? '#f59e0b' : '#6b7280'
                      }}>
                        {dias}
                      </td>
                      
                      <td style={{ padding: '1rem', fontSize: '0.875rem' }}>
                        {mant.ingresa_taller_ypane ? (
                          <span style={{ color: '#10b981' }}>✓ Ypané</span>
                        ) : mant.taller_tercero ? (
                          <span style={{ color: '#3b82f6' }}>{mant.taller_tercero}</span>
                        ) : (
                          <span style={{ color: '#9ca3af' }}>-</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {mantenimientosFiltrados.length === 0 && (
              <div style={{ padding: '3rem', textAlign: 'center', color: '#9ca3af' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📭</div>
                <p>No se encontraron avisos con los filtros seleccionados</p>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // RENDER: VISTA ANÁLISIS (HISTÓRICO)
  // ============================================

  if (vista === 'analisis') {
    // Estadísticas históricas
    const ultimos30Dias = mantenimientos.filter(m => {
      const fecha = new Date(m.created_at)
      const hace30 = new Date()
      hace30.setDate(hace30.getDate() - 30)
      return fecha >= hace30
    })

    const preventivos = mantenimientos.filter(m => m.tipo_mantenimiento === 'Preventivo').length
    const correctivos = mantenimientos.filter(m => m.tipo_mantenimiento === 'Correctivo').length
    const total = mantenimientos.length

    // Top equipos con más mantenimientos
    const equiposConMasMantenimientos = {}
    mantenimientos.forEach(m => {
      const equipoId = m.equipo_id
      if (!equiposConMasMantenimientos[equipoId]) {
        equiposConMasMantenimientos[equipoId] = {
          equipo: m.equipos,
          cantidad: 0
        }
      }
      equiposConMasMantenimientos[equipoId].cantidad++
    })

    const topEquipos = Object.values(equiposConMasMantenimientos)
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 10)

    return (
      <div style={{ maxWidth: '1600px', margin: '0 auto', padding: 'clamp(1rem, 2vw, 2rem)' }}>
        {renderHeader()}

        {/* KPIs Históricos */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1.5rem',
          marginBottom: '2rem'
        }}>
          <div style={{
            background: 'white',
            padding: '1.5rem',
            borderRadius: '12px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem' }}>
              📊 Total Mantenimientos
            </div>
            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#667eea' }}>
              {total}
            </div>
          </div>

          <div style={{
            background: 'white',
            padding: '1.5rem',
            borderRadius: '12px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem' }}>
              🔧 Últimos 30 Días
            </div>
            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#3b82f6' }}>
              {ultimos30Dias.length}
            </div>
          </div>

          <div style={{
            background: 'white',
            padding: '1.5rem',
            borderRadius: '12px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem' }}>
              ✅ Preventivos
            </div>
            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#10b981' }}>
              {preventivos}
            </div>
            <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
              {total > 0 ? ((preventivos / total) * 100).toFixed(0) : 0}% del total
            </div>
          </div>

          <div style={{
            background: 'white',
            padding: '1.5rem',
            borderRadius: '12px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem' }}>
              ⚠️ Correctivos
            </div>
            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#f59e0b' }}>
              {correctivos}
            </div>
            <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
              {total > 0 ? ((correctivos / total) * 100).toFixed(0) : 0}% del total
            </div>
          </div>
        </div>

        {/* Top Equipos */}
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          marginBottom: '2rem'
        }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: '600', marginBottom: '1.5rem' }}>
            🏆 Top 10 Equipos con Más Mantenimientos
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {topEquipos.length > 0 ? (
              topEquipos.map((item, index) => {
                const maxCantidad = topEquipos[0].cantidad
                const porcentaje = (item.cantidad / maxCantidad) * 100

                return (
                  <div key={index}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>
                        #{index + 1} {item.equipo?.numero_identificacion} - {item.equipo?.tipo_equipo}
                      </span>
                      <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>
                        {item.cantidad} mantenimientos
                      </span>
                    </div>
                    <div style={{
                      background: '#e5e7eb',
                      height: '28px',
                      borderRadius: '6px',
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        background: index < 3 ? '#ef4444' : '#667eea',
                        height: '100%',
                        width: `${porcentaje}%`,
                        transition: 'width 0.5s ease',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontSize: '0.875rem',
                        fontWeight: '600'
                      }}>
                        {item.cantidad}
                      </div>
                    </div>
                  </div>
                )
              })
            ) : (
              <p style={{ textAlign: 'center', color: '#9ca3af', fontStyle: 'italic' }}>
                No hay datos suficientes para mostrar
              </p>
            )}
          </div>
        </div>

        {/* Información adicional */}
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: '600', marginBottom: '1rem' }}>
            💡 Recomendaciones
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {correctivos > preventivos && (
              <div style={{
                padding: '1rem',
                background: '#fef3c7',
                borderLeft: '4px solid #f59e0b',
                borderRadius: '6px'
              }}>
                <div style={{ fontWeight: '600', color: '#92400e', marginBottom: '0.5rem' }}>
                  ⚠️ Alta Proporción de Mantenimientos Correctivos
                </div>
                <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                  Se recomienda incrementar la frecuencia de mantenimientos preventivos para reducir fallas.
                </div>
              </div>
            )}

            {topEquipos.length > 0 && topEquipos[0].cantidad > 10 && (
              <div style={{
                padding: '1rem',
                background: '#fee2e2',
                borderLeft: '4px solid #ef4444',
                borderRadius: '6px'
              }}>
                <div style={{ fontWeight: '600', color: '#991b1b', marginBottom: '0.5rem' }}>
                  🔴 Equipos con Mantenimientos Frecuentes
                </div>
                <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                  Los equipos en el top 3 requieren atención especial. Considerar evaluación para renovación.
                </div>
              </div>
            )}

            {stats.tiempoPromedioReparacion > 5 && (
              <div style={{
                padding: '1rem',
                background: '#dbeafe',
                borderLeft: '4px solid #3b82f6',
                borderRadius: '6px'
              }}>
                <div style={{ fontWeight: '600', color: '#1e40af', marginBottom: '0.5rem' }}>
                  ⏱️ Tiempo de Reparación Alto
                </div>
                <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                  El tiempo promedio de reparación es de {stats.tiempoPromedioReparacion} días. 
                  Considerar optimizar procesos o tener más repuestos en stock.
                </div>
              </div>
            )}

            {preventivos === 0 && total > 0 && (
              <div style={{
                padding: '1rem',
                background: '#fee2e2',
                borderLeft: '4px solid #ef4444',
                borderRadius: '6px'
              }}>
                <div style={{ fontWeight: '600', color: '#991b1b', marginBottom: '0.5rem' }}>
                  🚨 Sin Mantenimientos Preventivos
                </div>
                <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                  No se han registrado mantenimientos preventivos. Implementar programa de mantenimiento preventivo urgentemente.
                </div>
              </div>
            )}

            {correctivos === 0 && preventivos > 0 && (
              <div style={{
                padding: '1rem',
                background: '#d1fae5',
                borderLeft: '4px solid #10b981',
                borderRadius: '6px'
              }}>
                <div style={{ fontWeight: '600', color: '#065f46', marginBottom: '0.5rem' }}>
                  ✅ Excelente Gestión Preventiva
                </div>
                <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                  No hay mantenimientos correctivos registrados. El programa preventivo está funcionando muy bien.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Vista no implementada (fallback)
  return (
    <div style={{ maxWidth: '1600px', margin: '0 auto', padding: 'clamp(1rem, 2vw, 2rem)' }}>
      {renderHeader()}
      <div style={{ background: 'white', padding: '3rem', borderRadius: '12px', textAlign: 'center' }}>
        <h2>Vista {vista} en desarrollo</h2>
        <p style={{ color: '#6b7280' }}>Esta vista estará disponible próximamente</p>
      </div>
    </div>
  )
}

export default DashboardMantenimientos