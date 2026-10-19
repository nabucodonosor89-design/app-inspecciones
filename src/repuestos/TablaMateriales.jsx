import { useMemo, useState } from 'react'
import TablaResponsive from '../correctivos/TablaResponsive'
import Badge from './Badge'
import { C, s, ESTADOS, ESTADO, ESTADOS_DEFECTO, TIPOS, num, cant, listaFamilias, ordenCobertura } from './constantes'

// Materiales de kit: consumo 12 m (todas las órdenes) vs stock de Ypané. Lee v_rep_materiales (lo carga ModuloRepuestos).
export default function TablaMateriales({ filas, onFamilia }) {
  const [estados, setEstados] = useState(ESTADOS_DEFECTO)
  const [tipos, setTipos] = useState([]) // vacío = todos

  const toggle = (set) => (id) => set((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  // Contadores: respetan búsqueda y tipo; el de tipo respeta búsqueda y estado
  const porEstado = useMemo(() => {
    const m = {}
    filas.forEach((f) => { if (!tipos.length || tipos.includes(f.tipo)) m[f.estado] = (m[f.estado] || 0) + 1 })
    return m
  }, [filas, tipos])
  const porTipo = useMemo(() => {
    const m = {}
    filas.forEach((f) => { if (!estados.length || estados.includes(f.estado)) m[f.tipo] = (m[f.tipo] || 0) + 1 })
    return m
  }, [filas, estados])

  const visibles = useMemo(() => filas
    .filter((f) => (!estados.length || estados.includes(f.estado)) && (!tipos.length || tipos.includes(f.tipo)))
    .sort(ordenCobertura), [filas, estados, tipos])

  const columnas = [
    { key: 'material', label: 'Material', tarjeta: 'titulo', render: (f) => <b style={{ whiteSpace: 'nowrap' }}>{f.material}</b> },
    { key: 'descripcion', label: 'Descripción' },
    { key: 'tipo', label: 'Tipo' },
    { key: 'consumo_mensual', label: 'Consumo / mes', render: (f) => cant(f.consumo_mensual, f.unidad) },
    { key: 'stock_ypane', label: 'Stock Ypané', render: (f) => cant(f.stock_ypane, f.unidad) },
    { key: 'cobertura_meses', label: 'Cobertura (meses)',
      render: (f) => (f.cobertura_meses == null ? '—' : num(f.cobertura_meses, 1)) },
    { key: 'estado', label: 'Estado', render: (f) => <Badge def={ESTADO[f.estado]} /> },
    { key: 'familias', label: 'Familias' },
  ]

  const detalle = (f) => (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span><span style={s.meta}>Stock total (todos los centros): </span>{cant(f.stock_total, f.unidad)}</span>
        <span><span style={s.meta}>Consumo 12 meses: </span>{cant(f.consumo_12m, f.unidad)}</span>
      </div>
      <div>
        <div style={s.meta}>Familias que lo tienen en el kit:</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          {listaFamilias(f.familias_lista).map((fam) => (
            <button key={fam} style={{ ...s.chipBtn(false), color: C.azul }}
              onClick={(e) => { e.stopPropagation(); onFamilia(fam) }}>
              {fam} ›
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <div>
      <div style={s.chips}>
        {ESTADOS.map((e) => (
          <button key={e.id} style={s.chipBtn(estados.includes(e.id))} onClick={() => toggle(setEstados)(e.id)}>
            {e.label} · {num(porEstado[e.id] || 0, 0)}
          </button>
        ))}
      </div>
      <div style={{ ...s.chips, flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 2 }}>
        <button style={{ ...s.chipBtn(!tipos.length), flex: '0 0 auto' }} onClick={() => setTipos([])}>Todos los tipos</button>
        {TIPOS.filter((t) => porTipo[t]).map((t) => (
          <button key={t} style={{ ...s.chipBtn(tipos.includes(t)), flex: '0 0 auto' }} onClick={() => toggle(setTipos)(t)}>
            {t} · {num(porTipo[t], 0)}
          </button>
        ))}
      </div>
      <div style={{ ...s.meta, marginBottom: 6 }}>
        {num(visibles.length, 0)} materiales · ordenados por cobertura (menor primero). Tocá una fila para ver el detalle.
      </div>
      <TablaResponsive filas={visibles} columnas={columnas} getKey={(f) => f.material} detalle={detalle}
        vacio="Sin materiales con estos filtros" />
    </div>
  )
}
