import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'

function DetalleInspeccion({ inspeccion, onVolver }) {
  const [checklistItems, setChecklistItems] = useState([])
  const [fotos, setFotos] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    cargarDetalles()
  }, [inspeccion.id])

  async function cargarDetalles() {
    try {
      setLoading(true)

      // Cargar checklist items
      const { data: items, error: errorItems } = await supabase
        .from('checklist_items')
        .select('*')
        .eq('inspeccion_id', inspeccion.id)
        .order('categoria')

      if (errorItems) throw errorItems

      // Cargar fotos
      const { data: fotosData, error: errorFotos } = await supabase
        .from('inspeccion_fotos')
        .select('*')
        .eq('inspeccion_id', inspeccion.id)

      if (errorFotos) throw errorFotos

      setChecklistItems(items || [])
      setFotos(fotosData || [])

    } catch (error) {
      console.error('Error cargando detalles:', error)
      alert('Error al cargar detalles de la inspección')
    } finally {
      setLoading(false)
    }
  }

  function getSemaforoColor(semaforo) {
    switch(semaforo) {
      case 'verde': return '#10b981'
      case 'amarillo': return '#f59e0b'
      case 'rojo': return '#ef4444'
      default: return '#6b7280'
    }
  }

  function getEstadoEmoji(estado) {
    switch(estado) {
      case 'ok': return '✅'
      case 'atencion': return '⚠️'
      case 'falla': return '❌'
      default: return '❓'
    }
  }

  // Agrupar items por categoría
  const itemsPorCategoria = checklistItems.reduce((acc, item) => {
    if (!acc[item.categoria]) {
      acc[item.categoria] = []
    }
    acc[item.categoria].push(item)
    return acc
  }, {})

  const categorias = Object.keys(itemsPorCategoria)

  if (loading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <p style={{ fontSize: '1.2rem', color: '#6b7280' }}>Cargando detalles...</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: 'clamp(1rem, 2vw, 2rem)' }}>
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
            <h1 style={{ fontSize: '2rem', fontWeight: 'bold', margin: '0 0 0.5rem 0' }}>
              📋 Detalle de Inspección
            </h1>
            <p style={{ color: '#6b7280', margin: 0 }}>
              {inspeccion.equipos?.numero_identificacion} - {inspeccion.equipos?.denominacion}
            </p>
          </div>
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

      {/* Info general */}
      <div style={{
        background: 'white',
        padding: '1.5rem',
        borderRadius: '12px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        marginBottom: '2rem'
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>
          {/* Semáforo */}
          <div style={{ textAlign: 'center', padding: '1rem' }}>
            <div style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: getSemaforoColor(inspeccion.semaforo),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '3rem',
              margin: '0 auto 0.5rem'
            }}>
              {inspeccion.semaforo === 'verde' ? '🟢' : inspeccion.semaforo === 'amarillo' ? '🟡' : '🔴'}
            </div>
            <p style={{ fontWeight: '600', fontSize: '1.2rem', margin: 0, textTransform: 'uppercase' }}>
              {inspeccion.semaforo}
            </p>
          </div>

          {/* Información */}
          <div style={{ flex: 2 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <span style={{ fontWeight: '600', color: '#6b7280' }}>Tipo: </span>
                <span>{inspeccion.tipo_inspeccion?.replace('_', ' ') || 'N/A'}</span>
              </div>
              <div>
                <span style={{ fontWeight: '600', color: '#6b7280' }}>Fecha: </span>
                <span>{new Date(inspeccion.fecha_hora).toLocaleString('es-PY')}</span>
              </div>
              <div>
                <span style={{ fontWeight: '600', color: '#6b7280' }}>Inspector: </span>
                <span>{inspeccion.usuarios?.nombre_completo || 'N/A'}</span>
              </div>
              <div>
                <span style={{ fontWeight: '600', color: '#6b7280' }}>Ubicación: </span>
                <span>{inspeccion.ubicacion || 'N/A'}</span>
              </div>
              <div>
                <span style={{ fontWeight: '600', color: '#6b7280' }}>Horómetro: </span>
                <span>{inspeccion.horometro_odometro || 'N/A'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Observaciones generales */}
        {inspeccion.observaciones_generales && (
          <div style={{
            marginTop: '1.5rem',
            padding: '1rem',
            background: '#f9fafb',
            borderRadius: '8px',
            borderLeft: '4px solid #3b82f6'
          }}>
            <p style={{ fontWeight: '600', marginBottom: '0.5rem', color: '#1f2937' }}>
              💬 Observaciones Generales:
            </p>
            <p style={{ margin: 0, color: '#374151', whiteSpace: 'pre-wrap' }}>
              {inspeccion.observaciones_generales}
            </p>
          </div>
        )}
      </div>

      {/* Checklist */}
      {categorias.length > 0 && (
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          marginBottom: '2rem'
        }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1.5rem' }}>
            ✅ Checklist de Inspección
          </h2>

          {categorias.map(categoria => (
            <div key={categoria} style={{ marginBottom: '2rem' }}>
              <h3 style={{
                fontSize: '1.1rem',
                fontWeight: '600',
                color: '#1f2937',
                marginBottom: '1rem',
                paddingBottom: '0.5rem',
                borderBottom: '2px solid #e5e7eb'
              }}>
                {categoria}
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {itemsPorCategoria[categoria].map((item, index) => (
                  <div
                    key={index}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                      padding: '0.75rem',
                      background: item.estado === 'falla' ? '#fee2e2' : item.estado === 'atencion' ? '#fef3c7' : '#f0fdf4',
                      borderRadius: '8px',
                      border: `2px solid ${item.estado === 'falla' ? '#ef4444' : item.estado === 'atencion' ? '#f59e0b' : '#10b981'}`
                    }}
                  >
                    <div style={{ fontSize: '1.5rem', lineHeight: 1 }}>
                      {getEstadoEmoji(item.estado)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <span style={{ fontWeight: '600', color: '#1f2937' }}>
                          {item.item_nombre}
                        </span>
                        {item.es_critico && (
                          <span style={{
                            padding: '0.125rem 0.5rem',
                            background: '#ef4444',
                            color: 'white',
                            borderRadius: '8px',
                            fontSize: '0.75rem',
                            fontWeight: '600'
                          }}>
                            CRÍTICO
                          </span>
                        )}
                      </div>
                      {item.observacion && (
                        <p style={{ fontSize: '0.9rem', color: '#6b7280', margin: 0 }}>
                          💬 {item.observacion}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Fotos */}
      {fotos.length > 0 && (
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1.5rem' }}>
            📸 Fotos ({fotos.length})
          </h2>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
            gap: '1rem'
          }}>
            {fotos.map((foto, index) => (
              <div
                key={index}
                style={{
                  position: 'relative',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}
              >
                <img
                  src={foto.url}
                  alt={foto.descripcion || `Foto ${index + 1}`}
                  style={{
                    width: '100%',
                    height: '200px',
                    objectFit: 'cover',
                    cursor: 'pointer'
                  }}
                  onClick={() => window.open(foto.url, '_blank')}
                />
                {foto.descripcion && (
                  <div style={{
                    padding: '0.5rem',
                    background: 'rgba(0,0,0,0.7)',
                    color: 'white',
                    fontSize: '0.85rem'
                  }}>
                    {foto.descripcion}
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

export default DetalleInspeccion