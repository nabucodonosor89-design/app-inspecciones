import { useMemo } from 'react'
import { C, s, cant, obraTexto } from './constantes'

// Suma por unidad → "120 h · 3 viajes"
function sumaPorUnidad(mapa) {
  const partes = Object.entries(mapa).filter(([, q]) => q != null)
  if (!partes.length) return '—'
  return partes.map(([u, q]) => cant(q, u)).join(' · ')
}

function sumar(mapa, unidad, q) {
  mapa[unidad] = (mapa[unidad] || 0) + Number(q || 0)
}

// Totales del rango por obra (calculado en el cliente con las mismas filas del detalle)
export default function ResumenObras({ filas, escritorio }) {
  const { obras, gps } = useMemo(() => {
    const m = new Map()
    const gps = {}
    for (const f of filas) {
      if (f.fuente === 'gps') { sumar(gps, f.unidad, f.cantidad); continue }
      // El combustible trae el centro de la carga (OB34, CL01…), no el código de obra: va en su propia fila
      const clave = (f.fuente === 'combustible' ? 'c:' : 'o:') + (f.obra || '')
      if (!m.has(clave)) {
        m.set(clave, { clave, obra: f.obra, nombre: f.obra_nombre, esCentro: f.fuente === 'combustible', sap: {}, parte: {}, litros: null })
      }
      const o = m.get(clave)
      if (!o.nombre && f.obra_nombre) o.nombre = f.obra_nombre
      if (f.fuente === 'sap') sumar(o.sap, f.unidad, f.cantidad)
      if (f.fuente === 'parte') sumar(o.parte, f.unidad, f.cantidad)
      if (f.fuente === 'combustible') o.litros = (o.litros || 0) + Number(f.cantidad || 0)
    }
    const obras = [...m.values()].sort((a, b) => (a.esCentro - b.esCentro) || String(a.obra || '~').localeCompare(String(b.obra || '~')))
    return { obras, gps }
  }, [filas])

  const etiqueta = (o) => (o.esCentro ? `Centro de carga ${o.obra || 'sin centro'}` : obraTexto(o.obra, o.nombre))

  return (
    <div style={s.card}>
      <h3 style={s.subtitulo}>Resumen por obra</h3>
      {obras.length === 0 && !Object.keys(gps).length && <div style={s.vacio}>Sin registros en el rango</div>}

      {obras.length > 0 && (escritorio ? (
        <div style={s.scroll}>
          <table style={s.tabla}>
            <thead>
              <tr>
                <th style={s.th}>Obra</th>
                <th style={{ ...s.th, textAlign: 'right' }}>SAP</th>
                <th style={{ ...s.th, textAlign: 'right' }}>Parte</th>
                <th style={{ ...s.th, textAlign: 'right' }}>Combustible</th>
              </tr>
            </thead>
            <tbody>
              {obras.map((o) => (
                <tr key={o.clave}>
                  <td style={s.td}>{etiqueta(o)}</td>
                  <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>{sumaPorUnidad(o.sap)}</td>
                  <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>{sumaPorUnidad(o.parte)}</td>
                  <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>{o.litros == null ? '—' : cant(o.litros, 'l')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        obras.map((o) => (
          <div key={o.clave} style={{ padding: '8px 0', borderBottom: `1px solid ${C.borde}` }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{etiqueta(o)}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', fontSize: 14 }}>
              {!o.esCentro && <span><span style={{ color: C.gris }}>SAP</span> {sumaPorUnidad(o.sap)}</span>}
              {!o.esCentro && <span><span style={{ color: C.gris }}>Parte</span> {sumaPorUnidad(o.parte)}</span>}
              {o.litros != null && <span><span style={{ color: C.gris }}>Combustible</span> {cant(o.litros, 'l')}</span>}
            </div>
          </div>
        ))
      ))}

      <div style={{ marginTop: 8, fontSize: 14 }}>
        <span style={{ color: C.gris, fontWeight: 600 }}>GPS del rango (sin obra): </span>
        {Object.keys(gps).length ? sumaPorUnidad({ h: gps.h, km: gps.km }) : 'sin datos de GPS'}
      </div>
      {obras.some((o) => o.esCentro) && (
        <div style={{ ...s.meta, marginTop: 6 }}>
          El combustible viene con el centro de la carga de SAP (OB34, CL01…), que es otro código que el de la obra.
        </div>
      )}
    </div>
  )
}
