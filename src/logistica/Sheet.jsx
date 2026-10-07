import { useEsEscritorio } from './constantes'

/** Bottom sheet en celular, modal centrado en pantallas grandes. */
export default function Sheet({ titulo, subtitulo, onCerrar, children, pie }) {
  const escritorio = useEsEscritorio()
  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 2000,
        display: 'flex', alignItems: escritorio ? 'center' : 'flex-end', justifyContent: 'center',
      }}
    >
      <div style={{
        background: '#fff', width: '100%', maxWidth: escritorio ? '520px' : '100%',
        maxHeight: '92vh', display: 'flex', flexDirection: 'column',
        borderRadius: escritorio ? '16px' : '18px 18px 0 0',
        boxShadow: '0 -8px 30px rgba(0,0,0,0.2)',
      }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '17px', fontWeight: 800, color: '#111827' }}>{titulo}</div>
            {subtitulo && <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '2px' }}>{subtitulo}</div>}
          </div>
          <button onClick={onCerrar} aria-label="Cerrar"
            style={{ border: 'none', background: '#f3f4f6', borderRadius: '999px', width: '36px', height: '36px', fontSize: '18px', cursor: 'pointer', color: '#4b5563' }}>
            ✕
          </button>
        </div>
        <div style={{ padding: '16px', overflowY: 'auto', flex: 1 }}>{children}</div>
        {pie && (
          <div style={{ padding: '12px 16px calc(12px + env(safe-area-inset-bottom))', borderTop: '1px solid #f1f5f9', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {pie}
          </div>
        )}
      </div>
    </div>
  )
}
