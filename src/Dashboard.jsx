import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'

function Dashboard({ onVolver }) {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    porUbicacion: [],
    porEstadoOperativo: [],
    porTipo: [],
    totalEquipos: 0,
    equiposOperativos: 0,
    equiposConRestriccion: 0,
    equiposFueraServicio: 0
  })

  useEffect(() => {
    cargarEstadisticas()
  }, [])

  async function cargarEstadisticas() {
    try {
      setLoading(true)
      
      // Cargar todos los equipos
      const { data: equipos, error } = await supabase
        .from('equipos')
        .select('*')
        .order('nombre')

      if (error) throw error

      // Calcular estadísticas
      const totalEquipos = equipos.length

      // Por ubicación
      const ubicaciones = {}
      equipos.forEach(eq => {
        const ubicacion = eq.ubicacion || 'Sin ubicación'
        ubicaciones[ubicacion] = (ubicaciones[ubicacion] || 0) + 1
      })
      const porUbicacion = Object.entries(ubicaciones).map(([nombre, cantidad]) => ({
        nombre,
        cantidad,
        porcentaje: ((cantidad / totalEquipos) * 100).toFixed(1)
      }))

      // Por estado operativo
      const estadosOp = {
        'operativo': 0,
        'operativo_restricciones': 0,
        'fuera_servicio': 0
      }
      equipos.forEach(eq => {
        const estado = eq.estado_operativo || 'operativo'
        estadosOp[estado] = (estadosOp[estado] || 0) + 1
      })
      const porEstadoOperativo = [
        { nombre: 'Operativo', cantidad: estadosOp.operativo, color: '#10b981' },
        { nombre: 'Con restricciones', cantidad: estadosOp.operativo_restricciones, color: '#f59e0b' },
        { nombre: 'Fuera de servicio', cantidad: estadosOp.fuera_servicio, color: '#ef4444' }
      ]

      // Por tipo
      const tipos = {}
      equipos.forEach(eq => {
        const tipo = eq.tipo || 'Sin tipo'
        tipos[tipo] = (tipos[tipo] || 0) + 1
      })
      const porTipo = Object.entries(tipos).map(([nombre, cantidad]) => ({
        nombre,
        cantidad,
        porcentaje: ((cantidad / totalEquipos) * 100).toFixed(1)
      }))

      setStats({
        porUbicacion: porUbicacion.sort((a, b) => b.cantidad - a.cantidad),
        porEstadoOperativo,
        porTipo: porTipo.sort((a, b) => b.cantidad - a.cantidad),
        totalEquipos,
        equiposOperativos: estadosOp.operativo,
        equiposConRestriccion: estadosOp.operativo_restricciones,
        equiposFueraServicio: estadosOp.fuera_servicio
      })

    } catch (error) {
      console.error('Error:', error)
      alert('Error al cargar estadísticas')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <p style={{ fontSize: '1.2rem', color: '#6b7280' }}>Cargando estadísticas...</p>
      </div>
    )
  }

  const maxUbicacion = Math.max(...stats.porUbicacion.map(u => u.cantidad), 1)
  const maxTipo = Math.max(...stats.porTipo.map(t => t.cantidad), 1)

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
            📊 Dashboard de Equipos
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

      {/* Cards de resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '3px solid #667eea'
        }}>
          <div style={{ fontSize: '0.9rem', color: '#6b7280', marginBottom: '0.5rem', fontWeight: '600' }}>
            Total de Equipos
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#667eea' }}>
            {stats.totalEquipos}
          </div>
        </div>

        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '3px solid #10b981'
        }}>
          <div style={{ fontSize: '0.9rem', color: '#6b7280', marginBottom: '0.5rem', fontWeight: '600' }}>
            ✅ Operativos
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#10b981' }}>
            {stats.equiposOperativos}
          </div>
          <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
            {((stats.equiposOperativos / stats.totalEquipos) * 100).toFixed(0)}% del total
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
            ⚠️ Con Restricciones
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#f59e0b' }}>
            {stats.equiposConRestriccion}
          </div>
          <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
            {stats.totalEquipos > 0 ? ((stats.equiposConRestriccion / stats.totalEquipos) * 100).toFixed(0) : 0}% del total
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
            ❌ Fuera de Servicio
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#ef4444' }}>
            {stats.equiposFueraServicio}
          </div>
          <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
            {stats.totalEquipos > 0 ? ((stats.equiposFueraServicio / stats.totalEquipos) * 100).toFixed(0) : 0}% del total
          </div>
        </div>
      </div>

      {/* Gráficos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '2rem' }}>
        
        {/* Equipos por Ubicación */}
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1.5rem' }}>
            📍 Equipos por Ubicación
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {stats.porUbicacion.map((ubicacion, index) => (
              <div key={index}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>{ubicacion.nombre}</span>
                  <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>
                    {ubicacion.cantidad} ({ubicacion.porcentaje}%)
                  </span>
                </div>
                <div style={{
                  background: '#e5e7eb',
                  height: '24px',
                  borderRadius: '6px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    background: `hsl(${220 - index * 20}, 70%, 50%)`,
                    height: '100%',
                    width: `${(ubicacion.cantidad / maxUbicacion) * 100}%`,
                    transition: 'width 0.5s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: '0.875rem',
                    fontWeight: '600'
                  }}>
                    {ubicacion.cantidad}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Estado Operativo */}
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1.5rem' }}>
            🔧 Estado Operativo
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {stats.porEstadoOperativo.map((estado, index) => (
              <div key={index}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>{estado.nombre}</span>
                  <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>
                    {estado.cantidad} ({stats.totalEquipos > 0 ? ((estado.cantidad / stats.totalEquipos) * 100).toFixed(0) : 0}%)
                  </span>
                </div>
                <div style={{
                  background: '#e5e7eb',
                  height: '24px',
                  borderRadius: '6px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    background: estado.color,
                    height: '100%',
                    width: `${stats.totalEquipos > 0 ? (estado.cantidad / stats.totalEquipos) * 100 : 0}%`,
                    transition: 'width 0.5s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: '0.875rem',
                    fontWeight: '600'
                  }}>
                    {estado.cantidad > 0 && estado.cantidad}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Equipos por Tipo */}
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1.5rem' }}>
            🚜 Equipos por Tipo
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {stats.porTipo.map((tipo, index) => (
              <div key={index}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>{tipo.nombre}</span>
                  <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>
                    {tipo.cantidad} ({tipo.porcentaje}%)
                  </span>
                </div>
                <div style={{
                  background: '#e5e7eb',
                  height: '24px',
                  borderRadius: '6px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    background: `hsl(${280 - index * 30}, 65%, 55%)`,
                    height: '100%',
                    width: `${(tipo.cantidad / maxTipo) * 100}%`,
                    transition: 'width 0.5s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: '0.875rem',
                    fontWeight: '600'
                  }}>
                    {tipo.cantidad}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default Dashboard