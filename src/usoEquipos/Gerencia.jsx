import { useState } from 'react'
import { C, s, num, ddmm, gsCorto, gs, TIPOS_HALLAZGO, ORDEN_TIPOS } from './constantes'
import TablaResponsive from '../correctivos/TablaResponsive'
import GestionSheet from './GestionSheet'

/**
 * Pestaña Gerencia: escalados, ociosos, indicadores por obra y datos faltantes.
 * Sin botón Recalcular: el refresco corre solo todos los días a las 14:30 (pg_cron).
 */
export default function Gerencia({ escalados, ociosos, indicadores, faltantes, onAbrirObra, onCambio }) {
  const [sheet, setSheet] = useState(null) // { modo, caso }
  const confirmados = ociosos.filter((o) => o.confirmado)
  const probables = ociosos.filter((o) => !o.confirmado)

  const colOcio = [
    { key: 'equipo', label: 'Equipo', tarjeta: 'titulo', render: (o) => <><b>{o.equipo}</b> <span style={s.meta}>{(o.denominacion || '').replace(o.equipo, '').trim()}</span></> },
    { key: 'obra', label: 'Obra', render: (o) => o.obra_nombre ? `${o.obra} · ${o.obra_nombre}` : o.obra || '—' },
    { key: 'tipo_equipo', label: 'Tipo' },
    { key: 'dias', label: 'Días sin uso', render: (o) => <b>{num(o.dias)}</b> },
    { key: 'desde', label: 'Desde', render: (o) => ddmm(o.desde) },
    { key: 'ultimo_uso', label: 'Último uso', render: (o) => ddmm(o.ultimo_uso) },
    { key: 'rastreo', label: 'Días con rastreo', render: (o) => `${num(o.dias_con_rastreo)} de ${num(o.dias)}` },
  ]

  return (
    <div>
      <div style={{ ...s.meta, marginBottom: 12 }}>Los datos se recalculan solos todos los días a las 14:30, después de la carga de SAP.</div>

      {/* Escalados */}
      <div style={s.card}>
        <div style={s.subtitulo}>Escalados · {num(escalados.length)}</div>
        {!escalados.length ? <div style={s.meta}>No hay casos escalados.</div> : escalados.map((o) => (
          <div key={o.caso.caso_id} style={{ borderBottom: `1px solid ${C.borde}`, padding: '8px 0', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 200, cursor: 'pointer' }} onClick={() => onAbrirObra(o.caso.obra)}>
              <div style={{ fontWeight: 700 }}>{o.caso.obra_nombre || o.caso.obra} <span style={s.meta}>{o.caso.obra}</span></div>
              <div style={s.meta}>
                Escalado {ddmm(o.caso.escalado_at)} · {num(o.abiertos)} hallazgos · {gsCorto(o.monto)}
                {o.caso.ultima_gestion_texto && <> · “{o.caso.ultima_gestion_texto}”</>}
              </div>
            </div>
            <button style={s.boton} onClick={() => setSheet({ modo: 'devolver', caso: o.caso })}>Devolver</button>
            <button style={s.boton} onClick={() => setSheet({ modo: 'nota', caso: o.caso })}>Nota</button>
          </div>
        ))}
      </div>

      {/* Ociosos */}
      <div style={s.card}>
        <div style={s.subtitulo}>Ociosos confirmados · {num(confirmados.length)}</div>
        <div style={{ ...s.meta, marginBottom: 8 }}>El rastreo reportó todos los días de la racha y muestra que el equipo no se movió.</div>
        <TablaResponsive filas={confirmados} columnas={colOcio} getKey={(o) => o.equipo} vacio="Sin ociosos confirmados" />
      </div>
      <div style={s.card}>
        <div style={s.subtitulo}>Ociosos probables · {num(probables.length)}</div>
        <div style={{ ...s.meta, marginBottom: 8 }}>Sin parte, imputación ni combustible, pero sin rastreo completo: no se puede descartar que haya trabajado sin registro.</div>
        <TablaResponsive filas={probables} columnas={colOcio} getKey={(o) => o.equipo} vacio="Sin ociosos probables" />
      </div>

      {/* Indicadores por obra */}
      <div style={s.card}>
        <div style={s.subtitulo}>Indicadores por obra (año en curso)</div>
        <TablaResponsive filas={indicadores} getKey={(r) => r.obra} vacio="Sin datos" columnas={[
          { key: 'obra', label: 'Obra', tarjeta: 'titulo', render: (r) => <><b>{r.obra_nombre || r.obra}</b> <span style={s.meta}>{r.obra}</span></> },
          { key: 'abiertos', label: 'Abiertos', render: (r) => num(r.abiertos) },
          { key: 'monto_abierto', label: 'Monto abierto', render: (r) => <span title={gs(r.monto_abierto)}>{gsCorto(r.monto_abierto)}</span> },
          { key: 'resueltos', label: 'Resueltos', render: (r) => num(r.resueltos) },
          { key: 'justificados', label: 'Justificados', render: (r) => num(r.justificados) },
          { key: 'vencidos', label: 'Vencidos', render: (r) => num(r.vencidos) },
          { key: 'veces_escalada', label: 'Escalada', render: (r) => num(r.veces_escalada) },
          { key: 'nuevos_30d', label: 'Nuevos 30 d', render: (r) => num(r.nuevos_30d) },
          { key: 'dias_prom_resolucion', label: 'Días hasta resolver', render: (r) => (r.dias_prom_resolucion == null ? '—' : num(r.dias_prom_resolucion)) },
        ]} />
      </div>

      {/* Datos faltantes */}
      <div style={s.card}>
        <div style={s.subtitulo}>Datos faltantes · {num(faltantes.length)}</div>
        <div style={{ ...s.meta, marginBottom: 8 }}>
          Equipos activos en el maestro que el módulo no puede evaluar bien. “Sin actividad en el año”: ni rastreo, ni parte, ni SAP, ni combustible en todo el año (revisar el maestro).
        </div>
        <TablaResponsive filas={faltantes} getKey={(r) => r.equipo} vacio="Sin datos faltantes" columnas={[
          { key: 'equipo', label: 'Equipo', tarjeta: 'titulo', render: (r) => <><b>{r.equipo}</b> <span style={s.meta}>{(r.denominacion || '').replace(r.equipo, '').trim()}</span></> },
          { key: 'tipo', label: 'Tipo' },
          { key: 'clase', label: 'Clase', render: (r) => r.clase || '—' },
          { key: 'falta', label: 'Qué falta', render: (r) => (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {r.sin_actividad_anio && <span style={s.chip(C.ambarBg, C.ambar)}>Sin actividad en el año</span>}
              {r.sin_unidad && <span style={s.chip('#f3f4f6', C.gris)}>Sin unidad</span>}
              {r.sin_costo && <span style={s.chip('#f3f4f6', C.gris)}>Sin costo</span>}
              {r.sin_obra && <span style={s.chip('#f3f4f6', C.gris)}>Sin obra</span>}
            </div>
          ) },
        ]} />
      </div>

      <div style={{ ...s.meta, fontSize: 12 }}>
        Tipos de hallazgo: {ORDEN_TIPOS.map((t) => TIPOS_HALLAZGO[t].label).join(' · ')}.
      </div>

      {sheet && (
        <GestionSheet modo={sheet.modo} caso={sheet.caso} onCerrar={() => setSheet(null)}
          onHecho={() => { setSheet(null); onCambio() }} />
      )}
    </div>
  )
}
