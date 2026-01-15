import * as XLSX from 'xlsx'

export function exportarPedidosAExcel(pedidos) {
  try {
    // Preparar los datos para Excel
    const datosExcel = pedidos.map(pedido => {
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
        'Estado': pedido.estado || '',
        'Prioridad': pedido.prioridad || '',
        'Equipo Asignado': equipo.numero_identificacion || 'Sin asignar',
        'Estado Equipo': equipo.estado_operativo || '',
        'Ubicación Equipo': equipo.ubicacion_actual || '',
        'Fecha Asignación': pedido.fecha_asignacion ? new Date(pedido.fecha_asignacion).toLocaleDateString('es-PY') : '',
        'Fecha Completado': pedido.fecha_completado ? new Date(pedido.fecha_completado).toLocaleDateString('es-PY') : '',
        'Aviso Mantenimiento': mantenimiento.numero_aviso || '',
        'Estado Mantenimiento': mantenimiento.estado || '',
        'Observaciones': pedido.observaciones || '',
        'Creado': pedido.created_at ? new Date(pedido.created_at).toLocaleDateString('es-PY') : ''
      }
    })

    // Crear libro de trabajo
    const wb = XLSX.utils.book_new()
    
    // Crear hoja de cálculo
    const ws = XLSX.utils.json_to_sheet(datosExcel)

    // Configurar anchos de columna
    const columnWidths = [
      { wch: 15 }, // Fecha Recepción
      { wch: 30 }, // Obra
      { wch: 12 }, // Código Obra
      { wch: 25 }, // Tipo Equipo
      { wch: 10 }, // Cantidad
      { wch: 25 }, // Solicitado Por
      { wch: 15 }, // Estado
      { wch: 12 }, // Prioridad
      { wch: 15 }, // Equipo Asignado
      { wch: 18 }, // Estado Equipo
      { wch: 25 }, // Ubicación Equipo
      { wch: 15 }, // Fecha Asignación
      { wch: 15 }, // Fecha Completado
      { wch: 20 }, // Aviso Mantenimiento
      { wch: 20 }, // Estado Mantenimiento
      { wch: 40 }, // Observaciones
      { wch: 15 }  // Creado
    ]
    ws['!cols'] = columnWidths

    // Agregar la hoja al libro
    XLSX.utils.book_append_sheet(wb, ws, 'Pedidos de Equipos')

    // Generar nombre de archivo con fecha
    const fecha = new Date().toISOString().split('T')[0]
    const nombreArchivo = `Pedidos_Equipos_${fecha}.xlsx`

    // Descargar archivo
    XLSX.writeFile(wb, nombreArchivo)

    return { success: true, nombreArchivo }
  } catch (error) {
    console.error('Error al exportar a Excel:', error)
    return { success: false, error: error.message }
  }
}

// Función alternativa para exportar solo pedidos filtrados
export function exportarPedidosFiltradosAExcel(pedidos, filtros) {
  const datosConFiltros = pedidos.map(pedido => {
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
      'Estado': pedido.estado || '',
      'Prioridad': pedido.prioridad || '',
      'Equipo Asignado': equipo.numero_identificacion || 'Sin asignar',
      'Estado Equipo': equipo.estado_operativo || '',
      'Ubicación Equipo': equipo.ubicacion_actual || '',
      'Fecha Asignación': pedido.fecha_asignacion ? new Date(pedido.fecha_asignacion).toLocaleDateString('es-PY') : '',
      'Fecha Completado': pedido.fecha_completado ? new Date(pedido.fecha_completado).toLocaleDateString('es-PY') : '',
      'Aviso Mantenimiento': mantenimiento.numero_aviso || '',
      'Estado Mantenimiento': mantenimiento.estado || '',
      'Observaciones': pedido.observaciones || '',
      'Creado': pedido.created_at ? new Date(pedido.created_at).toLocaleDateString('es-PY') : ''
    }
  })

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(datosConFiltros)

  // Anchos de columna
  ws['!cols'] = [
    { wch: 15 }, { wch: 30 }, { wch: 12 }, { wch: 25 }, { wch: 10 },
    { wch: 25 }, { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 18 },
    { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 20 },
    { wch: 40 }, { wch: 15 }
  ]

  XLSX.utils.book_append_sheet(wb, ws, 'Pedidos Filtrados')

  // Agregar hoja con información de filtros
  const infoFiltros = [
    { Campo: 'Obra', Valor: filtros.obra || 'Todas' },
    { Campo: 'Estado', Valor: filtros.estado || 'Todos' },
    { Campo: 'Fecha Desde', Valor: filtros.fechaDesde || '-' },
    { Campo: 'Fecha Hasta', Valor: filtros.fechaHasta || '-' },
    { Campo: 'Equipo', Valor: filtros.equipo || '-' },
    { Campo: 'Total Registros', Valor: pedidos.length }
  ]
  
  const wsFiltros = XLSX.utils.json_to_sheet(infoFiltros)
  wsFiltros['!cols'] = [{ wch: 20 }, { wch: 30 }]
  XLSX.utils.book_append_sheet(wb, wsFiltros, 'Filtros Aplicados')

  const fecha = new Date().toISOString().split('T')[0]
  const nombreArchivo = `Pedidos_Equipos_Filtrados_${fecha}.xlsx`

  XLSX.writeFile(wb, nombreArchivo)

  return { success: true, nombreArchivo }
}