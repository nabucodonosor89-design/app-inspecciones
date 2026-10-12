import { useState } from 'react'
import * as XLSX from 'xlsx'
import { C, s, num, ddmm, hoyPY } from './constantes'
import TablaResponsive from './TablaResponsive'

// Qué hacer con cada orden SAP abierta que no está en la app (columna `accion` de v_corr_sap_abiertas)
const ACCIONES = [
  { id: 'cierre_candidato', label: 'Candidatas a cierre', fg: C.verde, bg: C.verdeBg,
    texto: 'Creadas y nunca liberadas (0TES), pero el equipo trabajó o se reparó después. Pedir el cierre en SAP.' },
  { id: 'verificar', label: 'Verificar', fg: C.ambar, bg: C.ambarBg,
    texto: 'Creadas y nunca liberadas (0TES), sin evidencia de que el equipo haya trabajado después. Alguien tiene que ver el equipo.' },
  { id: 'completar_equipo', label: 'Sin código de equipo', fg: C.rojo, bg: C.rojoBg,
    texto: 'La orden no tiene equipo cargado en SAP: completar el dato (el texto suele indicar cuál es).' },
  { id: 'en_curso', label: 'En curso', fg: C.azul, bg: C.azulBg,
    texto: 'Liberadas: la reparación empezó, pero no está cargada en la app.' },
]

function evidencia(f) {
  const partes = []
  if (f.ev_horas_30d) partes.push(`${num(Math.round(f.ev_horas_30d))} h en 30 días`)
  if (f.ev_km_30d) partes.push(`${num(Math.round(f.ev_km_30d))} km en 30 días`)
  if (f.ev_orden_posterior) partes.push(`correctivo posterior ${f.ev_orden_posterior} cerrado`)
  if (f.ev_insp_verde) partes.push(`inspección verde ${ddmm(f.ev_insp_verde)}`)
  return partes.join(' · ')
}

function exportar(filas, accion) {
  const datos = filas.map((f) => ({
    'Equipo': f.equipo || '(sin código)',
    'Denominación': f.denominacion || '',
    'Orden': Number(f.orden),
    'Aviso': f.aviso ? Number(f.aviso) : null,
    'Status': f.status_usuario || '',
    'Fecha de creación': f.fecha_entrada || '',
    'Días abierta': f.dias_abierta,
    'Ubicación': f.ubicacion || '',
    'Texto': f.texto || '',
    'Evidencia de que trabajó después': evidencia(f),
  }))
  const wb = XLSX.utils.book_new()
  const h = XLSX.utils.json_to_sheet(datos)
  h['!cols'] = [12, 30, 10, 10, 8, 14, 10, 28, 40, 50].map((w) => ({ wch: w }))
  XLSX.utils.book_append_sheet(wb, h, accion.label.slice(0, 31))
  XLSX.writeFile(wb, `ordenes_sap_${accion.id}_${hoyPY()}.xlsx`)
}

export default function TablaEmpresa({ abiertas }) {
  const soloSap = abiertas.filter((a) => !a.en_app)
  const [sel, setSel] = useState('cierre_candidato')
  const accion = ACCIONES.find((a) => a.id === sel)
  const filas = soloSap.filter((f) => f.accion === sel).sort((a, b) => (b.dias_abierta ?? -1) - (a.dias_abierta ?? -1))

  const columnas = [
    { key: 'equipo', label: 'Equipo', tarjeta: 'titulo',
      render: (f) => <span><strong>{f.equipo || '(sin código)'}</strong><br /><span style={s.meta}>{f.denominacion || ''}</span></span> },
    { key: 'dias_abierta', label: 'Días', render: (f) => <span style={{ whiteSpace: 'nowrap' }}>{num(f.dias_abierta)} d</span> },
    { key: 'fecha_entrada', label: 'Creada', render: (f) => <span style={{ whiteSpace: 'nowrap' }}>{ddmm(f.fecha_entrada)}</span> },
    { key: 'orden', label: 'Orden' },
    { key: 'aviso', label: 'Aviso', render: (f) => f.aviso || '—' },
    { key: 'status_usuario', label: 'Status', render: (f) => f.status_usuario || '—' },
    { key: 'ubicacion', label: 'Ubicación' },
    { key: 'texto', label: 'Texto', render: (f) => f.texto || '—' },
    ...(sel === 'cierre_candidato'
      ? [{ key: 'evidencia', label: 'Evidencia', render: (f) => <span style={{ color: C.verde }}>{evidencia(f)}</span> }]
      : []),
  ]

  return (
    <div>
      <div style={s.card}>
        <div style={s.subtitulo}>Órdenes SAP abiertas que no están en la app · {soloSap.length}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
          {ACCIONES.map((a) => {
            const n = soloSap.filter((f) => f.accion === a.id).length
            const on = sel === a.id
            return (
              <button key={a.id} onClick={() => setSel(a.id)}
                style={{ textAlign: 'left', cursor: 'pointer', borderRadius: 10, padding: '10px 12px',
                  border: `2px solid ${on ? a.fg : C.borde}`, background: on ? a.bg : '#fff' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: a.fg }}>{num(n)}</div>
                <div style={{ fontSize: 13, color: C.texto, fontWeight: 600 }}>{a.label}</div>
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ ...s.card, borderLeft: `4px solid ${accion.fg}` }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 6 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ ...s.subtitulo, color: accion.fg, marginBottom: 2 }}>{accion.label} · {filas.length}</div>
            <div style={s.meta}>{accion.texto}</div>
          </div>
          <button style={{ ...s.boton, color: C.azul, fontWeight: 600 }} disabled={!filas.length}
            onClick={() => exportar(filas, accion)} title="Exporta esta lista (con filtros)">⬇ Exportar Excel</button>
        </div>
        <TablaResponsive filas={filas} columnas={columnas} getKey={(f) => f.orden} vacio="No hay órdenes en este grupo" />
      </div>
    </div>
  )
}
