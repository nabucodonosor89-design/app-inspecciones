import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export async function generarPDFInspeccion(inspeccion, equipo, checklistItems, fotos = [], inspeccionEnvio = null, checklistEnvio = []) {
  const doc = new jsPDF()
  
  // Configuración de colores según semáforo
  const semaforoColors = {
    'verde': [16, 185, 129],
    'amarillo': [245, 158, 11],
    'rojo': [239, 68, 68]
  }
  const colorSemaforo = semaforoColors[inspeccion.semaforo] || [156, 163, 175]

  // ============================================
  // ENCABEZADO
  // ============================================
  
  // Logo o título de la empresa (puedes agregar un logo aquí)
  doc.setFontSize(20)
  doc.setFont('helvetica', 'bold')
  doc.text('Sistema de Inspecciones TyE', 105, 20, { align: 'center' })
  
  doc.setFontSize(16)
  doc.setTextColor(...colorSemaforo)
  doc.text('REPORTE DE INSPECCIÓN', 105, 30, { align: 'center' })
  
  // Línea divisoria
  doc.setDrawColor(...colorSemaforo)
  doc.setLineWidth(1)
  doc.line(20, 35, 190, 35)
  
  // ============================================
  // INFORMACIÓN DEL EQUIPO
  // ============================================
  
  let yPos = 45
  doc.setTextColor(0, 0, 0)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('INFORMACIÓN DEL EQUIPO', 20, yPos)
  
  yPos += 8
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  
  const infoEquipo = [
    ['Código:', equipo.numero_identificacion],
    ['Denominación:', (equipo.denominacion || 'N/A').replace(/\s+/g, ' ').trim()],
    ['Tipo:', equipo.tipo_equipo],
    ['Fabricante:', (equipo.fabricante || 'N/A').replace(/\s+/g, ' ').trim()],
    ['Modelo:', (equipo.modelo || 'N/A').replace(/\s+/g, ' ').trim()],
    ['Matrícula:', (equipo.matricula || 'N/A').replace(/\s+/g, ' ').trim()]
  ]
  
  infoEquipo.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold')
    doc.text(label, 20, yPos)
    doc.setFont('helvetica', 'normal')
    doc.text(String(value), 60, yPos)
    yPos += 6
  })
  
  // ============================================
  // INFORMACIÓN DE LA INSPECCIÓN (solo si NO es comparativo)
  // ============================================
  
  // Determinar si es comparativo antes de mostrar info
  const esComparativo = inspeccionEnvio && checklistEnvio.length > 0
  
  if (!esComparativo) {
    yPos += 5
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text('INFORMACIÓN DE LA INSPECCIÓN', 20, yPos)
    
    yPos += 8
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    
    const getTipoLabel = (tipo) => {
      const tipos = {
        'periodica': 'Inspección Periódica',
        'envio': 'Envío a Obra',
        'recepcion': 'Recepción de Obra',
        'taller': 'Entrada a Taller',
        'almacenamiento': 'Almacenamiento'
      }
      return tipos[tipo] || tipo
    }
    
    const infoInspeccion = [
      ['Tipo:', getTipoLabel(inspeccion.tipo_inspeccion)],
      ['Fecha y Hora:', new Date(inspeccion.fecha_hora).toLocaleString('es-PY')],
      ['Inspector:', (inspeccion.inspector?.nombre_completo || 'N/A').replace(/\s+/g, ' ').trim()],
      ['Ubicación:', (inspeccion.ubicacion || 'N/A').replace(/\s+/g, ' ').trim()],
      ['Horómetro/Odómetro:', String(inspeccion.horometro_odometro)],
      ['Estado General:', inspeccion.semaforo.toUpperCase()]
    ]
    
    infoInspeccion.forEach(([label, value]) => {
      doc.setFont('helvetica', 'bold')
      doc.text(label, 20, yPos)
      doc.setFont('helvetica', 'normal')
      doc.text(String(value), 70, yPos)
      yPos += 6
    })
    
    // Badge del semáforo
    yPos -= 6
    doc.setFillColor(...colorSemaforo)
    doc.roundedRect(150, yPos - 4, 35, 8, 2, 2, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.text(inspeccion.semaforo.toUpperCase(), 167.5, yPos + 1, { align: 'center' })
    doc.setTextColor(0, 0, 0)
  }
  
  // Función para comparar estados (definida fuera del if para que esté disponible)
  const getTipoLabel = (tipo) => {
    const tipos = {
      'periodica': 'Inspección Periódica',
      'envio': 'Envío a Obra',
      'recepcion': 'Recepción de Obra',
      'taller': 'Entrada a Taller',
      'almacenamiento': 'Almacenamiento'
    }
    return tipos[tipo] || tipo
  }

  // Función para comparar estados y devolver ícono
  const compararEstados = (estadoEnvio, estadoRecepcion) => {
    const valores = { 'ok': 3, 'warning': 2, 'fail': 1 }
    const valorEnvio = valores[estadoEnvio] || 0
    const valorRecepcion = valores[estadoRecepcion] || 0
    
    if (valorRecepcion > valorEnvio) return 'Mejoró' // Mejoró
    if (valorRecepcion < valorEnvio) return 'Empeoró' // Empeoró
    return '=' // Sin cambio
  }
  
  // ============================================
  // CHECKLIST
  // ============================================
  
  yPos += 15
  
  // Si el checklist es muy largo, agregar nueva página
  if (yPos > 200) {
    doc.addPage()
    yPos = 20
  }
  
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('CHECKLIST DE INSPECCIÓN', 20, yPos)
  
  yPos += 5
  
  // ============================================
  // CHECKLIST (Normal o Comparativo)
  // ============================================
  
  if (esComparativo) {
    // ============================================
    // CHECKLIST COMPARATIVO (Envío vs Recepción)
    // ============================================
    
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text('COMPARACIÓN DE INSPECCIONES', 20, yPos)
    
    yPos += 10
    
    // ============================================
    // TABLA COMPARATIVA DE DATOS GENERALES
    // ============================================
    
    // Calcular diferencias
    const fechaEnvio = new Date(inspeccionEnvio.fecha_hora)
    const fechaRecepcion = new Date(inspeccion.fecha_hora)
    const diasEnObra = Math.floor((fechaRecepcion - fechaEnvio) / (1000 * 60 * 60 * 24))
    
    const horometroEnvio = parseInt(inspeccionEnvio.horometro_odometro) || 0
    const horometroRecepcion = parseInt(inspeccion.horometro_odometro) || 0
    const diferenciaHorometro = horometroRecepcion - horometroEnvio
    
    let horometroTexto = ''
    if (diferenciaHorometro > 0) {
      horometroTexto = `+${diferenciaHorometro} hrs`
    } else if (diferenciaHorometro < 0) {
      horometroTexto = '⚠ Contador cambiado'
    } else {
      horometroTexto = 'Sin cambio'
    }
    
    // Tabla de comparación de datos
    const datosComparativos = [
      ['Fecha/Hora', 
       new Date(inspeccionEnvio.fecha_hora).toLocaleString('es-PY'),
       new Date(inspeccion.fecha_hora).toLocaleString('es-PY'),
       `${diasEnObra} dias en obra`],
      ['Inspector',
       (inspeccionEnvio.inspector?.nombre_completo || 'N/A').replace(/\s+/g, ' ').trim(),
       (inspeccion.inspector?.nombre_completo || 'N/A').replace(/\s+/g, ' ').trim(),
       inspeccionEnvio.inspector?.nombre_completo === inspeccion.inspector?.nombre_completo ? 'Mismo' : 'Diferente'],
      ['Ubicación',
       (inspeccionEnvio.ubicacion || 'N/A').replace(/\s+/g, ' ').trim(),
       (inspeccion.ubicacion || 'N/A').replace(/\s+/g, ' ').trim(),
       '-'],
      ['Horómetro',
       String(horometroEnvio),
       String(horometroRecepcion),
       horometroTexto],
      ['Semáforo',
       inspeccionEnvio.semaforo.toUpperCase(),
       inspeccion.semaforo.toUpperCase(),
       inspeccionEnvio.semaforo === inspeccion.semaforo ? 'Igual' : 'Cambió']
    ]
    
    autoTable(doc, {
      startY: yPos,
      head: [['Dato', 'Envío', 'Recepción', 'Diferencia/Observación']],
      body: datosComparativos,
      theme: 'grid',
      headStyles: {
        fillColor: [102, 126, 234],
        textColor: 255,
        fontSize: 9,
        fontStyle: 'bold',
        halign: 'center'
      },
      bodyStyles: {
        fontSize: 9
      },
      columnStyles: {
        0: { cellWidth: 35, fontStyle: 'bold' },
        1: { cellWidth: 50, halign: 'center' },
        2: { cellWidth: 50, halign: 'center' },
        3: { cellWidth: 35, halign: 'center', fontStyle: 'bold' }
      },
      didParseCell: function(data) {
        // Resaltar la columna de diferencia
        if (data.column.index === 3 && data.section === 'body') {
          const valor = data.cell.raw
          
          // Días en obra
          if (valor.includes('días')) {
            data.cell.styles.fillColor = [219, 234, 254] // Azul claro
            data.cell.styles.textColor = [30, 64, 175]
          }
          // Contador cambiado
          else if (valor.includes('cambiado')) {
            data.cell.styles.fillColor = [254, 226, 226] // Rojo claro
            data.cell.styles.textColor = [153, 27, 27]
          }
          // Horas trabajadas positivas
          else if (valor.includes('+')) {
            data.cell.styles.fillColor = [209, 250, 229] // Verde claro
            data.cell.styles.textColor = [6, 95, 70]
          }
        }
        
        // Colorear semáforos
        if (data.column.index === 1 || data.column.index === 2) {
          if (data.section === 'body' && data.row.index === 4) { // Fila de semáforo
            const valor = data.cell.raw.toLowerCase()
            if (valor === 'verde') {
              data.cell.styles.fillColor = [209, 250, 229]
              data.cell.styles.textColor = [6, 95, 70]
            } else if (valor === 'amarillo') {
              data.cell.styles.fillColor = [254, 243, 199]
              data.cell.styles.textColor = [146, 64, 14]
            } else if (valor === 'rojo') {
              data.cell.styles.fillColor = [254, 226, 226]
              data.cell.styles.textColor = [153, 27, 27]
            }
          }
        }
      }
    })
    
    yPos = doc.lastAutoTable.finalY + 10
    
    // ============================================
    // CHECKLIST COMPARATIVO
    // ============================================
    
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text('COMPARACIÓN DE CHECKLIST', 20, yPos)
    
    yPos += 8
    
    // Agrupar items por categoría
    const categorias = [...new Set(checklistItems.map(i => i.categoria))]
    
    categorias.forEach((categoria) => {
      const itemsRecepcion = checklistItems.filter(i => i.categoria === categoria)
      
      // Nueva página si es necesario
      if (yPos > 240) {
        doc.addPage()
        yPos = 20
      }
      
      // Título de categoría
      yPos += 5
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(102, 126, 234)
      doc.text(categoria, 20, yPos)
      doc.setTextColor(0, 0, 0)
      
      yPos += 5
      
      // Crear tabla comparativa
      const tableData = itemsRecepcion.map(itemRec => {
        // Buscar el item correspondiente en el envío
        const itemEnv = checklistEnvio.find(e => e.item_nombre === itemRec.item_nombre)
        
        const estadoEnvio = itemEnv ? (itemEnv.estado === 'ok' ? 'OK' : itemEnv.estado === 'warning' ? 'Aviso' : 'Falla') : '-'
        const estadoRecepcion = itemRec.estado === 'ok' ? 'OK' : itemRec.estado === 'warning' ? 'Aviso' : 'Falla'
        
        // Agregar observación si existe
        const observacionEnvio = itemEnv?.observacion || '-'
        const observacionRecepcion = itemRec.observacion || '-'
        
        return [
          itemRec.item_nombre,
          estadoEnvio,
          observacionEnvio,
          estadoRecepcion,
          observacionRecepcion
        ]
      })
      
      autoTable(doc, {
        startY: yPos,
        head: [['Ítem', 'Estado Envío', 'Obs. Envío', 'Estado Recepción', 'Obs. Recepción']],
        body: tableData,
        theme: 'striped',
        headStyles: {
          fillColor: [102, 126, 234],
          textColor: 255,
          fontSize: 8,
          fontStyle: 'bold'
        },
        bodyStyles: {
          fontSize: 7
        },
        columnStyles: {
          0: { cellWidth: 50 },
          1: { cellWidth: 25, halign: 'center' },
          2: { cellWidth: 35, fontSize: 7 },
          3: { cellWidth: 25, halign: 'center' },
          4: { cellWidth: 35, fontSize: 7 }
        },
        didParseCell: function(data) {
          // Colorear según estado en columnas de Envío y Recepción
          if ((data.column.index === 1 || data.column.index === 3) && data.section === 'body') {
            const estado = data.cell.raw
            if (estado === 'OK') {
              data.cell.styles.textColor = [6, 95, 70]
              data.cell.styles.fillColor = [209, 250, 229]
            } else if (estado === 'Aviso') {
              data.cell.styles.textColor = [146, 64, 14]
              data.cell.styles.fillColor = [254, 243, 199]
            } else if (estado === 'Falla') {
              data.cell.styles.textColor = [153, 27, 27]
              data.cell.styles.fillColor = [254, 226, 226]
            }
          }
        }
      })
      
      yPos = doc.lastAutoTable.finalY + 5
    })
    
  } else {
    // ============================================
    // CHECKLIST NORMAL (sin comparación)
    // ============================================
    
    // Agrupar items por categoría
    const categorias = [...new Set(checklistItems.map(i => i.categoria))]
    
    categorias.forEach((categoria, index) => {
      const items = checklistItems.filter(i => i.categoria === categoria)
      
      // Nueva página si es necesario
      if (yPos > 250) {
        doc.addPage()
        yPos = 20
      }
      
      // Título de categoría
      yPos += 5
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(102, 126, 234)
      doc.text(categoria, 20, yPos)
      doc.setTextColor(0, 0, 0)
      
      yPos += 5
      
      // Tabla de items
      const tableData = items.map(item => {
        const estado = item.estado === 'ok' ? '✓ OK' : 
                       item.estado === 'warning' ? '⚠ Aviso' : '✗ Falla'
        const critico = item.es_critico ? 'SÍ' : 'No'
        
        return [
          item.item_nombre,
          estado,
          critico,
          item.observacion || '-'
        ]
      })
      
      autoTable(doc, {
        startY: yPos,
      head: [['Ítem', 'Estado', 'Crítico', 'Observación']],
      body: tableData,
      theme: 'striped',
      headStyles: {
        fillColor: [102, 126, 234],
        textColor: 255,
        fontSize: 9,
        fontStyle: 'bold'
      },
      bodyStyles: {
        fontSize: 8
      },
      columnStyles: {
        0: { cellWidth: 60 },
        1: { cellWidth: 25, halign: 'center' },
        2: { cellWidth: 20, halign: 'center' },
        3: { cellWidth: 65 }
      },
      didParseCell: function(data) {
        // Colorear según estado
        if (data.column.index === 1 && data.section === 'body') {
          const estado = data.cell.raw
          if (estado.includes('OK')) {
            data.cell.styles.textColor = [6, 95, 70]
            data.cell.styles.fillColor = [209, 250, 229]
          } else if (estado.includes('Aviso')) {
            data.cell.styles.textColor = [146, 64, 14]
            data.cell.styles.fillColor = [254, 243, 199]
          } else if (estado.includes('Falla')) {
            data.cell.styles.textColor = [153, 27, 27]
            data.cell.styles.fillColor = [254, 226, 226]
          }
        }
        
        // Resaltar críticos
        if (data.column.index === 2 && data.section === 'body' && data.cell.raw === 'SÍ') {
          data.cell.styles.textColor = [153, 27, 27]
          data.cell.styles.fontStyle = 'bold'
        }
      }
    })
    
    yPos = doc.lastAutoTable.finalY + 5
  })
  
  } // Fin del if/else esComparativo
  
  // ============================================
  // OBSERVACIONES GENERALES
  // ============================================
  
  if (inspeccion.observaciones_generales) {
    // Nueva página si es necesario
    if (yPos > 250) {
      doc.addPage()
      yPos = 20
    }
    
    yPos += 10
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text('OBSERVACIONES GENERALES', 20, yPos)
    
    yPos += 8
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    
    // Dividir texto largo en líneas (limpiando espacios extras)
    const observacionesLimpias = inspeccion.observaciones_generales.replace(/\s+/g, ' ').trim()
    const splitText = doc.splitTextToSize(observacionesLimpias, 170)
    doc.text(splitText, 20, yPos)
    
    yPos += (splitText.length * 5)
  }
  
  // ============================================
  // FOTOS DE LA INSPECCIÓN
  // ============================================
  
  if (fotos && fotos.length > 0) {
    // Nueva página si es necesario
    if (yPos > 200) {
      doc.addPage()
      yPos = 20
    } else {
      yPos += 10
    }
    
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text('FOTOS DE LA INSPECCIÓN', 20, yPos)
    
    yPos += 10
    
    // Cargar y agregar cada foto
    for (let i = 0; i < fotos.length; i++) {
      const foto = fotos[i]
      
      try {
        // Nueva página si es necesario
        if (yPos > 200) {
          doc.addPage()
          yPos = 20
        }
        
        // Cargar imagen de Cloudinary
        const response = await fetch(foto.url)
        const blob = await response.blob()
        const base64 = await new Promise((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result)
          reader.readAsDataURL(blob)
        })
        
        // Determinar formato de imagen
        const formato = foto.url.includes('.png') ? 'PNG' : 'JPEG'
        
        // Agregar imagen (máximo 170mm de ancho)
        const maxWidth = 170
        const maxHeight = 120
        
        doc.addImage(base64, formato, 20, yPos, maxWidth, maxHeight)
        yPos += maxHeight + 5
        
        // Agregar descripción si existe
        if (foto.descripcion) {
          doc.setFontSize(9)
          doc.setFont('helvetica', 'italic')
          doc.setTextColor(100, 100, 100)
          const descripcionText = doc.splitTextToSize(foto.descripcion, maxWidth)
          doc.text(descripcionText, 20, yPos)
          yPos += (descripcionText.length * 4) + 10
          doc.setTextColor(0, 0, 0)
        } else {
          yPos += 5
        }
        
      } catch (error) {
        console.error(`Error cargando foto ${i + 1}:`, error)
        // Continuar con la siguiente foto
      }
    }
  }
  
  // ============================================
  // PIE DE PÁGINA
  // ============================================
  
  const pageCount = doc.internal.getNumberOfPages()
  
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    
    // Línea
    doc.setDrawColor(200, 200, 200)
    doc.setLineWidth(0.5)
    doc.line(20, 285, 190, 285)
    
    // Texto del pie
    doc.setFontSize(8)
    doc.setTextColor(150, 150, 150)
    doc.setFont('helvetica', 'normal')
    doc.text(
      `Reporte generado el ${new Date().toLocaleDateString('es-PY')} - Página ${i} de ${pageCount}`,
      105,
      290,
      { align: 'center' }
    )
    
    doc.text(
      'Sistema de Inspecciones TyE - ITCSA',
      105,
      295,
      { align: 'center' }
    )
  }
  
  // ============================================
  // GUARDAR PDF
  // ============================================
  
  const nombreArchivo = `Inspeccion_${equipo.numero_identificacion}_${new Date(inspeccion.fecha_hora).toLocaleDateString('es-PY').replace(/\//g, '-')}.pdf`
  
  doc.save(nombreArchivo)
}