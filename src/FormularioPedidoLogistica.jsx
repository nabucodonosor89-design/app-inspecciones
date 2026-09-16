import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import { toast } from './utils/ui'

const UNIDADES = ['unidades', 'tn', 'm³', 'kg', 'm', 'm²', 'lt', 'bolsas', 'pallets']

function FormularioPedidoLogistica({ pedido, usuario, onGuardado, onCerrar }) {
  const esEdicion = !!pedido

  const [obras, setObras] = useState([])
  const [loading, setLoading] = useState(false)

  const [obraId, setObraId]               = useState(pedido?.obra_id || '')
  const [origen, setOrigen]               = useState(pedido?.origen || '')
  const [material, setMaterial]           = useState(pedido?.material || '')
  const [cantidadTotal, setCantidadTotal] = useState(pedido?.cantidad_total || '')
  const [unidad, setUnidad]               = useState(pedido?.unidad || 'tn')
  const [notas, setNotas]                 = useState(pedido?.notas || '')

  useEffect(() => {
    cargarObras()
  }, [])

  async function cargarObras() {
    const { data, error } = await supabase
      .from('obras')
      .select('id, nombre_obra, codigo_obra')
      .eq('activa', true)
      .order('nombre_obra')
    if (!error) setObras(data || [])
  }

  async function guardar(e) {
    e.preventDefault()
    if (!obraId || !origen.trim() || !material.trim() || !cantidadTotal) {
      toast('❌ Completá todos los campos obligatorios')
      return
    }
    const cant = parseFloat(cantidadTotal)
    if (isNaN(cant) || cant <= 0) {
      toast('❌ La cantidad debe ser mayor a cero')
      return
    }

    setLoading(true)
    try {
      const payload = {
        obra_id:        obraId,
        origen:         origen.trim(),
        material:       material.trim(),
        cantidad_total: cant,
        unidad,
        notas:          notas.trim() || null,
        updated_at:     new Date().toISOString()
      }

      if (esEdicion) {
        const { error } = await supabase
          .from('pedidos_logistica')
          .update(payload)
          .eq('id', pedido.id)
        if (error) throw error
        toast('✅ Pedido actualizado')
      } else {
        const { error } = await supabase
          .from('pedidos_logistica')
          .insert({ ...payload, creado_por: usuario.id })
        if (error) throw error
        toast('✅ Pedido creado')
      }

      onGuardado()
    } catch (err) {
      console.error(err)
      toast('❌ Error al guardar: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      background: 'white',
      borderRadius: '12px',
      padding: '2rem',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      maxWidth: '600px',
      margin: '0 auto'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: '700', margin: 0 }}>
          {esEdicion ? '✏️ Editar pedido' : '📦 Nuevo pedido de logística'}
        </h2>
        <button onClick={onCerrar} style={{
          background: 'none', border: 'none', fontSize: '1.5rem',
          cursor: 'pointer', color: '#6b7280', padding: '0.25rem'
        }}>✕</button>
      </div>

      <form onSubmit={guardar}>
        {/* Obra destino */}
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.4rem', color: '#374151' }}>
            Obra destino *
          </label>
          <select
            value={obraId}
            onChange={e => setObraId(e.target.value)}
            required
            style={inputStyle}
          >
            <option value="">Seleccionar obra…</option>
            {obras.map(o => (
              <option key={o.id} value={o.id}>
                {o.codigo_obra} — {o.nombre_obra}
              </option>
            ))}
          </select>
        </div>

        {/* Origen */}
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.4rem', color: '#374151' }}>
            Origen (proveedor / depósito / obra) *
          </label>
          <input
            type="text"
            value={origen}
            onChange={e => setOrigen(e.target.value)}
            placeholder="Ej: Proveedor Piedra SA, Complejo Ypané, Obra Ruta 7…"
            required
            style={inputStyle}
          />
        </div>

        {/* Material */}
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.4rem', color: '#374151' }}>
            Material *
          </label>
          <input
            type="text"
            value={material}
            onChange={e => setMaterial(e.target.value)}
            placeholder="Ej: Piedra triturada ¾, Arena, Asfalto…"
            required
            style={inputStyle}
          />
        </div>

        {/* Cantidad + Unidad */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.4rem', color: '#374151' }}>
              Cantidad total *
            </label>
            <input
              type="number"
              min="0.001"
              step="0.001"
              value={cantidadTotal}
              onChange={e => setCantidadTotal(e.target.value)}
              placeholder="0"
              required
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.4rem', color: '#374151' }}>
              Unidad *
            </label>
            <select value={unidad} onChange={e => setUnidad(e.target.value)} style={inputStyle}>
              {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>

        {/* Notas */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.4rem', color: '#374151' }}>
            Notas (opcional)
          </label>
          <textarea
            value={notas}
            onChange={e => setNotas(e.target.value)}
            rows={3}
            placeholder="Observaciones, prioridad, referencias…"
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>

        {/* Botones */}
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCerrar} style={btnSecundario}>
            Cancelar
          </button>
          <button type="submit" disabled={loading} style={btnPrimario}>
            {loading ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear pedido'}
          </button>
        </div>
      </form>
    </div>
  )
}

const inputStyle = {
  width: '100%',
  padding: '0.6rem 0.8rem',
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  fontSize: '0.95rem',
  boxSizing: 'border-box',
  background: 'white'
}

const btnPrimario = {
  padding: '0.65rem 1.5rem',
  background: '#2563eb',
  color: 'white',
  border: 'none',
  borderRadius: '8px',
  fontWeight: '600',
  fontSize: '0.95rem',
  cursor: 'pointer'
}

const btnSecundario = {
  padding: '0.65rem 1.5rem',
  background: '#f3f4f6',
  color: '#374151',
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  fontWeight: '600',
  fontSize: '0.95rem',
  cursor: 'pointer'
}

export default FormularioPedidoLogistica
