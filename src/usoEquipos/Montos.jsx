import { C, s, gs, gsCorto, BLOQUES, ORDEN_BLOQUES } from './constantes'

/**
 * Los tres montos por bloque, siempre separados (nunca un neto ni un total general).
 * m: { sap_falta, sap_de_mas (negativo), rastreo }
 * variante: 'grande' (encabezados) | 'linea' (tarjetas, filas)
 * Los bloques en cero se omiten en la variante 'linea'.
 */
export default function Montos({ m, variante = 'linea' }) {
  if (variante === 'grande') {
    return (
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {ORDEN_BLOQUES.map((b) => (
          <div key={b} title={BLOQUES[b].ayuda + (m[b] ? ` · ${gs(m[b])}` : '')}>
            <div style={{ fontSize: b === 'rastreo' ? 18 : 22, fontWeight: 800, color: BLOQUES[b].fg }}>{gsCorto(m[b] || 0)}</div>
            <div style={s.meta}>{BLOQUES[b].label}</div>
          </div>
        ))}
      </div>
    )
  }
  const presentes = ORDEN_BLOQUES.filter((b) => m[b])
  if (!presentes.length) return <span style={{ color: C.gris }}>—</span>
  return (
    <span style={{ display: 'inline-flex', gap: '2px 10px', flexWrap: 'wrap' }}>
      {presentes.map((b) => (
        <span key={b} title={`${BLOQUES[b].label} · ${gs(m[b])}`} style={{ color: BLOQUES[b].fg, fontWeight: b === 'rastreo' ? 500 : 700, whiteSpace: 'nowrap' }}>
          {gsCorto(m[b])}{b === 'rastreo' && <span style={{ fontWeight: 400 }}> rastreo</span>}
        </span>
      ))}
    </span>
  )
}
