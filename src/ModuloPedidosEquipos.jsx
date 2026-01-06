import { useState } from 'react'
import ListaPedidosEquipos from './ListaPedidosEquipos.jsx'
import RegistrarPedidoModal from './RegistrarPedidoModal.jsx'

function ModuloPedidosEquipos({ usuario, onVolver }) {
  const [vista, setVista] = useState('lista') // 'lista', 'registrar'
  const [recargarLista, setRecargarLista] = useState(0)

  function handlePedidoRegistrado() {
    setVista('lista')
    setRecargarLista(prev => prev + 1) // Forzar recarga
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', padding: 'clamp(1rem, 2vw, 2rem)' }}>
      {/* Header */}
      <div style={{
        background: 'white',
        padding: '1.5rem',
        borderRadius: '12px',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
        marginBottom: '2rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
              📋 Pedidos de Equipos
            </h1>
            <p style={{ color: '#6b7280', margin: 0 }}>
              Usuario: <strong>{usuario.nombre_completo}</strong>
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
            ← Menú Principal
          </button>
        </div>
      </div>

      {/* Contenido */}
      {vista === 'lista' && (
        <ListaPedidosEquipos
          onNuevo={() => setVista('registrar')}
          usuario={usuario}
          recargarKey={recargarLista}
        />
      )}

      {vista === 'registrar' && (
        <RegistrarPedidoModal
          onCerrar={() => setVista('lista')}
          onGuardado={handlePedidoRegistrado}
          usuario={usuario}
        />
      )}
    </div>
  )
}

export default ModuloPedidosEquipos