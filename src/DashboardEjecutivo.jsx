import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import { toast } from './utils/ui'

function DashboardEjecutivo({ onVolver }) {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalEquipos: 0,
    operativos: 0,
    conRestriccion: 0,
    fueraServicio: 0,
    porObra: [],
    inspeccionesProximas: 0,
    inspeccionesVencidas: 0
  })

  useEffect(() => {
    cargarEstadisticas()
  }, [])

  async function cargarEstadisticas() {
    try {
      setLoading(true)
      
      // Cargar todos los equipos
      const { data: equipos, error: errorEquipos } = await supabase
        .from('equipos')
        .select('*')
        .order('ubicacion_actual')

      if (errorEquipos) throw errorEquipos

      // Cargar todas las inspecciones para calcular próximas/vencidas
      const { data: inspecciones, error: errorInsp } = await supabase
        .from('inspecciones')
        .select('equipo_id, fecha_hora')
        .order('fecha_hora', { ascending: false })

      if (errorInsp) throw errorInsp

      // Calcular estadísticas generales
      const totalEquipos = equipos.length
      const operativos = equipos.filter(e => e.estado_operativo === 'operativo').length
      const conRestriccion = equipos.filter(e => e.estado_operativo === 'con_restriccion').length
      const fueraServicio = equipos.filter(e => e.estado_operativo === 'fuera_servicio').length

      // Calcular por obra
      const obraStats = {}
      equipos.forEach(equipo => {
        const obra = equipo.ubicacion_actual || 'Sin ubicación'
        
        if (!obraStats[obra]) {
          obraStats[obra] = {
            nombre: obra,
            total: 0,
            operativos: 0,
            conRestriccion: 0,
            fueraServicio: 0,
            inspeccionesProximas: 0,
            inspeccionesVencidas: 0
          }
        }
        
        obraStats[obra].total++
        
        if (equipo.estado_operativo === 'operativo') {
          obraStats[obra].operativos++
        } else if (equipo.estado_operativo === 'con_restriccion') {
          obraStats[obra].conRestriccion++
        } else if (equipo.estado_operativo === 'fuera_servicio') {
          obraStats[obra].fueraServicio++
        }
      })

      const porObra = Object.values(obraStats).sort((a, b) => b.total - a.total)

      // Calcular inspecciones próximas y vencidas
      const hoy = new Date()
      const en7dias = new Date()
      en7dias.setDate(en7dias.getDate() + 7)
      
      let inspeccionesProximas = 0
      let inspeccionesVencidas = 0

      // Para cada equipo, buscar su última inspección
      equipos.forEach(equipo => {
        const inspeccionesEquipo = inspecciones.filter(i => i.equipo_id === equipo.id)
        const obra = equipo.ubicacion_actual || 'Sin ubicación'
        
        if (inspeccionesEquipo.length === 0) {
          // No tiene inspecciones = vencida
          inspeccionesVencidas++
          if (obraStats[obra]) {
            obraStats[obra].inspeccionesVencidas++
          }
        } else {
          const ultimaInspeccion = new Date(inspeccionesEquipo[0].fecha_hora)
          const diasDesdeInspeccion = Math.floor((hoy - ultimaInspeccion) / (1000 * 60 * 60 * 24))
          
          // Asumiendo que inspecciones deben hacerse cada 30 días
          const diasParaProxima = 30 - diasDesdeInspeccion
          
          if (diasParaProxima < 0) {
            // Ya pasó la fecha, está vencida
            inspeccionesVencidas++
            if (obraStats[obra]) {
              obraStats[obra].inspeccionesVencidas++
            }
          } else if (diasParaProxima <= 7) {
            // Vence en los próximos 7 días
            inspeccionesProximas++
            if (obraStats[obra]) {
              obraStats[obra].inspeccionesProximas++
            }
          }
        }
      })

      setStats({
        totalEquipos,
        operativos,
        conRestriccion,
        fueraServicio,
        porObra,
        inspeccionesProximas,
        inspeccionesVencidas
      })

    } catch (error) {
      console.error('Error:', error)
      toast('Error al cargar estadísticas: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <p style={{ fontSize: '1.2rem', color: '#6b7280' }}>⏳ Cargando...</p>
      </div>
    )
  }

  const disponibilidad = stats.totalEquipos > 0 
    ? ((stats.operativos / stats.totalEquipos) * 100).toFixed(0)
    : 0

  return (
    <div style={{ maxWidth: '1600px', margin: '0 auto', padding: 'clamp(0.5rem, 1vw, 1rem)' }}>
      
      {/* Header Compacto */}
      <div style={{
        background: 'white',
        padding: '1rem',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        marginBottom: '1rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: 0 }}>
          📊 Estado de Equipos
        </h1>
        <button
          onClick={onVolver}
          style={{
            padding: '0.5rem 1rem',
            background: '#6b7280',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: '600',
            fontSize: '0.875rem'
          }}
        >
          ← Volver
        </button>
      </div>

      {/* KPIs Compactos en 2 filas */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', 
        gap: '0.75rem', 
        marginBottom: '1rem' 
      }}>
        
        {/* Fila 1: Estados */}
        <div style={{
          background: 'white',
          padding: '0.75rem',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '2px solid #10b981',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <div style={{ fontSize: '2rem' }}>✅</div>
          <div>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#10b981' }}>
              {stats.operativos}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Operativos</div>
          </div>
        </div>

        <div style={{
          background: 'white',
          padding: '0.75rem',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '2px solid #f59e0b',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <div style={{ fontSize: '2rem' }}>⚠️</div>
          <div>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#f59e0b' }}>
              {stats.conRestriccion}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Con Restricción</div>
          </div>
        </div>

        <div style={{
          background: 'white',
          padding: '0.75rem',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '2px solid #ef4444',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <div style={{ fontSize: '2rem' }}>❌</div>
          <div>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#ef4444' }}>
              {stats.fueraServicio}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Fuera Servicio</div>
          </div>
        </div>

        {/* Fila 2: Inspecciones */}
        <div style={{
          background: stats.inspeccionesProximas > 0 ? '#fef3c7' : 'white',
          padding: '0.75rem',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: `2px solid ${stats.inspeccionesProximas > 0 ? '#f59e0b' : '#e5e7eb'}`,
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <div style={{ fontSize: '2rem' }}>📅</div>
          <div>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#f59e0b' }}>
              {stats.inspeccionesProximas}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#78350f', fontWeight: '600' }}>
              Próximas 7 días
            </div>
          </div>
        </div>

        <div style={{
          background: stats.inspeccionesVencidas > 0 ? '#fee2e2' : 'white',
          padding: '0.75rem',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: `2px solid ${stats.inspeccionesVencidas > 0 ? '#ef4444' : '#e5e7eb'}`,
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <div style={{ fontSize: '2rem' }}>🔴</div>
          <div>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#ef4444' }}>
              {stats.inspeccionesVencidas}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#991b1b', fontWeight: '600' }}>
              Vencidas
            </div>
          </div>
        </div>

        <div style={{
          background: 'white',
          padding: '0.75rem',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '2px solid #667eea',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <div style={{ fontSize: '2rem' }}>📊</div>
          <div>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#667eea' }}>
              {disponibilidad}%
            </div>
            <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Disponibilidad</div>
          </div>
        </div>
      </div>

      {/* Tabla Compacta por Obra */}
      <div style={{
        background: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        overflow: 'hidden'
      }}>
        <div style={{ padding: '1rem', borderBottom: '2px solid #e5e7eb' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: '600', margin: 0 }}>
            🏗️ Resumen por Obra/Ubicación
          </h2>
        </div>

        {/* Tabla */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead style={{ background: '#f9fafb' }}>
              <tr>
                <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', color: '#374151' }}>
                  Obra
                </th>
                <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: '600', color: '#374151' }}>
                  Total
                </th>
                <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: '600', color: '#10b981' }}>
                  ✅ Oper.
                </th>
                <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: '600', color: '#f59e0b' }}>
                  ⚠️ Rest.
                </th>
                <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: '600', color: '#ef4444' }}>
                  ❌ F.S.
                </th>
                <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: '600', color: '#f59e0b' }}>
                  📅 7d
                </th>
                <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: '600', color: '#ef4444' }}>
                  🔴 Venc.
                </th>
                <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: '600', color: '#667eea' }}>
                  % Disp.
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.porObra.map((obra, index) => {
                const porcentajeOperativo = (obra.operativos / obra.total) * 100
                const colorFila = index % 2 === 0 ? 'white' : '#f9fafb'
                
                return (
                  <tr 
                    key={index}
                    style={{ 
                      background: colorFila,
                      borderBottom: '1px solid #e5e7eb'
                    }}
                  >
                    <td style={{ padding: '0.75rem', fontWeight: '600' }}>
                      {porcentajeOperativo >= 85 ? '🟢' : porcentajeOperativo >= 70 ? '🟡' : '🔴'} {obra.nombre}
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: '600' }}>
                      {obra.total}
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'center', color: '#10b981', fontWeight: '600' }}>
                      {obra.operativos}
                    </td>
                    <td style={{ 
                      padding: '0.75rem', 
                      textAlign: 'center', 
                      color: '#f59e0b', 
                      fontWeight: '600',
                      background: obra.conRestriccion > 0 ? '#fef3c7' : 'transparent'
                    }}>
                      {obra.conRestriccion}
                    </td>
                    <td style={{ 
                      padding: '0.75rem', 
                      textAlign: 'center', 
                      color: '#ef4444', 
                      fontWeight: '600',
                      background: obra.fueraServicio > 0 ? '#fee2e2' : 'transparent'
                    }}>
                      {obra.fueraServicio}
                    </td>
                    <td style={{ 
                      padding: '0.75rem', 
                      textAlign: 'center', 
                      color: '#f59e0b', 
                      fontWeight: '700',
                      background: obra.inspeccionesProximas > 0 ? '#fef3c7' : 'transparent',
                      fontSize: obra.inspeccionesProximas > 0 ? '1rem' : '0.875rem'
                    }}>
                      {obra.inspeccionesProximas}
                    </td>
                    <td style={{ 
                      padding: '0.75rem', 
                      textAlign: 'center', 
                      color: '#ef4444', 
                      fontWeight: '700',
                      background: obra.inspeccionesVencidas > 0 ? '#fee2e2' : 'transparent',
                      fontSize: obra.inspeccionesVencidas > 0 ? '1rem' : '0.875rem'
                    }}>
                      {obra.inspeccionesVencidas}
                    </td>
                    <td style={{ 
                      padding: '0.75rem', 
                      textAlign: 'center', 
                      fontWeight: '600',
                      color: porcentajeOperativo >= 85 ? '#10b981' : porcentajeOperativo >= 70 ? '#f59e0b' : '#ef4444'
                    }}>
                      {porcentajeOperativo.toFixed(0)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Leyenda compacta */}
      <div style={{
        marginTop: '1rem',
        padding: '0.75rem',
        background: '#f9fafb',
        borderRadius: '6px',
        fontSize: '0.75rem',
        color: '#6b7280',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1rem',
        justifyContent: 'center'
      }}>
        <span><strong>Oper.:</strong> Operativos</span>
        <span><strong>Rest.:</strong> Con Restricción</span>
        <span><strong>F.S.:</strong> Fuera de Servicio</span>
        <span><strong>7d:</strong> Inspecciones próximos 7 días</span>
        <span><strong>Venc.:</strong> Inspecciones vencidas</span>
        <span><strong>% Disp.:</strong> % Disponibilidad</span>
      </div>
    </div>
  )
}

export default DashboardEjecutivo