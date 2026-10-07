import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../utils/ui'
import ComboBox from './ComboBox'
import { TIPO_LUGAR, estilos } from './constantes'

/**
 * Selector de origen/destino: mezcla obras activas y lugares (bases, proveedores, otros).
 * valor: { tipo: 'obra' | 'lugar', id } | null
 */
export default function SelectorLugar({ obras, lugares, valor, onChange, onLugarCreado, placeholder, autoFocus }) {
  const [nuevo, setNuevo] = useState(null) // { nombre, tipo }
  const [guardando, setGuardando] = useState(false)

  const opciones = [
    ...lugares.map(l => ({ key: `l:${l.id}`, tipo: 'lugar', id: l.id, label: l.nombre, sub: l.tipo })),
    ...obras.map(o => ({ key: `o:${o.id}`, tipo: 'obra', id: o.id, label: o.nombre_obra, sub: 'obra' })),
  ]
  const key = valor ? `${valor.tipo === 'obra' ? 'o' : 'l'}:${valor.id}` : null

  const crear = async () => {
    if (!nuevo?.nombre?.trim()) return
    setGuardando(true)
    const { data, error } = await supabase
      .from('lugares').insert({ nombre: nuevo.nombre.trim(), tipo: nuevo.tipo })
      .select('id, nombre, tipo').single()
    setGuardando(false)
    if (error) {
      toast(error.code === '23505' ? '⚠️ Ya existe un lugar con ese nombre' : '❌ Error al crear lugar: ' + error.message)
      return
    }
    onLugarCreado(data)
    onChange({ tipo: 'lugar', id: data.id })
    setNuevo(null)
    toast('✅ Lugar creado correctamente')
  }

  if (nuevo) {
    return (
      <div style={{ border: '1px dashed #93c5fd', borderRadius: '10px', padding: '12px', background: '#f8fbff' }}>
        <input
          value={nuevo.nombre}
          autoFocus
          onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })}
          style={estilos.input}
          placeholder="Nombre del lugar"
        />
        <div style={{ display: 'flex', gap: '8px', margin: '10px 0', flexWrap: 'wrap' }}>
          {['base', 'proveedor', 'otro'].map(t => (
            <button key={t} type="button" onClick={() => setNuevo({ ...nuevo, tipo: t })} style={estilos.chip(nuevo.tipo === t)}>
              {TIPO_LUGAR[t].emoji} {TIPO_LUGAR[t].label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" onClick={() => setNuevo(null)} style={{ ...estilos.btnSecundario, flex: 1 }}>Cancelar</button>
          <button type="button" onClick={crear} disabled={guardando} style={{ ...estilos.btnPrimario, flex: 1 }}>
            {guardando ? 'Guardando…' : 'Crear lugar'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <ComboBox
      opciones={opciones}
      valor={key}
      getId={o => o.key}
      getLabel={o => o.label}
      getDetalle={o => `${TIPO_LUGAR[o.sub]?.emoji || ''} ${TIPO_LUGAR[o.sub]?.label || ''}`}
      onChange={k => { const o = opciones.find(x => x.key === k); onChange(o ? { tipo: o.tipo, id: o.id } : null) }}
      onCrear={nombre => setNuevo({ nombre, tipo: 'proveedor' })}
      placeholder={placeholder}
      autoFocus={autoFocus}
    />
  )
}
