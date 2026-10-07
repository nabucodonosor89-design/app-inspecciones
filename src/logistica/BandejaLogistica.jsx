import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast, confirmar } from '../utils/ui'
import TarjetaEncargo from './TarjetaEncargo'
import AsignarSheet from './AsignarSheet'
import ConfirmarSheet from './ConfirmarSheet'
import { COLS_ENCARGO, COLS_ASIG, nombreCamion } from './datos'
import { SECCIONES, seccionDe, hoyPY, estilos, msgError } from './constantes'

export default function BandejaLogistica({ catalogos, onAbrirEncargo, onNuevo, version }) {
  const [filtro, setFiltro] = useState('abiertos') // 'abiertos' | 'historial'
  const [encargos, setEncargos] = useState([])
  const [asignaciones, setAsignaciones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [colapsadas, setColapsadas] = useState({ en_curso: false })
  const [sheet, setSheet] = useState(null) // { tipo: 'asignar'|'confirmar', encargo, asignacion }
  const [recarga, setRecarga] = useState(0)

  const cargar = useCallback(async () => {
    setCargando(true)
    let q = supabase.from('v_encargos').select(COLS_ENCARGO)
    if (filtro === 'abiertos') {
      q = q.eq('estado', 'abierto').order('fecha_requerida', { ascending: true, nullsFirst: false }).order('created_at').limit(300)
    } else {
      const desde = new Date(Date.now() - 30 * 86400000).toISOString()
      q = q.neq('estado', 'abierto').gte('cerrado_at', desde).order('cerrado_at', { ascending: false }).limit(200)
    }
    const { data, error } = await q
    if (error) { toast('❌ ' + error.message); setCargando(false); return }
    setEncargos(data)

    if (filtro === 'abiertos' && data.length) {
      const { data: asig, error: e2 } = await supabase.from('asignaciones').select(COLS_ASIG)
        .in('encargo_id', data.map(e => e.id)).in('estado', ['planificada', 'entregada'])
        .order('fecha').limit(1000)
      if (e2) toast('❌ ' + e2.message)
      setAsignaciones(asig || [])
    } else {
      setAsignaciones([])
    }
    setCargando(false)
  }, [filtro])

  useEffect(() => { cargar() }, [cargar, version, recarga])

  const hoy = hoyPY()
  const porEncargo = useMemo(() => {
    const m = {}
    asignaciones.forEach(a => { (m[a.encargo_id] ||= []).push(a) })
    return m
  }, [asignaciones])

  const grupos = useMemo(() => {
    const g = {}
    if (filtro !== 'abiertos') return g
    encargos.forEach(e => { (g[seccionDe(e, hoy)] ||= []).push(e) })
    return g
  }, [encargos, filtro, hoy])

  const camion = (id) => nombreCamion(catalogos.camiones, id)

  const cerrar = async (e) => {
    if (!(await confirmar(`¿Cerrar el encargo «${e.descripcion}»?`))) return
    const { error } = await supabase.from('encargos').update({ estado: 'cerrado' }).eq('id', e.id)
    if (error) return toast('❌ ' + msgError(error))
    toast('✅ Encargo cerrado correctamente')
    setRecarga(r => r + 1)
  }

  const accionPara = (seccion, e) => {
    if (seccion === 'listo_para_cerrar') return { label: 'Cerrar', color: '#16a34a', onClick: () => cerrar(e) }
    if (seccion === 'por_confirmar') {
      const pend = (porEncargo[e.id] || []).filter(a => a.estado === 'entregada')
      return {
        label: 'Confirmar', color: '#7c3aed',
        onClick: () => pend.length === 1 ? setSheet({ tipo: 'confirmar', encargo: e, asignacion: pend[0] }) : onAbrirEncargo(e.id),
      }
    }
    return { label: 'Asignar', onClick: () => setSheet({ tipo: 'asignar', encargo: e }) }
  }

  const alGuardar = () => { setSheet(null); setRecarga(r => r + 1) }

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', padding: '12px 12px 110px' }}>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
        <button onClick={() => setFiltro('abiertos')} style={estilos.chip(filtro === 'abiertos')}>Abiertos</button>
        <button onClick={() => setFiltro('historial')} style={estilos.chip(filtro === 'historial')}>Cerrados (30 días)</button>
        <div style={{ flex: 1 }} />
        <button onClick={() => setRecarga(r => r + 1)} title="Actualizar"
          style={{ ...estilos.btnSecundario, minHeight: '40px', padding: '6px 12px' }}>↻</button>
      </div>

      {cargando && <div style={{ textAlign: 'center', color: '#6b7280', padding: '40px' }}>Cargando…</div>}

      {!cargando && encargos.length === 0 && (
        <div style={{ ...estilos.card, textAlign: 'center', padding: '40px 16px', color: '#6b7280' }}>
          {filtro === 'abiertos' ? (
            <>
              <div style={{ fontSize: '40px' }}>🎉</div>
              <p style={{ margin: '8px 0 16px' }}>No hay encargos abiertos.</p>
              <button onClick={onNuevo} style={estilos.btnPrimario}>＋ Cargar encargo</button>
            </>
          ) : 'No hay encargos cerrados en los últimos 30 días.'}
        </div>
      )}

      {!cargando && filtro === 'abiertos' && SECCIONES.map(s => {
        const lista = grupos[s.id]
        if (!lista?.length) return null
        const colapsada = colapsadas[s.id]
        return (
          <section key={s.id} style={{ marginBottom: '18px' }}>
            <button
              onClick={() => setColapsadas(c => ({ ...c, [s.id]: !c[s.id] }))}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', background: 'none', border: 'none',
                padding: '6px 2px', cursor: 'pointer', fontSize: '14px', fontWeight: 800, color: s.color, textTransform: 'uppercase', letterSpacing: '0.03em' }}
            >
              <span>{s.emoji}</span>
              <span>{s.label}</span>
              <span style={{ background: s.color, color: '#fff', borderRadius: '999px', padding: '1px 8px', fontSize: '12px' }}>{lista.length}</span>
              <span style={{ flex: 1 }} />
              <span style={{ color: '#9ca3af' }}>{colapsada ? '▸' : '▾'}</span>
            </button>
            {!colapsada && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                {lista.map(e => (
                  <TarjetaEncargo key={e.id} encargo={e} asignaciones={porEncargo[e.id]} nombreCamion={camion}
                    accion={accionPara(s.id, e)} onAbrir={() => onAbrirEncargo(e.id)} />
                ))}
              </div>
            )}
          </section>
        )
      })}

      {!cargando && filtro === 'historial' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {encargos.map(e => (
            <TarjetaEncargo key={e.id} encargo={e} nombreCamion={camion} onAbrir={() => onAbrirEncargo(e.id)} />
          ))}
        </div>
      )}

      {sheet?.tipo === 'asignar' && (
        <AsignarSheet catalogos={catalogos} encargo={sheet.encargo} onCerrar={() => setSheet(null)} onGuardado={alGuardar} />
      )}
      {sheet?.tipo === 'confirmar' && (
        <ConfirmarSheet catalogos={catalogos} encargo={sheet.encargo} asignacion={sheet.asignacion}
          onCerrar={() => setSheet(null)} onGuardado={alGuardar} />
      )}
    </div>
  )
}
