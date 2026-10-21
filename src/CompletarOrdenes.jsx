import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { supabase } from './lib/supabase'
import { toast } from './utils/ui'
import {
  CAMPOS, DIAS_LECTURA_VIEJA, leerLibro, leerHoja, detectarTitulos, titulos, autoMapear, indexarDatos, cruzar,
} from './completarOrdenes/logica'
import { escribirCeldas } from './completarOrdenes/excelPatch'

// ============================================================
// COMPLETAR ÓRDENES IP30
// La encargada de preventivo sube el Excel del IP30; la app completa
// Ubicación técnica, Última carga y Fecha de última carga con el IE36 y los
// consumos ya cargados en Supabase, y devuelve el mismo Excel.
// Datos: RPC ip30_datos_equipos_v2 (+ próximo mantenimiento calculado) / ip30_frescura (ver supabase/completar_ordenes_ip30.sql)
// Desde 21/10/2026 también completa Próximo mantenimiento (solo si la celda está vacía y se puede calcular)
// y Falta/Pasó como fórmula =H−I.
// Nada se guarda: el Excel se procesa en el navegador.
// ============================================================

const C = {
  azul: '#0f766e', azulBg: '#ccfbf1', fondo: '#f9fafb', borde: '#e5e7eb', gris: '#6b7280', texto: '#111827',
  rojo: '#b91c1c', rojoBg: '#fee2e2', ambar: '#b45309', ambarBg: '#fef3c7', verde: '#15803d', verdeBg: '#dcfce7',
}
const s = {
  wrap: { maxWidth: 1100, margin: '0 auto', padding: '16px 16px 48px' },
  header: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 },
  boton: { background: 'white', border: `1px solid ${C.borde}`, borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 14 },
  primario: { background: C.azul, color: 'white', border: 'none', borderRadius: 8, padding: '10px 18px', cursor: 'pointer', fontSize: 15, fontWeight: 600 },
  card: { background: 'white', border: `1px solid ${C.borde}`, borderRadius: 12, padding: 16, marginBottom: 16 },
  label: { display: 'block', fontSize: 12, color: C.gris, margin: '8px 0 2px' },
  select: { width: '100%', padding: '7px 8px', border: `1px solid ${C.borde}`, borderRadius: 6, fontSize: 14, background: 'white' },
  th: { position: 'sticky', top: 0, background: '#f3f4f6', textAlign: 'left', padding: '6px 10px', fontSize: 12, whiteSpace: 'nowrap', borderBottom: `1px solid ${C.borde}` },
  td: { padding: '6px 10px', fontSize: 13, whiteSpace: 'nowrap', borderBottom: `1px solid ${C.borde}` },
}

const PAGINA = 1000

const ddmm = (d) => d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : ''
const ddmmhhmm = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${ddmm(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const pct = (n, t) => (t ? Math.round((100 * n) / t) : 0)
const fmtNum = (v) => (v == null ? '—' : Number(v).toLocaleString('es-PY'))

function ItemFrescura({ label, iso, ahora }) {
  const viejo = !iso || ahora - new Date(iso).getTime() > 2 * 86400000
  return (
    <span style={{ color: viejo ? C.ambar : C.gris, fontWeight: viejo ? 700 : 400, whiteSpace: 'nowrap' }}
      title={viejo ? 'Más de 2 días sin actualizar: revisá la ingesta' : undefined}>
      {label} {ddmmhhmm(iso)}
    </span>
  )
}

// ahora = momento en que se cargaron los datos (no se calcula en el render)
function Frescura({ f, ahora }) {
  if (!f) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', fontSize: 12 }}>
      <ItemFrescura label="IE36 al" iso={f.ie36} ahora={ahora} />
      <span style={{ color: C.gris }}>·</span>
      <ItemFrescura label="consumos al" iso={f.consumos} ahora={ahora} />
    </div>
  )
}

function Stat({ valor, texto, tono }) {
  const bg = tono === 'ok' ? C.verdeBg : tono === 'warn' ? C.ambarBg : tono === 'bad' ? C.rojoBg : '#f3f4f6'
  return (
    <div style={{ background: bg, borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{valor}</div>
      <div style={{ fontSize: 12, color: C.gris }}>{texto}</div>
    </div>
  )
}

function ListaEquipos({ titulo, items, detalle }) {
  if (!items.length) return null
  return (
    <details style={{ marginTop: 10 }}>
      <summary style={{ cursor: 'pointer', color: C.azul, fontSize: 14 }}>{items.length} {titulo}</summary>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, maxHeight: 180, overflow: 'auto' }}>
        {items.map((k) => (
          <span key={k} style={{ background: '#f3f4f6', borderRadius: 12, padding: '2px 9px', fontSize: 12 }}>
            {k}{detalle ? ` · ${detalle(k)}` : ''}
          </span>
        ))}
      </div>
    </details>
  )
}

export default function CompletarOrdenes({ onVolver }) {
  const [datos, setDatos] = useState(null)        // filas de ip30_datos_equipos
  const [frescura, setFrescura] = useState(null)
  const [cargadoEn, setCargadoEn] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [archivo, setArchivo] = useState(null)    // { nombre, buf, wb, hojas }
  const [hoja, setHoja] = useState('')
  const [filaTitulos, setFilaTitulos] = useState(0)
  const [map, setMap] = useState({})
  const [verColumnas, setVerColumnas] = useState(false)
  const [descargando, setDescargando] = useState(false)
  const [arrastrando, setArrastrando] = useState(false)
  const inputRef = useRef(null)

  const cargarDatos = useCallback(async () => {
    setCargando(true)
    try {
      // La API de Supabase devuelve como máximo 1000 filas por llamada: se pagina hasta traer todo
      const todas = []
      for (let desde = 0; ; desde += PAGINA) {
        const { data, error } = await supabase.rpc('ip30_datos_equipos_v2').range(desde, desde + PAGINA - 1)
        if (error) throw error
        todas.push(...(data || []))
        if (!data || data.length < PAGINA) break
      }
      const f = await supabase.rpc('ip30_frescura')
      if (f.error) throw f.error
      setDatos(todas)
      setFrescura((f.data || [])[0] || null)
      setCargadoEn(Date.now())
    } catch (e) {
      console.error(e)
      toast('❌ Error al cargar datos SAP: ' + e.message, 'error')
    } finally {
      setCargando(false)
    }
  }, [])
  useEffect(() => { cargarDatos() }, [cargarDatos])

  const idx = useMemo(() => indexarDatos(datos), [datos])

  // Hoja seleccionada → matriz
  const hojaDatos = useMemo(() => (archivo && hoja ? leerHoja(archivo.wb, hoja) : null), [archivo, hoja])
  const hs = useMemo(() => (hojaDatos ? titulos(hojaDatos.aoa, filaTitulos) : []), [hojaDatos, filaTitulos])

  function elegirHoja(nombre, libro = archivo) {
    setHoja(nombre)
    const { aoa } = leerHoja(libro.wb, nombre)
    const fila = detectarTitulos(aoa)
    setFilaTitulos(fila)
    const m = autoMapear(titulos(aoa, fila))
    setMap(m)
    setVerColumnas(CAMPOS.some((c) => !c.opcional && !(m[c.id] >= 0)))
  }
  function cambiarFilaTitulos(n) {
    const fila = Math.max(0, (Number(n) || 1) - 1)
    setFilaTitulos(fila)
    setMap(autoMapear(titulos(hojaDatos.aoa, fila)))
  }

  async function cargarArchivo(file) {
    if (!file) return
    if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
      toast('⚠️ El archivo tiene que ser .xlsx (si viene en .xls, abrilo y guardalo como .xlsx)', 'warning')
      return
    }
    try {
      const buf = await file.arrayBuffer()
      const libro = leerLibro(buf)
      const a = { nombre: file.name, buf, ...libro }
      setArchivo(a)
      elegirHoja(libro.hojaSugerida, a)
    } catch (e) {
      console.error(e)
      toast(`❌ No pude leer "${file.name}": ${e.message}`, 'error')
    }
  }

  const mapeoCompleto = CAMPOS.every((c) => c.opcional || map[c.id] >= 0)
  const resultado = useMemo(() => {
    if (!hojaDatos || !datos || !mapeoCompleto) return null
    return cruzar({ ...hojaDatos, filaTitulos, map, idx })
  }, [hojaDatos, datos, mapeoCompleto, filaTitulos, map, idx])

  async function descargar() {
    if (!resultado) return
    setDescargando(true)
    try {
      const blob = await escribirCeldas(archivo.buf, hoja, resultado.escrituras)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = archivo.nombre.replace(/\.[^.]+$/, '') + '_completado.xlsx'
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      toast('✅ Excel completado descargado', 'success')
    } catch (e) {
      console.error(e)
      toast('❌ Error al generar el Excel: ' + e.message, 'error')
    } finally {
      setDescargando(false)
    }
  }

  function quitarArchivo() {
    setArchivo(null); setHoja(''); setMap({})
    if (inputRef.current) inputRef.current.value = ''
  }

  const st = resultado?.st
  const tono = (n) => { const p = pct(n, st.total); return p >= 95 ? 'ok' : p >= 70 ? 'warn' : 'bad' }
  const orden = (set) => [...set].sort()

  return (
    <div style={{ minHeight: '100vh', background: C.fondo, color: C.texto }}>
      <div style={s.wrap}>
        <div style={s.header}>
          <button style={s.boton} onClick={onVolver} aria-label="Volver">←</button>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Completar órdenes IP30</h2>
            <Frescura f={frescura} ahora={cargadoEn} />
          </div>
          <button style={{ ...s.boton, color: C.azul, fontWeight: 600 }} onClick={cargarDatos} disabled={cargando}>
            {cargando ? 'Cargando…' : '↻ Refrescar datos'}
          </button>
        </div>

        <p style={{ color: C.gris, fontSize: 14, marginTop: 0 }}>
          Subí el Excel de órdenes del IP30. Se completan <b>Ubicación técnica</b> (IE36), <b>Última carga</b> y <b>Fecha de última carga</b> (último
          horómetro/km de los consumos de combustible), <b>Próximo mantenimiento</b> (solo si está vacío y el equipo tiene último mantenimiento y
          período cargados) y <b>Falta/Pasó</b> (fórmula próximo − última carga), y se descarga el mismo Excel con su formato. No se guarda nada en la app.
        </p>

        {/* Archivo */}
        <div style={s.card}>
          <input ref={inputRef} type="file" accept=".xlsx,.xlsm" hidden onChange={(e) => cargarArchivo(e.target.files[0])} />
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setArrastrando(true) }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => { e.preventDefault(); setArrastrando(false); cargarArchivo(e.dataTransfer.files[0]) }}
            style={{
              border: `2px ${archivo ? 'solid' : 'dashed'} ${archivo ? C.verde : arrastrando ? C.azul : C.borde}`,
              borderRadius: 10, padding: '22px 12px', textAlign: 'center', cursor: 'pointer',
              background: arrastrando ? C.azulBg : '#f9fafb', color: archivo ? C.texto : C.gris,
            }}
          >
            {archivo
              ? <><b>{archivo.nombre}</b><div style={{ fontSize: 12, color: C.gris }}>clic para cambiar el archivo</div></>
              : <>Arrastrá el Excel del IP30 o hacé clic<div style={{ fontSize: 12 }}>.xlsx</div></>}
          </div>

          {archivo && (
            <div style={{ marginTop: 10, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <button style={{ ...s.boton, fontSize: 13 }} onClick={() => setVerColumnas((v) => !v)}>
                {verColumnas ? 'Ocultar columnas' : 'Ajustar hoja y columnas'}
              </button>
              <button style={{ ...s.boton, fontSize: 13, color: C.rojo }} onClick={quitarArchivo}>Quitar archivo</button>
              {!mapeoCompleto && <span style={{ color: C.rojo, fontSize: 13 }}>Elegí las columnas que faltan.</span>}
            </div>
          )}

          {archivo && verColumnas && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0 14px', marginTop: 6 }}>
              <div>
                <label style={s.label}>Hoja</label>
                <select style={s.select} value={hoja} onChange={(e) => elegirHoja(e.target.value)}>
                  {archivo.hojas.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label style={s.label}>Fila de títulos</label>
                <input type="number" min="1" style={s.select} value={filaTitulos + 1} onChange={(e) => cambiarFilaTitulos(e.target.value)} />
              </div>
              {CAMPOS.map((c) => (
                <div key={c.id}>
                  <label style={{ ...s.label, color: map[c.id] >= 0 || c.opcional ? C.gris : C.rojo }}>{c.label}</label>
                  <select style={s.select} value={map[c.id] ?? -1} onChange={(e) => setMap((m) => ({ ...m, [c.id]: Number(e.target.value) }))}>
                    <option value={-1}>{c.opcional ? '— no completar —' : '— elegir columna —'}</option>
                    {hs.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Resultado */}
        {resultado && (
          <div style={s.card}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
              <Stat valor={st.total.toLocaleString('es-PY')} texto="órdenes" />
              <Stat valor={`${pct(st.conUbic, st.total)}%`} texto={`con ubicación (${st.conUbic})`} tono={tono(st.conUbic)} />
              <Stat valor={`${pct(st.conLect, st.total)}%`} texto={`con contador y fecha (${st.conLect})`} tono={tono(st.conLect)} />
              <Stat valor={st.viejas.size} texto={`equipos con lectura de más de ${DIAS_LECTURA_VIEJA} días`} tono={st.viejas.size ? 'warn' : undefined} />
              {map.prox >= 0 && <Stat valor={st.conProx} texto={`próximo mantenimiento completado (${st.proxYaCargado} ya tenían)`} />}
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button style={{ ...s.primario, opacity: descargando ? 0.6 : 1 }} onClick={descargar} disabled={descargando || !st.total}>
                {descargando ? 'Generando…' : '⬇ Descargar Excel completado'}
              </button>
              <span style={{ fontSize: 13, color: C.gris }}>
                Si un equipo no tiene dato, la celda queda como estaba. El próximo mantenimiento que ya estaba cargado no se toca.
              </span>
            </div>

            <ListaEquipos titulo={`con lectura de más de ${DIAS_LECTURA_VIEJA} días (se completó igual, revisalos)`}
              items={orden(st.viejas.keys())} detalle={(k) => `${st.viejas.get(k)} d`} />
            <ListaEquipos titulo="sin lectura en los consumos de combustible" items={orden(st.sinLectura)} />
            <ListaEquipos titulo="que no están en el IE36 (sin ubicación)" items={orden(st.noIe36)} />
            <ListaEquipos titulo="repetidos en el IE36 con ubicaciones distintas (se tomó la más reciente)" items={orden(st.ubicDudosa)} />

            <div style={{ overflow: 'auto', maxHeight: 420, border: `1px solid ${C.borde}`, borderRadius: 8, marginTop: 14 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    {['Fila', 'Equipo', 'Ubicación técnica', 'Última carga', 'Fecha', 'Antigüedad', 'Próx. mantto', 'Falta/Pasó'].map((h) => <th key={h} style={s.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {resultado.filas.slice(0, 300).map((f) => {
                    const vieja = f.dias != null && f.dias > DIAS_LECTURA_VIEJA
                    return (
                      <tr key={f.fila}>
                        <td style={{ ...s.td, color: C.gris }}>{f.fila}</td>
                        <td style={s.td}>{f.equipo}</td>
                        <td style={{ ...s.td, color: f.ubicacion ? C.texto : C.rojo }}>{f.ubicacion || '—'}</td>
                        <td style={{ ...s.td, color: f.lectura != null ? C.texto : C.rojo, textAlign: 'right' }}>{fmtNum(f.lectura)}</td>
                        <td style={s.td}>{f.fecha ? ddmm(f.fecha) : '—'}</td>
                        <td style={{ ...s.td, color: vieja ? C.ambar : C.gris, fontWeight: vieja ? 700 : 400 }}>
                          {f.dias == null ? '—' : `${f.dias} d`}
                        </td>
                        <td style={{ ...s.td, textAlign: 'right' }}>{fmtNum(f.prox)}</td>
                        <td style={{ ...s.td, textAlign: 'right', fontWeight: 700,
                          color: f.falta == null ? C.gris : f.falta <= 0 ? C.rojo : C.texto }}>{fmtNum(f.falta)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {resultado.filas.length > 300 && (
              <p style={{ fontSize: 12, color: C.gris }}>Vista previa de las primeras 300 órdenes; el Excel se completa entero.</p>
            )}
          </div>
        )}

        {archivo && !resultado && mapeoCompleto && cargando && <p style={{ color: C.gris }}>Cargando datos SAP…</p>}
      </div>
    </div>
  )
}
