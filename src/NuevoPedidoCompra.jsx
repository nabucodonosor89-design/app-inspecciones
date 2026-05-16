import { useState } from 'react'
import { supabase } from './lib/supabase'
import { toast } from './utils/ui'

function NuevoPedidoCompra({ onVolver, usuario }) {
  const [items, setItems] = useState([
    {
      descripcion: '',
      especificaciones: '',
      unidad_medida: '',
      cantidad: '',
      fecha_lugar_entrega: '',
      observacion: ''
    }
  ])
  const [guardando, setGuardando] = useState(false)

  function agregarItem() {
    setItems([...items, {
      descripcion: '',
      especificaciones: '',
      unidad_medida: '',
      cantidad: '',
      fecha_lugar_entrega: '',
      observacion: ''
    }])
  }

  function eliminarItem(index) {
    const nuevosItems = items.filter((_, i) => i !== index)
    setItems(nuevosItems)
  }

  function actualizarItem(index, campo, valor) {
    const nuevosItems = [...items]
    nuevosItems[index][campo] = valor
    setItems(nuevosItems)
  }

  async function obtenerNumeroConsecutivo() {
    try {
      const añoActual = new Date().getFullYear()
      
      // Buscar el último pedido del año actual
      const { data, error } = await supabase
        .from('pedidos_compra')
        .select('numero_pedido')
        .like('numero_pedido', `%/${añoActual}`)
        .order('created_at', { ascending: false })
        .limit(1)

      if (error) throw error

      if (data && data.length > 0) {
        // Extraer el número del último pedido
        const ultimoNumero = parseInt(data[0].numero_pedido.split('/')[0])
        const siguienteNumero = (ultimoNumero + 1).toString().padStart(2, '0')
        return `${siguienteNumero}/${añoActual}`
      } else {
        // Primer pedido del año
        return `01/${añoActual}`
      }
    } catch (error) {
      console.error('Error obteniendo número consecutivo:', error)
      return `01/${new Date().getFullYear()}`
    }
  }

  async function guardarPedido() {
    try {
      // Validar que haya al menos un item con descripción
      const itemsValidos = items.filter(item => item.descripcion.trim() !== '')
      
      if (itemsValidos.length === 0) {
        toast('⚠️ Debes agregar al menos un ítem con descripción')
        return
      }

      // Validar cantidades
      const itemsSinCantidad = itemsValidos.filter(item => !item.cantidad || item.cantidad <= 0)
      if (itemsSinCantidad.length > 0) {
        toast('⚠️ Todos los ítems deben tener una cantidad mayor a 0')
        return
      }

      setGuardando(true)

      // Obtener número consecutivo
      const numeroPedido = await obtenerNumeroConsecutivo()

      // Crear el pedido
      const { data: pedido, error: errorPedido } = await supabase
        .from('pedidos_compra')
        .insert([{
          numero_pedido: numeroPedido,
          usuario_id: usuario.id,
          solicitado_por: usuario.nombre_completo,
          estado: 'en_proceso'
        }])
        .select()
        .single()

      if (errorPedido) throw errorPedido

      // Insertar los items con numeración
      const itemsConNumero = itemsValidos.map((item, index) => ({
        pedido_id: pedido.id,
        item_numero: index + 1,
        descripcion: item.descripcion,
        especificaciones: item.especificaciones || null,
        unidad_medida: item.unidad_medida || null,
        cantidad: parseFloat(item.cantidad),
        fecha_lugar_entrega: item.fecha_lugar_entrega || null,
        observacion: item.observacion || null
      }))

      const { error: errorItems } = await supabase
        .from('pedido_items')
        .insert(itemsConNumero)

      if (errorItems) throw errorItems

      toast(`✅ Pedido creado exitosamente!\nNúmero: ${numeroPedido}`)
      onVolver()

    } catch (error) {
      console.error('Error:', error)
      toast('❌ Error al guardar pedido: ' + error.message)
    } finally {
      setGuardando(false)
    }
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
            <h1 style={{ fontSize: '1.8rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
              🛒 Nueva Solicitud de Compra
            </h1>
            <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>
              Obra/Área Solicitante: <strong>TYE</strong>
            </p>
            <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>
              Solicitado por: <strong>{usuario.nombre_completo}</strong>
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

      {/* Items del pedido */}
      <div style={{
        background: 'white',
        padding: '1.5rem',
        borderRadius: '12px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        marginBottom: '2rem'
      }}>
        <h2 style={{ fontSize: '1.3rem', fontWeight: '600', marginBottom: '1.5rem' }}>
          📦 Ítems del Pedido
        </h2>

        {items.map((item, index) => (
          <div
            key={index}
            style={{
              background: '#f9fafb',
              padding: '1.5rem',
              borderRadius: '8px',
              marginBottom: '1.5rem',
              border: '2px solid #e5e7eb'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '600', color: '#667eea' }}>
                Ítem N° {index + 1}
              </h3>
              {items.length > 1 && (
                <button
                  onClick={() => eliminarItem(index)}
                  style={{
                    padding: '0.5rem 1rem',
                    background: '#ef4444',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    fontWeight: '600'
                  }}
                >
                  🗑️ Eliminar
                </button>
              )}
            </div>

            <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
                  Descripción del Material/Servicio *
                </label>
                <input
                  type="text"
                  value={item.descripcion}
                  onChange={(e) => actualizarItem(index, 'descripcion', e.target.value)}
                  placeholder="Ej: Cemento Portland"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '1rem'
                  }}
                />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
                  Especificaciones Técnicas
                </label>
                <textarea
                  value={item.especificaciones}
                  onChange={(e) => actualizarItem(index, 'especificaciones', e.target.value)}
                  placeholder="Ej: Bolsas de 50kg, marca específica..."
                  rows="2"
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

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
                  Unidad de Medida
                </label>
                <input
                  type="text"
                  value={item.unidad_medida}
                  onChange={(e) => actualizarItem(index, 'unidad_medida', e.target.value)}
                  placeholder="Ej: Unidad, kg, m, etc."
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
                  Cantidad *
                </label>
                <input
                  type="number"
                  value={item.cantidad}
                  onChange={(e) => actualizarItem(index, 'cantidad', e.target.value)}
                  placeholder="Ej: 10"
                  min="0"
                  step="0.01"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '1rem'
                  }}
                />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
                  Fecha y Lugar de Entrega
                </label>
                <input
                  type="text"
                  value={item.fecha_lugar_entrega}
                  onChange={(e) => actualizarItem(index, 'fecha_lugar_entrega', e.target.value)}
                  placeholder="Ej: 30/12/2025 - Obra San Pedro"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '1rem'
                  }}
                />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
                  Observación / V°B° Técnico
                </label>
                <textarea
                  value={item.observacion}
                  onChange={(e) => actualizarItem(index, 'observacion', e.target.value)}
                  placeholder="Observaciones adicionales..."
                  rows="2"
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
          </div>
        ))}

        <button
          onClick={agregarItem}
          style={{
            padding: '0.75rem 1.5rem',
            background: '#667eea',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: '1rem',
            width: '100%'
          }}
        >
          ➕ Agregar Otro Ítem
        </button>
      </div>

      {/* Botones de acción */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <button
          onClick={guardarPedido}
          disabled={guardando}
          style={{
            flex: 1,
            minWidth: '200px',
            padding: '1rem 2rem',
            background: guardando ? '#9ca3af' : '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: guardando ? 'not-allowed' : 'pointer',
            fontWeight: '600',
            fontSize: '1.1rem'
          }}
        >
          {guardando ? '⏳ Guardando...' : '💾 Guardar Pedido'}
        </button>

        <button
          onClick={onVolver}
          disabled={guardando}
          style={{
            flex: 1,
            minWidth: '200px',
            padding: '1rem 2rem',
            background: '#6b7280',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: guardando ? 'not-allowed' : 'pointer',
            fontWeight: '600',
            fontSize: '1.1rem'
          }}
        >
          ❌ Cancelar
        </button>
      </div>

      {/* Nota informativa */}
      <div style={{
        marginTop: '2rem',
        padding: '1rem',
        background: '#dbeafe',
        borderRadius: '8px',
        border: '2px solid #3b82f6'
      }}>
        <p style={{ fontSize: '0.9rem', color: '#1e40af', margin: 0 }}>
          ℹ️ <strong>Nota:</strong> El número de pedido se generará automáticamente al guardar (formato: ##/año)
        </p>
      </div>
    </div>
  )
}

export default NuevoPedidoCompra
