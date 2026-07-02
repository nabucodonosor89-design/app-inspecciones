import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'
import { subirImagenCloudinary, validarImagen } from './utils/cloudinary'

// ─── helpers ──────────────────────────────────────────────────
const fmt = (n) =>
  Number(n ?? 0).toLocaleString('es-PY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

const hoy = () => new Date().toISOString().slice(0, 10)

function diasDesde(fechaStr) {
  const diff = Date.now() - new Date(fechaStr).getTime()
  return Math.floor(diff / 86_400_000)
}

// ─── helper IVA ───────────────────────────────────────────────
function calcularIva(monto, condicion) {
  if (!monto || condicion === 'exento') return null
  const tasa = condicion === 'iva_10' ? 10 : 5
  const divisor = 100 + tasa
  return Math.round((Number(monto) * tasa / divisor) * 100) / 100
}

// ─── sub-componente: Formulario de movimiento ─────────────────
function FormMovimiento({ cajaEspecialId = null, usuarioId, onGuardado, onCancelar }) {
  const [form, setForm] = useState({
    tipo: 'egreso',
    fecha: hoy(),
    nro_comprobante: '',
    proveedor: '',
    concepto: '',
    monto: '',
    condicion_iva: 'exento',
    monto_iva: '',
    tiene_retencion: false,
    monto_retencion: '',
  })
  const [fotoFile, setFotoFile] = useState(null)
  const [fotoPreview, setFotoPreview] = useState(null)
  const [subiendo, setSubiendo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  // Recalcular IVA y retención cuando cambia monto o condición
  const handleMontoOIva = (campo, valor) => {
    setForm(f => {
      const next = { ...f, [campo]: valor }
      if (campo === 'monto' || campo === 'condicion_iva') {
        const montoN = Number(campo === 'monto' ? valor : f.monto)
        const cond = campo === 'condicion_iva' ? valor : f.condicion_iva
        const ivaCalc = calcularIva(montoN, cond)
        next.monto_iva = ivaCalc !== null ? String(ivaCalc) : ''
        // Retención = 30% del IVA
        next.monto_retencion = ivaCalc !== null && f.tiene_retencion
          ? String(Math.round(ivaCalc * 0.30 * 100) / 100)
          : f.tiene_retencion ? f.monto_retencion : ''
        // Si pasó a exento, limpiar retención
        if (cond === 'exento') {
          next.tiene_retencion = false
          next.monto_retencion = ''
        }
      }
      if (campo === 'tiene_retencion') {
        const ivaActual = Number(f.monto_iva)
        next.monto_retencion = valor && ivaActual > 0
          ? String(Math.round(ivaActual * 0.30 * 100) / 100)
          : ''
      }
      return next
    })
  }

  const handleFoto = (e) => {
    const archivo = e.target.files[0]
    if (!archivo) return
    const v = validarImagen(archivo, 10)
    if (!v.valido) { setError(v.error); return }
    setFotoFile(archivo)
    setFotoPreview(URL.createObjectURL(archivo))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!form.concepto || !form.monto) { setError('Concepto y monto son obligatorios.'); return }
    if (isNaN(Number(form.monto)) || Number(form.monto) <= 0) { setError('El monto debe ser un número positivo.'); return }

    setGuardando(true)
    try {
      let foto_comprobante_url = null
      if (fotoFile) {
        setSubiendo(true)
        const resultado = await subirImagenCloudinary(fotoFile, 'caja_chica')
        foto_comprobante_url = resultado.url
        setSubiendo(false)
      }

      const { error: err } = await supabase.from('caja_chica_movimientos').insert({
        caja_especial_id: cajaEspecialId,
        tipo: form.tipo,
        fecha: form.fecha,
        nro_comprobante: form.nro_comprobante || null,
        proveedor: form.proveedor || null,
        concepto: form.concepto,
        monto: Number(form.monto),
        condicion_iva: form.condicion_iva,
        monto_iva: form.monto_iva !== '' ? Number(form.monto_iva) : null,
        tiene_retencion: form.tiene_retencion,
        monto_retencion: form.tiene_retencion && form.monto_retencion !== '' ? Number(form.monto_retencion) : null,
        foto_comprobante_url,
        creado_por: usuarioId,
      })
      if (err) throw err
      onGuardado()
    } catch (err) {
      setError(err.message)
    } finally {
      setGuardando(false)
      setSubiendo(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #d1d5db',
    borderRadius: '6px', fontSize: '0.95rem', boxSizing: 'border-box'
  }
  const labelStyle = { display: 'block', fontWeight: '600', marginBottom: '0.3rem', fontSize: '0.875rem', color: '#374151' }

  const tieneIva = form.condicion_iva !== 'exento'

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Tipo */}
      <div>
        <label style={labelStyle}>Tipo *</label>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {['ingreso', 'egreso'].map(t => (
            <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontWeight: form.tipo === t ? '700' : '400' }}>
              <input type="radio" name="tipo" value={t} checked={form.tipo === t}
                onChange={() => setForm(f => ({ ...f, tipo: t }))} />
              {t === 'ingreso' ? '⬆️ Ingreso' : '⬇️ Egreso'}
            </label>
          ))}
        </div>
      </div>

      {/* Fecha + Comprobante */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div>
          <label style={labelStyle}>Fecha *</label>
          <input type="date" style={inputStyle} value={form.fecha}
            onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} required />
        </div>
        <div>
          <label style={labelStyle}>N° Comprobante</label>
          <input type="text" style={inputStyle} placeholder="Ej: 001-002-0000123"
            value={form.nro_comprobante}
            onChange={e => setForm(f => ({ ...f, nro_comprobante: e.target.value }))} />
        </div>
      </div>

      {/* Proveedor + Monto */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div>
          <label style={labelStyle}>Proveedor</label>
          <input type="text" style={inputStyle} placeholder="Nombre del proveedor"
            value={form.proveedor}
            onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))} />
        </div>
        <div>
          <label style={labelStyle}>Monto (₲) *</label>
          <input type="number" style={inputStyle} placeholder="0" min="1" step="1"
            value={form.monto}
            onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} required />
        </div>
      </div>

      {/* Concepto */}
      <div>
        <label style={labelStyle}>Concepto *</label>
        <input type="text" style={inputStyle} placeholder="Descripción del gasto/ingreso"
          value={form.concepto}
          onChange={e => setForm(f => ({ ...f, concepto: e.target.value }))} required />
      </div>

      {/* IVA */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem' }}>
        <label style={labelStyle}>Condición IVA</label>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: tieneIva ? '0.75rem' : 0 }}>
          {[
            { val: 'exento', label: '⬜ Exento' },
            { val: 'iva_5', label: '🟡 IVA 5%' },
            { val: 'iva_10', label: '🟠 IVA 10%' },
          ].map(({ val, label }) => (
            <button
              key={val}
              type="button"
              onClick={() => handleMontoOIva('condicion_iva', val)}
              style={{
                padding: '0.4rem 0.9rem', border: '2px solid',
                borderColor: form.condicion_iva === val ? '#2563eb' : '#d1d5db',
                borderRadius: '6px', background: form.condicion_iva === val ? '#eff6ff' : 'white',
                color: form.condicion_iva === val ? '#1d4ed8' : '#374151',
                fontWeight: form.condicion_iva === val ? '700' : '400',
                cursor: 'pointer', fontSize: '0.875rem'
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tieneIva && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {/* Monto IVA */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', alignItems: 'end' }}>
              <div>
                <label style={{ ...labelStyle, color: '#1e40af' }}>
                  Monto IVA (₲) — incluido en el precio
                </label>
                <input
                  type="number" min="0" step="1"
                  style={{ ...inputStyle, borderColor: '#93c5fd', background: '#eff6ff' }}
                  value={form.monto_iva}
                  onChange={e => setForm(f => ({ ...f, monto_iva: e.target.value }))}
                  placeholder="Auto-calculado"
                />
              </div>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#6b7280', paddingBottom: '0.6rem' }}>
                {form.monto && form.monto_iva
                  ? `Neto: ₲ ${fmt(Number(form.monto) - Number(form.monto_iva))}`
                  : 'Ingresá el monto total para calcular'}
              </p>
            </div>

            {/* Retención */}
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.tiene_retencion}
                  onChange={e => handleMontoOIva('tiene_retencion', e.target.checked)}
                  style={{ width: '16px', height: '16px' }}
                />
                <span style={{ fontWeight: '600', fontSize: '0.875rem', color: '#374151' }}>
                  Con retención (30% del IVA)
                </span>
              </label>
              {form.tiene_retencion && (
                <input
                  type="number" min="0" step="1"
                  style={{ ...inputStyle, borderColor: '#93c5fd', background: '#eff6ff', marginTop: '0.5rem' }}
                  value={form.monto_retencion}
                  onChange={e => setForm(f => ({ ...f, monto_retencion: e.target.value }))}
                  placeholder="Monto retención (₲)"
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Foto comprobante */}
      <div>
        <label style={labelStyle}>Foto del comprobante</label>
        <div style={{ border: '2px dashed #d1d5db', borderRadius: '8px', padding: '1rem', background: '#f9fafb' }}>
          {fotoPreview ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <img src={fotoPreview} alt="preview" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '6px' }} />
              <div>
                <p style={{ margin: 0, fontSize: '0.875rem', color: '#059669', fontWeight: '600' }}>✓ Imagen seleccionada</p>
                <button type="button" onClick={() => { setFotoFile(null); setFotoPreview(null) }}
                  style={{ marginTop: '0.25rem', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.85rem' }}>
                  ✕ Quitar
                </button>
              </div>
            </div>
          ) : (
            <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }}>
              <span style={{ fontSize: '2rem' }}>📷</span>
              <span style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.25rem' }}>Hacer foto o seleccionar archivo</span>
              <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>JPG, PNG, WEBP • Máx. 10MB</span>
              <input type="file" accept="image/*" capture="environment" onChange={handleFoto} style={{ display: 'none' }} />
            </label>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '6px', padding: '0.75rem', color: '#dc2626', fontSize: '0.875rem' }}>
          ⚠️ {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancelar}
          style={{ padding: '0.6rem 1.2rem', background: '#e5e7eb', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }}>
          Cancelar
        </button>
        <button type="submit" disabled={guardando}
          style={{ padding: '0.6rem 1.4rem', background: '#059669', color: 'white', border: 'none', borderRadius: '6px', cursor: guardando ? 'not-allowed' : 'pointer', fontWeight: '600', opacity: guardando ? 0.7 : 1 }}>
          {subiendo ? '📤 Subiendo foto...' : guardando ? 'Guardando...' : '✓ Guardar movimiento'}
        </button>
      </div>
    </form>
  )
}

// ─── sub-componente: Tabla de movimientos ─────────────────────
const LABEL_IVA = { exento: 'Exento', iva_5: 'IVA 5%', iva_10: 'IVA 10%' }
const COLOR_IVA = { exento: '#6b7280', iva_5: '#b45309', iva_10: '#c2410c' }
const BG_IVA    = { exento: '#f3f4f6', iva_5: '#fef3c7', iva_10: '#ffedd5' }

function TablaMovimientos({ movimientos, loading }) {
  if (loading) return <p style={{ color: '#6b7280', textAlign: 'center', padding: '1rem' }}>Cargando movimientos...</p>
  if (movimientos.length === 0) return <p style={{ color: '#9ca3af', textAlign: 'center', padding: '1rem', fontStyle: 'italic' }}>Sin movimientos aún.</p>

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ background: '#f3f4f6' }}>
            {['Fecha', 'Tipo', 'N° Comp.', 'Proveedor', 'Concepto', 'Monto total', 'IVA', 'Retención', 'Foto'].map(h => (
              <th key={h} style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: '600', color: '#374151', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {movimientos.map((m, i) => (
            <tr key={m.id} style={{ borderBottom: '1px solid #e5e7eb', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
              <td style={{ padding: '0.6rem 0.75rem', whiteSpace: 'nowrap' }}>{m.fecha}</td>
              <td style={{ padding: '0.6rem 0.75rem' }}>
                <span style={{
                  display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: '700',
                  background: m.tipo === 'ingreso' ? '#d1fae5' : '#fee2e2',
                  color: m.tipo === 'ingreso' ? '#065f46' : '#991b1b'
                }}>
                  {m.tipo === 'ingreso' ? '⬆️ Ingreso' : '⬇️ Egreso'}
                </span>
              </td>
              <td style={{ padding: '0.6rem 0.75rem', color: '#6b7280' }}>{m.nro_comprobante || '—'}</td>
              <td style={{ padding: '0.6rem 0.75rem' }}>{m.proveedor || '—'}</td>
              <td style={{ padding: '0.6rem 0.75rem' }}>{m.concepto}</td>
              <td style={{ padding: '0.6rem 0.75rem', fontWeight: '700', whiteSpace: 'nowrap',
                color: m.tipo === 'ingreso' ? '#059669' : '#dc2626' }}>
                {m.tipo === 'ingreso' ? '+' : '-'} ₲ {fmt(m.monto)}
              </td>
              <td style={{ padding: '0.6rem 0.75rem', whiteSpace: 'nowrap' }}>
                <span style={{
                  display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: '9999px', fontSize: '0.72rem', fontWeight: '600',
                  background: BG_IVA[m.condicion_iva] || '#f3f4f6',
                  color: COLOR_IVA[m.condicion_iva] || '#6b7280'
                }}>
                  {LABEL_IVA[m.condicion_iva] || 'Exento'}
                </span>
                {m.monto_iva != null && (
                  <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: '0.15rem' }}>
                    ₲ {fmt(m.monto_iva)}
                  </div>
                )}
              </td>
              <td style={{ padding: '0.6rem 0.75rem', whiteSpace: 'nowrap' }}>
                {m.tiene_retencion && m.monto_retencion != null
                  ? <span style={{ color: '#7c3aed', fontWeight: '600' }}>₲ {fmt(m.monto_retencion)}</span>
                  : <span style={{ color: '#9ca3af' }}>—</span>
                }
              </td>
              <td style={{ padding: '0.6rem 0.75rem' }}>
                {m.foto_comprobante_url ? (
                  <a href={m.foto_comprobante_url} target="_blank" rel="noreferrer"
                    style={{ color: '#2563eb', textDecoration: 'none', fontWeight: '600', fontSize: '0.8rem' }}>
                    📎 Ver
                  </a>
                ) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── sub-componente: Sección Caja Chica Normal ────────────────
function SeccionCajaChicaNormal({ usuarioId }) {
  const [movimientos, setMovimientos] = useState([])
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)

  const saldo = movimientos.reduce((acc, m) => m.tipo === 'ingreso' ? acc + Number(m.monto) : acc - Number(m.monto), 0)

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('caja_chica_movimientos')
      .select('id, tipo, fecha, nro_comprobante, proveedor, concepto, monto, condicion_iva, monto_iva, tiene_retencion, monto_retencion, foto_comprobante_url')
      .is('caja_especial_id', null)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
    setMovimientos(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  return (
    <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
      {/* Header de sección */}
      <div style={{ background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)', padding: '1.5rem 2rem', color: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: '700' }}>💵 Caja Chica</h2>
            <p style={{ margin: '0.25rem 0 0 0', opacity: 0.85, fontSize: '0.9rem' }}>Fondo operativo general del departamento</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ margin: 0, fontSize: '0.8rem', opacity: 0.85 }}>Saldo actual</p>
            <p style={{ margin: 0, fontSize: '2rem', fontWeight: '800' }}>
              ₲ {fmt(saldo)}
            </p>
          </div>
        </div>
      </div>

      <div style={{ padding: '1.5rem 2rem' }}>
        {/* Botón nuevo movimiento */}
        {!mostrarForm && (
          <button onClick={() => setMostrarForm(true)}
            style={{ marginBottom: '1.5rem', padding: '0.6rem 1.2rem', background: '#059669', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem' }}>
            + Registrar movimiento
          </button>
        )}

        {/* Formulario */}
        {mostrarForm && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '1.5rem', marginBottom: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#065f46' }}>Nuevo movimiento — Caja Chica</h3>
            <FormMovimiento
              cajaEspecialId={null}
              usuarioId={usuarioId}
              onGuardado={() => { setMostrarForm(false); cargar() }}
              onCancelar={() => setMostrarForm(false)}
            />
          </div>
        )}

        {/* Tabla */}
        <TablaMovimientos movimientos={movimientos} loading={loading} />
      </div>
    </div>
  )
}

// ─── sub-componente: Tarjeta de Caja Especial ─────────────────
function TarjetaCajaEspecial({ caja, usuarioId, onActualizar }) {
  const [expandida, setExpandida] = useState(false)
  const [movimientos, setMovimientos] = useState([])
  const [loadingMov, setLoadingMov] = useState(false)
  const [mostrarFormMov, setMostrarFormMov] = useState(false)
  const [mostrarFormRendir, setMostrarFormRendir] = useState(false)
  const [sobrante, setSobrante] = useState('')
  const [rindiendoCaja, setRindiendoCaja] = useState(false)
  const [errorRendir, setErrorRendir] = useState(null)

  const gastado = movimientos.filter(m => m.tipo === 'egreso').reduce((a, m) => a + Number(m.monto), 0)
  const saldoPendiente = Number(caja.monto_otorgado) - gastado
  const dias = diasDesde(caja.fecha_apertura)
  const vencida = dias > 7

  const cargarMovimientos = useCallback(async () => {
    setLoadingMov(true)
    const { data } = await supabase
      .from('caja_chica_movimientos')
      .select('id, tipo, fecha, nro_comprobante, proveedor, concepto, monto, condicion_iva, monto_iva, tiene_retencion, monto_retencion, foto_comprobante_url')
      .eq('caja_especial_id', caja.id)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
    setMovimientos(data || [])
    setLoadingMov(false)
  }, [caja.id])

  useEffect(() => {
    if (expandida) cargarMovimientos()
  }, [expandida, cargarMovimientos])

  const handleRendir = async (e) => {
    e.preventDefault()
    setErrorRendir(null)
    const montoSobrante = Number(sobrante)
    if (isNaN(montoSobrante) || montoSobrante < 0) { setErrorRendir('Ingresá un monto válido (puede ser 0).'); return }
    setRindiendoCaja(true)
    try {
      const { error } = await supabase.from('cajas_especiales').update({
        estado: 'rendida',
        monto_sobrante_devuelto: montoSobrante,
        fecha_rendicion: hoy(),
      }).eq('id', caja.id)
      if (error) throw error
      onActualizar()
    } catch (err) {
      setErrorRendir(err.message)
    } finally {
      setRindiendoCaja(false)
    }
  }

  const colorBorde = vencida ? '#fca5a5' : '#bbf7d0'
  const colorFondo = vencida ? '#fff7f7' : '#f0fdf4'

  return (
    <div style={{ border: `2px solid ${colorBorde}`, borderRadius: '10px', overflow: 'hidden', background: colorFondo }}>
      {/* Cabecera de la tarjeta */}
      <div
        onClick={() => setExpandida(v => !v)}
        style={{ padding: '1rem 1.25rem', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: '700', fontSize: '1rem', color: '#064e3b' }}>{caja.motivo}</span>
            {vencida && (
              <span style={{ background: '#fca5a5', color: '#7f1d1d', padding: '0.15rem 0.6rem', borderRadius: '9999px', fontSize: '0.72rem', fontWeight: '700' }}>
                ⏰ Vencida ({dias}d)
              </span>
            )}
            {!vencida && (
              <span style={{ background: '#d1fae5', color: '#065f46', padding: '0.15rem 0.6rem', borderRadius: '9999px', fontSize: '0.72rem', fontWeight: '600' }}>
                {7 - dias}d restantes
              </span>
            )}
          </div>
          <p style={{ margin: '0.3rem 0 0 0', fontSize: '0.8rem', color: '#6b7280' }}>
            Responsable: <strong>{caja.usuario_nombre || '—'}</strong> • Apertura: {caja.fecha_apertura}
          </p>
        </div>

        {/* KPIs */}
        <div style={{ display: 'flex', gap: '1.5rem', textAlign: 'right', alignItems: 'center' }}>
          <div>
            <p style={{ margin: 0, fontSize: '0.7rem', color: '#6b7280', fontWeight: '600' }}>OTORGADO</p>
            <p style={{ margin: 0, fontWeight: '700', color: '#064e3b' }}>₲ {fmt(caja.monto_otorgado)}</p>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: '0.7rem', color: '#6b7280', fontWeight: '600' }}>GASTADO</p>
            <p style={{ margin: 0, fontWeight: '700', color: '#dc2626' }}>₲ {fmt(gastado)}</p>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: '0.7rem', color: '#6b7280', fontWeight: '600' }}>SALDO</p>
            <p style={{ margin: 0, fontWeight: '700', color: saldoPendiente >= 0 ? '#059669' : '#dc2626' }}>₲ {fmt(saldoPendiente)}</p>
          </div>
          <span style={{ fontSize: '1.3rem', color: '#9ca3af' }}>{expandida ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Detalle expandido */}
      {expandida && (
        <div style={{ borderTop: `1px solid ${colorBorde}`, padding: '1rem 1.25rem', background: 'white' }}>
          {/* Botones de acción */}
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            {!mostrarFormMov && !mostrarFormRendir && (
              <button onClick={() => setMostrarFormMov(true)}
                style={{ padding: '0.5rem 1rem', background: '#059669', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.875rem' }}>
                + Agregar movimiento
              </button>
            )}
            {!mostrarFormRendir && !mostrarFormMov && (
              <button onClick={() => setMostrarFormRendir(true)}
                style={{ padding: '0.5rem 1rem', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.875rem' }}>
                📋 Rendir caja
              </button>
            )}
          </div>

          {/* Form nuevo movimiento */}
          {mostrarFormMov && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '1.25rem', marginBottom: '1rem' }}>
              <h4 style={{ margin: '0 0 1rem 0', color: '#065f46' }}>Nuevo movimiento — {caja.motivo}</h4>
              <FormMovimiento
                cajaEspecialId={caja.id}
                usuarioId={usuarioId}
                onGuardado={() => { setMostrarFormMov(false); cargarMovimientos(); onActualizar() }}
                onCancelar={() => setMostrarFormMov(false)}
              />
            </div>
          )}

          {/* Form rendir caja */}
          {mostrarFormRendir && (
            <form onSubmit={handleRendir} style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '1.25rem', marginBottom: '1rem' }}>
              <h4 style={{ margin: '0 0 0.75rem 0', color: '#1e40af' }}>Rendir caja — {caja.motivo}</h4>
              <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.875rem', color: '#374151' }}>
                Total gastado: <strong>₲ {fmt(gastado)}</strong> de ₲ {fmt(caja.monto_otorgado)} otorgados.
              </p>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.3rem', fontSize: '0.875rem', color: '#374151' }}>
                Monto sobrante devuelto (₲) *
              </label>
              <input type="number" min="0" step="1" placeholder="0"
                value={sobrante} onChange={e => setSobrante(e.target.value)} required
                style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #93c5fd', borderRadius: '6px', fontSize: '0.95rem', boxSizing: 'border-box', marginBottom: '0.75rem' }}
              />
              {errorRendir && (
                <p style={{ color: '#dc2626', fontSize: '0.875rem', marginBottom: '0.75rem' }}>⚠️ {errorRendir}</p>
              )}
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button type="button" onClick={() => { setMostrarFormRendir(false); setErrorRendir(null) }}
                  style={{ padding: '0.5rem 1rem', background: '#e5e7eb', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }}>
                  Cancelar
                </button>
                <button type="submit" disabled={rindiendoCaja}
                  style={{ padding: '0.5rem 1rem', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: rindiendoCaja ? 'not-allowed' : 'pointer', fontWeight: '600', opacity: rindiendoCaja ? 0.7 : 1 }}>
                  {rindiendoCaja ? 'Guardando...' : '✓ Confirmar rendición'}
                </button>
              </div>
            </form>
          )}

          {/* Tabla de movimientos */}
          <TablaMovimientos movimientos={movimientos} loading={loadingMov} />
        </div>
      )}
    </div>
  )
}

// ─── sub-componente: Sección Cajas Especiales ─────────────────
function SeccionCajasEspeciales({ usuarioId, usuariosMap }) {
  const [cajasAbiertas, setCajasAbiertas] = useState([])
  const [cajasRendidas, setCajasRendidas] = useState([])
  const [loading, setLoading] = useState(true)
  const [mostrarFormNueva, setMostrarFormNueva] = useState(false)
  const [mostrarHistorial, setMostrarHistorial] = useState(false)
  const [formNueva, setFormNueva] = useState({ motivo: '', monto_otorgado: '' })
  const [creandoCaja, setCreandoCaja] = useState(false)
  const [errorNueva, setErrorNueva] = useState(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('cajas_especiales')
      .select('id, monto_otorgado, fecha_apertura, responsable, motivo, estado, monto_sobrante_devuelto, fecha_rendicion')
      .order('fecha_apertura', { ascending: false })
    const enriquecidas = (data || []).map(c => ({
      ...c,
      usuario_nombre: usuariosMap[c.responsable] || c.responsable
    }))
    setCajasAbiertas(enriquecidas.filter(c => c.estado === 'abierta'))
    setCajasRendidas(enriquecidas.filter(c => c.estado === 'rendida'))
    setLoading(false)
  }, [usuariosMap])

  useEffect(() => { cargar() }, [cargar])

  const handleCrearCaja = async (e) => {
    e.preventDefault()
    setErrorNueva(null)
    const monto = Number(formNueva.monto_otorgado)
    if (!formNueva.motivo) { setErrorNueva('El motivo es obligatorio.'); return }
    if (isNaN(monto) || monto <= 0) { setErrorNueva('El monto debe ser un número positivo.'); return }
    setCreandoCaja(true)
    try {
      const { error } = await supabase.from('cajas_especiales').insert({
        monto_otorgado: monto,
        motivo: formNueva.motivo,
        responsable: usuarioId,
        estado: 'abierta',
      })
      if (error) throw error
      setFormNueva({ motivo: '', monto_otorgado: '' })
      setMostrarFormNueva(false)
      cargar()
    } catch (err) {
      setErrorNueva(err.message)
    } finally {
      setCreandoCaja(false)
    }
  }

  return (
    <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)', padding: '1.5rem 2rem', color: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: '700' }}>🗂️ Cajas Especiales</h2>
            <p style={{ margin: '0.25rem 0 0 0', opacity: 0.85, fontSize: '0.9rem' }}>Montos puntuales para gastos específicos no recurrentes</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ background: 'rgba(255,255,255,0.2)', borderRadius: '9999px', padding: '0.3rem 0.8rem', fontSize: '0.9rem', fontWeight: '700' }}>
              {cajasAbiertas.length} abierta{cajasAbiertas.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      <div style={{ padding: '1.5rem 2rem' }}>
        {/* Botón nueva caja */}
        {!mostrarFormNueva && (
          <button onClick={() => setMostrarFormNueva(true)}
            style={{ marginBottom: '1.5rem', padding: '0.6rem 1.2rem', background: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem' }}>
            + Abrir nueva caja especial
          </button>
        )}

        {/* Form nueva caja */}
        {mostrarFormNueva && (
          <form onSubmit={handleCrearCaja} style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '1.5rem', marginBottom: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#1e40af' }}>Nueva Caja Especial</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.3rem', fontSize: '0.875rem', color: '#374151' }}>Motivo / Descripción *</label>
                <input type="text" placeholder="Ej: Habilitación municipal 2026"
                  value={formNueva.motivo} onChange={e => setFormNueva(f => ({ ...f, motivo: e.target.value }))} required
                  style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #93c5fd', borderRadius: '6px', fontSize: '0.95rem', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.3rem', fontSize: '0.875rem', color: '#374151' }}>Monto otorgado (₲) *</label>
                <input type="number" placeholder="0" min="1" step="1"
                  value={formNueva.monto_otorgado} onChange={e => setFormNueva(f => ({ ...f, monto_otorgado: e.target.value }))} required
                  style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #93c5fd', borderRadius: '6px', fontSize: '0.95rem', boxSizing: 'border-box' }} />
              </div>
            </div>
            {errorNueva && (
              <p style={{ color: '#dc2626', fontSize: '0.875rem', marginBottom: '0.75rem' }}>⚠️ {errorNueva}</p>
            )}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button type="button" onClick={() => { setMostrarFormNueva(false); setErrorNueva(null) }}
                style={{ padding: '0.6rem 1.2rem', background: '#e5e7eb', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }}>
                Cancelar
              </button>
              <button type="submit" disabled={creandoCaja}
                style={{ padding: '0.6rem 1.4rem', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: creandoCaja ? 'not-allowed' : 'pointer', fontWeight: '600', opacity: creandoCaja ? 0.7 : 1 }}>
                {creandoCaja ? 'Creando...' : '✓ Abrir caja'}
              </button>
            </div>
          </form>
        )}

        {/* Cajas abiertas */}
        {loading ? (
          <p style={{ color: '#6b7280', textAlign: 'center', padding: '1rem' }}>Cargando cajas...</p>
        ) : cajasAbiertas.length === 0 ? (
          <p style={{ color: '#9ca3af', fontStyle: 'italic', textAlign: 'center', padding: '1rem' }}>No hay cajas especiales abiertas.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
            {cajasAbiertas.map(caja => (
              <TarjetaCajaEspecial key={caja.id} caja={caja} usuarioId={usuarioId} onActualizar={cargar} />
            ))}
          </div>
        )}

        {/* Historial rendidas */}
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1rem' }}>
          <button onClick={() => setMostrarHistorial(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontWeight: '600', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {mostrarHistorial ? '▲' : '▼'} Historial de cajas rendidas ({cajasRendidas.length})
          </button>

          {mostrarHistorial && (
            <div style={{ marginTop: '1rem' }}>
              {cajasRendidas.length === 0 ? (
                <p style={{ color: '#9ca3af', fontStyle: 'italic' }}>Sin cajas rendidas aún.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                      <tr style={{ background: '#f3f4f6' }}>
                        {['Motivo', 'Responsable', 'Apertura', 'Rendición', 'Otorgado', 'Sobrante devuelto'].map(h => (
                          <th key={h} style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: '600', color: '#374151', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cajasRendidas.map((c, i) => (
                        <tr key={c.id} style={{ borderBottom: '1px solid #e5e7eb', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                          <td style={{ padding: '0.6rem 0.75rem' }}>{c.motivo}</td>
                          <td style={{ padding: '0.6rem 0.75rem' }}>{c.usuario_nombre}</td>
                          <td style={{ padding: '0.6rem 0.75rem', whiteSpace: 'nowrap' }}>{c.fecha_apertura}</td>
                          <td style={{ padding: '0.6rem 0.75rem', whiteSpace: 'nowrap' }}>{c.fecha_rendicion || '—'}</td>
                          <td style={{ padding: '0.6rem 0.75rem', fontWeight: '700' }}>₲ {fmt(c.monto_otorgado)}</td>
                          <td style={{ padding: '0.6rem 0.75rem', fontWeight: '700', color: '#059669' }}>₲ {fmt(c.monto_sobrante_devuelto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Componente principal ──────────────────────────────────────
function CajaChica({ usuario, onVolver }) {
  const [usuariosMap, setUsuariosMap] = useState({})

  useEffect(() => {
    // Cargamos el mapa id → nombre una sola vez
    supabase.from('usuarios').select('id, nombre_completo').then(({ data }) => {
      if (data) {
        const map = {}
        data.forEach(u => { map[u.id] = u.nombre_completo })
        setUsuariosMap(map)
      }
    })
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #059669 0%, #0d9488 100%)', padding: 'clamp(1rem, 2vw, 2rem)' }}>
      {/* Header */}
      <div style={{
        background: 'white', padding: '1.5rem', borderRadius: '12px',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)', marginBottom: '2rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '1.8rem', fontWeight: 'bold', marginBottom: '0.25rem', margin: 0 }}>
              💰 Caja Chica
            </h1>
            <p style={{ color: '#6b7280', margin: '0.25rem 0 0 0' }}>
              Usuario: <strong>{usuario.nombre_completo}</strong>
            </p>
          </div>
          <button onClick={onVolver}
            style={{ padding: '0.75rem 1.5rem', background: '#6b7280', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}>
            ← Menú Principal
          </button>
        </div>
      </div>

      {/* Contenido */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
        <SeccionCajaChicaNormal usuarioId={usuario.id} />
        <SeccionCajasEspeciales usuarioId={usuario.id} usuariosMap={usuariosMap} />
      </div>
    </div>
  )
}

export default CajaChica
