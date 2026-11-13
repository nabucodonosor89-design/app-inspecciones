import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../utils/ui'
import { C, s, ddmm, ddmmhhmm, hoyPY } from './constantes'
import { SITUACIONES, SITUACION_POR_ID, ALERTAS, refOrden } from './seguimientoConst'

// ============================================================
// Panel de un hilo de seguimiento: datos SAP, historial y nueva novedad.
// Escritura solo por RPC (corr_seg_*), que validan permisos en el servidor.
// ============================================================

const st = {
  fondo: { position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' },
  panel: { width: 'min(560px, 100%)', height: '100%', background: '#fff', overflowY: 'auto', padding: 16, boxSizing: 'border-box' },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: C.gris, margin: '10px 0 4px' },
}

export function ChipSituacion({ id }) {
  const x = SITUACION_POR_ID[id]
  if (!x) return null
  return <span style={s.chip(x.bg, x.fg)}>{x.label}</span>
}

export function ChipsAlertas({ alertas }) {
  return (alertas || []).map((a) => {
    const x = ALERTAS[a]
    return x ? <span key={a} title={x.ayuda} style={{ ...s.chip(x.bg, x.fg), marginRight: 4 }}>{x.label}</span> : null
  })
}

export function FormNovedad({ responsables, onGuardar, guardando, textoBoton = 'Guardar novedad', inicial }) {
  const [texto, setTexto] = useState('')
  const [situacion, setSituacion] = useState(inicial?.situacion || '')
  const [responsable, setResponsable] = useState('')
  const [fecha, setFecha] = useState('')

  const enviar = async (e) => {
    e.preventDefault()
    if (!texto.trim() || !situacion) return toast('Completá la novedad y la situación', 'error')
    const ok = await onGuardar({ texto: texto.trim(), situacion, responsable: responsable ? Number(responsable) : null, fecha: fecha || null })
    if (ok) { setTexto(''); setResponsable(''); setFecha('') }
  }

  return (
    <form onSubmit={enviar}>
      <label style={st.label} htmlFor="nov-texto">Novedad</label>
      <textarea id="nov-texto" rows={3} style={{ ...s.input, minHeight: 80, resize: 'vertical' }} value={texto}
        placeholder="Qué pasó, qué se espera…" onChange={(e) => setTexto(e.target.value)} />
      <label style={st.label} htmlFor="nov-sit">Situación</label>
      <select id="nov-sit" style={s.input} value={situacion} onChange={(e) => setSituacion(e.target.value)}>
        <option value="">Elegir…</option>
        {SITUACIONES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px' }}>
          <label style={st.label} htmlFor="nov-resp">Quién la tiene que resolver</label>
          <select id="nov-resp" style={s.input} value={responsable} onChange={(e) => setResponsable(e.target.value)}>
            <option value="">—</option>
            {responsables.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        </div>
        <div style={{ flex: '1 1 150px' }}>
          <label style={st.label} htmlFor="nov-fecha">Fecha compromiso</label>
          <input id="nov-fecha" type="date" style={s.input} value={fecha} min={hoyPY()} onChange={(e) => setFecha(e.target.value)} />
        </div>
      </div>
      <button type="submit" disabled={guardando}
        style={{ ...s.boton, width: '100%', marginTop: 12, background: C.azul, color: '#fff', border: 'none', fontWeight: 700 }}>
        {guardando ? 'Guardando…' : textoBoton}
      </button>
    </form>
  )
}

export default function HiloSheet({ hilo, permisos, responsables, onCerrar, onCambio }) {
  const [historial, setHistorial] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [verTerminar, setVerTerminar] = useState(false)

  const puedeCargar = permisos?.gestiona || (permisos?.ubicaciones || []).includes(hilo.ubicacion)

  const [version, setVersion] = useState(0)
  const cargar = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    let vivo = true
    supabase.rpc('corr_seg_novedades', { p_id: hilo.id }).then(({ data, error }) => {
      if (!vivo) return
      if (error) toast('❌ ' + error.message, 'error')
      else setHistorial(data || [])
    })
    return () => { vivo = false }
  }, [hilo.id, version])

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onCerrar])

  const guardar = async ({ texto, situacion, responsable, fecha }) => {
    setGuardando(true)
    const { error } = await supabase.rpc('corr_seg_agregar_novedad', {
      p_seguimiento: hilo.id, p_texto: texto, p_situacion: situacion, p_responsable: responsable, p_fecha_compromiso: fecha,
    })
    setGuardando(false)
    if (error) { toast('❌ ' + error.message, 'error'); return false }
    toast('✅ Novedad guardada')
    cargar(); onCambio()
    return true
  }

  const terminar = async () => {
    if (!motivo.trim()) return toast('Indicá el motivo', 'error')
    const { error } = await supabase.rpc('corr_seg_terminar', { p_id: hilo.id, p_motivo: motivo.trim() })
    if (error) return toast('❌ ' + error.message, 'error')
    toast('✅ Seguimiento terminado'); onCambio(); onCerrar()
  }

  const reabrir = async () => {
    const { error } = await supabase.rpc('corr_seg_reabrir', { p_id: hilo.id })
    if (error) return toast('❌ ' + error.message, 'error')
    toast('✅ Seguimiento reabierto'); onCambio(); onCerrar()
  }

  return (
    <div style={st.fondo} onClick={onCerrar}>
      <div style={st.panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Seguimiento ${hilo.equipo}`}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{hilo.equipo}</div>
            <div style={s.meta}>{(hilo.denominacion || '').trim() || '—'}</div>
          </div>
          <button style={s.boton} onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>

        <div style={{ ...s.card, marginTop: 10, fontSize: 14 }}>
          <div><strong>{refOrden(hilo)}</strong>{hilo.orden && hilo.aviso ? <span style={s.meta}> · aviso {hilo.aviso}</span> : null}
            {hilo.origen === 'manual' && !hilo.orden && <span style={{ ...s.chip(C.ambarBg, C.ambar), marginLeft: 6 }}>aviso sin orden SAP</span>}
          </div>
          <div style={{ marginTop: 4 }}>{hilo.descripcion || '—'}</div>
          <div style={{ ...s.meta, marginTop: 4 }}>
            {hilo.ubicacion || 'sin ubicación'}
            {hilo.status_usuario ? ` · SAP ${hilo.status_usuario}${hilo.abierta_sap === false ? ' (cerrada)' : ''}` : ''}
            {hilo.fecha_entrada ? ` · entrada ${ddmm(hilo.fecha_entrada)} (${hilo.dias_abierta} d)` : ''}
          </div>
          {hilo.alertas?.length > 0 && <div style={{ marginTop: 8 }}><ChipsAlertas alertas={hilo.alertas} /></div>}
          {hilo.alertas?.map((a) => ALERTAS[a] && <div key={a} style={{ ...s.meta, marginTop: 4 }}>• {ALERTAS[a].ayuda}</div>)}
          {hilo.terminado && <div style={{ ...s.aviso, marginTop: 8, marginBottom: 0 }}>Terminado {ddmmhhmm(hilo.terminado_en)}: {hilo.motivo_termino}</div>}
        </div>

        {puedeCargar && !hilo.terminado && (
          <div style={s.card}>
            <div style={s.subtitulo}>Nueva novedad</div>
            <FormNovedad responsables={responsables} onGuardar={guardar} guardando={guardando} inicial={{ situacion: hilo.ult_situacion }} />
          </div>
        )}

        <div style={s.subtitulo}>Historial</div>
        {historial === null && <div style={s.meta}>⏳ Cargando…</div>}
        {historial && historial.length === 0 && <div style={s.meta}>Todavía no hay novedades.</div>}
        {historial && historial.map((n) => (
          <div key={n.id} style={{ borderLeft: `3px solid ${SITUACION_POR_ID[n.situacion]?.fg || C.borde}`, padding: '6px 10px', marginBottom: 8, background: C.fondo, borderRadius: 6 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <ChipSituacion id={n.situacion} />
              {n.responsable && <span style={s.meta}>→ {n.responsable}</span>}
              {n.fecha_compromiso && <span style={s.meta}>· para {ddmm(n.fecha_compromiso)}</span>}
            </div>
            <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{n.texto}</div>
            <div style={{ ...s.meta, marginTop: 2 }}>{n.autor || '—'} · {ddmmhhmm(n.creado_en)}</div>
          </div>
        ))}

        {permisos?.gestiona && (
          <div style={{ marginTop: 16, borderTop: `1px solid ${C.borde}`, paddingTop: 12 }}>
            {hilo.terminado ? (
              <button style={s.boton} onClick={reabrir}>↺ Reabrir seguimiento</button>
            ) : !verTerminar ? (
              <button style={{ ...s.boton, color: C.verde, borderColor: C.verde }} onClick={() => setVerTerminar(true)}>✓ Terminar seguimiento</button>
            ) : (
              <div>
                <label style={st.label} htmlFor="motivo">Motivo (ej.: equipo liberado, orden cerrada, aviso duplicado)</label>
                <input id="motivo" style={s.input} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button style={{ ...s.boton, background: C.verde, color: '#fff', border: 'none', fontWeight: 700 }} onClick={terminar}>Terminar</button>
                  <button style={s.boton} onClick={() => setVerTerminar(false)}>Cancelar</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
