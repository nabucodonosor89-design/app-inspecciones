import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import EditarLineaPedidoModal from './EditarLineaPedidoModal.jsx'
import { generarReportesSemanalesPDF } from './utils/pdfReportesPedidos.js'
import * as XLSX from 'xlsx'

function ListaPedidosEquipos({ onNuevo, usuario, recargarKey }) {
  const [pedidos, setPedidos] = useState([])
  const [obras, setObras] = useState([])
  const [loading, setLoading] = useState(true)
  const [generandoReportes, setGenerandoReportes] = useState(false)
  
  // Filtros
  const [filtroObra, setFiltroObra] = useState('todas')
  const [filtroEstado, setFiltroEstado] = useState('pendientes') // CAMBIADO: por defecto mostrar pendientes
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('')
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('')
  const [filtroEquipo, setFiltroEquipo] = useState('') // NUEVO: filtro por código de equipo
  
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
          equipo_asignado:equipos(numero_identificacion, estado_operativo, ubicacion_actual),
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
      if (filtroEstado === 'pendientes' && pedido.estado_entrega === 'entregado') return false // NUEVO: excluir entregados
      if (filtroEstado === 'pendiente_aprobacion' && pedido.estado_aprobacion !== 'pendiente_aprobacion') return false
      if (filtroEstado === 'aprobado_pendiente' && !(pedido.estado_aprobacion === 'aprobado' && pedido.estado_entrega === 'pendiente_asignacion')) return false
      if (filtroEstado === 'asignado' && pedido.estado_entrega !== 'asignado') return false
      if (filtroEstado === 'entregado' && pedido.estado_entrega !== 'entregado') return false
    }

    // Filtro por fechas
    if (filtroFechaDesde && pedido.fecha_recepcion < filtroFechaDesde) return false
    if (filtroFechaHasta && pedido.fecha_recepcion > filtroFechaHasta) return false

    // NUEVO: Filtro por código de equipo
    if (filtroEquipo.trim() !== '') {
      const equipoNumero = pedido.equipo_asignado?.numero_identificacion || ''
      if (!equipoNumero.toLowerCase().includes(filtroEquipo.toLowerCase())) {
        return false
      }
    }

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

  function exportarAExcel() {
    try {
      // Usar pedidos filtrados actuales
      if (pedidosFiltrados.length === 0) {
        alert('ℹ️ No hay pedidos para exportar')
        return
      }

      // Preparar datos para Excel
      const datosExcel = pedidosFiltrados.map(pedido => {
        const equipo = pedido.equipo_asignado || {}
        const obra = pedido.obra || {}
        const mantenimiento = pedido.mantenimiento || {}

        return {
          'Fecha Recepción': pedido.fecha_recepcion ? new Date(pedido.fecha_recepcion).toLocaleDateString('es-PY') : '',
          'Obra': obra.nombre_obra || '',
          'Código Obra': obra.codigo_obra || '',
          'Tipo Equipo': pedido.tipo_equipo || '',
          'Cantidad': pedido.cantidad || 0,
          'Solicitado Por': pedido.solicitado_por || '',
          'Email Solicitante': pedido.email_solicitante || '',
          'Estado': pedido.estado || '',
          'Prioridad': pedido.prioridad || '',
          'Equipo Asignado': equipo.numero_identificacion || 'Sin asignar',
          'Estado Equipo': equipo.estado_operativo || '',
          'Ubicación Equipo': equipo.ubicacion_actual || '',
          'Fecha Asignación': pedido.fecha_asignacion ? new Date(pedido.fecha_asignacion).toLocaleDateString('es-PY') : '',
          'Fecha Completado': pedido.fecha_completado ? new Date(pedido.fecha_completado).toLocaleDateString('es-PY') : '',
          'Estado Entrega': pedido.estado_entrega || '',
          'Estado Aprobación': pedido.estado_aprobacion || '',
          'Aviso Mantenimiento': mantenimiento.numero_aviso || '',
          'Estado Mantenimiento': mantenimiento.estado || '',
          'Observaciones': pedido.observaciones || '',
          'Creado': pedido.created_at ? new Date(pedido.created_at).toLocaleDateString('es-PY') : ''
        }
      })

      // Crear libro de trabajo
      const wb = XLSX.utils.book_new()
      
      // Crear hoja principal
      const ws = XLSX.utils.json_to_sheet(datosExcel)

      // Configurar anchos de columna
      ws['!cols'] = [
        { wch: 15 }, // Fecha Recepción
        { wch: 30 }, // Obra
        { wch: 12 }, // Código Obra
        { wch: 25 }, // Tipo Equipo
        { wch: 10 }, // Cantidad
        { wch: 25 }, // Solicitado Por
        { wch: 30 }, // Email Solicitante
        { wch: 15 }, // Estado
        { wch: 12 }, // Prioridad
        { wch: 15 }, // Equipo Asignado
        { wch: 18 }, // Estado Equipo
        { wch: 25 }, // Ubicación Equipo
        { wch: 15 }, // Fecha Asignación
        { wch: 15 }, // Fecha Completado
        { wch: 15 }, // Estado Entrega
        { wch: 18 }, // Estado Aprobación
        { wch: 20 }, // Aviso Mantenimiento
        { wch: 20 }, // Estado Mantenimiento
        { wch: 40 }, // Observaciones
        { wch: 15 }  // Creado
      ]

      XLSX.utils.book_append_sheet(wb, ws, 'Pedidos de Equipos')

      // Agregar hoja de resumen
      const resumen = [
        { Concepto: 'Total Pedidos', Valor: pedidosFiltrados.length },
        { Concepto: 'Pendientes', Valor: pedidosFiltrados.filter(p => p.estado === 'pendiente').length },
        { Concepto: 'En Proceso', Valor: pedidosFiltrados.filter(p => p.estado === 'en_proceso').length },
        { Concepto: 'Completados', Valor: pedidosFiltrados.filter(p => p.estado === 'completado').length },
        { Concepto: 'Con Equipo Asignado', Valor: pedidosFiltrados.filter(p => p.equipo_asignado_id).length },
        { Concepto: 'Sin Equipo', Valor: pedidosFiltrados.filter(p => !p.equipo_asignado_id).length }
      ]

      const wsResumen = XLSX.utils.json_to_sheet(resumen)
      wsResumen['!cols'] = [{ wch: 25 }, { wch: 15 }]
      XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen')

      // Generar nombre de archivo
      const fecha = new Date().toISOString().split('T')[0]
      const nombreArchivo = `Pedidos_Equipos_${fecha}.xlsx`

      // Descargar
      XLSX.writeFile(wb, nombreArchivo)

      alert(`✅ Archivo Excel generado exitosamente!\n\n${pedidosFiltrados.length} pedidos exportados\nArchivo: ${nombreArchivo}`)

    } catch (error) {
      console.error('Error al exportar:', error)
      alert('❌ Error al exportar a Excel: ' + error.message)
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
              onClick={exportarAExcel}
              style={{
                padding: '0.75rem 1.5rem',
                background: '#059669',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '1rem'
              }}
            >
              📊 Exportar a Excel
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
              <option value="pendientes">📋 Pendientes de entrega</option>
              <option value="pendiente_aprobacion">⏳ Pendiente Aprobación</option>
              <option value="aprobado_pendiente">⚪ Aprobado - Sin asignar</option>
              <option value="asignado">🔵 Asignado</option>
              <option value="entregado">✅ Entregado</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: '#374151' }}>
              Código de Equipo
            </label>
            <input
              type="text"
              value={filtroEquipo}
              onChange={(e) => setFiltroEquipo(e.target.value)}
              placeholder="Ej: EQ-001"
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

        {(filtroObra !== 'todas' || filtroEstado !== 'todos' || filtroFechaDesde || filtroFechaHasta || filtroEquipo) && (
          <button
            onClick={() => {
              setFiltroObra('todas')
              setFiltroEstado('pendientes') // Volver al filtro por defecto
              setFiltroFechaDesde('')
              setFiltroFechaHasta('')
              setFiltroEquipo('') // Limpiar filtro de equipo
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
      {/* Vista Kanban - Tres Columnas */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '1fr 1fr 1fr', 
        gap: '1.5rem',
        alignItems: 'start'
      }}>
        {/* Columna 1: PENDIENTE APROBACIÓN */}
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
              fontSize: '1.1rem', 
              fontWeight: '700',
              color: '#92400e',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span>⏳ PENDIENTE APROBACIÓN</span>
              <span style={{ 
                background: '#f59e0b', 
                color: 'white', 
                padding: '0.25rem 0.75rem', 
                borderRadius: '999px',
                fontSize: '0.875rem'
              }}>
                {pedidosFiltrados.filter(p => p.estado_aprobacion === 'pendiente_aprobacion').length}
              </span>
            </h3>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {pedidosFiltrados
              .filter(pedido => pedido.estado_aprobacion === 'pendiente_aprobacion')
              .map(pedido => {
                const obra = pedido.obra || {}
                const equipo = pedido.equipo_asignado || null
                
                return (
                  <div
                    key={pedido.id}
                    style={{
                      background: 'white',
                      padding: '1rem',
                      borderRadius: '8px',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                      border: '2px solid #e5e7eb',
                      cursor: 'pointer',
                      transition: 'transform 0.2s, box-shadow 0.2s'
                    }}
                    onClick={() => setLineaEditando(pedido)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)'
                      e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)'
                      e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)'
                    }}
                  >
                    {/* Header - Obra */}
                    <div style={{ 
                      fontSize: '1rem', 
                      fontWeight: '700',
                      color: '#1f2937',
                      marginBottom: '0.75rem',
                      borderBottom: '2px solid #f3f4f6',
                      paddingBottom: '0.5rem'
                    }}>
                      🏗️ {obra.codigo_obra} - {obra.nombre_obra}
                    </div>

                    {/* Tipo de Equipo */}
                    <div style={{ 
                      fontSize: '0.875rem', 
                      color: '#374151',
                      marginBottom: '0.5rem',
                      fontWeight: '600'
                    }}>
                      <span style={{ color: '#6b7280' }}>Tipo:</span> {pedido.tipo_equipo_solicitado}
                    </div>

                    {/* Equipo Asignado */}
                    {equipo ? (
                      <div style={{
                        background: '#dbeafe',
                        padding: '0.5rem',
                        borderRadius: '4px',
                        marginBottom: '0.5rem'
                      }}>
                        <div style={{ fontSize: '0.875rem', fontWeight: '600', color: '#1e40af' }}>
                          📦 {equipo.numero_identificacion}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                          Estado: {equipo.estado_operativo}
                        {equipo.ubicacion_actual && (
                          <div style={{ fontSize: '0.75rem', color: '#3b82f6', marginTop: '0.25rem' }}>
                            📍 {equipo.ubicacion_actual}
                          </div>
                        )}
                        </div>
                      </div>
                    ) : (
                      <div style={{
                        background: '#f3f4f6',
                        padding: '0.5rem',
                        borderRadius: '4px',
                        marginBottom: '0.5rem',
                        fontSize: '0.875rem',
                        color: '#6b7280',
                        fontStyle: 'italic'
                      }}>
                        Sin equipo asignado
                      </div>
                    )}

                    {/* Fecha */}
                    <div style={{ 
                      fontSize: '0.75rem',
                      color: '#6b7280',
                      marginTop: '0.5rem'
                    }}>
                      📅 {new Date(pedido.fecha_recepcion).toLocaleDateString('es-PY')}
                    </div>
                  </div>
                )
              })}
              
            {pedidosFiltrados.filter(p => p.estado_aprobacion === 'pendiente_aprobacion').length === 0 && (
              <div style={{
                background: '#f9fafb',
                padding: '2rem',
                borderRadius: '8px',
                textAlign: 'center',
                color: '#9ca3af',
                fontSize: '0.875rem'
              }}>
                No hay pedidos pendientes de aprobación
              </div>
            )}
          </div>
        </div>

        {/* Columna 2: APROBADO - SIN ASIGNAR */}
        <div>
          <div style={{
            background: '#f3f4f6',
            padding: '1rem',
            borderRadius: '8px 8px 0 0',
            borderBottom: '3px solid #9ca3af',
            marginBottom: '1rem'
          }}>
            <h3 style={{ 
              margin: 0, 
              fontSize: '1.1rem', 
              fontWeight: '700',
              color: '#4b5563',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span>⚪ APROBADO - SIN ASIGNAR</span>
              <span style={{ 
                background: '#9ca3af', 
                color: 'white', 
                padding: '0.25rem 0.75rem', 
                borderRadius: '999px',
                fontSize: '0.875rem'
              }}>
                {pedidosFiltrados.filter(p => p.estado_aprobacion === 'aprobado' && p.estado_entrega === 'pendiente_asignacion').length}
              </span>
            </h3>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {pedidosFiltrados
              .filter(pedido => pedido.estado_aprobacion === 'aprobado' && pedido.estado_entrega === 'pendiente_asignacion')
              .map(pedido => {
                const obra = pedido.obra || {}
                const equipo = pedido.equipo_asignado || null
                
                return (
                  <div
                    key={pedido.id}
                    style={{
                      background: 'white',
                      padding: '1rem',
                      borderRadius: '8px',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                      border: '2px solid #e5e7eb',
                      cursor: 'pointer',
                      transition: 'transform 0.2s, box-shadow 0.2s'
                    }}
                    onClick={() => setLineaEditando(pedido)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)'
                      e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)'
                      e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)'
                    }}
                  >
                    {/* Header - Obra */}
                    <div style={{ 
                      fontSize: '1rem', 
                      fontWeight: '700',
                      color: '#1f2937',
                      marginBottom: '0.75rem',
                      borderBottom: '2px solid #f3f4f6',
                      paddingBottom: '0.5rem'
                    }}>
                      🏗️ {obra.codigo_obra} - {obra.nombre_obra}
                    </div>

                    {/* Tipo de Equipo */}
                    <div style={{ 
                      fontSize: '0.875rem', 
                      color: '#374151',
                      marginBottom: '0.5rem',
                      fontWeight: '600'
                    }}>
                      <span style={{ color: '#6b7280' }}>Tipo:</span> {pedido.tipo_equipo_solicitado}
                    </div>

                    {/* Equipo Asignado */}
                    {equipo ? (
                      <div style={{
                        background: '#dbeafe',
                        padding: '0.5rem',
                        borderRadius: '4px',
                        marginBottom: '0.5rem'
                      }}>
                        <div style={{ fontSize: '0.875rem', fontWeight: '600', color: '#1e40af' }}>
                          📦 {equipo.numero_identificacion}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                          Estado: {equipo.estado_operativo}
                        {equipo.ubicacion_actual && (
                          <div style={{ fontSize: '0.75rem', color: '#3b82f6', marginTop: '0.25rem' }}>
                            📍 {equipo.ubicacion_actual}
                          </div>
                        )}
                        </div>
                      </div>
                    ) : (
                      <div style={{
                        background: '#fef3c7',
                        padding: '0.5rem',
                        borderRadius: '4px',
                        marginBottom: '0.5rem',
                        fontSize: '0.875rem',
                        color: '#92400e',
                        fontWeight: '600'
                      }}>
                        ⚠️ Pendiente asignar equipo
                      </div>
                    )}

                    {/* Fecha */}
                    <div style={{ 
                      fontSize: '0.75rem',
                      color: '#6b7280',
                      marginTop: '0.5rem'
                    }}>
                      📅 {new Date(pedido.fecha_recepcion).toLocaleDateString('es-PY')}
                    </div>
                  </div>
                )
              })}
              
            {pedidosFiltrados.filter(p => p.estado_aprobacion === 'aprobado' && p.estado_entrega === 'pendiente_asignacion').length === 0 && (
              <div style={{
                background: '#f9fafb',
                padding: '2rem',
                borderRadius: '8px',
                textAlign: 'center',
                color: '#9ca3af',
                fontSize: '0.875rem'
              }}>
                No hay pedidos aprobados sin asignar
              </div>
            )}
          </div>
        </div>

        {/* Columna 3: ASIGNADO */}
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
              fontSize: '1.1rem', 
              fontWeight: '700',
              color: '#1e40af',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span>🔵 ASIGNADO</span>
              <span style={{ 
                background: '#3b82f6', 
                color: 'white', 
                padding: '0.25rem 0.75rem', 
                borderRadius: '999px',
                fontSize: '0.875rem'
              }}>
                {pedidosFiltrados.filter(p => p.estado_entrega === 'asignado').length}
              </span>
            </h3>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {pedidosFiltrados
              .filter(pedido => pedido.estado_entrega === 'asignado')
              .map(pedido => {
                const obra = pedido.obra || {}
                const equipo = pedido.equipo_asignado || null
                
                return (
                  <div
                    key={pedido.id}
                    style={{
                      background: 'white',
                      padding: '1rem',
                      borderRadius: '8px',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                      border: '2px solid #3b82f6',
                      cursor: 'pointer',
                      transition: 'transform 0.2s, box-shadow 0.2s'
                    }}
                    onClick={() => setLineaEditando(pedido)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)'
                      e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)'
                      e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)'
                    }}
                  >
                    {/* Header - Obra */}
                    <div style={{ 
                      fontSize: '1rem', 
                      fontWeight: '700',
                      color: '#1f2937',
                      marginBottom: '0.75rem',
                      borderBottom: '2px solid #f3f4f6',
                      paddingBottom: '0.5rem'
                    }}>
                      🏗️ {obra.codigo_obra} - {obra.nombre_obra}
                    </div>

                    {/* Tipo de Equipo */}
                    <div style={{ 
                      fontSize: '0.875rem', 
                      color: '#374151',
                      marginBottom: '0.5rem',
                      fontWeight: '600'
                    }}>
                      <span style={{ color: '#6b7280' }}>Tipo:</span> {pedido.tipo_equipo_solicitado}
                    </div>

                    {/* Equipo Asignado */}
                    {equipo && (
                      <div style={{
                        background: '#d1fae5',
                        padding: '0.5rem',
                        borderRadius: '4px',
                        marginBottom: '0.5rem'
                      }}>
                        <div style={{ fontSize: '0.875rem', fontWeight: '600', color: '#065f46' }}>
                          ✅ {equipo.numero_identificacion}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                          Estado: {equipo.estado_operativo}
                        {equipo.ubicacion_actual && (
                          <div style={{ fontSize: '0.75rem', color: '#3b82f6', marginTop: '0.25rem' }}>
                            📍 {equipo.ubicacion_actual}
                          </div>
                        )}
                        </div>
                      </div>
                    )}

                    {/* Fecha */}
                    <div style={{ 
                      fontSize: '0.75rem',
                      color: '#6b7280',
                      marginTop: '0.5rem'
                    }}>
                      📅 {new Date(pedido.fecha_recepcion).toLocaleDateString('es-PY')}
                    </div>
                  </div>
                )
              })}
              
            {pedidosFiltrados.filter(p => p.estado_entrega === 'asignado').length === 0 && (
              <div style={{
                background: '#f9fafb',
                padding: '2rem',
                borderRadius: '8px',
                textAlign: 'center',
                color: '#9ca3af',
                fontSize: '0.875rem'
              }}>
                No hay pedidos asignados
              </div>
            )}
          </div>
        </div>
      </div>

      {pedidosFiltrados.length === 0 && (
        <div style={{
          background: 'white',
          padding: '3rem',
          borderRadius: '12px',
          textAlign: 'center',
          color: '#9ca3af',
          marginTop: '1.5rem'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔍</div>
          <div style={{ fontSize: '1.125rem', fontWeight: '600' }}>No se encontraron pedidos</div>
          <div style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
            Intenta ajustar los filtros para ver más resultados
          </div>
        </div>
      )}
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