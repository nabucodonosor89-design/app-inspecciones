import { useState } from 'react'
import { C, s, num, ddmmhhmm, MOTIVOS, UMBRAL_OUTLIER } from './constantes'
import MttrOutliers from './MttrOutliers'
import DetalleKpi from './DetalleKpi'
import { toast } from '../utils/ui'
import { useEscritorio } from './useEscritorio'

function Kpi({ label, valor, tono, sub, id, sel, onSel }) {
  const colores = { rojo: [C.rojoBg, C.rojo], ambar: [C.ambarBg, C.ambar], verde: [C.verdeBg, C.verde] }
  const [bg, fg] = colores[tono] || ['#fff', C.texto]
  const activo = id && sel === id
  return (
    <button type="button" onClick={() => onSel(activo ? null : id)} title="Ver el detalle"
      style={{ background: bg, border: `${activo ? 2 : 1}px solid ${activo ? C.azul : C.borde}`, borderRadius: 10,
        padding: activo ? '9px 11px' : '10px 12px', textAlign: 'left', cursor: 'pointer', font: 'inherit',
        boxShadow: activo ? '0 0 0 3px rgba(29,78,216,0.15)' : 'none' }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: fg, lineHeight: 1.1 }}>{valor}</div>
      <div style={{ fontSize: 13, color: C.gris }}>{label} <span style={{ color: C.azul }}>{activo ? '▾' : '›'}</span></div>
      {sub && <div style={{ fontSize: 12, color: C.gris, marginTop: 2 }}>{sub}</div>}
    </button>
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

// Copia números (avisos u órdenes) uno por línea, sin ceros a la izquierda ni repetidos,
// para pegar en la selección múltiple de SAP ("Cargar desde portapapeles").
async function copiarNumeros(valores, singular, plural) {
  const nums = [...new Set(valores
    .map((v) => (v == null ? '' : String(v).trim().replace(/^0+(?=\d)/, '')))
    .filter((v) => v && v !== '—'))]
  if (!nums.length) return
  const texto = nums.join('\r\n')
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto)
    } else {
      const ta = document.createElement('textarea')
      ta.value = texto
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      if (!ok) throw new Error('execCommand')
    }
    toast(`${nums.length} ${nums.length === 1 ? singular : plural}`, 'exito')
  } catch {
    toast('No se pudo copiar al portapapeles', 'error')
  }
}

function BotonCopiar({ valores, singular, plural, titulo }) {
  const escritorio = useEscritorio()
  const vacio = !valores.some((v) => v != null && String(v).trim() && v !== '—')
  return (
    <button type="button" disabled={vacio} title={titulo}
      onClick={(e) => { e.stopPropagation(); copiarNumeros(valores, singular, plural) }}
      style={{ marginLeft: 6, minHeight: escritorio ? 28 : 44, minWidth: escritorio ? 28 : 44, padding: '0 8px',
        border: `1px solid ${C.borde}`, borderRadius: 6, background: '#fff', color: vacio ? C.gris : C.azul,
        fontSize: 12, fontWeight: 600, cursor: vacio ? 'default' : 'pointer', opacity: vacio ? 0.5 : 1 }}>
      📋 Copiar
    </button>
  )
}

function Duplicados({ filas }) {
  const [abierto, setAbierto] = useState(null)
  const grupos = Object.values(filas.reduce((acc, f) => {
    (acc[f.equipo] ||= { equipo: f.equipo, denominacion: f.denominacion, filas: [] }).filas.push(f)
    return acc
  }, {}))
    .map((g) => ({ ...g, filas: [...g.filas].sort((a, b) => (b.dias ?? 0) - (a.dias ?? 0)) }))
    .sort((a, b) => b.filas.length - a.filas.length || a.equipo.localeCompare(b.equipo))

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
            <thead><tr>
              <th style={s.th}>Origen</th>
              <th style={s.th}>Aviso
                <BotonCopiar valores={g.filas.map((f) => f.aviso)} singular="aviso copiado" plural="avisos copiados" titulo="Copiar todos los avisos (uno por línea, para SAP)" />
              </th>
              <th style={s.th}>Orden
                <BotonCopiar valores={g.filas.map((f) => f.orden)} singular="orden copiada" plural="órdenes copiadas" titulo="Copiar todas las órdenes (uno por línea, para SAP)" />
              </th>
              {['Ubicación / taller', 'Días', 'Status'].map((h) => <th key={h} style={s.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {g.filas.map((f, i) => (
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

export default function Resumen({ k, ypane, inconsistencias, duplicados, outliers, cambios, abiertas, materiales, filtrando }) {
  const [sel, setSel] = useState(null)
  if (!k) return <div style={s.vacio}>Sin datos</div>
  const p = { sel, onSel: setSel }
  const datos = { ypane, inconsistencias, duplicados, outliers, abiertas, materiales }
  const detalle = (prefijo) => sel && sel.startsWith(prefijo) && <DetalleKpi id={sel} datos={datos} filtrando={filtrando} onCerrar={() => setSel(null)} />
  const criticos = ypane.filter((y) => y.es_critico)
  const porMotivo = Object.keys(MOTIVOS).map((m) => ({ m, filas: inconsistencias.filter((i) => i.motivo === m) })).filter((x) => x.filas.length)
  const cambiosReales = cambios.filter((c) => c.regla !== 'RUN')
  const ultimaCorrida = cambios.filter((c) => c.regla === 'RUN').sort((a, b) => b.id - a.id)[0]

  return (
    <div>
      <div style={{ ...s.meta, marginBottom: 8 }}>Tocá un indicador para ver su lista.{filtrando ? ' Los indicadores muestran el total; los filtros aplican a las listas.' : ''}</div>

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
          <Kpi id="yp_en_taller" {...p} label="En taller" valor={num(k.yp_en_taller)} sub={`${num(k.yp_en_espera)} en espera · ${num(k.yp_en_reparacion)} en reparación`} />
          <Kpi id="yp_terceros" {...p} label="En talleres terceros" valor={num(k.yp_terceros)} />
          <Kpi id="yp_criticos" {...p} label="Críticos detenidos" valor={num(k.yp_criticos)} tono={k.yp_criticos ? 'rojo' : undefined} />
          <Kpi id="yp_urgentes" {...p} label="Urgentes (> 10 días)" valor={num(k.yp_urgentes)} tono={k.yp_urgentes ? 'ambar' : undefined} />
          <Kpi id="yp_sin_orden" {...p} label="Sin N° de orden" valor={num(k.yp_sin_orden)} tono={k.yp_sin_orden ? 'ambar' : undefined} />
          <Kpi id="yp_sin_pedido" {...p} label="Sin pedido" valor={num(k.yp_sin_pedido)} />
          <Kpi id="yp_inc" {...p} label="Inconsistencias" valor={num(k.inc_total)} tono={k.inc_total ? 'rojo' : 'verde'} />
          <Kpi id="yp_mttr" {...p} label="MTTR 90 días" valor={k.mttr_90d == null ? '—' : `${num(k.mttr_90d)} d`}
            sub={`${num(k.mttr_cierres)} cierres · sin ${num(k.mttr_outliers)} outliers > ${UMBRAL_OUTLIER} d`} />
        </div>
        {detalle('yp_')}
      </div>

      <div style={s.card}>
        <div style={s.subtitulo}>Empresa (SAP)</div>
        <div style={grilla}>
          <Kpi id="sap_abiertas" {...p} label="Correctivos abiertos" valor={num(k.sap_abiertas)} />
          <Kpi id="sap_en_app" {...p} label="En la app" valor={num(k.sap_en_app)} tono="verde" />
          <Kpi id="sap_solo_sap" {...p} label="Solo SAP" valor={num(k.sap_solo_sap)} sub={`${num(k.sap_solo_sap_10d)} con > 10 días`} tono={k.sap_solo_sap_10d ? 'ambar' : undefined} />
          <Kpi id="sap_cierre" {...p} label="Candidatas a cierre" valor={num(k.sap_cierre_candidatas)} tono={k.sap_cierre_candidatas ? 'verde' : undefined}
            sub={`0TES con el equipo trabajando después · ${num(k.sap_verificar)} a verificar`} />
          <Kpi id="sap_sin_equipo" {...p} label="Sin código de equipo" valor={num(k.sap_sin_equipo)} />
          <Kpi id="sap_multi" {...p} label="Equipos con > 1 orden" valor={num(k.equipos_multi_orden)} sub={`${num(k.ordenes_multi_orden)} órdenes/avisos`} />
        </div>
        {detalle('sap_')}
      </div>

      <div style={s.card}>
        <div style={s.subtitulo}>Materiales</div>
        <div style={grilla}>
          <Kpi id="mat_bloqueo" {...p} label="Bloqueo real" valor={num(k.mat_bloqueo)} tono="rojo" />
          <Kpi id="mat_parcial" {...p} label="Cobertura parcial" valor={num(k.mat_parcial)} tono="ambar" />
          <Kpi id="mat_despacho" {...p} label="Despacho pendiente" valor={num(k.mat_despacho)} tono="verde" />
        </div>
        {detalle('mat_')}
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
