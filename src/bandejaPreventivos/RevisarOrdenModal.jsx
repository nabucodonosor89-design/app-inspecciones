import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../utils/ui'
import { ESTADO_TXT } from './logica'

// ============================================================
// Revisar una orden de la bandeja: estado confirmado (+ nueva fecha si se reprograma), notas,
// próximo mantenimiento (H, cargado a mano desde SAP) y, al concluir, contador y fecha reales (opcionales).
// RPC: ip30_confirmar_estado, ip30_fijar_proximo (ver supabase/bandeja_preventivos.sql)
// ============================================================

const ESTADOS = [
  ['', 'Sin confirmar'],
  ['programado', 'Programado'],
  ['reprogramado', 'Reprogramado'],
  ['concluido', 'Concluido'],
  ['cancelado', 'Cancelado'],
  ['verificar', 'Verificar'],
]

const hoyISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const num = (v, dec = 1) => (v == null ? '—' : Number(v).toLocaleString('es-PY', { maximumFractionDigits: dec }))

const st = {
  fondo: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 },
  caja: { background: 'white', borderRadius: 12, width: '100%', maxWidth: 520, maxHeight: '92vh', overflow: 'auto', padding: 18 },
  label: { display: 'block', fontSize: 12, color: '#6b7280', margin: '10px 0 3px' },
  input: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, background: 'white' },
  boton: { border: '1px solid #e5e7eb', background: 'white', borderRadius: 8, padding: '9px 16px', cursor: 'pointer', fontSize: 14 },
  primario: { border: 'none', background: '#0f766e', color: 'white', borderRadius: 8, padding: '9px 16px', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
}

export default function RevisarOrdenModal({ fila, estadoInicial, onCerrar, onGuardado }) {
  const [estado, setEstado] = useState(estadoInicial ?? fila.estado_confirmado ?? fila.estado_sugerido ?? '')
  const [nuevaFecha, setNuevaFecha] = useState(fila.nueva_fecha || '')
  const [notas, setNotas] = useState(fila.notas || '')
  const [h, setH] = useState(fila.h_fuente === 'cargado' && fila.h != null ? String(fila.h) : '')
  const [unidad, setUnidad] = useState(fila.unidad || 'h')
  const [contador, setContador] = useState('')
  const [fecha, setFecha] = useState('')
  const [guardando, setGuardando] = useState(false)

  const hOriginal = fila.h_fuente === 'cargado' && fila.h != null ? String(fila.h) : ''
  const cambioH = h.trim() !== hOriginal || (h.trim() !== '' && unidad !== fila.unidad)

  function validar() {
    if (estado === 'reprogramado' && !nuevaFecha) return 'Para reprogramar hace falta la nueva fecha'
    if (h.trim() !== '' && (!Number.isFinite(Number(h)) || Number(h) < 0)) return 'El próximo mantenimiento no es un número válido'
    if (contador.trim() !== '' && (!Number.isFinite(Number(contador)) || Number(contador) < 0)) return 'El contador no es un número válido'
    if (fecha && fecha > hoyISO()) return 'La fecha del mantenimiento no puede ser futura'
    return ''
  }
  const error = validar()

  async function guardar() {
    if (error) return
    setGuardando(true)
    try {
      if (cambioH) {
        const { error: e } = await supabase.rpc('ip30_fijar_proximo', {
          p_orden: fila.orden, p_valor: h.trim() === '' ? null : Number(h), p_unidad: h.trim() === '' ? null : unidad,
        })
        if (e) throw e
      }
      const concluye = estado === 'concluido'
      const { error: e } = await supabase.rpc('ip30_confirmar_estado', {
        p_orden: fila.orden,
        p_estado: estado || null,
        p_nueva_fecha: estado === 'reprogramado' ? nuevaFecha : null,
        p_notas: notas,
        p_contador: concluye && contador.trim() !== '' ? Number(contador) : null,
        p_fecha: concluye && fecha ? fecha : null,
      })
      if (e) throw e
      toast('✅ Orden guardada', 'exito')
      onGuardado()
    } catch (e) {
      console.error(e)
      toast('❌ ' + e.message, 'error')
    } finally {
      setGuardando(false)
    }
  }

  const u = fila.unidad === 'km' ? 'km' : 'h'
  return (
    <div style={st.fondo} onClick={onCerrar}>
      <div style={st.caja} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Orden {fila.orden}</div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>{fila.equipo} · {fila.ubicacion || 'sin ubicación'}</div>
          </div>
          <button style={{ ...st.boton, padding: '4px 10px' }} onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>

        <div style={{ background: '#f9fafb', borderRadius: 8, padding: '8px 10px', marginTop: 10, fontSize: 13 }}>
          Sugerido: <b>{ESTADO_TXT[fila.estado_sugerido] || 'sin sugerencia'}</b>
          {fila.motivo ? <span style={{ color: '#6b7280' }}> ({fila.motivo})</span> : null}
          {fila.j != null && <> · {Number(fila.j) < 0 ? `pasado ${num(-fila.j)} ${u}` : `falta ${num(fila.j)} ${u}`} ({fila.j_fuente})</>}
        </div>

        <label style={st.label}>Estado</label>
        <select style={st.input} value={estado} onChange={(e) => setEstado(e.target.value)}>
          {ESTADOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>

        {estado === 'reprogramado' && (
          <>
            <label style={{ ...st.label, color: nuevaFecha ? '#6b7280' : '#b91c1c' }}>Nueva fecha (la que se pone en SAP)</label>
            <input type="date" style={st.input} value={nuevaFecha} min={hoyISO()} onChange={(e) => setNuevaFecha(e.target.value)} />
          </>
        )}

        {estado === 'concluido' && (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '4px 10px 10px', marginTop: 10 }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
              Datos reales del mantenimiento (opcionales). Si los cargás, quedan como último mantenimiento confirmado del equipo.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={st.label}>Contador ({u})</label>
                <input type="number" inputMode="decimal" min="0" style={st.input} value={contador} onChange={(e) => setContador(e.target.value)} />
              </div>
              <div>
                <label style={st.label}>Fecha</label>
                <input type="date" style={st.input} value={fecha} max={hoyISO()} onChange={(e) => setFecha(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        <label style={st.label}>Próximo mantenimiento (de SAP)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="number" inputMode="decimal" min="0" style={{ ...st.input, flex: 1 }} value={h}
            placeholder={fila.h_fuente === 'calculado' ? `calculado: ${num(fila.h, 0)}` : 'Ej: 8.250'} onChange={(e) => setH(e.target.value)} />
          <select style={{ ...st.input, width: 80 }} value={unidad} onChange={(e) => setUnidad(e.target.value)}>
            <option value="h">h</option>
            <option value="km">km</option>
          </select>
        </div>
        {fila.h_difiere && <div style={{ fontSize: 12, color: '#b45309', marginTop: 3 }}>No coincide con el calculado ({num(fila.h_calculado, 0)}): revisar.</div>}

        <label style={st.label}>Notas</label>
        <textarea style={{ ...st.input, minHeight: 64, resize: 'vertical' }} value={notas} placeholder="enviar, hacer, taller externo…" onChange={(e) => setNotas(e.target.value)} />

        {error && <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button style={st.boton} onClick={onCerrar}>Cancelar</button>
          <button style={{ ...st.primario, opacity: error || guardando ? 0.6 : 1 }} disabled={!!error || guardando} onClick={guardar}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
