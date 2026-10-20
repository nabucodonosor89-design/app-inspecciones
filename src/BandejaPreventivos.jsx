import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { supabase } from './lib/supabase'
import { toast } from './utils/ui'
import {
  leerLibro, prepararHoja, filasIP30, CAMPOS_IP30, colorJ, RANGO_COLOR, abierta, ESTADO_TXT,
  exportarListaObra, exportarListaGeneral, exportarReprogramadas, proximos,
} from './bandejaPreventivos/logica'
import RevisarOrdenModal from './bandejaPreventivos/RevisarOrdenModal.jsx'

// ============================================================
// BANDEJA DE PREVENTIVOS (IP30) — reemplaza a "Completar órdenes IP30"
// Una fila por orden TCPV. La encargada sube el IP30 todas las semanas; la app guarda las órdenes,
// calcula cuánto falta (J = próximo mantenimiento − lectura actual), sugiere un estado y ella confirma.
// Datos: RPC ip30_bandeja / ip30_bandeja_frescura / ip30_subir / ip30_equipos_sin_orden /
//        ip30_contador_pendiente / ip30_sync_cierres (ver supabase/bandeja_preventivos.sql)
// Permiso: usuarios.ve_completar_ordenes
// ============================================================

const C = {
  azul: '#0f766e', azulBg: '#ccfbf1', fondo: '#f9fafb', borde: '#e5e7eb', gris: '#6b7280', texto: '#111827',
  rojo: '#b91c1c', rojoBg: '#fee2e2', ambar: '#b45309', ambarBg: '#fef3c7', verde: '#15803d', verdeBg: '#dcfce7',
  violeta: '#6d28d9', violetaBg: '#ede9fe',
}
const COLOR = {
  rojo: { background: C.rojoBg, color: C.rojo },
  ambar: { background: C.ambarBg, color: C.ambar },
  verde: { background: C.verdeBg, color: C.verde },
  gris: { background: '#f3f4f6', color: C.gris },
}
const COLOR_ESTADO = {
  programado: { background: C.azulBg, color: C.azul },
  reprogramado: { background: C.violetaBg, color: C.violeta },
  concluido: { background: C.verdeBg, color: C.verde },
  cancelado: { background: '#f3f4f6', color: C.gris },
  verificar: { background: C.ambarBg, color: C.ambar },
}
const s = {
  wrap: { maxWidth: 1350, margin: '0 auto', padding: '16px 16px 48px' },
  header: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 },
  boton: { background: 'white', border: `1px solid ${C.borde}`, borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 14 },
  primario: { background: C.azul, color: 'white', border: 'none', borderRadius: 8, padding: '9px 16px', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  input: { padding: '8px 10px', border: `1px solid ${C.borde}`, borderRadius: 8, fontSize: 14, background: 'white', minWidth: 0 },
  card: { background: 'white', border: `1px solid ${C.borde}`, borderRadius: 12, padding: 14, marginBottom: 12 },
  th: { position: 'sticky', top: 0, background: '#f3f4f6', textAlign: 'left', padding: '8px 10px', fontSize: 12, whiteSpace: 'nowrap', borderBottom: `1px solid ${C.borde}`, zIndex: 1 },
  td: { padding: '8px 10px', fontSize: 13, borderBottom: `1px solid ${C.borde}`, verticalAlign: 'top' },
  sub: { fontSize: 11, color: C.gris, marginTop: 2 },
  chip: { borderRadius: 10, padding: '1px 8px', fontWeight: 700, whiteSpace: 'nowrap', display: 'inline-block', fontSize: 12 },
  badge: { borderRadius: 6, padding: '1px 6px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-block', marginRight: 4, marginTop: 3 },
}
const PAGINA = 1000

const fechaCorta = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—')
const fechaHora = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const num = (v, dec = 0) => (v == null ? '—' : Number(v).toLocaleString('es-PY', { maximumFractionDigits: dec }))
const hoyArchivo = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}` }
const den = (r) => (r.denominacion || r.texto || '').replace(/^\S+\s+/, '').trim()

async function rpcTodo(nombre) {
  const todas = []
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await supabase.rpc(nombre).range(desde, desde + PAGINA - 1)
    if (error) throw error
    todas.push(...(data || []))
    if (!data || data.length < PAGINA) break
  }
  return todas
}

// ---------- celdas ----------
function ChipJ({ r }) {
  const c = colorJ(r)
  const u = r.unidad === 'km' ? 'km' : 'h'
  if (r.j == null) return <span style={{ color: C.gris, fontSize: 12 }}>{r.motivo === 'revisar contador' ? 'revisar contador' : 'sin dato'}</span>
  return (
    <>
      <span style={{ ...s.chip, ...COLOR[c] }}>{Number(r.j) < 0 ? `pasado ${num(-r.j, 1)} ${u}` : `falta ${num(r.j, 1)} ${u}`}</span>
      <div style={s.sub}>{r.j_fuente} · {num(r.lectura, 1)} al {fechaCorta(r.lectura_fecha)}</div>
    </>
  )
}

function CeldaProximo({ r, onEditar }) {
  const u = r.unidad === 'km' ? 'km' : 'h'
  return (
    <button onClick={onEditar} title="Cargar o corregir el próximo mantenimiento (de SAP)"
      style={{ border: 'none', background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', color: C.texto, font: 'inherit' }}>
      {r.h == null
        ? <span style={{ color: C.azul, fontWeight: 600 }}>+ cargar</span>
        : <><b>{num(r.h, 1)}</b> {u}</>}
      <div style={s.sub}>
        {r.h_fuente === 'cargado' ? 'cargado' : r.h_fuente === 'calculado' ? 'calculado' : ''}
        {r.h_fuente ? ' · ' : ''}umbral {num(r.umbral)} {u}
      </div>
      {r.h_difiere && <div style={{ ...s.sub, color: C.ambar }}>≠ calculado ({num(r.h_calculado)})</div>}
    </button>
  )
}

function CeldaUltimo({ r }) {
  if (!r.srv_fecha) return <span style={{ color: C.gris, fontSize: 12 }}>sin dato</span>
  return (
    <>
      <div>{r.srv_contador_estado === 'pendiente' ? <span style={{ color: C.ambar }}>falta contador</span> : num(r.srv_contador, 1)} · {fechaCorta(r.srv_fecha)}</div>
      {r.srv_contador_estado === 'estimado' && <div style={{ ...s.sub, color: C.ambar }}>estimado</div>}
    </>
  )
}

function CeldaOrden({ r }) {
  const sap = r.estado_sap === 'abierta' ? null : r.estado_sap
  return (
    <>
      <div style={{ fontWeight: 700 }}>{r.orden}</div>
      <div style={s.sub}>plan {fechaCorta(r.fecha_plan)}{sap ? ` · ${sap}` : ''}</div>
      {r.volvio && <span style={{ ...s.badge, background: C.violetaBg, color: C.violeta }}>volvió{r.fecha_plan_anterior ? ` (antes ${fechaCorta(r.fecha_plan_anterior)})` : ''}</span>}
      {r.sugerencia_cambio && <span style={{ ...s.badge, background: C.ambarBg, color: C.ambar }}>la sugerencia cambió</span>}
      {r.falta_cierre_tecnico && <span style={{ ...s.badge, background: C.rojoBg, color: C.rojo }}>falta cierre técnico</span>}
      {r.salio_sin_cierre && <span style={{ ...s.badge, background: C.rojoBg, color: C.rojo }}>salió del IP30 sin cierre</span>}
    </>
  )
}

function CeldaConfirmado({ r, onRevisar, onAceptar, guardando }) {
  const difiere = r.estado_confirmado && r.estado_sugerido && r.estado_confirmado !== r.estado_sugerido
  const puedeAceptar = r.estado_sugerido && r.estado_sugerido !== 'reprogramado' && (r.estado_confirmado !== r.estado_sugerido || r.pendiente)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      {r.estado_confirmado
        ? <span style={{ ...s.chip, ...COLOR_ESTADO[r.estado_confirmado], outline: difiere ? `2px dashed ${C.ambar}` : 'none' }}
            title={difiere ? 'Distinto del sugerido' : undefined}>
            {ESTADO_TXT[r.estado_confirmado]}{r.estado_confirmado === 'reprogramado' && r.nueva_fecha ? ` → ${fechaCorta(r.nueva_fecha)}` : ''}
          </span>
        : <span style={{ fontSize: 12, color: C.gris }}>sin confirmar</span>}
      {r.notas && <div style={{ ...s.sub, maxWidth: 220, whiteSpace: 'normal' }}>{r.notas}</div>}
      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={onRevisar} style={{ ...s.boton, padding: '4px 10px', fontSize: 12 }}>Revisar</button>
        {puedeAceptar && (
          <button onClick={onAceptar} disabled={guardando} title={`Confirmar ${ESTADO_TXT[r.estado_sugerido]}`}
            style={{ ...s.boton, padding: '4px 10px', fontSize: 12, color: C.azul, borderColor: C.azul }}>
            ✓ {ESTADO_TXT[r.estado_sugerido]}
          </button>
        )}
      </div>
    </div>
  )
}

// ---------- pantalla ----------
const PESTANAS = [
  ['pendientes', 'Pendientes de revisar'],
  ['programado', 'Programadas'],
  ['reprogramado', 'Reprogramadas'],
  ['concluido', 'Concluidas'],
  ['otros', 'Canceladas / verificar'],
  ['todas', 'Todas'],
  ['revisar', 'Revisar'],
  ['cierre', 'Falta cierre técnico'],
  ['sinorden', 'Equipos sin orden'],
  ['contador', 'Contador pendiente'],
]
const FILTRO = {
  pendientes: (r) => r.pendiente,
  programado: (r) => r.estado_confirmado === 'programado',
  reprogramado: (r) => r.estado_confirmado === 'reprogramado',
  concluido: (r) => r.estado_confirmado === 'concluido',
  otros: (r) => ['cancelado', 'verificar'].includes(r.estado_confirmado),
  todas: () => true,
  revisar: (r) => r.salio_sin_cierre,
  cierre: (r) => r.falta_cierre_tecnico,
}

export default function BandejaPreventivos({ onVolver }) {
  const [filas, setFilas] = useState([])
  const [frescura, setFrescura] = useState(null)
  const [sinOrden, setSinOrden] = useState(null)
  const [pendContador, setPendContador] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [pestana, setPestana] = useState('pendientes')
  const [busqueda, setBusqueda] = useState('')
  const [obra, setObra] = useState('')
  const [soloVencidos, setSoloVencidos] = useState(false)
  const [modal, setModal] = useState(null) // { fila, estadoInicial }
  const [guardando, setGuardando] = useState(0)
  const [subida, setSubida] = useState(null) // { nombre, filas, sinOrden, hoja, map, hs }
  const [subiendo, setSubiendo] = useState(false)
  const [sync, setSync] = useState(null)
  const [obraLista, setObraLista] = useState('')
  const inputRef = useRef(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [rows, f] = await Promise.all([rpcTodo('ip30_bandeja'), supabase.rpc('ip30_bandeja_frescura')])
      if (f.error) throw f.error
      setFilas(rows)
      setFrescura((f.data || [])[0] || null)
      setSinOrden(null); setPendContador(null)
    } catch (e) {
      console.error(e)
      toast('❌ Error al cargar la bandeja: ' + e.message, 'error')
    } finally {
      setCargando(false)
    }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  // Pestañas que leen otra RPC: se cargan al entrar
  useEffect(() => {
    if (pestana === 'sinorden' && sinOrden === null) {
      rpcTodo('ip30_equipos_sin_orden').then(setSinOrden).catch((e) => toast('❌ ' + e.message, 'error'))
    }
    if (pestana === 'contador' && pendContador === null) {
      rpcTodo('ip30_contador_pendiente').then(setPendContador).catch((e) => toast('❌ ' + e.message, 'error'))
    }
  }, [pestana, sinOrden, pendContador])

  const obras = useMemo(() => [...new Set(filas.map((r) => r.ubicacion || '(sin ubicación)'))].sort((a, b) => a.localeCompare(b)), [filas])
  const obrasConProximos = useMemo(() => [...new Set(proximos(filas).map((r) => r.ubicacion || '(sin ubicación)'))].sort((a, b) => a.localeCompare(b)), [filas])

  const base = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return filas.filter((r) =>
      (!obra || (r.ubicacion || '(sin ubicación)') === obra)
      && (!q || [String(r.orden), r.equipo, r.denominacion, r.texto].some((v) => (v || '').toLowerCase().includes(q)))
      && (!soloVencidos || colorJ(r) === 'rojo'))
  }, [filas, busqueda, obra, soloVencidos])

  const cuentas = useMemo(() => {
    const c = {}
    for (const [k] of PESTANAS) if (FILTRO[k]) c[k] = base.filter(FILTRO[k]).length
    return c
  }, [base])

  const vista = useMemo(() => {
    if (!FILTRO[pestana]) return []
    return base.filter(FILTRO[pestana]).sort((a, b) => {
      const ca = RANGO_COLOR[colorJ(a)], cb = RANGO_COLOR[colorJ(b)]
      if (ca !== cb) return ca - cb
      if (a.j != null && b.j != null && Number(a.j) !== Number(b.j)) return Number(a.j) - Number(b.j)
      return b.orden - a.orden
    })
  }, [base, pestana])

  // ---------- subir IP30 ----------
  async function elegirArchivo(file) {
    if (!file) return
    if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) { toast('⚠️ El archivo tiene que ser Excel (.xlsx)', 'advertencia'); return }
    try {
      const { wb, hojaSugerida } = leerLibro(await file.arrayBuffer())
      const h = prepararHoja(wb, hojaSugerida)
      const faltan = CAMPOS_IP30.filter((c) => c.obligatorio && !(h.map[c.id] >= 0))
      if (faltan.length) { toast(`❌ No encontré la columna: ${faltan.map((c) => c.label).join(', ')}`, 'error'); return }
      const { filas: fs, sinOrden: so } = filasIP30(h)
      if (!fs.length) { toast('❌ El archivo no trae órdenes', 'error'); return }
      setSubida({ nombre: file.name, filas: fs, sinOrden: so, hoja: hojaSugerida, hs: h.hs, map: h.map })
    } catch (e) {
      console.error(e)
      toast(`❌ No pude leer "${file.name}": ${e.message}`, 'error')
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function confirmarSubida() {
    setSubiendo(true)
    try {
      const { data, error } = await supabase.rpc('ip30_subir', { p_filas: subida.filas, p_archivo: subida.nombre })
      if (error) throw error
      toast(`✅ IP30 cargado: ${data.nuevas} nuevas · ${data.actualizadas} actualizadas · ${data.ausentes} ausentes`, 'exito')
      setSubida(null)
      setPestana('pendientes')
      await cargar()
    } catch (e) {
      console.error(e)
      toast('❌ ' + e.message, 'error')
    } finally {
      setSubiendo(false)
    }
  }

  // ---------- acciones ----------
  async function aceptar(r) {
    setGuardando(r.orden)
    try {
      const { error } = await supabase.rpc('ip30_confirmar_estado', {
        p_orden: r.orden, p_estado: r.estado_sugerido, p_nueva_fecha: null, p_notas: r.notas, p_contador: null, p_fecha: null,
      })
      if (error) throw error
      await cargar()
    } catch (e) {
      toast('❌ ' + e.message, 'error')
    } finally {
      setGuardando(0)
    }
  }

  async function simularCierres() {
    const { data, error } = await supabase.rpc('ip30_sync_cierres', { p_dry_run: true })
    if (error) { toast('❌ ' + error.message, 'error'); return }
    setSync(data)
  }

  function abrirPorOrden(orden, estadoInicial) {
    const f = filas.find((r) => r.orden === orden)
    if (!f) { toast(`⚠️ La orden ${orden} no está en la bandeja`, 'advertencia'); return }
    setModal({ fila: f, estadoInicial })
  }

  const fr = frescura
  const viejo = (iso) => !iso || Date.now() - new Date(iso).getTime() > 2 * 86400000

  return (
    <div style={{ minHeight: '100vh', background: C.fondo, color: C.texto }}>
      {modal && (
        <RevisarOrdenModal fila={modal.fila} estadoInicial={modal.estadoInicial}
          onCerrar={() => setModal(null)} onGuardado={() => { setModal(null); cargar() }} />
      )}
      <div style={s.wrap}>
        <div style={s.header}>
          <button style={s.boton} onClick={onVolver} aria-label="Volver">←</button>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Bandeja de preventivos</h2>
            {fr && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', fontSize: 12, color: C.gris }}>
                {[['IE36', fr.ie36], ['consumos', fr.consumos], ['Trabajo', fr.trabajo]].map(([l, v]) => (
                  <span key={l} style={viejo(v) ? { color: C.ambar, fontWeight: 700 } : undefined}>{l} {fechaHora(v)}</span>
                ))}
                <span>partes al {fechaCorta(fr.ultimo_parte)}</span>
              </div>
            )}
          </div>
          <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.xls" hidden onChange={(e) => elegirArchivo(e.target.files[0])} />
          <button style={s.primario} onClick={() => inputRef.current?.click()}>⬆ Subir IP30</button>
          <button style={{ ...s.boton, color: C.azul, fontWeight: 600 }} onClick={cargar} disabled={cargando}>{cargando ? 'Cargando…' : '↻'}</button>
        </div>

        {fr?.carga_subida_en && !subida && (
          <div style={{ fontSize: 13, color: C.gris, marginBottom: 10 }}>
            Última carga: <b>{fr.carga_archivo}</b> · {fechaHora(fr.carga_subida_en)}{fr.carga_por ? ` · ${fr.carga_por}` : ''} —{' '}
            {fr.n_nuevas} nuevas · {fr.n_actualizadas} actualizadas · {fr.n_ausentes} ausentes{fr.n_ignoradas ? ` · ${fr.n_ignoradas} de otra clase (ignoradas)` : ''}
          </div>
        )}

        {subida && (
          <div style={{ ...s.card, borderColor: C.azul }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{subida.nombre}</div>
            <div style={{ fontSize: 13, color: C.gris }}>
              Hoja «{subida.hoja}» · {subida.filas.length} órdenes leídas
              {subida.sinOrden.length ? ` · ${subida.sinOrden.length} filas sin N° de orden (filas ${subida.sinOrden.slice(0, 8).join(', ')}${subida.sinOrden.length > 8 ? '…' : ''})` : ''}
            </div>
            <div style={{ fontSize: 12, color: C.gris, marginTop: 4 }}>
              Columnas: {CAMPOS_IP30.map((c) => `${c.label}: ${subida.map[c.id] >= 0 ? subida.hs[subida.map[c.id]] : '—'}`).join(' · ')}
            </div>
            <div style={{ fontSize: 12, color: C.gris, marginTop: 4 }}>
              Se actualizan solo los datos de SAP. Lo que ya cargaste (estado, nueva fecha, próximo mantenimiento, notas) no se toca.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button style={{ ...s.primario, opacity: subiendo ? 0.6 : 1 }} disabled={subiendo} onClick={confirmarSubida}>{subiendo ? 'Guardando…' : 'Guardar en la bandeja'}</button>
              <button style={s.boton} onClick={() => setSubida(null)}>Cancelar</button>
            </div>
          </div>
        )}

        {/* Listas para enviar */}
        <div style={{ ...s.card, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Listas para enviar:</span>
          <select style={s.input} value={obraLista} onChange={(e) => setObraLista(e.target.value)}>
            <option value="">Elegir obra…</option>
            {obrasConProximos.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <button style={s.boton} disabled={!obraLista} onClick={() => exportarListaObra(filas, obraLista, hoyArchivo())}>⬇ Lista de la obra</button>
          <button style={s.boton} onClick={() => exportarListaGeneral(filas, hoyArchivo())}>⬇ Lista general ({proximos(filas).length})</button>
          <button style={s.boton} onClick={() => exportarReprogramadas(filas, hoyArchivo())}>⬇ Reprogramadas</button>
          <span style={{ flex: 1 }} />
          <button style={{ ...s.boton, fontSize: 12 }} onClick={simularCierres} title="Muestra qué mantenimientos crearía la sincronización con las órdenes cerradas en SAP (no escribe nada)">
            Simular cierres SAP
          </button>
        </div>
        {sync && (
          <div style={{ ...s.card, fontSize: 13 }}>
            {sync.ok
              ? <>Simulación: <b>{sync.creados}</b> mantenimientos se crearían y <b>{sync.vinculados}</b> se vincularían a uno ya cargado
                  {sync.cerradas_sin_fecha ? ` · ${sync.cerradas_sin_fecha} cerradas sin fecha de cierre (antes del 07/10/2026)` : ''}
                  {sync.sin_equipo ? ` · ${sync.sin_equipo} con equipo que no está en Gestión de Equipos` : ''}. No se escribió nada.</>
              : <span style={{ color: C.rojo }}>Error: {sync.error}</span>}
            <button style={{ ...s.boton, padding: '2px 8px', fontSize: 12, marginLeft: 8 }} onClick={() => setSync(null)}>✕</button>
          </div>
        )}

        {/* Filtros */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <input style={{ ...s.input, flex: '1 1 200px' }} placeholder="Buscar equipo u orden…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          <select style={{ ...s.input, flex: '1 1 200px' }} value={obra} onChange={(e) => setObra(e.target.value)}>
            <option value="">Todas las obras</option>
            {obras.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={soloVencidos} onChange={(e) => setSoloVencidos(e.target.checked)} /> Solo vencidos
          </label>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
          {PESTANAS.map(([k, l]) => {
            const n = k === 'sinorden' ? sinOrden?.length : k === 'contador' ? pendContador?.length : cuentas[k]
            return (
              <button key={k} onClick={() => setPestana(k)}
                style={{ border: `1px solid ${pestana === k ? C.azul : C.borde}`, borderRadius: 8, padding: '6px 10px', fontSize: 13, cursor: 'pointer',
                  background: pestana === k ? C.azul : 'white', color: pestana === k ? 'white' : C.texto }}>
                {l}{n != null ? ` (${n})` : ''}
              </button>
            )
          })}
        </div>

        {FILTRO[pestana] && (
          <div style={{ overflow: 'auto', maxHeight: '68vh', border: `1px solid ${C.borde}`, borderRadius: 8, background: 'white' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1250 }}>
              <thead>
                <tr>{['Orden', 'Equipo', 'Ubicación', 'Último mantenimiento', 'Próximo (H)', 'Falta / pasó (J)', 'Sugerido', 'Confirmado'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {vista.slice(0, 600).map((r) => (
                  <tr key={r.orden} style={{ background: colorJ(r) === 'rojo' && abierta(r) ? '#fff7f7' : undefined }}>
                    <td style={s.td}><CeldaOrden r={r} /></td>
                    <td style={s.td}>
                      <div style={{ fontWeight: 600 }}>{r.equipo}</div>
                      <div style={s.sub}>{den(r)}</div>
                    </td>
                    <td style={{ ...s.td, fontSize: 12 }}>
                      {r.ubicacion || '—'}
                      {r.lejana && <div><span style={{ ...s.badge, background: C.azulBg, color: C.azul }}>obra lejana</span></div>}
                      {r.ubicacion_sin_config && <div><span style={{ ...s.badge, background: C.ambarBg, color: C.ambar }} title="La ubicación no está en la lista de ubicaciones del planificador: se usa el umbral de obra cercana">ubicación sin configurar</span></div>}
                    </td>
                    <td style={s.td}><CeldaUltimo r={r} /></td>
                    <td style={s.td}><CeldaProximo r={r} onEditar={() => setModal({ fila: r })} /></td>
                    <td style={s.td}><ChipJ r={r} /></td>
                    <td style={s.td}>
                      {r.estado_sugerido ? <span style={{ ...s.chip, ...COLOR_ESTADO[r.estado_sugerido], fontWeight: 600 }}>{ESTADO_TXT[r.estado_sugerido]}</span> : <span style={{ color: C.gris, fontSize: 12 }}>—</span>}
                      <div style={s.sub}>{r.motivo}</div>
                    </td>
                    <td style={s.td}>
                      <CeldaConfirmado r={r} guardando={guardando === r.orden}
                        onRevisar={() => setModal({ fila: r })} onAceptar={() => aceptar(r)} />
                    </td>
                  </tr>
                ))}
                {!vista.length && (
                  <tr><td colSpan={8} style={{ ...s.td, textAlign: 'center', color: C.gris, padding: 24 }}>{cargando ? 'Cargando…' : 'No hay órdenes con ese filtro.'}</td></tr>
                )}
              </tbody>
            </table>
            {vista.length > 600 && <div style={{ padding: 8, fontSize: 12, color: C.gris }}>Se muestran 600 de {vista.length}: usá la búsqueda o el filtro de obra.</div>}
          </div>
        )}

        {pestana === 'sinorden' && (
          <div style={{ overflow: 'auto', border: `1px solid ${C.borde}`, borderRadius: 8, background: 'white' }}>
            <p style={{ fontSize: 13, color: C.gris, margin: 10 }}>
              Equipos con el mantenimiento cerca o vencido (calculado con el último mantenimiento + su período) que no tienen una orden TCPV abierta en la bandeja.
              Caso típico: SAP no lanzó la orden porque las cargas de combustible están atrasadas.
            </p>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
              <thead><tr>{['Equipo', 'Ubicación', 'Último mantenimiento', 'Próximo', 'Falta / pasó', 'Última orden'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {(sinOrden || []).map((r) => (
                  <tr key={r.equipo}>
                    <td style={s.td}><b>{r.equipo}</b><div style={s.sub}>{den(r)}</div></td>
                    <td style={{ ...s.td, fontSize: 12 }}>{r.ubicacion || '—'}{r.lejana && <div><span style={{ ...s.badge, background: C.azulBg, color: C.azul }}>obra lejana</span></div>}</td>
                    <td style={s.td}>{num(r.srv_contador, 1)} · {fechaCorta(r.srv_fecha)}</td>
                    <td style={s.td}><b>{num(r.h, 1)}</b> {r.unidad}<div style={s.sub}>cada {num(r.periodo)} {r.unidad}</div></td>
                    <td style={s.td}><ChipJ r={r} /></td>
                    <td style={s.td}>{r.ultima_orden || '—'}</td>
                  </tr>
                ))}
                {sinOrden && !sinOrden.length && <tr><td colSpan={6} style={{ ...s.td, textAlign: 'center', color: C.gris, padding: 24 }}>No hay equipos en esa situación.</td></tr>}
                {!sinOrden && <tr><td colSpan={6} style={{ ...s.td, textAlign: 'center', color: C.gris, padding: 24 }}>Cargando…</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {pestana === 'contador' && (
          <div style={{ overflow: 'auto', border: `1px solid ${C.borde}`, borderRadius: 8, background: 'white' }}>
            <p style={{ fontSize: 13, color: C.gris, margin: 10 }}>
              Mantenimientos que se registraron solos al cerrarse la orden en SAP, sin contador. Cargá el contador del cierre para que
              «Desde el último mantenimiento» vuelva a calcular cuánto falta.
            </p>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 600 }}>
              <thead><tr>{['Equipo', 'Orden', 'Fecha del cierre', ''].map((h, i) => <th key={i} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {(pendContador || []).map((r) => (
                  <tr key={r.service_id}>
                    <td style={s.td}><b>{r.equipo}</b></td>
                    <td style={s.td}>{r.orden || '—'}</td>
                    <td style={s.td}>{fechaCorta(r.fecha)}</td>
                    <td style={s.td}>{r.orden && <button style={{ ...s.boton, padding: '4px 10px', fontSize: 12 }} onClick={() => abrirPorOrden(r.orden, 'concluido')}>Cargar contador</button>}</td>
                  </tr>
                ))}
                {pendContador && !pendContador.length && <tr><td colSpan={4} style={{ ...s.td, textAlign: 'center', color: C.gris, padding: 24 }}>No hay contadores pendientes.</td></tr>}
                {!pendContador && <tr><td colSpan={4} style={{ ...s.td, textAlign: 'center', color: C.gris, padding: 24 }}>Cargando…</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
