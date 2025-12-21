// Configuración de Cloudinary
const CLOUDINARY_CLOUD_NAME = 'dsieaaiyd'
const CLOUDINARY_UPLOAD_PRESET = 'inspecciones_equipos'

/**
 * Sube una imagen a Cloudinary
 * @param {File} file - Archivo de imagen a subir
 * @param {string} folder - Carpeta en Cloudinary (opcional)
 * @returns {Promise<Object>} - Objeto con url y public_id
 */
export async function subirImagenCloudinary(file, folder = 'inspecciones') {
  try {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET)
    formData.append('folder', folder)
    
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
      {
        method: 'POST',
        body: formData
      }
    )
    
    if (!response.ok) {
      throw new Error('Error al subir imagen a Cloudinary')
    }
    
    const data = await response.json()
    
    return {
      url: data.secure_url,
      public_id: data.public_id,
      width: data.width,
      height: data.height
    }
  } catch (error) {
    console.error('Error subiendo imagen:', error)
    throw error
  }
}

/**
 * Sube múltiples imágenes a Cloudinary
 * @param {FileList|File[]} files - Archivos a subir
 * @param {string} folder - Carpeta en Cloudinary
 * @param {Function} onProgress - Callback de progreso (opcional)
 * @returns {Promise<Array>} - Array de objetos con url y public_id
 */
export async function subirMultiplesImagenes(files, folder = 'inspecciones', onProgress = null) {
  const filesArray = Array.from(files)
  const resultados = []
  
  for (let i = 0; i < filesArray.length; i++) {
    const file = filesArray[i]
    
    try {
      const resultado = await subirImagenCloudinary(file, folder)
      resultados.push({
        ...resultado,
        nombre: file.name
      })
      
      // Llamar callback de progreso si existe
      if (onProgress) {
        onProgress(i + 1, filesArray.length)
      }
    } catch (error) {
      console.error(`Error subiendo ${file.name}:`, error)
      resultados.push({
        error: true,
        nombre: file.name,
        mensaje: error.message
      })
    }
  }
  
  return resultados
}

/**
 * Valida que el archivo sea una imagen válida
 * @param {File} file - Archivo a validar
 * @param {number} maxSizeMB - Tamaño máximo en MB (default: 5MB)
 * @returns {Object} - { valido: boolean, error: string }
 */
export function validarImagen(file, maxSizeMB = 5) {
  // Validar tipo de archivo
  const tiposPermitidos = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
  if (!tiposPermitidos.includes(file.type)) {
    return {
      valido: false,
      error: 'Solo se permiten imágenes JPG, PNG o WEBP'
    }
  }
  
  // Validar tamaño
  const maxSize = maxSizeMB * 1024 * 1024 // Convertir a bytes
  if (file.size > maxSize) {
    return {
      valido: false,
      error: `La imagen no debe superar ${maxSizeMB}MB`
    }
  }
  
  return { valido: true }
}

/**
 * Comprime una imagen antes de subirla (opcional)
 * @param {File} file - Archivo a comprimir
 * @param {number} maxWidth - Ancho máximo en píxeles
 * @returns {Promise<Blob>} - Imagen comprimida
 */
export function comprimirImagen(file, maxWidth = 1920) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    
    reader.onload = (e) => {
      const img = new Image()
      
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height
        
        // Calcular nuevas dimensiones manteniendo aspect ratio
        if (width > maxWidth) {
          height = (height * maxWidth) / width
          width = maxWidth
        }
        
        canvas.width = width
        canvas.height = height
        
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        
        canvas.toBlob((blob) => {
          resolve(blob)
        }, 'image/jpeg', 0.85) // 85% de calidad
      }
      
      img.onerror = reject
      img.src = e.target.result
    }
    
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}