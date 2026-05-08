import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'

function ListaOperadores({ onNuevo, onEditar }) {
  const [operadores, setOperadores] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroEstado, setFiltroEstado] = useState('activo')
  const [filtroTipoEquipo, setFiltroTipoEquipo] = useState('todos')
  const [busqueda, setBusqueda] = useState('')

  // Lista de tipos de equipos (misma que en pedidos)
  const tiposEquipos = [
    'Excavadora', 'Retroexcavadora', 'Minicargador', 'Cargador Frontal',
    'Motoniveladora', 'Rodillo Compactador', 'Camión', 'Camioneta',
    'Mixer', 'Bomba de Concreto', 'Grúa', 'Montacarga', 'Generador',
    'Compresor', 'Plataforma Elevadora', 'Otro'
  ]

  useEffect(() => {
    cargarOperadores()
  }, [])

  async function cargarOperadores() {
    try {
      setLoading(true)
      
      const { data, error } = await supabase
        .from('operadores')
        .select(`
          *,
          equipos_asignados:equipos!operador_asignado_id(
            id,
            numero_identificacion,
            denominacion
          )
        `)
        .order('apellidos', { ascending: true })
      
      if (error) throw error
      
      setOperadores(data || [])
    } catch (error) {
      console.error('Error:', error)
      alert('Error al cargar operadores: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  // Filtrar operadores
  const operadoresFiltrados = operadores.filter(operador => {
    const matchEstado = filtroEstado === 'todos' || operador.estado === filtroEstado
    
    const matchTipoEquipo = filtroTipoEquipo === 'todos' || 
      (operador.tipos_equipos_habilitado || []).includes(filtroTipoEquipo)
    
    const nombreCompleto = `${operador.nombres} ${operador.apellidos}`.toLowerCase()
    const matchBusqueda = 
      nombreCompleto.includes(busqueda.toLowerCase()) ||
      (operador.numero_documento || '').includes(busqueda)
    
    return matchEstado && matchTipoEquipo && matchBusqueda
  })

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ fontSize: '1.2rem' }}>Cargando operadores...</p>
      </div>
    )
  }

  const totalActivos = operadores.filter(o => o.estado === 'activo').length
  const totalInactivos = operadores.filter(o => o.estado === 'inactivo').length

  return (
    <div style={{ padding: 'clamp(1rem, 2vw, 2rem)' }}>
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
            <h1 style={{ fontSize: '2rem', fontWeight: '700', margin: 0, marginBottom: '0.5rem' }}>
              👷 Gestión de Operadores
            </h1>
            <p style={{ color: '#6b7280', margin: 0 }}>
              Administra los operadores de equipos
            </p>
          </div>
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
            onMouseEnter={(e) => e.target.style.background = '#059669'}
            onMouseLeave={(e) => e.target.style.background = '#10b981'}
          >
            ➕ Nuevo Operador
          </button>
        </div>
      </div>

      {/* Estadísticas */}
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
          border: '3px solid #10b981'
        }}>
          <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem', fontWeight: '600' }}>
            ✅ Activos
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#10b981' }}>
            {totalActivos}
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
            🚫 Inactivos
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#ef4444' }}>
            {totalInactivos}
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
            📊 Total
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#3b82f6' }}>
            {operadores.length}
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
        <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1rem' }}>
          🔍 Filtrar Operadores
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#1f2937' }}>
              Buscar
            </label>
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Nombre o documento..."
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
              <option value="activo">✅ Activos</option>
              <option value="inactivo">🚫 Inactivos</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#1f2937' }}>
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
              <option value="todos">Todos los tipos</option>
              {tiposEquipos.map(tipo => (
                <option key={tipo} value={tipo}>{tipo}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#6b7280' }}>
          Mostrando {operadoresFiltrados.length} de {operadores.length} operadores
        </div>
      </div>

      {/* Lista de Operadores */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1.5rem' }}>
        {operadoresFiltrados.map(operador => {
          const equiposAsignados = operador.equipos_asignados || []
          const tiposHabilitado = operador.tipos_equipos_habilitado || []

          return (
            <div
              key={operador.id}
              style={{
                background: 'white',
                padding: '1.5rem',
                borderRadius: '12px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                border: operador.estado === 'activo' ? '2px solid #10b981' : '2px solid #ef4444',
                cursor: 'pointer',
                transition: 'transform 0.2s, box-shadow 0.2s'
              }}
              onClick={() => onEditar(operador)}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-4px)'
                e.currentTarget.style.boxShadow = '0 8px 16px rgba(0,0,0,0.15)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)'
              }}
            >
              {/* Header con estado */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                <div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: '700', margin: 0, marginBottom: '0.25rem', color: '#1f2937' }}>
                    {operador.apellidos}, {operador.nombres}
                  </h3>
                  <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                    📄 CI: {operador.numero_documento}
                  </div>
                </div>
                <div style={{
                  background: operador.estado === 'activo' ? '#d1fae5' : '#fee2e2',
                  color: operador.estado === 'activo' ? '#065f46' : '#991b1b',
                  padding: '0.25rem 0.75rem',
                  borderRadius: '999px',
                  fontSize: '0.75rem',
                  fontWeight: '600'
                }}>
                  {operador.estado === 'activo' ? '✅ ACTIVO' : '🚫 INACTIVO'}
                </div>
              </div>

              {/* Contacto */}
              <div style={{ marginBottom: '1rem', fontSize: '0.875rem', color: '#374151' }}>
                {operador.telefono && (
                  <div style={{ marginBottom: '0.25rem' }}>
                    📞 {operador.telefono}
                  </div>
                )}
                {operador.direccion && (
                  <div style={{ marginBottom: '0.25rem' }}>
                    📍 {operador.direccion}
                  </div>
                )}
                {operador.fecha_ingreso && (
                  <div>
                    📅 Ingreso: {new Date(operador.fecha_ingreso).toLocaleDateString('es-PY')}
                  </div>
                )}
              </div>

              {/* Tipos de equipos habilitado */}
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#6b7280', marginBottom: '0.5rem' }}>
                  EQUIPOS HABILITADO:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {tiposHabilitado.length > 0 ? (
                    tiposHabilitado.map(tipo => (
                      <span
                        key={tipo}
                        style={{
                          background: '#dbeafe',
                          color: '#1e40af',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: '600'
                        }}
                      >
                        {tipo}
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: '0.875rem', color: '#9ca3af', fontStyle: 'italic' }}>
                      Sin tipos asignados
                    </span>
                  )}
                </div>
              </div>

              {/* Equipos asignados */}
              {equiposAsignados.length > 0 && (
                <div style={{
                  background: '#f0fdf4',
                  padding: '0.75rem',
                  borderRadius: '6px',
                  border: '1px solid #86efac'
                }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#16a34a', marginBottom: '0.5rem' }}>
                    EQUIPOS ASIGNADOS:
                  </div>
                  {equiposAsignados.map(equipo => (
                    <div key={equipo.id} style={{ fontSize: '0.875rem', color: '#166534', marginBottom: '0.25rem' }}>
                      🚜 {equipo.numero_identificacion} - {equipo.denominacion}
                    </div>
                  ))}
                </div>
              )}

              {/* Observaciones */}
              {operador.observaciones && (
                <div style={{
                  marginTop: '1rem',
                  fontSize: '0.875rem',
                  color: '#6b7280',
                  fontStyle: 'italic',
                  borderTop: '1px solid #e5e7eb',
                  paddingTop: '0.75rem'
                }}>
                  💬 {operador.observaciones}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {operadoresFiltrados.length === 0 && (
        <div style={{
          background: 'white',
          padding: '3rem',
          borderRadius: '12px',
          textAlign: 'center',
          color: '#9ca3af'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔍</div>
          <div style={{ fontSize: '1.125rem', fontWeight: '600' }}>No se encontraron operadores</div>
          <div style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
            Intenta ajustar los filtros o agrega un nuevo operador
          </div>
        </div>
      )}
    </div>
  )
}

export default ListaOperadores