const N8N_WEBHOOK_BASE = import.meta.env.VITE_N8N_WEBHOOK_URL

export const consultarAsistente = async (pregunta, historial) => {
  // Enviar máximo los últimos 10 mensajes del historial
  const historialReciente = historial.slice(-10)

  const response = await fetch(`${N8N_WEBHOOK_BASE}/consultar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pregunta, historial: historialReciente })
  })

  if (!response.ok) throw new Error('Error al consultar el asistente')
  return response.json()
}

export const sincronizarManuales = async () => {
  const response = await fetch(`${N8N_WEBHOOK_BASE}/vectorizar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  })

  if (!response.ok) throw new Error('Error al sincronizar manuales')
  return response.json()
}
