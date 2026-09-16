import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'
import { toast } from './utils/ui'
import FormularioPedidoLogistica from './FormularioPedidoLogistica'

const ESTADOS_CFG = {
  todos:      { label: 'Todos',       color: '#374151', bg: '#f3f4f6' },
  pendiente:  { label: 'Pendiente',   color: '#92400e', bg: '#fef3c7' },
  en_proceso: { label: 'En proceso',  color: '#1e40af', bg: '#dbeafe' },
  completado: { label: 'Completado',  color: '#166534', bg: '#bbf7d0' },
  cancelado:  { label: 'Cancelado',   color: '#6b7280', bg: '#f3f4f6' },
}

export default function ListaPedidosLogistica({ usuario, onVerFletes }) {
  const [pedidos, setPedidos] = useState([])
  const [progresos, setProgresos] = useState({})
  const [cargando, setCargando] = useState(true)
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [pedidoEditando, setPedidoEditando] = useState(null)

  const cargarPedidos = useCallback(async () => {
    setCargando(true)
    try {
      let query = supabase
        .from('pedidos_logistica')
        .select('*, obras(nombre_obra, codigo_obra)')
        .order('created_at', { ascending: false })

      if (filtroEstado !== 'todos') {
        query = query.eq('estado', filtroEstado)
      }

      const { data, error } = await query
      if (error) throw error
      setPedidos(data || [])

      // Load delivery progress for each pedido
      if (data && data.length > 0) {
        const ids = data.map(p => p.id)
        const { data: fletes, error: fError } = await supabase
          .from('fletes')
          .select('pedido_id, cantidad, estado')
          .in('pedido_id', ids)

        if (!fError && fletes) {
          const prog = {}
          data.forEach(p => {
            const pFletes = fletes.filter(f => f.pedido_id === p.id)
            const entregado = pFletes
              .filter(f => f.estado === 'entregado')
              .reduce((s, f) => s + Number(f.cantidad), 0)
            const enCamino = pFletes
              .filter(f => ['asignado', 'en_transito'].includes(f.estado))
              .reduce((s, f) => s + Number(f.cantidad), 0)
            prog[p.id] = { entregado, enCamino, total: Number(p.cantidad_total) }
          })
          setProgresos(prog)
        }
      }
    } catch (e) {
      toast.error('Error al cargar pedidos: ' + e.message)
    } finally {
      setCargando(false)
    }
  }, [filtroEstado])

  useEffect(() => {
    cargarPedidos()
  }, [cargarPedidos])

  const handleNuevo = () => {
    setPedidoEditando(null)
    setMostrarForm(true)
  }

  const handleEditar = (pedido) => {
    setPedidoEditando(pedido)
    setMostrarForm(true)
  }

  const handleGuardado = () => {
    setMostrarForm(false)
    setPedidoEditando(null)
    cargarPedidos()
  }

  const handleCancelarPedido = async (pedido) => {
    if (!confirm(`¿Cancelar el pedido de "${pedido.material}"?\nLos fletes en curso quedarán abiertos.`)) return
    try {
      const { error } = await supabase
        .from('pedidos_logistica')
        .update({ estado: 'cancelado', updated_at: new Date().toISOString() })
        .eq('id', pedido.id)
      if (error) throw error
      toast.success('Pedido cancelado')
      cargarPedidos()
    } catch (e) {
      toast.error('Error: ' + e.message)
    }
  }

  const getProgresoPct = (pedidoId) => {
    const p = progresos[pedidoId]
    if (!p || p.total === 0) return 0
    return Math.min(100, Math.round((p.entregado / p.total) * 100))
  }

  if (mostrarForm) {
    return (
      <FormularioPedidoLogistica
        pedido={pedidoEditando}
        usuario={usuario}
        onGuardado={handleGuardado}
        onCerrar={() => { setMostrarForm(false); setPedidoEditando(null) }}
      />
    )
  }

  return (
    <div style={{ padding: '24px', maxWidth: '960px', margin: '0 auto' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {Object.entries(ESTADOS_CFG).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => setFiltroEstado(key)}
              style={{
                padding: '6px 14px',
                borderRadius: '20px',
                border: filtroEstado === key ? `2px solid ${cfg.color}` : '2px solid transparent',
                fontSize: '13px',
                cursor: 'pointer',
                fontWeight: filtroEstado === key ? '700' : '400',
                background: filtroEstado === key ? cfg.bg : '#f3f4f6',
                color: filtroEstado === key ? cfg.color : '#6b7280',
              }}
            >
              {cfg.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleNuevo}
          style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}
        >
          + Nuevo pedido
        </button>
      </div>

      {/* List */}
      {cargando ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#6b7280' }}>Cargando...</div>
      ) : pedidos.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#9ca3af', background: '#f9fafb', borderRadius: '12px' }}>
          {filtroEstado !== 'todos'
            ? `No hay pedidos con estado "${ESTADOS_CFG[filtroEstado]?.label}".`
            : 'No hay pedidos. Creá el primero con el botón de arriba.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {pedidos.map(pedido => {
            const estCfg = ESTADOS_CFG[pedido.estado] || ESTADOS_CFG.pendiente
            const pct = getProgresoPct(pedido.id)
            const prog = progresos[pedido.id]
            const editable = ['pendiente', 'en_proceso'].includes(pedido.estado)
            const cancelable = ['pendiente', 'en_proceso'].includes(pedido.estado)

            return (
              <div key={pedido.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                      <span style={{ fontWeight: '700', fontSize: '15px', color: '#111827' }}>{pedido.material}</span>
                      <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '600', background: estCfg.bg, color: estCfg.color }}>
                        {estCfg.label}
                      </span>
                    </div>
                    <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>
                      📍 {pedido.origen} → <strong>{pedido.obras?.nombre_obra || '—'}</strong>
                      {pedido.obras?.codigo_obra ? ` (${pedido.obras.codigo_obra})` : ''}
                    </div>
                    <div style={{ fontSize: '13px', color: '#6b7280' }}>
                      Total: <strong>{pedido.cantidad_total} {pedido.unidad}</strong>
                      {prog && prog.entregado > 0 && (
                        <span style={{ marginLeft: '10px' }}>
                          ✅ Entregado: <strong>{prog.entregado.toFixed(3)} {pedido.unidad}</strong>
                        </span>
                      )}
                      {prog && prog.enCamino > 0 && (
                        <span style={{ marginLeft: '10px' }}>
                          🚛 En camino: <strong>{prog.enCamino.toFixed(3)} {pedido.unidad}</strong>
                        </span>
                      )}
                    </div>
                    {/* Progress bar */}
                    <div style={{ marginTop: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#9ca3af', marginBottom: '4px' }}>
                        <span>Entregado</span><span>{pct}%</span>
                      </div>
                      <div style={{ height: '6px', background: '#e5e7eb', borderRadius: '9999px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#22c55e' : '#3b82f6', borderRadius: '9999px' }} />
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0, alignItems: 'flex-start', flexDirection: 'column' }}>
                    <button
                      onClick={() => onVerFletes(pedido)}
                      style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: '6px', padding: '7px 14px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', width: '100%' }}
                    >
                      Ver fletes
                    </button>
                    {editable && (
                      <button
                        onClick={() => handleEditar(pedido)}
                        style={{ background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', padding: '7px 14px', fontSize: '13px', cursor: 'pointer', width: '100%' }}
                      >
                        Editar
                      </button>
                    )}
                    {cancelable && (
                      <button
                        onClick={() => handleCancelarPedido(pedido)}
                        style={{ background: '#fff', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '6px', padding: '7px 14px', fontSize: '13px', cursor: 'pointer', width: '100%' }}
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </div>

                {pedido.notas && (
                  <div style={{ marginTop: '10px', fontSize: '12px', color: '#9ca3af', borderTop: '1px solid #f3f4f6', paddingTop: '8px', fontStyle: 'italic' }}>
                    {pedido.notas}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
