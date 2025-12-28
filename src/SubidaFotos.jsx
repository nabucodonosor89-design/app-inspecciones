import { useState } from 'react'
import { subirImagenCloudinary, validarImagen } from './utils/cloudinary'

function SubidaFotos({ onFotosChange, fotosExistentes = [] }) {
  const [fotos, setFotos] = useState(fotosExistentes)
  const [subiendo, setSubiendo] = useState(false)
  const [progreso, setProgreso] = useState({ actual: 0, total: 0 })

  const handleFileSelect = async (e) => {
    const archivos = Array.from(e.target.files)
    
    if (archivos.length === 0) return
    
    // Validar cada archivo
    const archivosValidos = []
    for (const archivo of archivos) {
      const validacion = validarImagen(archivo, 10) // Max 10MB
      if (validacion.valido) {
        archivosValidos.push(archivo)
      } else {
        alert(`${archivo.name}: ${validacion.error}`)
      }
    }
    
    if (archivosValidos.length === 0) return
    
    setSubiendo(true)
    setProgreso({ actual: 0, total: archivosValidos.length })
    
    const nuevasFotos = []
    
    for (let i = 0; i < archivosValidos.length; i++) {
      const archivo = archivosValidos[i]
      
      try {
        // Subir a Cloudinary
        const resultado = await subirImagenCloudinary(archivo, 'inspecciones')
        
        nuevasFotos.push({
          url: resultado.url,
          public_id: resultado.public_id,
          descripcion: '',
          nombre: archivo.name,
          preview: URL.createObjectURL(archivo)
        })
        
        setProgreso({ actual: i + 1, total: archivosValidos.length })
      } catch (error) {
        console.error(`Error subiendo ${archivo.name}:`, error)
        alert(`Error subiendo ${archivo.name}`)
      }
    }
    
    const fotosActualizadas = [...fotos, ...nuevasFotos]
    setFotos(fotosActualizadas)
    onFotosChange(fotosActualizadas)
    
    console.log('📸 Fotos actualizadas:', fotosActualizadas)
    console.log('📸 Llamando onFotosChange con:', fotosActualizadas)
    
    setSubiendo(false)
    e.target.value = '' // Limpiar input
  }

  const eliminarFoto = (index) => {
    const fotosActualizadas = fotos.filter((_, i) => i !== index)
    setFotos(fotosActualizadas)
    onFotosChange(fotosActualizadas)
  }

  const actualizarDescripcion = (index, descripcion) => {
    const fotosActualizadas = [...fotos]
    fotosActualizadas[index].descripcion = descripcion
    setFotos(fotosActualizadas)
    onFotosChange(fotosActualizadas)
  }

  return (
    <div>
      <div style={{
        marginBottom: '1rem',
        padding: '1rem',
        background: '#f3f4f6',
        borderRadius: '8px',
        border: '2px dashed #d1d5db'
      }}>
        <label style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          cursor: subiendo ? 'not-allowed' : 'pointer',
          opacity: subiendo ? 0.5 : 1
        }}>
          <span style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>📸</span>
          <span style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '0.25rem' }}>
            {subiendo ? 'Subiendo fotos...' : 'Agregar fotos'}
          </span>
          <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
            Click para seleccionar o arrastra aquí
          </span>
          <span style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' }}>
            Máximo 10MB por foto • JPG, PNG, WEBP
          </span>
          <input
            type="file"
            multiple
            accept="image/jpeg,image/jpg,image/png,image/webp"
            onChange={handleFileSelect}
            disabled={subiendo}
            style={{ display: 'none' }}
          />
        </label>

        {subiendo && (
          <div style={{ marginTop: '1rem' }}>
            <div style={{
              width: '100%',
              height: '8px',
              background: '#e5e7eb',
              borderRadius: '4px',
              overflow: 'hidden'
            }}>
              <div style={{
                width: `${(progreso.actual / progreso.total) * 100}%`,
                height: '100%',
                background: '#667eea',
                transition: 'width 0.3s'
              }} />
            </div>
            <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem', textAlign: 'center' }}>
              Subiendo {progreso.actual} de {progreso.total} fotos...
            </p>
          </div>
        )}
      </div>

      {/* Galería de fotos */}
      {fotos.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: '1rem'
        }}>
          {fotos.map((foto, index) => (
            <div
              key={index}
              style={{
                background: 'white',
                borderRadius: '8px',
                overflow: 'hidden',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                border: '1px solid #e5e7eb'
              }}
            >
              <div style={{ position: 'relative' }}>
                <img
                  src={foto.url}
                  alt={`Foto ${index + 1}`}
                  style={{
                    width: '100%',
                    height: '150px',
                    objectFit: 'cover'
                  }}
                />
                <button
                  onClick={() => eliminarFoto(index)}
                  style={{
                    position: 'absolute',
                    top: '0.5rem',
                    right: '0.5rem',
                    background: '#ef4444',
                    color: 'white',
                    border: 'none',
                    borderRadius: '50%',
                    width: '30px',
                    height: '30px',
                    cursor: 'pointer',
                    fontSize: '1.2rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                  }}
                  title="Eliminar foto"
                >
                  ×
                </button>
              </div>
              
              <div style={{ padding: '0.75rem' }}>
                <input
                  type="text"
                  placeholder="Descripción (opcional)"
                  value={foto.descripcion}
                  onChange={(e) => actualizarDescripcion(index, e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #e5e7eb',
                    borderRadius: '4px',
                    fontSize: '0.875rem'
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {fotos.length > 0 && (
        <p style={{
          fontSize: '0.875rem',
          color: '#6b7280',
          marginTop: '1rem',
          textAlign: 'center'
        }}>
          {fotos.length} {fotos.length === 1 ? 'foto agregada' : 'fotos agregadas'}
        </p>
      )}
    </div>
  )
}

export default SubidaFotos