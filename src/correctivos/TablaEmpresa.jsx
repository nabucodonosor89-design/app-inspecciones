import { C, s, num, ddmm, UMBRAL_URGENTE } from './constantes'
import TablaResponsive from './TablaResponsive'

export default function TablaEmpresa({ abiertas, porObra }) {
  const soloSap = abiertas.filter((a) => !a.en_app).sort((a, b) => (b.dias_abierta ?? -1) - (a.dias_abierta ?? -1))
  const obras = [...porObra].sort((a, b) => b.total - a.total)

  return (
    <div>
      <div style={s.card}>
        <div style={s.subtitulo}>Solo SAP por obra</div>
        <div style={s.scroll}>
          <table style={s.tabla}>
            <thead><tr><th style={s.th}>Ubicación</th><th style={s.th}>Órdenes</th><th style={s.th}>&gt; {UMBRAL_URGENTE} días</th></tr></thead>
            <tbody>
              {obras.map((o) => (
                <tr key={o.ubicacion}>
                  <td style={s.td}>{o.ubicacion}</td>
                  <td style={s.td}>{num(o.total)}</td>
                  <td style={s.td}>{o.mas_10_dias ? <span style={s.chip(C.ambarBg, C.ambar)}>{num(o.mas_10_dias)}</span> : '0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ ...s.meta, marginTop: 6 }}>Totales sin filtros de tipo ni búsqueda.</div>
      </div>

      <div style={s.card}>
        <div style={s.subtitulo}>Órdenes SAP abiertas que no están en la app · {soloSap.length}</div>
        <TablaResponsive
          filas={soloSap}
          getKey={(f) => f.orden}
          columnas={[
            { key: 'equipo', label: 'Equipo', tarjeta: 'titulo',
              render: (f) => <span><strong>{f.equipo || '(sin código)'}</strong><br /><span style={s.meta}>{f.denominacion || ''}</span></span> },
            { key: 'dias_abierta', label: 'Días', render: (f) => (f.dias_abierta > UMBRAL_URGENTE
              ? <span style={s.chip(C.ambarBg, C.ambar)}>{num(f.dias_abierta)} d</span> : `${num(f.dias_abierta)} d`) },
            { key: 'orden', label: 'Orden' },
            { key: 'aviso', label: 'Aviso', render: (f) => f.aviso || '—' },
            { key: 'ubicacion', label: 'Ubicación' },
            { key: 'status_usuario', label: 'Status', render: (f) => f.status_usuario || '—' },
            { key: 'fecha_entrada', label: 'Entrada', render: (f) => ddmm(f.fecha_entrada) },
            { key: 'texto', label: 'Texto', render: (f) => f.texto || '—' },
          ]}
          vacio="Todas las órdenes abiertas están en la app"
        />
      </div>
    </div>
  )
}
