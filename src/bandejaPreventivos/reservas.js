import { toast } from '../utils/ui'

// ============================================================
// Reservas de la Bandeja de preventivos (v3): niveles, texto para pegar en SAP y copiar al portapapeles.
// RPC: ip30_reservas_resumen / ip30_reservas_orden / ip30_reservas_propuesta (supabase/bandeja_reservas.sql)
// ============================================================

export const NIVEL = {
  quiebre: { txt: 'quiebre', bg: '#fee2e2', fg: '#b91c1c' },
  riesgo: { txt: 'en riesgo', bg: '#fef3c7', fg: '#b45309' },
  ok: { txt: 'OK', bg: '#dcfce7', fg: '#15803d' },
}

// Cantidad como la acepta SAP (es-PY): coma decimal, sin separador de miles, enteros sin decimales.
export function cantidadSAP(v) {
  const n = Math.round(Number(v) * 1000) / 1000
  if (!Number.isFinite(n)) return ''
  return Number.isInteger(n) ? String(n) : String(n).replace('.', ',')
}

// Una línea por componente, columnas en el orden de la grilla Componentes de IW32:
// Componente ⇥ Descripción (vacía) ⇥ Ctd.neces. ⇥ UM ⇥ TP (L). La columna «Te…» no es editable y SAP la saltea al pegar
// (probado en IW32 el 28/11/2026). Almacén y centro los completa la encargada.
export function textoComponentes(filas) {
  return filas.map((f) => [f.material, '', cantidadSAP(f.cantidad), f.unidad || '', 'L'].join('\t')).join('\r\n')
}

export async function copiarTexto(texto, mensaje) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto)
    } else {
      const ta = document.createElement('textarea')
      ta.value = texto
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      if (!ok) throw new Error('execCommand')
    }
    toast(mensaje, 'exito')
  } catch {
    toast('No se pudo copiar al portapapeles', 'error')
  }
}
