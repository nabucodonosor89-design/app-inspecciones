// Constantes del seguimiento por orden/aviso (ver supabase/correctivos_seguimiento.sql)
import { C } from './constantes'

// Lista fija: tiene que coincidir con el CHECK de corr_novedades.situacion
export const SITUACIONES = [
  { id: 'diagnostico', label: 'Diagnóstico', fg: C.gris, bg: '#f3f4f6' },
  { id: 'esperando_cotizacion', label: 'Esperando cotización', fg: C.ambar, bg: C.ambarBg },
  { id: 'esperando_aprobacion', label: 'Esperando aprobación', fg: C.ambar, bg: C.ambarBg },
  { id: 'esperando_repuesto', label: 'Esperando repuesto', fg: C.rojo, bg: C.rojoBg },
  { id: 'en_reparacion', label: 'En reparación', fg: C.azul, bg: C.azulBg },
  { id: 'en_traslado', label: 'En traslado', fg: '#6d28d9', bg: '#ede9fe' },
  { id: 'listo_para_liberar', label: 'Listo para liberar', fg: C.verde, bg: C.verdeBg },
]
export const SITUACION_POR_ID = Object.fromEntries(SITUACIONES.map((x) => [x.id, x]))

export const ALERTAS = {
  sin_seguimiento: { label: 'Sin seguimiento', fg: C.ambar, bg: C.ambarBg, ayuda: 'No tiene novedades hace más de 3 días.' },
  compromiso_vencido: { label: 'Compromiso vencido', fg: '#fff', bg: C.rojo, ayuda: 'La fecha compromiso de la última novedad ya pasó.' },
  cerrada_sap_con_seguimiento: { label: 'Cerrada en SAP', fg: C.rojo, bg: C.rojoBg, ayuda: 'La orden está cerrada en SAP pero el seguimiento sigue abierto: terminarlo o pedir que se reabra la orden.' },
  otes_con_trabajo: { label: '0TES con trabajo', fg: C.rojo, bg: C.rojoBg, ayuda: 'La orden no está liberada en SAP (0TES) pero la reparación está en curso: pedir que se libere.' },
  equipo_distinto: { label: 'Equipo distinto en SAP', fg: C.rojo, bg: C.rojoBg, ayuda: 'El aviso u orden está a nombre de otro equipo en SAP. Revisar el número o corregir SAP.' },
  terminado_abierta_sap: { label: 'Terminado, abierta en SAP', fg: C.azul, bg: C.azulBg, ayuda: 'Se terminó en la app pero la orden sigue abierta en SAP: pedir el cierre.' },
}

export const refOrden = (r) => (r.orden ? `Orden ${r.orden}` : `Aviso ${r.aviso}`)
