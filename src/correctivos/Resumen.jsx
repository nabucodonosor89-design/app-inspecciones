import { useState } from 'react'
import { C, s, num, ddmmhhmm, MOTIVOS, UMBRAL_OUTLIER } from './constantes'
import MttrOutliers from './MttrOutliers'

function Kpi({ label, valor, tono, sub }) {
  const colores = { rojo: [C.rojoBg, C.rojo], ambar: [C.ambarBg, C.ambar], verde: [C.verdeBg, C.verde] }
  const [bg, fg] = colores[tono] || ['#fff', C.texto]
  return (
    <div style={{ background: bg, border: `1px solid ${C.borde}`, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: fg, lineHeight: 1.1 }}>{valor}</div>
      <div style={{ fontSize: 13, color: C.gris }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: C.gris, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

const grilla = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }

function Colapsable({ titulo, children, inicial = false }) {
  const [abierto, setAbierto] = useState(inicial)
  return (
    <div style={s.card}>
      <button onClick={() => setAbierto(!abierto)}
        style={{ background: 'none', border: 'none', padding: 0, width: '100%', textAlign: 'left', cursor: 'pointer', fontWeight: 700, fontSize: 15, minHeight: 32 }}>
        {abierto ? '▾' : '▸'} {titulo}
      </button>
      {abierto && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  )
}

function Duplicados({ filas }) {
  const [abierto, setAbierto] = useState(null)
  const grupos = Object.values(filas.reduce((acc, f) => {
    (acc[f.equipo] ||= { equipo: f.equipo, denominacion: f.denominacion, filas: [] }).filas.push(f)
    return acc
  }, {})).sort((a, b) => b.filas.length - a.filas.length || a.equipo.localeCompare(b.equipo))

  if (!grupos.length) return <div style={s.vacio}>Ningún equipo con más de una orden abierta</div>
  return grupos.map((g) => (
    <div key={g.equipo} style={{ borderBottom: `1px solid ${C.borde}` }}>
      <div onClick={() => setAbierto(abierto === g.equipo ? null : g.equipo)}
        style={{ padding: '8px 0', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={s.chip(C.ambarBg, C.ambar)}>{g.filas.length}</span>
        <strong>{g.equipo}</strong>
        <span style={s.meta}>{g.denominacion}</span>
      </div>
      {abierto === g.equipo && (
        <div style={{ ...s.scroll, paddingBottom: 8 }}>
          <table style={s.tabla}>
            <thead><tr>{['Origen', 'Aviso', 'Orden', 'Ubicación / taller', 'Días', 'Status'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>
              {g.filas.sort((a, b) => (b.dias ?? 0) - (a.dias ?? 0)).map((f, i) => (
                <tr key={i}>
                  <td style={s.td}>{f.origen}</td>
                  <td style={s.td}>{f.aviso || '—'}</td>
                  <td style={s.td}>{f.orden || '—'}</td>
                  <td style={s.td}>{f.ubicacion}</td>
                  <td style={s.td}>{num(f.dias)}</td>
                  <td style={s.td}>{f.status || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  ))
}

export default function Resumen({ k, ypane, inconsistencias, duplicados, outliers, cambios, filtrando }) {
  if (!k) return <div style={s.vacio}>Sin datos</div>
  const criticos = ypane.filter((y) => y.es_critico)
  const porMotivo = Object.keys(MOTIVOS).map((m) => ({ m, filas: inconsistencias.filter((i) => i.motivo === m) })).filter((x) => x.filas.length)
  const cambiosReales = cambios.filter((c) => c.regla !== 'RUN')
  const ultimaCorrida = cambios.filter((c) => c.regla === 'RUN').sort((a, b) => b.id - a.id)[0]

  return (
    <div>
      {filtrando && <div style={{ ...s.meta, marginBottom: 8 }}>Los indicadores muestran el total; los filtros aplican a las listas.</div>}

      {criticos.length > 0 && (
        <div style={{ ...s.card, background: C.rojoBg, borderColor: '#fecaca' }}>
          <div style={{ fontWeight: 700, color: C.rojo, marginBottom: 6 }}>⚠ {criticos.length} equipo(s) crítico(s) detenido(s)</div>
          {criticos.map((c) => (
            <div key={c.id} style={{ fontSize: 14 }}>
              <strong>{c.equipo}</strong> · {c.denominacion} · {c.taller} · {num(c.dias_taller)} días · {c.estado_label}
            </div>
          ))}
        </div>
      )}

      <div style={s.card}>
        <div style={s.subtitulo}>Taller (app)</div>
        <div style={grilla}>
          <Kpi label="En taller" valor={num(k.yp_en_taller)} sub={`${num(k.yp_en_espera)} en espera · ${num(k.yp_en_reparacion)} en reparación`} />
          <Kpi label="En talleres terceros" valor={num(k.yp_terceros)} />
          <Kpi label="Críticos detenidos" valor={num(k.yp_criticos)} tono={k.yp_criticos ? 'rojo' : undefined} />
          <Kpi label="Urgentes (> 10 días)" valor={num(k.yp_urgentes)} tono={k.yp_urgentes ? 'ambar' : undefined} />
          <Kpi label="Sin N° de orden" valor={num(k.yp_sin_orden)} tono={k.yp_sin_orden ? 'ambar' : undefined} />
          <Kpi label="Sin pedido" valor={num(k.yp_sin_pedido)} />
          <Kpi label="Inconsistencias" valor={num(k.inc_total)} tono={k.inc_total ? 'rojo' : 'verde'} />
          <Kpi label="MTTR 90 días" valor={k.mttr_90d == null ? '—' : `${num(k.mttr_90d)} d`}
            sub={`${num(k.mttr_cierres)} cierres · sin ${num(k.mttr_outliers)} outliers > ${UMBRAL_OUTLIER} d`} />
        </div>
      </div>

      <div style={s.card}>
        <div style={s.subtitulo}>Empresa (SAP)</div>
        <div style={grilla}>
          <Kpi label="Correctivos abiertos" valor={num(k.sap_abiertas)} />
          <Kpi label="En la app" valor={num(k.sap_en_app)} tono="verde" />
          <Kpi label="Solo SAP" valor={num(k.sap_solo_sap)} sub={`${num(k.sap_solo_sap_10d)} con > 10 días`} tono={k.sap_solo_sap_10d ? 'ambar' : undefined} />
          <Kpi label="Sin código de equipo" valor={num(k.sap_sin_equipo)} />
          <Kpi label="Equipos con > 1 orden" valor={num(k.equipos_multi_orden)} sub={`${num(k.ordenes_multi_orden)} órdenes/avisos`} />
        </div>
      </div>

      <div style={s.card}>
        <div style={s.subtitulo}>Materiales</div>
        <div style={grilla}>
          <Kpi label="Bloqueo real" valor={num(k.mat_bloqueo)} tono="rojo" />
          <Kpi label="Cobertura parcial" valor={num(k.mat_parcial)} tono="ambar" />
          <Kpi label="Despacho pendiente" valor={num(k.mat_despacho)} tono="verde" />
        </div>
      </div>

      <Colapsable titulo={`Inconsistencias · ${num(inconsistencias.length)}`} inicial={inconsistencias.length > 0}>
        {!porMotivo.length && <div style={s.vacio}>Sin inconsistencias</div>}
        {porMotivo.map(({ m, filas }) => (
          <div key={m} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 700 }}>{MOTIVOS[m].label} · {filas.length}</div>
            <div style={{ ...s.meta, marginBottom: 4 }}>{MOTIVOS[m].accion}</div>
            <div style={s.scroll}>
              <table style={s.tabla}>
                <thead><tr>{['Equipo', 'Taller', 'Aviso', 'Orden', 'Días'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {filas.sort((a, b) => (b.dias_taller ?? 0) - (a.dias_taller ?? 0)).map((f) => (
                    <tr key={f.id}>
                      <td style={s.td}><strong>{f.equipo}</strong> <span style={s.meta}>{f.denominacion}</span></td>
                      <td style={s.td}>{f.taller}</td>
                      <td style={s.td}>{f.numero_aviso || '—'}</td>
                      <td style={s.td}>{f.numero_orden || f.orden_cruzada || '—'}</td>
                      <td style={s.td}>{num(f.dias_taller)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </Colapsable>

      <Colapsable titulo={`Equipos con más de una orden abierta · ${num(new Set(duplicados.map((d) => d.equipo)).size)}`}>
        <Duplicados filas={duplicados} />
      </Colapsable>

      <MttrOutliers filas={outliers} />

      <Colapsable titulo={`Cambios automáticos (últimos 7 días) · ${num(cambiosReales.length)}`}>
        {ultimaCorrida && (
          <div style={{ ...s.meta, marginBottom: 6 }}>
            Última corrida {ddmmhhmm(ultimaCorrida.ejecutado_en)}{ultimaCorrida.dry_run ? ' (modo prueba: no modifica datos)' : ''} · {ultimaCorrida.detalle}
          </div>
        )}
        {!cambiosReales.length ? <div style={s.vacio}>Sin cambios</div> : (
          <div style={s.scroll}>
            <table style={s.tabla}>
              <thead><tr>{['Fecha', 'Regla', 'Equipo', 'Campo', 'Antes', 'Después', 'Resultado'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {cambiosReales.map((c) => (
                  <tr key={c.id} title={c.detalle || ''}>
                    <td style={s.td}>{ddmmhhmm(c.ejecutado_en)}</td>
                    <td style={s.td}>{c.regla}</td>
                    <td style={s.td}>{c.equipo || '—'}</td>
                    <td style={s.td}>{c.campo || '—'}</td>
                    <td style={s.td}>{c.valor_anterior || '—'}</td>
                    <td style={s.td}>{c.valor_nuevo || '—'}</td>
                    <td style={s.td}>{c.resultado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Colapsable>
    </div>
  )
}
