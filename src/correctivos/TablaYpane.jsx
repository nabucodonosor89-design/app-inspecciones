import { useState } from 'react'
import { C, s, num, UMBRAL_URGENTE } from './constantes'
import TablaResponsive from './TablaResponsive'

const diasChip = (d) => {
  if (d == null) return '—'
  const [bg, fg] = d > UMBRAL_URGENTE ? [C.rojoBg, C.rojo] : d > 5 ? [C.ambarBg, C.ambar] : [C.verdeBg, C.verde]
  return <span style={s.chip(bg, fg)}>{num(d)} d</span>
}

const statusChip = (f) => {
  if (!f.status_sap) return <span style={s.chip(C.ambarBg, C.ambar)}>sin orden SAP</span>
  if (!f.orden_abierta) return <span style={s.chip(C.rojoBg, C.rojo)}>{f.status_sap} · cerrada</span>
  return f.status_sap
}

const columnas = [
  { key: 'equipo', label: 'Equipo', tarjeta: 'titulo',
    render: (f) => <span><strong>{f.equipo}</strong>{f.es_critico && <span style={{ ...s.chip(C.rojoBg, C.rojo), marginLeft: 6 }}>crítico</span>}<br /><span style={s.meta}>{f.denominacion}</span></span> },
  { key: 'dias_taller', label: 'Días', render: (f) => diasChip(f.dias_taller) },
  { key: 'estado_label', label: 'Estado' },
  { key: 'taller', label: 'Taller' },
  { key: 'numero_aviso', label: 'Aviso', render: (f) => f.numero_aviso || '—' },
  { key: 'orden', label: 'Orden', render: (f) => f.numero_orden || f.orden_cruzada || '—' },
  { key: 'status_sap', label: 'Status SAP', render: statusChip },
  { key: 'prioridad', label: 'Prioridad', render: (f) => f.prioridad || '—' },
  { key: 'pedido', label: 'Pedido', render: (f) => (f.pedido ? 'Sí' : 'No') },
]

export default function TablaYpane({ filas }) {
  const [taller, setTaller] = useState('todos') // 'todos' | 'Ypané' | 'Tercero'
  const n = (t) => (t === 'todos' ? filas.length : filas.filter((f) => f.taller_tipo === t).length)
  const vista = filas
    .filter((f) => taller === 'todos' || f.taller_tipo === taller)
    .sort((a, b) => (b.dias_taller ?? -1) - (a.dias_taller ?? -1))

  const terceros = Object.entries(
    filas.filter((f) => f.taller_tipo === 'Tercero').reduce((acc, f) => ((acc[f.taller] ||= []).push(f), acc), {})
  ).sort((a, b) => a[0].localeCompare(b[0]))

  return (
    <div>
      <div style={s.chips}>
        {[['todos', 'Todos'], ['Ypané', 'Ypané'], ['Tercero', 'Terceros']].map(([id, label]) => (
          <button key={id} style={s.chipBtn(taller === id)} onClick={() => setTaller(id)}>{label} · {n(id)}</button>
        ))}
      </div>

      <div style={s.card}>
        <div style={s.subtitulo}>Reparaciones en curso · {vista.length}</div>
        <TablaResponsive
          filas={vista}
          columnas={columnas}
          getKey={(f) => f.id}
          detalle={(f) => <div style={{ whiteSpace: 'pre-wrap' }}><strong>Avería:</strong> {f.descripcion_averia || 'Sin descripción'}</div>}
          vacio="No hay correctivos abiertos con estos filtros"
        />
      </div>

      {terceros.length > 0 && taller !== 'Ypané' && (
        <div style={s.card}>
          <div style={s.subtitulo}>En talleres terceros — para pedir el cierre</div>
          {terceros.map(([nombre, lista]) => (
            <div key={nombre} style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{nombre} · {lista.length}</div>
              <div style={s.scroll}>
                <table style={s.tabla}>
                  <thead><tr>{['Equipo', 'Orden', 'Status SAP', 'Días'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {lista.sort((a, b) => (b.dias_taller ?? 0) - (a.dias_taller ?? 0)).map((f) => (
                      <tr key={f.id}>
                        <td style={s.td}><strong>{f.equipo}</strong> <span style={s.meta}>{f.denominacion}</span></td>
                        <td style={s.td}>{f.numero_orden || f.orden_cruzada || '—'}</td>
                        <td style={s.td}>{statusChip(f)}</td>
                        <td style={s.td}>{diasChip(f.dias_taller)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
