import { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase'
import { toast } from './utils/ui'

// Los completados (Taller Salida) no se cargan al abrir: se buscan en el servidor por equipo u orden.
const ESTADOS_ABIERTOS = ['Taller Espera', 'Taller Entrada']
const MIN_BUSQUEDA_COMPLETADOS = 3
const TOPE_COMPLETADOS = 30
const selectMantenimientos = (equipoObligatorio) => `
  *,
  equipos:equipo_id${equipoObligatorio ? '!inner' : ''} (
    numero_identificacion,
    denominacion
  ),
  inspecciones:inspeccion_id (
    fecha_hora
  )
`

function ListaMantenimientos({ onNuevo, onEditar }) {
  // mantenimientos = solo los abiertos (Taller Espera / Entrada)
  const [mantenimientos, setMantenimientos] = useState([])
  const [completados, setCompletados] = useState([])
  const [totalSalida, setTotalSalida] = useState(0)
  const [buscandoCompletados, setBuscandoCompletados] = useState(false)
  const [hayMasCompletados, setHayMasCompletados] = useState(false)
  const busquedaSeq = useRef(0)
  const [loading, setLoading] = useState(true)
  const [filtroTipo, setFiltroTipo] = useState('Todos')
  const [filtroEstado, setFiltroEstado] = useState('En Taller') // CAMBIADO: por defecto mostrar en taller
  const [filtroPedido, setFiltroPedido] = useState('Todos')
  const [filtroPrioridad, setFiltroPrioridad] = useState('Todos')
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    cargarMantenimientos()
  }, [])

  // Completados: se buscan en el servidor cuando hay al menos 3 caracteres (equipo, orden o aviso)
  useEffect(() => {
    const termino = busqueda.trim().replace(/[%,()\\*]/g, '')
    const seq = ++busquedaSeq.current
    if (termino.length < MIN_BUSQUEDA_COMPLETADOS) {
      setCompletados([])
      setHayMasCompletados(false)
      setBuscandoCompletados(false)
      return
    }
    setBuscandoCompletados(true)
    const t = setTimeout(() => buscarCompletados(termino, seq), 350)
    return () => clearTimeout(t)
  }, [busqueda])

  async function cargarMantenimientos() {
    try {
      setLoading(true)

      const [abiertosRes, salidaRes] = await Promise.all([
        supabase
          .from('mantenimientos')
          .select(selectMantenimientos(false))
          .in('estado', ESTADOS_ABIERTOS)
          .order('created_at', { ascending: false }),
        supabase
          .from('mantenimientos')
          .select('id', { count: 'exact', head: true })
          .eq('estado', 'Taller Salida')
      ])

      if (abiertosRes.error) {
        console.error('Error detallado:', abiertosRes.error)
        throw abiertosRes.error
      }
      if (salidaRes.error) throw salidaRes.error

      setMantenimientos(abiertosRes.data || [])
      setTotalSalida(salidaRes.count || 0)
    } catch (error) {
      console.error('Error completo:', error)
      toast('Error al cargar mantenimientos: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  async function buscarCompletados(termino, seq) {
    try {
      // ¿La búsqueda identifica un solo equipo? Entonces se trae todo su historial, sin tope.
      const { data: eqs, error: errorEq } = await supabase
        .from('equipos')
        .select('id')
        .ilike('numero_identificacion', `%${termino}%`)
        .limit(2)
      if (errorEq) throw errorEq
      const equipoUnico = (eqs || []).length === 1 ? eqs[0].id : null

      let porEquipo = supabase
        .from('mantenimientos')
        .select(selectMantenimientos(true))
        .eq('estado', 'Taller Salida')
        .order('created_at', { ascending: false })
      porEquipo = equipoUnico
        ? porEquipo.eq('equipo_id', equipoUnico)
        : porEquipo.ilike('equipos.numero_identificacion', `%${termino}%`).limit(TOPE_COMPLETADOS + 1)

      const porOrden = supabase
        .from('mantenimientos')
        .select(selectMantenimientos(false))
        .eq('estado', 'Taller Salida')
        .or(`numero_orden.ilike.%${termino}%,numero_aviso.ilike.%${termino}%`)
        .order('created_at', { ascending: false })
        .limit(TOPE_COMPLETADOS + 1)

      const [resEquipo, resOrden] = await Promise.all([porEquipo, porOrden])
      if (resEquipo.error) throw resEquipo.error
      if (resOrden.error) throw resOrden.error
      if (seq !== busquedaSeq.current) return // llegó una búsqueda más nueva

      const porId = new Map()
      for (const m of [...(resEquipo.data || []), ...(resOrden.data || [])]) porId.set(m.id, m)
      const todos = [...porId.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))

      if (equipoUnico) {
        setCompletados(todos)
        setHayMasCompletados(false)
      } else {
        setCompletados(todos.slice(0, TOPE_COMPLETADOS))
        setHayMasCompletados(todos.length > TOPE_COMPLETADOS)
      }
    } catch (error) {
      if (seq !== busquedaSeq.current) return
      console.error('Error buscando completados:', error)
      toast('Error al buscar completados: ' + error.message)
      setCompletados([])
      setHayMasCompletados(false)
    } finally {
      if (seq === busquedaSeq.current) setBuscandoCompletados(false)
    }
  }

  // Filtrar mantenimientos
  const mantenimientosFiltrados = [...mantenimientos, ...completados].filter(mant => {
    const matchTipo = filtroTipo === 'Todos' || mant.tipo_mantenimiento === filtroTipo
    
    // ACTUALIZADO: Agregar lógica para "En Taller"
    let matchEstado
    if (filtroEstado === 'Todos') {
      matchEstado = true
    } else if (filtroEstado === 'En Taller') {
      matchEstado = mant.estado === 'Taller Espera' || mant.estado === 'Taller Entrada'
    } else {
      matchEstado = mant.estado === filtroEstado
    }
    
    const matchPedido = filtroPedido === 'Todos' || 
      (filtroPedido === 'Si' && mant.pedido) ||
      (filtroPedido === 'No' && !mant.pedido)
    const matchPrioridad = filtroPrioridad === 'Todos' || mant.prioridad === filtroPrioridad
    
    const equipo = mant.equipos || {}
    const matchBusqueda = 
      (equipo.numero_identificacion || '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (mant.numero_aviso || '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (mant.numero_orden || '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (mant.descripcion_averia || '').toLowerCase().includes(busqueda.toLowerCase())
    
    return matchTipo && matchEstado && matchPedido && matchPrioridad && matchBusqueda
  })

  const getPrioridadColor = (prioridad) => {
    if (prioridad === '1- Muy Elevado') return { bg: '#fee2e2', text: '#991b1b', emoji: '🔴' }
    if (prioridad === '2- Alto') return { bg: '#fed7aa', text: '#9a3412', emoji: '🟠' }
    if (prioridad === '3- Medio') return { bg: '#fef3c7', text: '#92400e', emoji: '🟡' }
    if (prioridad === '4- Bajo') return { bg: '#d1fae5', text: '#065f46', emoji: '🟢' }
    return { bg: '#f3f4f6', text: '#6b7280', emoji: '⚪' }
  }

  const calcularTiempoParada = (mant) => {
    if (!mant.fecha_inicio_averia) return null
    
    const fechaFin = mant.fecha_liberacion ? new Date(mant.fecha_liberacion) : new Date()
    const fechaInicio = new Date(mant.fecha_inicio_averia)
    const dias = Math.floor((fechaFin - fechaInicio) / (1000 * 60 * 60 * 24))
    
    return dias
  }

  if (loading) {
    return (
      <div style={{ padding: 'clamp(1rem, 2vw, 2rem)', textAlign: 'center' }}>
        <p style={{ fontSize: '1.2rem' }}>Cargando mantenimientos...</p>
      </div>
    )
  }

  // Estadísticas
  const totalEspera = mantenimientos.filter(m => m.estado === 'Taller Espera').length
  const totalEntrada = mantenimientos.filter(m => m.estado === 'Taller Entrada').length
  // totalSalida viene contado del servidor (los completados no se cargan)

  // Listas por columna (se calculan una sola vez por render)
  const listaEspera = mantenimientosFiltrados.filter(m => m.estado === 'Taller Espera')
  const listaEntrada = mantenimientosFiltrados.filter(m => m.estado === 'Taller Entrada')
  const listaSalida = mantenimientosFiltrados.filter(m => m.estado === 'Taller Salida')
  const buscaCompletados = busqueda.trim().length >= MIN_BUSQUEDA_COMPLETADOS
  const columnaSalidaVisible = filtroEstado === 'Todos' || filtroEstado === 'Taller Salida'
  const totalDebidos = mantenimientos.filter(m => m.pedido && m.estado !== 'Taller Salida').length

  return (
    <div>
      {/* Estadísticas */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '1rem',
        marginBottom: '2rem'
      }}>
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '3px solid #f59e0b'
        }}>
          <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem', fontWeight: '600' }}>
            ⏳ En Espera
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#f59e0b' }}>
            {totalEspera}
          </div>
        </div>

        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '3px solid #3b82f6'
        }}>
          <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem', fontWeight: '600' }}>
            🔧 En Reparación
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#3b82f6' }}>
            {totalEntrada}
          </div>
        </div>

        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '3px solid #10b981'
        }}>
          <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem', fontWeight: '600' }}>
            ✅ Completados
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#10b981' }}>
            {totalSalida}
          </div>
        </div>

        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '3px solid #ef4444'
        }}>
          <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem', fontWeight: '600' }}>
            📦 Debidos a Obras
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#ef4444' }}>
            {totalDebidos}
          </div>
        </div>
      </div>

      {/* Filtros y Búsqueda */}
      <div style={{
        background: 'white',
        padding: '1.5rem',
        borderRadius: '12px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        marginBottom: '2rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '600', margin: 0 }}>
            🔍 Filtrar Mantenimientos
          </h2>
          <button
            onClick={onNuevo}
            style={{
              padding: '0.75rem 1.5rem',
              background: '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '1rem'
            }}
          >
            ➕ Nuevo Mantenimiento
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#1f2937' }}>
              Buscar
            </label>
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Equipo, aviso, orden..."
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '0.875rem'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#1f2937' }}>
              Tipo
            </label>
            <select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '0.875rem'
              }}
            >
              <option>Todos</option>
              <option value="Correctivo">Correctivo</option>
              <option value="Preventivo">Preventivo</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#1f2937' }}>
              Estado
            </label>
            <select
              value={filtroEstado}
              onChange={(e) => setFiltroEstado(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '0.875rem'
              }}
            >
              <option>Todos</option>
              <option value="En Taller">🔧 En Taller</option>
              <option value="Taller Espera">⏳ En Espera</option>
              <option value="Taller Entrada">🔧 En Reparación</option>
              <option value="Taller Salida">✅ Completado</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#1f2937' }}>
              Pedido (Para obra)
            </label>
            <select
              value={filtroPedido}
              onChange={(e) => setFiltroPedido(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '0.875rem'
              }}
            >
              <option>Todos</option>
              <option value="Si">Sí (Debidos)</option>
              <option value="No">No (Rutina)</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#1f2937' }}>
              Prioridad
            </label>
            <select
              value={filtroPrioridad}
              onChange={(e) => setFiltroPrioridad(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '0.875rem'
              }}
            >
              <option>Todos</option>
              <option value="1- Muy Elevado">🔴 Muy Elevado</option>
              <option value="2- Alto">🟠 Alto</option>
              <option value="3- Medio">🟡 Medio</option>
              <option value="4- Bajo">🟢 Bajo</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#6b7280' }}>
          Mostrando {mantenimientosFiltrados.length} de {mantenimientos.length + totalSalida} mantenimientos
          {' · '}los completados se muestran solo al buscar por equipo u orden
        </div>
        {!columnaSalidaVisible && listaSalida.length > 0 && (
          <button
            onClick={() => setFiltroEstado('Todos')}
            style={{
              marginTop: '0.75rem',
              padding: '0.5rem 0.9rem',
              background: '#d1fae5',
              color: '#065f46',
              border: '2px solid #10b981',
              borderRadius: '6px',
              fontSize: '0.875rem',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            ✅ {listaSalida.length} completado{listaSalida.length === 1 ? '' : 's'} coincide{listaSalida.length === 1 ? '' : 'n'} con la búsqueda — ver
          </button>
        )}
      </div>

      {/* Vista Kanban - Columnas dinámicas */}
      {(() => {
        const mostrarEspera = filtroEstado === 'Todos' || filtroEstado === 'En Taller' || filtroEstado === 'Taller Espera'
        const mostrarEntrada = filtroEstado === 'Todos' || filtroEstado === 'En Taller' || filtroEstado === 'Taller Entrada'
        const mostrarSalida = filtroEstado === 'Todos' || filtroEstado === 'Taller Salida'
        const numColumnas = [mostrarEspera, mostrarEntrada, mostrarSalida].filter(Boolean).length

        const renderTarjeta = (mant) => {
          const prioridadColor = getPrioridadColor(mant.prioridad)
          const tiempoParada = calcularTiempoParada(mant)
          const equipo = mant.equipos || {}
          const esCompletado = mant.estado === 'Taller Salida'

          return (
            <div
              key={mant.id}
              style={{
                background: esCompletado ? '#f0fdf4' : 'white',
                padding: '1rem',
                borderRadius: '8px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                border: mant.pedido ? '3px solid #ef4444' : esCompletado ? '2px solid #10b981' : '2px solid #e5e7eb',
                cursor: 'pointer',
                transition: 'transform 0.2s, box-shadow 0.2s'
              }}
              onClick={() => onEditar(mant)}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '1.125rem', fontWeight: '700', color: '#1f2937' }}>
                  {equipo.numero_identificacion || 'Sin equipo'}
                </div>
                <div style={{
                  background: prioridadColor.bg,
                  color: prioridadColor.text,
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  fontWeight: '600'
                }}>
                  {prioridadColor.emoji} {mant.prioridad?.split('- ')[1] || mant.prioridad}
                </div>
              </div>

              <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem', display: 'flex', gap: '1rem' }}>
                {mant.numero_aviso && <span><strong>Aviso:</strong> {mant.numero_aviso}</span>}
                {mant.numero_orden && <span><strong>Orden:</strong> {mant.numero_orden}</span>}
              </div>

              <div style={{
                display: 'inline-block',
                background: mant.tipo_mantenimiento === 'Preventivo' ? '#dbeafe' : '#fef3c7',
                color: mant.tipo_mantenimiento === 'Preventivo' ? '#1e40af' : '#92400e',
                padding: '0.25rem 0.5rem',
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontWeight: '600',
                marginBottom: '0.5rem'
              }}>
                {mant.tipo_mantenimiento === 'Preventivo' ? '🔄' : '⚠️'} {mant.tipo_mantenimiento}
              </div>

              {mant.descripcion_averia && (
                <div style={{
                  fontSize: '0.875rem',
                  color: '#374151',
                  marginTop: '0.5rem',
                  lineHeight: '1.4',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden'
                }}>
                  {mant.descripcion_averia}
                </div>
              )}

              {tiempoParada !== null && (
                <div style={{
                  fontSize: '0.75rem',
                  fontWeight: '600',
                  color: esCompletado ? '#065f46' : tiempoParada > 7 ? '#ef4444' : '#6b7280',
                  marginTop: '0.75rem',
                  padding: '0.25rem 0.5rem',
                  background: esCompletado ? '#d1fae5' : tiempoParada > 7 ? '#fee2e2' : '#f3f4f6',
                  borderRadius: '4px',
                  display: 'inline-block'
                }}>
                  {esCompletado ? '✅' : '⏱️'} {tiempoParada} días{esCompletado ? ' total' : ' de parada'}
                </div>
              )}

              {esCompletado && mant.fecha_liberacion && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#065f46', fontWeight: '600' }}>
                  📅 Liberado: {new Date(mant.fecha_liberacion).toLocaleDateString('es-PY')}
                </div>
              )}

              {mant.pedido && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#ef4444', fontWeight: '600' }}>
                  📦 Debido a Obra
                </div>
              )}
            </div>
          )
        }

        return (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${numColumnas}, 1fr)`,
            gap: '1.5rem',
            alignItems: 'start'
          }}>
            {/* Columna: EN ESPERA */}
            {mostrarEspera && (
            <div>
              <div style={{
                background: '#fef3c7',
                padding: '1rem',
                borderRadius: '8px 8px 0 0',
                borderBottom: '3px solid #f59e0b',
                marginBottom: '1rem'
              }}>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700', color: '#92400e', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>⏳ EN ESPERA</span>
                  <span style={{ background: '#f59e0b', color: 'white', padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.875rem' }}>
                    {listaEspera.length}
                  </span>
                </h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {listaEspera.map(renderTarjeta)}
                {listaEspera.length === 0 && (
                  <div style={{ background: '#f9fafb', padding: '2rem', borderRadius: '8px', textAlign: 'center', color: '#9ca3af', fontSize: '0.875rem' }}>
                    No hay mantenimientos en espera
                  </div>
                )}
              </div>
            </div>
            )}

            {/* Columna: EN REPARACIÓN */}
            {mostrarEntrada && (
            <div>
              <div style={{
                background: '#dbeafe',
                padding: '1rem',
                borderRadius: '8px 8px 0 0',
                borderBottom: '3px solid #3b82f6',
                marginBottom: '1rem'
              }}>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700', color: '#1e40af', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>🔧 EN REPARACIÓN</span>
                  <span style={{ background: '#3b82f6', color: 'white', padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.875rem' }}>
                    {listaEntrada.length}
                  </span>
                </h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {listaEntrada.map(renderTarjeta)}
                {listaEntrada.length === 0 && (
                  <div style={{ background: '#f9fafb', padding: '2rem', borderRadius: '8px', textAlign: 'center', color: '#9ca3af', fontSize: '0.875rem' }}>
                    No hay mantenimientos en reparación
                  </div>
                )}
              </div>
            </div>
            )}

            {/* Columna: COMPLETADOS (Taller Salida) */}
            {mostrarSalida && (
            <div>
              <div style={{
                background: '#d1fae5',
                padding: '1rem',
                borderRadius: '8px 8px 0 0',
                borderBottom: '3px solid #10b981',
                marginBottom: '1rem'
              }}>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700', color: '#065f46', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>✅ COMPLETADOS</span>
                  <span style={{ background: '#10b981', color: 'white', padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.875rem' }}>
                    {listaSalida.length}
                  </span>
                </h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {listaSalida.map(renderTarjeta)}
                {hayMasCompletados && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', padding: '0.75rem', borderRadius: '8px', textAlign: 'center', color: '#92400e', fontSize: '0.8rem' }}>
                    Se muestran los {TOPE_COMPLETADOS} más recientes. Completá el código del equipo para ver todo su historial.
                  </div>
                )}
                {listaSalida.length === 0 && (
                  <div style={{ background: '#f9fafb', padding: '2rem', borderRadius: '8px', textAlign: 'center', color: '#9ca3af', fontSize: '0.875rem' }}>
                    {!buscaCompletados
                      ? 'Escribí al menos 3 caracteres del equipo o la orden para buscar completados'
                      : buscandoCompletados
                        ? 'Buscando completados…'
                        : 'No hay completados que coincidan con la búsqueda'}
                  </div>
                )}
              </div>
            </div>
            )}
          </div>
        )
      })()}

      {mantenimientosFiltrados.length === 0 && !buscandoCompletados && (
        <div style={{
          background: 'white',
          padding: '3rem',
          borderRadius: '12px',
          textAlign: 'center',
          color: '#9ca3af'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔍</div>
          <div style={{ fontSize: '1.125rem', fontWeight: '600' }}>No se encontraron mantenimientos</div>
          <div style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
            Intenta ajustar los filtros para ver más resultados
          </div>
        </div>
      )}
    </div>
  )
}

export default ListaMantenimientos