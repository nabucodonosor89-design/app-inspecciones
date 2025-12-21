import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import HistorialInspecciones from './HistorialInspecciones'

function EquiposList({ onInspeccionarEquipo }) {
  const [equipos, setEquipos] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroTipo, setFiltroTipo] = useState('Todos')
  const [filtroUbicacion, setFiltroUbicacion] = useState('Todos')
  const [filtroSemaforo, setFiltroSemaforo] = useState('Todos')
  const [filtroInspeccion, setFiltroInspeccion] = useState('Todos')
  const [busqueda, setBusqueda] = useState('')
  const [ordenarPor, setOrdenarPor] = useState('ubicacion') // NUEVO
  const [equipoSeleccionado, setEquipoSeleccionado] = useState(null)

  useEffect(() => {
    getEquipos()
  }, [])

  async function getEquipos() {
    try {
      // Obtener equipos
      const { data: equiposData, error: equiposError } = await supabase
        .from('equipos')
        .select('*')
        .order('ubicacion_actual', { ascending: true })
        .order('numero_identificacion', { ascending: true })
      
      if (equiposError) throw equiposError

      // Obtener la última inspección de cada equipo
      const { data: inspeccionesData, error: inspeccionesError } = await supabase
        .from('inspecciones')
        .select('equipo_id, fecha_hora')
        .order('fecha_hora', { ascending: false })

      if (inspeccionesError) throw inspeccionesError

      // Mapear la última inspección a cada equipo
      const equiposConInspeccion = equiposData.map(equipo => {
        const inspeccionesEquipo = inspeccionesData.filter(i => i.equipo_id === equipo.id)
        const ultimaInspeccion = inspeccionesEquipo.length > 0 ? inspeccionesEquipo[0].fecha_hora : null
        
        return {
          ...equipo,
          ultima_inspeccion: ultimaInspeccion,
          dias_sin_inspeccion: ultimaInspeccion 
            ? Math.floor((new Date() - new Date(ultimaInspeccion)) / (1000 * 60 * 60 * 24))
            : null
        }
      })

      setEquipos(equiposConInspeccion)
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setLoading(false)
    }
  }

  // Si hay un equipo seleccionado, mostrar el historial
  if (equipoSeleccionado) {
    return <HistorialInspecciones equipo={equipoSeleccionado} onVolver={() => setEquipoSeleccionado(null)} />
  }

  // Filtrar equipos
  const equiposFiltrados = equipos.filter(equipo => {
    const matchTipo = filtroTipo === 'Todos' || equipo.tipo_equipo === filtroTipo
    const matchUbicacion = filtroUbicacion === 'Todos' || equipo.ubicacion_actual === filtroUbicacion
    const matchSemaforo = filtroSemaforo === 'Todos' || equipo.semaforo_actual === filtroSemaforo
    const matchBusqueda = equipo.numero_identificacion.toLowerCase().includes(busqueda.toLowerCase()) ||
                          (equipo.denominacion && equipo.denominacion.toLowerCase().includes(busqueda.toLowerCase()))
    
    // Filtro de inspección
    let matchInspeccion = true
    if (filtroInspeccion === 'Urgente') {
      matchInspeccion = equipo.dias_sin_inspeccion === null || equipo.dias_sin_inspeccion > 30
    } else if (filtroInspeccion === 'Próximo') {
      matchInspeccion = equipo.dias_sin_inspeccion !== null && equipo.dias_sin_inspeccion >= 20 && equipo.dias_sin_inspeccion <= 30
    } else if (filtroInspeccion === 'Al día') {
      matchInspeccion = equipo.dias_sin_inspeccion !== null && equipo.dias_sin_inspeccion < 20
    } else if (filtroInspeccion === 'Sin inspecciones') {
      matchInspeccion = equipo.dias_sin_inspeccion === null
    }
    
    return matchTipo && matchUbicacion && matchSemaforo && matchBusqueda && matchInspeccion
  })

  // NUEVO: Función para ordenar equipos
  const equiposOrdenados = [...equiposFiltrados].sort((a, b) => {
    switch (ordenarPor) {
      case 'nombre':
        return a.numero_identificacion.localeCompare(b.numero_identificacion)
      
      case 'dias_desc':
        // Más días sin inspección primero
        const diasA = a.dias_sin_inspeccion ?? 9999
        const diasB = b.dias_sin_inspeccion ?? 9999
        return diasB - diasA
      
      case 'dias_asc':
        // Menos días sin inspección primero
        const diasA2 = a.dias_sin_inspeccion ?? -1
        const diasB2 = b.dias_sin_inspeccion ?? -1
        return diasA2 - diasB2
      
      case 'semaforo':
        // Rojo -> Amarillo -> Verde
        const semaforoOrden = { 'rojo': 0, 'amarillo': 1, 'verde': 2, null: 3 }
        return (semaforoOrden[a.semaforo_actual] ?? 3) - (semaforoOrden[b.semaforo_actual] ?? 3)
      
      case 'ubicacion':
      default:
        // Por ubicación y luego por nombre
        if (a.ubicacion_actual === b.ubicacion_actual) {
          return a.numero_identificacion.localeCompare(b.numero_identificacion)
        }
        return (a.ubicacion_actual || 'ZZZ').localeCompare(b.ubicacion_actual || 'ZZZ')
    }
  })

  // Agrupar por ubicación solo si se ordena por ubicación
  const mostrarAgrupado = ordenarPor === 'ubicacion'
  
  const equiposAgrupados = mostrarAgrupado 
    ? equiposOrdenados.reduce((acc, equipo) => {
        const ubicacion = equipo.ubicacion_actual || 'Sin ubicación'
        if (!acc[ubicacion]) acc[ubicacion] = []
        acc[ubicacion].push(equipo)
        return acc
      }, {})
    : { 'Todos los equipos': equiposOrdenados }

  // Obtener ubicaciones únicas para el filtro
  const ubicacionesUnicas = ['Todos', ...new Set(equipos.map(e => e.ubicacion_actual).filter(Boolean))]

  const getSemaforoEmoji = (semaforo) => {
    if (semaforo === 'verde') return '🟢'
    if (semaforo === 'amarillo') return '🟡'
    if (semaforo === 'rojo') return '🔴'
    return '⚪'
  }

  const getSemaforoColor = (semaforo) => {
    if (semaforo === 'verde') return '#10b981'
    if (semaforo === 'amarillo') return '#f59e0b'
    if (semaforo === 'rojo') return '#ef4444'
    return '#9ca3af'
  }

  const getEstadoInspeccion = (dias) => {
    if (dias === null) return { emoji: '⚪', texto: 'Sin inspecciones', color: '#9ca3af', bgColor: '#f3f4f6' }
    if (dias > 30) return { emoji: '🔴', texto: `${dias} días - URGENTE`, color: '#ef4444', bgColor: '#fee2e2' }
    if (dias >= 20) return { emoji: '🟡', texto: `${dias} días - Próximo`, color: '#f59e0b', bgColor: '#fef3c7' }
    return { emoji: '🟢', texto: `${dias} días - Al día`, color: '#10b981', bgColor: '#d1fae5' }
  }

  const getTipoNombre = (tipo) => {
    const nombres = {
      'V': 'Vehículos',
      'P': 'Equipos Pesados',
      'B': 'Embarcaciones',
      'M': 'Equipos Menores'
    }
    return nombres[tipo] || tipo
  }

  // Calcular estadísticas
  const equiposUrgentes = equipos.filter(e => e.dias_sin_inspeccion === null || e.dias_sin_inspeccion > 30).length
  const equiposProximos = equipos.filter(e => e.dias_sin_inspeccion !== null && e.dias_sin_inspeccion >= 20 && e.dias_sin_inspeccion <= 30).length
  const equiposAlDia = equipos.filter(e => e.dias_sin_inspeccion !== null && e.dias_sin_inspeccion < 20).length

  if (loading) {
    return <div style={{ padding: 'clamp(1rem, 2vw, 2rem)', textAlign: 'center' }}>
      <p style={{ fontSize: '1.2rem' }}>Cargando equipos...</p>
    </div>
  }

  return (
    <div>
      {/* Estadísticas de inspecciones */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '1rem',
        marginBottom: '2rem'
      }}>
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          borderLeft: '4px solid #10b981'
        }}>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#10b981' }}>
            {equiposAlDia}
          </div>
          <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>
            🟢 Equipos al día
          </div>
        </div>

        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          borderLeft: '4px solid #f59e0b'
        }}>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#f59e0b' }}>
            {equiposProximos}
          </div>
          <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>
            🟡 Próximos a inspeccionar
          </div>
        </div>

        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          borderLeft: '4px solid #ef4444'
        }}>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#ef4444' }}>
            {equiposUrgentes}
          </div>
          <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>
            🔴 Urgente / Sin inspecciones
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div style={{
        background: 'white',
        padding: '1.5rem',
        borderRadius: '12px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        marginBottom: '2rem'
      }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1.5rem' }}>
          🔍 Buscar y Ordenar Equipos
        </h2>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem' }}>
              Buscar por código
            </label>
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Ej: VL-CN004"
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '0.875rem'
              }}
            />
          </div>

          {/* NUEVO: Selector de ordenamiento */}
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem' }}>
              Ordenar por
            </label>
            <select
              value={ordenarPor}
              onChange={(e) => setOrdenarPor(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '0.875rem'
              }}
            >
              <option value="ubicacion">📍 Ubicación</option>
              <option value="nombre">🔤 Nombre (A-Z)</option>
              <option value="semaforo">🚦 Semáforo (críticos primero)</option>
              <option value="dias_desc">⏰ Más días sin inspección</option>
              <option value="dias_asc">✅ Menos días sin inspección</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem' }}>
              Tipo de Equipo
            </label>
            <select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '0.875rem'
              }}
            >
              <option>Todos</option>
              <option value="V">Vehículos</option>
              <option value="P">Equipos Pesados</option>
              <option value="B">Embarcaciones</option>
              <option value="M">Equipos Menores</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem' }}>
              Ubicación
            </label>
            <select
              value={filtroUbicacion}
              onChange={(e) => setFiltroUbicacion(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '0.875rem'
              }}
            >
              {ubicacionesUnicas.map(ub => (
                <option key={ub} value={ub}>{ub}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem' }}>
              Semáforo
            </label>
            <select
              value={filtroSemaforo}
              onChange={(e) => setFiltroSemaforo(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '0.875rem'
              }}
            >
              <option>Todos</option>
              <option value="verde">🟢 Verde</option>
              <option value="amarillo">🟡 Amarillo</option>
              <option value="rojo">🔴 Rojo</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem' }}>
              Estado de Inspección
            </label>
            <select
              value={filtroInspeccion}
              onChange={(e) => setFiltroInspeccion(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '0.875rem'
              }}
            >
              <option>Todos</option>
              <option value="Urgente">🔴 Urgente (30+ días)</option>
              <option value="Próximo">🟡 Próximo (20-30 días)</option>
              <option value="Al día">🟢 Al día (&lt;20 días)</option>
              <option value="Sin inspecciones">⚪ Sin inspecciones</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#6b7280' }}>
          Mostrando {equiposFiltrados.length} de {equipos.length} equipos
        </div>
      </div>

      {/* Lista de equipos (agrupada o plana según ordenamiento) */}
      {Object.entries(equiposAgrupados).map(([titulo, equiposGrupo]) => (
        <div key={titulo} style={{ marginBottom: '2rem' }}>
          {mostrarAgrupado && (
            <h3 style={{
              fontSize: '1.25rem',
              fontWeight: '600',
              marginBottom: '1rem',
              padding: '0.75rem 1rem',
              background: '#f3f4f6',
              borderRadius: '8px',
              borderLeft: '4px solid #667eea'
            }}>
              📍 {titulo} ({equiposGrupo.length} equipos)
            </h3>
          )}

          <div style={{ display: 'grid', gap: '1rem' }}>
            {equiposGrupo.map(equipo => {
              const estadoInspeccion = getEstadoInspeccion(equipo.dias_sin_inspeccion)
              
              return (
                <div
                  key={equipo.id}
                  style={{
                    background: 'white',
                    padding: '1.5rem',
                    borderRadius: '8px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                    border: '1px solid #e5e7eb'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '1rem' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '1.5rem' }}>
                          {getSemaforoEmoji(equipo.semaforo_actual)}
                        </span>
                        <p style={{ fontWeight: 'bold', fontSize: '1.2rem', margin: 0 }}>
                          {equipo.numero_identificacion}
                        </p>
                        <span style={{
                          background: '#e0e7ff',
                          color: '#3730a3',
                          padding: '0.25rem 0.75rem',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                          fontWeight: '600'
                        }}>
                          {getTipoNombre(equipo.tipo_equipo)}
                        </span>
                        
                        {/* Badge de estado de inspección */}
                        <span style={{
                          background: estadoInspeccion.bgColor,
                          color: estadoInspeccion.color,
                          padding: '0.25rem 0.75rem',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem'
                        }}>
                          {estadoInspeccion.emoji} {estadoInspeccion.texto}
                        </span>
                      </div>

                      <p style={{ color: '#666', marginBottom: '0.5rem' }}>
                        {equipo.denominacion || 'Sin descripción'}
                      </p>

                      <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.875rem', color: '#6b7280', flexWrap: 'wrap' }}>
                        <span>📦 {equipo.fabricante || 'N/A'} {equipo.modelo || ''}</span>
                        {equipo.matricula && equipo.matricula !== 'N/A' && (
                          <span>🚗 {equipo.matricula}</span>
                        )}
                        {equipo.ultima_inspeccion && (
                          <span>📅 Última: {new Date(equipo.ultima_inspeccion).toLocaleDateString('es-PY')}</span>
                        )}
                        {mostrarAgrupado === false && (
                          <span>📍 {equipo.ubicacion_actual || 'Sin ubicación'}</span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
                      <div style={{
                        padding: '0.5rem 1rem',
                        background: getSemaforoColor(equipo.semaforo_actual) + '20',
                        color: getSemaforoColor(equipo.semaforo_actual),
                        borderRadius: '8px',
                        fontWeight: '600',
                        fontSize: '0.875rem',
                        textAlign: 'center'
                      }}>
                        {equipo.semaforo_actual?.toUpperCase() || 'SIN DATOS'}
                      </div>

                      <button
                        onClick={() => onInspeccionarEquipo(equipo)}
                        style={{
                          padding: '0.5rem 1rem',
                          background: '#10b981',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '0.875rem',
                          fontWeight: '600',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap'
                        }}
                        onMouseEnter={(e) => e.target.style.background = '#059669'}
                        onMouseLeave={(e) => e.target.style.background = '#10b981'}
                      >
                        ✓ Inspeccionar
                      </button>

                      <button
                        onClick={() => setEquipoSeleccionado(equipo)}
                        style={{
                          padding: '0.5rem 1rem',
                          background: '#667eea',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '0.875rem',
                          fontWeight: '600',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap'
                        }}
                        onMouseEnter={(e) => e.target.style.background = '#5568d3'}
                        onMouseLeave={(e) => e.target.style.background = '#667eea'}
                      >
                        📋 Ver Inspecciones
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {equiposFiltrados.length === 0 && (
        <div style={{
          background: 'white',
          padding: '3rem',
          borderRadius: '12px',
          textAlign: 'center',
          color: '#6b7280'
        }}>
          <p style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>No se encontraron equipos</p>
          <p style={{ fontSize: '0.875rem' }}>Intenta cambiar los filtros de búsqueda</p>
        </div>
      )}
    </div>
  )
}

export default EquiposList