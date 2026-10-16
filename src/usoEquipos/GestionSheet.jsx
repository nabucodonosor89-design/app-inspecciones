import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../utils/ui'
import { C, s } from './constantes'
import { useEscritorio } from '../correctivos/useEscritorio'

const MODOS = {
  gestion: { titulo: 'Registrar gestión', rpc: 'uso_registrar_gestion', placeholder: 'Ej.: Llamé a la obra, mandan los partes el jueves', boton: 'Guardar gestión' },
  escalar: { titulo: 'Escalar a gerencia', rpc: 'uso_escalar', placeholder: 'Por qué se escala: qué se pidió y qué respondió la obra', boton: 'Escalar' },
  devolver: { titulo: 'Devolver a gestión', rpc: 'uso_devolver', placeholder: 'Qué se resolvió o qué hay que seguir pidiendo', boton: 'Devolver' },
  nota: { titulo: 'Nota de gerencia', rpc: 'uso_nota_gerencia', placeholder: 'Nota para la bitácora del caso', boton: 'Guardar nota' },
  justificar: { titulo: 'Justificar hallazgos', rpc: 'uso_justificar', placeholder: 'Motivo (ej.: receso de obra, equipo de apoyo sin parte)', boton: 'Justificar' },
}

/**
 * Bottom sheet en celular / modal en escritorio. Texto obligatorio en todos los modos.
 * modo: gestion | escalar | devolver | nota | justificar
 */
export default function GestionSheet({ modo, caso, hallazgos = [], onCerrar, onHecho }) {
  const m = MODOS[modo]
  const escritorio = useEscritorio()
  const [texto, setTexto] = useState('')
  const [guardando, setGuardando] = useState(false)
  const valido = texto.trim().length >= 3

  async function guardar() {
    if (!valido || guardando) return
    setGuardando(true)
    const params = modo === 'justificar'
      ? { p_hallazgos: hallazgos, p_comentario: texto.trim() }
      : { p_caso: caso.caso_id, p_texto: texto.trim() }
    const { error } = await supabase.rpc(m.rpc, params)
    setGuardando(false)
    if (error) { toast('❌ ' + error.message, 'error'); return }
    toast('✅ Guardado correctamente', 'success')
    onHecho()
  }

  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget && !guardando) onCerrar() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 2000, display: 'flex',
        alignItems: escritorio ? 'center' : 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: '#fff', width: '100%', maxWidth: escritorio ? 520 : '100%', maxHeight: '92vh',
        display: 'flex', flexDirection: 'column', borderRadius: escritorio ? 16 : '18px 18px 0 0', boxShadow: '0 -8px 30px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${C.borde}`, display: 'flex', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{m.titulo}</div>
            <div style={{ fontSize: 13, color: C.gris, marginTop: 2 }}>
              {caso?.obra_nombre ? `${caso.obra} · ${caso.obra_nombre}` : caso?.obra}
              {modo === 'justificar' && ` · ${hallazgos.length} hallazgo(s)`}
            </div>
          </div>
          <button onClick={onCerrar} disabled={guardando} aria-label="Cerrar"
            style={{ border: 'none', background: '#f3f4f6', borderRadius: 999, width: 36, height: 36, fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: 16, overflowY: 'auto' }}>
          {modo === 'justificar' && (
            <div style={{ ...s.meta, marginBottom: 8 }}>
              Si después cambian las cantidades (llega un parte, se corrige el rastreo), el hallazgo se reabre solo.
            </div>
          )}
          <textarea autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={m.placeholder} rows={4}
            style={{ ...s.input, minHeight: 100, fontFamily: 'inherit', resize: 'vertical' }} />
          {!valido && texto.length > 0 && <div style={{ ...s.meta, color: C.rojo, marginTop: 4 }}>Escribí al menos 3 caracteres.</div>}
        </div>
        <div style={{ padding: '12px 16px calc(12px + env(safe-area-inset-bottom))', borderTop: `1px solid ${C.borde}`, display: 'flex', gap: 10 }}>
          <button style={{ ...s.boton, flex: 1 }} onClick={onCerrar} disabled={guardando}>Cancelar</button>
          <button style={{ ...s.boton, flex: 2, background: valido ? C.azul : '#9ca3af', color: '#fff', border: 'none', fontWeight: 700 }}
            onClick={guardar} disabled={!valido || guardando}>
            {guardando ? 'Guardando…' : m.boton}
          </button>
        </div>
      </div>
    </div>
  )
}
