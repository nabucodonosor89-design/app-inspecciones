// Constantes del módulo Correctivos

export const C = {
  azul: '#1d4ed8',
  fondo: '#f9fafb',
  borde: '#e5e7eb',
  gris: '#6b7280',
  texto: '#111827',
  rojo: '#b91c1c', rojoBg: '#fee2e2',
  ambar: '#b45309', ambarBg: '#fef3c7',
  verde: '#15803d', verdeBg: '#dcfce7',
  azulBg: '#dbeafe',
}

export const TIPOS = [
  { id: 'V', label: 'Vehículos' },
  { id: 'P', label: 'Pesados' },
  { id: 'M', label: 'Menores' },
  { id: 'B', label: 'Embarcaciones' },
  { id: 'S', label: 'Sin clasificar' },
]

export const UMBRAL_URGENTE = 10   // días
export const UMBRAL_OUTLIER = 60   // días (MTTR)
export const LIMITE = 2000         // filas por consulta

export const MOTIVOS = {
  orden_cerrada: {
    label: 'Orden cerrada en SAP',
    accion: 'La sincronización debería liberarlo. Si sigue acá, revisar que la sync haya corrido.',
  },
  sin_orden_ni_aviso: {
    label: 'Sin orden ni aviso',
    accion: 'Cargar el aviso SAP en la app o liberar el equipo si ya no está en taller.',
  },
  orden_no_encontrada: {
    label: 'Orden no encontrada en SAP',
    accion: 'Verificar el N° de orden (puede estar mal cargado o ser anterior al export de 12 meses).',
  },
  aviso_sin_orden: {
    label: 'Aviso sin orden en SAP',
    accion: 'Verificar en SAP si el aviso sigue abierto y pedir que se genere la orden.',
  },
}

export const SITUACION = {
  bloqueo: { label: 'Bloqueo real', fg: C.rojo, bg: C.rojoBg },
  parcial: { label: 'Cobertura parcial', fg: C.ambar, bg: C.ambarBg },
  despacho: { label: 'Despacho pendiente', fg: C.verde, bg: C.verdeBg },
}

export function hoyPY() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' })
}

export const num = (n) => (n == null ? '—' : Number(n).toLocaleString('es-PY'))

export function ddmm(fecha) {
  if (!fecha) return '—'
  const d = new Date(fecha)
  if (isNaN(d)) return '—'
  return d.toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', timeZone: 'America/Asuncion' })
}

export function ddmmhhmm(fecha) {
  if (!fecha) return '—'
  const d = new Date(fecha)
  if (isNaN(d)) return '—'
  return d.toLocaleString('es-PY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Asuncion' })
}

// Búsqueda libre: equipo / aviso / orden / texto
export function coincide(texto, ...campos) {
  if (!texto) return true
  const t = texto.toLowerCase()
  return campos.some((c) => c != null && String(c).toLowerCase().includes(t))
}

export const s = {
  wrap: { maxWidth: 1280, margin: '0 auto', padding: 12, color: C.texto },
  header: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  boton: { minHeight: 44, minWidth: 44, border: `1px solid ${C.borde}`, background: '#fff', borderRadius: 8, fontSize: 16, cursor: 'pointer', padding: '0 12px' },
  barra: { position: 'sticky', top: 0, zIndex: 5, background: '#fff', paddingTop: 8, paddingBottom: 4, borderBottom: `1px solid ${C.borde}`, marginBottom: 12 },
  tabs: { display: 'flex', gap: 6, marginBottom: 8, overflowX: 'auto' },
  tab: (on) => ({ flex: '1 0 auto', minHeight: 40, padding: '0 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 600,
    border: `1px solid ${on ? C.azul : C.borde}`, background: on ? C.azul : '#fff', color: on ? '#fff' : C.texto }),
  input: { width: '100%', minHeight: 40, padding: '6px 12px', fontSize: 16, border: `1px solid ${C.borde}`, borderRadius: 8, boxSizing: 'border-box' },
  chips: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  chipBtn: (on) => ({ minHeight: 34, padding: '2px 12px', borderRadius: 17, cursor: 'pointer', fontWeight: 600, fontSize: 13,
    border: `1px solid ${on ? C.azul : C.borde}`, background: on ? C.azul : '#fff', color: on ? '#fff' : C.texto }),
  chip: (bg, fg) => ({ display: 'inline-block', fontSize: 12, padding: '2px 8px', borderRadius: 12, background: bg, color: fg, fontWeight: 600, whiteSpace: 'nowrap' }),
  card: { background: '#fff', border: `1px solid ${C.borde}`, borderRadius: 10, padding: 12, marginBottom: 12 },
  subtitulo: { fontSize: 13, fontWeight: 700, color: C.gris, textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 0 8px' },
  scroll: { overflowX: 'auto', WebkitOverflowScrolling: 'touch' },
  tabla: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: { textAlign: 'left', padding: '6px 8px', background: C.fondo, color: C.gris, fontWeight: 600, borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' },
  td: { padding: '6px 8px', borderBottom: `1px solid ${C.borde}`, verticalAlign: 'top' },
  vacio: { padding: 20, textAlign: 'center', color: C.gris },
  meta: { fontSize: 13, color: C.gris },
  aviso: { background: C.ambarBg, color: C.ambar, borderRadius: 8, padding: '8px 12px', fontSize: 14, marginBottom: 12 },
}
