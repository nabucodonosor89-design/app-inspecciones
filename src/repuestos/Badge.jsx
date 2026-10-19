import { s } from './constantes'

// Etiqueta de color para estados / lecturas: def = { label, fg, bg }
export default function Badge({ def, children }) {
  if (!def) return '—'
  return <span style={s.chip(def.bg, def.fg)}>{children ?? def.label}</span>
}
