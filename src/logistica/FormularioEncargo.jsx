import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../utils/ui'
import SelectorLugar from './SelectorLugar'
import { UNIDADES, estilos, hoyPY, sumarDias, msgError } from './constantes'

const lugarDe = (lugarId, obraId) =>
  obraId ? { tipo: 'obra', id: obraId } : lugarId ? { tipo: 'lugar', id: lugarId } : null

/**
 * Alta / edición de encargo. Pensado para completarse en < 30 s desde el celular.
 * encargo: fila de v_encargos (modo edición) o null (alta)
 */
export default function FormularioEncargo({ catalogos, onLugarCreado, encargo, onGuardado, onCancelar }) {
  const hoy = hoyPY()
  const manana = sumarDias(hoy, 1)
  const edicion = !!encargo
  const cantidadBloqueada = edicion && encargo.n_asignaciones > 0

  const [descripcion, setDescripcion] = useState(encargo?.descripcion || '')
  const [origen, setOrigen]   = useState(lugarDe(encargo?.origen_lugar_id, encargo?.origen_obra_id))
  const [destino, setDestino] = useState(lugarDe(encargo?.destino_lugar_id, encargo?.destino_obra_id))
  const [conCantidad, setConCantidad] = useState(encargo ? encargo.cantidad != null : false)
  const [cantidad, setCantidad] = useState(encargo?.cantidad != null ? String(encargo.cantidad) : '')
  const [unidad, setUnidad]     = useState(encargo?.unidad || 'un')
  const [fecha, setFecha]       = useState(encargo?.fecha_requerida || null)
  const [elegirFecha, setElegirFecha] = useState(!!encargo?.fecha_requerida && ![hoy, manana].includes(encargo.fecha_requerida))
  const [notas, setNotas]       = useState(encargo?.notas || '')
  const [verNotas, setVerNotas] = useState(!!encargo?.notas)
  const [guardando, setGuardando] = useState(false)

  const mismaRuta = origen && destino && origen.tipo === destino.tipo && origen.id === destino.id

  const guardar = async (e) => {
    e.preventDefault()
    if (!descripcion.trim()) return toast('⚠️ Indicá qué hay que mover')
    if (!origen)  return toast('⚠️ Elegí desde dónde')
    if (!destino) return toast('⚠️ Elegí hacia dónde')
    if (mismaRuta) return toast('⚠️ El origen y el destino no pueden ser el mismo lugar')
    const cant = conCantidad ? Number(String(cantidad).replace(',', '.')) : null
    if (conCantidad && !(cant > 0)) return toast('⚠️ Cargá una cantidad mayor a cero')

    const payload = {
      descripcion: descripcion.trim(),
      origen_lugar_id:  origen.tipo === 'lugar' ? origen.id : null,
      origen_obra_id:   origen.tipo === 'obra' ? origen.id : null,
      destino_lugar_id: destino.tipo === 'lugar' ? destino.id : null,
      destino_obra_id:  destino.tipo === 'obra' ? destino.id : null,
      cantidad: cant,
      unidad: conCantidad ? unidad : null,
      fecha_requerida: fecha,
      notas: notas.trim() || null,
    }

    setGuardando(true)
    const q = edicion
      ? supabase.from('encargos').update(payload).eq('id', encargo.id).select('id').single()
      : supabase.from('encargos').insert(payload).select('id').single()
    const { data, error } = await q
    setGuardando(false)
    if (error) return toast('❌ ' + msgError(error))
    toast(edicion ? '✅ Encargo actualizado correctamente' : '✅ Encargo cargado correctamente')
    onGuardado(data.id)
  }

  const fechaChip = (valor, label) => (
    <button type="button" onClick={() => { setFecha(valor); setElegirFecha(false) }}
      style={estilos.chip(!elegirFecha && fecha === valor)}>{label}</button>
  )

  return (
    <form onSubmit={guardar} style={{ maxWidth: '560px', margin: '0 auto', padding: '16px', paddingBottom: '120px' }}>
      <h2 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 16px', color: '#111827' }}>
        {edicion ? 'Editar encargo' : 'Nuevo encargo'}
      </h2>

      <div style={{ marginBottom: '16px' }}>
        <label style={estilos.label}>¿Qué hay que mover?</label>
        <input value={descripcion} onChange={e => setDescripcion(e.target.value)} autoFocus={!edicion}
          placeholder="Ej: Caño de draga, repuestos OT 4521, alcantarillas 2×2" style={estilos.input} />
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={estilos.label}>Desde</label>
        <SelectorLugar obras={catalogos.obras} lugares={catalogos.lugares} valor={origen} onChange={setOrigen}
          onLugarCreado={onLugarCreado} placeholder="Buscar obra, base o proveedor…" />
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={estilos.label}>Hacia</label>
        <SelectorLugar obras={catalogos.obras} lugares={catalogos.lugares} valor={destino} onChange={setDestino}
          onLugarCreado={onLugarCreado} placeholder="Buscar obra, base o proveedor…" />
        {mismaRuta && <div style={{ color: '#b91c1c', fontSize: '13px', marginTop: '6px' }}>El destino es igual al origen</div>}
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={estilos.label}>Cantidad</label>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button type="button" disabled={cantidadBloqueada} onClick={() => setConCantidad(false)} style={estilos.chip(!conCantidad)}>Sin cantidad</button>
          <button type="button" disabled={cantidadBloqueada} onClick={() => setConCantidad(true)} style={estilos.chip(conCantidad)}>Con cantidad</button>
        </div>
        {cantidadBloqueada && (
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px' }}>
            Ya tiene asignaciones: se puede cambiar el número pero no quitar ni agregar la cantidad.
          </div>
        )}
        {conCantidad && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={cantidad} onChange={e => setCantidad(e.target.value)} inputMode="decimal" placeholder="150"
              style={{ ...estilos.input, width: '120px' }} />
            {UNIDADES.map(u => (
              <button key={u.id} type="button" onClick={() => setUnidad(u.id)} style={estilos.chip(unidad === u.id)}>{u.label}</button>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={estilos.label}>¿Para cuándo?</label>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {fechaChip(hoy, 'Hoy')}
          {fechaChip(manana, 'Mañana')}
          <button type="button" onClick={() => { setElegirFecha(true); if (!fecha || [hoy, manana].includes(fecha)) setFecha(sumarDias(hoy, 2)) }}
            style={estilos.chip(elegirFecha)}>Elegir fecha</button>
          <button type="button" onClick={() => { setFecha(null); setElegirFecha(false) }}
            style={estilos.chip(!elegirFecha && fecha === null)}>Cuando se pueda</button>
        </div>
        {elegirFecha && (
          <input type="date" value={fecha || ''} onChange={e => setFecha(e.target.value || null)}
            style={{ ...estilos.input, marginTop: '10px', maxWidth: '220px' }} />
        )}
      </div>

      <div style={{ marginBottom: '16px' }}>
        {verNotas ? (
          <>
            <label style={estilos.label}>Notas</label>
            <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={3}
              placeholder="Contacto en obra, horario, observaciones…" style={{ ...estilos.input, resize: 'vertical' }} />
          </>
        ) : (
          <button type="button" onClick={() => setVerNotas(true)}
            style={{ background: 'none', border: 'none', color: '#1d4ed8', fontSize: '14px', fontWeight: 600, cursor: 'pointer', padding: 0 }}>
            ＋ Agregar notas
          </button>
        )}
      </div>

      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, background: '#fff', borderTop: '1px solid #e5e7eb',
        padding: '12px 16px calc(12px + env(safe-area-inset-bottom))', display: 'flex', gap: '10px', zIndex: 1500,
        justifyContent: 'center',
      }}>
        <div style={{ display: 'flex', gap: '10px', width: '100%', maxWidth: '560px' }}>
          <button type="button" onClick={onCancelar} style={{ ...estilos.btnSecundario, flex: 1 }}>Cancelar</button>
          <button type="submit" disabled={guardando} style={{ ...estilos.btnPrimario, flex: 2 }}>
            {guardando ? 'Guardando…' : edicion ? 'Guardar cambios' : 'Cargar encargo'}
          </button>
        </div>
      </div>
    </form>
  )
}
