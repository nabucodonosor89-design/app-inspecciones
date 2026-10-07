import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../utils/ui'
import Sheet from './Sheet'
import { estilos, fmtFecha, fmtNum, unidadLabel, msgError } from './constantes'
import { nombreCamion } from './datos'

/**
 * Registrar entrega / confirmar cantidad real.
 * - planificada → "Entregado" (con cantidad opcional)
 * - entregada   → "Confirmar cantidad"
 * - confirmada  → "Corregir cantidad"
 */
export default function ConfirmarSheet({ catalogos, encargo, asignacion, onCerrar, onGuardado }) {
  const conCantidad = encargo.cantidad != null
  const [cantidad, setCantidad] = useState(asignacion.cantidad_real != null ? String(asignacion.cantidad_real) : '')
  const [guardando, setGuardando] = useState(false)
  const unidad = unidadLabel(encargo.unidad)
  const camion = nombreCamion(catalogos.camiones, asignacion.equipo_id)

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

  const confirmarConCantidad = () => {
    const n = numero()
    if (!n) return toast('⚠️ Cargá la cantidad real entregada')
    actualizar({ estado: 'confirmada', cantidad_real: n },
      asignacion.estado === 'confirmada' ? 'Cantidad corregida correctamente' : 'Entrega confirmada correctamente')
  }

  const titulo = asignacion.estado === 'planificada' ? 'Registrar entrega'
    : asignacion.estado === 'entregada' ? 'Confirmar cantidad' : 'Corregir cantidad'

  // Encargo sin cantidad: un toque
  if (!conCantidad) {
    return (
      <Sheet titulo={titulo} subtitulo={`${camion} · ${fmtFecha(asignacion.fecha)}`} onCerrar={onCerrar}
        pie={<>
          <button onClick={onCerrar} style={{ ...estilos.btnSecundario, flex: 1 }}>Cancelar</button>
          <button disabled={guardando} onClick={() => actualizar({ estado: 'confirmada' }, 'Entrega registrada correctamente')}
            style={{ ...estilos.btnPrimario, flex: 2 }}>✅ Entregado</button>
        </>}>
        <p style={{ margin: 0, fontSize: '15px', color: '#374151' }}>
          <strong>{encargo.descripcion}</strong><br />{encargo.origen_nombre} → {encargo.destino_nombre}
        </p>
      </Sheet>
    )
  }

  const faltan = Number(encargo.cantidad) - Number(encargo.cantidad_confirmada || 0)

  return (
    <Sheet titulo={titulo} subtitulo={`${camion} · ${fmtFecha(asignacion.fecha)} · ${encargo.descripcion}`} onCerrar={onCerrar}
      pie={asignacion.estado === 'planificada' ? <>
        <button disabled={guardando} onClick={() => actualizar({ estado: 'entregada' }, 'Entrega registrada — falta confirmar cantidad')}
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
      <label style={estilos.label}>Cantidad real entregada ({unidad})</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <input value={cantidad} onChange={e => setCantidad(e.target.value)} inputMode="decimal" autoFocus
          placeholder="0" style={{ ...estilos.input, fontSize: '28px', fontWeight: 800, textAlign: 'right', minHeight: '60px' }} />
        <span style={{ fontSize: '20px', fontWeight: 700, color: '#6b7280' }}>{unidad}</span>
      </div>
      <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '10px' }}>
        Pedido: {fmtNum(encargo.cantidad)} {unidad} · Confirmado: {fmtNum(encargo.cantidad_confirmada)} {unidad}
        {faltan > 0 && <> · Faltan {fmtNum(faltan)} {unidad}</>}
      </p>
      {asignacion.estado === 'planificada' && (
        <p style={{ fontSize: '13px', color: '#6b7280' }}>
          Si todavía no tenés el número del remito, usá «Entregado, cantidad después»: el camión queda libre y la entrega
          aparece en «Por confirmar».
        </p>
      )}
    </Sheet>
  )
}
