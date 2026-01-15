import { useState } from 'react'
import ListaOperadores from './ListaOperadores.jsx'
import FormularioOperador from './FormularioOperador.jsx'

function ModuloOperadores() {
  const [vista, setVista] = useState('lista') // 'lista' o 'formulario'
  const [operadorEditando, setOperadorEditando] = useState(null)
  const [recargarKey, setRecargarKey] = useState(0)

  const abrirFormularioNuevo = () => {
    setOperadorEditando(null)
    setVista('formulario')
  }

  const abrirFormularioEditar = (operador) => {
    setOperadorEditando(operador)
    setVista('formulario')
  }

  const cerrarFormulario = () => {
    setOperadorEditando(null)
    setVista('lista')
  }

  const handleGuardado = () => {
    cerrarFormulario()
    setRecargarKey(prev => prev + 1) // Forzar recarga de lista
  }

  return (
    <div>
      {vista === 'lista' && (
        <ListaOperadores
          key={recargarKey}
          onNuevo={abrirFormularioNuevo}
          onEditar={abrirFormularioEditar}
        />
      )}

      {vista === 'formulario' && (
        <FormularioOperador
          operador={operadorEditando}
          onCerrar={cerrarFormulario}
          onGuardado={handleGuardado}
        />
      )}
    </div>
  )
}

export default ModuloOperadores