import { useMemo } from 'react'
import { C, s, FUENTES, FUENTE_LABEL, cant, obraTexto, diaCorto, diasDelRango } from './constantes'

const SIN_CARGAR = 'sin cargar aún'

// Agrupa las filas de la RPC: { 'YYYY-MM-DD': { sap: [...], parte: [...], gps: [...], combustible: [...] } }
function agrupar(filas) {
  const m = {}
  for (const f of filas) {
    if (!m[f.fecha]) m[f.fecha] = {}
    if (!m[f.fecha][f.fuente]) m[f.fecha][f.fuente] = []
    m[f.fecha][f.fuente].push(f)
  }
  return m
}

// Lo que se ve en una fuente para un día
function Celda({ fuente, filas, sinCargar }) {
  if (!filas?.length) {
    return sinCargar
      ? <span style={{ color: C.gris, fontStyle: 'italic', fontSize: 13 }}>{SIN_CARGAR}</span>
      : <span style={{ color: C.gris }}>—</span>
  }
  if (fuente === 'gps') {
    // Una fila en h y otra en km: van juntas
    return <span style={{ whiteSpace: 'nowrap' }}>{[...filas].sort((a, b) => (a.unidad === 'h' ? -1 : 1) - (b.unidad === 'h' ? -1 : 1)).map((f) => cant(f.cantidad, f.unidad)).join(' · ')}</span>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {filas.map((f, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <span style={{ color: C.gris, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
            title={obraTexto(f.obra, f.obra_nombre)}>
            {fuente === 'combustible' ? (f.obra || 'sin centro') : obraTexto(f.obra, f.obra_nombre)}
          </span>
          <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{cant(f.cantidad, f.unidad)}</span>
        </div>
      ))}
    </div>
  )
}

// Todos los días del rango, del más nuevo al más viejo
export default function DetalleDias({ filas, desde, hasta, frescura, escritorio }) {
  const porDia = useMemo(() => agrupar(filas), [filas])
  const dias = useMemo(() => diasDelRango(desde, hasta), [desde, hasta])

  // Un día posterior a la última carga de una fuente se marca "sin cargar aún" (no "vacío")
  const sinCargar = (dia, fuente) => frescura && frescura[fuente] != null ? dia > frescura[fuente] : false

  if (escritorio) {
    return (
      <div style={s.card}>
        <h3 style={s.subtitulo}>Detalle por día</h3>
        <div style={s.scroll}>
          <table style={s.tabla}>
            <thead>
              <tr>
                <th style={{ ...s.th, width: 90 }}>Día</th>
                {FUENTES.map((f) => <th key={f} style={s.th}>{FUENTE_LABEL[f]}</th>)}
              </tr>
            </thead>
            <tbody>
              {dias.map((d) => {
                const reg = porDia[d]
                return (
                  <tr key={d} style={{ opacity: reg ? 1 : 0.55 }}>
                    <td style={{ ...s.td, whiteSpace: 'nowrap', fontWeight: reg ? 600 : 400 }}>{diaCorto(d)}</td>
                    {FUENTES.map((f) => (
                      <td key={f} style={{ ...s.td, minWidth: f === 'gps' ? 130 : 200 }}>
                        <Celda fuente={f} filas={reg?.[f]} sinCargar={sinCargar(d, f)} />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h3 style={{ ...s.subtitulo, margin: '4px 0 8px' }}>Detalle por día</h3>
      {dias.map((d) => {
        const reg = porDia[d]
        const pendientes = FUENTES.filter((f) => sinCargar(d, f))
        const mostrar = reg || pendientes.length > 0
        return (
          <div key={d} style={{ ...s.card, padding: 10, marginBottom: 8, opacity: reg ? 1 : 0.55 }}>
            <div style={{ fontWeight: 700, marginBottom: mostrar ? 6 : 0 }}>
              {diaCorto(d)}
              {!mostrar && <span style={{ color: C.gris, fontWeight: 400, marginLeft: 8 }}>—</span>}
            </div>
            {mostrar && FUENTES.map((f) => (
              <div key={f} style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 6, fontSize: 14, padding: '3px 0', borderTop: `1px solid ${C.borde}` }}>
                <span style={{ color: C.gris }}>{FUENTE_LABEL[f]}</span>
                <Celda fuente={f} filas={reg?.[f]} sinCargar={sinCargar(d, f)} />
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
