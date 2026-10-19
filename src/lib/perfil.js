// Columnas del perfil del usuario logueado (tabla usuarios). Sin select('*'):
// evita traer password_hash al cliente. Si un módulo necesita otro campo, agregarlo acá.
export const PERFIL_COLUMNAS = 'id, nombre_completo, email, rol, activo, gestiona_correctivos, ve_correctivos, ve_completar_ordenes, uso_equipos_acceso, ve_repuestos'
