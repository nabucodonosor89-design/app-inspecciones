import { useState } from 'react'
import ListaEquipos from './ListaEquipos.jsx'
import FormularioEquipo from './FormularioEquipo.jsx'

function ModuloEquipos({ usuario, onVolver }) {
  const [vista, setVista] = useState('lista') // 'lista', 'nuevo', 'editar'
  const [equipoEditar, setEquipoEditar] = useState(null)
  const [recargarLista, setRecargarLista] = useState(0)

  function handleNuevoEquipo() {
    setEquipoEditar(null)
    setVista('nuevo')
  }

  function handleEditarEquipo(equipo) {
    setEquipoEditar(equipo)
    setVista('editar')
  }

  function handleGuardado() {
    setVista('lista')
    setEquipoEditar(null)
    setRecargarLista(prev => prev + 1)
  }

  function handleCancelar() {
    setVista('lista')
    setEquipoEditar(null)
  }

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
              📦 Gestión de Equipos
            </h1>
            <p style={{ color: '#6b7280', margin: 0 }}>
              Usuario: <strong>{usuario.nombre_completo}</strong>
            </p>
          </div>
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
            ← Menú Principal
          </button>
        </div>
      </div>

      {/* Contenido */}
      {vista === 'lista' && (
        <ListaEquipos
          onNuevo={handleNuevoEquipo}
          onEditar={handleEditarEquipo}
          usuario={usuario}
          recargarKey={recargarLista}
        />
      )}

      {(vista === 'nuevo' || vista === 'editar') && (
        <FormularioEquipo
          equipo={equipoEditar}
          onGuardado={handleGuardado}
          onCancelar={handleCancelar}
          usuario={usuario}
        />
      )}
    </div>
  )
}

export default ModuloEquipos