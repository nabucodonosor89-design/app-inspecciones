import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast, confirmar } from '../utils/ui'
import { C, s, ddmm, num } from '../correctivos/constantes'

// ============================================================
// ZONAS (solo admin): inspectores por zona con fechas y capacidad, ubicaciones IE36 y parámetros.
// Escrituras solo por RPC: insp_guardar_inspector, insp_quitar_inspector, insp_guardar_ubicacion,
// insp_guardar_parametro. Los cambios de inspectores impactan en la próxima generación del plan
// (o con "Generar plan ahora").
// ============================================================

const VACIO = { id: null, zona_id: '', usuario_id: '', rol: 'suplente', capacidad_diaria: 10, desde: '', hasta: '' }

export default function Zonas({ onCambio }) {
  const [cargando, setCargando] = useState(true)
  const [zonas, setZonas] = useState([])
  const [ubics, setUbics] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [params, setParams] = useState([])
  const [form, setForm] = useState(null)   // asignación en edición
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [z, u, us, p] = await Promise.all([
        supabase.rpc('insp_zonas_listado'),
        supabase.rpc('insp_ubicaciones_listado'),
        supabase.rpc('insp_usuarios_activos'),
        supabase.rpc('insp_parametros_listado'),
      ])
      for (const r of [z, u, us, p]) if (r.error) throw r.error
      setZonas(z.data || [])
      setUbics(u.data || [])
      setUsuarios(us.data || [])
      setParams(p.data || [])
    } catch (e) {
      console.error(e)
      toast('❌ Error al cargar zonas: ' + e.message, 'error')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function guardarInspector() {
    if (!form.usuario_id) { toast('⚠️ Elegí el usuario'); return }
    setGuardando(true)
    const { error } = await supabase.rpc('insp_guardar_inspector', {
      p_id: form.id, p_zona_id: form.zona_id, p_usuario_id: form.usuario_id, p_rol: form.rol,
      p_capacidad: Number(form.capacidad_diaria), p_desde: form.desde || null, p_hasta: form.hasta || null,
    })
    setGuardando(false)
    if (error) { toast('❌ ' + error.message, 'error'); return }
    toast('✅ Asignación guardada. Impacta al generar el plan.', 'success')
    setForm(null)
    cargar(); onCambio?.()
  }

  async function quitar(i) {
    if (!(await confirmar(`¿Quitar a ${i.nombre} de la zona?`))) return
    const { error } = await supabase.rpc('insp_quitar_inspector', { p_id: i.id })
    if (error) { toast('❌ ' + error.message, 'error'); return }
    cargar(); onCambio?.()
  }

  async function guardarUbic(u, cambios) {
    const nuevo = { ...u, ...cambios }
    setUbics((prev) => prev.map((x) => (x.ubicacion_sap === u.ubicacion_sap ? { ...nuevo, registrada: true } : x)))
    const { error } = await supabase.rpc('insp_guardar_ubicacion', {
      p_ubicacion: u.ubicacion_sap, p_inspecciona: nuevo.inspecciona, p_zona_id: nuevo.zona_id || null,
    })
    if (error) { toast('❌ ' + error.message, 'error'); cargar(); return }
    onCambio?.()
  }

  async function guardarParam(clave, valor) {
    const { error } = await supabase.rpc('insp_guardar_parametro', { p_clave: clave, p_valor: Number(valor) })
    if (error) { toast('❌ ' + error.message, 'error'); cargar(); return }
    toast('✅ Parámetro guardado', 'success')
    onCambio?.()
  }

  if (cargando && !zonas.length) return <div style={s.vacio}>Cargando…</div>

  return (
    <>
      {/* Inspectores por zona */}
      {zonas.map((z) => (
        <div key={z.zona_id} style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 17 }}>{z.nombre} <span style={s.meta}>· {z.tipo}</span></h3>
            <button style={s.boton} onClick={() => setForm({ ...VACIO, zona_id: z.zona_id })}>+ Asignar inspector</button>
          </div>
          {!z.inspectores.length && <div style={{ ...s.meta, marginTop: 8 }}>Sin inspectores.</div>}
          {z.inspectores.map((i) => (
            <div key={i.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderTop: `1px solid ${C.borde}`, padding: '8px 0', marginTop: 8 }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <strong>{i.nombre}</strong> <span style={s.meta}>{i.rol} · {i.capacidad_diaria}/día</span>
                <div style={s.meta}>
                  {i.desde ? `Desde ${ddmm(i.desde)}${i.hasta ? ` hasta ${ddmm(i.hasta)}` : ' · sin fin'}` : 'Sin fechas (no activo)'}
                </div>
              </div>
              <span style={s.chip(i.vigente_semana ? C.verdeBg : C.fondo, i.vigente_semana ? C.verde : C.gris)}>
                {i.vigente_semana ? 'Activo esta semana' : 'No activo esta semana'}
              </span>
              <button style={s.boton} onClick={() => setForm({ ...i, zona_id: z.zona_id, desde: i.desde || '', hasta: i.hasta || '' })}>Editar</button>
              <button style={{ ...s.boton, color: C.rojo }} onClick={() => quitar(i)}>Quitar</button>
            </div>
          ))}

          {form && form.zona_id === z.zona_id && (
            <div style={{ background: C.fondo, borderRadius: 8, padding: 12, marginTop: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                <label style={s.meta}>Usuario
                  <select style={s.input} value={form.usuario_id} onChange={(e) => setForm({ ...form, usuario_id: e.target.value })}>
                    <option value="">Elegir…</option>
                    {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre_completo}</option>)}
                  </select>
                </label>
                <label style={s.meta}>Rol
                  <select style={s.input} value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value })}>
                    <option value="titular">Titular</option>
                    <option value="suplente">Suplente</option>
                  </select>
                </label>
                <label style={s.meta}>Inspecciones por día
                  <input type="number" min="1" style={s.input} value={form.capacidad_diaria}
                    onChange={(e) => setForm({ ...form, capacidad_diaria: e.target.value })} />
                </label>
                <label style={s.meta}>Desde
                  <input type="date" style={s.input} value={form.desde} onChange={(e) => setForm({ ...form, desde: e.target.value })} />
                </label>
                <label style={s.meta}>Hasta (vacío = sin fin)
                  <input type="date" style={s.input} value={form.hasta} onChange={(e) => setForm({ ...form, hasta: e.target.value })} />
                </label>
              </div>
              <div style={{ ...s.meta, margin: '8px 0' }}>Sin fecha desde = queda cargado pero no cuenta para la capacidad ni ve la lista.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={{ ...s.boton, background: C.azul, color: '#fff', border: 'none', fontWeight: 600 }}
                  onClick={guardarInspector} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
                <button style={s.boton} onClick={() => setForm(null)}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Ubicaciones IE36 */}
      <div style={s.card}>
        <h3 style={s.subtitulo}>Ubicaciones IE36</h3>
        <div style={{ ...s.meta, marginBottom: 8 }}>Las ubicaciones sin zona van primero. Los cambios se guardan al elegir.</div>
        <div style={s.scroll}>
          <table style={s.tabla}>
            <thead><tr>
              <th style={s.th}>Ubicación</th><th style={s.th}>Equipos activos</th>
              <th style={s.th}>Se inspecciona</th><th style={s.th}>Zona</th>
            </tr></thead>
            <tbody>
              {ubics.map((u) => (
                <tr key={u.ubicacion_sap} style={{ background: !u.registrada || (u.inspecciona && !u.zona_id) ? C.ambarBg : undefined }}>
                  <td style={s.td}>{u.ubicacion_sap}{!u.registrada && <span style={{ ...s.chip(C.ambarBg, C.ambar), marginLeft: 6 }}>Nueva</span>}</td>
                  <td style={s.td}>{num(u.equipos_activos)}</td>
                  <td style={s.td}>
                    <input type="checkbox" checked={!!u.inspecciona} style={{ width: 22, height: 22 }}
                      onChange={(e) => guardarUbic(u, { inspecciona: e.target.checked })} />
                  </td>
                  <td style={s.td}>
                    <select style={{ ...s.input, minWidth: 140 }} value={u.zona_id || ''} disabled={!u.inspecciona}
                      onChange={(e) => guardarUbic(u, { zona_id: e.target.value || null })}>
                      <option value="">Sin zona</option>
                      {zonas.map((z) => <option key={z.zona_id} value={z.zona_id}>{z.nombre}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Parámetros */}
      <div style={s.card}>
        <h3 style={s.subtitulo}>Parámetros</h3>
        {params.map((p) => (
          <Parametro key={p.clave} p={p} onGuardar={guardarParam} />
        ))}
      </div>
    </>
  )
}

function Parametro({ p, onGuardar }) {
  const [v, setV] = useState(String(p.valor))
  const cambiado = v !== String(p.valor)
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderTop: `1px solid ${C.borde}`, padding: '8px 0' }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <strong>{p.clave}</strong>
        <div style={s.meta}>{p.descripcion}</div>
      </div>
      <input type="number" min="1" style={{ ...s.input, width: 100 }} value={v} onChange={(e) => setV(e.target.value)} />
      <button style={s.boton} disabled={!cambiado} onClick={() => onGuardar(p.clave, v)}>Guardar</button>
    </div>
  )
}
