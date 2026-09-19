import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './lib/supabase'
import { toast } from './utils/ui'

const ESTADOS_FLETE = {
  pendiente:   { label: 'Pendiente',   color: '#92400e', bg: '#fef3c7', emoji: '⏳' },
  asignado:    { label: 'Asignado',    color: '#1e40af', bg: '#dbeafe', emoji: '🚛' },
  en_transito: { label: 'En tránsito', color: '#065f46', bg: '#d1fae5', emoji: '🛣️' },
  entregado:   { label: 'Entregado',   color: '#166534', bg: '#bbf7d0', emoji: '✅' },
  cancelado:   { label: 'Cancelado',   color: '#6b7280', bg: '#f3f4f6', emoji: '❌' },
}

const SIGUIENTE_ESTADO = {
  pendiente: 'asignado',
  asignado: 'en_transito',
  en_transito: 'entregado',
}

const ACCION_LABEL = {
  pendiente: 'Asignar camión',
  asignado: 'Iniciar tránsito',
  en_transito: 'Confirmar entrega',
}

const ACCION_EXITO = {
  pendiente:   '🚛 Camión asignado correctamente',
  asignado:    '🛣️ Tránsito iniciado',
  en_transito: '✅ Entrega confirmada',
}

// ── ComboBox: input con filtrado en tiempo real ──────────────────────────────
function ComboBox({ opciones, valor, onChange, placeholder, getLabel, getId, disabled }) {
  const [busqueda, setBusqueda]   = useState('')
  const [abierto, setAbierto]     = useState(false)
  const [resaltado, setResaltado] = useState(-1)
  const inputRef = useRef(null)
  const listaRef = useRef(null)

  const seleccionado = opciones.find(o => getId(o) === valor)
  const textoInput   = abierto ? busqueda : (seleccionado ? getLabel(seleccionado) : '')

  const filtradas = busqueda.trim()
    ? opciones.filter(o => getLabel(o).toLowerCase().includes(busqueda.toLowerCase()))
    : opciones

  const handleFocus = () => {
    if (disabled) return
    setAbierto(true)
    setBusqueda('')
    setResaltado(-1)
  }

  const handleBlur = (e) => {
    if (!listaRef.current?.contains(e.relatedTarget)) {
      setAbierto(false)
      setBusqueda('')
    }
  }

  const handleSelect = (opcion) => {
    onChange(getId(opcion))
    setAbierto(false)
    setBusqueda('')
  }

  const handleKeyDown = (e) => {
    if (!abierto) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setResaltado(r => Math.min(r + 1, filtradas.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setResaltado(r => Math.max(r - 1, 0)) }
    if (e.key === 'Enter' && resaltado >= 0) handleSelect(filtradas[resaltado])
    if (e.key === 'Escape') { setAbierto(false); setBusqueda('') }
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="text"
        value={textoInput}
        disabled={disabled}
        onChange={e => { setBusqueda(e.target.value); if (!abierto) setAbierto(true) }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        style={{
          width: '100%', padding: '8px', borderRadius: '6px',
          border: '1px solid #d1d5db', fontSize: '13px',
          boxSizing: 'border-box', background: disabled ? '#f9fafb' : '#fff',
          cursor: disabled ? 'not-allowed' : 'text',
        }}
      />
      {abierto && (
        <div
          ref={listaRef}
          style={{
            position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0,
            background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 300,
            maxHeight: '200px', overflowY: 'auto',
          }}
        >
          {filtradas.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: '13px', color: '#9ca3af' }}>Sin resultados</div>
          ) : filtradas.map((o, i) => (
            <div
              key={getId(o)}
              onMouseDown={() => handleSelect(o)}
              style={{
                padding: '8px 12px', fontSize: '13px', cursor: 'pointer',
                background: i === resaltado ? '#eff6ff' : 'transparent',
                color: '#111827',
                borderBottom: i < filtradas.length - 1 ? '1px solid #f3f4f6' : 'none',
              }}
            >
              {getLabel(o)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Banner de éxito temporal ─────────────────────────────────────────────────
function BannerExito({ mensaje }) {
  if (!mensaje) return null
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      background: '#f0fdf4', border: '1px solid #86efac',
      borderRadius: '8px', padding: '12px 16px', marginBottom: '16px',
    }}>
      <span style={{ fontSize: '20px' }}>✅</span>
      <span style={{ fontSize: '14px', fontWeight: '600', color: '#166534' }}>{mensaje}</span>
    </div>
  )
}

// ── Componente principal ─────────────────────────────────────────────────────
export default function GestionFletes({ pedidoId, usuario, onVolver }) {
  const [pedido, setPedido]             = useState(null)
  const [fletes, setFletes]             = useState([])
  const [camiones, setCamiones]         = useState([])
  const [operadores, setOperadores]     = useState([])
  const [cargando, setCargando]         = useState(true)
  const [mostrarFormFlete, setMostrarFormFlete] = useState(false)
  const [guardando, setGuardando]       = useState(false)
  const [procesando, setProcesando]     = useState(null)
  const [mensajeExito, setMensajeExito] = useState(null)
  const timerRef = useRef(null)

  const [formFlete, setFormFlete] = useState({
    equipo_id: '', operador_id: '', cantidad: '', notas: '',
  })

  const mostrarExito = (msg) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setMensajeExito(msg)
    timerRef.current = setTimeout(() => setMensajeExito(null), 3000)
  }

  const cargarDatos = useCallback(async () => {
    setCargando(true)
    try {
      const [pedidoRes, fletesRes] = await Promise.all([
        supabase
          .from('pedidos_logistica')
          .select('*, obras(nombre_obra, codigo_obra)')
          .eq('id', pedidoId)
          .single(),
        supabase
          .from('fletes')
          .select('*, equipos(denominacion, matricula, numero_identificacion), operadores(nombres, apellidos)')
          .eq('pedido_id', pedidoId)
          .order('created_at', { ascending: false }),
      ])
      if (pedidoRes.error) throw pedidoRes.error
      if (fletesRes.error) throw fletesRes.error
      setPedido(pedidoRes.data)
      setFletes(fletesRes.data || [])
    } catch (e) {
      toast('❌ Error al cargar datos: ' + e.message)
    } finally {
      setCargando(false)
    }
  }, [pedidoId])

  useEffect(() => {
    cargarDatos()
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [cargarDatos])

  const cargarCamionesDisponibles = useCallback(async () => {
    try {
      const { data: busy, error: busyError } = await supabase
        .from('fletes')
        .select('equipo_id')
        .in('estado', ['asignado', 'en_transito'])
        .not('equipo_id', 'is', null)
      if (busyError) throw busyError

      const busyIds = (busy || []).map(f => f.equipo_id)

      let query = supabase
        .from('equipos')
        .select('id, denominacion, matricula, numero_identificacion')
        .eq('es_logistica', true)
        .eq('estado_operativo', 'operativo')
        .eq('activo', true)
        .order('denominacion')

      if (busyIds.length > 0) {
        query = query.not('id', 'in', `(${busyIds.join(',')})`)
      }

      const { data, error } = await query
      if (error) throw error
      setCamiones(data || [])
    } catch (e) {
      toast('❌ Error al cargar camiones: ' + e.message)
    }
  }, [])

  const cargarOperadores = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('operadores')
        .select('id, nombres, apellidos')
        .eq('estado', 'activo')
        .order('apellidos')
      if (error) throw error
      setOperadores(data || [])
    } catch (e) {
      toast('❌ Error al cargar operadores: ' + e.message)
    }
  }, [])

  const calcularSaldo = () => {
    if (!pedido) return 0
    const comprometido = fletes
      .filter(f => f.estado !== 'cancelado')
      .reduce((sum, f) => sum + Number(f.cantidad), 0)
    return pedido.cantidad_total - comprometido
  }

  const calcularEntregado = () =>
    fletes.filter(f => f.estado === 'entregado').reduce((sum, f) => sum + Number(f.cantidad), 0)

  const calcularEnProceso = () =>
    fletes
      .filter(f => ['pendiente', 'asignado', 'en_transito'].includes(f.estado))
      .reduce((sum, f) => sum + Number(f.cantidad), 0)

  const porcentajeEntregado = () => {
    if (!pedido || pedido.cantidad_total === 0) return 0
    return Math.min(100, Math.round((calcularEntregado() / pedido.cantidad_total) * 100))
  }

  const handleAbrirFormFlete = async () => {
    setMostrarFormFlete(true)
    setFormFlete({ equipo_id: '', operador_id: '', cantidad: '', notas: '', fecha_asignacion: new Date().toISOString().slice(0,10) })
    await Promise.all([cargarCamionesDisponibles(), cargarOperadores()])
  }

  const handleCerrarFormFlete = () => {
    setMostrarFormFlete(false)
    setFormFlete({ equipo_id: '', operador_id: '', cantidad: '', notas: '', fecha_asignacion: new Date().toISOString().slice(0,10) })
  }

  const verificarCompletado = async () => {
    const { data: todosFletes, error } = await supabase
      .from('fletes')
      .select('estado, cantidad')
      .eq('pedido_id', pedidoId)
    if (error) return
    const totalEntregado = (todosFletes || [])
      .filter(f => f.estado === 'entregado')
      .reduce((sum, f) => sum + Number(f.cantidad), 0)
    if (totalEntregado >= pedido.cantidad_total) {
      await supabase
        .from('pedidos_logistica')
        .update({ estado: 'completado', updated_at: new Date().toISOString() })
        .eq('id', pedidoId)
    }
  }

  const crearFlete = async () => {
    const cantidad = Number(formFlete.cantidad)
    const saldo = calcularSaldo()
    if (!formFlete.equipo_id)       return toast('❌ Seleccioná un camión')
    if (!formFlete.operador_id)     return toast('❌ Seleccioná un conductor')
    if (!cantidad || cantidad <= 0) return toast('❌ Ingresá una cantidad válida')
    if (cantidad > saldo)           return toast(`❌ La cantidad supera el saldo (${saldo.toFixed(3)} ${pedido.unidad})`)

    setGuardando(true)
    try {
      const { data: nuevoFlete, error: fleteError } = await supabase
        .from('fletes')
        .insert({
          pedido_id:        pedidoId,
          equipo_id:        formFlete.equipo_id,
          operador_id:      formFlete.operador_id,
          cantidad,
          estado:           'asignado',
          fecha_asignacion: formFlete.fecha_asignacion ? new Date(formFlete.fecha_asignacion + 'T00:00:00').toISOString() : new Date().toISOString(),
          notas:            formFlete.notas || null,
          creado_por:       usuario.id,
        })
        .select()
        .single()
      if (fleteError) throw fleteError

      await supabase.from('fletes_auditoria').insert({
        flete_id:        nuevoFlete.id,
        estado_anterior: null,
        estado_nuevo:    'asignado',
        notas:           'Flete creado',
        usuario_id:      usuario.id,
      })

      if (pedido.estado === 'pendiente') {
        await supabase
          .from('pedidos_logistica')
          .update({ estado: 'en_proceso', updated_at: new Date().toISOString() })
          .eq('id', pedidoId)
      }

      handleCerrarFormFlete()
      await cargarDatos()
      mostrarExito('🚛 Flete asignado correctamente')
    } catch (e) {
      toast('❌ Error al crear flete: ' + e.message)
    } finally {
      setGuardando(false)
    }
  }

  const avanzarEstado = async (flete) => {
    const siguiente = SIGUIENTE_ESTADO[flete.estado]
    if (!siguiente) return
    setProcesando(flete.id)
    try {
      const updates = { estado: siguiente, updated_at: new Date().toISOString() }
      if (siguiente === 'en_transito') updates.fecha_salida  = new Date().toISOString()
      if (siguiente === 'entregado')   updates.fecha_entrega = new Date().toISOString()

      const { error } = await supabase.from('fletes').update(updates).eq('id', flete.id)
      if (error) throw error

      await supabase.from('fletes_auditoria').insert({
        flete_id:        flete.id,
        estado_anterior: flete.estado,
        estado_nuevo:    siguiente,
        usuario_id:      usuario.id,
      })

      if (siguiente === 'entregado') await verificarCompletado()

      await cargarDatos()
      mostrarExito(ACCION_EXITO[flete.estado])
    } catch (e) {
      toast('❌ Error al actualizar estado: ' + e.message)
    } finally {
      setProcesando(null)
    }
  }

  const cancelarFlete = async (flete) => {
    if (!confirm('¿Cancelar este flete? El saldo será liberado.')) return
    setProcesando(flete.id)
    try {
      const { error } = await supabase
        .from('fletes')
        .update({ estado: 'cancelado', updated_at: new Date().toISOString() })
        .eq('id', flete.id)
      if (error) throw error

      await supabase.from('fletes_auditoria').insert({
        flete_id:        flete.id,
        estado_anterior: flete.estado,
        estado_nuevo:    'cancelado',
        notas:           'Cancelado por usuario',
        usuario_id:      usuario.id,
      })

      toast('✅ Flete cancelado')
      await cargarDatos()
    } catch (e) {
      toast('❌ Error al cancelar flete: ' + e.message)
    } finally {
      setProcesando(null)
    }
  }

  if (cargando) return (
    <div style={{ textAlign: 'center', padding: '60px', color: '#6b7280' }}>Cargando...</div>
  )
  if (!pedido) return (
    <div style={{ textAlign: 'center', padding: '60px', color: '#6b7280' }}>Pedido no encontrado.</div>
  )

  const saldo      = calcularSaldo()
  const entregado  = calcularEntregado()
  const enProceso  = calcularEnProceso()
  const pct        = porcentajeEntregado()
  const completado = pedido.estado === 'completado'
  const cancelado  = pedido.estado === 'cancelado'
  const puedeAgregarFlete = !completado && !cancelado && saldo > 0

  const ESTADO_PEDIDO_CFG = {
    pendiente:  { bg: '#fef3c7', color: '#92400e', label: 'Pendiente' },
    en_proceso: { bg: '#dbeafe', color: '#1e40af', label: 'En proceso' },
    completado: { bg: '#bbf7d0', color: '#166534', label: '✅ Completado' },
    cancelado:  { bg: '#f3f4f6', color: '#6b7280', label: 'Cancelado' },
  }
  const estCfg = ESTADO_PEDIDO_CFG[pedido.estado] || ESTADO_PEDIDO_CFG.pendiente

  const getCamionLabel   = (c) => `${c.denominacion}${c.matricula ? ` (${c.matricula})` : c.numero_identificacion ? ` (${c.numero_identificacion})` : ''}`
  const getOperadorLabel = (o) => `${o.apellidos}, ${o.nombres}`

  return (
    <div style={{ padding: '24px', maxWidth: '900px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '24px' }}>
        <button
          onClick={onVolver}
          style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer', color: '#374151', fontSize: '14px', flexShrink: 0, marginTop: '2px' }}
        >
          ← Volver
        </button>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: '20px', color: '#111827' }}>{pedido.material}</h2>
          <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#6b7280' }}>
            Desde <strong>{pedido.origen}</strong> → {pedido.obras?.nombre_obra || 'Obra'}
            {pedido.obras?.codigo_obra ? ` (${pedido.obras.codigo_obra})` : ''}
          </p>
        </div>
        <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: '600', background: estCfg.bg, color: estCfg.color, flexShrink: 0 }}>
          {estCfg.label}
        </span>
      </div>

      {/* Métricas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total pedido', value: `${pedido.cantidad_total} ${pedido.unidad}`, color: '#1e40af', bg: '#eff6ff' },
          { label: 'Entregado',    value: `${entregado.toFixed(3)} ${pedido.unidad}`,  color: '#166534', bg: '#f0fdf4' },
          { label: 'Saldo',        value: `${saldo.toFixed(3)} ${pedido.unidad}`,      color: saldo > 0 ? '#92400e' : '#166534', bg: saldo > 0 ? '#fffbeb' : '#f0fdf4' },
        ].map(m => (
          <div key={m.label} style={{ background: m.bg, borderRadius: '10px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: '700', color: m.color }}>{m.value}</div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>{m.label}</div>
          </div>
        ))}
      </div>

      {/* Barra de progreso */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>
          <span>Progreso de entrega</span><span>{pct}%</span>
        </div>
        <div style={{ height: '10px', background: '#e5e7eb', borderRadius: '9999px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#22c55e' : '#3b82f6', borderRadius: '9999px', transition: 'width 0.3s ease' }} />
        </div>
        {enProceso > 0 && (
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
            🚛 {enProceso.toFixed(3)} {pedido.unidad} en camino
          </div>
        )}
      </div>

      {/* Banner de éxito */}
      <BannerExito mensaje={mensajeExito} />

      {/* Botón agregar flete */}
      {puedeAgregarFlete && !mostrarFormFlete && (
        <button
          onClick={handleAbrirFormFlete}
          style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', marginBottom: '20px' }}
        >
          + Asignar nuevo flete
        </button>
      )}

      {/* Formulario nuevo flete */}
      {mostrarFormFlete && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '15px', color: '#111827' }}>Nuevo flete</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', color: '#374151', marginBottom: '4px' }}>Camión *</label>
              <ComboBox
                opciones={camiones}
                valor={formFlete.equipo_id}
                onChange={v => setFormFlete(f => ({ ...f, equipo_id: v }))}
                placeholder="Buscar camión..."
                getLabel={getCamionLabel}
                getId={c => c.id}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', color: '#374151', marginBottom: '4px' }}>Conductor *</label>
              <ComboBox
                opciones={operadores}
                valor={formFlete.operador_id}
                onChange={v => setFormFlete(f => ({ ...f, operador_id: v }))}
                placeholder="Buscar conductor..."
                getLabel={getOperadorLabel}
                getId={o => o.id}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', color: '#374151', marginBottom: '4px' }}>Fecha de asignación *</label>
              <input
                type="date"
                value={formFlete.fecha_asignacion}
                onChange={e => setFormFlete(f => ({ ...f, fecha_asignacion: e.target.value }))}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', color: '#374151', marginBottom: '4px' }}>
                Cantidad * — saldo disponible: {saldo.toFixed(3)} {pedido.unidad}
              </label>
              <input
                type="number"
                min="0.001"
                max={saldo}
                step="0.001"
                value={formFlete.cantidad}
                onChange={e => setFormFlete(f => ({ ...f, cantidad: e.target.value }))}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px', boxSizing: 'border-box' }}
                placeholder={`Máx. ${saldo.toFixed(3)}`}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', color: '#374151', marginBottom: '4px' }}>Notas</label>
              <input
                type="text"
                value={formFlete.notas}
                onChange={e => setFormFlete(f => ({ ...f, notas: e.target.value }))}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px', boxSizing: 'border-box' }}
                placeholder="Opcional"
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <button
              onClick={crearFlete}
              disabled={guardando}
              style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: '6px', padding: '9px 20px', fontSize: '13px', fontWeight: '600', cursor: guardando ? 'not-allowed' : 'pointer', opacity: guardando ? 0.7 : 1 }}
            >
              {guardando ? 'Guardando...' : 'Confirmar flete'}
            </button>
            <button
              onClick={handleCerrarFormFlete}
              style={{ background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', padding: '9px 20px', fontSize: '13px', cursor: 'pointer' }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Lista de fletes */}
      <div>
        <h3 style={{ fontSize: '15px', color: '#111827', marginBottom: '12px' }}>
          Fletes ({fletes.length})
        </h3>
        {fletes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#9ca3af', background: '#f9fafb', borderRadius: '10px' }}>
            Sin fletes aún. Asigná el primero con el botón de arriba.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {fletes.map(flete => {
              const est          = ESTADOS_FLETE[flete.estado] || ESTADOS_FLETE.cancelado
              const ocupado      = procesando === flete.id
              const nombreCamion = flete.equipos
                ? getCamionLabel(flete.equipos)
                : 'Sin camión asignado'
              const nombreConductor = flete.operadores
                ? `${flete.operadores.apellidos}, ${flete.operadores.nombres}`
                : 'Sin conductor'
              const puedeCancelar = !['entregado', 'cancelado'].includes(flete.estado)
              const puedeAvanzar  = !!SIGUIENTE_ESTADO[flete.estado]

              return (
                <div key={flete.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: '600', background: est.bg, color: est.color }}>
                          {est.emoji} {est.label}
                        </span>
                        <span style={{ fontWeight: '700', fontSize: '15px', color: '#111827' }}>
                          {Number(flete.cantidad).toFixed(3)} {pedido.unidad}
                        </span>
                      </div>
                      <div style={{ marginTop: '8px', fontSize: '13px', color: '#6b7280', display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
                        <span>🚛 {nombreCamion}</span>
                        <span>👤 {nombreConductor}</span>
                        {flete.fecha_asignacion && <span>📅 {new Date(flete.fecha_asignacion).toLocaleDateString('es-PY')}</span>}
                        {flete.fecha_salida     && <span>🛣️ Salida: {new Date(flete.fecha_salida).toLocaleDateString('es-PY')}</span>}
                        {flete.fecha_entrega    && <span>✅ Entrega: {new Date(flete.fecha_entrega).toLocaleDateString('es-PY')}</span>}
                      </div>
                      {flete.notas && (
                        <div style={{ marginTop: '6px', fontSize: '12px', color: '#9ca3af', fontStyle: 'italic' }}>{flete.notas}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0, flexDirection: 'column', alignItems: 'flex-end' }}>
                      {puedeAvanzar && (
                        <button
                          onClick={() => avanzarEstado(flete)}
                          disabled={ocupado}
                          style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', fontWeight: '600', cursor: ocupado ? 'not-allowed' : 'pointer', opacity: ocupado ? 0.7 : 1, whiteSpace: 'nowrap' }}
                        >
                          {ocupado ? '...' : ACCION_LABEL[flete.estado]}
                        </button>
                      )}
                      {puedeCancelar && (
                        <button
                          onClick={() => cancelarFlete(flete)}
                          disabled={ocupado}
                          style={{ background: '#fff', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', cursor: ocupado ? 'not-allowed' : 'pointer', opacity: ocupado ? 0.7 : 1, whiteSpace: 'nowrap' }}
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {pedido.notas && (
        <div style={{ marginTop: '24px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px', padding: '12px 16px' }}>
          <div style={{ fontSize: '12px', color: '#92400e', fontWeight: '600', marginBottom: '4px' }}>Notas del pedido</div>
          <div style={{ fontSize: '13px', color: '#78350f' }}>{pedido.notas}</div>
        </div>
      )}
    </div>
  )
}
