import { C, ddmm, ddmmhhmm, diasDesde } from './constantes'

// Atraso tolerado en días antes de marcar en ámbar
const TOL = { rastreo: 2, sap: 2, combustible: 2, partes: 8 }

function Item({ label, fecha, tol }) {
  const atraso = diasDesde(fecha)
  const viejo = atraso == null || atraso > tol
  return (
    <span style={{ color: viejo ? C.ambar : C.gris, fontWeight: viejo ? 700 : 400, whiteSpace: 'nowrap' }}
      title={viejo ? `Más de ${tol} días de atraso` : undefined}>
      {label} {ddmm(fecha)}
    </span>
  )
}

// Lee v_uso_frescura (cortes de cada fuente al último refresco)
export default function SelloFrescura({ f }) {
  if (!f) return null
  const sep = <span style={{ color: C.gris }}>·</span>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 6px', fontSize: 12 }}>
      <Item label="Rastreo al" fecha={f.corte_rastreo} tol={TOL.rastreo} />{sep}
      <Item label="partes al" fecha={f.corte_partes} tol={TOL.partes} />{sep}
      <Item label="SAP al" fecha={f.corte_sap} tol={TOL.sap} />{sep}
      <Item label="combustible al" fecha={f.corte_combustible} tol={TOL.combustible} />{sep}
      <span style={{ color: C.gris, whiteSpace: 'nowrap' }} title="Se recalcula solo todos los días a las 14:30">
        recalculado {ddmmhhmm(f.recalculado_at)}
      </span>
    </div>
  )
}
