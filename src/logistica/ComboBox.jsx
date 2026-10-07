import { useRef, useState } from 'react'
import { estilos } from './constantes'

/**
 * Input con filtrado en tiempo real (extraído de la antigua GestionFletes).
 * - opciones: array de objetos
 * - getId / getLabel: accesores
 * - getDetalle (opcional): texto secundario a la derecha
 * - onCrear (opcional): muestra "＋ Crear «texto»" cuando no hay coincidencia exacta
 */
export default function ComboBox({
  opciones, valor, onChange, placeholder, getLabel, getId, getDetalle, disabled, onCrear, autoFocus,
}) {
  const [busqueda, setBusqueda]   = useState('')
  const [abierto, setAbierto]     = useState(false)
  const [resaltado, setResaltado] = useState(-1)
  const listaRef = useRef(null)

  const seleccionado = opciones.find(o => getId(o) === valor)
  const textoInput   = abierto ? busqueda : (seleccionado ? getLabel(seleccionado) : '')

  const q = busqueda.trim().toLowerCase()
  const filtradas = q
    ? opciones.filter(o => (getLabel(o) + ' ' + (getDetalle?.(o) || '')).toLowerCase().includes(q))
    : opciones
  const hayExacta = opciones.some(o => getLabel(o).trim().toLowerCase() === q)
  const mostrarCrear = !!onCrear && q.length > 1 && !hayExacta

  const cerrar = () => { setAbierto(false); setBusqueda('') }

  const handleSelect = (opcion) => { onChange(getId(opcion)); cerrar() }

  const handleKeyDown = (e) => {
    if (!abierto) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setResaltado(r => Math.min(r + 1, filtradas.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setResaltado(r => Math.max(r - 1, 0)) }
    if (e.key === 'Enter' && resaltado >= 0 && filtradas[resaltado]) { e.preventDefault(); handleSelect(filtradas[resaltado]) }
    if (e.key === 'Escape') cerrar()
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        value={textoInput}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={e => { setBusqueda(e.target.value); setResaltado(-1); if (!abierto) setAbierto(true) }}
        onFocus={() => { if (!disabled) { setAbierto(true); setBusqueda(''); setResaltado(-1) } }}
        onBlur={e => { if (!listaRef.current?.contains(e.relatedTarget)) cerrar() }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        style={{ ...estilos.input, background: disabled ? '#f9fafb' : '#fff' }}
      />
      {abierto && (
        <div
          ref={listaRef}
          tabIndex={-1}
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            background: '#fff', border: '1px solid #d1d5db', borderRadius: '10px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 400,
            maxHeight: '260px', overflowY: 'auto',
          }}
        >
          {filtradas.length === 0 && !mostrarCrear && (
            <div style={{ padding: '12px 14px', fontSize: '14px', color: '#9ca3af' }}>Sin resultados</div>
          )}
          {filtradas.map((o, i) => (
            <div
              key={getId(o)}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(o) }}
              style={{
                padding: '12px 14px', fontSize: '15px', cursor: 'pointer',
                background: i === resaltado ? '#eff6ff' : getId(o) === valor ? '#f8fafc' : 'transparent',
                color: '#111827', borderBottom: '1px solid #f3f4f6',
                display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center',
              }}
            >
              <span>{getLabel(o)}</span>
              {getDetalle && <span style={{ fontSize: '12px', color: '#6b7280', flexShrink: 0 }}>{getDetalle(o)}</span>}
            </div>
          ))}
          {mostrarCrear && (
            <div
              onMouseDown={(e) => { e.preventDefault(); const t = busqueda.trim(); cerrar(); onCrear(t) }}
              style={{ padding: '12px 14px', fontSize: '15px', cursor: 'pointer', color: '#1d4ed8', fontWeight: 700 }}
            >
              ＋ Crear «{busqueda.trim()}»
            </div>
          )}
        </div>
      )}
    </div>
  )
}
