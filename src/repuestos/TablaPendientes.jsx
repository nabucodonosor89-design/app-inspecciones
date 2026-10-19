import { useMemo, useState } from 'react'
import TablaResponsive from '../correctivos/TablaResponsive'
import Badge from './Badge'
import { C, s, LECTURAS, LECTURA, num, ddmm } from './constantes'

// Mantenimientos (TCPV, 12 meses) con material reservado y nada consumido. Lee v_rep_mant_pendientes.
export default function TablaPendientes({ filas, onFamilia, diasTrabado }) {
  const [lecturas, setLecturas] = useState(['trabado'])
  const toggle = (id) => setLecturas((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const conteo = useMemo(() => {
    const m = {}
    filas.forEach((f) => { m[f.lectura] = (m[f.lectura] || 0) + 1 })
    return m
  }, [filas])

  const visibles = useMemo(() => filas
    .filter((f) => !lecturas.length || lecturas.includes(f.lectura))
    .sort((a, b) => (b.dias || 0) - (a.dias || 0)), [filas, lecturas])

  const columnas = [
    { key: 'equipo', label: 'Equipo', tarjeta: 'titulo', render: (f) => <b>{f.equipo || '—'}</b> },
    { key: 'familia', label: 'Familia', render: (f) => (f.familia
      ? <button style={{ border: 0, background: 'none', padding: 0, color: C.azul, cursor: 'pointer', textAlign: 'left', fontSize: 'inherit' }}
          onClick={(e) => { e.stopPropagation(); onFamilia(f.familia) }}>{f.familia}</button>
      : <span style={s.meta}>sin familia</span>) },
    { key: 'orden', label: 'Orden' },
    { key: 'fecha_entrada', label: 'Fecha', render: (f) => ddmm(f.fecha_entrada) },
    { key: 'dias', label: 'Días', render: (f) => num(f.dias, 0) },
    { key: 'lectura', label: 'Lectura', render: (f) => <Badge def={LECTURA[f.lectura]} /> },
    { key: 'materiales', label: 'Materiales reservados', render: (f) => <span style={{ fontSize: 13 }}>{f.materiales || '—'}</span> },
  ]

  return (
    <div>
      <div style={s.chips}>
        {LECTURAS.map((l) => (
          <button key={l.id} style={s.chipBtn(lecturas.includes(l.id))} onClick={() => toggle(l.id)}>
            {l.label} · {num(conteo[l.id] || 0, 0)}
          </button>
        ))}
      </div>
      <div style={{ ...s.meta, marginBottom: 6 }}>
        Mantenimientos de los últimos 12 meses con material reservado y nada consumido. Trabado = más de {diasTrabado ?? 30} días.
      </div>
      <TablaResponsive filas={visibles} columnas={columnas} getKey={(f) => f.orden} vacio="Sin mantenimientos pendientes con estos filtros" />
    </div>
  )
}
