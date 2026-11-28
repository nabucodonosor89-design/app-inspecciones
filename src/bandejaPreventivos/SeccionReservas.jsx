import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useEscritorio } from '../correctivos/useEscritorio'
import { NIVEL, textoComponentes, copiarTexto } from './reservas'

// ============================================================
// Sección «Reservas» de la ventana Revisar (Bandeja de preventivos v3).
// - Orden con reserva en SAP: posiciones pendientes con stock, quiebre / en riesgo, otro centro y stock en 1002.
// - Orden sin reserva: propuesta = reserva completa de la preventiva anterior del equipo que tenga reserva,
//   con la orden de origen siempre visible y botón 📋 Copiar (formato de la pestaña Componentes de IW32).
// No escribe nada en SAP ni guarda nada.
// ============================================================

const fecha = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—')
const num = (v) => (v == null ? '—' : Number(v).toLocaleString('es-PY', { maximumFractionDigits: 3 }))

const st = {
  caja: { border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', marginTop: 12 },
  titulo: { fontSize: 13, fontWeight: 700, marginBottom: 4 },
  sub: { fontSize: 12, color: '#6b7280' },
  th: { textAlign: 'left', fontSize: 11, color: '#6b7280', padding: '4px 6px', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' },
  td: { fontSize: 12, padding: '4px 6px', borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' },
  chip: { borderRadius: 6, padding: '1px 6px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-block', marginRight: 4 },
  boton: { border: '1px solid #e5e7eb', background: 'white', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#0f766e' },
}

function Nivel({ n }) {
  const c = NIVEL[n]
  if (!c) return <span style={st.sub}>—</span>
  return <span style={{ ...st.chip, background: c.bg, color: c.fg }}>{c.txt}</span>
}

function Marca({ children, fg = '#b45309', bg = '#fef3c7' }) {
  return <span style={{ ...st.chip, background: bg, color: fg, fontWeight: 500 }}>{children}</span>
}

export default function SeccionReservas({ orden, resumen }) {
  const escritorio = useEscritorio()
  const [datos, setDatos] = useState(null) // { tipo: 'real' | 'propuesta', filas }
  const [error, setError] = useState('')
  const [tildadas, setTildadas] = useState({})

  const tipo = resumen?.peor_nivel === 'propuesta' ? 'propuesta'
    : ['quiebre', 'riesgo', 'ok'].includes(resumen?.peor_nivel) ? 'real' : null

  useEffect(() => {
    if (!tipo) return
    let vivo = true
    const rpc = tipo === 'propuesta' ? 'ip30_reservas_propuesta' : 'ip30_reservas_orden'
    supabase.rpc(rpc, { p_orden: orden }).then(({ data, error: e }) => {
      if (!vivo) return
      if (e) { setError(e.message); return }
      setDatos({ tipo, filas: data || [] })
      if (tipo === 'propuesta') setTildadas(Object.fromEntries((data || []).map((f) => [f.posicion, true])))
    })
    return () => { vivo = false }
  }, [orden, tipo])

  if (!resumen) return null
  if (resumen.peor_nivel === 'sin_reserva') {
    return (
      <div style={st.caja}>
        <div style={st.titulo}>Reservas</div>
        <div style={st.sub}>Sin reserva en SAP y sin preventiva anterior del equipo con reserva de dónde proponer.</div>
      </div>
    )
  }
  if (error) return <div style={{ ...st.caja, color: '#b91c1c', fontSize: 13 }}>No se pudieron leer las reservas: {error}</div>
  if (!datos) return <div style={{ ...st.caja, ...st.sub }}>Cargando reservas…</div>

  const corte = datos.filas[0]?.stock_corte || resumen.stock_corte

  if (datos.tipo === 'real') {
    return (
      <div style={st.caja}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={st.titulo}>Reservas en SAP ({datos.filas.length} pendientes)</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#b45309' }}>Stock al {fecha(corte)}</div>
        </div>
        {!datos.filas.length
          ? <div style={st.sub}>Todas las posiciones ya se retiraron.</div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560 }}>
                <thead><tr>{['Material', 'Pend.', 'Centro', 'Stock', 'Pend. TCPV', 'Nivel', 'En 1002'].map((h) => <th key={h} style={st.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {datos.filas.map((f) => (
                    <tr key={f.posicion}>
                      <td style={st.td}><b>{f.material}</b><div style={st.sub}>{f.descripcion}</div></td>
                      <td style={st.td}>{num(f.cantidad_pendiente)} {f.unidad}</td>
                      <td style={st.td}>
                        {f.centro}
                        {f.otro_centro && <div><Marca fg="#6d28d9" bg="#ede9fe">otro centro (esperado {f.centro_esperado})</Marca></div>}
                      </td>
                      <td style={st.td}>{num(f.stock)}</td>
                      <td style={st.td}>{num(f.pendiente_tcpv)}</td>
                      <td style={st.td}><Nivel n={f.nivel} /></td>
                      <td style={st.td}>{f.stock_1002 == null ? '' : num(f.stock_1002)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    )
  }

  // ---------- propuesta ----------
  const f0 = datos.filas[0]
  if (!f0) return <div style={{ ...st.caja, ...st.sub }}>La orden de origen ya no tiene posiciones.</div>
  const sel = datos.filas.filter((f) => tildadas[f.posicion])
  const todas = sel.length === datos.filas.length

  return (
    <div style={{ ...st.caja, borderColor: '#0f766e' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'start' }}>
        <div>
          <div style={st.titulo}>
            Propuesta según orden {f0.orden_origen}{' '}
            <button type="button" style={{ ...st.boton, padding: '0 6px' }} title="Copiar el N° de la orden de origen (para abrirla en SAP)"
              onClick={() => copiarTexto(String(f0.orden_origen), `Orden ${f0.orden_origen} copiada`)}>📋</button>
          </div>
          <div style={st.sub}>
            reserva del {fecha(f0.origen_fecha)} · {f0.origen_texto || '—'} · {f0.origen_status || '—'}
          </div>
          {f0.saltadas > 0 && <div style={st.sub}>(se saltaron {f0.saltadas} preventivas más recientes sin reserva)</div>}
          {f0.origen_viejo && <div style={{ marginTop: 3 }}><Marca>reserva de hace más de 1 año</Marca></div>}
          <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 3 }}>Todavía no está cargada en SAP.</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#b45309' }}>Stock al {fecha(corte)}</div>
          {escritorio && (
            <button type="button" disabled={!sel.length} style={{ ...st.boton, marginTop: 4, opacity: sel.length ? 1 : 0.5 }}
              title="Copia las filas tildadas para pegar en la pestaña Componentes de la orden (IW32), parado en la primera celda de Componente. Almacén y centro quedan vacíos."
              onClick={() => copiarTexto(textoComponentes(sel), `${sel.length} ${sel.length === 1 ? 'componente copiado' : 'componentes copiados'}`)}>
              📋 Copiar ({sel.length})
            </button>
          )}
        </div>
      </div>
      <div style={{ overflowX: 'auto', marginTop: 6 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 600 }}>
          <thead>
            <tr>
              <th style={st.th}>
                <input type="checkbox" checked={todas} aria-label="Tildar todas"
                  onChange={() => setTildadas(Object.fromEntries(datos.filas.map((f) => [f.posicion, !todas])))} />
              </th>
              {['Material', 'Cant.', 'Centro sug.', 'Stock', 'Nivel', 'En 1002'].map((h) => <th key={h} style={st.th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {datos.filas.map((f) => (
              <tr key={f.posicion} style={{ opacity: tildadas[f.posicion] ? 1 : 0.5 }}>
                <td style={st.td}>
                  <input type="checkbox" checked={!!tildadas[f.posicion]}
                    onChange={(e) => setTildadas((t) => ({ ...t, [f.posicion]: e.target.checked }))} />
                </td>
                <td style={st.td}>
                  <b>{f.material}</b><div style={st.sub}>{f.descripcion}</div>
                  {f.no_salio_en_origen && <Marca>en la anterior no salió</Marca>}
                </td>
                <td style={st.td}>{num(f.cantidad)} {f.unidad}</td>
                <td style={st.td}>{f.centro_sugerido || <span style={st.sub}>sin centro</span>}</td>
                <td style={st.td}>{num(f.stock)}</td>
                <td style={st.td}><Nivel n={f.nivel} /></td>
                <td style={st.td}>{f.stock_1002 == null ? '' : num(f.stock_1002)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!escritorio && <div style={{ ...st.sub, marginTop: 4 }}>El botón Copiar está en la versión de escritorio (SAP se usa en la PC).</div>}
    </div>
  )
}
