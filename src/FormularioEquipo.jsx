import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import { toast } from './utils/ui'

function FormularioEquipo({ equipo, onGuardado, onCancelar, usuario }) {
  const [loading, setLoading] = useState(false)
  const esEdicion = !!equipo

  // NUEVO: Estado para obras activas
  const [obras, setObras] = useState([])
  
  // NUEVO: Estado para operadores
  const [operadores, setOperadores] = useState([])
  const [operadorAsignadoId, setOperadorAsignadoId] = useState(equipo?.operador_asignado_id || null)

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
  const [esCritico, setEsCritico] = useState(equipo?.es_critico || false)
  const [notasCriticidad, setNotasCriticidad] = useState(equipo?.notas_criticidad || '')
  const [activo, setActivo] = useState(equipo?.activo ?? true)

  // NUEVO: Cargar obras activas al montar el componente
  useEffect(() => {
    cargarObrasActivas()
    cargarOperadoresActivos()
  }, [])

  async function cargarObrasActivas() {
    try {
      console.log('🔍 Cargando obras activas...')
      
      const { data, error } = await supabase
        .from('obras')
        .select('id, codigo_obra, nombre_obra, activa')
        .eq('activa', true)
        .order('nombre_obra')
      
      if (error) {
        console.error('❌ Error al cargar obras:', error)
        throw error
      }
      
      console.log('✅ Obras cargadas:', data)
      console.log('📊 Cantidad de obras:', data?.length || 0)
      
      setObras(data || [])
    } catch (error) {
      console.error('💥 Error completo:', error)
      // Intentar cargar SIN filtro de activo para debug
      try {
        console.log('🔄 Intentando cargar todas las obras (sin filtro)...')
        const { data: todasObras } = await supabase
          .from('obras')
          .select('id, codigo_obra, nombre_obra, activa')
          .order('nombre_obra')
        
        console.log('📋 Todas las obras (sin filtro):', todasObras)
        
        // Si hay obras pero ninguna activa, mostrar alerta
        if (todasObras && todasObras.length > 0) {
          console.warn('⚠️ Hay obras en la BD pero ninguna está activa')
          toast('⚠️ No hay obras activas. Por favor activa algunas obras primero.')
        } else if (!todasObras || todasObras.length === 0) {
          console.warn('⚠️ No hay obras en la base de datos')
          toast('⚠️ No hay obras registradas en el sistema.')
        }
      } catch (err) {
        console.error('Error al cargar todas las obras:', err)
      }
    }
  }

  async function cargarOperadoresActivos() {
    try {
      console.log('🔍 Cargando operadores activos...')
      
      const { data, error } = await supabase
        .from('operadores')
        .select('id, nombres, apellidos, numero_documento, tipos_equipos_habilitado')
        .eq('estado', 'activo')
        .order('apellidos')
      
      if (error) {
        console.error('❌ Error al cargar operadores:', error)
        throw error
      }
      
      console.log('✅ Operadores cargados:', data)
      console.log('📊 Cantidad de operadores:', data?.length || 0)
      
      setOperadores(data || [])
    } catch (error) {
      console.error('💥 Error al cargar operadores:', error)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()

    // Validaciones
    if (!numeroIdentificacion.trim()) {
      toast('⚠️ El código del equipo es obligatorio')
      return
    }

    if (!tipoEquipo.trim()) {
      toast('⚠️ El tipo de equipo es obligatorio')
      return
    }


    // Validación de equipo crítico
    if (esCritico && !notasCriticidad.trim()) {
      toast('⚠️ Si el equipo es crítico, debe agregar notas explicando por qué')
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
        es_critico: esCritico,
        notas_criticidad: notasCriticidad.trim() || null,
        activo: activo,
        operador_asignado_id: operadorAsignadoId || null
      }

      if (esEdicion) {
        // Actualizar
        const { error } = await supabase
          .from('equipos')
          .update(datos)
          .eq('id', equipo.id)

        if (error) throw error

        toast('✅ Equipo actualizado correctamente')
      } else {
        // Crear nuevo
        const { error } = await supabase
          .from('equipos')
          .insert([datos])

        if (error) throw error

        toast('✅ Equipo creado correctamente')
      }

      onGuardado()

    } catch (error) {
      console.error('Error:', error)
      
      // Error de código duplicado
      if (error.code === '23505') {
        toast('❌ Ya existe un equipo con ese código')
      } else {
        toast('❌ Error al guardar: ' + error.message)
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
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
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
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
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
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
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
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
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
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
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
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
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
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
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
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
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
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
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
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
                  Ubicación Actual
                </label>
                
                {/* Debug info */}
                <select
                  value={ubicacionActual}
                  onChange={(e) => setUbicacionActual(e.target.value)}
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '1rem',
                    background: 'white',
                    cursor: 'pointer'
                  }}
                >
                  <option value="">Seleccionar ubicación...</option>
                  <option value="Complejo Ypane">Complejo Ypane</option>
                  <option value="Taller Central">Taller Central</option>
                  {obras.length > 0 && (
                    <optgroup label={`Obras Activas (${obras.length})`}>
                      {obras.map(obra => (
                        <option key={obra.id} value={obra.nombre_obra}>
                          {obra.codigo_obra} - {obra.nombre_obra}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {obras.length === 0 && (
                    <option disabled>No hay obras activas</option>
                  )}
                </select>
              </div>

              {/* NUEVO: Selector de Operador */}
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
                  Operador Asignado
                </label>
                
                <select
                  value={operadorAsignadoId || ''}
                  onChange={(e) => setOperadorAsignadoId(e.target.value || null)}
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '1rem',
                    background: 'white',
                    cursor: 'pointer'
                  }}
                >
                  <option value="">-- Sin operador asignado --</option>
                  {operadores.map(op => (
                    <option key={op.id} value={op.id}>
                      {op.apellidos}, {op.nombres} - CI: {op.numero_documento}
                      {op.tipos_equipos_habilitado && op.tipos_equipos_habilitado.length > 0 
                        ? ` (${op.tipos_equipos_habilitado.slice(0, 2).join(', ')}${op.tipos_equipos_habilitado.length > 2 ? '...' : ''})` 
                        : ''
                      }
                    </option>
                  ))}
                  {operadores.length === 0 && (
                    <option disabled>No hay operadores activos</option>
                  )}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
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
                  <option value="con_restriccion">⚠️ Operativo con Restricciones</option>
                  <option value="fuera_servicio">🔴 Fuera de Servicio</option>
                </select>
              </div>
            </div>

            <div style={{ marginTop: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
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
                  checked={esCritico}
                  onChange={(e) => {
                    setEsCritico(e.target.checked)
                    if (!e.target.checked) {
                      setNotasCriticidad('') // Limpiar notas si se desmarca
                    }
                  }}
                  disabled={loading}
                  style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                />
                <div>
                  <div style={{ fontWeight: '600', fontSize: '1rem' }}>⚠️ Equipo Crítico</div>
                  <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                    Marcar si es un equipo crítico para las operaciones (se destacará en mantenimientos)
                  </div>
                </div>
              </label>

              {/* Campo de notas de criticidad (solo si está marcado como crítico) */}
              {esCritico && (
                <div style={{ 
                  marginLeft: '2.5rem', 
                  padding: '1rem', 
                  background: '#fef2f2', 
                  borderRadius: '8px',
                  border: '2px solid #fca5a5'
                }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem' }}>
                    <span style={{ fontWeight: '600', fontSize: '0.875rem', color: '#991b1b' }}>
                      Notas de Criticidad *
                    </span>
                  </label>
                  <textarea
                    value={notasCriticidad}
                    onChange={(e) => setNotasCriticidad(e.target.value)}
                    placeholder="Ej: Única excavadora grande disponible para obra San Pedro"
                    rows="3"
                    disabled={loading}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '2px solid #e5e7eb',
                      borderRadius: '6px',
                      fontSize: '0.875rem',
                      fontFamily: 'inherit',
                      resize: 'vertical',
                      boxSizing: 'border-box'
                    }}
                  />
                  <div style={{ fontSize: '0.75rem', color: '#991b1b', marginTop: '0.5rem' }}>
                    💡 Explica por qué este equipo es crítico para las operaciones
                  </div>
                </div>
              )}

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