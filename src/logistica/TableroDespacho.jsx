import { useMemo, useState } from 'react'
import AsignarSheet from './AsignarSheet'
import Sheet from './Sheet'
import GrillaSemana, { ANCHO_CAMION } from './GrillaSemana'
import FilasCapacidad from './FilasCapacidad'
import PanelPorAsignar from './PanelPorAsignar'
import { ChipCamionRequerido, ChipCategoria, TarjetaHueco, TarjetaViaje } from './Tarjetas'
import { useAsignacionesRango, useEncargosAbiertos } from './hooks'
import {
  conSaldo, destinoKey, huecosSemana, mapaOcupacion, ocupacionFlota, porAsignar, resumenFila, sinCamion, tipoMasExigido,
} from './despacho'
import {
  CATEGORIAS, estilos, fmtFecha, fmtFechaRelativa, guardarPref, hoyPY, leerPref, lunesDe, sumarDias, tipoLabel, useMedia,
} from './constantes'

const ANCHO_FRENTE = 210
const PREF_MODO = 'logistica.despacho.verPor'

function Indicador({ titulo, valor, detalle, color = '#111827', pie, onClick }) {
  return (
    <div onClick={onClick} style={{ ...estilos.card, flex: '1 1 200px', minWidth: 0, cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ fontSize: '12px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{titulo}</div>
      <div style={{ fontSize: '22px', fontWeight: 800, color, marginTop: '4px', lineHeight: 1.2 }}>{valor}</div>
      {detalle && <div style={{ fontSize: '13px', color: '#374151', marginTop: '4px' }}>{detalle}</div>}
      {pie && <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>{pie}</div>}
    </div>
  )
}

/**
 * Tablero de despacho — escritorio.
 * Vista principal frente × día (destinos), con filas de capacidad por tipo de camión y panel "Por asignar".
 * "Ver por Camión" muestra la grilla camión × día de la v2 con las mismas filas de capacidad.
 */
export default function TableroDespacho({ catalogos, camiones, onAbrirEncargo, onAbrirCamiones, esAdmin, version, recargar }) {
  const hoy = hoyPY()
  const ancho = useMedia('(min-width: 1280px)')
  const [lunes, setLunes] = useState(lunesDe(hoy))
  const [modo, setModoState] = useState(() => (leerPref(PREF_MODO, 'frente') === 'camion' ? 'camion' : 'frente'))
  const [filtro, setFiltro] = useState([])
  const [sheet, setSheet] = useState(null)   // { encargo?, preset? } → AsignarSheet
  const [elegir, setElegir] = useState(null) // { key, nombre, fecha } → lista de encargos del destino

  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i)), [lunes])
  const { asignaciones, copias, encargos, cargando } = useAsignacionesRango(dias[0], dias[6], version)
  const abiertos = useEncargosAbiertos(version)
  const ocup = useMemo(() => mapaOcupacion(asignaciones, copias), [asignaciones, copias])
  const cat = { ...catalogos, camiones }

  const setModo = (m) => { setModoState(m); guardarPref(PREF_MODO, m) }
  const toggleCat = (c) => setFiltro(f => (f.includes(c) ? f.filter(x => x !== c) : [...f, c]))

  // ── Indicadores ────────────────────────────────────────────────────────────
  const flota = ocupacionFlota(camiones, ocup, dias)
  const exigido = tipoMasExigido(camiones, ocup, dias)
  const atrasados = abiertos.filter(e => e.subestado === 'atrasado')
  const sinCam = abiertos.filter(sinCamion)
  const vencenHoy = sinCam.filter(e => e.fecha_requerida === hoy).length
  const vencenManana = sinCam.filter(e => e.fecha_requerida === sumarDias(hoy, 1)).length

  // ── Panel ──────────────────────────────────────────────────────────────────
  const listaPanel = porAsignar(abiertos)
  const listaSaldo = conSaldo(abiertos)
  const ctx = { dias, hoy, camiones, ocup, asignaciones, encargos }

  // ── Filas frente × día ─────────────────────────────────────────────────────
  const huecos = useMemo(() => huecosSemana(abiertos, dias, hoy), [abiertos, dias, hoy])
  const filas = useMemo(() => {
    const m = new Map()
    const pasa = (e) => !filtro.length || filtro.includes(e.categoria)
    const fila = (e) => {
      const k = destinoKey(e)
      if (!m.has(k)) m.set(k, { key: k, nombre: e.destino_nombre || '¿destino?', celdas: {}, atrasado: false, porDia: {}, nHuecos: 0, noCumplidas: new Set() })
      return m.get(k)
    }
    const celda = (f, d) => (f.celdas[d] ||= { viajes: [], huecos: [] })
    asignaciones.forEach(a => {
      const e = encargos[a.encargo_id]
      if (!e || !pasa(e)) return
      const f = fila(e)
      celda(f, a.fecha).viajes.push(a)
      f.porDia[a.fecha] = (f.porDia[a.fecha] || 0) + 1
      if (a.estado === 'planificada' && a.fecha < hoy) { f.atrasado = true; f.noCumplidas.add(a.id) }
      if (e.estado === 'abierto' && e.subestado === 'atrasado') f.atrasado = true
    })
    copias.forEach(a => {
      const e = encargos[a.encargo_id]
      if (!e || !pasa(e)) return
      const f = fila(e)
      celda(f, a.dia).viajes.push(a)
      f.atrasado = true; f.noCumplidas.add(a.id)
    })
    huecos.forEach(h => {
      if (!pasa(h.encargo)) return
      const f = fila(h.encargo)
      celda(f, h.dia).huecos.push(h)
      f.nHuecos++
      if (h.vencido || h.encargo.subestado === 'atrasado') f.atrasado = true
    })
    return [...m.values()].sort((a, b) => (a.atrasado === b.atrasado ? a.nombre.localeCompare(b.nombre, 'es') : a.atrasado ? -1 : 1))
  }, [asignaciones, copias, encargos, huecos, filtro, hoy])

  const abrirAsignar = (encargo, fecha, equipoId) =>
    setSheet({ encargo, preset: { ...(fecha ? { fecha } : {}), ...(equipoId ? { equipo_id: equipoId } : {}) } })

  const candidatosDestino = elegir ? abiertos.filter(e => destinoKey(e) === elegir.key) : []

  // ── Render ─────────────────────────────────────────────────────────────────
  const grillaFrente = (
    <div style={{ overflowX: 'auto', background: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: '860px' }}>
        <thead>
          <tr>
            <th style={{ width: `${ANCHO_FRENTE}px`, textAlign: 'left', padding: '10px 12px', fontSize: '12px', color: '#6b7280', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>Frente / destino</th>
            {dias.map(d => (
              <th key={d} style={{ padding: '10px 6px', fontSize: '13px', borderBottom: '1px solid #e5e7eb', borderLeft: '1px solid #f1f5f9',
                background: d === hoy ? '#eff6ff' : '#f9fafb', color: d === hoy ? '#1d4ed8' : '#374151', fontWeight: 700 }}>
                {fmtFecha(d)}{d === hoy && ' · hoy'}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!cargando && filas.length === 0 && (
            <tr><td colSpan={8} style={{ padding: '28px', textAlign: 'center', color: '#6b7280', fontSize: '14px' }}>
              {filtro.length ? 'Ningún frente con ese material esta semana.' : 'Sin viajes ni encargos sin camión esta semana.'}
            </td></tr>
          )}
          {filas.map(f => (
            <tr key={f.key}>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top',
                borderLeft: f.atrasado ? '3px solid #dc2626' : '3px solid transparent' }}>
                <div style={{ fontWeight: 800, fontSize: '14px', color: '#111827' }}>{f.nombre}</div>
                <div style={{ fontSize: '11px', color: f.atrasado ? '#b91c1c' : '#6b7280', marginTop: '2px' }}>
                  {resumenFila({ porDia: f.porDia, huecos: f.nHuecos, noCumplidas: f.noCumplidas.size })}
                </div>
              </td>
              {dias.map(d => {
                const c = f.celdas[d] || { viajes: [], huecos: [] }
                const vacia = !c.viajes.length && !c.huecos.length
                const nCamiones = new Set(c.viajes.map(a => a.equipo_id)).size
                return (
                  <td key={d}
                    onClick={() => setElegir({ key: f.key, nombre: f.nombre, fecha: d })}
                    style={{ padding: '4px', borderBottom: '1px solid #f1f5f9', borderLeft: '1px solid #f1f5f9', verticalAlign: 'top',
                      background: d === hoy ? '#f8fbff' : '#fff', cursor: 'pointer', height: '58px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      {c.viajes.length >= 2 && (
                        <div title="Varios viajes al mismo destino el mismo día: ¿se pueden juntar?"
                          style={{ fontSize: '10px', fontWeight: 800, color: '#1e40af', background: '#dbeafe', borderRadius: '6px', padding: '2px 6px', alignSelf: 'flex-start' }}>
                          {c.viajes.length} viajes · {nCamiones} {nCamiones > 1 ? 'camiones' : 'camión'}
                        </div>
                      )}
                      {c.huecos.map(h => (
                        <TarjetaHueco key={`h-${h.encargo.id}`} encargo={h.encargo} vencido={h.vencido} compacto
                          onClick={(ev) => { ev.stopPropagation(); abrirAsignar(h.encargo, d) }} />
                      ))}
                      {c.viajes.map(a => (
                        <TarjetaViaje key={a.copia ? `${a.id}-${a.dia}` : a.id} a={a} encargo={encargos[a.encargo_id]} camiones={camiones} compacto
                          onClick={(ev) => { ev.stopPropagation(); onAbrirEncargo(a.encargo_id) }} />
                      ))}
                      {vacia && <div style={{ color: '#e5e7eb', fontSize: '16px', textAlign: 'center', lineHeight: '48px' }}>＋</div>}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <FilasCapacidad camiones={camiones} dias={dias} ocup={ocup} encargos={encargos} anchoEtiqueta={ANCHO_FRENTE} />
    </div>
  )

  return (
    <div style={{ padding: '16px 20px 40px' }}>
      {/* a) Indicadores */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <Indicador titulo="Ocupación de la flota"
          valor={flota.total ? `${Math.round((flota.ocupados / flota.total) * 100)} %` : '—'}
          detalle={`${flota.ocupados} de ${flota.total} camión-días`}
          pie="según lo cargado en la app" />
        {exigido ? (
          <Indicador titulo="Tipo más exigido" color="#5b21b6"
            valor={tipoLabel(exigido.tipo)}
            detalle={exigido.n === 1 ? `${exigido.ocupados} de ${exigido.total} días` : `${exigido.ocupados} de ${exigido.total} camión-días (${exigido.n} camiones)`}
            pie={camiones.some(c => !c.tipo_camion) ? 'hay camiones sin clasificar' : null} />
        ) : (
          <Indicador titulo="Tipo más exigido" color="#92400e" valor="Clasificá los camiones"
            detalle={esAdmin ? 'Abrir Camiones →' : 'Ningún camión tiene tipo cargado'}
            onClick={esAdmin ? onAbrirCamiones : undefined} />
        )}
        <Indicador titulo="Atrasados" color={atrasados.length ? '#b91c1c' : '#166534'}
          valor={atrasados.length}
          detalle={atrasados.length ? atrasados.slice(0, 2).map(e => e.descripcion).join(' · ') + (atrasados.length > 2 ? ' …' : '') : 'Nada atrasado'} />
        <Indicador titulo="Sin camión" color={sinCam.length ? '#c2410c' : '#166534'}
          valor={sinCam.length}
          detalle={[vencenHoy && `${vencenHoy} vence${vencenHoy > 1 ? 'n' : ''} hoy`, vencenManana && `${vencenManana} vence${vencenManana > 1 ? 'n' : ''} mañana`].filter(Boolean).join(' · ') || (sinCam.length ? 'ninguno vence hoy ni mañana' : 'Todos tienen camión')} />
      </div>

      {/* b) Barra */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <button onClick={() => setLunes(sumarDias(lunes, -7))} style={{ ...estilos.btnSecundario, padding: '6px 14px' }}>‹ Anterior</button>
        <button onClick={() => setLunes(lunesDe(hoy))} style={estilos.chip(lunes === lunesDe(hoy))}>Esta semana</button>
        <button onClick={() => setLunes(sumarDias(lunes, 7))} style={{ ...estilos.btnSecundario, padding: '6px 14px' }}>Siguiente ›</button>
        <span style={{ width: '1px', height: '28px', background: '#e5e7eb', margin: '0 4px' }} />
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#374151' }}>Ver por</span>
        <div style={{ display: 'flex', border: '1px solid #d1d5db', borderRadius: '10px', overflow: 'hidden' }}>
          {[['frente', 'Frente'], ['camion', 'Camión']].map(([id, label]) => (
            <button key={id} onClick={() => setModo(id)} style={{ padding: '8px 14px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 700,
              background: modo === id ? '#1d4ed8' : '#fff', color: modo === id ? '#fff' : '#374151' }}>{label}</button>
          ))}
        </div>
        <span style={{ width: '1px', height: '28px', background: '#e5e7eb', margin: '0 4px' }} />
        {Object.entries(CATEGORIAS).map(([id, c]) => {
          const activo = filtro.includes(id)
          return (
            <button key={id} onClick={() => toggleCat(id)} style={{ minHeight: '34px', padding: '4px 12px', borderRadius: '999px', cursor: 'pointer', fontSize: '13px', fontWeight: 700,
              border: activo ? `2px solid ${c.fg}` : '1px solid #d1d5db', background: activo ? c.bg : '#fff', color: activo ? c.fg : '#374151' }}>
              {c.label}
            </button>
          )
        })}
        {filtro.length > 0 && (
          <button onClick={() => setFiltro([])} style={{ border: 'none', background: 'none', color: '#6b7280', fontSize: '13px', cursor: 'pointer' }}>Quitar filtro</button>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '13px', color: '#6b7280' }}>
          {cargando ? 'Cargando…' : `${fmtFecha(dias[0], { conDia: false })} al ${fmtFecha(dias[6], { conDia: false })}`}
        </span>
      </div>

      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', flexDirection: ancho ? 'row' : 'column' }}>
        <div style={{ flex: 1, minWidth: 0, width: '100%' }}>
          {modo === 'frente' ? (
            <>
              {grillaFrente}
              <div style={{ display: 'flex', gap: '12px', marginTop: '10px', fontSize: '12px', color: '#6b7280', flexWrap: 'wrap', alignItems: 'center' }}>
                {Object.values(CATEGORIAS).map(c => (
                  <span key={c.label}><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', background: c.bg, borderLeft: `3px solid ${c.fg}`, marginRight: '4px' }} />{c.label}</span>
                ))}
                <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', background: '#fee2e2', border: '1px solid #b91c1c', marginRight: '4px' }} />No cumplida</span>
                <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', background: '#f3f4f6', border: '1px dashed #9ca3af', marginRight: '4px' }} />Pendiente de un día anterior</span>
                <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', border: '1px dashed #c2410c', marginRight: '4px' }} />Sin camión</span>
                <span>· Tocá un hueco para asignarlo, una celda vacía para elegir un encargo de ese destino</span>
              </div>
            </>
          ) : (
            <GrillaSemana catalogos={catalogos} camiones={camiones} dias={dias}
              asignaciones={asignaciones} copias={copias} encargos={encargos} filtroCats={filtro}
              onAbrirEncargo={onAbrirEncargo} onCeldaVacia={(preset) => setSheet({ preset })} recargar={recargar}
              pie={<FilasCapacidad camiones={camiones} dias={dias} ocup={ocup} encargos={encargos} anchoEtiqueta={ANCHO_CAMION} />} />
          )}
        </div>

        {/* e) Panel */}
        <PanelPorAsignar lista={listaPanel} conSaldo={listaSaldo} ctx={ctx} lateral={ancho}
          arrastrable={modo === 'camion'}
          onAbrir={onAbrirEncargo} onAsignar={(e, fecha) => abrirAsignar(e, fecha)} />
      </div>

      {elegir && (
        <Sheet titulo={`Asignar a ${elegir.nombre}`} subtitulo={`${fmtFecha(elegir.fecha)} · encargos abiertos con ese destino`} onCerrar={() => setElegir(null)}>
          {candidatosDestino.length === 0 && (
            <div style={{ color: '#6b7280', fontSize: '14px', padding: '8px 0' }}>No hay encargos abiertos hacia este destino.</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {candidatosDestino.map(e => (
              <button key={e.id} onClick={() => { setElegir(null); abrirAsignar(e, elegir.fecha) }}
                style={{ textAlign: 'left', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px 12px', cursor: 'pointer' }}>
                <div style={{ fontWeight: 800, fontSize: '14px', color: '#111827' }}>{e.descripcion}</div>
                <div style={{ fontSize: '12px', color: '#4b5563', marginTop: '2px' }}>desde {e.origen_nombre} · {fmtFechaRelativa(e.fecha_requerida)}</div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                  <ChipCategoria categoria={e.categoria} />
                  <ChipCamionRequerido tipo={e.tipo_camion_requerido} />
                </div>
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {sheet && (
        <AsignarSheet catalogos={cat} encargo={sheet.encargo} preset={sheet.preset} onCerrar={() => setSheet(null)}
          onGuardado={() => { setSheet(null); recargar() }} />
      )}
    </div>
  )
}
