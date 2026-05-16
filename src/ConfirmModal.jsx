import { useState, useEffect } from 'react'

function ConfirmModal() {
  const [pendiente, setPendiente] = useState(null)

  useEffect(() => {
    function handler({ detail }) {
      setPendiente(detail)
    }
    window.addEventListener('app:confirm', handler)
    return () => window.removeEventListener('app:confirm', handler)
  }, [])

  if (!pendiente) return null

  function responder(valor) {
    pendiente.resolve(valor)
    setPendiente(null)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem'
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '12px',
          padding: '2rem',
          maxWidth: '440px',
          width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
        }}
      >
        <p
          style={{
            fontSize: '1rem',
            color: '#1f2937',
            lineHeight: 1.6,
            margin: '0 0 1.5rem 0',
            whiteSpace: 'pre-wrap'
          }}
        >
          {pendiente.mensaje}
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
          <button
            onClick={() => responder(false)}
            style={{
              padding: '0.625rem 1.25rem',
              background: '#f3f4f6',
              color: '#374151',
              border: '2px solid #e5e7eb',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600'
            }}
          >
            Cancelar
          </button>
          <button
            onClick={() => responder(true)}
            style={{
              padding: '0.625rem 1.25rem',
              background: '#ef4444',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600'
            }}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmModal
