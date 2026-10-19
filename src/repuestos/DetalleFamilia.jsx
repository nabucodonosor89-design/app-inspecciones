import { useEffect, useMemo } from 'react'
import { useEscritorio } from '../correctivos/useEscritorio'
import Badge from './Badge'
import { C, s, ESTADO, LECTURA, ORIGEN_SIN_REVISAR, num, cant, ddmm, ordenCobertura } from './constantes'

const ORIGEN_TXT = { revisado: 'revisado', sugerido: 'sugerido (sin revisar)', app: 'de la app (sin revisar)', sin_modelo: 'sin modelo' }

// Detalle de una familia: datos, equipos, kit (v_rep_kit × v_rep_materiales) y mantenimientos pendientes.
// Bottom sheet en celular, panel lateral en escritorio. Todo viene ya cargado desde ModuloRepuestos.
export default function DetalleFamilia({ familia, familias, kit, materiales, pendientes, onCerrar }) {
  const escritorio = useEscritorio()
  const f = familias.find((x) => x.familia === familia)

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', esc)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', esc); document.body.style.overflow = overflow }
  }, [onCerrar])

  const filasKit = useMemo(() => {
    const porMat = new Map(materiales.map((m) => [m.material, m]))
    return kit.filter((k) => k.familia === familia)
      .map((k) => ({ ...porMat.get(k.material), ...k }))
      .sort(ordenCobertura)
  }, [familia, kit, materiales])

  const pend = useMemo(() => pendientes.filter((p) => p.familia === familia).sort((a, b) => b.dias - a.dias),
    [familia, pendientes])

  const panel = escritorio
    ? { position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(640px, 100vw)', borderRadius: 0 }
    : { position: 'fixed', left: 0, right: 0, bottom: 0, maxHeight: '88vh', borderRadius: '16px 16px 0 0' }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(17,24,39,0.45)' }} onClick={onCerrar}>
      <div role="dialog" aria-label={`Familia ${familia}`} onClick={(e) => e.stopPropagation()}
        style={{ ...panel, background: '#fff', overflowY: 'auto', padding: 16, boxSizing: 'border-box', boxShadow: '0 -4px 24px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={s.meta}>Familia</div>
            <h3 style={{ margin: 0, fontSize: 18 }}>{familia}</h3>
          </div>
          <button style={s.boton} onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>

        {!f ? <div style={s.vacio}>Esta familia no tiene kit calculado.</div> : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
              <Dato label="Modelo" valor={`${ORIGEN_TXT[f.origen_modelo] || f.origen_modelo}`}
                alerta={ORIGEN_SIN_REVISAR.includes(f.origen_modelo)} />
              <Dato label="Equipos activos" valor={num(f.equipos, 0)} />
              <Dato label="Mantenimientos (historial)" valor={num(f.mantenimientos_historial, 0)} />
              <Dato label="Mantenimientos 12 m" valor={num(f.mantenimientos_12m, 0)} />
              <Dato label="Último mantenimiento" valor={ddmm(f.ultimo_mantenimiento)} />
              <Dato label="Días entre mantenimientos" valor={f.dias_entre_mantenimientos == null ? '—' : num(f.dias_entre_mantenimientos, 0)} />
            </div>

            <div style={s.subtitulo}>Equipos</div>
            <div style={{ fontSize: 14, marginBottom: 12, lineHeight: 1.6 }}>{f.equipos_lista}</div>

            <div style={s.subtitulo}>Kit de mantenimiento · {filasKit.length} materiales</div>
            {escritorio ? (
              <div style={{ ...s.scroll, marginBottom: 12 }}>
                <table style={s.tabla}>
                  <thead>
                    <tr>{['Material', 'Descripción', 'Cant. / mant.', '% mant.', 'Stock Ypané', 'Cobertura', 'Estado']
                      .map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {filasKit.map((k) => (
                      <tr key={k.material}>
                        <td style={{ ...s.td, fontWeight: 700, whiteSpace: 'nowrap' }}>{k.material}</td>
                        <td style={s.td}>{k.descripcion}</td>
                        <td style={s.td}>{cant(k.cantidad_por_mantenimiento, k.unidad)}</td>
                        <td style={s.td}>{num(k.porcentaje * 100, 0)} %</td>
                        <td style={s.td}>{cant(k.stock_ypane, k.unidad)}</td>
                        <td style={s.td}>{k.cobertura_meses == null ? '—' : `${num(k.cobertura_meses, 1)} m`}</td>
                        <td style={s.td}><Badge def={ESTADO[k.estado]} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ marginBottom: 12 }}>
                {filasKit.map((k) => (
                  <div key={k.material} style={{ ...s.card, padding: 10, marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <b>{k.material}</b><Badge def={ESTADO[k.estado]} />
                    </div>
                    <div style={{ fontSize: 13, marginBottom: 4 }}>{k.descripcion}</div>
                    <div style={{ ...s.meta, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <span>{cant(k.cantidad_por_mantenimiento, k.unidad)} / mant.</span>
                      <span>{num(k.porcentaje * 100, 0)} % de los mant.</span>
                      <span>Stock {cant(k.stock_ypane, k.unidad)}</span>
                      <span>Cobertura {k.cobertura_meses == null ? '—' : `${num(k.cobertura_meses, 1)} m`}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={s.subtitulo}>Mantenimientos pendientes · {pend.length}</div>
            {!pend.length ? <div style={{ ...s.meta, marginBottom: 12 }}>Ninguno.</div> : pend.map((p) => (
              <div key={p.orden} style={{ ...s.card, padding: 10, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <span><b>{p.equipo}</b> · orden {p.orden} · {ddmm(p.fecha_entrada)} · {num(p.dias, 0)} días</span>
                  <Badge def={LECTURA[p.lectura]} />
                </div>
                <div style={{ fontSize: 13, color: C.gris, marginTop: 4 }}>{p.materiales}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function Dato({ label, valor, alerta }) {
  return (
    <div style={{ background: alerta ? C.ambarBg : C.fondo, borderRadius: 8, padding: '6px 10px' }}>
      <div style={{ ...s.meta, fontSize: 12 }}>{label}</div>
      <div style={{ fontWeight: 600, color: alerta ? C.ambar : C.texto }}>{valor}</div>
    </div>
  )
}
