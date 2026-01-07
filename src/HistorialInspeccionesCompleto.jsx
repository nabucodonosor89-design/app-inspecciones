import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'

function HistorialInspecciones({ onVolver, onVerDetalle }) {
  const [inspecciones, setInspecciones] = useState([])
  const [loading, setLoading] = useState(true)
  
  // Filtros
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [filtroSemaforo, setFiltroSemaforo] = useState('todos')
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('')
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('')
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    cargarInspecciones()
  }, [])

  async function cargarInspecciones() {
    try {
      setLoading(true)

      const { data, error } = await supabase
        .from('inspecciones')
        .select(`
          *,
          equipos(numero_identificacion, denominacion, tipo_equipo),
          usuarios(nombre_completo)
        `)
        .order('fecha_hora', { ascending: false })

      if (error) throw error

      console.log('📋 Inspecciones cargadas:', data)
      setInspecciones(data || [])

    } catch (error) {
      console.error('Error:', error)
      alert('Error al cargar inspecciones')
    } finally {
      setLoading(false)
    }
  }

  // Aplicar filtros
  const inspeccionesFiltradas = inspecciones.filter(insp => {
    // Filtro por tipo
    if (filtroTipo !== 'todos' && insp.tipo_inspeccion !== filtroTipo) {
      return false
    }

    // Filtro por semáforo
    if (filtroSemaforo !== 'todos' && insp.semaforo !== filtroSemaforo) {
      return false
    }

    // Filtro por fecha desde
    if (filtroFechaDesde && insp.fecha_hora < filtroFechaDesde) {
      return false
    }

    // Filtro por fecha hasta
    if (filtroFechaHasta && insp.fecha_hora > filtroFechaHasta + 'T23:59:59') {
      return false
    }

    // Búsqueda por equipo
    if (busqueda && !insp.equipos?.numero_identificacion?.toLowerCase().includes(busqueda.toLowerCase())) {
      return false
    }

    return true
  })

  function limpiarFiltros() {
    setFiltroTipo('todos')
    setFiltroSemaforo('todos')
    setFiltroFechaDesde('')
    setFiltroFechaHasta('')
    setBusqueda('')
  }

  function getSemaforoColor(semaforo) {
    switch(semaforo) {
      case 'verde': return '#10b981'
      case 'amarillo': return '#f59e0b'
      case 'rojo': return '#ef4444'
      default: return '#6b7280'
    }
  }

  function getSemaforoEmoji(semaforo) {
    switch(semaforo) {
      case 'verde': return '🟢'
      case 'amarillo': return '🟡'
      case 'rojo': return '🔴'
      default: return '⚪'
    }
  }

  function getTipoEmoji(tipo) {
    switch(tipo) {
      case 'envio': return '📤'
      case 'recepcion': return '📥'
      case 'taller': return '🔧'
      case 'obra': return '🏗️'
      default: return '📋'
    }
  }

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        minHeight: '400px' 
      }}>
        <p style={{ fontSize: '1.2rem', color: '#6b7280' }}>Cargando inspecciones...</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', padding: 'clamp(1rem, 2vw, 2rem)' }}>
      {/* Header */}
      <div style={{
        background: 'white',
        padding: '1.5rem',
        borderRadius: '12px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        marginBottom: '2rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '2rem', fontWeight: 'bold', margin: '0 0 0.5rem 0' }}>
              📋 Historial de Inspecciones
            </h1>
            <p style={{ color: '#6b7280', margin: 0 }}>
              {inspeccionesFiltradas.length} de {inspecciones.length} inspecciones
            </p>
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

      {/* Filtros */}
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          {/* Búsqueda por equipo */}
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: '600', color: '#1f2937' }}>
              Buscar Equipo
            </label>
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Ej: VL-EX050"
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '0.9rem'
              }}
            />
          </div>

          {/* Tipo de inspección */}
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: '600', color: '#1f2937' }}>
              Tipo
            </label>
            <select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '0.9rem'
              }}
            >
              <option value="todos">Todos</option>
              <option value="envio">📤 Envío a Obra</option>
              <option value="recepcion">📥 Recepción de Obra</option>
              <option value="taller">🔧 Taller</option>
              <option value="obra">🏗️ En Obra</option>
            </select>
          </div>

          {/* Semáforo */}
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: '600', color: '#1f2937' }}>
              Estado
            </label>
            <select
              value={filtroSemaforo}
              onChange={(e) => setFiltroSemaforo(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '0.9rem'
              }}
            >
              <option value="todos">Todos</option>
              <option value="verde">🟢 Verde</option>
              <option value="amarillo">🟡 Amarillo</option>
              <option value="rojo">🔴 Rojo</option>
            </select>
          </div>

          {/* Fecha desde */}
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: '600', color: '#1f2937' }}>
              Desde
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
                fontSize: '0.9rem'
              }}
            />
          </div>

          {/* Fecha hasta */}
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: '600', color: '#1f2937' }}>
              Hasta
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
                fontSize: '0.9rem'
              }}
            />
          </div>
        </div>

        {/* Botón limpiar filtros */}
        <button
          onClick={limpiarFiltros}
          style={{
            marginTop: '1rem',
            padding: '0.5rem 1rem',
            background: '#f3f4f6',
            color: '#374151',
            border: '2px solid #e5e7eb',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: '0.9rem'
          }}
        >
          🔄 Limpiar Filtros
        </button>
      </div>

      {/* Lista de inspecciones */}
      {inspeccionesFiltradas.length === 0 ? (
        <div style={{
          background: 'white',
          padding: '3rem',
          borderRadius: '12px',
          textAlign: 'center',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <p style={{ fontSize: '1.2rem', color: '#6b7280' }}>
            {inspecciones.length === 0 
              ? '📭 No hay inspecciones registradas'
              : '🔍 No se encontraron inspecciones con los filtros aplicados'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {inspeccionesFiltradas.map(insp => (
            <div
              key={insp.id}
              onClick={() => onVerDetalle(insp)}
              style={{
                background: 'white',
                padding: '1.5rem',
                borderRadius: '12px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                cursor: 'pointer',
                transition: 'all 0.2s',
                border: '2px solid transparent',
                ':hover': {
                  borderColor: '#3b82f6',
                  transform: 'translateY(-2px)'
                }
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#3b82f6'
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'transparent'
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                {/* Info principal */}
                <div style={{ flex: 1, minWidth: '250px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                    <div style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '50%',
                      background: getSemaforoColor(insp.semaforo),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.5rem'
                    }}>
                      {getSemaforoEmoji(insp.semaforo)}
                    </div>
                    <div>
                      <h3 style={{ fontSize: '1.3rem', fontWeight: 'bold', margin: 0 }}>
                        {insp.equipos?.numero_identificacion || 'N/A'}
                      </h3>
                      <p style={{ color: '#6b7280', fontSize: '0.9rem', margin: 0 }}>
                        {insp.equipos?.denominacion || 'Sin descripción'}
                      </p>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.75rem' }}>
                    <span style={{
                      padding: '0.25rem 0.75rem',
                      background: '#eff6ff',
                      color: '#1e40af',
                      borderRadius: '12px',
                      fontSize: '0.85rem',
                      fontWeight: '600'
                    }}>
                      {getTipoEmoji(insp.tipo_inspeccion)} {insp.tipo_inspeccion?.replace('_', ' ') || 'N/A'}
                    </span>
                    
                    {insp.equipos?.tipo_equipo && (
                      <span style={{
                        padding: '0.25rem 0.75rem',
                        background: '#f3f4f6',
                        color: '#374151',
                        borderRadius: '12px',
                        fontSize: '0.85rem'
                      }}>
                        {insp.equipos.tipo_equipo}
                      </span>
                    )}
                  </div>
                </div>

                {/* Info secundaria */}
                <div style={{ textAlign: 'right', minWidth: '200px' }}>
                  <p style={{ fontSize: '1.1rem', fontWeight: '600', color: '#1f2937', margin: '0 0 0.25rem 0' }}>
                    📅 {new Date(insp.fecha_hora).toLocaleDateString('es-PY', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric'
                    })}
                  </p>
                  <p style={{ fontSize: '0.9rem', color: '#6b7280', margin: '0 0 0.5rem 0' }}>
                    🕐 {new Date(insp.fecha_hora).toLocaleTimeString('es-PY', {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                  <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: 0 }}>
                    👤 {insp.usuarios?.nombre_completo || 'N/A'}
                  </p>
                  <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '0.25rem 0 0 0' }}>
                    📍 {insp.ubicacion || 'Sin ubicación'}
                  </p>
                </div>
              </div>

              {/* Observaciones (si existen) */}
              {insp.observaciones_generales && (
                <div style={{
                  marginTop: '1rem',
                  padding: '0.75rem',
                  background: '#f9fafb',
                  borderRadius: '6px',
                  borderLeft: '3px solid #3b82f6'
                }}>
                  <p style={{ fontSize: '0.85rem', color: '#374151', margin: 0 }}>
                    💬 {insp.observaciones_generales.substring(0, 100)}
                    {insp.observaciones_generales.length > 100 && '...'}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default HistorialInspecciones