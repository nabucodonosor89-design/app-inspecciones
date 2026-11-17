// Lógica del Tablero de despacho (v1). Funciones puras: sin React ni Supabase.
// Todo se calcula en el cliente con lo cargado para la semana (o el día) visible.
import { TIPOS_CAMION, fmtDiaCorto, tipoLabel, unirY } from './constantes'

export const SIN_TIPO = '__sin_tipo'

/** Un encargo abierto que nunca tuvo camión. */
export const sinCamion = (e) => e.estado === 'abierto' && Number(e.n_asignaciones) === 0

/** Clave de destino (la vista ya la trae; fallback por si falta). */
export const destinoKey = (e) => e.destino_key ||
  (e.destino_obra_id ? `obra:${e.destino_obra_id}` : `lugar:${e.destino_lugar_id}`)

/** Asignaciones + copias indexadas por camión y día: `${equipo_id}|${dia}` → [items]. */
export function mapaOcupacion(asignaciones, copias) {
  const m = new Map()
  const push = (k, a) => { if (!m.has(k)) m.set(k, []); m.get(k).push(a) }
  asignaciones.forEach(a => push(`${a.equipo_id}|${a.fecha}`, a))
  copias.forEach(a => push(`${a.equipo_id}|${a.dia}`, a))
  return m
}

export const ocupado = (ocup, equipoId, dia) => ocup.has(`${equipoId}|${dia}`)

/** Camiones libres por día: { dia: [camion] }. */
export function libresPorDia(camiones, ocup, dias) {
  return Object.fromEntries(dias.map(d => [d, camiones.filter(c => !ocupado(ocup, c.id, d))]))
}

/** Tipos presentes en la flota, en el orden de TIPOS_CAMION; "Sin clasificar" al final si hay. */
export function tiposPresentes(camiones) {
  const presentes = Object.keys(TIPOS_CAMION).filter(t => camiones.some(c => c.tipo_camion === t))
  if (camiones.some(c => !c.tipo_camion)) presentes.push(SIN_TIPO)
  return presentes
}

export const camionesDeTipo = (camiones, tipo) =>
  camiones.filter(c => (tipo === SIN_TIPO ? !c.tipo_camion : c.tipo_camion === tipo))

/** Camión-días ocupados sobre el total (camiones × días). */
export function ocupacionFlota(camiones, ocup, dias) {
  let ocupados = 0
  camiones.forEach(c => dias.forEach(d => { if (ocupado(ocup, c.id, d)) ocupados++ }))
  return { ocupados, total: camiones.length * dias.length }
}

/** El tipo de camión con mayor ocupación (solo camiones clasificados). null si ninguno tiene tipo. */
export function tipoMasExigido(camiones, ocup, dias) {
  let mejor = null
  Object.keys(TIPOS_CAMION).forEach(t => {
    const lista = camiones.filter(c => c.tipo_camion === t)
    if (!lista.length) return
    const { ocupados, total } = ocupacionFlota(lista, ocup, dias)
    const ratio = ocupados / total
    if (!mejor || ratio > mejor.ratio) mejor = { tipo: t, ocupados, total, n: lista.length, ratio }
  })
  return mejor
}

/**
 * Huecos: encargos sin camión con fecha requerida, ubicados en la grilla.
 * - vencido y la semana incluye hoy → en hoy (rojo)
 * - dentro de la semana y ≥ hoy → en su día (naranja)
 * - sin fecha o fuera de la semana → no van (solo panel)
 */
export function huecosSemana(encargosAbiertos, dias, hoy) {
  const res = []
  encargosAbiertos.forEach(e => {
    if (!sinCamion(e) || !e.fecha_requerida) return
    if (e.fecha_requerida < hoy) {
      if (dias.includes(hoy)) res.push({ encargo: e, dia: hoy, vencido: true })
    } else if (dias.includes(e.fecha_requerida)) {
      res.push({ encargo: e, dia: e.fecha_requerida, vencido: false })
    }
  })
  return res
}

/** Panel "Por asignar": sin asignar + atrasados sin ninguna planificada con fecha ≥ hoy. */
export function porAsignar(encargosAbiertos) {
  return encargosAbiertos
    .filter(e => e.subestado === 'sin_asignar' ||
      (e.subestado === 'atrasado' && Number(e.n_planificadas) - Number(e.n_atrasadas) === 0))
    .sort((a, b) => {
      const aa = a.subestado === 'atrasado' ? 0 : 1
      const bb = b.subestado === 'atrasado' ? 0 : 1
      if (aa !== bb) return aa - bb
      if (a.fecha_requerida && b.fecha_requerida) return a.fecha_requerida.localeCompare(b.fecha_requerida)
      if (a.fecha_requerida) return -1
      if (b.fecha_requerida) return 1
      return (a.created_at || '').localeCompare(b.created_at || '')
    })
}

/** Saldo pendiente de un encargo con cantidad (lo que falta entregar). */
export const saldo = (e) => e.cantidad == null ? null
  : Number(e.cantidad) - Number(e.cantidad_confirmada || 0) - Number(e.cantidad_sin_confirmar || 0)

/** "Con saldo por mover": en curso, con cantidad, sin viajes planificados (hoy o después). */
export function conSaldo(encargosAbiertos) {
  return encargosAbiertos.filter(e => e.subestado === 'en_curso' && e.cantidad != null
    && Number(e.n_planificadas) === 0 && saldo(e) > 0)
}

const diaLabel = (d, hoy) => (d === hoy ? `hoy ${fmtDiaCorto(d)}` : fmtDiaCorto(d))

/**
 * Sugerencias para asignar un encargo, solo con datos de la semana visible (desde max(hoy, lunes)).
 * Devuelve { lineas: [{ texto, color }], primeraFecha, camionLibreHoy }.
 */
export function sugerencias(e, { dias, hoy, camiones, ocup, asignaciones, encargos }) {
  const utiles = dias.filter(d => d >= hoy)
  const lineas = []
  const req = e.tipo_camion_requerido || null
  const candidatos = req ? camiones.filter(c => c.tipo_camion === req) : camiones
  const libres = utiles.map(d => ({ d, lista: candidatos.filter(c => !ocupado(ocup, c.id, d)) }))
    .filter(x => x.lista.length > 0)

  let primeraFecha = null
  if (utiles.length) {
    if (req && candidatos.length === 0) {
      lineas.push({ texto: `Ningún camión clasificado como ${tipoLabel(req).toLowerCase()}`, color: '#b91c1c' })
    } else if (!libres.length) {
      lineas.push({ texto: req ? `Sin ${tipoLabel(req).toLowerCase()} libre esta semana` : 'Sin camiones libres esta semana', color: '#b91c1c' })
    } else if (req) {
      lineas.push({ texto: `${tipoLabel(req)} libre ${unirY(libres.slice(0, 3).map(x => diaLabel(x.d, hoy)))}`, color: '#166534' })
    } else {
      const x = libres[0]
      lineas.push({ texto: `${x.lista.length} ${x.lista.length > 1 ? 'camiones' : 'camión'} libre${x.lista.length > 1 ? 's' : ''} ${x.d === hoy ? 'hoy' : 'el'} ${fmtDiaCorto(x.d)}`, color: '#166534' })
    }
    primeraFecha = libres[0]?.d || null
  }

  // Ya hay viajes planificados al mismo destino en la semana: solo informa (no hay datos de capacidad)
  const clave = destinoKey(e)
  const mismos = asignaciones
    .filter(a => a.estado === 'planificada' && a.fecha >= hoy && a.encargo_id !== e.id
      && encargos[a.encargo_id] && destinoKey(encargos[a.encargo_id]) === clave)
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
  if (mismos.length) {
    const a = mismos[0]
    const camion = a.equipo?.numero_identificacion || camiones.find(c => c.id === a.equipo_id)?.numero_identificacion || '¿camión?'
    lineas.push({
      texto: `Ya va a ${e.destino_nombre} el ${fmtDiaCorto(a.fecha)} con ${camion}${mismos.length > 1 ? ` (y ${mismos.length - 1} viaje${mismos.length > 2 ? 's' : ''} más)` : ''}`,
      color: '#1e40af',
    })
  }

  const libreHoy = req && utiles.includes(hoy) ? candidatos.find(c => !ocupado(ocup, c.id, hoy)) || null : null
  return { lineas, primeraFecha, camionLibreHoy: libreHoy }
}

/** Saca palabras genéricas del principio para que entre en una celda ("Complejo Ypané" → "Ypané"). */
export function nombreCorto(nombre) {
  if (!nombre) return '¿?'
  const partes = nombre.trim().split(/\s+/)
  const genericas = ['complejo', 'planta', 'obra', 'depósito', 'deposito', 'base']
  const sinGenerica = partes.length > 1 && genericas.includes(partes[0].toLowerCase()) ? partes.slice(1) : partes
  const corto = sinGenerica.join(' ')
  // Si sigue siendo largo para una celda, la última palabra suele ser el lugar ("Prefabricados Villeta" → "Villeta")
  return corto.length > 14 && sinGenerica.length > 1 ? sinGenerica[sinGenerica.length - 1] : corto
}

const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
function diaLargo(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return DIAS_LARGOS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

/** Resumen de la fila de un frente: "3 movimientos el vie · 1 encargo sin camión". */
export function resumenFila({ porDia, huecos, noCumplidas }) {
  const partes = []
  if (noCumplidas > 0) partes.push(`${noCumplidas} viaje${noCumplidas > 1 ? 's' : ''} no cumplido${noCumplidas > 1 ? 's' : ''}`)
  if (huecos > 0) partes.push(`${huecos} encargo${huecos > 1 ? 's' : ''} sin camión`)
  const dias = Object.entries(porDia)
  const total = dias.reduce((s, [, n]) => s + n, 0)
  if (total > 0) {
    const [dMax, nMax] = dias.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
    partes.push(nMax >= 2 ? `${nMax} movimientos el ${diaLargo(dMax)}` : `${total} movimiento${total > 1 ? 's' : ''} en la semana`)
  }
  return partes.join(' · ')
}
