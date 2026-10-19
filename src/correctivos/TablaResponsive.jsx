import { useState, Fragment } from 'react'
import { s } from './constantes'
import { useEscritorio } from './useEscritorio'

/**
 * Tabla en escritorio, tarjetas en celular.
 * columnas: [{ key, label, render?(fila), tarjeta?: 'titulo' | 'oculta' }]
 * detalle?(fila): contenido expandible (opcional)
 * onFila?(fila): acción al tocar la fila (opcional; si no hay detalle)
 */
export default function TablaResponsive({ filas, columnas, getKey, detalle, onFila, vacio = 'Sin datos' }) {
  const escritorio = useEscritorio()
  const [abierto, setAbierto] = useState(null)

  if (!filas.length) return <div style={s.vacio}>{vacio}</div>

  const valor = (c, f) => (c.render ? c.render(f) : f[c.key] ?? '—')
  const toggle = (k, f) => (detalle ? setAbierto(abierto === k ? null : k) : onFila && onFila(f))
  const clicable = Boolean(detalle || onFila)

  if (escritorio) {
    return (
      <div style={s.scroll}>
        <table style={s.tabla}>
          <thead>
            <tr>{columnas.map((c) => <th key={c.key} style={s.th}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const k = getKey(f)
              return (
                <Fragment key={k}>
                  <tr onClick={() => toggle(k, f)} style={{ cursor: clicable ? 'pointer' : 'default' }}>
                    {columnas.map((c) => <td key={c.key} style={s.td}>{valor(c, f)}</td>)}
                  </tr>
                  {detalle && abierto === k && (
                    <tr><td colSpan={columnas.length} style={{ ...s.td, background: '#f9fafb' }}>{detalle(f)}</td></tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  const titulo = columnas.find((c) => c.tarjeta === 'titulo') || columnas[0]
  const resto = columnas.filter((c) => c !== titulo && c.tarjeta !== 'oculta')
  return (
    <div>
      {filas.map((f) => {
        const k = getKey(f)
        return (
          <div key={k} style={{ ...s.card, padding: 10, marginBottom: 8, cursor: clicable ? 'pointer' : 'default' }} onClick={() => toggle(k, f)}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{valor(titulo, f)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', fontSize: 14 }}>
              {resto.map((c) => (
                <Fragment key={c.key}>
                  <span style={s.meta}>{c.label}</span>
                  <span>{valor(c, f)}</span>
                </Fragment>
              ))}
            </div>
            {detalle && abierto === k && <div style={{ marginTop: 8, fontSize: 14 }}>{detalle(f)}</div>}
          </div>
        )
      })}
    </div>
  )
}
