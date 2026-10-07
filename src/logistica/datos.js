import { supabase } from '../lib/supabase'

/** Catálogos que usa todo el módulo. Se cargan una vez al entrar. */
export async function cargarCatalogos() {
  const [obras, lugares, camiones, operadores] = await Promise.all([
    supabase.from('obras').select('id, codigo_obra, nombre_obra').eq('activa', true).order('nombre_obra').limit(500),
    supabase.from('lugares').select('id, nombre, tipo').eq('activo', true).order('nombre').limit(500),
    supabase.from('equipos')
      .select('id, numero_identificacion, denominacion, operador_asignado_id')
      .eq('es_logistica', true).eq('activo', true)
      .order('numero_identificacion').limit(200),
    supabase.from('operadores').select('id, nombres, apellidos').eq('estado', 'activo').order('nombres').limit(1000),
  ])
  const err = obras.error || lugares.error || camiones.error || operadores.error
  if (err) throw err
  return {
    obras: obras.data,
    lugares: lugares.data,
    camiones: camiones.data,
    operadores: operadores.data,
  }
}

export const COLS_ENCARGO = [
  'id', 'descripcion', 'cantidad', 'unidad', 'fecha_requerida', 'notas', 'estado', 'motivo_cancelacion',
  'created_at', 'cerrado_at', 'origen_lugar_id', 'origen_obra_id', 'destino_lugar_id', 'destino_obra_id',
  'origen_nombre', 'origen_tipo', 'destino_nombre', 'destino_tipo', 'creado_por_nombre', 'cerrado_por_nombre',
  'n_asignaciones', 'n_planificadas', 'n_entregadas', 'n_confirmadas', 'n_atrasadas',
  'cantidad_confirmada', 'cantidad_sin_confirmar', 'proxima_fecha', 'subestado',
].join(', ')

export const COLS_ASIG = 'id, encargo_id, fecha, equipo_id, operador_id, estado, cantidad_real, notas, entregada_at, confirmada_at, equipo:equipos(numero_identificacion)'

/** Clave de ruta para saber si dos encargos van al mismo destino. */
export const claveDestino = (e) => e.destino_obra_id ? `o:${e.destino_obra_id}` : `l:${e.destino_lugar_id}`

/** Acepta una asignación (usa el equipo embebido) o un equipo_id (busca en el catálogo). */
export const nombreCamion = (camiones, x) => {
  if (x && typeof x === 'object') {
    return x.equipo?.numero_identificacion || camiones.find(c => c.id === x.equipo_id)?.numero_identificacion || '¿camión?'
  }
  return camiones.find(c => c.id === x)?.numero_identificacion || '¿camión?'
}

export const nombreOperador = (operadores, id) => {
  const o = operadores.find(x => x.id === id)
  return o ? `${o.nombres} ${o.apellidos || ''}`.trim() : null
}
