import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../utils/ui'
import { C, s, ddmm } from '../correctivos/constantes'
import NuevaInspeccion from '../NuevaInspeccion.jsx'
import { textoVencido } from './constantes'

// ============================================================
// MI LISTA DE LA SEMANA — inspector asignado a una zona (mobile-first)
// Lee insp_mi_zona() e insp_mi_lista() (SECURITY DEFINER, filtran por el usuario logueado).
// Titular y suplente de la misma zona ven la misma lista.
// Tocar un equipo abre el formulario de inspección existente con el equipo cargado.
// ============================================================

export default function MiListaSemana({ user, onVolver }) {
  const [cargando, setCargando] = useState(true)
  const [zonas, setZonas] = useState([])
  const [lista, setLista] = useState([])
  const [equipoInsp, setEquipoInsp] = useState(null)
  const [abriendo, setAbriendo] = useState(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [z, l] = await Promise.all([supabase.rpc('insp_mi_zona'), supabase.rpc('insp_mi_lista')])
      if (z.error) throw z.error
      if (l.error) throw l.error
      setZonas(z.data || [])
      setLista(l.data || [])
    } catch (e) {
      console.error(e)
      toast('❌ Error al cargar la lista: ' + e.message, 'error')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // Agrupado por zona → obra (ubicación IE36), respetando el orden del plan
  const grupos = useMemo(() => {
    const porZona = new Map()
    lista.forEach((f) => {
      if (!porZona.has(f.zona_id)) porZona.set(f.zona_id, { nombre: f.zona_nombre, obras: new Map() })
      const obras = porZona.get(f.zona_id).obras
      const obra = f.ubicacion_sap || 'Sin ubicación'
      if (!obras.has(obra)) obras.set(obra, [])
      obras.get(obra).push(f)
    })
    return [...porZona.values()]
  }, [lista])

  const hechos = lista.filter((f) => f.hecho).length

  async function abrirEquipo(f) {
    setAbriendo(f.equipo_id)
    const { data, error } = await supabase.from('equipos').select('*').eq('id', f.equipo_id).single()
    setAbriendo(null)
    if (error) { toast('❌ No se pudo abrir el equipo: ' + error.message, 'error'); return }
    setEquipoInsp(data)
  }

  if (equipoInsp) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: 'clamp(0.5rem, 2vw, 2rem)' }}>
        <NuevaInspeccion
          user={user}
          equipoPreseleccionado={equipoInsp}
          onVolver={() => { setEquipoInsp(null); cargar() }}
        />
      </div>
    )
  }

  const semana = lista[0]?.semana

  return (
    <div style={{ minHeight: '100vh', background: C.fondo }}>
      <div style={{ ...s.wrap, maxWidth: 720 }}>
        <div style={s.header}>
          <button style={s.boton} onClick={onVolver} aria-label="Volver">←</button>
          <div style={{ flex: 1, minWidth: 160 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Mi lista de la semana</h2>
            <div style={s.meta}>
              {zonas.map((z) => z.zona_nombre).join(' · ') || '—'}
              {semana ? ` · semana del ${ddmm(semana)}` : ''}
            </div>
          </div>
          <button style={{ ...s.boton, color: C.azul, fontWeight: 600 }} onClick={cargar} disabled={cargando}>
            {cargando ? '…' : '↻'}
          </button>
        </div>

        {cargando && !lista.length ? (
          <div style={s.vacio}>Cargando…</div>
        ) : !zonas.length ? (
          <div style={s.vacio}>No estás asignado a ninguna zona esta semana.</div>
        ) : !lista.length ? (
          <div style={s.vacio}>Todavía no hay plan para esta semana. Se genera los lunes a las 06:00.</div>
        ) : (
          <>
            {/* Avance */}
            <div style={{ ...s.card, position: 'sticky', top: 0, zIndex: 5 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ fontSize: 22 }}>{hechos} de {lista.length} hechos</strong>
                <span style={s.meta}>{Math.round((hechos / lista.length) * 100)} %</span>
              </div>
              <div style={{ height: 8, background: C.borde, borderRadius: 4, marginTop: 8, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(hechos / lista.length) * 100}%`, background: C.verde }} />
              </div>
            </div>

            {grupos.map((g) => (
              <div key={g.nombre}>
                {grupos.length > 1 && <h3 style={{ ...s.subtitulo, marginTop: 16 }}>{g.nombre}</h3>}
                {[...g.obras.entries()].map(([obra, equipos]) => {
                  const hechosObra = equipos.filter((e) => e.hecho).length
                  return (
                    <div key={obra} style={s.card}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                        <strong>{obra}</strong>
                        <span style={s.meta}>{hechosObra}/{equipos.length}</span>
                      </div>
                      {equipos.map((f) => (
                        <button
                          key={f.equipo_id}
                          onClick={() => abrirEquipo(f)}
                          disabled={abriendo === f.equipo_id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                            minHeight: 52, padding: '8px 4px', background: 'none', border: 'none',
                            borderTop: `1px solid ${C.borde}`, cursor: 'pointer', color: C.texto,
                          }}
                        >
                          <span style={{
                            width: 26, height: 26, flex: '0 0 26px', borderRadius: 13, display: 'flex',
                            alignItems: 'center', justifyContent: 'center', fontWeight: 700,
                            background: f.hecho ? C.verdeBg : '#fff', color: C.verde,
                            border: `2px solid ${f.hecho ? C.verde : C.borde}`,
                          }}>{f.hecho ? '✓' : ''}</span>
                          <span style={{ flex: 1, minWidth: 0, textDecoration: f.hecho ? 'line-through' : 'none', opacity: f.hecho ? 0.6 : 1 }}>
                            <strong>{f.numero_identificacion}</strong>
                            <span style={{ display: 'block', fontSize: 13, color: C.gris, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {f.denominacion || '—'}
                            </span>
                          </span>
                          <VencidoChip dias={f.dias_vencido_al_generar} hecho={f.hecho} />
                        </button>
                      ))}
                    </div>
                  )
                })}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function VencidoChip({ dias, hecho }) {
  const t = textoVencido(dias)
  if (hecho) return <span style={s.chip(C.verdeBg, C.verde)}>Hecho</span>
  const color = dias == null || dias > 0 ? [C.rojoBg, C.rojo] : [C.ambarBg, C.ambar]
  return <span style={s.chip(...color)}>{t}</span>
}
