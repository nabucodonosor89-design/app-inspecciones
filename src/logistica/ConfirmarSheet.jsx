import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast, confirmar } from '../utils/ui'
import Sheet from './Sheet'
import { estilos, fmtFecha, fmtNum, hoyPY, unidadLabel, msgError } from './constantes'
import { nombreCamion } from './datos'

/**
 * Registrar entrega / confirmar cantidad real.
 * - planificada → "Entregado" (con cantidad opcional) vía RPC entregar_asignacion.
 *   Si la fecha ya pasó, pregunta qué día se hizo realmente el viaje.
 * - entregada   → "Confirmar cantidad"
 * - confirmada  → "Corregir cantidad"
 */
export default function ConfirmarSheet({ catalogos, encargo, asignacion, onCerrar, onGuardado }) {
  const conCantidad = encargo.cantidad != null
  const hoy = hoyPY()
  const planificada = asignacion.estado === 'planificada'
  const preguntarDia = planificada && asignacion.fecha < hoy
  const [cantidad, setCantidad] = useState(asignacion.cantidad_real != null ? String(asignacion.cantidad_real) : '')
  const [fechaReal, setFechaReal] = useState(preguntarDia ? hoy : asignacion.fecha)
  const [duplicado, setDuplicado] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const unidad = unidadLabel(encargo.unidad)
  const camion = nombreCamion(catalogos.camiones, asignacion)

  const actualizar = async (cambios, mensaje) => {
    setGuardando(true)
    const { error } = await supabase.from('asignaciones').update(cambios).eq('id', asignacion.id)
    setGuardando(false)
    if (error) return toast('❌ ' + msgError(error))
    toast('✅ ' + mensaje)
    onGuardado()
  }

  const numero = () => {
    const n = Number(String(cantidad).replace(',', '.'))
    return cantidad !== '' && n > 0 ? n : null
  }

  /** Único camino para "Entregado": la RPC decide el estado final. */
  const entregar = async (cantidadReal, mensaje) => {
    if (!fechaReal || fechaReal < asignacion.fecha || fechaReal > hoy) {
      return toast(`⚠️ El día del viaje tiene que estar entre el ${fmtFecha(asignacion.fecha)} y hoy`)
    }
    setGuardando(true)
    const { error } = await supabase.rpc('entregar_asignacion', {
      p_id: asignacion.id, p_fecha_real: fechaReal, p_cantidad_real: cantidadReal,
    })
    setGuardando(false)
    if (error) {
      if (error.hint === 'asignacion_duplicada') setDuplicado(true)
      return toast('❌ ' + msgError(error))
    }
    toast('✅ ' + mensaje)
    onGuardado()
  }

  const quitarPendiente = async () => {
    if (!(await confirmar(`¿Quitar la asignación pendiente del ${fmtFecha(asignacion.fecha)}? La del ${fmtFecha(fechaReal)} queda como está.`))) return
    setGuardando(true)
    const { error } = await supabase.from('asignaciones').delete().eq('id', asignacion.id)
    setGuardando(false)
    if (error) return toast('❌ ' + msgError(error))
    toast('✅ Pendiente quitada correctamente')
    onGuardado()
  }

  const confirmarConCantidad = () => {
    const n = numero()
    if (!n) return toast('⚠️ Cargá la cantidad real entregada')
    if (planificada) return entregar(n, 'Entrega confirmada correctamente')
    actualizar({ estado: 'confirmada', cantidad_real: n },
      asignacion.estado === 'confirmada' ? 'Cantidad corregida correctamente' : 'Entrega confirmada correctamente')
  }

  const titulo = planificada ? 'Registrar entrega'
    : asignacion.estado === 'entregada' ? 'Confirmar cantidad' : 'Corregir cantidad'

  const pasoDia = preguntarDia && (
    <div style={{ marginBottom: '16px' }}>
      <label style={estilos.label}>¿Qué día se hizo el viaje?</label>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={() => { setFechaReal(hoy); setDuplicado(false) }} style={estilos.chip(fechaReal === hoy)}>
          Hoy · {fmtFecha(hoy)}
        </button>
        <button type="button" onClick={() => { setFechaReal(asignacion.fecha); setDuplicado(false) }} style={estilos.chip(fechaReal === asignacion.fecha)}>
          Día programado · {fmtFecha(asignacion.fecha)}
        </button>
        <input type="date" value={fechaReal || ''} min={asignacion.fecha} max={hoy}
          onChange={e => { setFechaReal(e.target.value); setDuplicado(false) }}
          style={{ ...estilos.input, width: 'auto', flex: '1 1 150px' }} />
      </div>
    </div>
  )

  const avisoDuplicado = duplicado && (
    <div style={{ marginTop: '12px', padding: '10px 12px', borderRadius: '10px', background: '#fef2f2', color: '#991b1b', fontSize: '13px' }}>
      Ya hay una asignación de este encargo para {camion} el {fmtFecha(fechaReal)}. Si es el mismo viaje, quitá esta pendiente y marcá esa.
      <div style={{ marginTop: '8px' }}>
        <button disabled={guardando} onClick={quitarPendiente} style={{ ...estilos.btnPeligro, minHeight: '36px', padding: '6px 12px', fontSize: '13px' }}>
          Quitar pendiente
        </button>
      </div>
    </div>
  )

  // Encargo sin cantidad: un toque (más el día real si la fecha ya pasó)
  if (!conCantidad) {
    return (
      <Sheet titulo={titulo} subtitulo={`${camion} · ${fmtFecha(asignacion.fecha)}`} onCerrar={onCerrar}
        pie={<>
          <button onClick={onCerrar} style={{ ...estilos.btnSecundario, flex: 1 }}>Cancelar</button>
          <button disabled={guardando} onClick={() => entregar(null, 'Entrega registrada correctamente')}
            style={{ ...estilos.btnPrimario, flex: 2 }}>✅ Entregado</button>
        </>}>
        {pasoDia}
        <p style={{ margin: 0, fontSize: '15px', color: '#374151' }}>
          <strong>{encargo.descripcion}</strong><br />{encargo.origen_nombre} → {encargo.destino_nombre}
        </p>
        {avisoDuplicado}
      </Sheet>
    )
  }

  const faltan = Number(encargo.cantidad) - Number(encargo.cantidad_confirmada || 0)

  return (
    <Sheet titulo={titulo} subtitulo={`${camion} · ${fmtFecha(asignacion.fecha)} · ${encargo.descripcion}`} onCerrar={onCerrar}
      pie={planificada ? <>
        <button disabled={guardando} onClick={() => entregar(null, 'Entrega registrada — falta confirmar cantidad')}
          style={{ ...estilos.btnSecundario, flex: 1 }}>Entregado, cantidad después</button>
        <button disabled={guardando} onClick={confirmarConCantidad} style={{ ...estilos.btnPrimario, flex: 1 }}>Confirmar</button>
      </> : <>
        {asignacion.estado === 'entregada' && (
          <button disabled={guardando} onClick={() => actualizar({ estado: 'planificada' }, 'Entrega deshecha correctamente')}
            style={estilos.btnPeligro}>Deshacer entrega</button>
        )}
        <button onClick={onCerrar} style={{ ...estilos.btnSecundario, flex: 1 }}>Cancelar</button>
        <button disabled={guardando} onClick={confirmarConCantidad} style={{ ...estilos.btnPrimario, flex: 2 }}>
          {asignacion.estado === 'confirmada' ? 'Guardar' : 'Confirmar'}
        </button>
      </>}>
      {pasoDia}
      <label style={estilos.label}>Cantidad real entregada ({unidad}){planificada && ' — opcional'}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <input value={cantidad} onChange={e => setCantidad(e.target.value)} inputMode="decimal" autoFocus={!preguntarDia}
          placeholder="0" style={{ ...estilos.input, fontSize: '28px', fontWeight: 800, textAlign: 'right', minHeight: '60px' }} />
        <span style={{ fontSize: '20px', fontWeight: 700, color: '#6b7280' }}>{unidad}</span>
      </div>
      <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '10px' }}>
        Pedido: {fmtNum(encargo.cantidad)} {unidad} · Confirmado: {fmtNum(encargo.cantidad_confirmada)} {unidad}
        {faltan > 0 && <> · Faltan {fmtNum(faltan)} {unidad}</>}
      </p>
      {planificada && (
        <p style={{ fontSize: '13px', color: '#6b7280' }}>
          Si todavía no tenés el número del remito, usá «Entregado, cantidad después»: el camión queda libre y la entrega
          aparece en «Por confirmar».
        </p>
      )}
      {avisoDuplicado}
    </Sheet>
  )
}
