/**
 * Utilidades de UI: reemplazos de alert() y confirm() nativos.
 * Los eventos son capturados por <Toast /> y <ConfirmModal /> montados en main.jsx.
 */

/**
 * Muestra una notificación toast no bloqueante.
 * @param {string} mensaje
 * @param {'success'|'error'|'warning'|'info'} [tipo] - Auto-detectado si se omite
 */
export function toast(mensaje, tipo) {
  const m = String(mensaje)
  if (!tipo) {
    if (m.includes('✅') || m.includes('correctamente') || m.includes('exitosamente')) tipo = 'success'
    else if (m.includes('❌') || /error/i.test(m)) tipo = 'error'
    else if (m.includes('⚠️') || m.includes('⚠')) tipo = 'warning'
    else tipo = 'info'
  }
  window.dispatchEvent(new CustomEvent('app:toast', { detail: { mensaje: m, tipo } }))
}

/**
 * Modal de confirmación no bloqueante (reemplaza confirm() nativo).
 * @param {string} mensaje
 * @returns {Promise<boolean>}
 */
export function confirmar(mensaje) {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent('app:confirm', { detail: { mensaje, resolve } }))
  })
}
