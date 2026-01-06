import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import EditarLineaPedidoModal from './EditarLineaPedidoModal.jsx'
import { generarReportesSemanalesPDF } from './utils/pdfReportesPedidos.js'

function ListaPedidosEquipos({ onNuevo, usuario, recargarKey }) {
  const [pedidos, setPedidos] = useState([])
  const [obras, setObras] = useState([])
  const [loading, setLoading] = useState(true)
  const [generandoReportes, setGenerandoReportes] = useState(false)
  
  // Filtros
  const [filtroObra, setFiltroObra] = useState('todas')
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('')
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('')
  
  // Edición
  const [lineaEditando, setLineaEditando] = useState(null)

  useEffect(() => {
    cargarDatos()
  }, [recargarKey])

  async function cargarDatos() {
    try {
      setLoading(true)

      // Cargar obras
      const { data: obrasData } = await supabase
        .from('obras')
        .select('id, codigo_obra, nombre_obra')
        .order('nombre_obra')
      setObras(obrasData || [])

      // Cargar pedidos con relaciones
      const { data, error } = await supabase
        .from('pedidos_equipos_lineas')
        .select(`
          *,
          obra:obras(codigo_obra, nombre_obra),
          equipo_asignado:equipos(numero_identificacion, estado_operativo),
          mantenimiento:mantenimientos(numero_aviso, estado)
        `)
        .order('fecha_recepcion', { ascending: false })

      if (error) throw error

      setPedidos(data || [])
    } catch (error) {
      console.error('Error:', error)
      alert('Error al cargar pedidos: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  // Aplicar filtros
  const pedidosFiltrados = pedidos.filter(pedido => {
    // Filtro por obra
    if (filtroObra !== 'todas' && pedido.obra_id !== filtroObra) {
      return false
    }

    // Filtro por estado (combinado)
    if (filtroEstado !== 'todos') {
      if (filtroEstado === 'pendiente_aprobacion' && pedido.estado_aprobacion !== 'pendiente_aprobacion') return false
      if (filtroEstado === 'aprobado_pendiente' && !(pedido.estado_aprobacion === 'aprobado' && pedido.estado_entrega === 'pendiente_asignacion')) return false
      if (filtroEstado === 'asignado' && pedido.estado_entrega !== 'asignado') return false
      if (filtroEstado === 'entregado' && pedido.estado_entrega !== 'entregado') return false
    }

    // Filtro por fechas
    if (filtroFechaDesde && pedido.fecha_recepcion < filtroFechaDesde) return false
    if (filtroFechaHasta && pedido.fecha_recepcion > filtroFechaHasta) return false

    return true
  })

  function getEstadoColor(estadoAprobacion, estadoEntrega) {
    if (estadoAprobacion === 'rechazado') return { bg: '#fee2e2', text: '#991b1b' }
    if (estadoAprobacion === 'pendiente_aprobacion') return { bg: '#fef3c7', text: '#92400e' }
    if (estadoEntrega === 'entregado') return { bg: '#d1fae5', text: '#065f46' }
    if (estadoEntrega === 'asignado') return { bg: '#dbeafe', text: '#1e40af' }
    return { bg: '#f3f4f6', text: '#4b5563' }
  }

  function getEstadoLabel(estadoAprobacion, estadoEntrega) {
    if (estadoAprobacion === 'rechazado') return '❌ Rechazado'
    if (estadoAprobacion === 'pendiente_aprobacion') return '⏳ Pend. Aprobación'
    if (estadoEntrega === 'entregado') return '✅ Entregado'
    if (estadoEntrega === 'asignado') return '🔵 Asignado'
    if (estadoEntrega === 'pendiente_asignacion') return '⚪ Pend. Asignación'
    if (estadoEntrega === 'cancelado') return '🚫 Cancelado'
    return ''
  }

  async function generarReportesSemanales() {
    try {
      setGenerandoReportes(true)

      // Filtrar solo pedidos NO entregados y NO rechazados
      const pedidosNoEntregados = pedidos.filter(p => 
        p.estado_entrega !== 'entregado' && 
        p.estado_aprobacion !== 'rechazado'
      )

      if (pedidosNoEntregados.length === 0) {
        alert('ℹ️ No hay pedidos pendientes para generar reportes')
        return
      }

      // Contar solicitantes únicos
      const solicitantes = [...new Set(pedidosNoEntregados.map(p => p.email_solicitante))]
      
      if (!confirm(`¿Generar reportes para ${solicitantes.length} solicitante(s)?\n\nSe generarán ${solicitantes.length} PDF(s) en un archivo ZIP.`)) {
        return
      }

      await generarReportesSemanalesPDF(pedidosNoEntregados, obras)
      
      alert(`✅ Reportes generados exitosamente!\n\n${solicitantes.length} PDF(s) descargados en ZIP.`)

    } catch (error) {
      console.error('Error:', error)
      alert('❌ Error al generar reportes: ' + error.message)
    } finally {
      setGenerandoReportes(false)
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem' }}>
        <p style={{ fontSize: '1.2rem', color: 'white' }}>⏳ Cargando pedidos...</p>
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
            📋 Listado de Pedidos ({pedidosFiltrados.length})
          </h2>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <button
              onClick={generarReportesSemanales}
              disabled={generandoReportes}
              style={{
                padding: '0.75rem 1.5rem',
                background: generandoReportes ? '#9ca3af' : '#8b5cf6',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: generandoReportes ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                fontSize: '1rem'
              }}
            >
              {generandoReportes ? '⏳ Generando...' : '📧 Generar Reportes Semanales'}
            </button>
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
              ➕ Registrar Pedido
            </button>
          </div>
        </div>

        {/* Filtros */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: '#374151' }}>
              Obra
            </label>
            <select
              value={filtroObra}
              onChange={(e) => setFiltroObra(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '0.875rem'
              }}
            >
              <option value="todas">Todas las obras</option>
              {obras.map(obra => (
                <option key={obra.id} value={obra.id}>
                  {obra.codigo_obra} - {obra.nombre_obra}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: '#374151' }}>
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
              <option value="todos">Todos los estados</option>
              <option value="pendiente_aprobacion">⏳ Pendiente Aprobación</option>
              <option value="aprobado_pendiente">⚪ Aprobado - Sin asignar</option>
              <option value="asignado">🔵 Asignado</option>
              <option value="entregado">✅ Entregado</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: '#374151' }}>
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
                fontSize: '0.875rem'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: '#374151' }}>
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
                fontSize: '0.875rem'
              }}
            />
          </div>
        </div>

        {(filtroObra !== 'todas' || filtroEstado !== 'todos' || filtroFechaDesde || filtroFechaHasta) && (
          <button
            onClick={() => {
              setFiltroObra('todas')
              setFiltroEstado('todos')
              setFiltroFechaDesde('')
              setFiltroFechaHasta('')
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
        {pedidosFiltrados.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>
            <p style={{ fontSize: '1.2rem' }}>
              {pedidos.length === 0 
                ? 'No hay pedidos registrados aún'
                : 'No hay pedidos que coincidan con los filtros'
              }
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                <tr>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', whiteSpace: 'nowrap' }}>Pedido</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', whiteSpace: 'nowrap' }}>Obra</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', whiteSpace: 'nowrap' }}>Solicitante</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', whiteSpace: 'nowrap' }}>Equipo Solicitado</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', whiteSpace: 'nowrap' }}>Equipo Asignado</th>
                  <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: '600', whiteSpace: 'nowrap' }}>Estado</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', whiteSpace: 'nowrap' }}>OT</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600' }}>Comentarios</th>
                  <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: '600' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {pedidosFiltrados.map((pedido, index) => {
                  const color = getEstadoColor(pedido.estado_aprobacion, pedido.estado_entrega)
                  const bgFila = index % 2 === 0 ? 'white' : '#f9fafb'

                  return (
                    <tr key={pedido.id} style={{ borderBottom: '1px solid #e5e7eb', background: bgFila }}>
                      <td style={{ padding: '0.75rem', fontWeight: '600' }}>
                        {pedido.numero_pedido}
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                          {pedido.obra?.codigo_obra}
                        </div>
                        <div style={{ fontWeight: '500' }}>
                          {pedido.obra?.nombre_obra}
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem', fontSize: '0.8rem' }}>
                        {pedido.email_solicitante}
                      </td>
                      <td style={{ padding: '0.75rem', fontWeight: '500' }}>
                        {pedido.tipo_equipo_solicitado}
                        {pedido.cantidad_solicitada > 1 && (
                          <span style={{ marginLeft: '0.25rem', color: '#6b7280' }}>
                            (x{pedido.cantidad_solicitada})
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        {pedido.equipo_asignado ? (
                          <div>
                            <div style={{ fontWeight: '600', color: '#10b981' }}>
                              {pedido.equipo_asignado.numero_identificacion}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                              {pedido.equipo_asignado.estado_operativo === 'operativo' ? '✅ Operativo' :
                               pedido.equipo_asignado.estado_operativo === 'fuera_servicio' ? '🔴 Fuera Servicio' :
                               '⚠️ Con Restricción'}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Sin asignar</span>
                        )}
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
                          {getEstadoLabel(pedido.estado_aprobacion, pedido.estado_entrega)}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        {pedido.mantenimiento ? (
                          <div>
                            <div style={{ fontWeight: '600' }}>
                              {pedido.mantenimiento.numero_aviso}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                              {pedido.mantenimiento.estado}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem', maxWidth: '200px' }}>
                        <div style={{ 
                          overflow: 'hidden', 
                          textOverflow: 'ellipsis', 
                          whiteSpace: 'nowrap',
                          fontSize: '0.8rem',
                          color: '#4b5563'
                        }}>
                          {pedido.comentarios || '-'}
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                        <button
                          onClick={() => setLineaEditando(pedido)}
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
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de edición */}
      {lineaEditando && (
        <EditarLineaPedidoModal
          linea={lineaEditando}
          onCerrar={() => setLineaEditando(null)}
          onActualizado={() => {
            setLineaEditando(null)
            cargarDatos()
          }}
        />
      )}
    </div>
  )
}

export default ListaPedidosEquipos