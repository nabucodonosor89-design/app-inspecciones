import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import SubidaFotos from './SubidaFotos.jsx'

function NuevaInspeccion({ user, onVolver, equipoPreseleccionado }) {
  const [paso, setPaso] = useState(equipoPreseleccionado ? 2 : 1)
  const [equipos, setEquipos] = useState([])
  const [obras, setObras] = useState([])
  const [equipoSeleccionado, setEquipoSeleccionado] = useState(equipoPreseleccionado)
  const [checklistTemplates, setChecklistTemplates] = useState([])
  const [loading, setLoading] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [tipoInspeccion, setTipoInspeccion] = useState('')
  const [horometro, setHorometro] = useState('')
  const [ubicacion, setUbicacion] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [checklist, setChecklist] = useState({})
  const [checklistObservaciones, setChecklistObservaciones] = useState({}) // NUEVO: Observaciones por ítem
  const [fotos, setFotos] = useState([])
  const [inspeccionEnvioRelacionada, setInspeccionEnvioRelacionada] = useState('')
  const [inspeccionesEnvio, setInspeccionesEnvio] = useState([])
  
  // NUEVO: Estados para motivo de envío
  const [motivoEnvio, setMotivoEnvio] = useState('')
  const [pedidoEquipoLineaId, setPedidoEquipoLineaId] = useState('')
  const [pedidosDisponibles, setPedidosDisponibles] = useState([])
  const [observacionesEnvio, setObservacionesEnvio] = useState('')

  useEffect(() => {
    getEquipos()
    getObras()
    // Si hay equipo preseleccionado, cargar su checklist
    if (equipoPreseleccionado) {
      getChecklistTemplate(equipoPreseleccionado.tipo_equipo)
    }
  }, [])

  // Cargar inspecciones de envío cuando se selecciona tipo "recepcion"
  useEffect(() => {
    if (tipoInspeccion === 'recepcion' && equipoSeleccionado) {
      getInspeccionesEnvio(equipoSeleccionado.id)
    }
  }, [tipoInspeccion, equipoSeleccionado])

  // NUEVO: Cargar pedidos aprobados cuando se selecciona tipo "envio"
  useEffect(() => {
    if (tipoInspeccion === 'envio' && equipoSeleccionado) {
      cargarPedidosDisponibles(equipoSeleccionado.tipo_equipo)
    }
  }, [tipoInspeccion, equipoSeleccionado])

  async function getEquipos() {
    const { data } = await supabase
      .from('equipos')
      .select('*')
      .order('numero_identificacion')
    setEquipos(data || [])
  }

  async function getObras() {
    const { data } = await supabase
      .from('obras')
      .select('*')
      .eq('activa', true)
      .order('nombre_obra')
    setObras(data || [])
  }

  async function getChecklistTemplate(tipoEquipo) {
    const { data } = await supabase
      .from('checklist_templates')
      .select('*')
      .eq('tipo_equipo', tipoEquipo)
      .order('orden')
    setChecklistTemplates(data || [])
    const checklistInicial = {}
    data?.forEach(item => {
      checklistInicial[item.id] = null
    })
    setChecklist(checklistInicial)
  }

  async function getInspeccionesEnvio(equipoId) {
    console.log('🔍 Buscando inspecciones de envío para equipo:', equipoId)
    const { data, error } = await supabase
      .from('inspecciones')
      .select('*')
      .eq('equipo_id', equipoId)
      .eq('tipo_inspeccion', 'envio')
      .is('inspeccion_envio_relacionada', null) // Solo envíos que no tengan recepción
      .order('fecha_hora', { ascending: false })
    
    console.log('✅ Inspecciones de envío encontradas:', data)
    console.log('❌ Error:', error)
    setInspeccionesEnvio(data || [])
  }

  // NUEVO: Función para cargar pedidos disponibles
  async function cargarPedidosDisponibles(tipoEquipo) {
    try {
      // Buscar pedidos donde este equipo específico está asignado
      // pero aún no ha sido entregado (estado = asignado)
      const { data, error } = await supabase
        .from('pedidos_equipos_lineas')
        .select(`
          id,
          numero_pedido,
          email_solicitante,
          tipo_equipo_solicitado,
          cantidad_solicitada,
          obras!inner(nombre_obra)
        `)
        .eq('equipo_asignado_id', equipoSeleccionado.id)  // ← Cambio principal: buscar por equipo específico
        .eq('estado_aprobacion', 'aprobado')
        .eq('estado_entrega', 'asignado')  // Solo "asignado" (no entregado aún)
        .order('fecha_recepcion', { ascending: false })

      if (error) {
        console.error('Error cargando pedidos:', error)
        setPedidosDisponibles([])
        return
      }

      console.log('📋 Pedidos para equipo ' + equipoSeleccionado.numero_identificacion + ':', data)
      setPedidosDisponibles(data || [])
    } catch (error) {
      console.error('Error:', error)
      setPedidosDisponibles([])
    }
  }

  function seleccionarEquipo(equipo) {
    setEquipoSeleccionado(equipo)
    getChecklistTemplate(equipo.tipo_equipo)
    setPaso(2)
  }

  function updateChecklist(itemId, valor) {
    setChecklist(prev => ({ ...prev, [itemId]: valor }))
  }

  // Función para calcular el semáforo basado en el checklist
  function calcularSemaforo() {
    const items = Object.entries(checklist).map(([templateId, estado]) => {
      const template = checklistTemplates.find(t => t.id === templateId)
      return {
        estado: estado,
        es_critico: template?.es_critico || false
      }
    })

    // Contar fallas y avisos
    const criticosFalla = items.filter(i => i.es_critico && i.estado === 'fail').length
    const criticosAviso = items.filter(i => i.es_critico && i.estado === 'warning').length
    const noCriticosProblemas = items.filter(i => !i.es_critico && (i.estado === 'fail' || i.estado === 'warning')).length

    // Lógica del semáforo:
    // ROJO: Al menos 1 crítico en falla
    if (criticosFalla > 0) {
      return 'rojo'
    }

    // AMARILLO: Al menos 1 crítico en aviso O 2+ no críticos con problemas
    if (criticosAviso > 0 || noCriticosProblemas >= 2) {
      return 'amarillo'
    }

    // VERDE: Todo OK
    return 'verde'
  }

  async function guardarInspeccion() {
    setLoading(true)
    try {
      // NUEVO: Validaciones para envío a obra
      if (tipoInspeccion === 'envio') {
        if (!motivoEnvio) {
          alert('⚠️ Debe seleccionar el motivo del envío')
          setLoading(false)
          return
        }

        if (motivoEnvio === 'pedido' && !pedidoEquipoLineaId) {
          alert('⚠️ Debe seleccionar el pedido que se está cumpliendo')
          setLoading(false)
          return
        }

        if (motivoEnvio === 'reemplazo' && !observacionesEnvio.trim()) {
          alert('⚠️ Debe especificar qué equipo se está reemplazando')
          setLoading(false)
          return
        }
      }

      // Calcular el semáforo
      const semaforoCalculado = calcularSemaforo()

      // Guardar la inspección con el semáforo calculado
      const { data: inspeccion, error: errorInsp } = await supabase
        .from('inspecciones')
        .insert({
          equipo_id: equipoSeleccionado.id,
          inspector_id: user.id,
          tipo_inspeccion: tipoInspeccion,
          horometro_odometro: horometro,
          ubicacion: ubicacion,
          observaciones_generales: observaciones,
          semaforo: semaforoCalculado,
          estado: 'completa',
          inspeccion_envio_relacionada: tipoInspeccion === 'recepcion' && inspeccionEnvioRelacionada ? inspeccionEnvioRelacionada : null,
          // NUEVO: Campos de motivo de envío
          motivo_envio: tipoInspeccion === 'envio' ? motivoEnvio : null,
          pedido_equipo_linea_id: tipoInspeccion === 'envio' && motivoEnvio === 'pedido' ? pedidoEquipoLineaId : null,
          observaciones_envio: tipoInspeccion === 'envio' && observacionesEnvio ? observacionesEnvio.trim() : null
        })
        .select()
        .single()

      if (errorInsp) throw errorInsp

      // Guardar los items del checklist
      const checklistItems = Object.entries(checklist).map(([templateId, estado]) => {
        const template = checklistTemplates.find(t => t.id === templateId)
        return {
          inspeccion_id: inspeccion.id,
          item_nombre: template.item_nombre,
          categoria: template.categoria,
          estado: estado,
          es_critico: template.es_critico,
          observacion: checklistObservaciones[templateId] || null // NUEVO: Agregar observación
        }
      })

      const { error: errorChecklist } = await supabase
        .from('checklist_items')
        .insert(checklistItems)

      if (errorChecklist) throw errorChecklist

      // Guardar las fotos si existen
      console.log('🔍 Estado de fotos antes de guardar:', fotos)
      console.log('🔍 Número de fotos:', fotos.length)
      
      if (fotos.length > 0) {
        const fotosParaGuardar = fotos.map(foto => ({
          inspeccion_id: inspeccion.id,
          url: foto.url,
          public_id: foto.public_id,
          descripcion: foto.descripcion || null,
          tipo: 'general'
        }))

        console.log('🔍 Fotos para guardar:', fotosParaGuardar)

        const { error: errorFotos } = await supabase
          .from('inspeccion_fotos')
          .insert(fotosParaGuardar)

        if (errorFotos) {
          console.error('❌ Error guardando fotos:', errorFotos)
          throw errorFotos
        } else {
          console.log('✅ Fotos guardadas exitosamente')
        }
      } else {
        console.log('⚠️ No hay fotos para guardar')
      }

      // Actualizar el semáforo del equipo y su ubicación si es envío
      const updateData = { semaforo_actual: semaforoCalculado }
      
      // Si es inspección de envío, actualizar también la ubicación del equipo
      if (tipoInspeccion === 'envio') {
        updateData.ubicacion_actual = ubicacion
        console.log('📍 Actualizando ubicación del equipo a:', ubicacion)
      }
      
      const { error: errorEquipo } = await supabase
        .from('equipos')
        .update(updateData)
        .eq('id', equipoSeleccionado.id)

      if (errorEquipo) throw errorEquipo

      setPaso(3)
    } catch (error) {
      alert('Error: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const equiposFiltrados = equipos.filter(e => 
    e.numero_identificacion.toLowerCase().includes(busqueda.toLowerCase())
  )

  const puedeGuardar = () => {
    if (!tipoInspeccion || !horometro || !ubicacion) return false
    const criticos = checklistTemplates.filter(t => t.es_critico)
    return criticos.every(t => checklist[t.id])
  }

  // Obtener el semáforo calculado en tiempo real
  const semaforoPreview = calcularSemaforo()
  
  const getSemaforoEmoji = (semaforo) => {
    if (semaforo === 'verde') return '🟢'
    if (semaforo === 'amarillo') return '🟡'
    if (semaforo === 'rojo') return '🔴'
    return '⚪'
  }

  const getSemaforoColor = (semaforo) => {
    if (semaforo === 'verde') return '#10b981'
    if (semaforo === 'amarillo') return '#f59e0b'
    if (semaforo === 'rojo') return '#ef4444'
    return '#9ca3af'
  }

  const getSemaforoTexto = (semaforo) => {
    if (semaforo === 'verde') return 'Equipo en buen estado'
    if (semaforo === 'amarillo') return 'Requiere atención'
    if (semaforo === 'rojo') return 'Requiere intervención urgente'
    return 'Sin datos'
  }

  // PASO 1: Seleccionar Equipo
  if (paso === 1) {
    return (
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: 'clamp(0.5rem, 2vw, 2rem)', boxSizing: 'border-box' }}>
        <button onClick={onVolver} style={{ padding: '0.5rem 1rem', background: '#6b7280', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', marginBottom: '1rem' }}>
          ← Volver
        </button>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '1.5rem' }}>Nueva Inspección - Seleccionar Equipo</h1>
        <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', marginBottom: '2rem' }}>
          <input type="text" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar equipo..." style={{ width: '100%', padding: '0.75rem', border: '2px solid #e5e7eb', borderRadius: '8px', fontSize: '1rem' }} />
        </div>
        <div style={{ display: 'grid', gap: '1rem' }}>
          {equiposFiltrados.map(equipo => (
            <div key={equipo.id} onClick={() => seleccionarEquipo(equipo)} style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', cursor: 'pointer', border: '2px solid transparent' }} onMouseEnter={(e) => e.currentTarget.style.borderColor = '#667eea'} onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}>
              <p style={{ fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '0.5rem' }}>{equipo.numero_identificacion}</p>
              <p style={{ color: '#666', fontSize: '0.9rem' }}>{equipo.denominacion}</p>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // PASO 2: Formulario
  if (paso === 2) {
    const categorias = [...new Set(checklistTemplates.map(t => t.categoria))]
    return (
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: 'clamp(0.5rem, 2vw, 2rem)', boxSizing: 'border-box' }}>
        <button onClick={equipoPreseleccionado ? onVolver : () => setPaso(1)} style={{ padding: '0.5rem 1rem', background: '#6b7280', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', marginBottom: '1rem' }}>
          ← {equipoPreseleccionado ? 'Volver' : 'Cambiar Equipo'}
        </button>
        <div style={{ background: '#667eea', color: 'white', padding: '1.5rem', borderRadius: '12px', marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>{equipoSeleccionado.numero_identificacion}</h2>
          <p>{equipoSeleccionado.denominacion}</p>
        </div>

        {/* Preview del semáforo calculado */}
        {Object.values(checklist).some(v => v !== null) && (
          <div style={{
            background: getSemaforoColor(semaforoPreview) + '15',
            border: `2px solid ${getSemaforoColor(semaforoPreview)}`,
            padding: '1rem',
            borderRadius: '12px',
            marginBottom: '2rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem'
          }}>
            <span style={{ fontSize: '2rem' }}>
              {getSemaforoEmoji(semaforoPreview)}
            </span>
            <div>
              <p style={{ fontWeight: '600', fontSize: '1.1rem', marginBottom: '0.25rem', color: getSemaforoColor(semaforoPreview) }}>
                Resultado de la inspección: {semaforoPreview.toUpperCase()}
              </p>
              <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: 0 }}>
                {getSemaforoTexto(semaforoPreview)}
              </p>
            </div>
          </div>
        )}

        <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: '600', marginBottom: '1rem', color: '#1f2937' }}>Datos de la Inspección</h3>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#1f2937' }}>Tipo de Inspección *</label>
            <select value={tipoInspeccion} onChange={(e) => setTipoInspeccion(e.target.value)} style={{ width: '100%', padding: '0.75rem', border: '2px solid #e5e7eb', borderRadius: '8px', fontSize: '1rem' }}>
              <option value="">Seleccionar...</option>
              <option value="periodica">🔍 Inspección Periódica</option>
              <option value="envio">📤 Envío a Obra</option>
              <option value="recepcion">📥 Recepción de Obra</option>
              <option value="taller">🔧 Entrada a Taller</option>
              <option value="almacenamiento">📦 Almacenamiento</option>
            </select>
          </div>

          {/* Selector de inspección de envío relacionada (solo para recepciones) */}
          {tipoInspeccion === 'recepcion' && (
            <div style={{ marginBottom: '1rem', padding: '1rem', background: '#eff6ff', borderRadius: '8px', border: '2px solid #3b82f6' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#1e40af' }}>
                🔗 Inspección de Envío Relacionada {inspeccionesEnvio.length > 0 && '*'}
              </label>
              <p style={{ fontSize: '0.875rem', color: '#3b82f6', marginBottom: '0.5rem' }}>
                Debug: Encontradas {inspeccionesEnvio.length} inspecciones de envío
              </p>
              {inspeccionesEnvio.length > 0 ? (
                <select 
                  value={inspeccionEnvioRelacionada} 
                  onChange={(e) => {
                    console.log('📋 Inspección de envío seleccionada:', e.target.value)
                    setInspeccionEnvioRelacionada(e.target.value)
                  }} 
                  style={{ width: '100%', padding: '0.75rem', border: '2px solid #3b82f6', borderRadius: '8px', fontSize: '1rem' }}
                >
                  <option value="">Seleccionar inspección de envío...</option>
                  {inspeccionesEnvio.map(insp => (
                    <option key={insp.id} value={insp.id}>
                      📤 {new Date(insp.fecha_hora).toLocaleDateString('es-PY')} - {insp.ubicacion} (ID: {insp.id.substring(0, 8)}...)
                    </option>
                  ))}
                </select>
              ) : (
                <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: 0 }}>
                  No hay inspecciones de envío pendientes de recepción para este equipo
                </p>
              )}
            </div>
          )}

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#1f2937' }}>Horómetro/Odómetro *</label>
            <input type="number" value={horometro} onChange={(e) => setHorometro(e.target.value)} style={{ width: '100%', padding: '0.75rem', border: '2px solid #e5e7eb', borderRadius: '8px', fontSize: '1rem' }} placeholder="Ej: 12500" />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#1f2937' }}>Ubicación/Obra *</label>
            <select value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} style={{ width: '100%', padding: '0.75rem', border: '2px solid #e5e7eb', borderRadius: '8px', fontSize: '1rem' }}>
              <option value="">Seleccionar ubicación...</option>
              <option value="Complejo Ypane">Complejo Ypane</option>
              <option value="Taller Central">Taller Central</option>
              {obras.map(obra => (
                <option key={obra.id} value={obra.nombre_obra}>{obra.nombre_obra}</option>
              ))}
            </select>
          </div>

          {/* NUEVO: Motivo de envío (solo para tipo "envio") */}
          {tipoInspeccion === 'envio' && (
            <>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#1f2937' }}>
                  Motivo del Envío <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select 
                  value={motivoEnvio} 
                  onChange={(e) => {
                    setMotivoEnvio(e.target.value)
                    setPedidoEquipoLineaId('')
                    setObservacionesEnvio('')
                  }}
                  style={{ width: '100%', padding: '0.75rem', border: '2px solid #e5e7eb', borderRadius: '8px', fontSize: '1rem' }}
                >
                  <option value="">Seleccionar motivo...</option>
                  <option value="pedido">📋 Cumplir Pedido de Equipo</option>
                  <option value="reemplazo">🔄 Reemplazo de Equipo en Obra</option>
                </select>
              </div>

              {motivoEnvio === 'pedido' && (
                <div style={{ marginBottom: '1rem', padding: '1rem', background: '#eff6ff', borderRadius: '8px', border: '2px solid #3b82f6' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#1e40af' }}>
                    📋 Seleccionar Pedido a Cumplir <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  
                  {pedidosDisponibles.length > 0 ? (
                    <>
                      <select 
                        value={pedidoEquipoLineaId} 
                        onChange={(e) => setPedidoEquipoLineaId(e.target.value)}
                        style={{ width: '100%', padding: '0.75rem', border: '2px solid #3b82f6', borderRadius: '8px', fontSize: '1rem' }}
                      >
                        <option value="">Seleccionar pedido...</option>
                        {pedidosDisponibles.map(pedido => (
                          <option key={pedido.id} value={pedido.id}>
                            Pedido {pedido.numero_pedido} - {pedido.obras.nombre_obra} - {pedido.tipo_equipo_solicitado} (x{pedido.cantidad_solicitada}) - {pedido.email_solicitante}
                          </option>
                        ))}
                      </select>
                      <p style={{ fontSize: '0.875rem', color: '#3b82f6', marginTop: '0.5rem', margin: '0.5rem 0 0 0' }}>
                        ℹ️ Mostrando pedidos aprobados pendientes de entrega
                      </p>
                    </>
                  ) : (
                    <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: 0 }}>
                      No hay pedidos pendientes para este tipo de equipo
                    </p>
                  )}
                </div>
              )}

              {motivoEnvio && (
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#1f2937' }}>
                    {motivoEnvio === 'reemplazo' ? 'Detalles del Reemplazo *' : 'Observaciones del Envío'}
                  </label>
                  <textarea
                    value={observacionesEnvio}
                    onChange={(e) => setObservacionesEnvio(e.target.value)}
                    placeholder={
                      motivoEnvio === 'reemplazo' 
                        ? 'Ej: Reemplaza a VL-CN060 que presenta fallas en el motor'
                        : 'Observaciones adicionales sobre el envío...'
                    }
                    rows="3"
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '2px solid #e5e7eb',
                      borderRadius: '8px',
                      fontSize: '1rem',
                      fontFamily: 'inherit',
                      resize: 'vertical'
                    }}
                  />
                  {motivoEnvio === 'reemplazo' && !observacionesEnvio.trim() && (
                    <p style={{ color: '#ef4444', fontSize: '0.875rem', marginTop: '0.5rem', margin: '0.5rem 0 0 0' }}>
                      ⚠️ Debe especificar qué equipo se está reemplazando y el motivo
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: '600', marginBottom: '1rem' }}>Checklist de Inspección</h3>
          {categorias.map(categoria => {
            const items = checklistTemplates.filter(t => t.categoria === categoria)
            return (
              <div key={categoria} style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#667eea', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '2px solid #e5e7eb' }}>{categoria}</h4>
                {items.map(item => (
                  <div key={item.id} style={{ padding: '1rem', background: '#ffffff', border: '2px solid #e5e7eb', borderRadius: '8px', marginBottom: '0.75rem' }}>
                    <div style={{ marginBottom: '0.75rem' }}>
                      <span style={{ fontWeight: '600', fontSize: '1rem', color: '#1f2937' }}>{item.item_nombre}</span>
                      {item.es_critico && <span style={{ marginLeft: '0.5rem', background: '#fecaca', color: '#991b1b', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '600' }}>CRÍTICO</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <button onClick={() => updateChecklist(item.id, 'ok')} style={{ flex: 1, padding: '0.75rem', background: checklist[item.id] === 'ok' ? '#10b981' : '#e5e7eb', color: checklist[item.id] === 'ok' ? 'white' : '#374151', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem', minHeight: '44px' }}>✓ OK</button>
                      <button onClick={() => updateChecklist(item.id, 'warning')} style={{ flex: 1, padding: '0.75rem', background: checklist[item.id] === 'warning' ? '#f59e0b' : '#e5e7eb', color: checklist[item.id] === 'warning' ? 'white' : '#374151', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem', minHeight: '44px' }}>⚠ Aviso</button>
                      <button onClick={() => updateChecklist(item.id, 'fail')} style={{ flex: 1, padding: '0.75rem', background: checklist[item.id] === 'fail' ? '#ef4444' : '#e5e7eb', color: checklist[item.id] === 'fail' ? 'white' : '#374151', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem', minHeight: '44px' }}>✗ Falla</button>
                    </div>
                    {/* Campo de observación por ítem */}
                    {(checklist[item.id] === 'warning' || checklist[item.id] === 'fail') && (
                      <input
                        type="text"
                        placeholder="Observación (ej: No tiene ancla, falta repuesto, etc.)"
                        value={checklistObservaciones[item.id] || ''}
                        onChange={(e) => setChecklistObservaciones({
                          ...checklistObservaciones,
                          [item.id]: e.target.value
                        })}
                        style={{
                          width: '100%',
                          padding: '0.5rem',
                          border: '2px solid #e5e7eb',
                          borderRadius: '6px',
                          fontSize: '0.875rem',
                          marginTop: '0.5rem'
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
        <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: '600', marginBottom: '1rem' }}>Observaciones</h3>
          <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows="4" style={{ width: '100%', padding: '0.75rem', border: '2px solid #e5e7eb', borderRadius: '8px', fontSize: '1rem', fontFamily: 'inherit' }} placeholder="Detalles adicionales..." />
        </div>

        {/* Sección de fotos */}
        <div style={{ background: 'white', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: '600', marginBottom: '1rem' }}>
            📸 Fotos de la Inspección ({fotos.length})
            <span style={{ fontSize: '0.875rem', fontWeight: 'normal', color: '#6b7280', marginLeft: '0.5rem' }}>(Opcional)</span>
          </h3>
          <SubidaFotos 
            onFotosChange={setFotos}
            fotosExistentes={fotos}
          />
        </div>

        <button 
          onClick={() => {
            console.log('🚀 CLICK EN GUARDAR - Estado actual de fotos:', fotos)
            guardarInspeccion()
          }} 
          disabled={!puedeGuardar() || loading} 
          style={{ width: '100%', padding: '1rem', background: puedeGuardar() && !loading ? '#667eea' : '#9ca3af', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.1rem', fontWeight: '600', cursor: puedeGuardar() && !loading ? 'pointer' : 'not-allowed' }}>
          {loading ? 'Guardando...' : 'Guardar Inspección'}
        </button>
        {!puedeGuardar() && <p style={{ marginTop: '1rem', textAlign: 'center', color: '#ef4444', fontSize: '0.875rem' }}>Complete todos los campos obligatorios y todos los ítems críticos</p>}
      </div>
    )
  }

  // PASO 3: Confirmación
  if (paso === 3) {
    return (
      <div style={{ maxWidth: '600px', margin: '0 auto', padding: 'clamp(0.5rem, 2vw, 2rem)', textAlign: 'center', boxSizing: 'border-box' }}>
        <div style={{ background: 'white', padding: 'clamp(1.5rem, 4vw, 3rem)', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
          <div style={{ width: '80px', height: '80px', background: '#10b981', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 2rem', fontSize: '3rem' }}>✓</div>
          <h2 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '1rem', color: '#1f2937' }}>¡Inspección Guardada!</h2>
          <p style={{ color: '#6b7280', marginBottom: '2rem' }}>La inspección se ha registrado correctamente. El semáforo del equipo se actualizó automáticamente.</p>
          <button onClick={onVolver} style={{ padding: '1rem 2rem', background: '#667eea', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1rem', fontWeight: '600', cursor: 'pointer' }}>Volver al Inicio</button>
        </div>
      </div>
    )
  }
}

export default NuevaInspeccion