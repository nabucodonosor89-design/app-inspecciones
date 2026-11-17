import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../utils/ui'
import { COLS_ASIG, COLS_CAMION, COLS_ENCARGO } from './datos'
import { hoyPY, sumarDias } from './constantes'

/**
 * Asignaciones en un rango de fechas + los encargos a los que pertenecen.
 * Además arma las copias visuales de las planificadas atrasadas: una por cada día
 * desde fecha + 1 hasta hoy, dentro del rango. No son registros: { ...asignacion, copia: true, dia }.
 */
export function useAsignacionesRango(desde, hasta, version) {
  const [asignaciones, setAsignaciones] = useState([])
  const [copias, setCopias] = useState([])
  const [encargos, setEncargos] = useState({})
  const [cargando, setCargando] = useState(true)
  const [recarga, setRecarga] = useState(0)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const hoy = hoyPY()
      const tope = hasta < hoy ? hasta : hoy // las copias nunca van más allá de hoy
      const consultas = [supabase.from('asignaciones').select(COLS_ASIG)
        .gte('fecha', desde).lte('fecha', hasta).order('fecha').limit(1000)]
      if (desde <= hoy) {
        consultas.push(supabase.from('asignaciones').select(COLS_ASIG)
          .eq('estado', 'planificada').lt('fecha', tope).order('fecha').limit(500))
      }
      const [r1, r2] = await Promise.all(consultas)
      if (!vivo) return
      const error = r1.error || r2?.error
      if (error) { toast('❌ ' + error.message); setCargando(false); return }
      const data = r1.data
      const nuevasCopias = []
      ;(r2?.data || []).forEach(p => {
        let d = sumarDias(p.fecha, 1)
        if (d < desde) d = desde
        for (; d <= tope; d = sumarDias(d, 1)) nuevasCopias.push({ ...p, copia: true, dia: d })
      })
      const ids = [...new Set([...data, ...nuevasCopias].map(a => a.encargo_id))]
      let mapa = {}
      if (ids.length) {
        const r = await supabase.from('v_encargos').select(COLS_ENCARGO).in('id', ids).limit(1000)
        if (r.error) toast('❌ ' + r.error.message)
        mapa = Object.fromEntries((r.data || []).map(e => [e.id, e]))
      }
      if (!vivo) return
      setAsignaciones(data); setCopias(nuevasCopias); setEncargos(mapa); setCargando(false)
    })()
    return () => { vivo = false }
  }, [desde, hasta, version, recarga])
  return { asignaciones, copias, encargos, cargando, recargar: () => setRecarga(r => r + 1) }
}

/** Camiones de logística, releídos al entrar (por si se marcaron nuevos en Gestión de Equipos). */
export function useCamiones(inicial, recarga) {
  const [camiones, setCamiones] = useState(inicial)
  useEffect(() => {
    let vivo = true
    supabase.from('equipos')
      .select(COLS_CAMION)
      .eq('es_logistica', true).eq('activo', true).order('numero_identificacion').limit(200)
      .then(({ data, error }) => { if (vivo && !error && data) setCamiones(data) })
    return () => { vivo = false }
  }, [recarga])
  return camiones
}

/** Todos los encargos abiertos (base del panel, huecos e indicadores). */
export function useEncargosAbiertos(recarga) {
  const [lista, setLista] = useState([])
  useEffect(() => {
    let vivo = true
    supabase.from('v_encargos').select(COLS_ENCARGO)
      .eq('estado', 'abierto')
      .order('fecha_requerida', { ascending: true, nullsFirst: false }).order('created_at')
      .limit(500)
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) { toast('❌ ' + error.message); return }
        setLista(data)
      })
    return () => { vivo = false }
  }, [recarga])
  return lista
}
