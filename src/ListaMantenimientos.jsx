import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'

function ListaMantenimientos({ onNuevo, onEditar }) {
  const [mantenimientos, setMantenimientos] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroTipo, setFiltroTipo] = useState('Todos')
  const [filtroEstado, setFiltroEstado] = useState('Todos')
  const [filtroPedido, setFiltroPedido] = useState('Todos')
  const [filtroPrioridad, setFiltroPrioridad] = useState('Todos')
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    cargarMantenimientos()
  }, [])

  async function cargarMantenimientos() {
    try {
      setLoading(true)
      
      // Primero verificar si la tabla existe
      const { data, error } = await supabase
        .from('mantenimientos')
        .select(`
          *,
          equipos:equipo_id (
            numero_identificacion,
            denominacion
          ),
          inspecciones:inspeccion_id (
            fecha_hora
          )
        `)
        .order('created_at', { ascending: false })
      
      if (error) {
        console.error('Error detallado:', error)
        throw error
      }
      
      setMantenimientos(data || [])
    } catch (error) {
      console.error('Error completo:', error)
      alert('Error al cargar mantenimientos: ' + error.message + '\n\n¿Ya ejecutaste el SQL para crear la tabla mantenimientos?')
    } finally {
      setLoading(false)
    }
  }

  // Filtrar mantenimientos
  const mantenimientosFiltrados = mantenimientos.filter(mant => {
    const matchTipo = filtroTipo === 'Todos' || mant.tipo_mantenimiento === filtroTipo
    const matchEstado = filtroEstado === 'Todos' || mant.estado === filtroEstado
    const matchPedido = filtroPedido === 'Todos' || 
      (filtroPedido === 'Si' && mant.pedido) ||
      (filtroPedido === 'No' && !mant.pedido)
    const matchPrioridad = filtroPrioridad === 'Todos' || mant.prioridad === filtroPrioridad
    
    const equipo = mant.equipos || {}
    const matchBusqueda = 
      (equipo.numero_identificacion || '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (mant.numero_aviso || '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (mant.numero_orden || '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (mant.descripcion_averia || '').toLowerCase().includes(busqueda.toLowerCase())
    
    return matchTipo && matchEstado && matchPedido && matchPrioridad && matchBusqueda
  })

  const getEstadoColor = (estado) => {
    if (estado === 'Taller Espera') return { bg: '#fef3c7', text: '#92400e', emoji: '⏳' }
    if (estado === 'Taller Entrada') return { bg: '#dbeafe', text: '#1e40af', emoji: '🔧' }
    if (estado === 'Taller Salida') return { bg: '#d1fae5', text: '#065f46', emoji: '✅' }
    return { bg: '#f3f4f6', text: '#6b7280', emoji: '❓' }
  }

  const getPrioridadColor = (prioridad) => {
    if (prioridad === '1- Muy Elevado') return { bg: '#fee2e2', text: '#991b1b', emoji: '🔴' }
    if (prioridad === '2- Alto') return { bg: '#fed7aa', text: '#9a3412', emoji: '🟠' }
    if (prioridad === '3- Medio') return { bg: '#fef3c7', text: '#92400e', emoji: '🟡' }
    if (prioridad === '4- Bajo') return { bg: '#d1fae5', text: '#065f46', emoji: '🟢' }
    return { bg: '#f3f4f6', text: '#6b7280', emoji: '⚪' }
  }

  const calcularTiempoParada = (mant) => {
    if (!mant.fecha_inicio_averia) return null
    
    const fechaFin = mant.fecha_liberacion ? new Date(mant.fecha_liberacion) : new Date()
    const fechaInicio = new Date(mant.fecha_inicio_averia)
    const dias = Math.floor((fechaFin - fechaInicio) / (1000 * 60 * 60 * 24))
    
    return dias
  }

  if (loading) {
    return (
      <div style={{ padding: 'clamp(1rem, 2vw, 2rem)', textAlign: 'center' }}>
        <p style={{ fontSize: '1.2rem' }}>Cargando mantenimientos...</p>
      </div>
    )
  }

  // Estadísticas
  const totalEspera = mantenimientos.filter(m => m.estado === 'Taller Espera').length
  const totalEntrada = mantenimientos.filter(m => m.estado === 'Taller Entrada').length
  const totalSalida = mantenimientos.filter(m => m.estado === 'Taller Salida').length
  const totalDebidos = mantenimientos.filter(m => m.pedido && m.estado !== 'Taller Salida').length

  return (
    <div>
      {/* Estadísticas */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '1rem',
        marginBottom: '2rem'
      }}>
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '3px solid #f59e0b'
        }}>
          <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem', fontWeight: '600' }}>
            ⏳ En Espera
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#f59e0b' }}>
            {totalEspera}
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
            🔧 En Reparación
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#3b82f6' }}>
            {totalEntrada}
          </div>
        </div>

        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '3px solid #10b981'
        }}>
          <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem', fontWeight: '600' }}>
            ✅ Completados
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#10b981' }}>
            {totalSalida}
          </div>
        </div>

        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '3px solid #ef4444'
        }}>
          <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem', fontWeight: '600' }}>
            📦 Debidos a Obras
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#ef4444' }}>
            {totalDebidos}
          </div>
        </div>
      </div>

      {/* Filtros y Búsqueda */}
      <div style={{
        background: 'white',
        padding: '1.5rem',
        borderRadius: '12px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        marginBottom: '2rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '600', margin: 0 }}>
            🔍 Filtrar Mantenimientos
          </h2>
          <button
            onClick={onNuevo}
            style={{
              padding: '0.75rem 1.5rem',
              background: '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '1rem'
            }}
          >
            ➕ Nuevo Mantenimiento
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem' }}>
              Buscar
            </label>
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Equipo, aviso, orden..."
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '0.875rem'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem' }}>
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
                fontSize: '0.875rem'
              }}
            >
              <option>Todos</option>
              <option value="Correctivo">Correctivo</option>
              <option value="Preventivo">Preventivo</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem' }}>
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
              <option>Todos</option>
              <option value="Taller Espera">⏳ En Espera</option>
              <option value="Taller Entrada">🔧 En Reparación</option>
              <option value="Taller Salida">✅ Completado</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem' }}>
              Pedido (Para obra)
            </label>
            <select
              value={filtroPedido}
              onChange={(e) => setFiltroPedido(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '0.875rem'
              }}
            >
              <option>Todos</option>
              <option value="Si">Sí (Debidos)</option>
              <option value="No">No (Rutina)</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem' }}>
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
              <option>Todos</option>
              <option value="1- Muy Elevado">🔴 Muy Elevado</option>
              <option value="2- Alto">🟠 Alto</option>
              <option value="3- Medio">🟡 Medio</option>
              <option value="4- Bajo">🟢 Bajo</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#6b7280' }}>
          Mostrando {mantenimientosFiltrados.length} de {mantenimientos.length} mantenimientos
        </div>
      </div>

      {/* Lista de Mantenimientos */}
      <div style={{ display: 'grid', gap: '1rem' }}>
        {mantenimientosFiltrados.map(mant => {
          const estadoColor = getEstadoColor(mant.estado)
          const prioridadColor = getPrioridadColor(mant.prioridad)
          const tiempoParada = calcularTiempoParada(mant)
          
          // Acceder correctamente a los datos del equipo
          const equipo = mant.equipos || {}
          const inspeccion = mant.inspecciones || {}

          return (
            <div
              key={mant.id}
              style={{
                background: 'white',
                padding: '1.5rem',
                borderRadius: '8px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                border: mant.pedido && mant.estado !== 'Taller Salida' ? '3px solid #ef4444' : '1px solid #e5e7eb'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                    <h3 style={{ fontSize: '1.3rem', fontWeight: 'bold', margin: 0 }}>
                      {equipo.numero_identificacion || 'N/A'}
                    </h3>
                    
                    <span style={{
                      background: mant.tipo_mantenimiento === 'Correctivo' ? '#fee2e2' : '#d1fae5',
                      color: mant.tipo_mantenimiento === 'Correctivo' ? '#991b1b' : '#065f46',
                      padding: '0.25rem 0.75rem',
                      borderRadius: '12px',
                      fontSize: '0.75rem',
                      fontWeight: '600'
                    }}>
                      {mant.tipo_mantenimiento === 'Correctivo' ? '🔴 Correctivo' : '🟢 Preventivo'}
                    </span>

                    <span style={{
                      background: estadoColor.bg,
                      color: estadoColor.text,
                      padding: '0.25rem 0.75rem',
                      borderRadius: '12px',
                      fontSize: '0.75rem',
                      fontWeight: '600'
                    }}>
                      {estadoColor.emoji} {mant.estado}
                    </span>

                    <span style={{
                      background: prioridadColor.bg,
                      color: prioridadColor.text,
                      padding: '0.25rem 0.75rem',
                      borderRadius: '12px',
                      fontSize: '0.75rem',
                      fontWeight: '600'
                    }}>
                      {prioridadColor.emoji} {mant.prioridad}
                    </span>

                    {mant.pedido && (
                      <span style={{
                        background: '#fee2e2',
                        color: '#991b1b',
                        padding: '0.25rem 0.75rem',
                        borderRadius: '12px',
                        fontSize: '0.75rem',
                        fontWeight: '600'
                      }}>
                        📦 Para Obra
                      </span>
                    )}

                    {!mant.ingresa_taller_ypane && (
                      <span style={{
                        background: '#f3f4f6',
                        color: '#6b7280',
                        padding: '0.25rem 0.75rem',
                        borderRadius: '12px',
                        fontSize: '0.75rem',
                        fontWeight: '600'
                      }}>
                        🏭 Taller Externo
                      </span>
                    )}
                  </div>

                  {/* Descripción */}
                  <p style={{ color: '#374151', marginBottom: '0.75rem', fontSize: '0.95rem' }}>
                    {mant.descripcion_averia}
                  </p>

                  {/* Números SAP */}
                  <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.875rem', color: '#6b7280', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                    {mant.numero_aviso && (
                      <span>📄 Aviso: <strong>{mant.numero_aviso}</strong></span>
                    )}
                    {mant.numero_orden && (
                      <span>📋 Orden: <strong>{mant.numero_orden}</strong></span>
                    )}
                  </div>

                  {/* Fechas y tiempo */}
                  <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.875rem', color: '#6b7280', flexWrap: 'wrap' }}>
                    <span>📅 Ingreso: {new Date(mant.fecha_ingreso_taller).toLocaleDateString('es-PY')}</span>
                    {mant.fecha_liberacion && (
                      <span>✅ Liberación: {new Date(mant.fecha_liberacion).toLocaleDateString('es-PY')}</span>
                    )}
                    {tiempoParada !== null && (
                      <span style={{ fontWeight: '600', color: tiempoParada > 7 ? '#ef4444' : '#6b7280' }}>
                        ⏱️ Parada: {tiempoParada} días
                      </span>
                    )}
                  </div>
                </div>

                {/* Botón Editar */}
                <button
                  onClick={() => onEditar(mant)}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: '#667eea',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    whiteSpace: 'nowrap'
                  }}
                  onMouseEnter={(e) => e.target.style.background = '#5568d3'}
                  onMouseLeave={(e) => e.target.style.background = '#667eea'}
                >
                  ✏️ Editar
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {mantenimientosFiltrados.length === 0 && (
        <div style={{
          background: 'white',
          padding: '3rem',
          borderRadius: '12px',
          textAlign: 'center',
          color: '#6b7280'
        }}>
          <p style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>No se encontraron mantenimientos</p>
          <p style={{ fontSize: '0.875rem' }}>Intenta cambiar los filtros de búsqueda</p>
        </div>
      )}
    </div>
  )
}

export default ListaMantenimientos