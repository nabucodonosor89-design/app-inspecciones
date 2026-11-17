import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../utils/ui'
import { ChipAsignacion } from './Tarjetas'
import { nombreOperador } from './datos'
import { ESTADO_ASIG, ESTILO_COPIA, fmtFecha, hoyPY, msgError, tipoLabel } from './constantes'

export const ANCHO_CAMION = 130

/**
 * Grilla camión × día (la de Logística v2), ahora dentro del Tablero de despacho modo "Camión".
 * La semana, los datos y el filtro de material vienen del tablero. `pie` = filas de capacidad.
 * Mantiene el arrastrar y soltar de la v2 (encargo del panel → celda; asignación → otra celda).
 */
export default function GrillaSemana({ catalogos, camiones, dias, asignaciones, copias, encargos, filtroCats,
  onAbrirEncargo, onCeldaVacia, recargar, pie }) {
  const [sobre, setSobre] = useState(null) // celda bajo el arrastre
  const [guardando, setGuardando] = useState(false)
  const hoy = hoyPY()

  const pasaFiltro = (a) => {
    const e = encargos[a.encargo_id]
    return e && (!filtroCats.length || filtroCats.includes(e.categoria))
  }

  const celdas = useMemo(() => {
    const m = {}
    asignaciones.forEach(a => { (m[`${a.equipo_id}|${a.fecha}`] ||= []).push(a) })
    copias.forEach(a => { (m[`${a.equipo_id}|${a.dia}`] ||= []).push(a) })
    return m
  }, [asignaciones, copias])

  // Asignaciones de la semana en camiones que ya no están marcados como logística
  const huerfanas = asignaciones.filter(a => !camiones.some(c => c.id === a.equipo_id))

  const soltar = async (fecha, equipoId, dato) => {
    if (guardando) return
    setGuardando(true)
    let error
    if (dato.tipo === 'encargo') {
      const chofer = camiones.find(c => c.id === equipoId)?.operador_asignado_id || null
      ;({ error } = await supabase.from('asignaciones')
        .insert({ encargo_id: dato.id, fecha, equipo_id: equipoId, operador_id: chofer }))
      if (!error) toast('✅ Camión asignado correctamente')
    } else if (dato.tipo === 'asig') {
      if (dato.fecha === fecha && dato.equipo_id === equipoId) { setGuardando(false); return }
      const cambios = { fecha, equipo_id: equipoId }
      if (dato.equipo_id !== equipoId) cambios.operador_id = camiones.find(c => c.id === equipoId)?.operador_asignado_id || null
      ;({ error } = await supabase.from('asignaciones').update(cambios).eq('id', dato.id))
      if (!error) toast('✅ Asignación reprogramada correctamente')
    }
    setGuardando(false)
    if (error) return toast('❌ ' + msgError(error))
    if (fecha < hoy) toast('⚠️ Quedó asignada en un día pasado: aparecerá como atrasada')
    recargar()
  }

  const leerDato = (ev) => {
    try { return JSON.parse(ev.dataTransfer.getData('text/plain')) } catch { return null }
  }

  return (
    <>
      <div style={{ overflowX: 'auto', background: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: '860px' }}>
          <thead>
            <tr>
              <th style={{ width: `${ANCHO_CAMION}px`, textAlign: 'left', padding: '10px 12px', fontSize: '12px', color: '#6b7280', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>Camión</th>
              {dias.map(d => (
                <th key={d} style={{ padding: '10px 6px', fontSize: '13px', borderBottom: '1px solid #e5e7eb', borderLeft: '1px solid #f1f5f9',
                  background: d === hoy ? '#eff6ff' : '#f9fafb', color: d === hoy ? '#1d4ed8' : '#374151', fontWeight: 700 }}>
                  {fmtFecha(d)}{d === hoy && ' · hoy'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {camiones.map(c => (
              <tr key={c.id}>
                <td style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                  <div style={{ fontWeight: 800, fontSize: '14px' }}>{c.numero_identificacion}</div>
                  <div style={{ fontSize: '11px', color: c.tipo_camion ? '#4338ca' : '#9ca3af', fontWeight: c.tipo_camion ? 700 : 400 }}>{tipoLabel(c.tipo_camion)}</div>
                  <div style={{ fontSize: '11px', color: '#9ca3af' }}>{nombreOperador(catalogos.operadores, c.operador_asignado_id) || 'sin chofer fijo'}</div>
                </td>
                {dias.map(d => {
                  const key = `${c.id}|${d}`
                  const todas = celdas[key] || []
                  const lista = todas.filter(pasaFiltro)
                  const activo = sobre === key
                  return (
                    <td key={d}
                      onClick={() => { if (!todas.length) onCeldaVacia({ fecha: d, equipo_id: c.id }) }}
                      onDragOver={ev => { ev.preventDefault(); if (sobre !== key) setSobre(key) }}
                      onDragLeave={() => setSobre(s => (s === key ? null : s))}
                      onDrop={ev => { ev.preventDefault(); setSobre(null); const dato = leerDato(ev); if (dato) soltar(d, c.id, dato) }}
                      style={{ padding: '4px', borderBottom: '1px solid #f1f5f9', borderLeft: '1px solid #f1f5f9', verticalAlign: 'top',
                        background: activo ? '#dbeafe' : d === hoy ? '#f8fbff' : '#fff',
                        outline: activo ? '2px dashed #1d4ed8' : 'none', outlineOffset: '-3px',
                        cursor: todas.length ? 'default' : 'pointer', height: '58px', transition: 'background 0.1s' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        {lista.map(a => a.copia ? (
                          <ChipAsignacion key={`${a.id}-${a.dia}`} a={a} encargo={encargos[a.encargo_id]} compacto
                            onClick={(e) => { e.stopPropagation(); onAbrirEncargo(a.encargo_id) }} />
                        ) : (
                          <div key={a.id}
                            draggable={a.estado === 'planificada'}
                            onDragStart={ev => {
                              ev.dataTransfer.setData('text/plain', JSON.stringify({ tipo: 'asig', id: a.id, fecha: a.fecha, equipo_id: a.equipo_id }))
                              ev.dataTransfer.effectAllowed = 'move'
                            }}
                            style={{ cursor: a.estado === 'planificada' ? 'grab' : 'pointer' }}>
                            <ChipAsignacion a={a} encargo={encargos[a.encargo_id]} compacto
                              onClick={(e) => { e.stopPropagation(); onAbrirEncargo(a.encargo_id) }} />
                          </div>
                        ))}
                        {todas.length > lista.length && (
                          <div style={{ fontSize: '10px', color: '#9ca3af' }}>+{todas.length - lista.length} de otro material</div>
                        )}
                        {todas.length > 0 && (
                          <button onClick={(e) => { e.stopPropagation(); onCeldaVacia({ fecha: d, equipo_id: c.id }) }}
                            style={{ border: 'none', background: 'none', color: '#93c5fd', fontSize: '11px', cursor: 'pointer', padding: '2px', textAlign: 'left' }}>＋ agregar</button>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {pie}
      </div>

      {huerfanas.length > 0 && (
        <div style={{ marginTop: '10px', padding: '10px 12px', borderRadius: '10px', background: '#fffbeb', color: '#92400e', fontSize: '13px' }}>
          ⚠️ {huerfanas.length} asignación(es) de esta semana están en camiones que ya no figuran como logística activos:{' '}
          {huerfanas.map(a => encargos[a.encargo_id]?.descripcion || '¿?').join(', ')}
        </div>
      )}

      <div style={{ display: 'flex', gap: '14px', marginTop: '10px', fontSize: '12px', color: '#6b7280', flexWrap: 'wrap' }}>
        {Object.entries(ESTADO_ASIG).map(([k, v]) => (
          <span key={k}><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', background: v.bg, border: `1px solid ${v.color}`, marginRight: '4px' }} />{v.label}</span>
        ))}
        <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', background: '#fee2e2', border: '1px solid #b91c1c', marginRight: '4px' }} />No cumplida</span>
        <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', background: ESTILO_COPIA.bg, border: `1px dashed ${ESTILO_COPIA.borde}`, marginRight: '4px' }} />Pendiente de un día anterior</span>
        <span>· Arrastrá un encargo del panel a una celda para asignarlo · Arrastrá una asignación planificada para reprogramarla</span>
      </div>
    </>
  )
}
