import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast, confirmar } from '../utils/ui'
import Sheet from './Sheet'
import ComboBox from './ComboBox'
import { COLS_ENCARGO, claveDestino } from './datos'
import { estilos, hoyPY, sumarDias, fmtFecha, msgError } from './constantes'

/**
 * Crear o reprogramar una asignación (camión + día).
 * - encargo: fila de v_encargos; si es null se elige de la lista de abiertos (modo calendario)
 * - asignacion: fila existente → modo edición (solo planificadas)
 * - preset: { fecha, equipo_id } al abrir desde una celda del calendario
 */
export default function AsignarSheet({ catalogos, encargo: encargoProp, asignacion, preset, onCerrar, onGuardado }) {
  const hoy = hoyPY()
  const manana = sumarDias(hoy, 1)
  const edicion = !!asignacion

  const fechaInicial = asignacion?.fecha || preset?.fecha ||
    (encargoProp?.fecha_requerida && encargoProp.fecha_requerida >= hoy ? encargoProp.fecha_requerida : hoy)

  const [encargos, setEncargos]   = useState([])
  const [encargoId, setEncargoId] = useState(encargoProp?.id || null)
  const [fecha, setFecha]         = useState(fechaInicial)
  const [equipoId, setEquipoId]   = useState(asignacion?.equipo_id || preset?.equipo_id || null)
  const choferDe = (eqId) => catalogos.camiones.find(c => c.id === eqId)?.operador_asignado_id || null
  const [operadorId, setOperadorId] = useState(edicion ? asignacion.operador_id : choferDe(preset?.equipo_id))
  const [operadorTocado, setOperadorTocado] = useState(edicion)
  const [notas, setNotas]         = useState(asignacion?.notas || '')
  const [ocupacion, setOcupacion] = useState([]) // asignaciones del día
  const [guardando, setGuardando] = useState(false)

  // Modo calendario: cargar encargos abiertos para elegir
  useEffect(() => {
    if (encargoProp) return
    supabase.from('v_encargos').select(COLS_ENCARGO).eq('estado', 'abierto')
      .order('fecha_requerida', { ascending: true, nullsFirst: false }).limit(300)
      .then(({ data, error }) => { if (error) toast('❌ ' + error.message); else setEncargos(data) })
  }, [encargoProp])

  const encargo = encargoProp || encargos.find(e => e.id === encargoId) || null

  // Ocupación de camiones en la fecha elegida
  useEffect(() => {
    if (!fecha) return
    let vivo = true
    supabase.from('asignaciones')
      .select('id, equipo_id, encargo_id, encargos(descripcion, destino_lugar_id, destino_obra_id)')
      .eq('fecha', fecha).limit(500)
      .then(({ data, error }) => { if (vivo) { if (error) toast('❌ ' + error.message); else setOcupacion(data) } })
    return () => { vivo = false }
  }, [fecha])


  const conteoPorCamion = useMemo(() => {
    const m = {}
    ocupacion.forEach(a => { if (a.id !== asignacion?.id) m[a.equipo_id] = (m[a.equipo_id] || 0) + 1 })
    return m
  }, [ocupacion, asignacion])

  // Avisos: otros encargos del mismo camión ese día
  const otrosDelCamion = ocupacion.filter(a => a.equipo_id === equipoId && a.id !== asignacion?.id && a.encargo_id !== encargo?.id)
  const mismoDestino = encargo ? otrosDelCamion.filter(a => a.encargos && claveDestino(a.encargos) === claveDestino(encargo)) : []
  const otroDestino  = encargo ? otrosDelCamion.filter(a => a.encargos && claveDestino(a.encargos) !== claveDestino(encargo)) : []

  const guardar = async () => {
    if (!encargo) return toast('⚠️ Elegí el encargo')
    if (!fecha) return toast('⚠️ Elegí el día')
    if (!equipoId) return toast('⚠️ Elegí el camión')
    setGuardando(true)
    const payload = { fecha, equipo_id: equipoId, operador_id: operadorId, notas: notas.trim() || null }
    const { error } = edicion
      ? await supabase.from('asignaciones').update(payload).eq('id', asignacion.id)
      : await supabase.from('asignaciones').insert({ ...payload, encargo_id: encargo.id })
    setGuardando(false)
    if (error) return toast('❌ ' + msgError(error))
    toast(edicion ? '✅ Asignación reprogramada correctamente' : '✅ Camión asignado correctamente')
    onGuardado()
  }

  const quitar = async () => {
    if (!(await confirmar('¿Quitar esta asignación? El encargo vuelve a quedar pendiente de camión.'))) return
    setGuardando(true)
    const { error } = await supabase.from('asignaciones').delete().eq('id', asignacion.id)
    setGuardando(false)
    if (error) return toast('❌ ' + msgError(error))
    toast('✅ Asignación quitada correctamente')
    onGuardado()
  }

  const esPreset = [hoy, manana].includes(fecha)

  return (
    <Sheet
      titulo={edicion ? 'Reprogramar' : 'Asignar camión'}
      subtitulo={encargo ? `${encargo.descripcion} · ${encargo.origen_nombre} → ${encargo.destino_nombre}` : 'Elegí el encargo'}
      onCerrar={onCerrar}
      pie={<>
        {edicion && <button onClick={quitar} disabled={guardando} style={{ ...estilos.btnPeligro }}>Quitar</button>}
        <button onClick={onCerrar} style={{ ...estilos.btnSecundario, flex: 1 }}>Cancelar</button>
        <button onClick={guardar} disabled={guardando} style={{ ...estilos.btnPrimario, flex: 2 }}>
          {guardando ? 'Guardando…' : edicion ? 'Guardar' : 'Asignar'}
        </button>
      </>}
    >
      {!encargoProp && (
        <div style={{ marginBottom: '16px' }}>
          <label style={estilos.label}>Encargo</label>
          <ComboBox
            opciones={encargos}
            valor={encargoId}
            onChange={setEncargoId}
            getId={e => e.id}
            getLabel={e => `${e.descripcion} → ${e.destino_nombre}`}
            getDetalle={e => e.fecha_requerida ? fmtFecha(e.fecha_requerida) : ''}
            placeholder="Buscar encargo abierto…"
          />
        </div>
      )}

      <div style={{ marginBottom: '16px' }}>
        <label style={estilos.label}>Día</label>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" onClick={() => setFecha(hoy)} style={estilos.chip(fecha === hoy)}>Hoy</button>
          <button type="button" onClick={() => setFecha(manana)} style={estilos.chip(fecha === manana)}>Mañana</button>
          <input type="date" value={fecha || ''} onChange={e => setFecha(e.target.value)}
            style={{ ...estilos.input, width: 'auto', flex: '1 1 150px', borderColor: esPreset ? '#d1d5db' : '#1d4ed8' }} />
        </div>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={estilos.label}>Camión</label>
        <ComboBox
          opciones={catalogos.camiones}
          valor={equipoId}
          onChange={id => { setEquipoId(id); if (!operadorTocado) setOperadorId(choferDe(id)) }}
          getId={c => c.id}
          getLabel={c => c.numero_identificacion}
          getDetalle={c => {
            const n = conteoPorCamion[c.id] || 0
            const tipo = (c.denominacion || '').replace(c.numero_identificacion, '').trim().toLowerCase()
            return `${tipo}${n ? ` · ${n} el ${fmtFecha(fecha, { conDia: false })}` : ' · libre'}`
          }}
          placeholder="Buscar camión (ej. VP-GR007)"
        />
        {mismoDestino.length > 0 && (
          <div style={{ marginTop: '8px', padding: '10px 12px', borderRadius: '10px', background: '#ecfdf5', color: '#065f46', fontSize: '13px' }}>
            🔗 Va junto con: {mismoDestino.map(a => a.encargos.descripcion).join(', ')}
          </div>
        )}
        {otroDestino.length > 0 && (
          <div style={{ marginTop: '8px', padding: '10px 12px', borderRadius: '10px', background: '#fffbeb', color: '#92400e', fontSize: '13px' }}>
            ⚠️ Ese día ya tiene otro destino: {otroDestino.map(a => a.encargos.descripcion).join(', ')}
          </div>
        )}
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={estilos.label}>Chofer</label>
        <ComboBox
          opciones={catalogos.operadores}
          valor={operadorId}
          onChange={id => { setOperadorTocado(true); setOperadorId(id) }}
          getId={o => o.id}
          getLabel={o => `${o.nombres} ${o.apellidos || ''}`.trim()}
          placeholder="Sin chofer definido"
        />
        {operadorId && (
          <button type="button" onClick={() => { setOperadorTocado(true); setOperadorId(null) }}
            style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '13px', marginTop: '6px', cursor: 'pointer', padding: 0 }}>
            Quitar chofer
          </button>
        )}
      </div>

      <div>
        <label style={estilos.label}>Notas (opcional)</label>
        <input value={notas} onChange={e => setNotas(e.target.value)} style={estilos.input} placeholder="Ej: sale después del mediodía" />
      </div>
    </Sheet>
  )
}
