import { useEffect, useState } from 'react'

// ── Fechas (siempre en hora de Paraguay) ─────────────────────────────────────
export function hoyPY() {
  // en-CA formatea como YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date())
}

export function sumarDias(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}

export function lunesDe(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = domingo
  return sumarDias(iso, dow === 0 ? -6 : 1 - dow)
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

export function fmtFecha(iso, { conDia = true } = {}) {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const base = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
  return conDia ? `${DIAS[dow]} ${base}` : base
}

export function fmtFechaRelativa(iso) {
  if (!iso) return 'Cuando se pueda'
  const hoy = hoyPY()
  if (iso === hoy) return 'Hoy'
  if (iso === sumarDias(hoy, 1)) return 'Mañana'
  if (iso === sumarDias(hoy, -1)) return 'Ayer'
  return fmtFecha(iso)
}

export function fmtFechaHora(ts) {
  if (!ts) return ''
  return new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(ts))
}

// ── Números ──────────────────────────────────────────────────────────────────
export function fmtNum(n) {
  if (n === null || n === undefined || n === '') return '—'
  return Number(n).toLocaleString('es-PY', { maximumFractionDigits: 3 })
}

export const UNIDADES = [
  { id: 'un', label: 'un' },
  { id: 'tn', label: 'tn' },
  { id: 'm3', label: 'm³' },
  { id: 'viajes', label: 'viajes' },
]
export const unidadLabel = (u) => UNIDADES.find(x => x.id === u)?.label || u || ''

// ── Estados ──────────────────────────────────────────────────────────────────
export const ESTADO_ASIG = {
  planificada: { label: 'Planificada', color: '#1e40af', bg: '#dbeafe' },
  entregada:   { label: 'Sin confirmar', color: '#92400e', bg: '#fef3c7' },
  confirmada:  { label: 'Confirmada', color: '#166534', bg: '#dcfce7' },
}

export const SECCIONES = [
  { id: 'atrasado',          label: 'Atrasados',          emoji: '🔴', color: '#b91c1c' },
  { id: 'hoy',               label: 'Para hoy',           emoji: '🟠', color: '#c2410c' },
  { id: 'sin_asignar',       label: 'Sin asignar',        emoji: '⏳', color: '#92400e' },
  { id: 'por_confirmar',     label: 'Por confirmar',      emoji: '📋', color: '#7c3aed' },
  { id: 'listo_para_cerrar', label: 'Listos para cerrar', emoji: '✅', color: '#166534' },
  { id: 'en_curso',          label: 'En curso',           emoji: '🚛', color: '#1e40af' },
]

/** Decide en qué sección de la bandeja va un encargo abierto (una sola). */
export function seccionDe(e, hoy) {
  if (e.subestado === 'atrasado') return 'atrasado'
  if (e.subestado === 'listo_para_cerrar') return 'listo_para_cerrar'
  if (e.n_entregadas > 0) return 'por_confirmar'
  if (e.fecha_requerida === hoy) return 'hoy'
  if (e.subestado === 'sin_asignar') return 'sin_asignar'
  return 'en_curso'
}

export const TIPO_LUGAR = {
  obra:      { label: 'Obra',      emoji: '🏗️' },
  base:      { label: 'Base',      emoji: '🏠' },
  proveedor: { label: 'Proveedor', emoji: '🏪' },
  otro:      { label: 'Otro',      emoji: '📍' },
}

// ── Encargos que todavía necesitan camión ────────────────────────────────────
/**
 * Un encargo abierto está "por agendar" cuando no tiene ninguna asignación planificada y:
 * - nunca se asignó, o
 * - tiene cantidad y lo entregado (confirmado + sin confirmar) todavía no la cubre.
 */
export function necesitaAgenda(e) {
  if (e.estado !== 'abierto' || e.subestado === 'listo_para_cerrar') return false
  if (e.n_planificadas > 0) return false
  if (e.n_asignaciones === 0) return true
  if (e.cantidad == null) return false
  return Number(e.cantidad_confirmada || 0) + Number(e.cantidad_sin_confirmar || 0) < Number(e.cantidad)
}

// ── Mensajes de error de Supabase → texto legible ────────────────────────────
export function msgError(error) {
  if (!error) return ''
  if (error.code === '23505') return 'Ese camión ya tiene este encargo asignado ese día'
  return error.message || String(error)
}

// ── Responsive ───────────────────────────────────────────────────────────────
export function useEsEscritorio() {
  const query = '(min-width: 900px)'
  const [es, setEs] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const h = () => setEs(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  return es
}

// ── Estilos compartidos ──────────────────────────────────────────────────────
export const AZUL = '#1d4ed8'

export const estilos = {
  btnPrimario: {
    minHeight: '44px', padding: '10px 18px', borderRadius: '10px', border: 'none',
    background: AZUL, color: '#fff', fontSize: '15px', fontWeight: 700, cursor: 'pointer',
  },
  btnSecundario: {
    minHeight: '44px', padding: '10px 18px', borderRadius: '10px', border: '1px solid #d1d5db',
    background: '#fff', color: '#374151', fontSize: '15px', fontWeight: 600, cursor: 'pointer',
  },
  btnPeligro: {
    minHeight: '44px', padding: '10px 18px', borderRadius: '10px', border: '1px solid #fecaca',
    background: '#fff', color: '#b91c1c', fontSize: '15px', fontWeight: 600, cursor: 'pointer',
  },
  btnChico: {
    minHeight: '36px', padding: '6px 12px', borderRadius: '8px', border: 'none',
    background: AZUL, color: '#fff', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
  },
  input: {
    width: '100%', minHeight: '44px', padding: '10px 12px', borderRadius: '10px',
    border: '1px solid #d1d5db', fontSize: '16px', boxSizing: 'border-box', background: '#fff',
  },
  label: { display: 'block', fontSize: '13px', fontWeight: 700, color: '#374151', marginBottom: '6px' },
  card: {
    background: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb',
    padding: '14px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  },
  chip: (activo) => ({
    minHeight: '40px', padding: '8px 14px', borderRadius: '999px', cursor: 'pointer',
    border: activo ? `2px solid ${AZUL}` : '1px solid #d1d5db',
    background: activo ? '#eff6ff' : '#fff', color: activo ? AZUL : '#374151',
    fontSize: '14px', fontWeight: activo ? 700 : 500,
  }),
}
