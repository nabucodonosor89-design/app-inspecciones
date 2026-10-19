import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { toast } from './utils/ui'
import { useEscritorio } from './correctivos/useEscritorio'
import { C, s, LIMITE, num, ddmm, coincide, listaFamilias } from './repuestos/constantes'
import TablaMateriales from './repuestos/TablaMateriales'
import TablaFamilias from './repuestos/TablaFamilias'
import TablaPendientes from './repuestos/TablaPendientes'
import DetalleFamilia from './repuestos/DetalleFamilia'

// ============================================================
// MÓDULO REPUESTOS — kits de mantenimiento y cobertura de stock (MVP, solo lectura)
// Datos: vistas v_rep_* (ver supabase/repuestos_setup.sql). Filtros en el cliente.
// ============================================================

const CONSULTAS = {
  resumen: () => supabase.from('v_rep_resumen')
    .select('materiales_riesgo, materiales_atencion, materiales_ok, materiales_sin_consumo, familias_con_kit, equipos_sin_familia, pendientes_trabado, pendientes_en_curso, pendientes_cerrada_sin_consumo, corte_stock_ypane, ordenes_procesado_en, reservas_procesado_en')
    .limit(1),
  parametros: () => supabase.from('rep_parametros').select('clave, valor').limit(50),
  materiales: () => supabase.from('v_rep_materiales')
    .select('material, descripcion, unidad, tipo, familias, familias_lista, consumo_12m, consumo_mensual, stock_ypane, stock_total, cobertura_meses, estado')
    .limit(LIMITE),
  familias: () => supabase.from('v_rep_familias')
    .select('familia, fabricante, modelo, equipos, equipos_lista, origen_modelo, mantenimientos_historial, mantenimientos_12m, ultimo_mantenimiento, dias_entre_mantenimientos, materiales_kit, kit_en_riesgo, kit_en_atencion, peor_cobertura, mantenimientos_pendientes')
    .limit(LIMITE),
  kit: () => supabase.from('v_rep_kit')
    .select('familia, material, mantenimientos_familia, mantenimientos_con_material, porcentaje, cantidad_por_mantenimiento, consumo_familia_12m')
    .limit(LIMITE),
  pendientes: () => supabase.from('v_rep_mant_pendientes')
    .select('familia, equipo, orden, fecha_entrada, dias, status_sistema, lectura, materiales')
    .limit(LIMITE),
}
const CON_LIMITE = ['materiales', 'familias', 'kit', 'pendientes']
const VACIO = { resumen: [], parametros: [], materiales: [], familias: [], kit: [], pendientes: [] }
const DOS_DIAS = 2 * 24 * 60 * 60 * 1000
const TABS = [['materiales', 'Materiales'], ['familias', 'Familias'], ['pendientes', 'Pendientes']]

function Sello({ r, ahora }) {
  if (!r) return null
  // Stock: corte del día (a_fecha) → se compara contra el mediodía de ese día
  const items = [
    ['Stock al', r.corte_stock_ypane, r.corte_stock_ypane ? `${r.corte_stock_ypane}T12:00:00-03:00` : null],
    ['órdenes', r.ordenes_procesado_en, r.ordenes_procesado_en],
  ]
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 6px', fontSize: 12 }}>
      {items.map(([label, fecha, ref], i) => {
        const viejo = !ref || ahora - new Date(ref).getTime() > DOS_DIAS
        return (
          <span key={label} style={{ whiteSpace: 'nowrap' }}>
            {i > 0 && <span style={{ color: C.gris, marginRight: 6 }}>·</span>}
            <span style={{ color: viejo ? C.ambar : C.gris, fontWeight: viejo ? 700 : 400 }}
              title={viejo ? 'Más de 2 días sin actualizar' : undefined}>
              {label} {ddmm(fecha)}
            </span>
          </span>
        )
      })}
    </div>
  )
}

export default function ModuloRepuestos({ onVolver }) {
  const [datos, setDatos] = useState(VACIO)
  const [cargando, setCargando] = useState(true)
  const [cargadoEn, setCargadoEn] = useState(0)
  const [tab, setTab] = useState('materiales')
  const [busqueda, setBusqueda] = useState('')
  const [familiaAbierta, setFamiliaAbierta] = useState(null)
  const [avisoAbierto, setAvisoAbierto] = useState(true)
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
      toast('❌ Error al cargar repuestos: ' + e.message, 'error')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const r = datos.resumen[0]
  const diasTrabado = datos.parametros.find((p) => p.clave === 'dias_trabado')?.valor
  const limiteAlcanzado = CON_LIMITE.filter((k) => datos[k].length >= LIMITE)

  // Búsqueda global: material, descripción, familia, equipo
  const f = useMemo(() => {
    const q = busqueda.trim()
    if (!q) return { materiales: datos.materiales, familias: datos.familias, pendientes: datos.pendientes }
    const famPorEquipo = new Set(datos.familias.filter((x) => coincide(q, x.familia, x.equipos_lista)).map((x) => x.familia))
    return {
      materiales: datos.materiales.filter((m) => coincide(q, m.material, m.descripcion)
        || listaFamilias(m.familias_lista).some((fam) => famPorEquipo.has(fam))),
      familias: datos.familias.filter((x) => famPorEquipo.has(x.familia)
        || datos.kit.some((k) => k.familia === x.familia && coincide(q, k.material))),
      pendientes: datos.pendientes.filter((p) => coincide(q, p.equipo, p.familia, p.orden, p.materiales)),
    }
  }, [datos, busqueda])

  const cerrarDetalle = useCallback(() => setFamiliaAbierta(null), [])

  return (
    <div style={{ minHeight: '100vh', background: C.fondo }}>
      <div style={s.wrap}>
        <div style={s.header}>
          <button style={s.boton} onClick={onVolver} aria-label="Volver">←</button>
          <div style={{ flex: 1, minWidth: 180 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Repuestos</h2>
            <Sello r={r} ahora={cargadoEn} />
          </div>
          <button style={{ ...s.boton, color: C.azul, fontWeight: 600 }} onClick={cargar} disabled={cargando}>
            {cargando ? 'Cargando…' : '↻ Refrescar'}
          </button>
        </div>

        <div style={{ ...s.aviso, display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}
          onClick={() => setAvisoAbierto((v) => !v)} role="button" aria-expanded={avisoAbierto}>
          <span>⚠</span>
          <span style={{ flex: 1 }}>
            {avisoAbierto
              ? 'Un mismo repuesto puede tener varios códigos en SAP. Un material puede figurar en riesgo y tener stock bajo otro código.'
              : 'Códigos duplicados en SAP'}
          </span>
          <span style={{ fontSize: 12 }}>{avisoAbierto ? '▲' : '▼'}</span>
        </div>

        {/* Fija solo en escritorio: en celular ocuparía media pantalla */}
        <div style={{ ...s.barra, position: escritorio ? 'sticky' : 'static' }}>
          <div style={s.tabs}>
            {TABS.map(([id, label]) => {
              const n = id === 'materiales' ? r && r.materiales_riesgo + r.materiales_atencion
                : id === 'familias' ? r?.familias_con_kit : r?.pendientes_trabado
              return (
                <button key={id} style={s.tab(tab === id)} onClick={() => setTab(id)}>
                  {label}{n != null ? ` · ${num(n, 0)}` : ''}
                </button>
              )
            })}
          </div>
          <input style={s.input} placeholder="Buscar material, descripción, familia o equipo…" value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)} />
          <div style={{ ...s.meta, fontSize: 11, marginTop: 4 }}>
            Contadores de pestañas: materiales en riesgo + atención · familias con kit · mantenimientos trabados.
          </div>
        </div>

        {limiteAlcanzado.length > 0 && (
          <div style={s.aviso}>⚠ Mostrando las primeras {num(LIMITE, 0)} filas en: {limiteAlcanzado.join(', ')}.</div>
        )}

        {cargando && !r ? <div style={s.vacio}>⏳ Cargando…</div> : (
          <>
            {tab === 'materiales' && <TablaMateriales filas={f.materiales} onFamilia={setFamiliaAbierta} />}
            {tab === 'familias' && (
              <TablaFamilias filas={f.familias} equiposSinFamilia={r?.equipos_sin_familia} onFamilia={setFamiliaAbierta} />
            )}
            {tab === 'pendientes' && (
              <TablaPendientes filas={f.pendientes} onFamilia={setFamiliaAbierta} diasTrabado={diasTrabado} />
            )}
          </>
        )}
      </div>

      {familiaAbierta && (
        <DetalleFamilia familia={familiaAbierta} familias={datos.familias} kit={datos.kit}
          materiales={datos.materiales} pendientes={datos.pendientes} onCerrar={cerrarDetalle} />
      )}
    </div>
  )
}
