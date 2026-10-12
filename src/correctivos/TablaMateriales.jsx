import { useState } from 'react'
import { C, s, num, SITUACION } from './constantes'
import { exportarMateriales } from './exportarMateriales'

const TEXTO_SIT = {
  bloqueo: 'Sin stock en el centro: la reparación no avanza hasta comprar.',
  parcial: 'Hay stock para una parte: despachar lo cubierto y comprar el faltante.',
  despacho: 'Hay stock en el centro: falta despachar al taller.',
}

// Agrupa las líneas por orden (una orden puede aparecer en más de una situación)
function agruparPorOrden(lineas) {
  const m = new Map()
  lineas.forEach((f) => {
    if (!m.has(f.orden)) m.set(f.orden, { ...f, lineas: [] })
    m.get(f.orden).lineas.push(f)
  })
  return [...m.values()].sort((a, b) => (b.es_critico - a.es_critico) || ((b.dias ?? 0) - (a.dias ?? 0)))
}

function Orden({ g, sit, abierta, onToggle }) {
  const parcial = sit === 'parcial'
  return (
    <div style={{ borderBottom: `1px solid ${C.borde}` }}>
      <div onClick={onToggle} style={{ padding: '10px 0', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <span style={{ color: C.gris, width: 14 }}>{abierta ? '▾' : '▸'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', alignItems: 'baseline' }}>
            <strong>{g.equipo || '(sin código)'}</strong>
            {g.es_critico && <span style={s.chip(C.rojoBg, C.rojo)}>crítico</span>}
            <span>Orden {g.orden}</span>
            <span style={s.meta}>· {g.origen} · {g.taller_o_ubicacion} · {num(g.dias)} días</span>
          </div>
          <div style={{ ...s.meta, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {g.texto_orden || g.denominacion || ''}
          </div>
        </div>
        <span style={s.chip(C.fondo, C.texto)}>{g.lineas.length} {g.lineas.length === 1 ? 'línea' : 'líneas'}</span>
      </div>
      {abierta && (
        <div style={{ ...s.scroll, paddingBottom: 10, paddingLeft: 22 }}>
          <table style={s.tabla}>
            <thead>
              <tr>
                {['Material', 'Pendiente', 'Stock centro', ...(parcial ? ['Cubierto', 'A comprar'] : [])].map((h) => <th key={h} style={s.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {g.lineas.map((f) => (
                <tr key={`${f.orden}-${f.posicion}`}>
                  <td style={s.td}><strong>{f.descripcion || f.material}</strong><br /><span style={s.meta}>{f.material}</span></td>
                  <td style={s.td}>{num(f.cantidad_pendiente)} {f.unidad || ''}</td>
                  <td style={s.td}>{num(f.stock_centro ?? 0)} ({f.centro})</td>
                  {parcial && <td style={s.td}>{num(f.cantidad_cubierta)}</td>}
                  {parcial && <td style={s.td}><strong>{num(f.cantidad_faltante)}</strong></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function TablaMateriales({ filas }) {
  const [origen, setOrigen] = useState('todos') // 'todos' | 'App' | 'Solo SAP'
  const [abiertas, setAbiertas] = useState({}) // { 'sit|orden': bool }
  const n = (o) => (o === 'todos' ? filas.length : filas.filter((f) => f.origen === o).length)
  const vista = filas.filter((f) => origen === 'todos' || f.origen === origen)

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ ...s.chips, marginBottom: 0, flex: 1 }}>
          {[['todos', 'Todas'], ['App', 'App'], ['Solo SAP', 'Solo SAP']].map(([id, label]) => (
            <button key={id} style={s.chipBtn(origen === id)} onClick={() => setOrigen(id)}>{label} · {n(id)}</button>
          ))}
        </div>
        <button style={{ ...s.boton, color: C.azul, fontWeight: 600 }} disabled={!vista.length}
          onClick={() => exportarMateriales(vista)} title="Exporta lo que estás viendo (con filtros)">
          ⬇ Exportar Excel
        </button>
      </div>
      <div style={{ ...s.meta, marginBottom: 8 }}>
        Si varias órdenes piden el mismo material, el stock se asigna primero a los equipos críticos y después a los de más días.
        El Excel trae una hoja por material (para Depósito / Compras) y otra con el detalle por orden.
      </div>
      {['bloqueo', 'parcial', 'despacho'].map((sit) => {
        const grupos = agruparPorOrden(vista.filter((f) => f.situacion === sit))
        const lineas = grupos.reduce((t, g) => t + g.lineas.length, 0)
        const def = SITUACION[sit]
        const pocos = grupos.length <= 3
        return (
          <div key={sit} style={{ ...s.card, borderLeft: `4px solid ${def.fg}` }}>
            <div style={{ ...s.subtitulo, color: def.fg }}>
              {def.label} · {lineas} {lineas === 1 ? 'línea' : 'líneas'} en {grupos.length} {grupos.length === 1 ? 'orden' : 'órdenes'}
            </div>
            <div style={{ ...s.meta, marginBottom: 6 }}>{TEXTO_SIT[sit]}</div>
            {!grupos.length ? <div style={s.vacio}>Nada en esta situación</div> : grupos.map((g) => {
              const k = `${sit}|${g.orden}`
              const abierta = abiertas[k] ?? pocos
              return <Orden key={k} g={g} sit={sit} abierta={abierta} onToggle={() => setAbiertas({ ...abiertas, [k]: !abierta })} />
            })}
          </div>
        )
      })}
    </div>
  )
}
