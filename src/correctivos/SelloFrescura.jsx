import { C, ddmm, ddmmhhmm } from './constantes'

const DOS_DIAS = 2 * 24 * 60 * 60 * 1000

function Item({ label, fecha, conHora, ahora }) {
  const viejo = !fecha || ahora - new Date(fecha).getTime() > DOS_DIAS
  return (
    <span style={{ color: viejo ? C.ambar : C.gris, fontWeight: viejo ? 700 : 400, whiteSpace: 'nowrap' }}
      title={viejo ? 'Más de 2 días sin actualizar' : undefined}>
      {label} {conHora ? ddmmhhmm(fecha) : ddmm(fecha)}
    </span>
  )
}

// Lee v_corr_frescura (la consulta la hace ModuloCorrectivos para refrescar todo junto)
export default function SelloFrescura({ f, ahora }) {
  if (!f) return null
  // stock: corte del día (a_fecha) → se compara contra el mediodía de ese día
  const corteStock = f.corte_stock_1002 ? `${f.corte_stock_1002}T12:00:00-03:00` : null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 6px', fontSize: 12 }}>
      <Item label="SAP al" ahora={ahora} fecha={f.trabajo} conHora />
      <span style={{ color: C.gris }}>·</span>
      <Item label="órdenes" ahora={ahora} fecha={f.trabajo} />
      <span style={{ color: C.gris }}>·</span>
      <Item label="reservas" ahora={ahora} fecha={f.reservas} />
      <span style={{ color: C.gris }}>·</span>
      <Item label="stock" ahora={ahora} fecha={corteStock} />
      <span style={{ color: C.gris }}>·</span>
      <Item label={f.ultima_sync_dry_run ? 'sync (prueba)' : 'sync'} ahora={ahora} fecha={f.ultima_sync} conHora />
    </div>
  )
}
