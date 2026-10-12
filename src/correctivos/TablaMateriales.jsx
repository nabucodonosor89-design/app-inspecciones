import { useState } from 'react'
import { s, num, SITUACION } from './constantes'
import TablaResponsive from './TablaResponsive'

export default function TablaMateriales({ filas }) {
  const [origen, setOrigen] = useState('todos') // 'todos' | 'App' | 'Solo SAP'
  const n = (o) => (o === 'todos' ? filas.length : filas.filter((f) => f.origen === o).length)
  const vista = filas.filter((f) => origen === 'todos' || f.origen === origen)

  const columnas = (sit) => [
    { key: 'material', label: 'Material', tarjeta: 'titulo',
      render: (f) => <span><strong>{f.descripcion || f.material}</strong><br /><span style={s.meta}>{f.material}</span></span> },
    { key: 'equipo', label: 'Equipo', render: (f) => f.equipo || '(sin código)' },
    { key: 'orden', label: 'Orden' },
    { key: 'origen', label: 'Origen' },
    { key: 'taller_o_ubicacion', label: 'Taller / ubicación' },
    { key: 'dias', label: 'Días', render: (f) => num(f.dias) },
    { key: 'cantidad_pendiente', label: 'Pendiente', render: (f) => `${num(f.cantidad_pendiente)} ${f.unidad || ''}` },
    { key: 'stock_centro', label: 'Stock centro', render: (f) => `${num(f.stock_centro ?? 0)} (${f.centro})` },
    ...(sit === 'parcial' ? [
      { key: 'cantidad_cubierta', label: 'Cubierto', render: (f) => num(f.cantidad_cubierta) },
      { key: 'cantidad_faltante', label: 'Falta comprar', render: (f) => <strong>{num(f.cantidad_faltante)}</strong> },
    ] : []),
  ]

  const ordenar = (a, b) => (b.es_critico - a.es_critico) || ((b.dias ?? 0) - (a.dias ?? 0))

  return (
    <div>
      <div style={s.chips}>
        {[['todos', 'Todas'], ['App', 'App'], ['Solo SAP', 'Solo SAP']].map(([id, label]) => (
          <button key={id} style={s.chipBtn(origen === id)} onClick={() => setOrigen(id)}>{label} · {n(id)}</button>
        ))}
      </div>
      <div style={{ ...s.meta, marginBottom: 8 }}>
        Si varias órdenes piden el mismo material, el stock se asigna primero a los equipos críticos y después a los de más días.
      </div>
      {['bloqueo', 'parcial', 'despacho'].map((sit) => {
        const lista = vista.filter((f) => f.situacion === sit).sort(ordenar)
        const def = SITUACION[sit]
        return (
          <div key={sit} style={{ ...s.card, borderLeft: `4px solid ${def.fg}` }}>
            <div style={{ ...s.subtitulo, color: def.fg }}>{def.label} · {lista.length}</div>
            <div style={{ ...s.meta, marginBottom: 6 }}>
              {sit === 'bloqueo' && 'Sin stock en el centro: la reparación no avanza hasta comprar.'}
              {sit === 'parcial' && 'Hay stock para una parte: despachar lo cubierto y comprar el faltante.'}
              {sit === 'despacho' && 'Hay stock en el centro: falta despachar al taller.'}
            </div>
            <TablaResponsive
              filas={lista}
              columnas={columnas(sit)}
              getKey={(f) => `${f.orden}-${f.posicion}`}
              vacio="Nada en esta situación"
            />
          </div>
        )
      })}
    </div>
  )
}
