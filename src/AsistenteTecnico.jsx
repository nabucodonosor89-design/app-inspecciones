import { useState, useEffect, useRef } from 'react'
import { consultarAsistente, sincronizarManuales } from './utils/asistenteTecnicoService'

const COLOR = '#0ea5e9' // sky-500 — color distintivo del módulo

export default function AsistenteTecnico({ usuario, onVolver }) {
  const [mensajes, setMensajes] = useState([
    {
      id: 'bienvenida',
      role: 'assistant',
      content: 'Hola, soy el Asistente Técnico de T&C SA. Podés consultarme sobre procedimientos de mantenimiento, intervalos de service, componentes y especificaciones técnicas de los equipos de la flota.',
      fuentes: []
    }
  ])
  const [input, setInput] = useState('')
  const [cargando, setCargando] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  const [mensajeSinc, setMensajeSinc] = useState(null) // { tipo: 'ok'|'error', texto: string }

  const endRef = useRef(null)
  const inputRef = useRef(null)

  const esAdmin = usuario?.rol === 'admin'

  // Scroll automático al último mensaje
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensajes, cargando])

  async function handleEnviar() {
    const pregunta = input.trim()
    if (!pregunta || cargando) return

    const msgUsuario = { id: Date.now(), role: 'user', content: pregunta }
    const historialParaApi = mensajes
      .filter(m => m.id !== 'bienvenida')
      .map(m => ({ role: m.role, content: m.content }))

    setMensajes(prev => [...prev, msgUsuario])
    setInput('')
    setCargando(true)

    try {
      const data = await consultarAsistente(pregunta, historialParaApi)
      setMensajes(prev => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'assistant',
          content: data.respuesta,
          fuentes: data.fuentes || []
        }
      ])
    } catch {
      setMensajes(prev => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'assistant',
          content: 'El asistente no está disponible en este momento. Intentá más tarde.',
          fuentes: [],
          error: true
        }
      ])
    } finally {
      setCargando(false)
      inputRef.current?.focus()
    }
  }

  async function handleSincronizar() {
    const confirmar = window.confirm(
      '¿Sincronizar manuales desde Google Drive?\nEste proceso puede tardar varios minutos.'
    )
    if (!confirmar) return

    setSincronizando(true)
    setMensajeSinc(null)

    try {
      const data = await sincronizarManuales()
      setMensajeSinc({
        tipo: 'ok',
        texto: `✓ ${data.documentos_procesados ?? '?'} manuales sincronizados correctamente`
      })
    } catch {
      setMensajeSinc({ tipo: 'error', texto: 'Error al sincronizar. Verificá la conexión con n8n.' })
    } finally {
      setSincronizando(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleEnviar()
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(135deg, ${COLOR} 0%, #0284c7 100%)`,
      padding: 'clamp(1rem, 2vw, 2rem)',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* ── Header ── */}
      <div style={{
        background: 'white',
        padding: '1.25rem 1.5rem',
        borderRadius: '12px',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
        marginBottom: '1.25rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 'bold', margin: 0, color: '#0c4a6e' }}>
            🤖 Asistente Técnico
          </h1>
          <p style={{ color: '#6b7280', margin: '0.25rem 0 0', fontSize: '0.9rem' }}>
            Consultá manuales de equipos
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Botón sincronizar — solo administrador */}
          {esAdmin && (
            <button
              onClick={handleSincronizar}
              disabled={sincronizando}
              style={{
                padding: '0.65rem 1.25rem',
                background: sincronizando ? '#94a3b8' : COLOR,
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: sincronizando ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              {sincronizando ? (
                <>
                  <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span>
                  Sincronizando...
                </>
              ) : (
                '🔄 Sincronizar Manuales'
              )}
            </button>
          )}

          <button
            onClick={onVolver}
            style={{
              padding: '0.65rem 1.25rem',
              background: '#6b7280',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '0.9rem'
            }}
          >
            ← Menú Principal
          </button>
        </div>
      </div>

      {/* Mensaje de sincronización */}
      {mensajeSinc && (
        <div style={{
          background: mensajeSinc.tipo === 'ok' ? '#dcfce7' : '#fee2e2',
          color: mensajeSinc.tipo === 'ok' ? '#166534' : '#991b1b',
          padding: '0.75rem 1.25rem',
          borderRadius: '8px',
          marginBottom: '1rem',
          fontWeight: '500',
          fontSize: '0.9rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>{mensajeSinc.texto}</span>
          <button
            onClick={() => setMensajeSinc(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      )}

      {/* ── Área de chat ── */}
      <div style={{
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        overflow: 'hidden',
        minHeight: '500px'
      }}>
        {/* Mensajes */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem'
        }}>
          {mensajes.map(msg => (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start'
              }}
            >
              <div style={{ maxWidth: '75%' }}>
                {/* Burbuja */}
                <div style={{
                  padding: '0.875rem 1.125rem',
                  borderRadius: msg.role === 'user'
                    ? '18px 18px 4px 18px'
                    : '18px 18px 18px 4px',
                  background: msg.role === 'user'
                    ? COLOR
                    : msg.error ? '#fee2e2' : '#f1f5f9',
                  color: msg.role === 'user' ? 'white' : (msg.error ? '#991b1b' : '#1e293b'),
                  fontSize: '0.95rem',
                  lineHeight: '1.55',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}>
                  {msg.content}
                </div>

                {/* Fuentes */}
                {msg.fuentes && msg.fuentes.length > 0 && (
                  <div style={{ marginTop: '0.4rem', paddingLeft: '0.25rem' }}>
                    {msg.fuentes.map((f, i) => (
                      <p key={i} style={{
                        margin: '0.2rem 0',
                        fontSize: '0.78rem',
                        color: '#64748b'
                      }}>
                        📄 <em>{f.marca} {f.modelo}</em> — {f.tipo ? capitalize(f.tipo) : f.archivo}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Indicador "escribiendo..." */}
          {cargando && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{
                padding: '0.875rem 1.25rem',
                borderRadius: '18px 18px 18px 4px',
                background: '#f1f5f9',
                display: 'flex',
                gap: '5px',
                alignItems: 'center'
              }}>
                {[0, 1, 2].map(i => (
                  <span
                    key={i}
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: '#94a3b8',
                      display: 'inline-block',
                      animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <div ref={endRef} />
        </div>

        {/* ── Input ── */}
        <div style={{
          borderTop: '1px solid #e2e8f0',
          padding: '1rem 1.25rem',
          display: 'flex',
          gap: '0.75rem',
          alignItems: 'flex-end',
          background: '#f8fafc'
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribí tu consulta técnica… (Enter para enviar)"
            disabled={cargando}
            rows={1}
            style={{
              flex: 1,
              padding: '0.75rem 1rem',
              border: '1.5px solid #cbd5e1',
              borderRadius: '10px',
              fontSize: '0.95rem',
              resize: 'none',
              outline: 'none',
              fontFamily: 'inherit',
              lineHeight: '1.5',
              background: 'white',
              color: '#1e293b',
              maxHeight: '120px',
              overflowY: 'auto',
              transition: 'border-color 0.2s'
            }}
            onFocus={e => (e.target.style.borderColor = COLOR)}
            onBlur={e => (e.target.style.borderColor = '#cbd5e1')}
          />
          <button
            onClick={handleEnviar}
            disabled={cargando || !input.trim()}
            style={{
              padding: '0.75rem 1.25rem',
              background: cargando || !input.trim() ? '#94a3b8' : COLOR,
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              cursor: cargando || !input.trim() ? 'not-allowed' : 'pointer',
              fontWeight: '700',
              fontSize: '1rem',
              flexShrink: 0,
              transition: 'background 0.2s'
            }}
          >
            ➤
          </button>
        </div>
      </div>

      {/* Estilos de animación */}
      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

function capitalize(str) {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1)
}
