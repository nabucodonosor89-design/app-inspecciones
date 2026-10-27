import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../utils/ui'
import { C, s, num, ddmm, coincide } from './constantes'
import DetalleInspeccion from '../DetalleInspeccion'

// ============================================================
// CORRECTIVOS — pestaña "Hallazgos"
// Inspecciones periódicas con ítems críticos en falla, hasta que la(s)
// orden(es) SAP del aviso lleguen a cierre técnico (CTEC/CERR).
// Datos y acciones solo por RPC: hallazgos_listar, cargar_aviso_hallazgo,
// cerrar_hallazgo_sin_aviso, reabrir_hallazgo (ver supabase/correctivos_hallazgos.sql).
// ============================================================

const ESTADOS = {
  sin_aviso: { label: 'Sin aviso', fg: C.rojo, bg: C.rojoBg },
  aviso_sin_orden: { label: 'Aviso sin orden', fg: C.ambar, bg: C.ambarBg },
  en_curso: { label: 'En curso', fg: C.azul, bg: C.azulBg },
  resuelto: { label: 'Resuelto', fg: C.verde, bg: C.verdeBg },
  cerrado_sin_aviso: { label: 'Cerrado sin aviso', fg: C.gris, bg: '#f3f4f6' },
}
const ORDEN_ESTADOS = ['sin_aviso', 'aviso_sin_orden', 'en_curso', 'resuelto', 'cerrado_sin_aviso']
const POR_DEFECTO = ['sin_aviso', 'aviso_sin_orden', 'en_curso']

const btn = { minHeight: 40, padding: '0 14px', border: `1px solid ${C.borde}`, background: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }
const btnAzul = { ...btn, background: C.azul, borderColor: C.azul, color: '#fff' }

function Chip({ estado }) {
  const e = ESTADOS[estado] || { label: estado, fg: C.gris, bg: '#f3f4f6' }
  return <span style={s.chip(e.bg, e.fg)}>{e.label}</span>
}

function CerrarModal({ fila, onCancelar, onListo }) {
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const guardar = async () => {
    if (!motivo.trim()) { toast('El motivo es obligatorio', 'error'); return }
    setGuardando(true)
    const { error } = await supabase.rpc('cerrar_hallazgo_sin_aviso', { p_id: fila.id, p_motivo: motivo })
    setGuardando(false)
    if (error) { toast('❌ ' + error.message, 'error'); return }
    toast('Hallazgo cerrado sin aviso')
    onListo()
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onCancelar}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 16, width: '100%', maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 6px', fontSize: 18 }}>Cerrar sin aviso</h3>
        <div style={{ ...s.meta, marginBottom: 10 }}>{fila.equipo} · inspección del {ddmm(fila.fecha_hora)}</div>
        <textarea style={{ ...s.input, minHeight: 90, fontFamily: 'inherit' }} autoFocus
          placeholder="Motivo (obligatorio): ej. se reparó en obra, falla mal cargada…" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btn} onClick={onCancelar} disabled={guardando}>Cancelar</button>
          <button style={{ ...btnAzul, opacity: motivo.trim() ? 1 : 0.5 }} onClick={guardar} disabled={guardando || !motivo.trim()}>
            {guardando ? 'Guardando…' : 'Cerrar hallazgo'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Tarjeta({ f, onRecargar, onVerInspeccion, onCerrar }) {
  const [editando, setEditando] = useState(false)
  const [aviso, setAviso] = useState(f.numero_aviso || '')
  const [guardando, setGuardando] = useState(false)

  const guardarAviso = async () => {
    const v = aviso.trim()
    if (v && !/^\d+$/.test(v)) { toast('El N° de aviso debe tener solo dígitos', 'error'); return }
    setGuardando(true)
    const { error } = await supabase.rpc('cargar_aviso_hallazgo', { p_id: f.id, p_numero_aviso: v || null })
    setGuardando(false)
    if (error) { toast('❌ ' + error.message, 'error'); return }
    toast(v ? `Aviso ${v} cargado` : 'Aviso quitado')
    setEditando(false)
    onRecargar()
  }

  const reabrir = async () => {
    const { error } = await supabase.rpc('reabrir_hallazgo', { p_id: f.id })
    if (error) { toast('❌ ' + error.message, 'error'); return }
    toast('Hallazgo reabierto')
    onRecargar()
  }

  return (
    <div style={{ border: `1px solid ${f.alerta ? C.rojo : C.borde}`, background: f.alerta ? '#fff7f7' : '#fff', borderRadius: 10, padding: 12, marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Chip estado={f.estado} />
        <span style={{ fontWeight: 700, color: f.alerta ? C.rojo : C.texto }}>{num(f.dias)} {f.dias === 1 ? 'día' : 'días'}</span>
        <span style={s.meta}>· {ddmm(f.fecha_hora)} · {f.ubicacion || 'sin obra'} · {f.inspector || 'inspector —'}</span>
      </div>

      <div style={{ marginTop: 8 }}>
        {(f.items || []).length === 0 && <div style={s.meta}>La inspección ya no tiene críticos en falla (se editó).</div>}
        {(f.items || []).map((it, i) => (
          <div key={i} style={{ fontSize: 14, padding: '3px 0' }}>
            ❌ <strong>{it.item_nombre}</strong>{it.observacion ? <span style={{ color: C.gris }}> — {it.observacion}</span> : null}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 8, fontSize: 14 }}>
        {editando ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input style={{ ...s.input, flex: '1 1 160px', width: 'auto' }} inputMode="numeric" placeholder="N° de aviso SAP" autoFocus
              value={aviso} onChange={(e) => setAviso(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && guardarAviso()} />
            <button style={btnAzul} onClick={guardarAviso} disabled={guardando}>{guardando ? '…' : 'Guardar'}</button>
            <button style={btn} onClick={() => { setEditando(false); setAviso(f.numero_aviso || '') }}>Cancelar</button>
          </div>
        ) : f.numero_aviso ? (
          <div>
            Aviso <strong>{f.numero_aviso}</strong>
            <span style={s.meta}> · {f.aviso_cargado_por || '—'} {f.aviso_cargado_en ? `el ${ddmm(f.aviso_cargado_en)}` : ''}</span>
          </div>
        ) : null}
        {f.cierre_manual && (
          <div style={{ ...s.meta, marginTop: 4 }}>Cerrado por {f.cerrado_por || '—'} el {ddmm(f.cerrado_en)}: <em>{f.motivo_cierre}</em></div>
        )}
      </div>

      {(f.ordenes || []).length > 0 && (
        <div style={{ marginTop: 8 }}>
          {f.ordenes.map((o) => (
            <div key={o.orden} style={{ fontSize: 13, padding: '2px 0', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={s.chip(o.cerrada ? C.verdeBg : C.azulBg, o.cerrada ? C.verde : C.azul)}>{o.orden}{o.clase_orden ? ` · ${o.clase_orden}` : ''}</span>
              <span style={{ color: C.gris }}>{o.status_sistema || '—'}</span>
              {o.texto && <span>{o.texto}</span>}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        <button style={btn} onClick={() => onVerInspeccion(f)}>📷 Ver inspección</button>
        {!f.cierre_manual && !editando && (
          <button style={btn} onClick={() => setEditando(true)}>{f.numero_aviso ? 'Editar aviso' : 'Cargar aviso'}</button>
        )}
        {!f.cierre_manual && !f.numero_aviso && <button style={btn} onClick={() => onCerrar(f)}>Cerrar sin aviso</button>}
        {f.cierre_manual && <button style={btn} onClick={reabrir}>Reabrir</button>}
      </div>
    </div>
  )
}

export default function Hallazgos({ recarga }) {
  const [filas, setFilas] = useState(null)
  const [error, setError] = useState(null)
  const [estados, setEstados] = useState(POR_DEFECTO)
  const [busqueda, setBusqueda] = useState('')
  const [cerrando, setCerrando] = useState(null)
  const [detalle, setDetalle] = useState(null)

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('hallazgos_listar')
    if (e) { setError(e.message); return }
    setError(null)
    setFilas(data || [])
  }, [])

  useEffect(() => { cargar() }, [cargar, recarga])

  const conteo = useMemo(() => {
    const m = {}
    ;(filas || []).forEach((f) => { m[f.estado] = (m[f.estado] || 0) + 1 })
    return m
  }, [filas])

  // Agrupar por equipo; el grupo toma la prioridad de su peor tarjeta
  const grupos = useMemo(() => {
    const q = busqueda.trim()
    const visibles = (filas || []).filter((f) => estados.includes(f.estado) &&
      coincide(q, f.equipo, f.denominacion, f.ubicacion, f.numero_aviso, f.inspector, ...(f.items || []).map((i) => i.item_nombre)))
    const m = new Map()
    visibles.forEach((f) => {
      if (!m.has(f.equipo_id)) m.set(f.equipo_id, { equipo_id: f.equipo_id, equipo: f.equipo, denominacion: f.denominacion, filas: [] })
      m.get(f.equipo_id).filas.push(f)
    })
    const clave = (f) => [f.estado === 'sin_aviso' ? 0 : 1, -(f.dias || 0)]
    const cmp = (a, b) => { const x = clave(a), y = clave(b); return x[0] - y[0] || x[1] - y[1] }
    const lista = [...m.values()]
    lista.forEach((g) => { g.filas.sort(cmp); g.peor = g.filas[0]; g.alerta = g.filas.some((f) => f.alerta) })
    return lista.sort((a, b) => cmp(a.peor, b.peor))
  }, [filas, estados, busqueda])

  const toggle = (e) => setEstados((p) => (p.includes(e) ? p.filter((x) => x !== e) : [...p, e]))

  if (detalle) {
    return (
      <div>
        <DetalleInspeccion inspeccion={detalle} onVolver={() => setDetalle(null)} />
      </div>
    )
  }

  const verInspeccion = (f) => setDetalle({
    id: f.inspeccion_id, semaforo: f.semaforo, tipo_inspeccion: f.tipo_inspeccion, fecha_hora: f.fecha_hora,
    ubicacion: f.ubicacion, horometro_odometro: f.horometro_odometro, observaciones_generales: f.observaciones_generales,
    equipos: { numero_identificacion: f.equipo, denominacion: f.denominacion },
    usuarios: { nombre_completo: f.inspector },
  })

  return (
    <div>
      <div style={s.card}>
        <div style={s.chips}>
          {ORDEN_ESTADOS.map((e) => (
            <button key={e} style={s.chipBtn(estados.includes(e))} onClick={() => toggle(e)}>
              {ESTADOS[e].label} · {num(conteo[e] || 0)}
            </button>
          ))}
        </div>
        <input style={s.input} placeholder="Buscar equipo, obra, aviso, inspector o ítem…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        <div style={{ ...s.meta, fontSize: 12, marginTop: 6 }}>
          Inspecciones periódicas con ítems críticos en falla. En rojo: sin aviso hace más de 2 días o aviso sin orden hace más de 7 días (días desde la inspección).
          Resuelto = todas las órdenes del aviso en CTEC o CERR.
        </div>
      </div>

      {error && <div style={s.aviso}>No se pudieron cargar los hallazgos: {error}</div>}
      {!error && filas === null && <div style={s.vacio}>⏳ Cargando…</div>}
      {filas && grupos.length === 0 && <div style={s.vacio}>Sin hallazgos para los filtros elegidos.</div>}

      {grupos.map((g) => (
        <div key={g.equipo_id} style={{ ...s.card, borderColor: g.alerta ? C.rojo : C.borde }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 17, fontWeight: 800 }}>{g.equipo}</span>
            <span style={s.meta}>{g.denominacion}</span>
            {g.filas.length > 1 && <span style={s.chip(C.ambarBg, C.ambar)}>{g.filas.length} inspecciones</span>}
          </div>
          {g.filas.map((f) => (
            <Tarjeta key={f.id + (f.numero_aviso || '') + f.cierre_manual} f={f} onRecargar={cargar} onVerInspeccion={verInspeccion} onCerrar={setCerrando} />
          ))}
        </div>
      ))}

      {cerrando && <CerrarModal fila={cerrando} onCancelar={() => setCerrando(null)} onListo={() => { setCerrando(null); cargar() }} />}
    </div>
  )
}
