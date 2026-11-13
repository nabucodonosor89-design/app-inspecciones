import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../utils/ui'
import { C, s, num, ddmm, coincide, LIMITE } from './constantes'
import { SITUACIONES, ALERTAS, refOrden } from './seguimientoConst'
import HiloSheet, { ChipSituacion, ChipsAlertas, FormNovedad } from './HiloSheet'

// ============================================================
// SEGUIMIENTO DE CORRECTIVOS — un hilo de novedades por orden/aviso.
// Reemplaza la planilla del encargado de mantenimiento correctivo.
// Datos: RPC corr_seg_listar() (ya filtra por permisos: encargado/admin ven todo,
// residentes solo las ubicaciones de su zona). Ver supabase/correctivos_seguimiento.sql
// modo: 'completo' (dentro de Correctivos) | 'residente' (tarjeta Seguimiento correctivos)
// ============================================================

const PRIORIDAD_ALERTA = ['compromiso_vencido', 'otes_con_trabajo', 'cerrada_sap_con_seguimiento', 'equipo_distinto', 'sin_seguimiento', 'terminado_abierta_sap']

function AltaAviso({ responsables, onCreado, onCancelar }) {
  const [equipo, setEquipo] = useState('')
  const [aviso, setAviso] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [guardando, setGuardando] = useState(false)

  const guardar = async (nov) => {
    if (!equipo.trim() || !/^1\d{7}$/.test(aviso.trim())) {
      toast('Completá el equipo y un aviso de 8 dígitos que empiece con 1', 'error')
      return false
    }
    setGuardando(true)
    const { data, error } = await supabase.rpc('corr_seg_alta_aviso', {
      p_equipo: equipo.trim(), p_aviso: Number(aviso.trim()), p_descripcion: descripcion.trim() || null,
      p_texto: nov.texto, p_situacion: nov.situacion, p_responsable: nov.responsable, p_fecha_compromiso: nov.fecha,
    })
    setGuardando(false)
    if (error) { toast('❌ ' + error.message, 'error'); return false }
    if (data?.existente) toast('⚠ Ese aviso ya tenía seguimiento: te lo abro para que cargues la novedad ahí', 'warning')
    else toast('✅ Aviso cargado')
    onCreado(data?.id)
    return true
  }

  return (
    <div style={s.card}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ ...s.subtitulo, flex: 1, margin: 0 }}>Nuevo aviso (sin orden en SAP)</div>
        <button style={s.boton} onClick={onCancelar} aria-label="Cancelar">✕</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <input style={{ ...s.input, flex: '1 1 140px', width: 'auto', textTransform: 'uppercase' }} placeholder="Equipo (ej. PS-GR004)"
          value={equipo} onChange={(e) => setEquipo(e.target.value)} aria-label="Equipo" />
        <input style={{ ...s.input, flex: '1 1 140px', width: 'auto' }} placeholder="N° de aviso" inputMode="numeric"
          value={aviso} onChange={(e) => setAviso(e.target.value.replace(/\D/g, '').slice(0, 8))} aria-label="Aviso" />
      </div>
      <input style={{ ...s.input, marginTop: 8 }} placeholder="Descripción de la avería" value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)} aria-label="Descripción" />
      <div style={{ ...s.meta, marginTop: 6 }}>Primera novedad:</div>
      <FormNovedad responsables={responsables} guardando={guardando} textoBoton="Cargar aviso"
        onGuardar={(nov) => guardar(nov)} />
    </div>
  )
}

function Fila({ r, onAbrir }) {
  const urgente = r.alertas?.some((a) => a !== 'sin_seguimiento' && a !== 'terminado_abierta_sap')
  return (
    <div onClick={() => onAbrir(r)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onAbrir(r)}
      style={{ padding: '10px 6px', borderBottom: `1px solid ${C.borde}`, cursor: 'pointer', background: r.terminado ? '#f3f4f6' : urgente ? '#fff7f7' : '#fff' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <strong style={{ minWidth: 90 }}>{r.equipo}</strong>
        <span style={s.meta}>{refOrden(r)}{r.status_usuario ? ` · ${r.status_usuario}` : ''}</span>
        {r.ult_situacion ? <ChipSituacion id={r.ult_situacion} /> : <span style={s.chip('#f3f4f6', C.gris)}>sin novedades</span>}
        {r.ult_responsable && <span style={s.meta}>→ {r.ult_responsable}</span>}
        {r.ult_compromiso && <span style={s.meta}>· para {ddmm(r.ult_compromiso)}</span>}
        <span style={{ flex: 1 }} />
        <ChipsAlertas alertas={r.alertas} />
      </div>
      <div style={{ fontSize: 14, marginTop: 4, color: C.gris }}>{r.descripcion || '—'}</div>
      {r.ult_texto && (
        <div style={{ fontSize: 15, marginTop: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {r.ult_texto} <span style={s.meta}>· {(r.ult_autor || '').split(' ')[0]} hace {num(r.dias_sin_novedad)} d</span>
        </div>
      )}
      {r.terminado && <div style={s.meta}>Terminado: {r.motivo_termino}</div>}
    </div>
  )
}

export default function Seguimiento({ modo = 'completo', recarga }) {
  const [filas, setFilas] = useState([])
  const [permisos, setPermisos] = useState(null)
  const [responsables, setResponsables] = useState([])
  const [cargando, setCargando] = useState(true)
  const [abierto, setAbierto] = useState(null) // id del hilo
  const [verAlta, setVerAlta] = useState(false)
  // filtros
  const [obra, setObra] = useState('')
  const [situacion, setSituacion] = useState('')
  const [responsable, setResponsable] = useState('')
  const [alerta, setAlerta] = useState('')
  const [q, setQ] = useState('')
  const [verTerminados, setVerTerminados] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [l, p, r] = await Promise.all([
        supabase.rpc('corr_seg_listar').limit(LIMITE),
        supabase.rpc('corr_seg_permisos'),
        supabase.rpc('corr_seg_responsables'),
      ])
      if (l.error) throw new Error(l.error.message)
      if (p.error) throw new Error(p.error.message)
      setFilas(l.data || [])
      setPermisos(p.data)
      setResponsables(r.data || [])
    } catch (e) {
      console.error(e)
      toast('❌ Error al cargar el seguimiento: ' + e.message, 'error')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar, recarga])

  const obras = useMemo(() => [...new Set(filas.map((f) => f.ubicacion || '(sin ubicación)'))].sort((a, b) => a.localeCompare(b)), [filas])

  const visibles = useMemo(() => filas.filter((f) =>
    (verTerminados || !f.terminado)
    && (!obra || (f.ubicacion || '(sin ubicación)') === obra)
    && (!situacion || (situacion === '_sin' ? !f.ult_situacion : f.ult_situacion === situacion))
    && (!responsable || f.ult_responsable === responsable)
    && (!alerta || (alerta === '_alguna' ? f.alertas?.length > 0 : f.alertas?.includes(alerta)))
    && coincide(q.trim(), f.equipo, f.orden, f.aviso, f.descripcion, f.ult_texto, f.denominacion)
  ), [filas, verTerminados, obra, situacion, responsable, alerta, q])

  const abiertos = filas.filter((f) => !f.terminado)
  const cuenta = (a) => abiertos.filter((f) => f.alertas?.includes(a)).length
  const conNovedadHoy = abiertos.filter((f) => f.dias_sin_novedad === 0 && f.cant_novedades > 0).length

  const grupos = useMemo(() => {
    const peso = (f) => {
      const i = PRIORIDAD_ALERTA.findIndex((a) => f.alertas?.includes(a))
      return i === -1 ? 99 : i
    }
    const m = new Map()
    visibles.forEach((f) => {
      const k = f.ubicacion || '(sin ubicación)'
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(f)
    })
    return [...m.entries()]
      .map(([nombre, lista]) => ({ nombre, lista: lista.sort((a, b) => peso(a) - peso(b) || b.dias_sin_novedad - a.dias_sin_novedad) }))
      .sort((a, b) => b.lista.length - a.lista.length || a.nombre.localeCompare(b.nombre))
  }, [visibles])

  const hilo = abierto ? filas.find((f) => f.id === abierto) : null
  const puedeAlta = permisos?.gestiona || permisos?.residente

  if (cargando && !filas.length) return <div style={s.vacio}>⏳ Cargando…</div>

  return (
    <div>
      {/* Indicadores (tocables = filtro) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 12 }}>
        {[
          { label: 'abiertos', n: abiertos.length, color: C.texto, filtro: '' },
          { label: 'con novedad hoy', n: conNovedadHoy, color: C.verde, filtro: null },
          { label: 'sin seguimiento (> 3 d)', n: cuenta('sin_seguimiento'), color: C.ambar, filtro: 'sin_seguimiento' },
          { label: 'compromisos vencidos', n: cuenta('compromiso_vencido'), color: C.rojo, filtro: 'compromiso_vencido' },
          { label: 'cerradas en SAP', n: cuenta('cerrada_sap_con_seguimiento'), color: C.rojo, filtro: 'cerrada_sap_con_seguimiento' },
          { label: '0TES con trabajo', n: cuenta('otes_con_trabajo'), color: C.rojo, filtro: 'otes_con_trabajo' },
        ].map((k) => (
          <button key={k.label} disabled={k.filtro === null} onClick={() => setAlerta(alerta === k.filtro ? '' : k.filtro)}
            style={{ textAlign: 'left', background: k.filtro !== null && alerta === k.filtro ? C.azulBg : '#fff', border: `1px solid ${C.borde}`, borderRadius: 10, padding: 10, cursor: k.filtro === null ? 'default' : 'pointer', color: 'inherit' }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: k.color }}>{num(k.n)}</div>
            <div style={{ fontSize: 13, color: C.gris }}>{k.label}</div>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <input style={{ ...s.input, flex: '2 1 220px', width: 'auto' }} placeholder="Buscar equipo, orden, aviso o texto…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        {obras.length > 1 && (
          <select style={{ ...s.input, flex: '1 1 180px', width: 'auto' }} value={obra} onChange={(e) => setObra(e.target.value)} aria-label="Obra">
            <option value="">Todas las obras</option>
            {obras.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        <select style={{ ...s.input, flex: '1 1 160px', width: 'auto' }} value={situacion} onChange={(e) => setSituacion(e.target.value)} aria-label="Situación">
          <option value="">Toda situación</option>
          <option value="_sin">Sin novedades</option>
          {SITUACIONES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        <select style={{ ...s.input, flex: '1 1 160px', width: 'auto' }} value={responsable} onChange={(e) => setResponsable(e.target.value)} aria-label="Responsable">
          <option value="">Cualquier responsable</option>
          {responsables.map((r) => <option key={r.id} value={r.nombre}>{r.nombre}</option>)}
        </select>
        <select style={{ ...s.input, flex: '1 1 160px', width: 'auto' }} value={alerta} onChange={(e) => setAlerta(e.target.value)} aria-label="Alerta">
          <option value="">Con o sin alertas</option>
          <option value="_alguna">Con alguna alerta</option>
          {Object.entries(ALERTAS).map(([id, a]) => <option key={id} value={id}>{a.label}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
          <input type="checkbox" checked={verTerminados} onChange={(e) => setVerTerminados(e.target.checked)} /> Ver terminados (7 días)
        </label>
        <span style={s.meta}>{num(visibles.length)} de {num(filas.length)}</span>
        <span style={{ flex: 1 }} />
        {puedeAlta && !verAlta && (
          <button style={{ ...s.boton, background: C.azul, color: '#fff', border: 'none', fontWeight: 700 }} onClick={() => setVerAlta(true)}>+ Aviso</button>
        )}
        <button style={s.boton} onClick={cargar} disabled={cargando}>{cargando ? '…' : '↻'}</button>
      </div>
      {filas.length >= LIMITE && <div style={s.aviso}>⚠ Mostrando las primeras {num(LIMITE)} filas.</div>}
      {modo === 'completo' && permisos && !permisos.gestiona && <div style={{ ...s.meta, marginBottom: 8 }}>Solo lectura: cargan novedades el encargado y los residentes de cada obra.</div>}

      {verAlta && (
        <AltaAviso responsables={responsables} onCancelar={() => setVerAlta(false)}
          onCreado={async (id) => { setVerAlta(false); await cargar(); if (id) setAbierto(id) }} />
      )}

      {grupos.length === 0 && <div style={{ ...s.card, ...s.vacio }}>No hay seguimientos con estos filtros.</div>}
      {grupos.map((g) => (
        <div key={g.nombre} style={s.card}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontSize: 18, fontWeight: 700 }}>{g.nombre}</span>
            <span style={s.meta}>{g.lista.length}</span>
          </div>
          {g.lista.map((r) => <Fila key={r.id} r={r} onAbrir={(x) => setAbierto(x.id)} />)}
        </div>
      ))}

      {hilo && (
        <HiloSheet hilo={hilo} permisos={permisos} responsables={responsables}
          onCerrar={() => setAbierto(null)} onCambio={cargar} />
      )}
    </div>
  )
}
