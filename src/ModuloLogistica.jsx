import { useState } from 'react'
import ListaPedidosLogistica from './ListaPedidosLogistica'
import GestionFletes from './GestionFletes'

export default function ModuloLogistica({ usuario, onVolver }) {
  const [vista, setVista] = useState('pedidos') // 'pedidos' | 'gestionar'
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState(null)

  const handleVerFletes = (pedido) => {
    setPedidoSeleccionado(pedido)
    setVista('gestionar')
  }

  const handleVolverALista = () => {
    setPedidoSeleccionado(null)
    setVista('pedidos')
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb' }}>
      {/* Module header */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}>
        <button
          onClick={vista === 'gestionar' ? handleVolverALista : onVolver}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '22px', lineHeight: 1, padding: '0 4px' }}
          title="Volver"
        >
          ←
        </button>
        <div>
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: '#111827' }}>
            🚛 Logística
          </h1>
          <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>
            {vista === 'gestionar' && pedidoSeleccionado
              ? `Fletes · ${pedidoSeleccionado.material}`
              : 'Gestión de fletes y movimiento de materiales'}
          </p>
        </div>
      </div>

      {/* Content */}
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
    </div>
  )
}
