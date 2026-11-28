// Texto del parte del día del residente (formato de los mensajes de WhatsApp que mandaban a mano).
// Ver ParteDelDia.jsx y supabase/correctivos_parte_residentes.sql

const escaparRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Saca el ID técnico (y su versión corta, ej. CT028 de VP-CT028) de un texto de SAP,
// y el nombre de la obra al principio (ej. «PARACEL CT028 PROBLEMA DE MUÑEQUIN»)
function limpiar(texto, equipo, obra) {
  let t = (texto || '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  if (obra) t = t.replace(new RegExp(`^${escaparRe(obra)}(?=\\s)`, 'i'), '')
  if (equipo) {
    const corto = equipo.includes('-') ? equipo.split('-').slice(1).join('-') : null
    for (const id of [equipo, equipo.replace('-', '.'), corto].filter(Boolean)) {
      t = t.replace(new RegExp(`(^|[\\s,.;:-])${escaparRe(id)}(?=$|[\\s,.;:])`, 'gi'), '$1')
    }
  }
  t = t.replace(/\s+/g, ' ').replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '').trim()
  // Textos de SAP en mayúsculas → minúsculas, como escriben los residentes
  if (t && t === t.toUpperCase()) t = t.toLowerCase()
  return t
}

export function armarParte(datos) {
  const obra = (datos?.encabezado || '—').toUpperCase()
  const items = datos?.items || []
  if (!items.length) return `Buenos días, sin equipos con problemas mecánicos en Obra ${obra}.`
  const lineas = items.map((i, k) => {
    const den = limpiar(i.denominacion, i.equipo)
    const desc = limpiar(i.descripcion, i.equipo, datos?.encabezado)
    const ref = i.orden
      ? `orden ${i.orden}`
      : i.aviso
        ? `aviso ${i.aviso}${i.dias_sin_orden > 0 ? `, sin orden hace ${i.dias_sin_orden} d` : ''}`
        : 'sin aviso'
    const nov = (i.ultima_novedad_texto || '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '')
    const partes = [`${i.equipo}${den ? ` ${den}` : ''}`, desc, ref].filter(Boolean).join(', ')
    return `${k + 1}. ${partes}${nov ? ` (${nov})` : ''}.`
  })
  return [`Buenos días, adjunto listado de equipos con problemas mecánicos en Obra ${obra}.`, ...lineas].join('\n')
}
