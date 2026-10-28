import { C, s, num, ddmm, TIPOS_HALLAZGO, ORDEN_TIPOS, ESTADOS_CASO, GESTION_LABEL } from './constantes'
import Montos from './Montos'

/**
 * Tarjetas por obra con caso activo, ordenadas por magnitud de los montos abiertos.
 * obras: [{ caso (fila de v_uso_bandeja), porTipo, abiertos, m: montos por bloque, fechaMasVieja, diasMasViejo, nuevos }]
 */
export default function Bandeja({ obras, filtrando, onAbrir }) {
  if (!obras.length) {
    return <div style={s.vacio}>{filtrando ? 'Ninguna obra con hallazgos para estos filtros.' : '✅ Sin hallazgos abiertos.'}</div>
  }
  const total = { sap_falta: 0, sap_de_mas: 0, rastreo: 0 }
  obras.forEach((o) => Object.keys(total).forEach((b) => { total[b] += o.m[b] || 0 }))
  const totalN = obras.reduce((a, o) => a + o.abiertos, 0)
  return (
    <div>
      <div style={{ ...s.card, marginBottom: 12 }}>
        <Montos m={total} variante="grande" />
        <div style={{ ...s.meta, marginTop: 6 }}>
          {num(obras.length)} obras · {num(totalN)} hallazgos abiertos{filtrando && ' (según filtros)'}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {obras.map((o) => <Tarjeta key={o.caso.caso_id} o={o} onAbrir={onAbrir} />)}
      </div>
    </div>
  )
}

function Tarjeta({ o, onAbrir }) {
  const c = o.caso
  const est = ESTADOS_CASO[c.estado] || ESTADOS_CASO.nuevo
  return (
    <div style={{ ...s.card, marginBottom: 0, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8,
      borderLeft: `4px solid ${est.fg}` }} onClick={() => onAbrir(c.obra)}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{c.obra_nombre || c.obra}</div>
          <div style={s.meta}>{c.obra}</div>
        </div>
        <span style={s.chip(est.bg, est.fg)}>{est.label}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 17 }}><Montos m={o.m} /></span>
        <span style={s.meta}>{num(o.abiertos)} hallazgos</span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {ORDEN_TIPOS.filter((t) => o.porTipo[t]).map((t) => (
          <span key={t} style={s.chip(TIPOS_HALLAZGO[t].bg, TIPOS_HALLAZGO[t].fg)}>
            {TIPOS_HALLAZGO[t].corto} · {num(o.porTipo[t])}
          </span>
        ))}
      </div>

      <div style={{ fontSize: 13, color: C.gris, display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
        <span>Más viejo: {ddmm(o.fechaMasVieja)} ({num(o.diasMasViejo)} días)</span>
        {o.nuevos > 0 && <span style={{ color: C.rojo, fontWeight: 700 }}>{num(o.nuevos)} nuevos desde la última gestión</span>}
      </div>

      <div style={{ fontSize: 13, borderTop: `1px solid ${C.borde}`, paddingTop: 6, color: c.ultima_gestion_fecha ? C.texto : C.gris }}>
        {c.ultima_gestion_fecha
          ? <><b>{GESTION_LABEL[c.ultima_gestion_tipo] || 'Gestión'} {ddmm(c.ultima_gestion_fecha)}:</b> {recortar(c.ultima_gestion_texto, 110)}</>
          : 'Sin gestiones todavía'}
      </div>
    </div>
  )
}

const recortar = (t, n) => (!t ? '' : t.length > n ? t.slice(0, n - 1) + '…' : t)
