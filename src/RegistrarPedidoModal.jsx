import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'

function RegistrarPedidoModal({ onCerrar, onGuardado, usuario }) {
  const [obras, setObras] = useState([])
  const [loading, setLoading] = useState(false)
  
  // Datos del pedido
  const [numeroPedido, setNumeroPedido] = useState('')
  const [obraId, setObraId] = useState('')
  const [emailSolicitante, setEmailSolicitante] = useState('')
  const [fechaRecepcion, setFechaRecepcion] = useState(new Date().toISOString().split('T')[0])
  
  // Líneas de equipos solicitados
  const [lineas, setLineas] = useState([
    {
      tipo_equipo: '',
      cantidad: 1,
      observaciones: ''
    }
  ])

  useEffect(() => {
    cargarObras()
  }, [])

  async function cargarObras() {
    try {
      const { data, error } = await supabase
        .from('obras')
        .select('id, codigo_obra, nombre_obra')
        .order('nombre_obra')

      if (error) throw error
      setObras(data || [])
    } catch (error) {
      console.error('Error:', error)
      alert('Error al cargar obras')
    }
  }

  function agregarLinea() {
    setLineas([...lineas, {
      tipo_equipo: '',
      cantidad: 1,
      observaciones: ''
    }])
  }

  function eliminarLinea(index) {
    if (lineas.length === 1) {
      alert('Debe haber al menos una línea')
      return
    }
    setLineas(lineas.filter((_, i) => i !== index))
  }

  function actualizarLinea(index, campo, valor) {
    const nuevasLineas = [...lineas]
    nuevasLineas[index][campo] = valor
    setLineas(nuevasLineas)
  }

  async function guardar() {
    // Validaciones
    if (!numeroPedido.trim()) {
      alert('⚠️ Ingrese el número de pedido')
      return
    }

    if (!obraId) {
      alert('⚠️ Seleccione una obra')
      return
    }

    if (!emailSolicitante.trim()) {
      alert('⚠️ Ingrese el email del solicitante')
      return
    }

    // Validar email formato básico
    if (!emailSolicitante.includes('@')) {
      alert('⚠️ Ingrese un email válido')
      return
    }

    // Validar líneas
    const lineasValidas = lineas.filter(l => l.tipo_equipo.trim() !== '')
    if (lineasValidas.length === 0) {
      alert('⚠️ Ingrese al menos un tipo de equipo')
      return
    }

    try {
      setLoading(true)

      // Preparar datos para insertar
      const lineasParaInsertar = lineasValidas.map(linea => ({
        numero_pedido: numeroPedido.trim(),
        obra_id: obraId,
        email_solicitante: emailSolicitante.trim().toLowerCase(),
        tipo_equipo_solicitado: linea.tipo_equipo.trim(),
        cantidad_solicitada: parseInt(linea.cantidad) || 1,
        observaciones_solicitud: linea.observaciones.trim() || null,
        fecha_recepcion: fechaRecepcion,
        estado_aprobacion: 'pendiente_aprobacion',
        estado_entrega: 'pendiente_asignacion',
        creado_por: usuario.id
      }))

      // Insertar todas las líneas
      const { error } = await supabase
        .from('pedidos_equipos_lineas')
        .insert(lineasParaInsertar)

      if (error) throw error

      alert(`✅ Pedido registrado exitosamente!\n${lineasValidas.length} equipo(s) solicitado(s)`)
      onGuardado()

    } catch (error) {
      console.error('Error:', error)
      alert('❌ Error al guardar pedido: ' + error.message)
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
      padding: '1rem',
      zIndex: 1000,
      overflowY: 'auto'
    }}>
      <div style={{
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
        maxWidth: '900px',
        width: '100%',
        maxHeight: '90vh',
        overflow: 'auto',
        margin: '2rem auto'
      }}>
        <div style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1.5rem' }}>
            📋 Registrar Nuevo Pedido
          </h2>

          {/* Datos generales del pedido */}
          <div style={{
            background: '#f9fafb',
            padding: '1.5rem',
            borderRadius: '8px',
            marginBottom: '1.5rem'
          }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '1rem' }}>
              Datos del Pedido
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem', color: '#1f2937' }}>
                  Número de Pedido <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  value={numeroPedido}
                  onChange={(e) => setNumeroPedido(e.target.value)}
                  placeholder="Ej: 44#25"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '1rem'
                  }}
                />
                <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                  Número del formulario PDF
                </p>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem', color: '#1f2937' }}>
                  Obra <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select
                  value={obraId}
                  onChange={(e) => setObraId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '1rem'
                  }}
                >
                  <option value="">Seleccione obra...</option>
                  {obras.map(obra => (
                    <option key={obra.id} value={obra.id}>
                      {obra.codigo_obra} - {obra.nombre_obra}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem', color: '#1f2937' }}>
                  Email Solicitante <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="email"
                  value={emailSolicitante}
                  onChange={(e) => setEmailSolicitante(e.target.value)}
                  placeholder="solicitante@ejemplo.com"
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
                  Fecha de Recepción <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="date"
                  value={fechaRecepcion}
                  onChange={(e) => setFechaRecepcion(e.target.value)}
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

          {/* Equipos solicitados */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '600', margin: 0 }}>
                Equipos Solicitados
              </h3>
              <button
                onClick={agregarLinea}
                disabled={loading}
                style={{
                  padding: '0.5rem 1rem',
                  background: '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: '600'
                }}
              >
                ➕ Agregar Equipo
              </button>
            </div>

            {lineas.map((linea, index) => (
              <div
                key={index}
                style={{
                  background: '#f9fafb',
                  padding: '1rem',
                  borderRadius: '8px',
                  marginBottom: '1rem',
                  border: '2px solid #e5e7eb'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h4 style={{ fontSize: '1rem', fontWeight: '600', margin: 0, color: '#10b981' }}>
                    Equipo #{index + 1}
                  </h4>
                  {lineas.length > 1 && (
                    <button
                      onClick={() => eliminarLinea(index)}
                      disabled={loading}
                      style={{
                        padding: '0.25rem 0.75rem',
                        background: '#ef4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        fontSize: '0.75rem',
                        fontWeight: '600'
                      }}
                    >
                      🗑️ Eliminar
                    </button>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#1f2937' }}>
                      Tipo de Equipo <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="text"
                      value={linea.tipo_equipo}
                      onChange={(e) => actualizarLinea(index, 'tipo_equipo', e.target.value)}
                      placeholder="Ej: Volquete Triple Eje, Camión, Excavadora..."
                      disabled={loading}
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
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#1f2937' }}>
                      Cantidad
                    </label>
                    <input
                      type="number"
                      value={linea.cantidad}
                      onChange={(e) => actualizarLinea(index, 'cantidad', e.target.value)}
                      min="1"
                      disabled={loading}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        border: '2px solid #e5e7eb',
                        borderRadius: '6px',
                        fontSize: '0.875rem'
                      }}
                    />
                  </div>

                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#1f2937' }}>
                      Observaciones del Formulario
                    </label>
                    <textarea
                      value={linea.observaciones}
                      onChange={(e) => actualizarLinea(index, 'observaciones', e.target.value)}
                      placeholder="Ej: Con choferes, especificaciones técnicas..."
                      rows="2"
                      disabled={loading}
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
              </div>
            ))}
          </div>

          {/* Botones */}
          <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
            <button
              onClick={guardar}
              disabled={loading}
              style={{
                flex: 1,
                padding: '0.875rem',
                background: loading ? '#9ca3af' : '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                fontSize: '1rem'
              }}
            >
              {loading ? '⏳ Guardando...' : '💾 Registrar Pedido'}
            </button>

            <button
              onClick={onCerrar}
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
        </div>
      </div>
    </div>
  )
}

export default RegistrarPedidoModal