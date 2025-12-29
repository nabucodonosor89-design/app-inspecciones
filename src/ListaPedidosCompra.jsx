import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import NuevoPedidoCompra from './NuevoPedidoCompra.jsx'
import { generarPDFPedidoCompra } from './utils/pdfPedidoCompra'

function ListaPedidosCompra({ usuario }) {
  const [pedidos, setPedidos] = useState([])
  const [loading, setLoading] = useState(true)
  const [vista, setVista] = useState('lista') // 'lista' o 'nuevo'
  const [pedidoEditando, setPedidoEditando] = useState(null)
  const [filtroEstado, setFiltroEstado] = useState('Todos')

  useEffect(() => {
    cargarPedidos()
  }, [])

  async function cargarPedidos() {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('pedidos_compra')
        .select(`
          *,
          pedido_items(*)
        `)
        .order('created_at', { ascending: false })

      if (error) throw error
      setPedidos(data || [])
    } catch (error) {
      console.error('Error:', error)
      alert('Error al cargar pedidos')
    } finally {
      setLoading(false)
    }
  }

  async function cambiarEstado(pedidoId, nuevoEstado) {
    try {
      const { error } = await supabase
        .from('pedidos_compra')
        .update({ estado: nuevoEstado })
        .eq('id', pedidoId)

      if (error) throw error

      alert(`✅ Estado actualizado a: ${getEstadoLabel(nuevoEstado)}`)
      cargarPedidos()
    } catch (error) {
      console.error('Error:', error)
      alert('❌ Error al cambiar estado')
    }
  }

  function getEstadoColor(estado) {
    const colores = {
      'en_proceso': { bg: '#fef3c7', text: '#92400e', emoji: '⏳' },
      'recibido': { bg: '#d1fae5', text: '#065f46', emoji: '✅' }
    }
    return colores[estado] || colores['en_proceso']
  }

  function getEstadoLabel(estado) {
    const labels = {
      'en_proceso': 'En Proceso',
      'recibido': 'Recibido'
    }
    return labels[estado] || estado
  }

  async function generarPDF(pedido) {
    try {
      if (!pedido.pedido_items || pedido.pedido_items.length === 0) {
        alert('❌ Este pedido no tiene ítems para generar PDF')
        return
      }

      await generarPDFPedidoCompra(pedido, pedido.pedido_items)
      
    } catch (error) {
      console.error('Error generando PDF:', error)
      alert('❌ Error al generar PDF: ' + error.message)
    }
  }

  // Filtrar pedidos
  const pedidosFiltrados = pedidos.filter(pedido => {
    if (filtroEstado === 'Todos') return true
    return pedido.estado === filtroEstado
  })

  // Si está en vista de nuevo pedido
  if (vista === 'nuevo') {
    return <NuevoPedidoCompra 
      usuario={usuario} 
      onVolver={() => {
        setVista('lista')
        cargarPedidos()
      }} 
    />
  }

  // Vista de edición de estado
  if (pedidoEditando) {
    const pedido = pedidos.find(p => p.id === pedidoEditando)
    
    return (
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: 'clamp(1rem, 2vw, 2rem)' }}>
        <div style={{
          background: 'white',
          padding: '2rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1.5rem' }}>
            📝 Cambiar Estado del Pedido
          </h2>

          <div style={{ marginBottom: '2rem' }}>
            <p style={{ color: '#6b7280', marginBottom: '0.5rem' }}>
              <strong>Pedido:</strong> {pedido.numero_pedido}
            </p>
            <p style={{ color: '#6b7280', marginBottom: '0.5rem' }}>
              <strong>Solicitado por:</strong> {pedido.solicitado_por}
            </p>
            <p style={{ color: '#6b7280' }}>
              <strong>Estado actual:</strong> {getEstadoLabel(pedido.estado)}
            </p>
          </div>

          <div style={{ marginBottom: '2rem' }}>
            <label style={{ display: 'block', marginBottom: '1rem', fontWeight: '600', fontSize: '1.1rem' }}>
              Seleccionar nuevo estado:
            </label>
            
            <div style={{ display: 'grid', gap: '1rem' }}>
              {['en_proceso', 'recibido'].map(estado => {
                const color = getEstadoColor(estado)
                return (
                  <button
                    key={estado}
                    onClick={() => {
                      cambiarEstado(pedido.id, estado)
                      setPedidoEditando(null)
                    }}
                    style={{
                      padding: '1rem',
                      background: color.bg,
                      color: color.text,
                      border: pedido.estado === estado ? `3px solid ${color.text}` : 'none',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: '1rem',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem'
                    }}
                  >
                    <span style={{ fontSize: '1.5rem' }}>{color.emoji}</span>
                    <span>{getEstadoLabel(estado)}</span>
                    {pedido.estado === estado && <span style={{ marginLeft: 'auto' }}>← Actual</span>}
                  </button>
                )
              })}
            </div>
          </div>

          <button
            onClick={() => setPedidoEditando(null)}
            style={{
              width: '100%',
              padding: '1rem',
              background: '#6b7280',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '1rem'
            }}
          >
            ❌ Cancelar
          </button>
        </div>
      </div>
    )
  }

  // Vista de lista
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
          <div>
            <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
              🛒 Pedidos de Compra
            </h1>
            <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>
              Total de pedidos: {pedidosFiltrados.length}
            </p>
          </div>
          <button
            onClick={() => setVista('nuevo')}
            style={{
              padding: '0.75rem 1.5rem',
              background: '#667eea',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '1rem',
              boxShadow: '0 2px 4px rgba(102, 126, 234, 0.3)'
            }}
          >
            ➕ Nuevo Pedido
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div style={{
        background: 'white',
        padding: '1.5rem',
        borderRadius: '12px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        marginBottom: '2rem'
      }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '1rem' }}>
          🔍 Filtrar por Estado
        </h3>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {['Todos', 'en_proceso', 'recibido'].map(estado => {
            const color = estado === 'Todos' ? 
              { bg: '#f3f4f6', text: '#4b5563' } : 
              getEstadoColor(estado)
            
            return (
              <button
                key={estado}
                onClick={() => setFiltroEstado(estado)}
                style={{
                  padding: '0.5rem 1rem',
                  background: filtroEstado === estado ? color.text : color.bg,
                  color: filtroEstado === estado ? 'white' : color.text,
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '0.875rem'
                }}
              >
                {estado === 'Todos' ? 'Todos' : `${getEstadoColor(estado).emoji} ${getEstadoLabel(estado)}`}
              </button>
            )
          })}
        </div>
      </div>

      {/* Lista de pedidos */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <p style={{ fontSize: '1.2rem', color: '#6b7280' }}>Cargando pedidos...</p>
        </div>
      ) : pedidosFiltrados.length === 0 ? (
        <div style={{
          background: 'white',
          padding: '3rem',
          borderRadius: '12px',
          textAlign: 'center',
          color: '#6b7280'
        }}>
          <p style={{ fontSize: '1.2rem' }}>
            {filtroEstado === 'Todos' 
              ? 'No hay pedidos registrados aún' 
              : `No hay pedidos en estado: ${getEstadoLabel(filtroEstado)}`
            }
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {pedidosFiltrados.map(pedido => {
            const color = getEstadoColor(pedido.estado)
            const totalItems = pedido.pedido_items?.length || 0
            
            return (
              <div
                key={pedido.id}
                style={{
                  background: 'white',
                  padding: '1.5rem',
                  borderRadius: '12px',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  border: '2px solid #e5e7eb'
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '1rem', alignItems: 'start' }}>
                  {/* Info del pedido */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                      <h3 style={{ fontSize: '1.3rem', fontWeight: '600', margin: 0 }}>
                        📋 Pedido #{pedido.numero_pedido}
                      </h3>
                      <span
                        style={{
                          padding: '0.25rem 0.75rem',
                          background: color.bg,
                          color: color.text,
                          borderRadius: '6px',
                          fontSize: '0.875rem',
                          fontWeight: '600'
                        }}
                      >
                        {color.emoji} {getEstadoLabel(pedido.estado)}
                      </span>
                    </div>

                    <div style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                      <p style={{ marginBottom: '0.25rem' }}>
                        <strong>Solicitado por:</strong> {pedido.solicitado_por}
                      </p>
                      <p style={{ marginBottom: '0.25rem' }}>
                        <strong>Fecha:</strong> {new Date(pedido.fecha_solicitud).toLocaleDateString('es-PY')}
                      </p>
                      <p style={{ marginBottom: '0.25rem' }}>
                        <strong>Ítems:</strong> {totalItems}
                      </p>
                      {pedido.autorizado_por && (
                        <p style={{ marginBottom: '0.25rem', color: '#10b981' }}>
                          <strong>Autorizado por:</strong> {pedido.autorizado_por} 
                          {' el '}{new Date(pedido.fecha_autorizacion).toLocaleDateString('es-PY')}
                        </p>
                      )}
                    </div>

                    {/* Preview de items */}
                    {pedido.pedido_items && pedido.pedido_items.length > 0 && (
                      <div style={{ marginTop: '1rem', padding: '1rem', background: '#f9fafb', borderRadius: '6px' }}>
                        <p style={{ fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.5rem' }}>
                          Primeros ítems:
                        </p>
                        {pedido.pedido_items.slice(0, 3).map((item, idx) => (
                          <p key={item.id} style={{ fontSize: '0.875rem', color: '#4b5563', marginBottom: '0.25rem' }}>
                            {item.item_numero}. {item.descripcion} - {item.cantidad} {item.unidad_medida}
                          </p>
                        ))}
                        {pedido.pedido_items.length > 3 && (
                          <p style={{ fontSize: '0.875rem', color: '#9ca3af', fontStyle: 'italic' }}>
                            ... y {pedido.pedido_items.length - 3} más
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Botones de acción */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '150px' }}>
                    <button
                      onClick={() => setPedidoEditando(pedido.id)}
                      style={{
                        padding: '0.75rem 1rem',
                        background: '#f59e0b',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: '600',
                        fontSize: '0.875rem',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      ✏️ Cambiar Estado
                    </button>
                    
                    <button
                      onClick={() => generarPDF(pedido)}
                      style={{
                        padding: '0.75rem 1rem',
                        background: '#ef4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: '600',
                        fontSize: '0.875rem',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      📄 Generar PDF
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default ListaPedidosCompra