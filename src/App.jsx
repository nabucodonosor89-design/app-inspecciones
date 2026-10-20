import { supabase } from './lib/supabase'
import { useEffect, useState } from 'react'
import Login from './Login.jsx'
import EquiposList from './EquiposList.jsx'
import NuevaInspeccion from './NuevaInspeccion.jsx'
import HistorialInspeccionesCompleto from './HistorialInspeccionesCompleto.jsx'
import DetalleInspeccion from './DetalleInspeccion.jsx'
import ModuloEquipos from './ModuloEquipos.jsx'
import ModuloPedidosEquipos from './ModuloPedidosEquipos.jsx'
import DashboardEjecutivo from './DashboardEjecutivo.jsx'
import ListaPedidosCompra from './ListaPedidosCompra.jsx'
import NuevoPedidoCompra from './NuevoPedidoCompra.jsx'
import NuevoMantenimiento from './NuevoMantenimiento.jsx'
import ListaMantenimientos from './ListaMantenimientos.jsx'
import DashboardMantenimientos from './DashboardMantenimientos.jsx'
import ModuloOperadores from './ModuloOperadores.jsx'
import DashboardFlota from './DashboardFlota.jsx'
import CajaChica from './CajaChica.jsx'
import AnalistaCorrectivo from './AnalistaCorrectivo.jsx'
import AsistenteTecnico from './AsistenteTecnico.jsx'
import ModuloLogistica from './ModuloLogistica.jsx'
import HistorialEquipo from './HistorialEquipo.jsx'
import ModuloCorrectivos from './ModuloCorrectivos.jsx'
import ModuloRepuestos from './ModuloRepuestos.jsx'
import BandejaPreventivos from './BandejaPreventivos.jsx'
import DesdeUltimoService from './DesdeUltimoService.jsx'
import ModuloUsoEquipos from './ModuloUsoEquipos.jsx'
import { PERFIL_COLUMNAS } from './lib/perfil.js'
import Planificador from './planificador/Planificador.jsx'
import MiListaSemana from './planificador/MiListaSemana.jsx'

// Tarjetas ocultas del menú (Analista Correctivo, Caja Chica, Pedidos de Compra, Dashboard Ejecutivo, Panel de Flota,
// Asistente Técnico). No se borró código, rutas ni datos. Poner en true para volver a mostrarlas.
const MODULOS_OCULTOS_VISIBLES = false

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  // Planificador de inspecciones: true si el usuario está asignado a una zona con vigencia esta semana
  const [tieneListaInsp, setTieneListaInsp] = useState(false)
  const [modulo, setModulo] = useState('menu') // 'planificador', 'mi-lista', 'menu', 'inspecciones', 'equipos', 'operadores', 'pedidos-equipos', 'pedidos-compra', 'mantenimientos', 'dashboard-ejecutivo', 'caja-chica', 'asistente-tecnico', 'logistica', 'historial', 'correctivos', 'completar-ordenes', 'desde-service', 'uso-equipos', 'repuestos'

  // Estados para Inspecciones
  const [vistaInspecciones, setVistaInspecciones] = useState('equipos') // 'equipos', 'nueva', 'historial', 'detalle'
  const [equipoSeleccionado, setEquipoSeleccionado] = useState(null)
  const [inspeccionSeleccionada, setInspeccionSeleccionada] = useState(null)
  
  // Estados para Pedidos de Compra
  const [vistaPedidosCompra, setVistaPedidosCompra] = useState('lista') // 'lista', 'nuevo'
  
  // Estados para Mantenimientos
  const [vistaMantenimientos, setVistaMantenimientos] = useState('lista') // 'lista', 'nuevo', 'editar', 'dashboard'
  const [mantenimientoEditar, setMantenimientoEditar] = useState(null)

  // Estados para Analista Correctivo
  const [vistaCorrectivo, setVistaCorrectivo] = useState('lista') // 'lista', 'editar'
  const [correctivoEditar, setCorrectivoEditar] = useState(null)

  useEffect(() => {
    checkUser()
  }, [])

  // ¿Ve "Mi lista de la semana"? (insp_mi_zona filtra por el usuario logueado)
  useEffect(() => {
    if (!user) return
    let vivo = true
    supabase.rpc('insp_mi_zona').then(({ data, error }) => {
      if (vivo) setTieneListaInsp(!error && (data || []).length > 0)
    })
    return () => { vivo = false }
  }, [user])

  // Correctivos solo con permiso ve_correctivos: si se llega sin él, volver al menú
  useEffect(() => {
    if (modulo === 'planificador' && user && user.rol !== 'admin') setModulo('menu')
    if (modulo === 'correctivos' && user && user.ve_correctivos !== true) setModulo('menu')
    if (modulo === 'repuestos' && user && user.ve_repuestos !== true) setModulo('menu')
    if ((modulo === 'completar-ordenes' || modulo === 'desde-service') && user && user.ve_completar_ordenes !== true) setModulo('menu')
    if (modulo === 'uso-equipos' && user && !['gestion', 'gerencia'].includes(user.uso_equipos_acceso)) setModulo('menu')
  }, [modulo, user])

  async function checkUser() {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      const { data: userData } = await supabase
        .from('usuarios')
        .select(PERFIL_COLUMNAS)
        .eq('email', session.user.email)
        .single()
      
      setUser(userData)
    }
    setLoading(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    setUser(null)
    setModulo('menu')
  }

  function volverAlMenu() {
    setModulo('menu')
    setVistaInspecciones('equipos')
    setVistaPedidosCompra('lista')
    setVistaMantenimientos('lista')
    setEquipoSeleccionado(null)
    setMantenimientoEditar(null)
    setInspeccionSeleccionada(null)
    setVistaCorrectivo('lista')
    setCorrectivoEditar(null)
  }

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <div style={{
          background: 'white',
          padding: '3rem',
          borderRadius: '16px',
          boxShadow: '0 8px 16px rgba(0,0,0,0.2)'
        }}>
          <p style={{ fontSize: '1.5rem', margin: 0 }}>⏳ Cargando...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Login onLogin={setUser} />
  }

  // Rol compras: solo tiene acceso al Historial de equipos, entra directo sin menú
  if (user.rol === 'compras') {
    return <HistorialEquipo onSalir={handleLogout} usuario={user} />
  }

  // ============================================
  // MENÚ PRINCIPAL
  // ============================================
  if (modulo === 'menu') {
    return (
      <div style={{ 
        minHeight: '100vh', 
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: 'clamp(1rem, 2vw, 2rem)'
      }}>
        {/* Header */}
        <div style={{
          background: 'white',
          padding: '2rem',
          borderRadius: '16px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          marginBottom: '2rem',
          textAlign: 'center'
        }}>
          <h1 style={{ 
            fontSize: 'clamp(1.8rem, 4vw, 3rem)', 
            fontWeight: 'bold', 
            marginBottom: '0.5rem',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>
            🏗️ Sistema de Gestión TyE
          </h1>
          <p style={{ color: '#6b7280', fontSize: 'clamp(0.9rem, 2vw, 1.1rem)' }}>
            Bienvenido, <strong>{user.nombre_completo}</strong>
          </p>
          <button
            onClick={handleLogout}
            style={{
              marginTop: '1rem',
              padding: '0.75rem 1.5rem',
              background: '#ef4444',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600'
            }}
          >
            🚪 Cerrar Sesión
          </button>
        </div>

        {/* Cards de Módulos */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1.5rem',
          maxWidth: '1400px',
          margin: '0 auto'
        }}>
          {/* Card Inspecciones */}
          <div
            onClick={() => setModulo('inspecciones')}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '16px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              border: '3px solid transparent'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-8px)'
              e.currentTarget.style.boxShadow = '0 12px 24px rgba(102, 126, 234, 0.3)'
              e.currentTarget.style.borderColor = '#667eea'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'
              e.currentTarget.style.borderColor = 'transparent'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem', textAlign: 'center' }}>
              🚜
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem', textAlign: 'center', color: '#667eea' }}>
              Inspecciones
            </h2>
            <p style={{ color: '#6b7280', textAlign: 'center', fontSize: '0.95rem' }}>
              Gestión de inspecciones de equipos
            </p>
          </div>

          {/* Card Mi lista de la semana — inspectores asignados a una zona esta semana (ver supabase/planificador_inspecciones.sql) */}
          {tieneListaInsp && (
          <div
            onClick={() => setModulo('mi-lista')}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '16px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              border: '3px solid transparent'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-8px)'
              e.currentTarget.style.boxShadow = '0 12px 24px rgba(0,0,0,0.15)'
              e.currentTarget.style.borderColor = '#15803d'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'
              e.currentTarget.style.borderColor = 'transparent'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem', textAlign: 'center' }}>
              📋
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem', textAlign: 'center', color: '#15803d' }}>
              Mi lista de la semana
            </h2>
            <p style={{ color: '#6b7280', textAlign: 'center', fontSize: '0.95rem' }}>
              Equipos a inspeccionar esta semana
            </p>
          </div>
          )}

          {/* Card Planificador — solo admin (ver supabase/planificador_inspecciones.sql) */}
          {user.rol === 'admin' && (
          <div
            onClick={() => setModulo('planificador')}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '16px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              border: '3px solid transparent'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-8px)'
              e.currentTarget.style.boxShadow = '0 12px 24px rgba(0,0,0,0.15)'
              e.currentTarget.style.borderColor = '#1d4ed8'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'
              e.currentTarget.style.borderColor = 'transparent'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem', textAlign: 'center' }}>
              🗓️
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem', textAlign: 'center', color: '#1d4ed8' }}>
              Planificador
            </h2>
            <p style={{ color: '#6b7280', textAlign: 'center', fontSize: '0.95rem' }}>
              Inspecciones vencidas, listas por zona y zonas
            </p>
          </div>
          )}

          {/* Card Pedidos de Compra — oculta (oct-2026) */}
          {MODULOS_OCULTOS_VISIBLES && (
          <div
            onClick={() => setModulo('pedidos-compra')}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '16px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              border: '3px solid transparent'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-8px)'
              e.currentTarget.style.boxShadow = '0 12px 24px rgba(245, 158, 11, 0.3)'
              e.currentTarget.style.borderColor = '#f59e0b'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'
              e.currentTarget.style.borderColor = 'transparent'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem', textAlign: 'center' }}>
              🛒
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem', textAlign: 'center', color: '#f59e0b' }}>
              Pedidos de Compra
            </h2>
            <p style={{ color: '#6b7280', textAlign: 'center', fontSize: '0.95rem' }}>
              Solicitudes de materiales y servicios
            </p>
          </div>
          )}

          {/* Card Mantenimientos */}
          <div
            onClick={() => setModulo('mantenimientos')}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '16px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              border: '3px solid transparent'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-8px)'
              e.currentTarget.style.boxShadow = '0 12px 24px rgba(239, 68, 68, 0.3)'
              e.currentTarget.style.borderColor = '#ef4444'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'
              e.currentTarget.style.borderColor = 'transparent'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem', textAlign: 'center' }}>
              🔧
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem', textAlign: 'center', color: '#ef4444' }}>
              Mantenimientos
            </h2>
            <p style={{ color: '#6b7280', textAlign: 'center', fontSize: '0.95rem' }}>
              Avisos y órdenes de mantenimiento
            </p>
          </div>

          {/* Card Dashboard Ejecutivo — oculta (oct-2026) */}
          {MODULOS_OCULTOS_VISIBLES && (
          <div
            onClick={() => setModulo('dashboard-ejecutivo')}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '16px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              border: '3px solid transparent'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-8px)'
              e.currentTarget.style.boxShadow = '0 12px 24px rgba(139, 92, 246, 0.3)'
              e.currentTarget.style.borderColor = '#8b5cf6'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'
              e.currentTarget.style.borderColor = 'transparent'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem', textAlign: 'center' }}>
              📊
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem', textAlign: 'center', color: '#8b5cf6' }}>
              Dashboard Ejecutivo
            </h2>
            <p style={{ color: '#6b7280', textAlign: 'center', fontSize: '0.95rem' }}>
              Vista general y estadísticas
            </p>
          </div>
          )}

          {/* Card Pedidos de Equipos */}
          <div
            onClick={() => setModulo('pedidos-equipos')}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '16px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              border: '3px solid transparent'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-8px)'
              e.currentTarget.style.boxShadow = '0 12px 24px rgba(16, 185, 129, 0.3)'
              e.currentTarget.style.borderColor = '#10b981'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'
              e.currentTarget.style.borderColor = 'transparent'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem', textAlign: 'center' }}>
              📦
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem', textAlign: 'center', color: '#10b981' }}>
              Pedidos de Equipos
            </h2>
            <p style={{ color: '#6b7280', textAlign: 'center', fontSize: '0.95rem' }}>
              Solicitudes de equipos para obras
            </p>
          </div>

          {/* Card Gestión de Equipos */}
          <div
            onClick={() => setModulo('equipos')}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '16px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              border: '3px solid transparent'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-8px)'
              e.currentTarget.style.boxShadow = '0 12px 24px rgba(59, 130, 246, 0.3)'
              e.currentTarget.style.borderColor = '#3b82f6'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'
              e.currentTarget.style.borderColor = 'transparent'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem', textAlign: 'center' }}>
              🏗️
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem', textAlign: 'center', color: '#3b82f6' }}>
              Gestión de Equipos
            </h2>
            <p style={{ color: '#6b7280', textAlign: 'center', fontSize: '0.95rem' }}>
              Inventario y gestión de equipos
            </p>
          </div>

          {/* Card Panel de Flota — oculta (oct-2026) */}
          {MODULOS_OCULTOS_VISIBLES && (
          <div
            onClick={() => setModulo('dashboard-flota')}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '16px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              border: '3px solid transparent'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-8px)'
              e.currentTarget.style.boxShadow = '0 12px 24px rgba(37, 99, 235, 0.3)'
              e.currentTarget.style.borderColor = '#2563eb'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'
              e.currentTarget.style.borderColor = 'transparent'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem', textAlign: 'center' }}>
              📊
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem', textAlign: 'center', color: '#2563eb' }}>
              Panel de Flota
            </h2>
            <p style={{ color: '#6b7280', textAlign: 'center', fontSize: '0.95rem' }}>
              Estado operativo diario
            </p>
          </div>
          )}

          {/* Card Operadores */}
          <div
            onClick={() => setModulo('operadores')}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '16px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              border: '3px solid transparent'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-8px)'
              e.currentTarget.style.boxShadow = '0 12px 24px rgba(245, 158, 11, 0.3)'
              e.currentTarget.style.borderColor = '#f59e0b'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'
              e.currentTarget.style.borderColor = 'transparent'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem', textAlign: 'center' }}>
              👷
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem', textAlign: 'center', color: '#f59e0b' }}>
              Operadores
            </h2>
            <p style={{ color: '#6b7280', textAlign: 'center', fontSize: '0.95rem' }}>
              Gestión de operadores de equipos
            </p>
          </div>

          {/* Oculto (oct-2026): reemplazado por el módulo Correctivos. El código y la ruta siguen. */}
          {MODULOS_OCULTOS_VISIBLES && (
          <>
          {/* Card Analista Correctivo */}
          <div
            onClick={() => setModulo('correctivo')}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '16px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              border: '3px solid transparent'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-8px)'
              e.currentTarget.style.boxShadow = '0 12px 24px rgba(249, 115, 22, 0.3)'
              e.currentTarget.style.borderColor = '#f97316'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'
              e.currentTarget.style.borderColor = 'transparent'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem', textAlign: 'center' }}>
              🔴
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem', textAlign: 'center', color: '#f97316' }}>
              Analista Correctivo
            </h2>
            <p style={{ color: '#6b7280', textAlign: 'center', fontSize: '0.95rem' }}>
              Reparaciones en curso · MTTR · Downtime
            </p>
          </div>
          </>
          )}
          {/* Oculto (oct-2026) a pedido de Andrés. El código y la ruta siguen. */}
          {MODULOS_OCULTOS_VISIBLES && (
          <>
          {/* Card Caja Chica */}
          <div
            onClick={() => setModulo('caja-chica')}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '16px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              border: '3px solid transparent'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-8px)'
              e.currentTarget.style.boxShadow = '0 12px 24px rgba(5, 150, 105, 0.3)'
              e.currentTarget.style.borderColor = '#059669'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'
              e.currentTarget.style.borderColor = 'transparent'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem', textAlign: 'center' }}>
              💰
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem', textAlign: 'center', color: '#059669' }}>
              Caja Chica
            </h2>
            <p style={{ color: '#6b7280', textAlign: 'center', fontSize: '0.95rem' }}>
              Fondos y cajas especiales del departamento
            </p>
          </div>
          </>
          )}
          {/* Card Logística — solo administrador y logística */}
          {(user.rol === 'admin' || user.rol === 'logistica') && (
          <div
            onClick={() => setModulo('logistica')}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '16px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              border: '3px solid transparent'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-8px)'
              e.currentTarget.style.boxShadow = '0 12px 24px rgba(29, 78, 216, 0.3)'
              e.currentTarget.style.borderColor = '#1d4ed8'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'
              e.currentTarget.style.borderColor = 'transparent'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem', textAlign: 'center' }}>
              🚛
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem', textAlign: 'center', color: '#1d4ed8' }}>
              Logística
            </h2>
            <p style={{ color: '#6b7280', textAlign: 'center', fontSize: '0.95rem' }}>
              Planificación de fletes con camiones propios
            </p>
          </div>
          )}

          {/* Card Asistente Técnico — oculta (oct-2026); el código y la ruta siguen */}
          {MODULOS_OCULTOS_VISIBLES && user.rol === 'admin' && (
            <div
              onClick={() => setModulo('asistente-tecnico')}
              style={{
                background: 'white',
                padding: '2rem',
                borderRadius: '16px',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                border: '3px solid transparent'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-8px)'
                e.currentTarget.style.boxShadow = '0 12px 24px rgba(14, 165, 233, 0.3)'
                e.currentTarget.style.borderColor = '#0ea5e9'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'
                e.currentTarget.style.borderColor = 'transparent'
              }}
            >
              <div style={{ fontSize: '3rem', marginBottom: '1rem', textAlign: 'center' }}>
                🤖
              </div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem', textAlign: 'center', color: '#0ea5e9' }}>
                Asistente Técnico
              </h2>
              <p style={{ color: '#6b7280', textAlign: 'center', fontSize: '0.95rem' }}>
                Consultá manuales de equipos en lenguaje natural
              </p>
            </div>
          )}
          {/* Card Correctivos — solo usuarios con usuarios.ve_correctivos = true (ver supabase/correctivos_acceso.sql) */}
          {user.ve_correctivos === true && (
          <div
            onClick={() => setModulo('correctivos')}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '16px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              border: '3px solid transparent'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-8px)'
              e.currentTarget.style.boxShadow = '0 12px 24px rgba(29, 78, 216, 0.3)'
              e.currentTarget.style.borderColor = '#1d4ed8'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'
              e.currentTarget.style.borderColor = 'transparent'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem', textAlign: 'center' }}>
              🛠️
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem', textAlign: 'center', color: '#1d4ed8' }}>
              Correctivos
            </h2>
            <p style={{ color: '#6b7280', textAlign: 'center', fontSize: '0.95rem' }}>
              Estado del mantenimiento correctivo · App + SAP
            </p>
          </div>
          )}
          {/* Card Repuestos — solo usuarios con usuarios.ve_repuestos = true (ver supabase/repuestos_acceso.sql) */}
          {user.ve_repuestos === true && (
          <div
            onClick={() => setModulo('repuestos')}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '16px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              border: '3px solid transparent'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-8px)'
              e.currentTarget.style.boxShadow = '0 12px 24px rgba(29, 78, 216, 0.3)'
              e.currentTarget.style.borderColor = '#1d4ed8'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'
              e.currentTarget.style.borderColor = 'transparent'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem', textAlign: 'center' }}>
              🔩
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem', textAlign: 'center', color: '#1d4ed8' }}>
              Repuestos
            </h2>
            <p style={{ color: '#6b7280', textAlign: 'center', fontSize: '0.95rem' }}>
              Kits de mantenimiento y cobertura de stock
            </p>
          </div>
          )}
          {/* Card Bandeja de preventivos (reemplaza a Completar órdenes IP30) — solo usuarios con usuarios.ve_completar_ordenes = true (ver supabase/bandeja_preventivos.sql) */}
          {user.ve_completar_ordenes === true && (
          <div
            onClick={() => setModulo('completar-ordenes')}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '16px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              border: '3px solid transparent'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-8px)'
              e.currentTarget.style.boxShadow = '0 12px 24px rgba(15, 118, 110, 0.3)'
              e.currentTarget.style.borderColor = '#0f766e'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'
              e.currentTarget.style.borderColor = 'transparent'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem', textAlign: 'center' }}>
              📋
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem', textAlign: 'center', color: '#0f766e' }}>
              Bandeja de preventivos
            </h2>
            <p style={{ color: '#6b7280', textAlign: 'center', fontSize: '0.95rem' }}>
              Órdenes del IP30: cuánto falta, qué programar y qué reprogramar
            </p>
          </div>
          )}
          {/* Card Desde el último mantenimiento — mismo permiso que la Bandeja de preventivos (ver supabase/desde_ultimo_service.sql) */}
          {user.ve_completar_ordenes === true && (
          <div
            onClick={() => setModulo('desde-service')}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '16px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              border: '3px solid transparent'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-8px)'
              e.currentTarget.style.boxShadow = '0 12px 24px rgba(124, 58, 237, 0.3)'
              e.currentTarget.style.borderColor = '#7c3aed'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'
              e.currentTarget.style.borderColor = 'transparent'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem', textAlign: 'center' }}>
              ⏱️
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem', textAlign: 'center', color: '#7c3aed' }}>
              Desde el último mantenimiento
            </h2>
            <p style={{ color: '#6b7280', textAlign: 'center', fontSize: '0.95rem' }}>
              Horas y km trabajados desde el último preventivo
            </p>
          </div>
          )}
          {/* Card Uso de equipos — solo usuarios con usuarios.uso_equipos_acceso = 'gestion' | 'gerencia' (ver supabase/uso_equipos_setup.sql) */}
          {['gestion', 'gerencia'].includes(user.uso_equipos_acceso) && (
          <div
            onClick={() => setModulo('uso-equipos')}
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '16px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              border: '3px solid transparent'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-8px)'
              e.currentTarget.style.boxShadow = '0 12px 24px rgba(180, 83, 9, 0.3)'
              e.currentTarget.style.borderColor = '#b45309'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'
              e.currentTarget.style.borderColor = 'transparent'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem', textAlign: 'center' }}>
              📡
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem', textAlign: 'center', color: '#b45309' }}>
              Uso de equipos
            </h2>
            <p style={{ color: '#6b7280', textAlign: 'center', fontSize: '0.95rem' }}>
              Rastreo, combustible, partes y SAP por obra
            </p>
          </div>
          )}
          {/* Card Historial de equipos — todos los roles (la RPC valida usuario activo) */}
          {(
            <div
              onClick={() => setModulo('historial')}
              style={{
                background: 'white',
                padding: '2rem',
                borderRadius: '16px',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                border: '3px solid transparent'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-8px)'
                e.currentTarget.style.boxShadow = '0 12px 24px rgba(29, 78, 216, 0.3)'
                e.currentTarget.style.borderColor = '#1d4ed8'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'
                e.currentTarget.style.borderColor = 'transparent'
              }}
            >
              <div style={{ fontSize: '3rem', marginBottom: '1rem', textAlign: 'center' }}>
                🔧
              </div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem', textAlign: 'center', color: '#1d4ed8' }}>
                Historial de equipos
              </h2>
              <p style={{ color: '#6b7280', textAlign: 'center', fontSize: '0.95rem' }}>
                Órdenes SAP y repuestos usados por equipo
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ============================================
  // MÓDULO INSPECCIONES
  // ============================================
  if (modulo === 'inspecciones') {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: 'clamp(1rem, 2vw, 2rem)' }}>
        {/* Header */}
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          marginBottom: '2rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                🚜 Sistema de Inspecciones
              </h1>
              <p style={{ color: '#6b7280', margin: 0 }}>
                Usuario: <strong>{user.nombre_completo}</strong>
              </p>
            </div>
            
            {/* Botones del header */}
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              {/* Botón Ver Historial Completo - solo visible en vista de equipos o nueva */}
              {(vistaInspecciones === 'equipos' || vistaInspecciones === 'nueva') && (
                <button
                  onClick={() => setVistaInspecciones('historial')}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}
                >
                  📋 Ver Todas las Inspecciones
                </button>
              )}

              <button
                onClick={volverAlMenu}
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
                ← Menú Principal
              </button>
            </div>
          </div>
        </div>

        {/* Vista: Lista de equipos */}
        {vistaInspecciones === 'equipos' && (
          <EquiposList
            onInspeccionarEquipo={(equipo) => {
              setEquipoSeleccionado(equipo)
              setVistaInspecciones('nueva')
            }}
          />
        )}

        {/* Vista: Nueva inspección */}
        {vistaInspecciones === 'nueva' && equipoSeleccionado && (
          <NuevaInspeccion
            user={user}
            onVolver={() => {
              setVistaInspecciones('equipos')
              setEquipoSeleccionado(null)
            }}
            equipoPreseleccionado={equipoSeleccionado}
          />
        )}

        {/* Vista: Historial completo de inspecciones */}
        {vistaInspecciones === 'historial' && (
          <HistorialInspeccionesCompleto
            onVolver={() => setVistaInspecciones('equipos')}
            onVerDetalle={(inspeccion) => {
              setInspeccionSeleccionada(inspeccion)
              setVistaInspecciones('detalle')
            }}
          />
        )}

        {/* Vista: Detalle de inspección */}
        {vistaInspecciones === 'detalle' && inspeccionSeleccionada && (
          <DetalleInspeccion
            inspeccion={inspeccionSeleccionada}
            onVolver={() => setVistaInspecciones('historial')}
          />
        )}
      </div>
    )
  }

  // ============================================
  // MÓDULO PEDIDOS DE COMPRA
  // ============================================
  if (modulo === 'pedidos-compra') {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', padding: 'clamp(1rem, 2vw, 2rem)' }}>
        {/* Header */}
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          marginBottom: '2rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                🛒 Pedidos de Compra
              </h1>
              <p style={{ color: '#6b7280', margin: 0 }}>
                Usuario: <strong>{user.nombre_completo}</strong>
              </p>
            </div>
            <button
              onClick={volverAlMenu}
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
              ← Menú Principal
            </button>
          </div>
        </div>

        {/* Contenido */}
        {vistaPedidosCompra === 'lista' && (
          <ListaPedidosCompra
            onNuevo={() => setVistaPedidosCompra('nuevo')}
            usuario={user}
          />
        )}

        {vistaPedidosCompra === 'nuevo' && (
          <NuevoPedidoCompra
            onVolver={() => setVistaPedidosCompra('lista')}
            usuario={user}
          />
        )}
      </div>
    )
  }

  // ============================================
  // MÓDULO MANTENIMIENTOS
  // ============================================
  if (modulo === 'mantenimientos') {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', padding: 'clamp(1rem, 2vw, 2rem)' }}>
        {/* Header */}
        <div style={{
          background: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          marginBottom: '2rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                🔧 Mantenimientos
              </h1>
              <p style={{ color: '#6b7280', margin: 0 }}>
                Usuario: <strong>{user.nombre_completo}</strong>
              </p>
            </div>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              {vistaMantenimientos !== 'dashboard' && (
                <button
                  onClick={() => setVistaMantenimientos('dashboard')}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: '#8b5cf6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: '600'
                  }}
                >
                  📊 Dashboard
                </button>
              )}
              <button
                onClick={volverAlMenu}
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
                ← Menú Principal
              </button>
            </div>
          </div>
        </div>

        {/* Contenido */}
        {vistaMantenimientos === 'lista' && (
          <ListaMantenimientos
            onNuevo={() => setVistaMantenimientos('nuevo')}
            onEditar={(mant) => {
              setMantenimientoEditar(mant)
              setVistaMantenimientos('editar')
            }}
          />
        )}

        {vistaMantenimientos === 'nuevo' && (
          <NuevoMantenimiento
            onVolver={() => setVistaMantenimientos('lista')}
            usuario={user}
          />
        )}

        {vistaMantenimientos === 'editar' && (
          <NuevoMantenimiento
            onVolver={() => {
              setVistaMantenimientos('lista')
              setMantenimientoEditar(null)
            }}
            mantenimientoEditar={mantenimientoEditar}
            usuario={user}
          />
        )}

        {vistaMantenimientos === 'dashboard' && (
          <DashboardMantenimientos
            onVolver={() => setVistaMantenimientos('lista')}
          />
        )}
      </div>
    )
  }

  // ============================================
  // MÓDULO DASHBOARD EJECUTIVO
  // ============================================
  if (modulo === 'dashboard-ejecutivo') {
    return (
      <DashboardEjecutivo
        onVolver={volverAlMenu}
      />
    )
  }

  // ============================================
  // MÓDULO PEDIDOS DE EQUIPOS
  // ============================================
  if (modulo === 'pedidos-equipos') {
    return (
      <ModuloPedidosEquipos
        usuario={user}
        onVolver={volverAlMenu}
      />
    )
  }

  // ============================================
  // MÓDULO GESTIÓN DE EQUIPOS
  // ============================================
  if (modulo === 'equipos') {
    return (
      <ModuloEquipos
        usuario={user}
        onVolver={volverAlMenu}
      />
    )
  }

  // ============================================
  // MÓDULO OPERADORES
  // ============================================
  if (modulo === 'operadores') {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}>
        <div style={{
          background: 'white',
          padding: '1.5rem',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          marginBottom: '2rem',
          position: 'sticky',
          top: 0,
          zIndex: 100
        }}>
          <button
            onClick={volverAlMenu}
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
            ← Menú Principal
          </button>
        </div>
        <ModuloOperadores />
      </div>
    )
  }

  // ============================================
  // MÓDULO PANEL DE FLOTA
  // ============================================
  if (modulo === 'dashboard-flota') {
    return <DashboardFlota onVolver={volverAlMenu} />
  }

  // ============================================
  // MÓDULO CAJA CHICA
  // ============================================
  if (modulo === 'caja-chica') {
    return <CajaChica usuario={user} onVolver={volverAlMenu} />
  }

  // ============================================
  // MÓDULO ANALISTA CORRECTIVO
  // ============================================
  if (modulo === 'correctivo') {
    if (vistaCorrectivo === 'lista') {
      return (
        <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)', padding: 'clamp(1rem, 2vw, 2rem)' }}>
          <AnalistaCorrectivo
            onVolver={volverAlMenu}
            onEditar={(c) => {
              setCorrectivoEditar(c)
              setVistaCorrectivo('editar')
            }}
          />
        </div>
      )
    }
    if (vistaCorrectivo === 'editar') {
      return (
        <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)', padding: 'clamp(1rem, 2vw, 2rem)' }}>
          <NuevoMantenimiento
            onVolver={() => {
              setVistaCorrectivo('lista')
              setCorrectivoEditar(null)
            }}
            mantenimientoEditar={correctivoEditar}
            usuario={user}
          />
        </div>
      )
    }
  }

  // ============================================
  // MÓDULO ASISTENTE TÉCNICO
  // ============================================
  if (modulo === 'asistente-tecnico') {
    // Doble verificación de rol por si acceden directamente
    if (user.rol !== 'admin') {
      return null
    }
    return (
      <AsistenteTecnico
        usuario={user}
        onVolver={volverAlMenu}
      />
    )
  }

  // ============================================
  // MÓDULO LOGÍSTICA
  // ============================================
  if (modulo === 'logistica') {
    // Doble verificación de rol por si acceden directamente
    if (user.rol !== 'admin' && user.rol !== 'logistica') {
      return null
    }
    return (
      <ModuloLogistica
        usuario={user}
        onVolver={volverAlMenu}
      />
    )
  }

  // ============================================
  // MÓDULO CORRECTIVOS (solo lectura, solo usuarios con ve_correctivos = true)
  // ============================================
  if (modulo === 'correctivos') {
    // Sin permiso (estado viejo o navegación forzada): no renderizar; el efecto de arriba vuelve al menú
    if (user.ve_correctivos !== true) return null
    return <ModuloCorrectivos onVolver={volverAlMenu} />
  }

  // ============================================
  // MÓDULO REPUESTOS (solo lectura, solo usuarios con ve_repuestos = true)
  // ============================================
  if (modulo === 'repuestos') {
    // Sin permiso: no renderizar; el efecto de arriba vuelve al menú
    if (user.ve_repuestos !== true) return null
    return <ModuloRepuestos onVolver={volverAlMenu} />
  }

  // ============================================
  // BANDEJA DE PREVENTIVOS (reemplaza a Completar órdenes IP30; solo usuarios con ve_completar_ordenes = true; las RPC también lo validan)
  // ============================================
  if (modulo === 'completar-ordenes') {
    if (user.ve_completar_ordenes !== true) return null
    return <BandejaPreventivos onVolver={volverAlMenu} />
  }

  // ============================================
  // DESDE EL ÚLTIMO SERVICE (mismo permiso ve_completar_ordenes; la RPC también lo valida)
  // ============================================
  if (modulo === 'desde-service') {
    if (user.ve_completar_ordenes !== true) return null
    return <DesdeUltimoService onVolver={volverAlMenu} />
  }

  // ============================================
  // USO DE EQUIPOS (solo usuarios con uso_equipos_acceso; las vistas y RPC también lo validan)
  // ============================================
  if (modulo === 'uso-equipos') {
    if (!['gestion', 'gerencia'].includes(user.uso_equipos_acceso)) return null
    return <ModuloUsoEquipos acceso={user.uso_equipos_acceso} onVolver={volverAlMenu} />
  }

  // ============================================
  // PLANIFICADOR DE INSPECCIONES (solo admin; las RPC también lo validan)
  // ============================================
  if (modulo === 'planificador') {
    if (user.rol !== 'admin') return null
    return <Planificador onVolver={volverAlMenu} />
  }

  // ============================================
  // MI LISTA DE LA SEMANA (inspectores asignados; la RPC filtra por el usuario)
  // ============================================
  if (modulo === 'mi-lista') {
    return <MiListaSemana user={user} onVolver={volverAlMenu} />
  }

  // ============================================
  // MÓDULO HISTORIAL DE EQUIPOS
  // ============================================
  if (modulo === 'historial') {
    // Abierto a todos los roles; el acceso a datos lo valida puede_ver_historial() (usuario activo)
    return <HistorialEquipo onVolver={volverAlMenu} />
  }

  // Fallback (no debería llegar aquí)
  return null
}

export default App