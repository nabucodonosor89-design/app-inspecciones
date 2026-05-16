/**
 * Helpers compartidos para el semáforo de inspecciones.
 * Fuente única de verdad — importar desde aquí en todos los componentes.
 */

export function getSemaforoColor(semaforo) {
  if (semaforo === 'verde') return '#10b981'
  if (semaforo === 'amarillo') return '#f59e0b'
  if (semaforo === 'rojo') return '#ef4444'
  return '#9ca3af'
}

export function getSemaforoEmoji(semaforo) {
  if (semaforo === 'verde') return '🟢'
  if (semaforo === 'amarillo') return '🟡'
  if (semaforo === 'rojo') return '🔴'
  return '⚪'
}

export function getSemaforoTexto(semaforo) {
  if (semaforo === 'verde') return 'Equipo en buen estado'
  if (semaforo === 'amarillo') return 'Requiere atención'
  if (semaforo === 'rojo') return 'Requiere intervención urgente'
  return 'Sin datos'
}
