import { useState } from 'react'
import { supabase } from './lib/supabase'

function EstadoOperativoModal({ equipo, onCerrar, onActualizar }) {
  const [estadoSeleccionado, setEstadoSeleccionado] = useState(equipo.estado_operativo || 'operativo')
  const [observaciones, setObservaciones] = useState(equipo.observaciones_operativo || '')
  const [guardando, setGuardando] = useState(false)

  const estados = [
    {
      valor: 'operativo',
      label: 'Operativo',
      emoji: '✅',
      descripcion: 'Equipo completamente operativo sin restricciones',
      color: { bg: '#d1fae5', text: '#065f46' }
    },
    {
      valor: 'con_restriccion',
      label: 'Operativo con restricciones',
      emoji: '⚠️',
      descripcion: 'Operativo pero con limitaciones (ej: solo obra, no viajes)',
      color: { bg: '#fef3c7', text: '#92400e' }
    },
    {
      valor: 'fuera_servicio',
      label: 'Fuera de servicio',
      emoji: '❌',
      descripcion: 'No operativo, requiere reparación o mantenimiento mayor',
      color: { bg: '#fee2e2', text: '#991b1b' }
    }
  ]

  async function guardar() {
    try {
      setGuardando(true)

      const { error } = await supabase
        .from('equipos')
        .update({
          estado_operativo: estadoSeleccionado,
          observaciones_operativo: observaciones.trim() || null
        })
        .eq('id', equipo.id)

      if (error) throw error

      alert('✅ Estado operativo actualizado')
      onActualizar()
      onCerrar()

    } catch (error) {
      console.error('Error:', error)
      alert('❌ Error al actualizar estado: ' + error.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem',
      zIndex: 1000
    }}>
      <div style={{
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
        maxWidth: '600px',
        width: '100%',
        maxHeight: '90vh',
        overflow: 'auto'
      }}>
        <div style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem' }}>
            🔧 Estado Operativo
          </h2>
          <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
            <strong>Equipo:</strong> {equipo.nombre}
          </p>

          {/* Selección de estado */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '1rem', fontWeight: '600' }}>
              Seleccionar estado:
            </label>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {estados.map(estado => (
                <button
                  key={estado.valor}
                  onClick={() => setEstadoSeleccionado(estado.valor)}
                  style={{
                    padding: '1rem',
                    background: estadoSeleccionado === estado.valor ? estado.color.text : estado.color.bg,
                    color: estadoSeleccionado === estado.valor ? 'white' : estado.color.text,
                    border: estadoSeleccionado === estado.valor ? `3px solid ${estado.color.text}` : 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '1rem',
                    textAlign: 'left',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontSize: '1.5rem' }}>{estado.emoji}</span>
                    <span>{estado.label}</span>
                  </div>
                  <span style={{ 
                    fontSize: '0.875rem', 
                    opacity: 0.8,
                    fontWeight: 'normal'
                  }}>
                    {estado.descripcion}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Observaciones */}
          {estadoSeleccionado !== 'operativo' && (
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                Observaciones / Restricciones:
                {estadoSeleccionado === 'con_restriccion' && (
                  <span style={{ color: '#ef4444', marginLeft: '0.25rem' }}>*</span>
                )}
              </label>
              <textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder={
                  estadoSeleccionado === 'con_restriccion'
                    ? 'Ej: Solo para uso en obra, no para viajes largos'
                    : 'Ej: Falla en el motor, requiere mantenimiento mayor'
                }
                rows="4"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '2px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '1rem',
                  fontFamily: 'inherit',
                  resize: 'vertical'
                }}
              />
              {estadoSeleccionado === 'con_restriccion' && !observaciones.trim() && (
                <p style={{ color: '#ef4444', fontSize: '0.875rem', marginTop: '0.5rem' }}>
                  ⚠️ Debes especificar las restricciones operativas
                </p>
              )}
            </div>
          )}

          {/* Botones */}
          <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
            <button
              onClick={guardar}
              disabled={guardando || (estadoSeleccionado === 'con_restriccion' && !observaciones.trim())}
              style={{
                flex: 1,
                padding: '0.75rem',
                background: guardando ? '#9ca3af' : '#667eea',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: guardando ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                fontSize: '1rem'
              }}
            >
              {guardando ? '⏳ Guardando...' : '💾 Guardar'}
            </button>
            
            <button
              onClick={onCerrar}
              disabled={guardando}
              style={{
                flex: 1,
                padding: '0.75rem',
                background: '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: guardando ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                fontSize: '1rem'
              }}
            >
              ❌ Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default EstadoOperativoModal