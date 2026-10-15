import { useEffect, useState, useCallback } from 'react'
import { supabase } from './lib/supabase'
import { toast, confirmar } from './utils/ui'

// ============================================================
// Mantenimientos de un equipo (Gestión de Equipos) — solo usuarios con ve_completar_ordenes
// Carga manual del último mantenimiento con los datos de cierre de la orden preventiva
// (solo contador y fecha) + historial (inspección y manual). Los manuales se anulan, no se borran.
// RPC: services_de_equipo / registrar_service / anular_service (ver supabase/services_equipo.sql)
// Período de mantenimiento del equipo: mantenimiento_periodo / fijar_periodo_mantenimiento (ver supabase/periodo_mantenimiento.sql)
// ============================================================

const hoyISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const fechaCorta = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—')
const num = (v) => (v == null ? '—' : Number(v).toLocaleString('es-PY', { maximumFractionDigits: 1 }))

export default function ServicesEquipoModal({ equipo, onCerrar }) {
  const [lista, setLista] = useState([])
  const [cargando, setCargando] = useState(true)
  const [fecha, setFecha] = useState('')
  const [contador, setContador] = useState('')
  const [guardando, setGuardando] = useState(false)
  // Período de mantenimiento (cada cuántas horas o km)
  const [periodo, setPeriodo] = useState(null)          // { periodo, unidad, actualizado_en, actualizado_por } guardado
  const [perValor, setPerValor] = useState('')
  const [perUnidad, setPerUnidad] = useState('h')
  const [guardandoPer, setGuardandoPer] = useState(false)

  const aplicar = useCallback(({ data, error }) => {
    if (error) toast('❌ Error al cargar mantenimientos: ' + error.message, 'error')
    setLista(data || [])
    setCargando(false)
  }, [])
  const cargar = useCallback(
    () => supabase.rpc('services_de_equipo', { p_equipo_id: equipo.id }).then(aplicar),
    [equipo.id, aplicar])
  useEffect(() => {
    supabase.rpc('services_de_equipo', { p_equipo_id: equipo.id }).then(aplicar)
  }, [equipo.id, aplicar])

  const aplicarPeriodo = useCallback(({ data, error }) => {
    if (error) { toast('❌ Error al cargar el período: ' + error.message, 'error'); return }
    const p = (data || [])[0] || null
    setPeriodo(p)
    setPerValor(p?.periodo != null ? String(p.periodo) : '')
    setPerUnidad(p?.unidad || 'h')
  }, [])
  useEffect(() => {
    supabase.rpc('mantenimiento_periodo', { p_equipo_id: equipo.id }).then(aplicarPeriodo)
  }, [equipo.id, aplicarPeriodo])

  const perNum = perValor === '' ? null : Number(perValor)
  const perError = perNum !== null && (!Number.isFinite(perNum) || perNum <= 0) ? 'El período tiene que ser un número mayor a 0' : null
  const perCambio = (perNum ?? null) !== (periodo?.periodo != null ? Number(periodo.periodo) : null) ||
    (perNum !== null && perUnidad !== (periodo?.unidad || 'h'))

  async function guardarPeriodo() {
    if (perError || !perCambio) return
    if (perNum === null && !(await confirmar('¿Quitar el período de mantenimiento de este equipo?'))) return
    setGuardandoPer(true)
    const { error: e } = await supabase.rpc('fijar_periodo_mantenimiento', { p_equipo_id: equipo.id, p_periodo: perNum, p_unidad: perNum === null ? null : perUnidad })
    setGuardandoPer(false)
    if (e) { toast('❌ ' + e.message, 'error'); return }
    toast('✅ Período de mantenimiento guardado', 'success')
    supabase.rpc('mantenimiento_periodo', { p_equipo_id: equipo.id }).then(aplicarPeriodo)
  }

  const error = (() => {
    if (!fecha || contador === '') return 'Completá la fecha y el contador'
    const c = Number(contador)
    if (!Number.isFinite(c) || c < 0) return 'El contador no es un número válido'
    if (fecha > hoyISO()) return 'La fecha no puede ser futura'
    return null
  })()

  async function guardar() {
    if (error) return
    const c = Number(contador)
    // Contador menor que el de un mantenimiento anterior (más viejo): puede ser error de tipeo o cambio de horómetro
    const anterior = lista.find((s) => s.fecha <= fecha)
    if (anterior && c < Number(anterior.contador)) {
      const ok = await confirmar(`El contador (${num(c)}) es menor que el del mantenimiento del ${fechaCorta(anterior.fecha)} (${num(anterior.contador)}). ¿Lo guardo igual? (por ejemplo, si cambiaron el horómetro)`)
      if (!ok) return
    }
    setGuardando(true)
    const { error: e } = await supabase.rpc('registrar_service', { p_equipo_id: equipo.id, p_fecha: fecha, p_contador: c })
    setGuardando(false)
    if (e) { toast('❌ ' + e.message, 'error'); return }
    toast('✅ Mantenimiento registrado correctamente', 'success')
    setFecha(''); setContador('')
    cargar()
  }

  async function anular(s) {
    const ok = await confirmar(`¿Anular el mantenimiento del ${fechaCorta(s.fecha)} (${num(s.contador)})? Deja de contar como último mantenimiento.`)
    if (!ok) return
    const { error: e } = await supabase.rpc('anular_service', { p_id: s.id })
    if (e) { toast('❌ ' + e.message, 'error'); return }
    toast('✅ Mantenimiento anulado', 'success')
    cargar()
  }

  const input = { width: '100%', padding: '0.6rem', border: '2px solid #e5e7eb', borderRadius: '8px', fontSize: '1rem', boxSizing: 'border-box', marginTop: '0.25rem' }

  return (
    <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 1000 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: '12px', width: '100%', maxWidth: '560px', maxHeight: '90vh', overflow: 'auto', padding: '1.25rem', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.2rem' }}>🔧 Mantenimientos · {equipo.numero_identificacion}</h3>
            {equipo.denominacion && <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>{equipo.denominacion}</div>}
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ border: 'none', background: '#f3f4f6', borderRadius: '8px', padding: '0.4rem 0.7rem', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: '10px', padding: '0.9rem', marginBottom: '1rem' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem', fontSize: '0.9rem' }}>Período de mantenimiento</div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.5rem' }}>
            Cada cuántas horas o km se hace el preventivo. Si es por horas, el contador (ficha y carga de combustible) también tiene que ser en horas.
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="number" inputMode="decimal" min="0" value={perValor} onChange={(e) => setPerValor(e.target.value)} placeholder="Ej: 250"
              style={{ ...input, marginTop: 0, flex: '1 1 120px', width: 'auto' }} />
            <div style={{ display: 'flex', border: '2px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
              {[['h', 'horas'], ['km', 'km']].map(([k, l]) => (
                <button key={k} onClick={() => setPerUnidad(k)}
                  style={{ border: 'none', padding: '0.55rem 0.9rem', cursor: 'pointer', fontSize: '0.9rem', background: perUnidad === k ? '#7c3aed' : 'white', color: perUnidad === k ? 'white' : '#374151' }}>
                  {l}
                </button>
              ))}
            </div>
            <button onClick={guardarPeriodo} disabled={!!perError || !perCambio || guardandoPer}
              style={{ padding: '0.6rem 0.9rem', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '0.9rem',
                background: perError || !perCambio || guardandoPer ? '#e5e7eb' : '#7c3aed', color: perError || !perCambio || guardandoPer ? '#6b7280' : 'white',
                cursor: perError || !perCambio || guardandoPer ? 'not-allowed' : 'pointer' }}>
              {guardandoPer ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
          {perError && <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: '#b91c1c' }}>{perError}</div>}
          {periodo?.actualizado_en && (
            <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: '#6b7280' }}>
              Última modificación: {fechaCorta(periodo.actualizado_en)}{periodo.actualizado_por ? ` · ${periodo.actualizado_por}` : ''}
            </div>
          )}
        </div>

        <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '10px', padding: '0.9rem', marginBottom: '1rem' }}>
          <div style={{ fontWeight: 600, color: '#5b21b6', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Registrar mantenimiento (cierre de la orden preventiva)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem' }}>
            <label style={{ fontSize: '0.8rem', color: '#374151' }}>
              Fecha del mantenimiento
              <input type="date" max={hoyISO()} value={fecha} onChange={(e) => setFecha(e.target.value)} style={input} />
            </label>
            <label style={{ fontSize: '0.8rem', color: '#374151' }}>
              Contador (hs o km)
              <input type="number" inputMode="decimal" min="0" value={contador} onChange={(e) => setContador(e.target.value)} placeholder="Ej: 12250" style={input} />
            </label>
          </div>
          {(fecha || contador !== '') && error && <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#b91c1c' }}>{error}</div>}
          <button onClick={guardar} disabled={!!error || guardando}
            style={{ marginTop: '0.75rem', width: '100%', padding: '0.7rem', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '0.95rem',
              background: error || guardando ? '#c4b5fd' : '#7c3aed', color: 'white', cursor: error || guardando ? 'not-allowed' : 'pointer' }}>
            {guardando ? 'Guardando…' : '💾 Registrar mantenimiento'}
          </button>
        </div>

        <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>Historial</div>
        {cargando ? <p style={{ color: '#6b7280' }}>Cargando…</p> : !lista.length ? (
          <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>Todavía no hay mantenimientos registrados para este equipo.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {lista.map((s, i) => (
              <div key={s.id} style={{ border: `1px solid ${i === 0 ? '#c4b5fd' : '#e5e7eb'}`, background: i === 0 ? '#faf5ff' : 'white', borderRadius: '8px', padding: '0.6rem 0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                <div>
                  <div><b>{num(s.contador)}</b> · {fechaCorta(s.fecha)} {i === 0 && <span style={{ fontSize: '0.7rem', background: '#7c3aed', color: 'white', borderRadius: '10px', padding: '1px 7px', marginLeft: 4 }}>vigente</span>}</div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                    {s.origen === 'manual' ? 'Carga manual' : 'Inspección'} · {s.cargado_por || '—'} · {fechaCorta(s.cargado_en)}
                  </div>
                </div>
                {s.origen === 'manual' && (
                  <button onClick={() => anular(s)} style={{ border: '1px solid #fecaca', background: 'white', color: '#b91c1c', borderRadius: '6px', padding: '0.3rem 0.6rem', fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    Anular
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
