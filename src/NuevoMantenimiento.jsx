import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from './lib/supabase'

function NuevoMantenimiento({ onVolver, mantenimientoEditar = null, usuario }) {
  const [equipos, setEquipos] = useState([])
  const [inspeccionesDisponibles, setInspeccionesDisponibles] = useState([])
  const [guardando, setGuardando] = useState(false)

  // Form state
  const [equipoSeleccionado, setEquipoSeleccionado] = useState('')
  const [inspeccionSeleccionada, setInspeccionSeleccionada] = useState('')
  const [tipoMantenimiento, setTipoMantenimiento] = useState('Correctivo')
  const [numeroAviso, setNumeroAviso] = useState('')
  const [numeroOrden, setNumeroOrden] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [prioridad, setPrioridad] = useState('3- Medio')
  const [fechaInicioAveria, setFechaInicioAveria] = useState('')
  const [fechaIngresoTaller, setFechaIngresoTaller] = useState(new Date().toISOString().split('T')[0])
  const [fechaLiberacion, setFechaLiberacion] = useState('')
  const [pedido, setPedido] = useState(false)
  const [ingresaTallerYpane, setIngresaTallerYpane] = useState(true)
  const [estado, setEstado] = useState('Taller Espera')

  // Buscador de equipo
  const [busquedaEquipo, setBusquedaEquipo] = useState('')
  const [mostrarListaEquipos, setMostrarListaEquipos] = useState(false)
  const buscadorRef = useRef(null)

  useEffect(() => {
    cargarEquipos()

    if (mantenimientoEditar) {
      cargarDatosEdicion()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (equipoSeleccionado) {
      cargarInspeccionesEquipo(equipoSeleccionado)
    } else {
      setInspeccionesDisponibles([])
      setInspeccionSeleccionada('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipoSeleccionado])

  // Mantener el input del buscador alineado con el equipo seleccionado (especialmente en edición)
  // Mostrar solo la descripción (denominación) cuando exista.
  useEffect(() => {
    if (!equipos.length || !equipoSeleccionado) return
    const eq = equipos.find(e => e.id === equipoSeleccionado)
    if (!eq) return
    setBusquedaEquipo(eq.denominacion || eq.numero_identificacion)
  }, [equipos, equipoSeleccionado])

  async function cargarEquipos() {
    try {
      const { data, error } = await supabase
        .from('equipos')
        .select('id, numero_identificacion, denominacion')
        .order('numero_identificacion')

      if (error) throw error
      setEquipos(data || [])
    } catch (error) {
      console.error('Error:', error)
      alert('Error al cargar equipos')
    }
  }

  async function cargarInspeccionesEquipo(equipoId) {
    try {
      const { data, error } = await supabase
        .from('inspecciones')
        .select('id, fecha_hora, tipo_inspeccion')
        .eq('equipo_id', equipoId)
        .eq('tipo_inspeccion', 'Entrada a Taller')
        .order('fecha_hora', { ascending: false })

      if (error) throw error
      setInspeccionesDisponibles(data || [])

      if (data && data.length === 1) {
        setInspeccionSeleccionada(data[0].id)
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Error al cargar inspecciones')
    }
  }

  async function cargarDatosEdicion() {
    setEquipoSeleccionado(mantenimientoEditar.equipo_id)
    setInspeccionSeleccionada(mantenimientoEditar.inspeccion_id)
    setTipoMantenimiento(mantenimientoEditar.tipo_mantenimiento)
    setNumeroAviso(mantenimientoEditar.numero_aviso || '')
    setNumeroOrden(mantenimientoEditar.numero_orden || '')
    setDescripcion(mantenimientoEditar.descripcion_averia)
    setPrioridad(mantenimientoEditar.prioridad)
    setFechaInicioAveria(mantenimientoEditar.fecha_inicio_averia || '')
    setFechaIngresoTaller(mantenimientoEditar.fecha_ingreso_taller)
    setFechaLiberacion(mantenimientoEditar.fecha_liberacion || '')
    setPedido(mantenimientoEditar.pedido)
    setIngresaTallerYpane(mantenimientoEditar.ingresa_taller_ypane)
    setEstado(mantenimientoEditar.estado)
  }

  async function enviarEmailPowerAutomate(datosMantenimiento) {
    try {
      // Definir VITE_POWER_AUTOMATE_URL en tu .env (Vite requiere prefijo VITE_)
      const POWER_AUTOMATE_URL =
        (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_POWER_AUTOMATE_URL) ||
        'TU_URL_DE_POWER_AUTOMATE_AQUI'

      // Si no está configurado, no intentamos enviar
      if (!POWER_AUTOMATE_URL || POWER_AUTOMATE_URL === 'TU_URL_DE_POWER_AUTOMATE_AQUI') {
        console.warn('⚠️ POWER_AUTOMATE_URL no configurada. No se envía email.')
        return false
      }

      // Asegurar strings (evitar null/undefined)
      const payload = {
        tipo: datosMantenimiento.tipo_mantenimiento || '',
        numero_aviso_orden:
          datosMantenimiento.tipo_mantenimiento === 'Correctivo'
            ? (datosMantenimiento.numero_aviso || '')
            : (datosMantenimiento.numero_orden || ''),
        equipo: datosMantenimiento.equipo_codigo || '',
        descripcion: datosMantenimiento.descripcion_averia || '',
        prioridad: datosMantenimiento.prioridad || ''
      }

      const response = await fetch(POWER_AUTOMATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!response.ok) throw new Error('Error al enviar email')
      return true
    } catch (error) {
      console.error('Error enviando email:', error)
      return false
    }
  }

  const equiposFiltrados = useMemo(() => {
    const q = busquedaEquipo.trim().toLowerCase()
    if (!q) return equipos
    return equipos.filter(e => {
      const ni = (e.numero_identificacion || '').toLowerCase()
      const den = (e.denominacion || '').toLowerCase()
      return ni.includes(q) || den.includes(q)
    })
  }, [equipos, busquedaEquipo])

  // Al seleccionar, mostrar SOLO la descripción (denominación) para evitar duplicaciones.
  function seleccionarEquipo(equipo) {
    setEquipoSeleccionado(equipo.id)
    setBusquedaEquipo(equipo.denominacion || equipo.numero_identificacion)
    setMostrarListaEquipos(false)
  }

  function limpiarEquipoSiCorresponde() {
    if (!mantenimientoEditar) {
      setEquipoSeleccionado('')
      setInspeccionSeleccionada('')
      setInspeccionesDisponibles([])
    }
  }

  async function guardar() {
    try {
      if (!equipoSeleccionado) {
        alert('⚠️ Debes seleccionar un equipo')
        return
      }

      // Inspección opcional

      if (tipoMantenimiento === 'Correctivo' && !numeroAviso.trim()) {
        alert('⚠️ Debes ingresar el número de Aviso para mantenimiento correctivo')
        return
      }

      if (tipoMantenimiento === 'Preventivo' && !numeroOrden.trim()) {
        alert('⚠️ Debes ingresar el número de Orden para mantenimiento preventivo')
        return
      }

      if (!descripcion.trim()) {
        alert('⚠️ Debes ingresar una descripción de la avería')
        return
      }

      setGuardando(true)

      const equipoData = equipos.find(e => e.id === equipoSeleccionado)

      const datosMantenimiento = {
        inspeccion_id: inspeccionSeleccionada || null,
        equipo_id: equipoSeleccionado,
        tipo_mantenimiento: tipoMantenimiento,
        numero_aviso: tipoMantenimiento === 'Correctivo' ? numeroAviso.trim() : null,
        numero_orden: numeroOrden.trim() || null,
        descripcion_averia: descripcion.trim(),
        prioridad,
        fecha_inicio_averia: fechaInicioAveria || null,
        fecha_ingreso_taller: fechaIngresoTaller,
        fecha_liberacion: fechaLiberacion || null,
        pedido,
        ingresa_taller_ypane: ingresaTallerYpane,
        estado
      }

      let resultado

      if (mantenimientoEditar) {
        const { error } = await supabase
          .from('mantenimientos')
          .update(datosMantenimiento)
          .eq('id', mantenimientoEditar.id)

        if (error) throw error
        alert('✅ Mantenimiento actualizado exitosamente')
      } else {
        const { data, error } = await supabase
          .from('mantenimientos')
          .insert([datosMantenimiento])
          .select()
          .single()

        if (error) throw error
        resultado = data

        // Enviar email solo si es nuevo Y va a taller Ypané
        if (ingresaTallerYpane) {
          const emailEnviado = await enviarEmailPowerAutomate({
            tipo_mantenimiento: tipoMantenimiento,
            numero_aviso: numeroAviso.trim() || null,
            numero_orden: numeroOrden.trim() || null,
            equipo_codigo: equipoData?.numero_identificacion,
            descripcion_averia: descripcion.trim(),
            prioridad
          })

          if (emailEnviado) {
            await supabase
              .from('mantenimientos')
              .update({
                email_enviado: true,
                fecha_email_enviado: new Date().toISOString()
              })
              .eq('id', resultado.id)
          }
        }

        alert(`✅ Mantenimiento creado exitosamente!\n${ingresaTallerYpane ? '📧 Email enviado al taller' : ''}`)
      }

      onVolver()
    } catch (error) {
      console.error('Error:', error)
      alert('❌ Error al guardar: ' + error.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: 'clamp(1rem, 2vw, 2rem)' }}>
      {/* Header */}
      <div
        style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          marginBottom: '2rem'
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem'
          }}
        >
          <h1 style={{ fontSize: '1.8rem', fontWeight: 'bold', margin: 0 }}>
            🔧 {mantenimientoEditar ? 'Editar' : 'Nuevo'} Mantenimiento
          </h1>
          <button
            onClick={onVolver}
            style={{
              padding: '0.75rem 1.5rem',
              background: '#6b7280',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600'
            }}
          >
            ← Volver
          </button>
        </div>
      </div>

      {/* Formulario */}
      <div
        style={{
          background: 'white',
          padding: '2rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}
      >
        {/* Selección de Equipo e Inspección */}
        <div
          style={{
            marginBottom: '2rem',
            padding: '1.5rem',
            background: '#f9fafb',
            borderRadius: '8px',
            border: '2px solid #667eea'
          }}
        >
          <h2 style={{ fontSize: '1.2rem', fontWeight: '600', marginBottom: '1rem', color: '#667eea' }}>
            📋 Equipo e Inspección
          </h2>

          <div style={{ display: 'grid', gap: '1rem' }}>
            {/* Equipo (buscable) */}
            <div ref={buscadorRef} style={{ position: 'relative' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>Equipo *</label>

              <input
                type="text"
                value={busquedaEquipo}
                onChange={e => {
                  setBusquedaEquipo(e.target.value)
                  setMostrarListaEquipos(true)
                  limpiarEquipoSiCorresponde()
                }}
                onFocus={() => setMostrarListaEquipos(true)}
                disabled={mantenimientoEditar}
                placeholder="Escribí para buscar. Ej: VL-CN004"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '2px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '1rem'
                }}
              />

              {mostrarListaEquipos && !mantenimientoEditar && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    right: 0,
                    background: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
                    maxHeight: '260px',
                    overflowY: 'auto',
                    zIndex: 50
                  }}
                >
                  {equiposFiltrados.length === 0 ? (
                    <div style={{ padding: '0.75rem', color: '#6b7280' }}>
                      No se encontraron equipos con “{busquedaEquipo}”.
                    </div>
                  ) : (
                    equiposFiltrados.slice(0, 80).map(eq => (
                      <button
                        key={eq.id}
                        type="button"
                        onClick={() => seleccionarEquipo(eq)}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '0.75rem',
                          border: 'none',
                          background: 'transparent',
                          cursor: 'pointer'
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>{eq.numero_identificacion}</div>
                        <div style={{ color: '#6b7280', fontSize: '0.9rem' }}>{eq.denominacion || ''}</div>
                      </button>
                    ))
                  )}
                </div>
              )}

              {/* Click fuera para cerrar dropdown */}
              {mostrarListaEquipos && !mantenimientoEditar && (
                <div
                  onClick={() => setMostrarListaEquipos(false)}
                  style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 40
                  }}
                />
              )}
            </div>

            {equipoSeleccionado && (
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                  Inspección de Entrada a Taller (Opcional)
                </label>
                <select
                  value={inspeccionSeleccionada}
                  onChange={e => setInspeccionSeleccionada(e.target.value)}
                  disabled={mantenimientoEditar}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '2px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '1rem'
                  }}
                >
                  <option value="">Sin inspección (embarcaciones, equipos externos, etc.)</option>
                  {inspeccionesDisponibles.map(insp => (
                    <option key={insp.id} value={insp.id}>
                      {new Date(insp.fecha_hora).toLocaleString('es-PY')}
                    </option>
                  ))}
                </select>

                {inspeccionesDisponibles.length === 0 && (
                  <p style={{ color: '#6b7280', fontSize: '0.875rem', marginTop: '0.5rem' }}>
                    ℹ️ Este equipo no tiene inspecciones de Entrada a Taller (puedes continuar sin inspección)
                  </p>
                )}

                {!inspeccionSeleccionada && (
                  <p style={{ color: '#f59e0b', fontSize: '0.875rem', marginTop: '0.5rem', fontWeight: '600' }}>
                    ⚠️ Mantenimiento sin inspección previa
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Tipo de Mantenimiento */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>Tipo de Mantenimiento *</label>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              type="button"
              onClick={() => setTipoMantenimiento('Correctivo')}
              style={{
                flex: 1,
                padding: '1rem',
                background: tipoMantenimiento === 'Correctivo' ? '#ef4444' : '#fee2e2',
                color: tipoMantenimiento === 'Correctivo' ? 'white' : '#991b1b',
                border: tipoMantenimiento === 'Correctivo' ? '3px solid #991b1b' : 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '1rem'
              }}
            >
              🔴 Correctivo
            </button>
            <button
              type="button"
              onClick={() => setTipoMantenimiento('Preventivo')}
              style={{
                flex: 1,
                padding: '1rem',
                background: tipoMantenimiento === 'Preventivo' ? '#10b981' : '#d1fae5',
                color: tipoMantenimiento === 'Preventivo' ? 'white' : '#065f46',
                border: tipoMantenimiento === 'Preventivo' ? '3px solid #065f46' : 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '1rem'
              }}
            >
              🟢 Preventivo
            </button>
          </div>
        </div>

        {/* Números SAP */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem'
          }}
        >
          {tipoMantenimiento === 'Correctivo' && (
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                Número de Aviso (SAP) *
              </label>
              <input
                type="text"
                value={numeroAviso}
                onChange={e => setNumeroAviso(e.target.value)}
                placeholder="Ej: 4000909"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '2px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '1rem'
                }}
              />
            </div>
          )}

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
              Número de Orden (SAP) {tipoMantenimiento === 'Preventivo' && '*'}
            </label>
            <input
              type="text"
              value={numeroOrden}
              onChange={e => setNumeroOrden(e.target.value)}
              placeholder={tipoMantenimiento === 'Correctivo' ? 'Se agrega después' : 'Ej: 5000123'}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '1rem'
              }}
            />
            {tipoMantenimiento === 'Correctivo' && (
              <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
                ℹ️ Se completará cuando el taller genere la orden
              </p>
            )}
          </div>
        </div>

        {/* Descripción */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
            Descripción de la Avería *
          </label>
          <textarea
            value={descripcion}
            onChange={e => setDescripcion(e.target.value)}
            placeholder="Describe el problema o el trabajo a realizar..."
            rows="3"
            style={{
              width: '100%',
              padding: '0.75rem',
              border: '2px solid #e5e7eb',
              borderRadius: '6px',
              fontSize: '1rem',
              fontFamily: 'inherit',
              resize: 'vertical'
            }}
          />
        </div>

        {/* Prioridad */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>Prioridad *</label>
          <select
            value={prioridad}
            onChange={e => setPrioridad(e.target.value)}
            style={{
              width: '100%',
              padding: '0.75rem',
              border: '2px solid #e5e7eb',
              borderRadius: '6px',
              fontSize: '1rem'
            }}
          >
            <option value="1- Muy Elevado">🔴 1- Muy Elevado</option>
            <option value="2- Alto">🟠 2- Alto</option>
            <option value="3- Medio">🟡 3- Medio</option>
            <option value="4- Bajo">🟢 4- Bajo</option>
          </select>
        </div>

        {/* Fechas */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem'
          }}
        >
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>Fecha Inicio Avería</label>
            <input
              type="date"
              value={fechaInicioAveria}
              onChange={e => setFechaInicioAveria(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '1rem'
              }}
            />
            <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
              ℹ️ Cuando el operador notó el problema
            </p>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
              Fecha Ingreso al Taller *
            </label>
            <input
              type="date"
              value={fechaIngresoTaller}
              onChange={e => setFechaIngresoTaller(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '1rem'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>Fecha de Liberación</label>
            <input
              type="date"
              value={fechaLiberacion}
              onChange={e => setFechaLiberacion(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '1rem'
              }}
            />
            <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
              ℹ️ Se completa cuando sale del taller
            </p>
          </div>
        </div>

        {/* Estado */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>Estado *</label>
          <select
            value={estado}
            onChange={e => setEstado(e.target.value)}
            style={{
              width: '100%',
              padding: '0.75rem',
              border: '2px solid #e5e7eb',
              borderRadius: '6px',
              fontSize: '1rem'
            }}
          >
            <option value="Taller Espera">⏳ Taller Espera</option>
            <option value="Taller Entrada">🔧 Taller Entrada</option>
            <option value="Taller Salida">✅ Taller Salida</option>
          </select>
        </div>

        {/* Flags */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '1rem',
            marginBottom: '2rem'
          }}
        >
          <div
            style={{
              padding: '1rem',
              background: pedido ? '#fef3c7' : '#f3f4f6',
              borderRadius: '8px',
              border: pedido ? '2px solid #f59e0b' : '2px solid #e5e7eb'
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={pedido}
                onChange={e => setPedido(e.target.checked)}
                style={{ width: '20px', height: '20px', cursor: 'pointer' }}
              />
              <div>
                <div style={{ fontWeight: '600', fontSize: '1rem' }}>📦 ¿Es para una obra?</div>
                <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.25rem' }}>
                  Marcar si el equipo está siendo esperado
                </div>
              </div>
            </label>
          </div>

          <div
            style={{
              padding: '1rem',
              background: ingresaTallerYpane ? '#d1fae5' : '#f3f4f6',
              borderRadius: '8px',
              border: ingresaTallerYpane ? '2px solid #10b981' : '2px solid #e5e7eb'
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={ingresaTallerYpane}
                onChange={e => setIngresaTallerYpane(e.target.checked)}
                style={{ width: '20px', height: '20px', cursor: 'pointer' }}
              />
              <div>
                <div style={{ fontWeight: '600', fontSize: '1rem' }}>🏭 ¿Ingresa a Taller Ypané?</div>
                <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.25rem' }}>
                  {ingresaTallerYpane ? '✅ Se enviará email al taller' : '⚠️ Taller externo (sin email)'}
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Botones */}
        <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
          <button
            onClick={guardar}
            disabled={guardando}
            style={{
              flex: 1,
              padding: '1rem',
              background: guardando ? '#9ca3af' : '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: guardando ? 'not-allowed' : 'pointer',
              fontWeight: '600',
              fontSize: '1.1rem'
            }}
          >
            {guardando ? '⏳ Guardando...' : '💾 Guardar Mantenimiento'}
          </button>

          <button
            onClick={onVolver}
            disabled={guardando}
            style={{
              flex: 1,
              padding: '1rem',
              background: '#6b7280',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: guardando ? 'not-allowed' : 'pointer',
              fontWeight: '600',
              fontSize: '1.1rem'
            }}
          >
            ❌ Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

export default NuevoMantenimiento


