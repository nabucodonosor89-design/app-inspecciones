import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from './lib/supabase'
import { toast, confirmar } from './utils/ui'

function EditarLineaPedidoModal({ linea, onCerrar, onActualizado }) {
  const [loading, setLoading] = useState(false)
  const [equipos, setEquipos] = useState([])
  const [mantenimientos, setMantenimientos] = useState([])
  
  // Estados editables
  const [equipoAsignadoId, setEquipoAsignadoId] = useState(linea.equipo_asignado_id || '')
  const [estadoAprobacion, setEstadoAprobacion] = useState(linea.estado_aprobacion)
  const [estadoEntrega, setEstadoEntrega] = useState(linea.estado_entrega)
  const [fechaEstimada, setFechaEstimada] = useState(linea.fecha_estimada_entrega || '')
  const [fechaReal, setFechaReal] = useState(linea.fecha_entrega_real || '')
  const [mantenimientoId, setMantenimientoId] = useState(linea.mantenimiento_id || '')
  const [comentarios, setComentarios] = useState(linea.comentarios || '')

  // Buscador de equipo
  const [busquedaEquipo, setBusquedaEquipo] = useState('')
  const [mostrarListaEquipos, setMostrarListaEquipos] = useState(false)
  const buscadorRef = useRef(null)

  useEffect(() => {
    cargarDatos()
  }, [])

  // Mantener el input del buscador alineado con el equipo seleccionado
  useEffect(() => {
    if (!equipos.length || !equipoAsignadoId) {
      setBusquedaEquipo('')
      return
    }
    const eq = equipos.find(e => e.id === equipoAsignadoId)
    if (!eq) return
    setBusquedaEquipo(eq.numero_identificacion)
  }, [equipos, equipoAsignadoId])

  async function cargarDatos() {
    try {
      // Cargar equipos disponibles
      const { data: equiposData, error: errorEquipos } = await supabase
        .from('equipos')
        .select('id, numero_identificacion, estado_operativo, denominacion')
        .order('numero_identificacion')
      
      if (errorEquipos) {
        console.error('Error cargando equipos:', errorEquipos)
      }
      
      setEquipos(equiposData || [])

      // Cargar mantenimientos activos (Taller Entrada y Taller Espera)
      const { data: mantData, error: errorMant } = await supabase
        .from('mantenimientos')
        .select('id, numero_aviso, estado, equipo_id')
        .in('estado', ['Taller Entrada', 'Taller Espera'])
        .order('created_at', { ascending: false })
      
      if (errorMant) {
        console.error('Error cargando mantenimientos:', errorMant)
      }
      
      setMantenimientos(mantData || [])

    } catch (error) {
      console.error('Error:', error)
    }
  }

  // Filtrar equipos según búsqueda
  const equiposFiltrados = useMemo(() => {
    if (!busquedaEquipo.trim()) return equipos
    
    const busqueda = busquedaEquipo.toLowerCase()
    return equipos.filter(eq => 
      eq.numero_identificacion?.toLowerCase().includes(busqueda) ||
      eq.denominacion?.toLowerCase().includes(busqueda)
    )
  }, [equipos, busquedaEquipo])

  function seleccionarEquipo(eq) {
    setEquipoAsignadoId(eq.id)
    setBusquedaEquipo(eq.numero_identificacion)
    setMostrarListaEquipos(false)
  }

  function limpiarEquipoSiCorresponde() {
    // Si el texto no coincide con ningún equipo, limpiar selección
    const equipoActual = equipos.find(e => e.id === equipoAsignadoId)
    if (equipoActual && busquedaEquipo !== equipoActual.numero_identificacion) {
      setEquipoAsignadoId('')
    }
  }

  async function guardar() {
    try {
      setLoading(true)

      // Validaciones
      if (estadoEntrega === 'asignado' && !equipoAsignadoId) {
        toast('⚠️ Debe asignar un equipo si el estado es "Asignado"')
        return
      }

      if (estadoEntrega === 'entregado' && !fechaReal) {
        toast('⚠️ Debe ingresar la fecha real de entrega')
        return
      }

      // 🔒 VALIDACIÓN: Verificar que el equipo no esté asignado a otro pedido
      if (equipoAsignadoId && equipoAsignadoId !== linea.equipo_asignado_id) {
        const { data: equiposAsignados, error: errorCheck } = await supabase
          .from('pedidos_equipos_lineas')
          .select('id, numero_pedido, email_solicitante')
          .eq('equipo_asignado_id', equipoAsignadoId)
          .neq('id', linea.id) // Excluir la línea actual
          .in('estado_entrega', ['pendiente_asignacion', 'asignado']) // Solo pedidos activos

        if (errorCheck) throw errorCheck

        if (equiposAsignados && equiposAsignados.length > 0) {
          const equipoInfo = equipos.find(e => e.id === equipoAsignadoId)
          const otroPedido = equiposAsignados[0]
          
          toast(
            `⚠️ EQUIPO YA ASIGNADO\n\n` +
            `El equipo ${equipoInfo?.numero_identificacion || 'seleccionado'} ya está asignado a:\n` +
            `• Pedido: ${otroPedido.numero_pedido}\n` +
            `• Solicitante: ${otroPedido.email_solicitante}\n\n` +
            `No se puede asignar el mismo equipo a múltiples pedidos activos.`
          )
          setLoading(false)
          return
        }
      }

      const { error } = await supabase
        .from('pedidos_equipos_lineas')
        .update({
          equipo_asignado_id: equipoAsignadoId || null,
          estado_aprobacion: estadoAprobacion,
          estado_entrega: estadoEntrega,
          fecha_estimada_entrega: fechaEstimada || null,
          fecha_entrega_real: fechaReal || null,
          mantenimiento_id: mantenimientoId || null,
          comentarios: comentarios.trim() || null
        })
        .eq('id', linea.id)

      if (error) throw error

      toast('✅ Línea actualizada correctamente')
      onActualizado()

    } catch (error) {
      console.error('Error:', error)
      toast('❌ Error al actualizar: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  async function eliminar() {
    if (!await confirmar('¿Está seguro de eliminar esta línea del pedido?')) {
      return
    }

    try {
      setLoading(true)

      const { error } = await supabase
        .from('pedidos_equipos_lineas')
        .delete()
        .eq('id', linea.id)

      if (error) throw error

      toast('✅ Línea eliminada')
      onActualizado()

    } catch (error) {
      console.error('Error:', error)
      toast('❌ Error al eliminar: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  // Filtrar mantenimientos del equipo asignado
  const mantenimientosDelEquipo = mantenimientos.filter(m => 
    m.equipo_id === equipoAsignadoId
  )

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
        maxWidth: '800px',
        width: '100%',
        maxHeight: '90vh',
        overflow: 'auto'
      }}>
        <div style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1rem' }}>
            ✏️ Editar Línea de Pedido
          </h2>

          {/* Info del pedido (solo lectura) */}
          <div style={{
            background: '#f9fafb',
            padding: '1rem',
            borderRadius: '8px',
            marginBottom: '1.5rem',
            fontSize: '0.875rem'
          }}>
            <div style={{ marginBottom: '0.5rem' }}>
              <strong>Pedido:</strong> {linea.numero_pedido}
            </div>
            <div style={{ marginBottom: '0.5rem' }}>
              <strong>Obra:</strong> {linea.obra?.nombre_obra}
            </div>
            <div style={{ marginBottom: '0.5rem' }}>
              <strong>Solicitante:</strong> {linea.email_solicitante}
            </div>
            <div>
              <strong>Equipo Solicitado:</strong> {linea.tipo_equipo_solicitado}
              {linea.cantidad_solicitada > 1 && ` (x${linea.cantidad_solicitada})`}
            </div>
          </div>

          {/* Formulario de edición */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            
            {/* Estados */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
                  Estado de Aprobación
                </label>
                <select
                  value={estadoAprobacion}
                  onChange={(e) => setEstadoAprobacion(e.target.value)}
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '1rem'
                  }}
                >
                  <option value="pendiente_aprobacion">⏳ Pendiente Aprobación</option>
                  <option value="aprobado">✅ Aprobado</option>
                  <option value="rechazado">❌ Rechazado</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
                  Estado de Entrega
                </label>
                <select
                  value={estadoEntrega}
                  onChange={(e) => setEstadoEntrega(e.target.value)}
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '1rem'
                  }}
                >
                  <option value="pendiente_asignacion">⚪ Pendiente Asignación</option>
                  <option value="asignado">🔵 Asignado</option>
                  <option value="entregado">✅ Entregado</option>
                  <option value="cancelado">🚫 Cancelado</option>
                </select>
              </div>
            </div>

            {/* Equipo asignado - Combobox con búsqueda */}
            <div ref={buscadorRef} style={{ position: 'relative' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
                Equipo Asignado
              </label>

              <input
                type="text"
                value={busquedaEquipo}
                onChange={e => {
                  setBusquedaEquipo(e.target.value)
                  setMostrarListaEquipos(true)
                  limpiarEquipoSiCorresponde()
                }}
                onFocus={() => setMostrarListaEquipos(true)}
                disabled={loading}
                placeholder="Escribir para buscar. Ej: VL-CN004"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '2px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '1rem'
                }}
              />

              {mostrarListaEquipos && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    right: 0,
                    background: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
                    maxHeight: '260px',
                    overflowY: 'auto',
                    zIndex: 50
                  }}
                >
                  {equiposFiltrados.length === 0 ? (
                    <div style={{ padding: '0.75rem', color: '#6b7280' }}>
                      No se encontraron equipos con "{busquedaEquipo}".
                    </div>
                  ) : (
                    equiposFiltrados.slice(0, 80).map(eq => (
                      <button
                        key={eq.id}
                        type="button"
                        onClick={() => seleccionarEquipo(eq)}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '0.75rem',
                          border: 'none',
                          background: 'transparent',
                          cursor: 'pointer',
                          borderBottom: '1px solid #f3f4f6'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#f9fafb'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <div style={{ fontWeight: '700', marginBottom: '0.25rem' }}>
                          {eq.numero_identificacion}
                          {eq.estado_operativo === 'fuera_servicio' && ' 🔴'}
                          {eq.estado_operativo === 'operativo_restricciones' && ' ⚠️'}
                        </div>
                        <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>{eq.denominacion || ''}</div>
                      </button>
                    ))
                  )}
                </div>
              )}

              {/* Click fuera para cerrar dropdown */}
              {mostrarListaEquipos && (
                <div
                  onClick={() => setMostrarListaEquipos(false)}
                  style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 40
                  }}
                />
              )}
            </div>

            {/* Fechas */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
                  Fecha Estimada de Entrega
                </label>
                <input
                  type="date"
                  value={fechaEstimada}
                  onChange={(e) => setFechaEstimada(e.target.value)}
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
                  Fecha Real de Entrega
                </label>
                <input
                  type="date"
                  value={fechaReal}
                  onChange={(e) => setFechaReal(e.target.value)}
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

            {/* Mantenimiento/OT */}
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
                Orden de Trabajo / Aviso de Mantenimiento
              </label>
              <select
                value={mantenimientoId}
                onChange={(e) => setMantenimientoId(e.target.value)}
                disabled={loading || !equipoAsignadoId}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '2px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '1rem'
                }}
              >
                <option value="">Sin orden vinculada</option>
                {mantenimientosDelEquipo.map(mant => (
                  <option key={mant.id} value={mant.id}>
                    {mant.numero_aviso} - {mant.estado}
                  </option>
                ))}
              </select>
              {!equipoAsignadoId && (
                <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                  Primero asigne un equipo para vincular una orden
                </p>
              )}
            </div>

            {/* Comentarios */}
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
                Comentarios / Motivo de Demora
              </label>
              <textarea
                value={comentarios}
                onChange={(e) => setComentarios(e.target.value)}
                placeholder="Ej: Operador en proceso de contratación, Esperando repuesto..."
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
              {loading ? '⏳ Guardando...' : '💾 Guardar Cambios'}
            </button>

            <button
              onClick={eliminar}
              disabled={loading}
              style={{
                padding: '0.875rem 1.5rem',
                background: loading ? '#9ca3af' : '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                fontSize: '1rem'
              }}
            >
              🗑️ Eliminar
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

export default EditarLineaPedidoModal