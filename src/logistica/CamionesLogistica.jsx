import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../utils/ui'
import { useAsignacionesRango } from './hooks'
import { mapaOcupacion, ocupado } from './despacho'
import { COLS_CAMION, nombreOperador } from './datos'
import { TIPOS_CAMION, estilos, hoyPY, lunesDe, sumarDias, tipoLabel, useEsEscritorio } from './constantes'

/**
 * Camiones de logística: tipo de camión y ocupación de la semana actual.
 * El tipo lo edita solo el rol admin (RPC set_tipo_camion). Logística lo ve en modo lectura.
 */
export default function CamionesLogistica({ catalogos, esAdmin, onCambio }) {
  const escritorio = useEsEscritorio()
  const [camiones, setCamiones] = useState(catalogos.camiones)
  const [guardando, setGuardando] = useState(null) // id del camión que se está guardando
  const lunes = lunesDe(hoyPY())
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i)), [lunes])
  const { asignaciones, copias, cargando } = useAsignacionesRango(dias[0], dias[6], 'camiones')
  const ocup = useMemo(() => mapaOcupacion(asignaciones, copias), [asignaciones, copias])

  useEffect(() => {
    let vivo = true
    supabase.from('equipos').select(COLS_CAMION)
      .eq('es_logistica', true).eq('activo', true).order('numero_identificacion').limit(200)
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) return toast('❌ ' + error.message)
        setCamiones(data)
      })
    return () => { vivo = false }
  }, [])

  const sinTipo = camiones.filter(c => !c.tipo_camion).length

  const cambiarTipo = async (c, tipo) => {
    if (!esAdmin || guardando || c.tipo_camion === tipo) return
    setGuardando(c.id)
    const { error } = await supabase.rpc('set_tipo_camion', { p_equipo_id: c.id, p_tipo: tipo })
    setGuardando(null)
    if (error) return toast('❌ ' + error.message)
    setCamiones(cs => cs.map(x => (x.id === c.id ? { ...x, tipo_camion: tipo } : x)))
    toast(`✅ ${c.numero_identificacion}: ${tipoLabel(tipo).toLowerCase()}`)
    onCambio?.()
  }

  const ocupacionSemana = (c) => dias.filter(d => ocupado(ocup, c.id, d)).length

  const chipTipo = (c, tipo, label) => {
    const activo = (c.tipo_camion || null) === tipo
    return (
      <button key={label} onClick={() => cambiarTipo(c, tipo)} disabled={guardando === c.id}
        style={{ ...estilos.chip(activo), minHeight: '34px', padding: '4px 12px', fontSize: '13px' }}>
        {label}
      </button>
    )
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: escritorio ? '16px 20px 40px' : '12px 12px 110px' }}>
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '18px', fontWeight: 800, color: '#111827' }}>Camiones de logística</div>
        <div style={{ fontSize: '13px', color: '#6b7280' }}>
          {camiones.length} camiones activos · ocupación de esta semana ({lunes.slice(8, 10)}/{lunes.slice(5, 7)} al {dias[6].slice(8, 10)}/{dias[6].slice(5, 7)})
          {!esAdmin && ' · solo lectura (el tipo lo carga el gerente)'}
        </div>
      </div>

      {sinTipo > 0 && (
        <div style={{ marginBottom: '12px', padding: '10px 12px', borderRadius: '10px', background: '#fffbeb', color: '#92400e', fontSize: '14px', fontWeight: 600 }}>
          ⚠️ {sinTipo} {sinTipo > 1 ? 'camiones' : 'camión'} sin tipo: las sugerencias no {sinTipo > 1 ? 'los' : 'lo'} tienen en cuenta.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {camiones.map(c => {
          const n = ocupacionSemana(c)
          const chofer = nombreOperador(catalogos.operadores, c.operador_asignado_id)
          const denom = (c.denominacion || '').replace(c.numero_identificacion, '').trim()
          return (
            <div key={c.id} style={{ ...estilos.card, padding: '12px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: escritorio ? '0 0 260px' : '1 1 100%', minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: '15px' }}>🚛 {c.numero_identificacion}</div>
                <div style={{ fontSize: '12px', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{denom || '—'}</div>
                <div style={{ fontSize: '12px', color: '#9ca3af' }}>{chofer ? `👤 ${chofer}` : 'Sin chofer fijo'}</div>
              </div>
              <div style={{ flex: 1, display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                {esAdmin ? (
                  <>
                    {Object.entries(TIPOS_CAMION).map(([id, label]) => chipTipo(c, id, label))}
                    {chipTipo(c, null, 'Sin tipo')}
                  </>
                ) : (
                  <span style={{ padding: '4px 12px', borderRadius: '999px', fontSize: '13px', fontWeight: 700,
                    background: c.tipo_camion ? '#eef2ff' : '#f3f4f6', color: c.tipo_camion ? '#3730a3' : '#6b7280' }}>
                    {tipoLabel(c.tipo_camion)}
                  </span>
                )}
              </div>
              <div style={{ textAlign: 'right', minWidth: '70px' }}>
                <div style={{ fontSize: '18px', fontWeight: 800, color: n >= 6 ? '#b91c1c' : n >= 4 ? '#c2410c' : '#166534' }}>{cargando ? '…' : `${n}/7`}</div>
                <div style={{ fontSize: '11px', color: '#9ca3af' }}>días ocupados</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
