import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from './lib/supabase'
import { toast } from './utils/ui'
import { C, s, TIPOS, LIMITE, num, coincide } from './correctivos/constantes'
import SelloFrescura from './correctivos/SelloFrescura'
import Resumen from './correctivos/Resumen'
import TablaYpane from './correctivos/TablaYpane'
import TablaEmpresa from './correctivos/TablaEmpresa'
import TablaMateriales from './correctivos/TablaMateriales'
import Reunion from './correctivos/Reunion'
import { useEscritorio } from './correctivos/useEscritorio'

// ============================================================
// MÓDULO CORRECTIVOS — tablero de solo lectura (App + SAP)
// Datos: vistas v_corr_* (ver supabase/correctivos_setup.sql)
// ============================================================

const CONSULTAS = {
  frescura: () => supabase.from('v_corr_frescura')
    .select('ie36, trabajo, reservas, stock, corte_stock_1002, ultima_sync, ultima_sync_dry_run').limit(1),
  kpis: () => supabase.from('v_corr_kpis')
    .select('sap_abiertas, sap_en_app, sap_solo_sap, sap_solo_sap_10d, sap_sin_equipo, equipos_multi_orden, ordenes_multi_orden, tipo_v, tipo_p, tipo_m, tipo_b, tipo_s, yp_en_taller, yp_en_espera, yp_en_reparacion, yp_terceros, yp_criticos, yp_sin_orden, yp_sin_pedido, yp_urgentes, inc_total, mat_bloqueo, mat_parcial, mat_despacho, mttr_90d, mttr_cierres, mttr_outliers, sap_cierre_candidatas, sap_verificar, sap_completar_equipo').limit(1),
  ypane: () => supabase.from('v_corr_ypane')
    .select('id, equipo, denominacion, tipo, es_critico, numero_aviso, numero_orden, orden_cruzada, prioridad, estado_label, pedido, taller_tipo, taller, descripcion_averia, dias_taller, status_sap, orden_abierta').limit(LIMITE),
  abiertas: () => supabase.from('v_corr_sap_abiertas')
    .select('orden, aviso, equipo, denominacion, tipo, ubicacion, texto, status_usuario, fecha_entrada, dias_abierta, en_app, ev_horas_30d, ev_km_30d, ev_orden_posterior, ev_insp_verde, accion').limit(LIMITE),
  inconsistencias: () => supabase.from('v_corr_inconsistencias')
    .select('id, equipo, denominacion, tipo, taller, numero_aviso, numero_orden, orden_cruzada, dias_taller, motivo').limit(LIMITE),
  duplicados: () => supabase.from('v_corr_duplicados')
    .select('equipo, denominacion, tipo, aviso, orden, ubicacion, dias, status, origen, cantidad').limit(LIMITE),
  materiales: () => supabase.from('v_corr_materiales')
    .select('equipo, orden, posicion, origen, taller_o_ubicacion, es_critico, dias, material, descripcion, cantidad_pendiente, unidad, centro, stock_centro, cantidad_cubierta, cantidad_faltante, situacion, texto_orden, aviso, denominacion').limit(LIMITE),
  outliers: () => supabase.from('v_corr_mttr_outliers').select('equipo, taller, ingreso, liberacion, dias').limit(LIMITE),
  cambios: () => supabase.from('v_corr_cambios')
    .select('id, ejecutado_en, dry_run, regla, equipo, campo, valor_anterior, valor_nuevo, resultado, detalle')
    .order('id', { ascending: false }).limit(500),
}

const VACIO = { frescura: [], kpis: [], ypane: [], abiertas: [], inconsistencias: [], duplicados: [], materiales: [], outliers: [], cambios: [] }

export default function ModuloCorrectivos({ onVolver }) {
  const [datos, setDatos] = useState(VACIO)
  const [cargando, setCargando] = useState(true)
  const [tab, setTab] = useState('resumen')
  const [tipos, setTipos] = useState([]) // vacío = todos
  const [busqueda, setBusqueda] = useState('')
  const [cargadoEn, setCargadoEn] = useState(0)
  const escritorio = useEscritorio()

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const claves = Object.keys(CONSULTAS)
      const res = await Promise.all(claves.map((k) => CONSULTAS[k]()))
      const nuevo = {}
      res.forEach((r, i) => {
        if (r.error) throw new Error(`${claves[i]}: ${r.error.message}`)
        nuevo[claves[i]] = r.data || []
      })
      setDatos(nuevo)
      setCargadoEn(Date.now())
    } catch (e) {
      console.error(e)
      toast('❌ Error al cargar correctivos: ' + e.message, 'error')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const k = datos.kpis[0]
  const limiteAlcanzado = ['ypane', 'abiertas', 'inconsistencias', 'duplicados', 'materiales', 'outliers']
    .filter((c) => datos[c].length >= LIMITE)

  // Tipo por equipo (para filtrar materiales, que no traen el tipo)
  const tipoPorEquipo = useMemo(() => {
    const m = new Map()
    datos.abiertas.forEach((r) => r.equipo && m.set(r.equipo, r.tipo))
    datos.ypane.forEach((r) => r.equipo && m.set(r.equipo, r.tipo))
    return m
  }, [datos])

  // Filtros de tipo + búsqueda, en el cliente
  const f = useMemo(() => {
    const okTipo = (t) => !tipos.length || tipos.includes(t || 'S')
    const q = busqueda.trim()
    return {
      ypane: datos.ypane.filter((r) => okTipo(r.tipo) && coincide(q, r.equipo, r.denominacion, r.numero_aviso, r.numero_orden, r.orden_cruzada, r.descripcion_averia, r.taller)),
      abiertas: datos.abiertas.filter((r) => okTipo(r.tipo) && coincide(q, r.equipo, r.denominacion, r.aviso, r.orden, r.texto, r.ubicacion)),
      inconsistencias: datos.inconsistencias.filter((r) => okTipo(r.tipo) && coincide(q, r.equipo, r.denominacion, r.numero_aviso, r.numero_orden, r.taller)),
      duplicados: datos.duplicados.filter((r) => okTipo(r.tipo) && coincide(q, r.equipo, r.denominacion, r.aviso, r.orden, r.ubicacion)),
      materiales: datos.materiales.filter((r) => {
        if (tipos.length) {
          const t = tipoPorEquipo.get(r.equipo) || 'S'
          if (!tipos.includes(t)) return false
        }
        return coincide(q, r.equipo, r.orden, r.aviso, r.material, r.descripcion, r.taller_o_ubicacion, r.texto_orden)
      }),
    }
  }, [datos, tipos, busqueda, tipoPorEquipo])

  const filtrando = tipos.length > 0 || busqueda.trim() !== ''
  const contadorTipo = (t) => (k ? k[`tipo_${t.toLowerCase()}`] : 0)
  const toggleTipo = (t) => setTipos((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))

  return (
    <div style={{ minHeight: '100vh', background: C.fondo }}>
      <div style={s.wrap}>
        <div style={s.header}>
          <button style={s.boton} onClick={onVolver} aria-label="Volver">←</button>
          <div style={{ flex: 1, minWidth: 180 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Correctivos</h2>
            <SelloFrescura f={datos.frescura[0]} ahora={cargadoEn} />
          </div>
          <button style={{ ...s.boton, color: C.azul, fontWeight: 600 }} onClick={cargar} disabled={cargando}>
            {cargando ? 'Cargando…' : '↻ Refrescar'}
          </button>
        </div>

        {/* Fija solo en escritorio: en celular ocuparía media pantalla */}
        <div style={{ ...s.barra, position: escritorio ? 'sticky' : 'static' }}>
          <div style={s.tabs}>
            {[['resumen', 'Resumen'], ['ypane', 'Ypané'], ['empresa', 'Empresa'], ['materiales', 'Materiales'], ['reunion', 'Reunión']].map(([id, label]) => (
              <button key={id} style={s.tab(tab === id)} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {tab !== 'reunion' && (<>
          <div style={s.chips}>
            <button style={s.chipBtn(!tipos.length)} onClick={() => setTipos([])}>Todos · {num(k?.sap_abiertas)}</button>
            {TIPOS.map((t) => (
              <button key={t.id} style={s.chipBtn(tipos.includes(t.id))} onClick={() => toggleTipo(t.id)} title={t.label}>
                {t.label} · {num(contadorTipo(t.id))}
              </button>
            ))}
          </div>
          <input style={s.input} placeholder="Buscar equipo, aviso, orden o texto…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          <div style={{ ...s.meta, fontSize: 11, marginTop: 4 }}>Contadores: órdenes correctivas SAP abiertas por tipo de equipo.</div>
          </>)}
        </div>

        {tab !== 'reunion' && limiteAlcanzado.length > 0 && (
          <div style={s.aviso}>⚠ Mostrando las primeras {num(LIMITE)} filas en: {limiteAlcanzado.join(', ')}. Los totales de los indicadores siguen siendo completos.</div>
        )}

        {tab === 'reunion' ? <Reunion recarga={cargadoEn} /> : cargando && !k ? <div style={s.vacio}>⏳ Cargando…</div> : (
          <>
            {tab === 'resumen' && (
              <Resumen k={k} ypane={f.ypane} inconsistencias={f.inconsistencias} duplicados={f.duplicados}
                outliers={datos.outliers} cambios={datos.cambios} abiertas={f.abiertas} materiales={f.materiales} filtrando={filtrando} />
            )}
            {tab === 'ypane' && <TablaYpane filas={f.ypane} />}
            {tab === 'empresa' && <TablaEmpresa abiertas={f.abiertas} />}
            {tab === 'materiales' && <TablaMateriales filas={f.materiales} />}
          </>
        )}
      </div>
    </div>
  )
}
