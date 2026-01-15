import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'

function FormularioOperador({ operador, onCerrar, onGuardado }) {
  const esEdicion = !!operador
  
  const [nombres, setNombres] = useState('')
  const [apellidos, setApellidos] = useState('')
  const [numeroDocumento, setNumeroDocumento] = useState('')
  const [telefono, setTelefono] = useState('')
  const [direccion, setDireccion] = useState('')
  const [fechaIngreso, setFechaIngreso] = useState('')
  const [tiposEquiposHabilitado, setTiposEquiposHabilitado] = useState([])
  const [estado, setEstado] = useState('activo')
  const [observaciones, setObservaciones] = useState('')
  const [loading, setLoading] = useState(false)

  // Estados para autocompletado
  const [tiposDisponibles, setTiposDisponibles] = useState([])
  const [inputTipo, setInputTipo] = useState('')
  const [sugerencias, setSugerencias] = useState([])
  const [mostrarSugerencias, setMostrarSugerencias] = useState(false)

  useEffect(() => {
    cargarTiposExistentes()
    
    if (operador) {
      setNombres(operador.nombres || '')
      setApellidos(operador.apellidos || '')
      setNumeroDocumento(operador.numero_documento || '')
      setTelefono(operador.telefono || '')
      setDireccion(operador.direccion || '')
      setFechaIngreso(operador.fecha_ingreso || '')
      setTiposEquiposHabilitado(operador.tipos_equipos_habilitado || [])
      setEstado(operador.estado || 'activo')
      setObservaciones(operador.observaciones || '')
    }
  }, [operador])

  // Cargar todos los tipos únicos que ya existen en la base de datos
  async function cargarTiposExistentes() {
    try {
      const { data, error } = await supabase
        .from('operadores')
        .select('tipos_equipos_habilitado')
      
      if (error) throw error

      // Extraer todos los tipos únicos
      const todosLosTipos = new Set()
      data.forEach(op => {
        if (op.tipos_equipos_habilitado) {
          op.tipos_equipos_habilitado.forEach(tipo => todosLosTipos.add(tipo))
        }
      })

      setTiposDisponibles(Array.from(todosLosTipos).sort())
    } catch (error) {
      console.error('Error cargando tipos:', error)
    }
  }

  // Manejar cambio en el input de tipo
  const handleInputTipoChange = (e) => {
    const valor = e.target.value
    setInputTipo(valor)

    if (valor.trim().length > 0) {
      // Filtrar sugerencias
      const sugerenciasFiltradas = tiposDisponibles.filter(tipo =>
        tipo.toLowerCase().includes(valor.toLowerCase()) &&
        !tiposEquiposHabilitado.includes(tipo)
      )
      setSugerencias(sugerenciasFiltradas)
      setMostrarSugerencias(true)
    } else {
      setSugerencias([])
      setMostrarSugerencias(false)
    }
  }

  // Agregar tipo (desde sugerencia o nuevo)
  const agregarTipo = (tipo) => {
    const tipoTrimmed = tipo.trim()
    if (tipoTrimmed && !tiposEquiposHabilitado.includes(tipoTrimmed)) {
      setTiposEquiposHabilitado([...tiposEquiposHabilitado, tipoTrimmed])
      
      // Si es un tipo nuevo, agregarlo a la lista de disponibles
      if (!tiposDisponibles.includes(tipoTrimmed)) {
        setTiposDisponibles([...tiposDisponibles, tipoTrimmed].sort())
      }
    }
    setInputTipo('')
    setSugerencias([])
    setMostrarSugerencias(false)
  }

  // Manejar Enter en el input
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (sugerencias.length > 0 && mostrarSugerencias) {
        agregarTipo(sugerencias[0])
      } else if (inputTipo.trim()) {
        agregarTipo(inputTipo)
      }
    }
  }

  // Quitar tipo
  const quitarTipo = (tipo) => {
    setTiposEquiposHabilitado(tiposEquiposHabilitado.filter(t => t !== tipo))
  }

  async function handleSubmit(e) {
    e.preventDefault()

    // Validaciones
    if (!nombres.trim() || !apellidos.trim()) {
      alert('El nombre y apellido son obligatorios')
      return
    }

    if (!numeroDocumento.trim()) {
      alert('El número de documento es obligatorio')
      return
    }

    if (tiposEquiposHabilitado.length === 0) {
      alert('Debe agregar al menos un tipo de equipo que el operador puede operar')
      return
    }

    try {
      setLoading(true)

      const datosOperador = {
        nombres: nombres.trim(),
        apellidos: apellidos.trim(),
        numero_documento: numeroDocumento.trim(),
        telefono: telefono.trim() || null,
        direccion: direccion.trim() || null,
        fecha_ingreso: fechaIngreso || null,
        tipos_equipos_habilitado: tiposEquiposHabilitado,
        estado: estado,
        observaciones: observaciones.trim() || null
      }

      let error

      if (esEdicion) {
        const result = await supabase
          .from('operadores')
          .update(datosOperador)
          .eq('id', operador.id)
        error = result.error
      } else {
        const result = await supabase
          .from('operadores')
          .insert([datosOperador])
        error = result.error
      }

      if (error) throw error

      alert(esEdicion ? 'Operador actualizado correctamente' : 'Operador creado correctamente')
      onGuardado()
    } catch (error) {
      console.error('Error:', error)
      if (error.code === '23505') {
        alert('Ya existe un operador con ese número de documento')
      } else {
        alert('Error al guardar: ' + error.message)
      }
    } finally {
      setLoading(false)
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
      zIndex: 1000,
      padding: '1rem'
    }}>
      <div style={{
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
        width: '100%',
        maxWidth: '800px',
        maxHeight: '90vh',
        overflow: 'auto'
      }}>
        <form onSubmit={handleSubmit}>
          {/* Header */}
          <div style={{
            padding: '1.5rem',
            borderBottom: '2px solid #e5e7eb',
            position: 'sticky',
            top: 0,
            background: 'white',
            zIndex: 10
          }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '700', margin: 0 }}>
              {esEdicion ? '✏️ Editar Operador' : '➕ Nuevo Operador'}
            </h2>
          </div>

          {/* Contenido */}
          <div style={{ padding: '1.5rem' }}>
            {/* Datos Personales */}
            <div style={{
              background: '#f9fafb',
              padding: '1rem',
              borderRadius: '8px',
              marginBottom: '1.5rem'
            }}>
              <h3 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '1rem', color: '#1f2937' }}>
                👤 Datos Personales
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: '#374151' }}>
                    Nombres <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={nombres}
                    onChange={(e) => setNombres(e.target.value)}
                    required
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
                    Apellidos <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={apellidos}
                    onChange={(e) => setApellidos(e.target.value)}
                    required
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: '#374151' }}>
                    Nro. Documento (CI) <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={numeroDocumento}
                    onChange={(e) => setNumeroDocumento(e.target.value)}
                    required
                    disabled={esEdicion}
                    placeholder="1234567"
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '2px solid #e5e7eb',
                      borderRadius: '6px',
                      fontSize: '0.875rem',
                      background: esEdicion ? '#f3f4f6' : 'white',
                      cursor: esEdicion ? 'not-allowed' : 'text'
                    }}
                  />
                  {esEdicion && (
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                      El documento no se puede modificar
                    </div>
                  )}
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: '#374151' }}>
                    Teléfono
                  </label>
                  <input
                    type="text"
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                    placeholder="0981-123456"
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

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: '#374151' }}>
                  Dirección
                </label>
                <input
                  type="text"
                  value={direccion}
                  onChange={(e) => setDireccion(e.target.value)}
                  placeholder="Av. España 123"
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '2px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '0.875rem'
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: '#374151' }}>
                    Fecha de Ingreso
                  </label>
                  <input
                    type="date"
                    value={fechaIngreso}
                    onChange={(e) => setFechaIngreso(e.target.value)}
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
                    Estado
                  </label>
                  <select
                    value={estado}
                    onChange={(e) => setEstado(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '2px solid #e5e7eb',
                      borderRadius: '6px',
                      fontSize: '0.875rem'
                    }}
                  >
                    <option value="activo">✅ Activo</option>
                    <option value="inactivo">🚫 Inactivo</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Tipos de Equipos con Autocompletado */}
            <div style={{
              background: '#eff6ff',
              padding: '1rem',
              borderRadius: '8px',
              marginBottom: '1.5rem'
            }}>
              <h3 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '0.5rem', color: '#1e40af' }}>
                🚜 Tipos de Equipos que Opera <span style={{ color: '#ef4444' }}>*</span>
              </h3>
              <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem' }}>
                Escribe el tipo de equipo. Se mostrarán sugerencias si ya existen similares.
              </p>

              {/* Input con autocompletado */}
              <div style={{ position: 'relative', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    value={inputTipo}
                    onChange={handleInputTipoChange}
                    onKeyDown={handleKeyDown}
                    onFocus={() => inputTipo && setMostrarSugerencias(true)}
                    onBlur={() => setTimeout(() => setMostrarSugerencias(false), 200)}
                    placeholder="Ej: Camión, Excavadora, Mixer..."
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      border: '2px solid #3b82f6',
                      borderRadius: '6px',
                      fontSize: '0.875rem'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => inputTipo.trim() && agregarTipo(inputTipo)}
                    disabled={!inputTipo.trim()}
                    style={{
                      padding: '0.75rem 1.5rem',
                      background: inputTipo.trim() ? '#3b82f6' : '#9ca3af',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: inputTipo.trim() ? 'pointer' : 'not-allowed',
                      fontWeight: '600',
                      fontSize: '0.875rem',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    ➕ Agregar
                  </button>
                </div>
                
                {/* Sugerencias */}
                {mostrarSugerencias && sugerencias.length > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    background: 'white',
                    border: '2px solid #3b82f6',
                    borderTop: 'none',
                    borderRadius: '0 0 6px 6px',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    zIndex: 10,
                    boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                  }}>
                    {sugerencias.map((tipo, index) => (
                      <div
                        key={index}
                        onClick={() => agregarTipo(tipo)}
                        style={{
                          padding: '0.75rem',
                          cursor: 'pointer',
                          borderBottom: index < sugerencias.length - 1 ? '1px solid #e5e7eb' : 'none',
                          fontSize: '0.875rem',
                          transition: 'background 0.2s'
                        }}
                        onMouseEnter={(e) => e.target.style.background = '#dbeafe'}
                        onMouseLeave={(e) => e.target.style.background = 'white'}
                      >
                        {tipo}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.5rem' }}>
                  💡 Escribe el tipo y presiona <strong>Enter</strong> o haz click en <strong>➕ Agregar</strong>
                </div>
              </div>

              {/* Tipos agregados */}
              {tiposEquiposHabilitado.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: '600', color: '#1e40af', marginBottom: '0.5rem' }}>
                    Tipos agregados:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {tiposEquiposHabilitado.map((tipo, index) => (
                      <div
                        key={index}
                        style={{
                          background: '#dbeafe',
                          color: '#1e40af',
                          padding: '0.5rem 0.75rem',
                          borderRadius: '6px',
                          fontSize: '0.875rem',
                          fontWeight: '600',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem'
                        }}
                      >
                        {tipo}
                        <button
                          type="button"
                          onClick={() => quitarTipo(tipo)}
                          style={{
                            background: '#ef4444',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            width: '20px',
                            height: '20px',
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tiposEquiposHabilitado.length === 0 && (
                <div style={{
                  padding: '0.75rem',
                  background: '#fef3c7',
                  border: '2px solid #f59e0b',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  color: '#92400e'
                }}>
                  ⚠️ Debe agregar al menos un tipo de equipo
                </div>
              )}
            </div>

            {/* Observaciones */}
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: '600', color: '#374151' }}>
                Observaciones
              </label>
              <textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                rows={3}
                placeholder="Notas adicionales sobre el operador..."
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '2px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  fontFamily: 'inherit',
                  resize: 'vertical'
                }}
              />
            </div>
          </div>

          {/* Footer */}
          <div style={{
            padding: '1.5rem',
            borderTop: '2px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '1rem',
            position: 'sticky',
            bottom: 0,
            background: 'white'
          }}>
            <button
              type="button"
              onClick={onCerrar}
              disabled={loading}
              style={{
                padding: '0.75rem 1.5rem',
                background: '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                opacity: loading ? 0.5 : 1
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '0.75rem 1.5rem',
                background: loading ? '#9ca3af' : '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: '600'
              }}
            >
              {loading ? 'Guardando...' : (esEdicion ? '💾 Guardar Cambios' : '➕ Crear Operador')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default FormularioOperador