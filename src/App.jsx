import { supabase } from './lib/supabase'
import { useEffect, useState } from 'react'
import Login from './Login'
import EquiposList from './EquiposList'
import NuevaInspeccion from './NuevaInspeccion'

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
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
      {/* Header responsive */}
      <div className="app-header">
        <div className="app-header-title">
          <h1 style={{ 
            fontSize: 'clamp(1.5rem, 5vw, 2.5rem)', 
            fontWeight: 'bold', 
            margin: 0,
            lineHeight: '1.2'
          }}>
            🚜 Sistema de Inspecciones TyE
          </h1>
          <p style={{ 
            color: '#6b7280',
            fontSize: 'clamp(0.875rem, 2vw, 1rem)',
            margin: '0.5rem 0 0 0'
          }}>
            Bienvenido, <strong>{user.nombre_completo}</strong>
          </p>
        </div>
        
        {/* Botones responsive */}
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
            onClick={handleLogout}
            style={{
              padding: '0.75rem 1.5rem',
              background: '#ef4444',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '0.95rem',
              minHeight: '44px'
            }}
          >
            Cerrar Sesión
          </button>
        </div>
      </div>
      
      <EquiposList onInspeccionarEquipo={iniciarInspeccion} />
    </div>
  )
}

export default App