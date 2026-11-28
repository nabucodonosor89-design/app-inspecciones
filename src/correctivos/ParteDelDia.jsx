import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from '../utils/ui'
import { C, s, ddmm } from './constantes'
import { armarParte } from './parteTexto'

// ============================================================
// PARTE DEL DÍA del residente (24/11/2026)
// Arma el mensaje de "equipos con problemas mecánicos" que los residentes mandan por
// WhatsApp, con lo que cargaron en sus hilos. La app NO lo envía: el residente lo copia.
// El texto no se edita acá: si algo está mal, se corrige en el hilo.
// Datos: RPC corr_parte_residente() — ver supabase/correctivos_parte_residentes.sql
// ============================================================

const st = {
  fondo: { position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' },
  panel: { width: 'min(620px, 100%)', height: '100%', background: '#fff', overflowY: 'auto', padding: 16, boxSizing: 'border-box' },
  texto: { width: '100%', minHeight: 260, boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 15, lineHeight: 1.45, padding: 10, border: `1px solid ${C.borde}`, borderRadius: 8, background: C.fondo, resize: 'vertical' },
}

export default function ParteDelDia({ onCerrar, onAbrirHilo }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const ref = useRef(null)

  useEffect(() => {
    let vivo = true
    supabase.rpc('corr_parte_residente').then(({ data, error: e }) => {
      if (!vivo) return
      if (e) setError(e.message)
      else setDatos(data)
    })
    return () => { vivo = false }
  }, [])

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onCerrar])

  const texto = useMemo(() => (datos ? armarParte(datos) : ''), [datos])
  const viejos = (datos?.items || []).filter((i) => !i.novedad_del_dia)
  const otraUbicacion = (datos?.items || []).filter((i) => i.ubicacion_distinta)

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto)
      toast('✅ Copiado: pegalo en el grupo de WhatsApp')
    } catch {
      // Sin permiso de portapapeles: se selecciona el texto para copiarlo a mano
      ref.current?.focus()
      ref.current?.select()
      toast('Seleccioné el texto: copialo con mantener apretado → Copiar', 'warning')
    }
  }

  return (
    <div style={st.fondo} onClick={onCerrar}>
      <div style={st.panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Parte del día">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 800 }}>Parte del día</div>
            <div style={s.meta}>Sale de lo que cargaste en tus seguimientos. Para cambiar algo, cargá una novedad en el equipo.</div>
          </div>
          <button style={s.boton} onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>

        {error && <div style={{ ...s.aviso, marginTop: 12 }}>No se pudo armar el parte: {error}</div>}
        {!error && !datos && <div style={{ ...s.meta, marginTop: 12 }}>⏳ Armando el parte…</div>}

        {datos && (
          <>
            <textarea ref={ref} readOnly value={texto} style={{ ...st.texto, marginTop: 12 }} aria-label="Texto del parte" />
            <button onClick={copiar}
              style={{ ...s.boton, width: '100%', marginTop: 8, background: C.verde, color: '#fff', border: 'none', fontWeight: 700, fontSize: 16 }}>
              Copiar
            </button>

            {viejos.length > 0 && (
              <div style={{ ...s.card, marginTop: 14, borderColor: C.ambar }}>
                <div style={{ ...s.subtitulo, marginTop: 0 }}>Sin novedad tuya hoy · {viejos.length}</div>
                <div style={s.meta}>Revisá si siguen igual antes de mandar el parte. Tocá para cargar una novedad.</div>
                {viejos.map((i) => (
                  <div key={i.seguimiento_id} role="button" tabIndex={0} onClick={() => onAbrirHilo(i.seguimiento_id)}
                    onKeyDown={(e) => e.key === 'Enter' && onAbrirHilo(i.seguimiento_id)}
                    style={{ padding: '8px 4px', borderBottom: `1px solid ${C.borde}`, cursor: 'pointer', minHeight: 40 }}>
                    <strong>{i.equipo}</strong>{' '}
                    <span style={s.meta}>{i.ultima_novedad_en ? `última novedad tuya del ${ddmm(i.ultima_novedad_en)}` : 'sin novedades tuyas'}</span>
                  </div>
                ))}
              </div>
            )}

            {otraUbicacion.length > 0 && (
              <div style={{ ...s.meta, marginTop: 10 }}>
                Según SAP están en otra obra: {otraUbicacion.map((i) => `${i.equipo} (${i.ubicacion || 'sin ubicación'})`).join(', ')}. Avisale a David para que corrija la ubicación.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
