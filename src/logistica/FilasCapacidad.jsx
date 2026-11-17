import { useState } from 'react'
import { SIN_TIPO, camionesDeTipo, nombreCorto, ocupado, tiposPresentes } from './despacho'
import { fmtDiaCorto, hoyPY, tipoLabel } from './constantes'

const VERDE = { bg: '#dcfce7', fg: '#166534' }
const LLENO = { bg: '#fee2e2', fg: '#991b1b' }

/**
 * Filas de capacidad al pie de la grilla (modo Frente y modo Camión), alineadas con sus columnas.
 * - Camiones libres por día
 * - Una fila por tipo de camión presente (+ "Sin clasificar"): libres/total, o el destino si el tipo tiene un solo camión
 * Tocar una celda → lista de camiones libres de ese tipo ese día.
 */
export default function FilasCapacidad({ camiones, dias, ocup, encargos, anchoEtiqueta }) {
  const [popover, setPopover] = useState(null) // { fila, dia }
  const hoy = hoyPY()
  const tipos = tiposPresentes(camiones)

  // Destinos de un camión un día: "Ypané", "Villeta ×2"
  const destinosDe = (c, d) => {
    const items = ocup.get(`${c.id}|${d}`) || []
    const cuenta = {}
    items.forEach(a => {
      const n = nombreCorto(encargos[a.encargo_id]?.destino_nombre)
      cuenta[n] = (cuenta[n] || 0) + 1
    })
    return Object.entries(cuenta).map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join(', ')
  }

  const filas = [
    { id: 'todos', label: 'Camiones libres', lista: camiones, total: true },
    ...tipos.map(t => ({ id: t, label: t === SIN_TIPO ? 'Sin clasificar' : tipoLabel(t), lista: camionesDeTipo(camiones, t) })),
  ]

  const celda = (f, d) => {
    const libresTipo = f.lista.filter(c => !ocupado(ocup, c.id, d))
    const color = libresTipo.length ? VERDE : LLENO
    let texto
    if (f.total) texto = `${libresTipo.length}`
    else if (f.lista.length === 1) texto = libresTipo.length ? 'Libre' : destinosDe(f.lista[0], d)
    else texto = `${libresTipo.length}/${f.lista.length}`
    const abierto = popover?.fila === f.id && popover?.dia === d
    return (
      <td key={d} style={{ padding: '3px', borderLeft: '1px solid #f1f5f9', borderTop: '1px solid #f1f5f9', position: 'relative' }}>
        <button onClick={() => setPopover(abierto ? null : { fila: f.id, dia: d })}
          title={`${f.label} · ${fmtDiaCorto(d)}: ${libresTipo.length} libre(s) de ${f.lista.length}`}
          style={{ width: '100%', minHeight: '30px', border: 'none', borderRadius: '6px', cursor: 'pointer',
            background: color.bg, color: color.fg, fontSize: '12px', fontWeight: 700,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '4px 6px',
            outline: d === hoy ? '2px solid #bfdbfe' : 'none' }}>
          {texto}
        </button>
        {abierto && (
          <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: '4px',
            background: '#fff', border: '1px solid #d1d5db', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            padding: '10px 12px', minWidth: '180px', textAlign: 'left' }}>
            <div style={{ fontSize: '12px', fontWeight: 800, color: '#374151', marginBottom: '6px' }}>
              {f.label} libres · {fmtDiaCorto(d)}
            </div>
            {libresTipo.length === 0 && <div style={{ fontSize: '12px', color: '#6b7280' }}>Ninguno: todos tienen viaje ese día.</div>}
            {libresTipo.map(c => (
              <div key={c.id} style={{ fontSize: '13px', padding: '2px 0' }}>
                <strong>{c.numero_identificacion}</strong>
                {f.total && <span style={{ color: '#6b7280' }}> · {tipoLabel(c.tipo_camion)}</span>}
              </div>
            ))}
            <button onClick={() => setPopover(null)}
              style={{ marginTop: '6px', border: 'none', background: 'none', color: '#1d4ed8', fontSize: '12px', cursor: 'pointer', padding: 0 }}>Cerrar</button>
          </div>
        )}
      </td>
    )
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: '860px', borderTop: '2px solid #e5e7eb', background: '#fafafa' }}>
      <tbody>
        {filas.map(f => (
          <tr key={f.id}>
            <td style={{ width: `${anchoEtiqueta}px`, padding: '6px 12px', borderTop: '1px solid #f1f5f9', fontSize: '12px',
              fontWeight: f.total ? 800 : 700, color: f.total ? '#111827' : '#4338ca' }}>
              {f.label}
              {!f.total && <span style={{ color: '#9ca3af', fontWeight: 500 }}> · {f.lista.length}</span>}
            </td>
            {dias.map(d => celda(f, d))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
