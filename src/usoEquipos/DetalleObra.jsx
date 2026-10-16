import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../utils/ui'
import {
  C, s, num, ddmm, ddmmhhmm, gs, gsCorto, cant, litros,
  TIPOS_HALLAZGO, ORDEN_TIPOS, ESTADOS_CASO, GESTION_LABEL, ORIGEN_OBRA,
} from './constantes'
import GestionSheet from './GestionSheet'

/**
 * Detalle de una obra: hallazgos abiertos agrupados por equipo, acciones y bitácora del caso.
 * hallazgos: filas de v_uso_hallazgos_abiertos de esta obra (ya filtradas)
 */
export default function DetalleObra({ caso, hallazgos, esGerencia, onVolver, onCambio }) {
  const [sel, setSel] = useState(() => new Set())
  const [abiertos, setAbiertos] = useState(() => new Set())
  const [sheet, setSheet] = useState(null) // gestion | escalar | devolver | nota | justificar
  const [bitacora, setBitacora] = useState([])
  const [cargandoBit, setCargandoBit] = useState(true)

  const [versionBit, setVersionBit] = useState(0)
  const casoId = caso.caso_id

  // Bitácora del caso (se recarga al cambiar de caso o después de cada acción)
  useEffect(() => {
    let vivo = true
    supabase.from('uso_caso_gestiones')
      .select('id, tipo, texto, created_at').eq('caso_id', casoId)
      .order('created_at', { ascending: false }).limit(200)
      .then(({ data, error }) => {
        if (!vivo) return
        setCargandoBit(false)
        if (error) { toast('❌ Bitácora: ' + error.message, 'error'); return }
        setBitacora(data || [])
      })
    return () => { vivo = false }
  }, [casoId, versionBit])

  // Agrupar por equipo; equipos ordenados por monto (sin monto al final, por antigüedad)
  const equipos = useMemo(() => {
    const m = new Map()
    hallazgos.forEach((h) => {
      if (!m.has(h.equipo)) m.set(h.equipo, { equipo: h.equipo, denominacion: h.denominacion, tipo_equipo: h.tipo_equipo, clase: h.clase, unidad: h.unidad, filas: [], monto: 0, conMonto: false, masViejo: h.fecha, porTipo: {} })
      const e = m.get(h.equipo)
      e.filas.push(h)
      if (h.monto != null) { e.monto += Number(h.monto); e.conMonto = true }
      if (h.fecha < e.masViejo) e.masViejo = h.fecha
      e.porTipo[h.tipo] = (e.porTipo[h.tipo] || 0) + 1
    })
    const lista = [...m.values()]
    lista.forEach((e) => e.filas.sort((a, b) => (Number(b.monto) || 0) - (Number(a.monto) || 0) || a.fecha.localeCompare(b.fecha)))
    return lista.sort((a, b) => (b.conMonto - a.conMonto) || (b.monto - a.monto) || a.masViejo.localeCompare(b.masViejo))
  }, [hallazgos])

  // La selección solo conserva hallazgos visibles
  const visibles = useMemo(() => new Set(hallazgos.map((h) => h.id)), [hallazgos])
  const seleccion = [...sel].filter((id) => visibles.has(id))

  const tiposPresentes = ORDEN_TIPOS.filter((t) => hallazgos.some((h) => h.tipo === t))
  const porUbicacion = hallazgos.filter((h) => h.obra_origen === 4).length
  const monto = hallazgos.reduce((a, h) => a + (Number(h.monto) || 0), 0)
  const est = ESTADOS_CASO[caso.estado] || ESTADOS_CASO.nuevo

  const toggle = (id) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleEquipo = (e) => setSel((p) => {
    const n = new Set(p)
    const todos = e.filas.every((f) => n.has(f.id))
    e.filas.forEach((f) => (todos ? n.delete(f.id) : n.add(f.id)))
    return n
  })
  const toggleAbierto = (eq) => setAbiertos((p) => { const n = new Set(p); n.has(eq) ? n.delete(eq) : n.add(eq); return n })

  function hecho() {
    setSheet(null)
    setSel(new Set())
    setVersionBit((v) => v + 1)
    onCambio()
  }

  const puedeGestion = caso.estado === 'nuevo' || caso.estado === 'en_gestion'

  return (
    <div>
      <button style={{ ...s.boton, marginBottom: 10 }} onClick={onVolver}>← Bandeja</button>

      <div style={{ ...s.card, borderLeft: `4px solid ${est.fg}` }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h3 style={{ margin: 0 }}>{caso.obra_nombre || caso.obra}</h3>
            <div style={s.meta}>{caso.obra} · caso desde {ddmm(caso.creado_at)}</div>
          </div>
          <span style={s.chip(est.bg, est.fg)}>{est.label}</span>
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '10px 0' }}>
          <div><div style={{ fontSize: 22, fontWeight: 800 }}>{gsCorto(monto)}</div><div style={s.meta}>sin respaldo</div></div>
          <div><div style={{ fontSize: 22, fontWeight: 800 }}>{num(hallazgos.length)}</div><div style={s.meta}>hallazgos</div></div>
          <div><div style={{ fontSize: 22, fontWeight: 800 }}>{num(equipos.length)}</div><div style={s.meta}>equipos</div></div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {puedeGestion && <button style={{ ...s.boton, background: C.azul, color: '#fff', border: 'none', fontWeight: 700 }} onClick={() => setSheet('gestion')}>Registrar gestión</button>}
          {caso.estado !== 'escalado' && <button style={{ ...s.boton, fontWeight: 600 }} onClick={() => setSheet('escalar')}>Escalar</button>}
          {esGerencia && caso.estado === 'escalado' && <button style={{ ...s.boton, fontWeight: 600 }} onClick={() => setSheet('devolver')}>Devolver a gestión</button>}
          {esGerencia && <button style={{ ...s.boton, fontWeight: 600 }} onClick={() => setSheet('nota')}>Nota de gerencia</button>}
          <button style={{ ...s.boton, fontWeight: 600, color: seleccion.length ? C.verde : C.gris }} disabled={!seleccion.length}
            onClick={() => setSheet('justificar')}>
            Justificar{seleccion.length ? ` (${num(seleccion.length)})` : ''}
          </button>
        </div>
      </div>

      {/* Qué pedirle a la obra, por tipo presente */}
      <div style={s.card}>
        <div style={s.subtitulo}>Qué pedirle a la obra</div>
        {tiposPresentes.map((t) => (
          <div key={t} style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={s.chip(TIPOS_HALLAZGO[t].bg, TIPOS_HALLAZGO[t].fg)}>{TIPOS_HALLAZGO[t].label}</span>
            <span style={{ fontSize: 14 }}>{TIPOS_HALLAZGO[t].ayuda}</span>
          </div>
        ))}
        {porUbicacion > 0 && (
          <div style={{ ...s.aviso, marginTop: 8, marginBottom: 0 }}>
            📍 {num(porUbicacion)} hallazgo(s) con la obra deducida por la {ORIGEN_OBRA[4]} del equipo (no había parte ni imputación cercana). Pueden pertenecer a otra obra.
          </div>
        )}
      </div>

      {/* Hallazgos por equipo */}
      <div style={s.subtitulo}>Hallazgos por equipo</div>
      {equipos.map((e) => {
        const abierto = abiertos.has(e.equipo)
        const todos = e.filas.every((f) => sel.has(f.id))
        const algunos = !todos && e.filas.some((f) => sel.has(f.id))
        return (
          <div key={e.equipo} style={{ ...s.card, padding: 0 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 10, cursor: 'pointer', flexWrap: 'wrap' }} onClick={() => toggleAbierto(e.equipo)}>
              <input type="checkbox" checked={todos} ref={(el) => { if (el) el.indeterminate = algunos }}
                onClick={(ev) => ev.stopPropagation()} onChange={() => toggleEquipo(e)} style={{ width: 20, height: 20 }}
                aria-label={`Seleccionar hallazgos de ${e.equipo}`} />
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontWeight: 700 }}>{e.equipo} <span style={{ ...s.meta, fontWeight: 400 }}>{(e.denominacion || '').replace(e.equipo, '').trim()}</span></div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                  {ORDEN_TIPOS.filter((t) => e.porTipo[t]).map((t) => (
                    <span key={t} style={s.chip(TIPOS_HALLAZGO[t].bg, TIPOS_HALLAZGO[t].fg)}>{TIPOS_HALLAZGO[t].corto} · {e.porTipo[t]}</span>
                  ))}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700 }}>{e.conMonto ? gsCorto(e.monto) : '—'}</div>
                <div style={s.meta}>{abierto ? '▲' : '▼'} {e.filas.length} día(s)</div>
              </div>
            </div>
            {abierto && <TablaDias filas={e.filas} sel={sel} toggle={toggle} />}
          </div>
        )
      })}

      {/* Bitácora */}
      <div style={s.card}>
        <div style={s.subtitulo}>Bitácora del caso</div>
        {cargandoBit ? <div style={s.meta}>Cargando…</div> : !bitacora.length ? <div style={s.meta}>Sin registros.</div> : (
          bitacora.map((b) => (
            <div key={b.id} style={{ borderBottom: `1px solid ${C.borde}`, padding: '6px 0', fontSize: 14 }}>
              <span style={{ ...s.meta, marginRight: 8 }}>{ddmmhhmm(b.created_at)}</span>
              <b style={{ color: b.tipo === 'auto' ? C.gris : C.texto }}>{GESTION_LABEL[b.tipo] || b.tipo}:</b>{' '}
              <span style={{ color: b.tipo === 'auto' ? C.gris : C.texto }}>{b.texto}</span>
            </div>
          ))
        )}
      </div>

      {sheet && (
        <GestionSheet modo={sheet} caso={caso} hallazgos={seleccion} onCerrar={() => setSheet(null)} onHecho={hecho} />
      )}
    </div>
  )
}

function TablaDias({ filas, sel, toggle }) {
  return (
    <div style={{ ...s.scroll, borderTop: `1px solid ${C.borde}` }}>
      <table style={s.tabla}>
        <thead>
          <tr>
            <th style={s.th}></th>
            <th style={s.th}>Día</th>
            <th style={s.th}>Tipo</th>
            <th style={s.th}>Rastreo</th>
            <th style={s.th}>Parte</th>
            <th style={s.th}>SAP</th>
            <th style={s.th}>Combustible</th>
            <th style={s.th}>Diferencia</th>
            <th style={s.th}>Monto</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((h) => {
            const t = TIPOS_HALLAZGO[h.tipo]
            const comb = h.tipo === 'combustible_sin_parte'
            return (
              <tr key={h.id} style={{ background: sel.has(h.id) ? '#f0fdf4' : undefined }}>
                <td style={s.td}><input type="checkbox" checked={sel.has(h.id)} onChange={() => toggle(h.id)} style={{ width: 18, height: 18 }} aria-label="Seleccionar" /></td>
                <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                  {comb ? <>carga {ddmm(h.fecha)}<div style={s.meta}>sin partes {ddmm(h.periodo_desde)}–{ddmm(h.periodo_hasta)}</div></> : ddmm(h.fecha)}
                  {h.obra_origen === 4 && <span title="Obra deducida por la ubicación actual"> 📍</span>}
                </td>
                <td style={s.td}><span style={s.chip(t.bg, t.fg)}>{t.corto}</span></td>
                <td style={s.td}>{cant(h.rastreo_q, h.unidad)}</td>
                <td style={s.td}>{cant(h.parte_q, h.unidad)}</td>
                <td style={s.td}>{cant(h.sap_q, h.unidad)}</td>
                <td style={s.td}>{litros(h.litros)}</td>
                <td style={{ ...s.td, fontWeight: 600 }}>{comb ? '—' : cant(h.cantidad_sin_respaldo, h.unidad)}</td>
                <td style={{ ...s.td, whiteSpace: 'nowrap' }} title={h.costo_unitario ? `${gs(h.costo_unitario)} por ${h.unidad}` : undefined}>
                  {h.monto != null ? gs(h.monto) : '—'}
                  {h.costo_por_clase && <span title="Costo promedio de la clase (el equipo no tiene costo propio)"> ≈</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
