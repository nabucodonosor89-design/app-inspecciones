import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import { toast } from './utils/ui'

function DashboardPedidosEquipos({ onVolver }) {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalPendientes: 0,
    totalAprobados: 0,
    totalRechazados: 0,
    pendientesAprobacion: 0,
    porObra: [],
    porTipo: [],
    porEstadoEntrega: [],
    porcentajeAprobacion: 0,
    porcentajeEntregado: 0,
    equiposAsignados: 0,
    equiposPendientesAsignar: 0,
    porEstadoOperativo: [],
    porEstadoMantenimiento: [],
    equiposEnTaller: 0
  })

  useEffect(() => {
    cargarEstadisticas()
  }, [])

  async function cargarEstadisticas() {
    try {
      setLoading(true)

      // Cargar todos los pedidos con información de obras Y equipos asignados
      const { data: pedidos, error } = await supabase
        .from('pedidos_equipos_lineas')
        .select(`
          *,
          obras!inner(nombre_obra, codigo_obra),
          equipos(numero_identificacion, estado_operativo, observaciones_operativo)
        `)
        .order('fecha_recepcion', { ascending: false })

      if (error) throw error

      // Cargar mantenimientos activos (Taller Entrada y Taller Espera)
      const { data: mantenimientos, error: errorMant } = await supabase
        .from('mantenimientos')
        .select('equipo_id, estado, numero_aviso')
        .in('estado', ['Taller Entrada', 'Taller Espera'])

      if (errorMant) console.error('Error cargando mantenimientos:', errorMant)

      console.log('📊 Datos de pedidos:', pedidos)
      console.log('🔧 Mantenimientos activos:', mantenimientos)

      // Crear mapa de equipos en mantenimiento
      const equiposEnMantenimiento = new Set(
        mantenimientos?.map(m => m.equipo_id) || []
      )

      // Calcular estadísticas
      const totalPedidos = pedidos.length
      
      // Por estado de aprobación
      const aprobados = pedidos.filter(p => p.estado_aprobacion === 'aprobado')
      const rechazados = pedidos.filter(p => p.estado_aprobacion === 'rechazado')
      const pendientesAprobacion = pedidos.filter(p => p.estado_aprobacion === 'pendiente_aprobacion')

      // Por estado de entrega (solo los aprobados)
      const pendientesAsignacion = aprobados.filter(p => p.estado_entrega === 'pendiente_asignacion')
      const asignados = aprobados.filter(p => p.estado_entrega === 'asignado')
      const entregados = aprobados.filter(p => p.estado_entrega === 'entregado')
      const rechazadosEntrega = aprobados.filter(p => p.estado_entrega === 'rechazado')

      // Total de equipos que debo (aprobados pero no entregados)
      const equiposPorEntregar = aprobados.filter(p => 
        p.estado_entrega !== 'entregado' && p.estado_entrega !== 'rechazado'
      )
      const totalEquiposPorEntregar = equiposPorEntregar.reduce((sum, p) => sum + (p.cantidad_solicitada || 1), 0)

      // Por obra (solo pendientes de entrega)
      const porObraMap = {}
      equiposPorEntregar.forEach(p => {
        const obra = p.obras.nombre_obra
        if (!porObraMap[obra]) {
          porObraMap[obra] = {
            nombre: obra,
            codigo: p.obras.codigo_obra,
            cantidad: 0,
            pedidos: []
          }
        }
        porObraMap[obra].cantidad += p.cantidad_solicitada || 1
        porObraMap[obra].pedidos.push({
          numero: p.numero_pedido,
          tipo: p.tipo_equipo_solicitado,
          estado: p.estado_entrega
        })
      })

      const porObra = Object.values(porObraMap).sort((a, b) => b.cantidad - a.cantidad)

      // Por tipo de equipo (solo pendientes de entrega)
      const porTipoMap = {}
      equiposPorEntregar.forEach(p => {
        const tipo = p.tipo_equipo_solicitado
        if (!porTipoMap[tipo]) {
          porTipoMap[tipo] = {
            tipo: tipo,
            cantidad: 0,
            pendientes_asignar: 0,
            asignados: 0
          }
        }
        porTipoMap[tipo].cantidad += p.cantidad_solicitada || 1
        
        if (p.estado_entrega === 'pendiente_asignacion') {
          porTipoMap[tipo].pendientes_asignar += p.cantidad_solicitada || 1
        } else if (p.estado_entrega === 'asignado') {
          porTipoMap[tipo].asignados += p.cantidad_solicitada || 1
        }
      })

      const porTipo = Object.values(porTipoMap).sort((a, b) => b.cantidad - a.cantidad)

      // Estadísticas de estado de entrega
      const porEstadoEntrega = [
        { 
          estado: 'Pendiente Asignación', 
          cantidad: pendientesAsignacion.length,
          equipos: pendientesAsignacion.reduce((sum, p) => sum + (p.cantidad_solicitada || 1), 0),
          color: '#f59e0b',
          descripcion: 'Aprobados pero sin equipo asignado'
        },
        { 
          estado: 'Asignado', 
          cantidad: asignados.length,
          equipos: asignados.reduce((sum, p) => sum + (p.cantidad_solicitada || 1), 0),
          color: '#3b82f6',
          descripcion: 'Con equipo asignado, pendiente de envío'
        },
        { 
          estado: 'Entregado', 
          cantidad: entregados.length,
          equipos: entregados.reduce((sum, p) => sum + (p.cantidad_solicitada || 1), 0),
          color: '#10b981',
          descripcion: 'Ya enviados a obra'
        },
        { 
          estado: 'Rechazado', 
          cantidad: rechazadosEntrega.length,
          equipos: rechazadosEntrega.reduce((sum, p) => sum + (p.cantidad_solicitada || 1), 0),
          color: '#ef4444',
          descripcion: 'No se pudo cumplir'
        }
      ]

      // Porcentajes
      const porcentajeAprobacion = totalPedidos > 0 
        ? Math.round((aprobados.length / totalPedidos) * 100) 
        : 0

      const porcentajeEntregado = aprobados.length > 0 
        ? Math.round((entregados.length / aprobados.length) * 100) 
        : 0

      // NUEVO: Estadísticas de equipos asignados por estado operativo
      const equiposAsignadosConInfo = asignados.filter(p => p.equipos)
      
      const porEstadoOperativo = [
        {
          estado: 'Operativo',
          cantidad: equiposAsignadosConInfo.filter(p => 
            p.equipos?.estado_operativo === 'operativo' && !p.equipos?.observaciones_operativo
          ).length,
          color: '#10b981',
          icon: '✅',
          descripcion: 'Sin restricciones'
        },
        {
          estado: 'Operativo con Observaciones',
          cantidad: equiposAsignadosConInfo.filter(p => 
            p.equipos?.estado_operativo === 'operativo' && p.equipos?.observaciones_operativo
          ).length,
          color: '#f59e0b',
          icon: '⚠️',
          descripcion: 'Tiene restricciones operativas'
        },
        {
          estado: 'Fuera de Servicio',
          cantidad: equiposAsignadosConInfo.filter(p => 
            p.equipos?.estado_operativo === 'fuera_de_servicio'
          ).length,
          color: '#ef4444',
          icon: '🚫',
          descripcion: 'No disponible para uso'
        },
        {
          estado: 'Sin Datos',
          cantidad: asignados.length - equiposAsignadosConInfo.length,
          color: '#6b7280',
          icon: '❓',
          descripcion: 'Equipo no encontrado en sistema'
        }
      ]

      // NUEVO: Equipos en mantenimiento
      const equiposEnTaller = equiposAsignadosConInfo.filter(p => 
        p.equipos && equiposEnMantenimiento.has(p.equipo_asignado_id)
      )

      const porEstadoMantenimiento = [
        {
          estado: 'En Taller',
          cantidad: equiposEnTaller.length,
          equipos: equiposEnTaller.map(p => ({
            codigo: p.equipos.numero_identificacion,
            pedido: p.numero_pedido,
            obra: p.obras.nombre_obra
          })),
          color: '#f59e0b',
          icon: '🔧',
          descripcion: 'En Taller Entrada o Taller Espera'
        },
        {
          estado: 'Disponibles',
          cantidad: asignados.length - equiposEnTaller.length,
          color: '#10b981',
          icon: '✅',
          descripcion: 'Sin mantenimientos activos'
        }
      ]

      setStats({
        totalPendientes: totalEquiposPorEntregar,
        totalAprobados: aprobados.length,
        totalRechazados: rechazados.length,
        pendientesAprobacion: pendientesAprobacion.length,
        porObra,
        porTipo,
        porEstadoEntrega,
        porcentajeAprobacion,
        porcentajeEntregado,
        equiposAsignados: asignados.reduce((sum, p) => sum + (p.cantidad_solicitada || 1), 0),
        equiposPendientesAsignar: pendientesAsignacion.reduce((sum, p) => sum + (p.cantidad_solicitada || 1), 0),
        // NUEVO:
        porEstadoOperativo,
        porEstadoMantenimiento,
        equiposEnTaller: equiposEnTaller.length
      })

    } catch (error) {
      console.error('Error:', error)
      toast('Error al cargar estadísticas')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <p style={{ fontSize: '1.2rem', color: '#6b7280' }}>Cargando estadísticas...</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', padding: 'clamp(1rem, 2vw, 2rem)' }}>
      {/* Header */}
      <div style={{
        background: 'white',
        padding: '1.5rem',
        borderRadius: '12px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        marginBottom: '2rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 'bold', margin: 0 }}>
            📊 Dashboard de Pedidos de Equipos
          </h1>
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

      {/* Cards principales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '3px solid #ef4444'
        }}>
          <div style={{ fontSize: '0.9rem', color: '#6b7280', marginBottom: '0.5rem', fontWeight: '600' }}>
            🚨 EQUIPOS POR ENTREGAR
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#ef4444' }}>
            {stats.totalPendientes}
          </div>
          <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
            Total aprobados pendientes
          </div>
        </div>

        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '3px solid #f59e0b'
        }}>
          <div style={{ fontSize: '0.9rem', color: '#6b7280', marginBottom: '0.5rem', fontWeight: '600' }}>
            ⏳ SIN ASIGNAR
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#f59e0b' }}>
            {stats.equiposPendientesAsignar}
          </div>
          <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
            Faltan asignar equipos
          </div>
        </div>

        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '3px solid #3b82f6'
        }}>
          <div style={{ fontSize: '0.9rem', color: '#6b7280', marginBottom: '0.5rem', fontWeight: '600' }}>
            ✅ ASIGNADOS
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#3b82f6' }}>
            {stats.equiposAsignados}
          </div>
          <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
            Listos para envío
          </div>
        </div>

        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '3px solid #8b5cf6'
        }}>
          <div style={{ fontSize: '0.9rem', color: '#6b7280', marginBottom: '0.5rem', fontWeight: '600' }}>
            ⏰ PENDIENTES APROBACIÓN
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#8b5cf6' }}>
            {stats.pendientesAprobacion}
          </div>
          <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
            Esperando aprobación
          </div>
        </div>
      </div>

      {/* NUEVA: Alerta de equipos en taller */}
      {stats.equiposEnTaller > 0 && (
        <div style={{
          background: '#fef3c7',
          border: '3px solid #f59e0b',
          padding: '1.5rem',
          borderRadius: '12px',
          marginBottom: '2rem',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '2rem' }}>⚠️</div>
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#92400e', margin: '0 0 0.5rem 0' }}>
                {stats.equiposEnTaller} Equipo{stats.equiposEnTaller > 1 ? 's' : ''} Asignado{stats.equiposEnTaller > 1 ? 's' : ''} en Mantenimiento
              </h3>
              <p style={{ color: '#78350f', margin: 0, fontSize: '0.9rem' }}>
                Hay equipos asignados a pedidos que actualmente están en Taller Entrada o Taller Espera. 
                Pueden retrasar la entrega a obra.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Métricas de proceso */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '1rem', color: '#1f2937' }}>
            Tasa de Aprobación
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#10b981' }}>
              {stats.porcentajeAprobacion}%
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ background: '#e5e7eb', height: '12px', borderRadius: '6px', overflow: 'hidden' }}>
                <div style={{
                  background: '#10b981',
                  height: '100%',
                  width: `${stats.porcentajeAprobacion}%`,
                  transition: 'width 0.5s'
                }} />
              </div>
              <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.5rem', margin: '0.5rem 0 0 0' }}>
                {stats.totalAprobados} aprobados de {stats.totalAprobados + stats.pendientesAprobacion + stats.totalRechazados} total
              </p>
            </div>
          </div>
        </div>

        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '1rem', color: '#1f2937' }}>
            Tasa de Entrega
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#3b82f6' }}>
              {stats.porcentajeEntregado}%
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ background: '#e5e7eb', height: '12px', borderRadius: '6px', overflow: 'hidden' }}>
                <div style={{
                  background: '#3b82f6',
                  height: '100%',
                  width: `${stats.porcentajeEntregado}%`,
                  transition: 'width 0.5s'
                }} />
              </div>
              <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.5rem', margin: '0.5rem 0 0 0' }}>
                De {stats.totalAprobados} aprobados
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Gráficos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '2rem', marginBottom: '2rem' }}>
        
        {/* Equipos por Obra */}
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1.5rem', color: '#1f2937' }}>
            📍 Equipos por Entregar - Por Obra
          </h2>
          
          {stats.porObra.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {stats.porObra.map((obra, index) => {
                const maxCantidad = Math.max(...stats.porObra.map(o => o.cantidad), 1)
                return (
                  <div key={index}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span style={{ fontWeight: '600', fontSize: '0.9rem', color: '#1f2937' }}>
                        {obra.codigo} - {obra.nombre}
                      </span>
                      <span style={{ color: '#6b7280', fontSize: '0.9rem', fontWeight: '600' }}>
                        {obra.cantidad} equipos
                      </span>
                    </div>
                    <div style={{
                      background: '#e5e7eb',
                      height: '24px',
                      borderRadius: '6px',
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        background: `hsl(${220 - index * 20}, 70%, 50%)`,
                        height: '100%',
                        width: `${(obra.cantidad / maxCantidad) * 100}%`,
                        transition: 'width 0.5s ease',
                        display: 'flex',
                        alignItems: 'center',
                        paddingLeft: '0.5rem',
                        color: 'white',
                        fontSize: '0.875rem',
                        fontWeight: '600'
                      }}>
                        {obra.cantidad}
                      </div>
                    </div>
                    <details style={{ marginTop: '0.5rem' }}>
                      <summary style={{ 
                        fontSize: '0.75rem', 
                        color: '#6b7280', 
                        cursor: 'pointer',
                        userSelect: 'none'
                      }}>
                        Ver detalle de pedidos
                      </summary>
                      <div style={{ 
                        marginTop: '0.5rem', 
                        padding: '0.5rem', 
                        background: '#f9fafb', 
                        borderRadius: '4px',
                        fontSize: '0.75rem'
                      }}>
                        {obra.pedidos.map((p, i) => (
                          <div key={i} style={{ marginBottom: '0.25rem', color: '#4b5563' }}>
                            • Pedido {p.numero}: {p.tipo} - {p.estado === 'asignado' ? '✅ Asignado' : '⏳ Sin asignar'}
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                )
              })}
            </div>
          ) : (
            <p style={{ color: '#6b7280', textAlign: 'center', padding: '2rem' }}>
              ✅ No hay equipos pendientes de entrega
            </p>
          )}
        </div>

        {/* Por Tipo de Equipo */}
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1.5rem', color: '#1f2937' }}>
            🚜 Equipos por Entregar - Por Tipo
          </h2>
          
          {stats.porTipo.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '500px', overflowY: 'auto' }}>
              {stats.porTipo.map((tipo, index) => {
                const maxCantidad = Math.max(...stats.porTipo.map(t => t.cantidad), 1)
                return (
                  <div key={index}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span style={{ fontWeight: '600', fontSize: '0.9rem', color: '#1f2937' }}>
                        {tipo.tipo}
                      </span>
                      <span style={{ color: '#6b7280', fontSize: '0.9rem', fontWeight: '600' }}>
                        {tipo.cantidad}
                      </span>
                    </div>
                    <div style={{
                      background: '#e5e7eb',
                      height: '24px',
                      borderRadius: '6px',
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        background: `hsl(${280 - index * 15}, 65%, 55%)`,
                        height: '100%',
                        width: `${(tipo.cantidad / maxCantidad) * 100}%`,
                        transition: 'width 0.5s ease',
                        display: 'flex',
                        alignItems: 'center',
                        paddingLeft: '0.5rem',
                        color: 'white',
                        fontSize: '0.875rem',
                        fontWeight: '600'
                      }}>
                        {tipo.cantidad}
                      </div>
                    </div>
                    <div style={{ 
                      fontSize: '0.75rem', 
                      color: '#6b7280', 
                      marginTop: '0.25rem',
                      display: 'flex',
                      gap: '1rem'
                    }}>
                      <span>⏳ Sin asignar: {tipo.pendientes_asignar}</span>
                      <span>✅ Asignados: {tipo.asignados}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p style={{ color: '#6b7280', textAlign: 'center', padding: '2rem' }}>
              ✅ No hay equipos pendientes de entrega
            </p>
          )}
        </div>

        {/* Estado de Entrega */}
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1.5rem', color: '#1f2937' }}>
            📦 Estado de Pedidos Aprobados
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {stats.porEstadoEntrega.map((estado, index) => (
              <div key={index}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <div>
                    <span style={{ fontWeight: '600', fontSize: '0.9rem', color: '#1f2937' }}>
                      {estado.estado}
                    </span>
                    <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: '0.25rem 0 0 0' }}>
                      {estado.descripcion}
                    </p>
                  </div>
                  <span style={{ color: '#6b7280', fontSize: '0.9rem', fontWeight: '600' }}>
                    {estado.equipos} equipos
                  </span>
                </div>
                <div style={{
                  background: '#e5e7eb',
                  height: '24px',
                  borderRadius: '6px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    background: estado.color,
                    height: '100%',
                    width: `${stats.totalAprobados > 0 ? (estado.cantidad / stats.totalAprobados) * 100 : 0}%`,
                    transition: 'width 0.5s ease',
                    display: 'flex',
                    alignItems: 'center',
                    paddingLeft: '0.5rem',
                    color: 'white',
                    fontSize: '0.875rem',
                    fontWeight: '600'
                  }}>
                    {estado.cantidad > 0 && `${estado.cantidad} pedidos`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* NUEVO: Estado Operativo de Equipos Asignados */}
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1.5rem', color: '#1f2937' }}>
            🔧 Estado Operativo - Equipos Asignados
          </h2>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem', margin: '0 0 1rem 0' }}>
            Estado operativo de los {stats.equiposAsignados} equipos asignados listos para envío
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {stats.porEstadoOperativo.map((estado, index) => (
              <div key={index}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <div>
                    <span style={{ fontWeight: '600', fontSize: '0.9rem', color: '#1f2937' }}>
                      {estado.icon} {estado.estado}
                    </span>
                    <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: '0.25rem 0 0 0' }}>
                      {estado.descripcion}
                    </p>
                  </div>
                  <span style={{ color: '#6b7280', fontSize: '0.9rem', fontWeight: '600' }}>
                    {estado.cantidad} equipos
                  </span>
                </div>
                <div style={{
                  background: '#e5e7eb',
                  height: '24px',
                  borderRadius: '6px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    background: estado.color,
                    height: '100%',
                    width: `${stats.equiposAsignados > 0 ? (estado.cantidad / stats.equiposAsignados) * 100 : 0}%`,
                    transition: 'width 0.5s ease',
                    display: 'flex',
                    alignItems: 'center',
                    paddingLeft: '0.5rem',
                    color: 'white',
                    fontSize: '0.875rem',
                    fontWeight: '600'
                  }}>
                    {estado.cantidad > 0 && `${estado.cantidad}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* NUEVO: Equipos en Mantenimiento */}
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1.5rem', color: '#1f2937' }}>
            🔧 Equipos en Mantenimiento
          </h2>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem', margin: '0 0 1rem 0' }}>
            Equipos asignados que están en Taller Entrada o Taller Espera
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {stats.porEstadoMantenimiento.map((estado, index) => (
              <div key={index}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <div>
                    <span style={{ fontWeight: '600', fontSize: '0.9rem', color: '#1f2937' }}>
                      {estado.icon} {estado.estado}
                    </span>
                    <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: '0.25rem 0 0 0' }}>
                      {estado.descripcion}
                    </p>
                  </div>
                  <span style={{ color: '#6b7280', fontSize: '0.9rem', fontWeight: '600' }}>
                    {estado.cantidad} equipos
                  </span>
                </div>
                <div style={{
                  background: '#e5e7eb',
                  height: '24px',
                  borderRadius: '6px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    background: estado.color,
                    height: '100%',
                    width: `${stats.equiposAsignados > 0 ? (estado.cantidad / stats.equiposAsignados) * 100 : 0}%`,
                    transition: 'width 0.5s ease',
                    display: 'flex',
                    alignItems: 'center',
                    paddingLeft: '0.5rem',
                    color: 'white',
                    fontSize: '0.875rem',
                    fontWeight: '600'
                  }}>
                    {estado.cantidad > 0 && `${estado.cantidad}`}
                  </div>
                </div>
                
                {/* Detalle de equipos en taller */}
                {estado.estado === 'En Taller' && estado.equipos && estado.equipos.length > 0 && (
                  <details style={{ marginTop: '0.5rem' }}>
                    <summary style={{ 
                      fontSize: '0.75rem', 
                      color: '#6b7280', 
                      cursor: 'pointer',
                      userSelect: 'none'
                    }}>
                      Ver equipos en taller
                    </summary>
                    <div style={{ 
                      marginTop: '0.5rem', 
                      padding: '0.5rem', 
                      background: '#fef3c7', 
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      border: '1px solid #f59e0b'
                    }}>
                      {estado.equipos.map((eq, i) => (
                        <div key={i} style={{ marginBottom: '0.25rem', color: '#92400e' }}>
                          🔧 <strong>{eq.codigo}</strong> - Pedido {eq.pedido} para {eq.obra}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default DashboardPedidosEquipos