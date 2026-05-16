import { useState, useEffect, useCallback } from 'react'

const ESTILOS = {
  success: { bg: '#d1fae5', border: '#10b981', text: '#065f46' },
  error:   { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' },
  warning: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
  info:    { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
}

let _id = 0

function Toast() {
  const [toasts, setToasts] = useState([])

  const quitar = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  useEffect(() => {
    function handler({ detail: { mensaje, tipo = 'info' } }) {
      const id = ++_id
      setToasts(prev => [...prev, { id, mensaje, tipo }])
      setTimeout(() => quitar(id), 4500)
    }
    window.addEventListener('app:toast', handler)
    return () => window.removeEventListener('app:toast', handler)
  }, [quitar])

  if (toasts.length === 0) return null

  return (
    <div style={{
      position: 'fixed',
      bottom: '1.5rem',
      right: '1.5rem',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: '0.75rem',
      maxWidth: '400px',
      width: 'calc(100vw - 3rem)'
    }}>
      {toasts.map(({ id, mensaje, tipo }) => {
        const e = ESTILOS[tipo] || ESTILOS.info
        return (
          <div
            key={id}
            style={{
              background: e.bg,
              border: `2px solid ${e.border}`,
              color: e.text,
              borderRadius: '10px',
              padding: '0.875rem 1rem 0.875rem 1.25rem',
              boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.75rem',
              fontSize: '0.925rem',
              lineHeight: 1.5,
              fontWeight: '500'
            }}
          >
            <span style={{ flex: 1 }}>{mensaje}</span>
            <button
              onClick={() => quitar(id)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: e.text,
                fontSize: '1.25rem',
                lineHeight: 1,
                padding: 0,
                opacity: 0.6,
                flexShrink: 0
              }}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default Toast
