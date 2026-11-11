import { useMemo, useState } from 'react'
import { useEscritorio } from './correctivos/useEscritorio'
import { C, s } from './correctivos/constantes'
import { leerLibro, procesar, filtrarOrdenar, totales, monto, exportarExcel } from './liquidacionOrdenes/procesar'

// ============================================================
// LIQUIDACIÓN DE ÓRDENES — órdenes TCPV / TCOC con saldo pendiente.
// Se suben dos exports de SAP (reporteSaldos + ordenes), el cruce se hace en el navegador
// y no se guarda nada. Abierto a cualquier usuario activo.
// Cerrada = status de usuario 9EQL. Lógica en liquidacionOrdenes/procesar.js
// ============================================================

const ARCHIVOS = [
  { id: 'saldos', icono: '📊', label: 'Archivo 1 — Saldos', nombre: 'reporteSaldos.xlsx', hint: 'Columna B: Orden · Columna F: Saldo' },
  { id: 'ordenes', icono: '📋', label: 'Archivo 2 — Órdenes', nombre: 'ordenes.xlsx', hint: 'Columna C: Tipo · Columna M: Estado' },
]

const COLUMNAS = [
  { col: 'orden', label: 'N° Orden' },
  { col: 'tipo', label: 'Tipo' },
  { col: 'equipo', label: 'Equipo' },
  { col: 'textoBreve', label: 'Descripción' },
  { col: 'cargo', label: 'Cargo', num: true },
  { col: 'abono', label: 'Abono', num: true },
  { col: 'saldo', label: 'Saldo', num: true },
]

const TAG = {
  TCPV: { bg: '#ffedd5', fg: '#c2410c' },
  TCOC: { bg: '#ede9fe', fg: '#6d28d9' },
}

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontVariantNumeric: 'tabular-nums' }

function ZonaArchivo({ def, archivo, onArchivo }) {
  const [encima, setEncima] = useState(false)
  const cargado = !!archivo
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setEncima(true) }}
      onDragLeave={() => setEncima(false)}
      onDrop={(e) => { e.preventDefault(); setEncima(false); if (e.dataTransfer.files[0]) onArchivo(e.dataTransfer.files[0]) }}
      style={{
        display: 'block', cursor: 'pointer', textAlign: 'center', padding: '20px 14px', borderRadius: 10,
        border: `2px ${cargado ? 'solid' : 'dashed'} ${cargado ? C.verde : encima ? C.azul : C.borde}`,
        background: cargado ? C.verdeBg : encima ? C.azulBg : '#fff',
      }}
    >
      <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files[0]) onArchivo(e.target.files[0]); e.target.value = '' }} />
      <div style={{ fontSize: 26, marginBottom: 6 }}>{def.icono}</div>
      <div style={{ ...s.subtitulo, margin: '0 0 2px', fontSize: 11 }}>{def.label}</div>
      <div style={{ ...mono, fontWeight: 600, fontSize: 14 }}>{def.nombre}</div>
      <div style={s.meta}>{def.hint}</div>
      <div style={{ ...mono, marginTop: 8, fontSize: 12, color: cargado ? C.verde : C.gris, wordBreak: 'break-all' }}>
        {cargado ? `✓ ${archivo.nombre}` : 'Tocá o arrastrá el archivo'}
      </div>
    </label>
  )
}

function Tarjeta({ label, valor, sub, color }) {
  return (
    <div style={{ ...s.card, marginBottom: 0, borderLeft: color ? `3px solid ${color}` : s.card.border }}>
      <div style={{ ...s.subtitulo, fontSize: 11, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1, color: color || C.texto, ...mono }}>{valor}</div>
      <div style={{ ...mono, fontSize: 12, color: C.gris, marginTop: 2 }}>{sub}</div>
    </div>
  )
}

function Tag({ tipo }) {
  const t = TAG[tipo] || { bg: C.fondo, fg: C.gris }
  return <span style={{ ...s.chip(t.bg, t.fg), borderRadius: 4, ...mono, fontSize: 11 }}>{tipo}</span>
}

function Seccion({ cual, titulo, color, colorBg, filasTodas, escritorio }) {
  const [tipo, setTipo] = useState('all')
  const [orden, setOrden] = useState({ col: 'saldo', dir: 'desc' })
  const filas = useMemo(() => filtrarOrdenar(filasTodas, tipo, orden), [filasTodas, tipo, orden])
  const t = totales(filas)

  function ordenarPor(col, esNum) {
    setOrden((o) => (o.col === col ? { col, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: esNum ? 'desc' : 'asc' }))
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 4, height: 20, borderRadius: 2, background: color }} />
          <h3 style={{ margin: 0, fontSize: 16 }}>{titulo}</h3>
          <span style={s.chip(colorBg, color)}>{filasTodas.length}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {[['all', 'Todas'], ['TCPV', 'TCPV'], ['TCOC', 'TCOC']].map(([id, label]) => (
            <button key={id} style={s.chipBtn(tipo === id)} onClick={() => setTipo(id)}>{label}</button>
          ))}
          <button style={{ ...s.boton, minHeight: 34, fontSize: 13 }} disabled={!filas.length}
            onClick={() => exportarExcel(filas, cual, tipo)}>⬇ Exportar Excel</button>
        </div>
      </div>

      {filas.length === 0 ? (
        <div style={{ ...s.card, ...s.vacio }}>Sin resultados para este filtro</div>
      ) : escritorio ? (
        <div style={{ ...s.card, padding: 0, overflow: 'hidden' }}>
          <div style={s.scroll}>
            <table style={s.tabla}>
              <thead>
                <tr>
                  {COLUMNAS.map((c) => {
                    const activa = orden.col === c.col
                    return (
                      <th key={c.col} onClick={() => ordenarPor(c.col, c.num)}
                        style={{ ...s.th, cursor: 'pointer', userSelect: 'none', textAlign: c.num ? 'right' : 'left', color: activa ? C.azul : C.gris }}>
                        {c.label} <span style={{ fontSize: 10, opacity: activa ? 1 : 0.5 }}>{activa ? (orden.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.orden}>
                    <td style={{ ...s.td, ...mono, color: C.azul, fontWeight: 600 }}>{f.orden}</td>
                    <td style={s.td}><Tag tipo={f.tipo} /></td>
                    <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{f.equipo || '—'}</td>
                    <td style={{ ...s.td, maxWidth: 320, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={f.textoBreve}>{f.textoBreve}</td>
                    <td style={{ ...s.td, ...mono, textAlign: 'right' }}>{monto(f.cargo)}</td>
                    <td style={{ ...s.td, ...mono, textAlign: 'right' }}>{monto(f.abono)}</td>
                    <td style={{ ...s.td, ...mono, textAlign: 'right', fontWeight: 600 }}>{monto(f.saldo)}</td>
                  </tr>
                ))}
                <tr style={{ background: C.fondo }}>
                  <td colSpan={4} style={{ ...s.td, textAlign: 'right', color: C.gris, fontWeight: 700, fontSize: 12, textTransform: 'uppercase' }}>
                    Total — {filas.length} orden{filas.length !== 1 ? 'es' : ''}
                  </td>
                  <td style={{ ...s.td, ...mono, textAlign: 'right', fontWeight: 700, color: C.azul }}>{monto(t.cargo)}</td>
                  <td style={{ ...s.td, ...mono, textAlign: 'right', fontWeight: 700, color: C.azul }}>{monto(t.abono)}</td>
                  <td style={{ ...s.td, ...mono, textAlign: 'right', fontWeight: 700, color: C.azul }}>{monto(t.saldo)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          <div style={{ ...s.chips, alignItems: 'center' }}>
            <span style={s.meta}>Ordenar:</span>
            {[['saldo', 'Saldo', true], ['orden', 'N° orden', false], ['equipo', 'Equipo', false]].map(([col, label, esNum]) => (
              <button key={col} style={s.chipBtn(orden.col === col)} onClick={() => ordenarPor(col, esNum)}>
                {label}{orden.col === col ? (orden.dir === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            ))}
          </div>
          <div style={{ ...s.card, background: C.fondo, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontWeight: 700 }}>Total — {filas.length} orden{filas.length !== 1 ? 'es' : ''}</span>
            <span style={{ ...mono, fontWeight: 700, color: C.azul }}>{monto(t.saldo)}</span>
          </div>
          {filas.map((f) => (
            <div key={f.orden} style={{ ...s.card, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ ...mono, color: C.azul, fontWeight: 600 }}>{f.orden}</span>
                <Tag tipo={f.tipo} />
              </div>
              <div style={{ fontWeight: 600, marginTop: 4 }}>{f.equipo || '—'}</div>
              <div style={{ ...s.meta, marginBottom: 6 }}>{f.textoBreve}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
                <span style={s.meta}>Cargo <span style={mono}>{monto(f.cargo)}</span></span>
                <span style={s.meta}>Abono <span style={mono}>{monto(f.abono)}</span></span>
                <span style={{ ...mono, fontWeight: 700 }}>{monto(f.saldo)}</span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

export default function ModuloLiquidacionOrdenes({ onVolver }) {
  const escritorio = useEscritorio()
  const [libros, setLibros] = useState({ saldos: null, ordenes: null }) // { nombre, wb }
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)

  async function cargar(id, file) {
    setError(null)
    try {
      const wb = await leerLibro(file)
      setLibros((l) => ({ ...l, [id]: { nombre: file.name, wb } }))
      setResultado(null)
    } catch (err) {
      setError(`Error leyendo ${file.name}: ${err.message}`)
    }
  }

  function procesarArchivos() {
    setError(null)
    try {
      setResultado(procesar(libros.saldos.wb, libros.ordenes.wb))
    } catch (err) {
      setError(`Error procesando: ${err.message}`)
    }
  }

  function limpiar() {
    setLibros({ saldos: null, ordenes: null })
    setResultado(null)
    setError(null)
  }

  const listo = libros.saldos && libros.ordenes
  const tA = resultado ? totales(resultado.abiertas) : null
  const tC = resultado ? totales(resultado.cerradas) : null

  return (
    <div style={{ minHeight: '100vh', background: C.fondo }}>
      <div style={s.wrap}>
        <div style={s.header}>
          <button style={s.boton} onClick={onVolver} aria-label="Volver">←</button>
          <div style={{ flex: 1, minWidth: 180 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Liquidación de órdenes</h2>
            <div style={s.meta}>Cargá los dos archivos SAP para ver las órdenes TCPV y TCOC con saldo pendiente. No se guarda nada.</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: escritorio ? '1fr 1fr' : '1fr', gap: 12, marginBottom: 12 }}>
          {ARCHIVOS.map((def) => (
            <ZonaArchivo key={def.id} def={def} archivo={libros[def.id]} onArchivo={(f) => cargar(def.id, f)} />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
          <button onClick={procesarArchivos} disabled={!listo}
            style={{ ...s.boton, background: C.azul, color: '#fff', border: 'none', fontWeight: 600, opacity: listo ? 1 : 0.4, cursor: listo ? 'pointer' : 'not-allowed' }}>
            ⚙ Procesar
          </button>
          <button style={{ ...s.boton, color: C.gris }} onClick={limpiar}>Limpiar</button>
          {error && <span style={{ color: C.rojo, fontSize: 14 }}>{error}</span>}
        </div>

        {resultado && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: escritorio ? 'repeat(4, 1fr)' : 'repeat(2, 1fr)', gap: 12, marginBottom: 20 }}>
              <Tarjeta label="Total con saldo" valor={resultado.abiertas.length + resultado.cerradas.length} sub={`Σ ${monto(tA.saldo + tC.saldo)}`} />
              <Tarjeta label="Abiertas" valor={resultado.abiertas.length} sub={`Σ ${monto(tA.saldo)}`} color={C.rojo} />
              <Tarjeta label="Cerradas" valor={resultado.cerradas.length} sub={`Σ ${monto(tC.saldo)}`} color={C.verde} />
              <Tarjeta label="Sin cruce" valor={resultado.sinCruce} sub="no halladas en ordenes.xlsx" />
            </div>

            <Seccion cual="abiertas" titulo="Órdenes abiertas con saldo" color={C.rojo} colorBg={C.rojoBg}
              filasTodas={resultado.abiertas} escritorio={escritorio} />
            <Seccion cual="cerradas" titulo="Órdenes cerradas con saldo" color={C.verde} colorBg={C.verdeBg}
              filasTodas={resultado.cerradas} escritorio={escritorio} />
          </>
        )}
      </div>
    </div>
  )
}
