import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'

function DashboardMantenimientos({ onVolver }) {
  const [loading, setLoading] = useState(true)
  const [mantenimientos, setMantenimientos] = useState([])
  const [equiposDebidos, setEquiposDebidos] = useState([])

  useEffect(() => {
    cargarDatos()
  }, [])

  async function cargarDatos() {
    try {
      setLoading(true)
      
      const { data, error } = await supabase
        .from('mantenimientos')
        .select(`
          *,
          equipos:equipo_id (
            numero_identificacion,
            denominacion
          )
        `)
        .order('created_at', { ascending: false })
      
      if (error) {
        console.error('Error detallado:', error)
        throw error
      }
      
      setMantenimientos(data || [])
      
      // Filtrar equipos debidos: Pedido=Sí y Estado≠Salida
      const debidos = (data || []).filter(m => 
        m.pedido && 
        m.estado !== 'Taller Salida'
      ).sort((a, b) => {
        // Ordenar por prioridad
        const prioridadOrden = {
          '1- Muy Elevado': 1,
          '2- Alto': 2,
          '3- Medio': 3,
          '4- Bajo': 4
        }
        return (prioridadOrden[a.prioridad] || 5) - (prioridadOrden[b.prioridad] || 5)
      })
      
      setEquiposDebidos(debidos)
    } catch (error) {
      console.error('Error completo:', error)
      alert('Error al cargar datos: ' + error.message + '\n\n¿Ya ejecutaste el SQL para crear la tabla mantenimientos?')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 'clamp(1rem, 2vw, 2rem)', textAlign: 'center' }}>
        <p style={{ fontSize: '1.2rem' }}>Cargando dashboard...</p>
      </div>
    )
  }

  // Estadísticas
  const totalMantenimientos = mantenimientos.length
  const porEstado = {
    'Taller Espera': mantenimientos.filter(m => m.estado === 'Taller Espera').length,
    'Taller Entrada': mantenimientos.filter(m => m.estado === 'Taller Entrada').length,
    'Taller Salida': mantenimientos.filter(m => m.estado === 'Taller Salida').length
  }
  
  const porTipo = {
    'Correctivo': mantenimientos.filter(m => m.tipo_mantenimiento === 'Correctivo').length,
    'Preventivo': mantenimientos.filter(m => m.tipo_mantenimiento === 'Preventivo').length
  }

  const totalDebidos = equiposDebidos.length

  // Calcular tiempo promedio de parada
  const mantenimientosConTiempo = mantenimientos.filter(m => 
    m.fecha_inicio_averia && m.fecha_liberacion
  )
  const tiempoPromedio = mantenimientosConTiempo.length > 0
    ? Math.round(
        mantenimientosConTiempo.reduce((acc, m) => {
          const dias = Math.floor(
            (new Date(m.fecha_liberacion) - new Date(m.fecha_inicio_averia)) / (1000 * 60 * 60 * 24)
          )
          return acc + dias
        }, 0) / mantenimientosConTiempo.length
      )
    : 0

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

  const calcularDiasEnTaller = (mant) => {
    const fechaInicio = new Date(mant.fecha_ingreso_taller)
    const fechaFin = mant.fecha_liberacion ? new Date(mant.fecha_liberacion) : new Date()
    return Math.floor((fechaFin - fechaInicio) / (1000 * 60 * 60 * 24))
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
          <h1 style={{ fontSize: '2rem', fontWeight: 'bold', margin: 0 }}>
            📊 Dashboard de Mantenimientos
          </h1>
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

      {/* Cards Resumen */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1rem',
        marginBottom: '2rem'
      }}>
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '3px solid #667eea'
        }}>
          <div style={{ fontSize: '0.9rem', color: '#6b7280', marginBottom: '0.5rem', fontWeight: '600' }}>
            Total Mantenimientos
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#667eea' }}>
            {totalMantenimientos}
          </div>
        </div>

        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '3px solid #ef4444'
        }}>
          <div style={{ fontSize: '0.9rem', color: '#6b7280', marginBottom: '0.5rem', fontWeight: '600' }}>
            📦 Debidos a Obras
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#ef4444' }}>
            {totalDebidos}
          </div>
          <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
            Equipos esperados
          </div>
        </div>

        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '3px solid #f59e0b'
        }}>
          <div style={{ fontSize: '0.9rem', color: '#6b7280', marginBottom: '0.5rem', fontWeight: '600' }}>
            ⏱️ Tiempo Promedio
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#f59e0b' }}>
            {tiempoPromedio}
          </div>
          <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
            días de parada
          </div>
        </div>
      </div>

      {/* SECCIÓN CRÍTICA: Equipos Debidos a Obras */}
      {totalDebidos > 0 && (
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 4px 6px rgba(239, 68, 68, 0.3)',
          marginBottom: '2rem',
          border: '3px solid #ef4444'
        }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1rem', color: '#ef4444' }}>
            🚨 EQUIPOS DEBIDOS A OBRAS (URGENTE)
          </h2>
          <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
            Estos equipos tienen mantenimientos con "Pedido = Sí" y aún no han salido del taller
          </p>

          <div style={{ display: 'grid', gap: '1rem' }}>
            {equiposDebidos.map(mant => {
              const estadoColor = getEstadoColor(mant.estado)
              const prioridadColor = getPrioridadColor(mant.prioridad)
              const diasEnTaller = calcularDiasEnTaller(mant)
              const equipo = mant.equipos || {}

              return (
                <div
                  key={mant.id}
                  style={{
                    background: '#fef2f2',
                    padding: '1.5rem',
                    borderRadius: '8px',
                    border: '2px solid #fca5a5'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                        <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold', margin: 0 }}>
                          {equipo.numero_identificacion || 'N/A'}
                        </h3>

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

                        <span style={{
                          background: diasEnTaller > 7 ? '#fee2e2' : '#fef3c7',
                          color: diasEnTaller > 7 ? '#991b1b' : '#92400e',
                          padding: '0.25rem 0.75rem',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                          fontWeight: '600'
                        }}>
                          ⏱️ {diasEnTaller} días en taller
                        </span>
                      </div>

                      <p style={{ color: '#374151', marginBottom: '0.5rem', fontSize: '0.95rem' }}>
                        {mant.descripcion_averia}
                      </p>

                      <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.875rem', color: '#6b7280', flexWrap: 'wrap' }}>
                        {mant.numero_aviso && (
                          <span>📄 Aviso: <strong>{mant.numero_aviso}</strong></span>
                        )}
                        {mant.numero_orden && (
                          <span>📋 Orden: <strong>{mant.numero_orden}</strong></span>
                        )}
                        <span>📅 Ingreso: {new Date(mant.fecha_ingreso_taller).toLocaleDateString('es-PY')}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {totalDebidos === 0 && (
        <div style={{
          background: 'white',
          padding: '2rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          marginBottom: '2rem',
          textAlign: 'center',
          border: '3px solid #10b981'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>✅</div>
          <h3 style={{ fontSize: '1.3rem', fontWeight: '600', color: '#10b981', marginBottom: '0.5rem' }}>
            ¡No hay equipos debidos a obras!
          </h3>
          <p style={{ color: '#6b7280' }}>
            Todos los pedidos han sido completados
          </p>
        </div>
      )}

      {/* Gráficos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '2rem' }}>
        
        {/* Por Estado */}
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1.5rem' }}>
            📊 Mantenimientos por Estado
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {Object.entries(porEstado).map(([estado, cantidad]) => {
              const color = getEstadoColor(estado)
              const porcentaje = totalMantenimientos > 0 ? (cantidad / totalMantenimientos) * 100 : 0

              return (
                <div key={estado}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>
                      {color.emoji} {estado}
                    </span>
                    <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>
                      {cantidad} ({porcentaje.toFixed(0)}%)
                    </span>
                  </div>
                  <div style={{
                    background: '#e5e7eb',
                    height: '24px',
                    borderRadius: '6px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      background: color.text,
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
                      {cantidad > 0 && cantidad}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Por Tipo */}
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1.5rem' }}>
            🔧 Mantenimientos por Tipo
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {Object.entries(porTipo).map(([tipo, cantidad]) => {
              const porcentaje = totalMantenimientos > 0 ? (cantidad / totalMantenimientos) * 100 : 0
              const color = tipo === 'Correctivo' ? '#ef4444' : '#10b981'

              return (
                <div key={tipo}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>
                      {tipo === 'Correctivo' ? '🔴' : '🟢'} {tipo}
                    </span>
                    <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>
                      {cantidad} ({porcentaje.toFixed(0)}%)
                    </span>
                  </div>
                  <div style={{
                    background: '#e5e7eb',
                    height: '24px',
                    borderRadius: '6px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      background: color,
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
                      {cantidad > 0 && cantidad}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export default DashboardMantenimientos