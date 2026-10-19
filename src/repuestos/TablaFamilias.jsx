import { useMemo } from 'react'
import TablaResponsive from '../correctivos/TablaResponsive'
import Badge from './Badge'
import { C, s, ESTADO, ORIGEN_SIN_REVISAR, num } from './constantes'

// Familias con kit. Lee v_rep_familias (lo carga ModuloRepuestos). Tocar una fila abre DetalleFamilia.
export default function TablaFamilias({ filas, equiposSinFamilia, onFamilia }) {
  const visibles = useMemo(() => [...filas].sort((a, b) =>
    (b.mantenimientos_12m || 0) - (a.mantenimientos_12m || 0) || a.familia.localeCompare(b.familia)), [filas])

  const columnas = [
    { key: 'familia', label: 'Familia', tarjeta: 'titulo', render: (f) => (
      <span>
        <b style={{ color: C.azul }}>{f.familia}</b>
        {ORIGEN_SIN_REVISAR.includes(f.origen_modelo) && (
          <span style={{ ...s.meta, fontSize: 11, marginLeft: 6, whiteSpace: 'nowrap' }}
            title={f.origen_modelo === 'sugerido' ? 'Modelo sugerido, pendiente de revisión' : 'Modelo tomado de la app, sin revisar'}>
            · modelo sin revisar
          </span>
        )}
      </span>
    ) },
    { key: 'equipos', label: 'Equipos', render: (f) => num(f.equipos, 0) },
    { key: 'mantenimientos_12m', label: 'Mant. 12 m', render: (f) => num(f.mantenimientos_12m, 0) },
    { key: 'dias_entre_mantenimientos', label: 'Días entre mant.',
      render: (f) => (f.dias_entre_mantenimientos == null ? '—' : num(f.dias_entre_mantenimientos, 0)) },
    { key: 'kit', label: 'Kit', render: (f) => (
      <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={s.meta}>{num(f.materiales_kit, 0)} mat.</span>
        {f.kit_en_riesgo > 0 && <Badge def={ESTADO.riesgo}>{f.kit_en_riesgo} riesgo</Badge>}
        {f.kit_en_atencion > 0 && <Badge def={ESTADO.atencion}>{f.kit_en_atencion} atención</Badge>}
      </span>
    ) },
    { key: 'mantenimientos_pendientes', label: 'Pendientes',
      render: (f) => (f.mantenimientos_pendientes > 0 ? <b style={{ color: C.rojo }}>{f.mantenimientos_pendientes}</b> : '0') },
  ]

  return (
    <div>
      {equiposSinFamilia > 0 && (
        <div style={{ ...s.meta, marginBottom: 8 }}>
          {num(equiposSinFamilia, 0)} equipos sin modelo no entran en ningún kit.
        </div>
      )}
      <div style={{ ...s.meta, marginBottom: 6 }}>
        {num(visibles.length, 0)} familias con kit · ordenadas por mantenimientos de los últimos 12 meses. Tocá una para ver el kit.
      </div>
      <TablaResponsive filas={visibles} columnas={columnas} getKey={(f) => f.familia}
        onFila={(f) => onFamilia(f.familia)} vacio="Sin familias con esta búsqueda" />
    </div>
  )
}
