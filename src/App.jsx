import { supabase } from './lib/supabase'
import { useEffect, useState } from 'react'
import Login from './Login.jsx'
import EquiposList from './EquiposList.jsx'
import NuevaInspeccion from './NuevaInspeccion.jsx'
import ListaPedidosCompra from './ListaPedidosCompra.jsx'
import NuevoPedidoCompra from './NuevoPedidoCompra.jsx'
import NuevoMantenimiento from './NuevoMantenimiento.jsx'
import ListaMantenimientos from './ListaMantenimientos.jsx'
import DashboardMantenimientos from './DashboardMantenimientos.jsx'

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [modulo, setModulo] = useState('menu') // 'menu', 'inspecciones', 'pedidos', 'mantenimientos'
  
  // Estados para Inspecciones
  const [vistaInspecciones, setVistaInspecciones] = useState('equipos') // 'equipos', 'nueva'
  const [equipoSeleccionado, setEquipoSeleccionado] = useState(null)
  
  // Estados para Pedidos
  const [vistaPedidos, setVistaPedidos] = useState('lista') // 'lista', 'nuevo'
  
  // Estados para Mantenimientos
  const [vistaMantenimientos, setVistaMantenimientos] = useState('lista') // 'lista', 'nuevo', 'editar', 'dashboard'
  const [mantenimientoEditar, setMantenimientoEditar] = useState(null)

  useEffect(() => {
    checkUser()
  }, [])

  async function checkUser() {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      const { data: userData } = await supabase
        .from('usuarios')
        .select('*')
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
    setVistaPedidos('lista')
    setVistaMantenimientos('lista')
    setEquipoSeleccionado(null)
    setMantenimientoEditar(null)
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
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '2rem',
          maxWidth: '1200px',
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
              Gestión de equipos e inspecciones
            </p>
          </div>

          {/* Card Pedidos de Compra */}
          <div
            onClick={() => setModulo('pedidos')}
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
              🛒
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '0.5rem', textAlign: 'center', color: '#10b981' }}>
              Pedidos de Compra
            </h2>
            <p style={{ color: '#6b7280', textAlign: 'center', fontSize: '0.95rem' }}>
              Solicitudes de materiales y servicios
            </p>
          </div>

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
        {vistaInspecciones === 'equipos' && (
          <EquiposList
            onInspeccionarEquipo={(equipo) => {
              setEquipoSeleccionado(equipo)
              setVistaInspecciones('nueva')
            }}
          />
        )}

        {vistaInspecciones === 'nueva' && equipoSeleccionado && (
          <NuevaInspeccion
            user={user}
            onVolver={() => {
              setVistaInspecciones('equipos')
              setEquipoSeleccionado(null)
            }}
            equipoInicial={equipoSeleccionado}
          />
        )}
      </div>
    )
  }

  // ============================================
  // MÓDULO PEDIDOS DE COMPRA
  // ============================================
  if (modulo === 'pedidos') {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', padding: 'clamp(1rem, 2vw, 2rem)' }}>
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
        {vistaPedidos === 'lista' && (
          <ListaPedidosCompra
            onNuevo={() => setVistaPedidos('nuevo')}
            usuario={user}
          />
        )}

        {vistaPedidos === 'nuevo' && (
          <NuevoPedidoCompra
            onVolver={() => setVistaPedidos('lista')}
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

  // Fallback (no debería llegar aquí)
  return null
}

export default App