import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import { generarPDFInspeccion } from './utils/pdfGenerator'

function HistorialInspecciones({ equipo, onVolver }) {
  const [inspecciones, setInspecciones] = useState([])
  const [inspeccionSeleccionada, setInspeccionSeleccionada] = useState(null)
  const [checklistItems, setChecklistItems] = useState([])
  const [fotos, setFotos] = useState([])
  const [loading, setLoading] = useState(true)
  // Estados para filtros
  const [filtroInspector, setFiltroInspector] = useState('Todos')
  const [filtroTipo, setFiltroTipo] = useState('Todos')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')

  useEffect(() => {
    getInspecciones()
  }, [])

  async function getInspecciones() {
    try {
      const { data, error } = await supabase
        .from('inspecciones')
        .select(`
          *,
          inspector:usuarios(nombre_completo)
        `)
        .eq('equipo_id', equipo.id)
        .order('fecha_hora', { ascending: false })

      if (error) throw error
      setInspecciones(data || [])
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setLoading(false)
    }
  }

  async function verDetalle(inspeccion) {
    console.log('📋 Ver detalle de inspección:', inspeccion.id)
    setInspeccionSeleccionada(inspeccion)
    
    // Cargar checklist
    const { data: checklistData } = await supabase
      .from('checklist_items')
      .select('*')
      .eq('inspeccion_id', inspeccion.id)
      .order('categoria')

    console.log('✅ Checklist items cargados:', checklistData?.length || 0)
    setChecklistItems(checklistData || [])

    // Cargar fotos
    console.log('📸 Intentando cargar fotos para inspección:', inspeccion.id)
    const { data: fotosData, error: fotosError } = await supabase
      .from('inspeccion_fotos')
      .select('*')
      .eq('inspeccion_id', inspeccion.id)
      .order('created_at')

    console.log('📸 Fotos encontradas:', fotosData)
    console.log('❌ Error al cargar fotos:', fotosError)
    console.log('📸 Número de fotos:', fotosData?.length || 0)

    setFotos(fotosData || [])
  }

  // Obtener inspectores únicos
  const inspectoresUnicos = ['Todos', ...new Set(
    inspecciones.map(i => i.inspector?.nombre_completo).filter(Boolean)
  )]

  // Filtrar inspecciones
  const inspeccionesFiltradas = inspecciones.filter(inspeccion => {
    // Filtro por inspector
    const matchInspector = filtroInspector === 'Todos' || 
      inspeccion.inspector?.nombre_completo === filtroInspector

    // Filtro por tipo
    const matchTipo = filtroTipo === 'Todos' || 
      inspeccion.tipo_inspeccion === filtroTipo

    // Filtro por fecha desde
    const matchFechaDesde = !fechaDesde || 
      new Date(inspeccion.fecha_hora) >= new Date(fechaDesde)

    // Filtro por fecha hasta
    const matchFechaHasta = !fechaHasta || 
      new Date(inspeccion.fecha_hora) <= new Date(fechaHasta + 'T23:59:59')

    return matchInspector && matchTipo && matchFechaDesde && matchFechaHasta
  })

  const getTipoLabel = (tipo) => {
    const tipos = {
      'periodica': '🔍 Inspección Periódica',
      'envio': '📤 Envío a Obra',
      'recepcion': '📥 Recepción de Obra',
      'taller': '🔧 Entrada a Taller',
      'almacenamiento': '📦 Almacenamiento'
    }
    return tipos[tipo] || tipo
  }

  const getSemaforoEmoji = (semaforo) => {
    if (semaforo === 'verde') return '🟢'
    if (semaforo === 'amarillo') return '🟡'
    if (semaforo === 'rojo') return '🔴'
    return '⚪'
  }

  const getSemaforoColor = (semaforo) => {
    if (semaforo === 'verde') return '#10b981'
    if (semaforo === 'amarillo') return '#f59e0b'
    if (semaforo === 'rojo') return '#ef4444'
    return '#9ca3af'
  }

  if (loading) {
    return (
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: 'clamp(0.5rem, 2vw, 2rem)', textAlign: 'center' }}>
        <p>Cargando historial...</p>
      </div>
    )
  }

  // Vista de detalle de inspección
  if (inspeccionSeleccionada) {
    const categorias = [...new Set(checklistItems.map(i => i.categoria))]
    
    return (
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: 'clamp(0.5rem, 2vw, 2rem)' }}>
        {/* Botones de acción */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => setInspeccionSeleccionada(null)}
            style={{
              padding: '0.5rem 1rem',
              background: '#6b7280',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '0.875rem'
            }}
          >
            ← Volver al Historial
          </button>
          
          <button
            onClick={async () => {
              console.log('Generando PDF...', { inspeccionSeleccionada, equipo, checklistItems, fotos })
              
              // Si es recepción con envío relacionado, cargar datos del envío
              let inspeccionEnvio = null
              let checklistEnvio = []
              
              if (inspeccionSeleccionada.tipo_inspeccion === 'recepcion' && inspeccionSeleccionada.inspeccion_envio_relacionada) {
                console.log('📦 Cargando inspección de envío relacionada...')
                
                // Cargar inspección de envío con inspector
                const { data: envioData } = await supabase
                  .from('inspecciones')
                  .select(`
                    *,
                    inspector:usuarios(nombre_completo)
                  `)
                  .eq('id', inspeccionSeleccionada.inspeccion_envio_relacionada)
                  .single()
                
                inspeccionEnvio = envioData
                
                // Cargar checklist de envío
                const { data: checklistEnvioData } = await supabase
                  .from('checklist_items')
                  .select('*')
                  .eq('inspeccion_id', inspeccionSeleccionada.inspeccion_envio_relacionada)
                  .order('categoria')
                
                checklistEnvio = checklistEnvioData || []
                
                console.log('✅ Inspección de envío cargada:', inspeccionEnvio)
                console.log('✅ Checklist de envío cargado:', checklistEnvio.length, 'items')
              }
              
              await generarPDFInspeccion(inspeccionSeleccionada, equipo, checklistItems, fotos, inspeccionEnvio, checklistEnvio)
            }}
            style={{
              padding: '0.5rem 1rem',
              background: '#ef4444',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            📄 Exportar PDF
          </button>
        </div>

        <div style={{
          background: getSemaforoColor(inspeccionSeleccionada.semaforo),
          color: 'white',
          padding: 'clamp(0.5rem, 2vw, 2rem)',
          borderRadius: '12px',
          marginBottom: '2rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <span style={{ fontSize: '3rem' }}>
              {getSemaforoEmoji(inspeccionSeleccionada.semaforo)}
            </span>
            <div>
              <h2 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                {getTipoLabel(inspeccionSeleccionada.tipo_inspeccion)}
              </h2>
              <p style={{ fontSize: '1.1rem' }}>
                {new Date(inspeccionSeleccionada.fecha_hora).toLocaleString('es-PY')}
              </p>
            </div>
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.3)', paddingTop: '1rem', marginTop: '1rem' }}>
            <p><strong>Inspector:</strong> {inspeccionSeleccionada.inspector?.nombre_completo}</p>
            <p><strong>Horómetro:</strong> {inspeccionSeleccionada.horometro_odometro}</p>
            <p><strong>Ubicación:</strong> {inspeccionSeleccionada.ubicacion}</p>
          </div>
        </div>

        {/* Checklist */}
        <div style={{
          background: 'white',
          padding: 'clamp(0.5rem, 2vw, 2rem)',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          marginBottom: '2rem'
        }}>
          <h3 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1.5rem' }}>
            Checklist de Inspección
          </h3>

          {categorias.map(categoria => {
            const items = checklistItems.filter(i => i.categoria === categoria)
            return (
              <div key={categoria} style={{ marginBottom: '2rem' }}>
                <h4 style={{
                  fontSize: '1.1rem',
                  fontWeight: '600',
                  color: '#667eea',
                  marginBottom: '1rem',
                  paddingBottom: '0.5rem',
                  borderBottom: '2px solid #e5e7eb'
                }}>
                  {categoria}
                </h4>

                {items.map(item => (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '1rem',
                      background: '#f9fafb',
                      borderRadius: '8px',
                      marginBottom: '0.75rem'
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: '500' }}>{item.item_nombre}</span>
                      {item.es_critico && (
                        <span style={{
                          marginLeft: '0.5rem',
                          background: '#fecaca',
                          color: '#991b1b',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: '600'
                        }}>
                          CRÍTICO
                        </span>
                      )}
                      {item.observacion && (
                        <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.25rem' }}>
                          {item.observacion}
                        </p>
                      )}
                    </div>

                    <span style={{
                      padding: '0.5rem 1rem',
                      borderRadius: '6px',
                      fontWeight: '600',
                      fontSize: '0.875rem',
                      background: item.estado === 'ok' ? '#d1fae5' : 
                                 item.estado === 'warning' ? '#fef3c7' : '#fee2e2',
                      color: item.estado === 'ok' ? '#065f46' : 
                             item.estado === 'warning' ? '#92400e' : '#991b1b'
                    }}>
                      {item.estado === 'ok' ? '✓ OK' : 
                       item.estado === 'warning' ? '⚠ Aviso' : '✗ Falla'}
                    </span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        {/* Observaciones */}
        {inspeccionSeleccionada.observaciones_generales && (
          <div style={{
            background: 'white',
            padding: 'clamp(0.5rem, 2vw, 2rem)',
            borderRadius: '12px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            marginBottom: '2rem'
          }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '600', marginBottom: '1rem' }}>
              Observaciones Generales
            </h3>
            <p style={{ color: '#4b5563', lineHeight: '1.6' }}>
              {inspeccionSeleccionada.observaciones_generales}
            </p>
          </div>
        )}

        {/* Galería de Fotos */}
        {fotos.length > 0 && (
          <div style={{
            background: 'white',
            padding: 'clamp(0.5rem, 2vw, 2rem)',
            borderRadius: '12px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '600', marginBottom: '1rem' }}>
              📸 Fotos de la Inspección ({fotos.length})
            </h3>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
              gap: '1rem'
            }}>
              {fotos.map((foto) => (
                <div
                  key={foto.id}
                  style={{
                    background: '#f9fafb',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    border: '1px solid #e5e7eb',
                    cursor: 'pointer'
                  }}
                  onClick={() => window.open(foto.url, '_blank')}
                  title="Click para ver en tamaño completo"
                >
                  <img
                    src={foto.url}
                    alt={foto.descripcion || 'Foto de inspección'}
                    style={{
                      width: '100%',
                      height: '200px',
                      objectFit: 'cover'
                    }}
                  />
                  {foto.descripcion && (
                    <div style={{ padding: '0.75rem' }}>
                      <p style={{ fontSize: '0.875rem', color: '#4b5563', margin: 0 }}>
                        {foto.descripcion}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Lista de inspecciones
  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: 'clamp(0.5rem, 2vw, 2rem)' }}>
      <button
        onClick={onVolver}
        style={{
          padding: '0.5rem 1rem',
          background: '#6b7280',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          marginBottom: '1rem'
        }}
      >
        ← Volver
      </button>

      <div style={{
        background: 'white',
        padding: 'clamp(0.5rem, 2vw, 2rem)',
        borderRadius: '12px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        marginBottom: '2rem'
      }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
          Historial de Inspecciones
        </h1>
        <p style={{ fontSize: '1.2rem', color: '#6b7280' }}>
          {equipo.numero_identificacion} - {equipo.denominacion}
        </p>
        <p style={{ fontSize: '0.9rem', color: '#9ca3af', marginTop: '0.5rem' }}>
          Total de inspecciones: {inspeccionesFiltradas.length}
          {inspeccionesFiltradas.length !== inspecciones.length && 
            ` (filtradas de ${inspecciones.length})`
          }
        </p>
      </div>

      {/* Filtros */}
      <div style={{
        background: 'white',
        padding: '1.5rem',
        borderRadius: '12px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        marginBottom: '2rem'
      }}>
        <h3 style={{ fontSize: '1.2rem', fontWeight: '600', marginBottom: '1rem' }}>
          🔍 Filtrar Inspecciones
        </h3>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
          {/* Filtro por Inspector */}
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem' }}>
              Inspector
            </label>
            <select
              value={filtroInspector}
              onChange={(e) => setFiltroInspector(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '0.875rem'
              }}
            >
              {inspectoresUnicos.map(inspector => (
                <option key={inspector} value={inspector}>{inspector}</option>
              ))}
            </select>
          </div>

          {/* Filtro por Tipo */}
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem' }}>
              Tipo de Inspección
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
              <option value="Todos">Todos</option>
              <option value="periodica">🔍 Inspección Periódica</option>
              <option value="envio">📤 Envío a Obra</option>
              <option value="recepcion">📥 Recepción de Obra</option>
              <option value="taller">🔧 Entrada a Taller</option>
              <option value="almacenamiento">📦 Almacenamiento</option>
            </select>
          </div>

          {/* Fecha Desde */}
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem' }}>
              Desde
            </label>
            <input
              type="date"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '0.875rem'
              }}
            />
          </div>

          {/* Fecha Hasta */}
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem' }}>
              Hasta
            </label>
            <input
              type="date"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
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

        {/* Contador y botón limpiar */}
        <div style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#6b7280', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <span>
            Mostrando {inspeccionesFiltradas.length} de {inspecciones.length} inspecciones
          </span>

          {/* Botón para limpiar filtros */}
          {(filtroInspector !== 'Todos' || filtroTipo !== 'Todos' || fechaDesde || fechaHasta) && (
            <button
              onClick={() => {
                setFiltroInspector('Todos')
                setFiltroTipo('Todos')
                setFechaDesde('')
                setFechaHasta('')
              }}
              style={{
                padding: '0.5rem 1rem',
                background: '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: '600'
              }}
            >
              🔄 Limpiar Filtros
            </button>
          )}
        </div>
      </div>

      {inspeccionesFiltradas.length === 0 ? (
        <div style={{
          background: 'white',
          padding: '3rem',
          borderRadius: '12px',
          textAlign: 'center',
          color: '#6b7280'
        }}>
          <p style={{ fontSize: '1.2rem' }}>
            {inspecciones.length === 0 
              ? 'Este equipo aún no tiene inspecciones registradas'
              : 'No se encontraron inspecciones con los filtros aplicados'
            }
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {inspeccionesFiltradas.map(inspeccion => (
            <div
              key={inspeccion.id}
              onClick={() => verDetalle(inspeccion)}
              style={{
                background: 'white',
                padding: '1.5rem',
                borderRadius: '12px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                cursor: 'pointer',
                border: '2px solid transparent',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = '#667eea'}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '1.5rem' }}>
                      {getSemaforoEmoji(inspeccion.semaforo)}
                    </span>
                    <h3 style={{ fontSize: '1.2rem', fontWeight: '600', margin: 0 }}>
                      {getTipoLabel(inspeccion.tipo_inspeccion)}
                    </h3>
                  </div>

                  <p style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                    📅 {new Date(inspeccion.fecha_hora).toLocaleDateString('es-PY', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>

                  <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>
                    👤 {inspeccion.inspector?.nombre_completo} | 
                    📍 {inspeccion.ubicacion} | 
                    🔢 {inspeccion.horometro_odometro}
                  </p>
                </div>

                <div style={{
                  padding: '0.75rem 1.5rem',
                  background: getSemaforoColor(inspeccion.semaforo) + '20',
                  color: getSemaforoColor(inspeccion.semaforo),
                  borderRadius: '8px',
                  fontWeight: '600',
                  fontSize: '0.875rem'
                }}>
                  {inspeccion.semaforo?.toUpperCase()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default HistorialInspecciones