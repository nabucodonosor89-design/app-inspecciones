import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'

function ListaMantenimientos({ onNuevo, onEditar }) {
  const [mantenimientos, setMantenimientos] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroTipo, setFiltroTipo] = useState('Todos')
  const [filtroEstado, setFiltroEstado] = useState('En Taller') // CAMBIADO: por defecto mostrar en taller
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
    
    // ACTUALIZADO: Agregar lógica para "En Taller"
    let matchEstado
    if (filtroEstado === 'Todos') {
      matchEstado = true
    } else if (filtroEstado === 'En Taller') {
      matchEstado = mant.estado === 'Taller Espera' || mant.estado === 'Taller Entrada'
    } else {
      matchEstado = mant.estado === filtroEstado
    }
    
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
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#1f2937' }}>
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
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#1f2937' }}>
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
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#1f2937' }}>
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
              <option value="En Taller">🔧 En Taller</option>
              <option value="Taller Espera">⏳ En Espera</option>
              <option value="Taller Entrada">🔧 En Reparación</option>
              <option value="Taller Salida">✅ Completado</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#1f2937' }}>
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
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#1f2937' }}>
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

      {/* Vista Kanban - Dos Columnas */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '1fr 1fr', 
        gap: '1.5rem',
        alignItems: 'start'
      }}>
        {/* Columna 1: EN ESPERA */}
        <div>
          <div style={{
            background: '#fef3c7',
            padding: '1rem',
            borderRadius: '8px 8px 0 0',
            borderBottom: '3px solid #f59e0b',
            marginBottom: '1rem'
          }}>
            <h3 style={{ 
              margin: 0, 
              fontSize: '1.25rem', 
              fontWeight: '700',
              color: '#92400e',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span>⏳ EN ESPERA</span>
              <span style={{ 
                background: '#f59e0b', 
                color: 'white', 
                padding: '0.25rem 0.75rem', 
                borderRadius: '999px',
                fontSize: '0.875rem'
              }}>
                {mantenimientosFiltrados.filter(m => m.estado === 'Taller Espera').length}
              </span>
            </h3>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {mantenimientosFiltrados
              .filter(mant => mant.estado === 'Taller Espera')
              .map(mant => {
                const prioridadColor = getPrioridadColor(mant.prioridad)
                const tiempoParada = calcularTiempoParada(mant)
                const equipo = mant.equipos || {}
                
                return (
                  <div
                    key={mant.id}
                    style={{
                      background: 'white',
                      padding: '1rem',
                      borderRadius: '8px',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                      border: mant.pedido ? '3px solid #ef4444' : '2px solid #e5e7eb',
                      cursor: 'pointer',
                      transition: 'transform 0.2s, box-shadow 0.2s'
                    }}
                    onClick={() => onEditar(mant)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)'
                      e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)'
                      e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)'
                    }}
                  >
                    {/* Header con equipo y prioridad */}
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center',
                      marginBottom: '0.75rem'
                    }}>
                      <div style={{ 
                        fontSize: '1.125rem', 
                        fontWeight: '700',
                        color: '#1f2937'
                      }}>
                        {equipo.numero_identificacion || 'Sin equipo'}
                      </div>
                      <div style={{
                        background: prioridadColor.bg,
                        color: prioridadColor.text,
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: '600'
                      }}>
                        {prioridadColor.emoji} {mant.prioridad?.split('- ')[1] || mant.prioridad}
                      </div>
                    </div>

                    {/* Avisos/Orden */}
                    <div style={{ 
                      fontSize: '0.875rem', 
                      color: '#6b7280',
                      marginBottom: '0.5rem',
                      display: 'flex',
                      gap: '1rem'
                    }}>
                      {mant.numero_aviso && (
                        <span><strong>Aviso:</strong> {mant.numero_aviso}</span>
                      )}
                      {mant.numero_orden && (
                        <span><strong>Orden:</strong> {mant.numero_orden}</span>
                      )}
                    </div>

                    {/* Tipo */}
                    <div style={{ 
                      display: 'inline-block',
                      background: mant.tipo_mantenimiento === 'Preventivo' ? '#dbeafe' : '#fef3c7',
                      color: mant.tipo_mantenimiento === 'Preventivo' ? '#1e40af' : '#92400e',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      marginBottom: '0.5rem'
                    }}>
                      {mant.tipo_mantenimiento === 'Preventivo' ? '🔄' : '⚠️'} {mant.tipo_mantenimiento}
                    </div>

                    {/* Descripción */}
                    {mant.descripcion_averia && (
                      <div style={{ 
                        fontSize: '0.875rem', 
                        color: '#374151',
                        marginTop: '0.5rem',
                        lineHeight: '1.4',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                      }}>
                        {mant.descripcion_averia}
                      </div>
                    )}

                    {/* Tiempo de parada */}
                    {tiempoParada !== null && (
                      <div style={{ 
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        color: tiempoParada > 7 ? '#ef4444' : '#6b7280',
                        marginTop: '0.75rem',
                        padding: '0.25rem 0.5rem',
                        background: tiempoParada > 7 ? '#fee2e2' : '#f3f4f6',
                        borderRadius: '4px',
                        display: 'inline-block'
                      }}>
                        ⏱️ {tiempoParada} días de parada
                      </div>
                    )}

                    {/* Indicador de pedido */}
                    {mant.pedido && (
                      <div style={{
                        marginTop: '0.5rem',
                        fontSize: '0.75rem',
                        color: '#ef4444',
                        fontWeight: '600'
                      }}>
                        📦 Debido a Obra
                      </div>
                    )}
                  </div>
                )
              })}
              
            {mantenimientosFiltrados.filter(m => m.estado === 'Taller Espera').length === 0 && (
              <div style={{
                background: '#f9fafb',
                padding: '2rem',
                borderRadius: '8px',
                textAlign: 'center',
                color: '#9ca3af',
                fontSize: '0.875rem'
              }}>
                No hay mantenimientos en espera
              </div>
            )}
          </div>
        </div>

        {/* Columna 2: EN REPARACIÓN */}
        <div>
          <div style={{
            background: '#dbeafe',
            padding: '1rem',
            borderRadius: '8px 8px 0 0',
            borderBottom: '3px solid #3b82f6',
            marginBottom: '1rem'
          }}>
            <h3 style={{ 
              margin: 0, 
              fontSize: '1.25rem', 
              fontWeight: '700',
              color: '#1e40af',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span>🔧 EN REPARACIÓN</span>
              <span style={{ 
                background: '#3b82f6', 
                color: 'white', 
                padding: '0.25rem 0.75rem', 
                borderRadius: '999px',
                fontSize: '0.875rem'
              }}>
                {mantenimientosFiltrados.filter(m => m.estado === 'Taller Entrada').length}
              </span>
            </h3>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {mantenimientosFiltrados
              .filter(mant => mant.estado === 'Taller Entrada')
              .map(mant => {
                const prioridadColor = getPrioridadColor(mant.prioridad)
                const tiempoParada = calcularTiempoParada(mant)
                const equipo = mant.equipos || {}
                
                return (
                  <div
                    key={mant.id}
                    style={{
                      background: 'white',
                      padding: '1rem',
                      borderRadius: '8px',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                      border: mant.pedido ? '3px solid #ef4444' : '2px solid #e5e7eb',
                      cursor: 'pointer',
                      transition: 'transform 0.2s, box-shadow 0.2s'
                    }}
                    onClick={() => onEditar(mant)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)'
                      e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)'
                      e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)'
                    }}
                  >
                    {/* Header con equipo y prioridad */}
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center',
                      marginBottom: '0.75rem'
                    }}>
                      <div style={{ 
                        fontSize: '1.125rem', 
                        fontWeight: '700',
                        color: '#1f2937'
                      }}>
                        {equipo.numero_identificacion || 'Sin equipo'}
                      </div>
                      <div style={{
                        background: prioridadColor.bg,
                        color: prioridadColor.text,
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: '600'
                      }}>
                        {prioridadColor.emoji} {mant.prioridad?.split('- ')[1] || mant.prioridad}
                      </div>
                    </div>

                    {/* Avisos/Orden */}
                    <div style={{ 
                      fontSize: '0.875rem', 
                      color: '#6b7280',
                      marginBottom: '0.5rem',
                      display: 'flex',
                      gap: '1rem'
                    }}>
                      {mant.numero_aviso && (
                        <span><strong>Aviso:</strong> {mant.numero_aviso}</span>
                      )}
                      {mant.numero_orden && (
                        <span><strong>Orden:</strong> {mant.numero_orden}</span>
                      )}
                    </div>

                    {/* Tipo */}
                    <div style={{ 
                      display: 'inline-block',
                      background: mant.tipo_mantenimiento === 'Preventivo' ? '#dbeafe' : '#fef3c7',
                      color: mant.tipo_mantenimiento === 'Preventivo' ? '#1e40af' : '#92400e',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      marginBottom: '0.5rem'
                    }}>
                      {mant.tipo_mantenimiento === 'Preventivo' ? '🔄' : '⚠️'} {mant.tipo_mantenimiento}
                    </div>

                    {/* Descripción */}
                    {mant.descripcion_averia && (
                      <div style={{ 
                        fontSize: '0.875rem', 
                        color: '#374151',
                        marginTop: '0.5rem',
                        lineHeight: '1.4',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                      }}>
                        {mant.descripcion_averia}
                      </div>
                    )}

                    {/* Tiempo de parada */}
                    {tiempoParada !== null && (
                      <div style={{ 
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        color: tiempoParada > 7 ? '#ef4444' : '#6b7280',
                        marginTop: '0.75rem',
                        padding: '0.25rem 0.5rem',
                        background: tiempoParada > 7 ? '#fee2e2' : '#f3f4f6',
                        borderRadius: '4px',
                        display: 'inline-block'
                      }}>
                        ⏱️ {tiempoParada} días de parada
                      </div>
                    )}

                    {/* Indicador de pedido */}
                    {mant.pedido && (
                      <div style={{
                        marginTop: '0.5rem',
                        fontSize: '0.75rem',
                        color: '#ef4444',
                        fontWeight: '600'
                      }}>
                        📦 Debido a Obra
                      </div>
                    )}
                  </div>
                )
              })}
              
            {mantenimientosFiltrados.filter(m => m.estado === 'Taller Entrada').length === 0 && (
              <div style={{
                background: '#f9fafb',
                padding: '2rem',
                borderRadius: '8px',
                textAlign: 'center',
                color: '#9ca3af',
                fontSize: '0.875rem'
              }}>
                No hay mantenimientos en reparación
              </div>
            )}
          </div>
        </div>
      </div>

      {mantenimientosFiltrados.length === 0 && (
        <div style={{
          background: 'white',
          padding: '3rem',
          borderRadius: '12px',
          textAlign: 'center',
          color: '#9ca3af'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔍</div>
          <div style={{ fontSize: '1.125rem', fontWeight: '600' }}>No se encontraron mantenimientos</div>
          <div style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
            Intenta ajustar los filtros para ver más resultados
          </div>
        </div>
      )}
    </div>
  )
}

export default ListaMantenimientos