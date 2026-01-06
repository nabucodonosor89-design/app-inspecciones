import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'

function FormularioEquipo({ equipo, onGuardado, onCancelar, usuario }) {
  const [loading, setLoading] = useState(false)
  const esEdicion = !!equipo

  // Campos del formulario
  const [numeroIdentificacion, setNumeroIdentificacion] = useState(equipo?.numero_identificacion || '')
  const [tipoEquipo, setTipoEquipo] = useState(equipo?.tipo_equipo || '')
  const [claseVehiculo, setClaseVehiculo] = useState(equipo?.clase_vehiculo || '')
  const [denominacion, setDenominacion] = useState(equipo?.denominacion || '')
  const [fabricante, setFabricante] = useState(equipo?.fabricante || '')
  const [modelo, setModelo] = useState(equipo?.modelo || '')
  const [matricula, setMatricula] = useState(equipo?.matricula || '')
  const [anioConstruccion, setAnioConstruccion] = useState(equipo?.anio_construccion || '')
  const [centroCosto, setCentroCosto] = useState(equipo?.centro_costo || '')
  const [ubicacionActual, setUbicacionActual] = useState(equipo?.ubicacion_actual || '')
  const [estadoOperativo, setEstadoOperativo] = useState(equipo?.estado_operativo || 'operativo')
  const [observacionesOperativo, setObservacionesOperativo] = useState(equipo?.observaciones_operativo || '')
  const [esLogistica, setEsLogistica] = useState(equipo?.es_logistica || false)
  const [activo, setActivo] = useState(equipo?.activo ?? true)

  async function handleSubmit(e) {
    e.preventDefault()

    // Validaciones
    if (!numeroIdentificacion.trim()) {
      alert('⚠️ El código del equipo es obligatorio')
      return
    }

    if (!tipoEquipo.trim()) {
      alert('⚠️ El tipo de equipo es obligatorio')
      return
    }

    try {
      setLoading(true)

      const datos = {
        numero_identificacion: numeroIdentificacion.trim().toUpperCase(),
        tipo_equipo: tipoEquipo.trim(),
        clase_vehiculo: claseVehiculo.trim() || null,
        denominacion: denominacion.trim() || null,
        fabricante: fabricante.trim() || null,
        modelo: modelo.trim() || null,
        matricula: matricula.trim() || null,
        anio_construccion: anioConstruccion || null,
        centro_costo: centroCosto.trim() || null,
        ubicacion_actual: ubicacionActual.trim() || null,
        estado_operativo: estadoOperativo,
        observaciones_operativo: observacionesOperativo.trim() || null,
        es_logistica: esLogistica,
        activo: activo
      }

      if (esEdicion) {
        // Actualizar
        const { error } = await supabase
          .from('equipos')
          .update(datos)
          .eq('id', equipo.id)

        if (error) throw error

        alert('✅ Equipo actualizado correctamente')
      } else {
        // Crear nuevo
        const { error } = await supabase
          .from('equipos')
          .insert([datos])

        if (error) throw error

        alert('✅ Equipo creado correctamente')
      }

      onGuardado()

    } catch (error) {
      console.error('Error:', error)
      
      // Error de código duplicado
      if (error.code === '23505') {
        alert('❌ Ya existe un equipo con ese código')
      } else {
        alert('❌ Error al guardar: ' + error.message)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <div style={{
        background: 'white',
        padding: '2rem',
        borderRadius: '12px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '2rem' }}>
          {esEdicion ? '✏️ Editar Equipo' : '➕ Nuevo Equipo'}
        </h2>

        <form onSubmit={handleSubmit}>
          {/* Información Básica */}
          <div style={{
            background: '#fef3c7',
            padding: '1.5rem',
            borderRadius: '8px',
            marginBottom: '2rem',
            border: '2px solid #f59e0b'
          }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '1rem', color: '#92400e' }}>
              📋 Información Básica
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem', color: '#1f2937' }}>
                  Código/Identificación <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  value={numeroIdentificacion}
                  onChange={(e) => setNumeroIdentificacion(e.target.value)}
                  placeholder="Ej: CAM-001"
                  disabled={esEdicion || loading}
                  required
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '1rem',
                    backgroundColor: esEdicion ? '#f3f4f6' : 'white'
                  }}
                />
                {esEdicion && (
                  <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                    No se puede modificar el código
                  </p>
                )}
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem', color: '#1f2937' }}>
                  Tipo de Equipo <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  value={tipoEquipo}
                  onChange={(e) => setTipoEquipo(e.target.value)}
                  placeholder="Ej: Camión, Volquete, Excavadora"
                  disabled={loading}
                  required
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '1rem'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem', color: '#1f2937' }}>
                  Clase de Vehículo
                </label>
                <input
                  type="text"
                  value={claseVehiculo}
                  onChange={(e) => setClaseVehiculo(e.target.value)}
                  placeholder="Ej: Pesado, Liviano"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '1rem'
                  }}
                />
              </div>
            </div>

            <div style={{ marginTop: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem', color: '#1f2937' }}>
                Denominación
              </label>
              <input
                type="text"
                value={denominacion}
                onChange={(e) => setDenominacion(e.target.value)}
                placeholder="Descripción detallada del equipo"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '2px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '1rem'
                }}
              />
            </div>
          </div>

          {/* Características Técnicas */}
          <div style={{
            background: '#f9fafb',
            padding: '1.5rem',
            borderRadius: '8px',
            marginBottom: '2rem'
          }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '1rem' }}>
              🔧 Características Técnicas
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem', color: '#1f2937' }}>
                  Fabricante
                </label>
                <input
                  type="text"
                  value={fabricante}
                  onChange={(e) => setFabricante(e.target.value)}
                  placeholder="Ej: Caterpillar, Volvo"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '1rem'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem', color: '#1f2937' }}>
                  Modelo
                </label>
                <input
                  type="text"
                  value={modelo}
                  onChange={(e) => setModelo(e.target.value)}
                  placeholder="Ej: 320D, FH16"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '1rem'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem', color: '#1f2937' }}>
                  Matrícula
                </label>
                <input
                  type="text"
                  value={matricula}
                  onChange={(e) => setMatricula(e.target.value)}
                  placeholder="Ej: ABC-123"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '1rem'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem', color: '#1f2937' }}>
                  Año de Construcción
                </label>
                <input
                  type="number"
                  value={anioConstruccion}
                  onChange={(e) => setAnioConstruccion(e.target.value)}
                  placeholder="Ej: 2020"
                  disabled={loading}
                  min="1900"
                  max={new Date().getFullYear() + 1}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '1rem'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem', color: '#1f2937' }}>
                  Centro de Costo
                </label>
                <input
                  type="text"
                  value={centroCosto}
                  onChange={(e) => setCentroCosto(e.target.value)}
                  placeholder="Código de centro de costo"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '1rem'
                  }}
                />
              </div>
            </div>
          </div>

          {/* Estado y Ubicación */}
          <div style={{
            background: '#f9fafb',
            padding: '1.5rem',
            borderRadius: '8px',
            marginBottom: '2rem'
          }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '1rem' }}>
              📍 Estado y Ubicación
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem', color: '#1f2937' }}>
                  Ubicación Actual
                </label>
                <input
                  type="text"
                  value={ubicacionActual}
                  onChange={(e) => setUbicacionActual(e.target.value)}
                  placeholder="Ej: RUTA 17, Taller Ypané"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '1rem'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem', color: '#1f2937' }}>
                  Estado Operativo
                </label>
                <select
                  value={estadoOperativo}
                  onChange={(e) => setEstadoOperativo(e.target.value)}
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '1rem'
                  }}
                >
                  <option value="operativo">✅ Operativo</option>
                  <option value="operativo_restricciones">⚠️ Operativo con Restricciones</option>
                  <option value="fuera_servicio">🔴 Fuera de Servicio</option>
                </select>
              </div>
            </div>

            <div style={{ marginTop: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem', color: '#1f2937' }}>
                Observaciones Operativas
              </label>
              <textarea
                value={observacionesOperativo}
                onChange={(e) => setObservacionesOperativo(e.target.value)}
                placeholder="Detalles sobre el estado del equipo, restricciones, etc."
                rows="3"
                disabled={loading}
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
            </div>
          </div>

          {/* Configuración */}
          <div style={{
            background: '#f9fafb',
            padding: '1.5rem',
            borderRadius: '8px',
            marginBottom: '2rem'
          }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '1rem' }}>
              ⚙️ Configuración
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={esLogistica}
                  onChange={(e) => setEsLogistica(e.target.checked)}
                  disabled={loading}
                  style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                />
                <div>
                  <div style={{ fontWeight: '600', fontSize: '1rem' }}>🚚 Equipo de Logística</div>
                  <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                    Marcar si es un vehículo/móvil para gestión logística
                  </div>
                </div>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={activo}
                  onChange={(e) => setActivo(e.target.checked)}
                  disabled={loading}
                  style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                />
                <div>
                  <div style={{ fontWeight: '600', fontSize: '1rem' }}>
                    {activo ? '✅ Equipo Activo' : '❌ Equipo Inactivo'}
                  </div>
                  <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                    Los equipos inactivos no pueden usarse para inspecciones o mantenimientos
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Botones */}
          <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
            <button
              type="submit"
              disabled={loading}
              style={{
                flex: 1,
                padding: '0.875rem',
                background: loading ? '#9ca3af' : '#f59e0b',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                fontSize: '1rem'
              }}
            >
              {loading ? '⏳ Guardando...' : (esEdicion ? '💾 Guardar Cambios' : '➕ Crear Equipo')}
            </button>

            <button
              type="button"
              onClick={onCancelar}
              disabled={loading}
              style={{
                flex: 1,
                padding: '0.875rem',
                background: '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                fontSize: '1rem'
              }}
            >
              ❌ Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default FormularioEquipo