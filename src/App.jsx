import { supabase } from './lib/supabase'
import { useEffect, useState } from 'react'
import Login from './Login'
import EquiposList from './EquiposList'
import NuevaInspeccion from './NuevaInspeccion'
import ListaPedidosCompra from './ListaPedidosCompra'

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [modulo, setModulo] = useState(null) // null, 'inspecciones', 'pedidos'
  const [vista, setVista] = useState('lista')
  const [equipoPreseleccionado, setEquipoPreseleccionado] = useState(null)

  useEffect(() => {
    checkUser()
    
    // Agregar estilos responsive al head
    const style = document.createElement('style')
    style.textContent = `
      .app-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1.5rem;
        padding-bottom: 1rem;
        border-bottom: 2px solid #e5e7eb;
      }
      
      .app-header-title {
        text-align: left;
      }
      
      .app-header-buttons {
        display: flex;
        gap: 0.75rem;
      }
      
      @media (max-width: 768px) {
        .app-header {
          flex-direction: column;
          align-items: stretch;
        }
        
        .app-header-title {
          text-align: center;
        }
        
        .app-header-buttons {
          width: 100%;
        }
      }
      
      @media (max-width: 480px) {
        .app-header-buttons {
          flex-direction: column;
        }
        
        .app-header-buttons button {
          width: 100%;
        }
      }
    `
    document.head.appendChild(style)
    
    return () => {
      if (document.head.contains(style)) {
        document.head.removeChild(style)
      }
    }
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
  }

  function iniciarInspeccion(equipo = null) {
    setEquipoPreseleccionado(equipo)
    setVista('nueva-inspeccion')
  }

  function volverALista() {
    setEquipoPreseleccionado(null)
    setVista('lista')
    
    // Resetear scroll y zoom
    window.scrollTo(0, 0)
    
    // Forzar reset del viewport en móvil
    const viewport = document.querySelector('meta[name="viewport"]')
    if (viewport) {
      viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=5.0')
    }
    
    // Forzar reflow para limpiar el estado
    document.body.style.minWidth = '100vw'
    setTimeout(() => {
      document.body.style.minWidth = ''
    }, 0)
  }

  function volverAlMenu() {
    setModulo(null)
    setVista('lista')
    setEquipoPreseleccionado(null)
    window.scrollTo(0, 0)
  }

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        minHeight: '100vh',
        padding: '1rem'
      }}>
        <p style={{ fontSize: '1.5rem' }}>Cargando...</p>
      </div>
    )
  }

  if (!user) {
    return <Login onLogin={setUser} />
  }

  // Módulo de Inspecciones
  if (modulo === 'inspecciones') {
    if (vista === 'nueva-inspeccion') {
      return <NuevaInspeccion 
        user={user} 
        equipoPreseleccionado={equipoPreseleccionado}
        onVolver={volverALista} 
      />
    }

    return (
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto', 
        padding: '1rem'
      }}>
        <div className="app-header">
          <div className="app-header-title">
            <h1 style={{ 
              fontSize: 'clamp(1.5rem, 5vw, 2.5rem)', 
              fontWeight: 'bold', 
              margin: 0,
              lineHeight: '1.2'
            }}>
              🚜 Sistema de Inspecciones
            </h1>
            <p style={{ 
              color: '#6b7280',
              fontSize: 'clamp(0.875rem, 2vw, 1rem)',
              margin: '0.5rem 0 0 0'
            }}>
              {user.nombre_completo}
            </p>
          </div>
          
          <div className="app-header-buttons">
            <button
              onClick={() => iniciarInspeccion()}
              style={{
                padding: '0.75rem 1.5rem',
                background: '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '0.95rem',
                minHeight: '44px',
                whiteSpace: 'nowrap'
              }}
            >
              + Nueva Inspección
            </button>
            <button
              onClick={volverAlMenu}
              style={{
                padding: '0.75rem 1.5rem',
                background: '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '0.95rem',
                minHeight: '44px'
              }}
            >
              ← Menú Principal
            </button>
          </div>
        </div>
        
        <EquiposList onInspeccionarEquipo={iniciarInspeccion} />
      </div>
    )
  }

  // Módulo de Pedidos de Compra
  if (modulo === 'pedidos') {
    return (
      <div>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          padding: '1rem 1rem 0 1rem'
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
              fontWeight: '600',
              fontSize: '0.95rem',
              marginBottom: '1rem'
            }}
          >
            ← Menú Principal
          </button>
        </div>
        <ListaPedidosCompra usuario={user} />
      </div>
    )
  }

  // Menú Principal
  return (
    <div style={{ 
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '2rem 1rem'
    }}>
      <div style={{
        maxWidth: '1000px',
        margin: '0 auto'
      }}>
        {/* Header */}
        <div style={{
          textAlign: 'center',
          marginBottom: '3rem',
          color: 'white'
        }}>
          <h1 style={{
            fontSize: 'clamp(2rem, 6vw, 3rem)',
            fontWeight: 'bold',
            marginBottom: '1rem',
            textShadow: '0 2px 4px rgba(0,0,0,0.2)'
          }}>
            Sistema de Gestión TyE
          </h1>
          <p style={{
            fontSize: 'clamp(1rem, 3vw, 1.2rem)',
            opacity: 0.95
          }}>
            Bienvenido, <strong>{user.nombre_completo}</strong>
          </p>
          <button
            onClick={handleLogout}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1.5rem',
              background: 'rgba(255,255,255,0.2)',
              color: 'white',
              border: '2px solid white',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '0.9rem',
              backdropFilter: 'blur(10px)'
            }}
          >
            Cerrar Sesión
          </button>
        </div>

        {/* Módulos */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '2rem',
          marginBottom: '2rem'
        }}>
          {/* Módulo Inspecciones */}
          <div
            onClick={() => setModulo('inspecciones')}
            style={{
              background: 'white',
              padding: '3rem 2rem',
              borderRadius: '20px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              textAlign: 'center'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-10px)'
              e.currentTarget.style.boxShadow = '0 15px 40px rgba(0,0,0,0.3)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 10px 30px rgba(0,0,0,0.2)'
            }}
          >
            <div style={{
              fontSize: '4rem',
              marginBottom: '1rem'
            }}>
              🚜
            </div>
            <h2 style={{
              fontSize: '1.8rem',
              fontWeight: 'bold',
              marginBottom: '1rem',
              color: '#1f2937'
            }}>
              Inspecciones
            </h2>
            <p style={{
              color: '#6b7280',
              fontSize: '1rem',
              lineHeight: '1.6'
            }}>
              Gestión completa de inspecciones de equipos, vehículos y maquinaria
            </p>
            <div style={{
              marginTop: '1.5rem',
              padding: '0.75rem',
              background: '#f3f4f6',
              borderRadius: '8px',
              fontSize: '0.875rem',
              color: '#4b5563'
            }}>
              ✓ Nuevas inspecciones<br/>
              ✓ Historial completo<br/>
              ✓ Exportar a PDF
            </div>
          </div>

          {/* Módulo Pedidos de Compra */}
          <div
            onClick={() => setModulo('pedidos')}
            style={{
              background: 'white',
              padding: '3rem 2rem',
              borderRadius: '20px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              textAlign: 'center'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-10px)'
              e.currentTarget.style.boxShadow = '0 15px 40px rgba(0,0,0,0.3)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 10px 30px rgba(0,0,0,0.2)'
            }}
          >
            <div style={{
              fontSize: '4rem',
              marginBottom: '1rem'
            }}>
              🛒
            </div>
            <h2 style={{
              fontSize: '1.8rem',
              fontWeight: 'bold',
              marginBottom: '1rem',
              color: '#1f2937'
            }}>
              Pedidos de Compra
            </h2>
            <p style={{
              color: '#6b7280',
              fontSize: '1rem',
              lineHeight: '1.6'
            }}>
              Solicitudes de compra de materiales y servicios con seguimiento de estados
            </p>
            <div style={{
              marginTop: '1.5rem',
              padding: '0.75rem',
              background: '#f3f4f6',
              borderRadius: '8px',
              fontSize: '0.875rem',
              color: '#4b5563'
            }}>
              ✓ Crear solicitudes<br/>
              ✓ Gestionar estados<br/>
              ✓ Exportar a PDF
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div style={{
          textAlign: 'center',
          color: 'white',
          fontSize: '0.875rem',
          opacity: 0.8
        }}>
          <p>Selecciona un módulo para comenzar</p>
        </div>
      </div>
    </div>
  )
}

export default App