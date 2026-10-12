import { useState } from 'react'
import { s, ddmm, num, UMBRAL_OUTLIER } from './constantes'
import TablaResponsive from './TablaResponsive'

export default function MttrOutliers({ filas }) {
  const [abierto, setAbierto] = useState(false)
  if (!filas.length) return null
  const orden = [...filas].sort((a, b) => b.dias - a.dias)
  return (
    <div style={s.card}>
      <button onClick={() => setAbierto(!abierto)}
        style={{ ...s.boton, width: '100%', textAlign: 'left', border: 'none', padding: 0, minHeight: 32 }}>
        {abierto ? '▾' : '▸'} Cierres de más de {UMBRAL_OUTLIER} días (fuera del MTTR) · {num(filas.length)}
      </button>
      {abierto && (
        <div style={{ marginTop: 8 }}>
          <TablaResponsive
            filas={orden}
            getKey={(f) => `${f.equipo}-${f.ingreso}-${f.liberacion}`}
            columnas={[
              { key: 'equipo', label: 'Equipo', tarjeta: 'titulo' },
              { key: 'taller', label: 'Taller' },
              { key: 'ingreso', label: 'Ingreso', render: (f) => ddmm(f.ingreso) },
              { key: 'liberacion', label: 'Liberación', render: (f) => ddmm(f.liberacion) },
              { key: 'dias', label: 'Días', render: (f) => num(f.dias) },
            ]}
          />
        </div>
      )}
    </div>
  )
}
