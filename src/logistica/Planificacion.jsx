import { useState } from 'react'
import TableroDespacho from './TableroDespacho'
import VistaDia from './VistaDia'
import { useCamiones } from './hooks'
import { useEsEscritorio } from './constantes'

/**
 * Despacho (antes "Semana" / "Día"): Tablero por frente en escritorio, un día por vez en el celular.
 * La grilla camión × día de la v2 sigue disponible en el tablero con "Ver por Camión".
 */
export default function Planificacion({ catalogos, onAbrirEncargo, onAbrirCamiones, esAdmin, version }) {
  const escritorio = useEsEscritorio()
  const [recarga, setRecarga] = useState(0)
  const camiones = useCamiones(catalogos.camiones, `${version}-${recarga}`)
  const props = {
    catalogos, camiones, onAbrirEncargo, onAbrirCamiones, esAdmin,
    version: `${version}-${recarga}`,
    recargar: () => setRecarga(r => r + 1),
  }
  return escritorio ? <TableroDespacho {...props} /> : <VistaDia {...props} />
}
