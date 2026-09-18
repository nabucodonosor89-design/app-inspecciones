import { useState } from 'react'
import ListaPedidosLogistica from './ListaPedidosLogistica'
import GestionFletes from './GestionFletes'
import CalendarioLogistica from './CalendarioLogistica'

export default function ModuloLogistica({ usuario, onVolver }) {
  const [vista, setVista] = useState('pedidos') // 'pedidos' | 'gestionar' | 'calendario'
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState(null)

  const handleVerFletes = (pedido) => {
    setPedidoSeleccionado(pedido)
    setVista('gestionar')
  }

  const handleVolverALista = () => {
    setPedidoSeleccionado(null)
    setVista('pedidos')
  }

  const enDetalle = vista === 'gestionar' && pedidoSeleccionado

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb' }}>
      {/* Header */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}>
        <button
          onClick={enDetalle ? handleVolverALista : onVolver}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '22px', lineHeight: 1, padding: '0 4px' }}
          title="Volver"
        >
          ←
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: '#111827' }}>
            🚛 Logística
          </h1>
          <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>
            {enDetalle
              ? `Fletes · ${pedidoSeleccionado.material}`
              : vista === 'calendario'
              ? 'Disponibilidad semanal de camiones'
              : 'Gestión de fletes y movimiento de materiales'}
          </p>
        </div>

        {/* Tabs — solo visibles fuera del detalle */}
        {!enDetalle && (
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={() => setVista('pedidos')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: vista === 'pedidos' ? '2px solid #1d4ed8' : '1px solid #d1d5db',
                background: vista === 'pedidos' ? '#eff6ff' : '#f9fafb',
                color: vista === 'pedidos' ? '#1d4ed8' : '#374151',
                fontSize: '13px',
                fontWeight: vista === 'pedidos' ? '700' : '400',
                cursor: 'pointer',
              }}
            >
              📦 Pedidos
            </button>
            <button
              onClick={() => setVista('calendario')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: vista === 'calendario' ? '2px solid #1d4ed8' : '1px solid #d1d5db',
                background: vista === 'calendario' ? '#eff6ff' : '#f9fafb',
                color: vista === 'calendario' ? '#1d4ed8' : '#374151',
                fontSize: '13px',
                fontWeight: vista === 'calendario' ? '700' : '400',
                cursor: 'pointer',
              }}
            >
              📅 Calendario
            </button>
          </div>
        )}
      </div>

      {/* Contenido */}
      {vista === 'pedidos' && (
        <ListaPedidosLogistica
          usuario={usuario}
          onVerFletes={handleVerFletes}
        />
      )}
      {vista === 'gestionar' && pedidoSeleccionado && (
        <GestionFletes
          pedidoId={pedidoSeleccionado.id}
          usuario={usuario}
          onVolver={handleVolverALista}
        />
      )}
      {vista === 'calendario' && (
        <CalendarioLogistica
          onVolver={() => setVista('pedidos')}
        />
      )}
    </div>
  )
}
