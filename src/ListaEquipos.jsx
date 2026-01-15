import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'

function ListaEquipos({ onNuevo, onEditar, usuario, recargarKey }) {
  const [equipos, setEquipos] = useState([])
  const [loading, setLoading] = useState(true)
  
  // Filtros
  const [mostrarInactivos, setMostrarInactivos] = useState(false)
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [filtroUbicacion, setFiltroUbicacion] = useState('todas')
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [busqueda, setBusqueda] = useState('')
  
  // Listas para filtros
  const [tipos, setTipos] = useState([])
  const [ubicaciones, setUbicaciones] = useState([])

  useEffect(() => {
    cargarEquipos()
  }, [recargarKey, mostrarInactivos])

  async function cargarEquipos() {
    try {
      setLoading(true)

      let query = supabase
        .from('equipos')
        .select('*')
        .order('numero_identificacion')

      // Filtrar por estado activo/inactivo
      if (!mostrarInactivos) {
        query = query.eq('activo', true)
      }

      const { data, error } = await query

      if (error) throw error

      setEquipos(data || [])
      
      // Extraer valores únicos para filtros
      if (data) {
        const tiposUnicos = [...new Set(data.map(e => e.tipo_equipo).filter(Boolean))]
        const ubicacionesUnicas = [...new Set(data.map(e => e.ubicacion_actual).filter(Boolean))]
        setTipos(tiposUnicos.sort())
        setUbicaciones(ubicacionesUnicas.sort())
      }

    } catch (error) {
      console.error('Error:', error)
      alert('Error al cargar equipos: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  async function darDeBaja(equipo) {
    if (!confirm(`¿Dar de baja el equipo ${equipo.numero_identificacion}?\n\nEl equipo quedará inactivo y no podrá usarse para inspecciones o mantenimientos.`)) {
      return
    }

    try {
      const { error } = await supabase
        .from('equipos')
        .update({ activo: false })
        .eq('id', equipo.id)

      if (error) throw error

      alert('✅ Equipo dado de baja correctamente')
      cargarEquipos()

    } catch (error) {
      console.error('Error:', error)
      alert('❌ Error al dar de baja: ' + error.message)
    }
  }

  async function reactivar(equipo) {
    if (!confirm(`¿Reactivar el equipo ${equipo.numero_identificacion}?`)) {
      return
    }

    try {
      const { error } = await supabase
        .from('equipos')
        .update({ activo: true })
        .eq('id', equipo.id)

      if (error) throw error

      alert('✅ Equipo reactivado correctamente')
      cargarEquipos()

    } catch (error) {
      console.error('Error:', error)
      alert('❌ Error al reactivar: ' + error.message)
    }
  }

  // Aplicar filtros
  const equiposFiltrados = equipos.filter(equipo => {
    // Filtro por tipo
    if (filtroTipo !== 'todos' && equipo.tipo_equipo !== filtroTipo) return false
    
    // Filtro por ubicación
    if (filtroUbicacion !== 'todas' && equipo.ubicacion_actual !== filtroUbicacion) return false
    
    // Filtro por estado operativo
    if (filtroEstado !== 'todos' && equipo.estado_operativo !== filtroEstado) return false
    
    // Búsqueda por código o denominación
    if (busqueda.trim()) {
      const searchTerm = busqueda.toLowerCase()
      const codigo = (equipo.numero_identificacion || '').toLowerCase()
      const denom = (equipo.denominacion || '').toLowerCase()
      if (!codigo.includes(searchTerm) && !denom.includes(searchTerm)) return false
    }

    return true
  })

  function getEstadoColor(estado) {
    if (estado === 'operativo') return { bg: '#d1fae5', text: '#065f46' }
    if (estado === 'con_restriccion') return { bg: '#fef3c7', text: '#92400e' }
    if (estado === 'fuera_servicio') return { bg: '#fee2e2', text: '#991b1b' }
    return { bg: '#f3f4f6', text: '#4b5563' }
  }

  function getEstadoLabel(estado) {
    if (estado === 'operativo') return '✅ Operativo'
    if (estado === 'con_restriccion') return '⚠️ Con Restricción'
    if (estado === 'fuera_servicio') return '🔴 Fuera de Servicio'
    return 'Sin estado'
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem' }}>
        <p style={{ fontSize: '1.2rem', color: 'white' }}>⏳ Cargando equipos...</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1800px', margin: '0 auto' }}>
      {/* Controles superiores */}
      <div style={{
        background: 'white',
        padding: '1.5rem',
        borderRadius: '12px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        marginBottom: '1.5rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: '600', margin: 0 }}>
            📋 Listado de Equipos ({equiposFiltrados.length})
          </h2>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={mostrarInactivos}
                onChange={(e) => setMostrarInactivos(e.target.checked)}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>Mostrar dados de baja</span>
            </label>
            <button
              onClick={onNuevo}
              style={{
                padding: '0.75rem 1.5rem',
                background: '#f59e0b',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '1rem'
              }}
            >
              ➕ Nuevo Equipo
            </button>
          </div>
        </div>

        {/* Búsqueda */}
        <div style={{ marginBottom: '1rem' }}>
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="🔍 Buscar por código o denominación..."
            style={{
              width: '100%',
              padding: '0.75rem',
              border: '2px solid #e5e7eb',
              borderRadius: '8px',
              fontSize: '1rem'
            }}
          />
        </div>

        {/* Filtros */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: '#374151' }}>
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
              <option value="todos">Todos los tipos</option>
              {tipos.map(tipo => (
                <option key={tipo} value={tipo}>{tipo}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: '#374151' }}>
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
              <option value="todas">Todas las ubicaciones</option>
              {ubicaciones.map(ubi => (
                <option key={ubi} value={ubi}>{ubi}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: '#374151' }}>
              Estado Operativo
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
              <option value="todos">Todos los estados</option>
              <option value="operativo">✅ Operativo</option>
              <option value="con_restriccion">⚠️ Con Restricción</option>
              <option value="fuera_servicio">🔴 Fuera de Servicio</option>
            </select>
          </div>
        </div>

        {(filtroTipo !== 'todos' || filtroUbicacion !== 'todas' || filtroEstado !== 'todos' || busqueda) && (
          <button
            onClick={() => {
              setFiltroTipo('todos')
              setFiltroUbicacion('todas')
              setFiltroEstado('todos')
              setBusqueda('')
            }}
            style={{
              marginTop: '1rem',
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
      </div>

      {/* Tabla */}
      <div style={{
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        overflow: 'hidden'
      }}>
        {equiposFiltrados.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>
            <p style={{ fontSize: '1.2rem' }}>
              {equipos.length === 0 
                ? 'No hay equipos registrados aún'
                : 'No hay equipos que coincidan con los filtros'
              }
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                <tr>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', whiteSpace: 'nowrap' }}>Código</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', whiteSpace: 'nowrap' }}>Denominación</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', whiteSpace: 'nowrap' }}>Tipo</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', whiteSpace: 'nowrap' }}>Ubicación</th>
                  <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: '600', whiteSpace: 'nowrap' }}>Estado</th>
                  <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: '600', whiteSpace: 'nowrap' }}>Logística</th>
                  <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: '600' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {equiposFiltrados.map((equipo, index) => {
                  const color = getEstadoColor(equipo.estado_operativo)
                  const bgFila = index % 2 === 0 ? 'white' : '#f9fafb'
                  const esInactivo = !equipo.activo

                  return (
                    <tr key={equipo.id} style={{ 
                      borderBottom: '1px solid #e5e7eb', 
                      background: esInactivo ? '#fee2e2' : bgFila,
                      opacity: esInactivo ? 0.6 : 1
                    }}>
                      <td style={{ padding: '0.75rem', fontWeight: '600' }}>
                        {equipo.numero_identificacion}
                        {esInactivo && <span style={{ marginLeft: '0.5rem', color: '#ef4444', fontSize: '0.75rem' }}>INACTIVO</span>}
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        {equipo.denominacion || '-'}
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        {equipo.tipo_equipo}
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        {equipo.ubicacion_actual || '-'}
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                        <span style={{
                          padding: '0.25rem 0.5rem',
                          background: color.bg,
                          color: color.text,
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          whiteSpace: 'nowrap',
                          display: 'inline-block'
                        }}>
                          {getEstadoLabel(equipo.estado_operativo)}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                        {equipo.es_logistica ? (
                          <span style={{ fontSize: '1.2rem' }}>🚚</span>
                        ) : (
                          <span style={{ color: '#9ca3af' }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                          <button
                            onClick={() => onEditar(equipo)}
                            style={{
                              padding: '0.4rem 0.8rem',
                              background: '#3b82f6',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                              fontWeight: '600'
                            }}
                          >
                            ✏️ Editar
                          </button>
                          {equipo.activo ? (
                            <button
                              onClick={() => darDeBaja(equipo)}
                              style={{
                                padding: '0.4rem 0.8rem',
                                background: '#ef4444',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: '0.75rem',
                                fontWeight: '600'
                              }}
                            >
                              ❌ Baja
                            </button>
                          ) : (
                            <button
                              onClick={() => reactivar(equipo)}
                              style={{
                                padding: '0.4rem 0.8rem',
                                background: '#10b981',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: '0.75rem',
                                fontWeight: '600'
                              }}
                            >
                              ✅ Reactivar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default ListaEquipos