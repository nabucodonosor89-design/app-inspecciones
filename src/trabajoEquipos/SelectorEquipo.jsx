import { useMemo, useState } from 'react'
import { C, s, UNIDAD_LABEL, denominacionLimpia } from './constantes'

const MAX_SUGERENCIAS = 30

function Etiqueta({ e }) {
  return (
    <>
      <span style={{ fontWeight: 700 }}>{e.equipo}</span>
      {e.denom && <span style={{ color: C.gris }}> · {e.denom}</span>}
      <span style={{ ...s.chip('#f3f4f6', C.gris), marginLeft: 6 }}>
        {e.unidad ? `en ${UNIDAD_LABEL[e.unidad]}` : 'sin unidad'}
      </span>
      {!e.activo && <span style={{ ...s.chip('#f3f4f6', C.gris), marginLeft: 4 }}>inactivo</span>}
    </>
  )
}

// Búsqueda por ID técnico o denominación (activos e inactivos)
export default function SelectorEquipo({ equipos, valor, onElegir }) {
  const [texto, setTexto] = useState('')
  const [abierto, setAbierto] = useState(false)

  const lista = useMemo(() => equipos.map((e) => ({ ...e, denom: denominacionLimpia(e.equipo, e.denominacion) })), [equipos])
  const elegido = lista.find((e) => e.equipo === valor)

  const sugerencias = useMemo(() => {
    const q = texto.trim().toLowerCase()
    if (!q) return []
    const qSinGuion = q.replace(/[-\s]/g, '')
    return lista
      .filter((e) => e.equipo.toLowerCase().replace(/[-\s]/g, '').includes(qSinGuion)
        || (e.denom || '').toLowerCase().includes(q))
      // primero los que empiezan con lo buscado, después los activos
      .sort((a, b) => (b.equipo.toLowerCase().startsWith(q) - a.equipo.toLowerCase().startsWith(q))
        || (b.activo - a.activo) || a.equipo.localeCompare(b.equipo))
      .slice(0, MAX_SUGERENCIAS)
  }, [lista, texto])

  function elegir(e) {
    onElegir(e.equipo)
    setTexto('')
    setAbierto(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      {elegido && !abierto ? (
        <button type="button" onClick={() => setAbierto(true)}
          style={{ ...s.input, textAlign: 'left', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
          <span style={{ flex: 1, minWidth: 0 }}><Etiqueta e={elegido} /></span>
          <span style={{ color: C.azul, fontSize: 14, fontWeight: 600 }}>Cambiar</span>
        </button>
      ) : (
        <input
          autoFocus={abierto}
          style={s.input}
          placeholder="Buscar equipo por ID técnico o denominación (ej. PS-RP014)"
          value={texto}
          onChange={(ev) => { setTexto(ev.target.value); setAbierto(true) }}
          onFocus={() => setAbierto(true)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' && sugerencias[0]) elegir(sugerencias[0])
            if (ev.key === 'Escape') { setAbierto(false); setTexto('') }
          }}
        />
      )}
      {abierto && texto.trim() && (
        <div style={{
          position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', marginTop: 4, background: '#fff',
          border: `1px solid ${C.borde}`, borderRadius: 8, boxShadow: '0 8px 20px rgba(0,0,0,0.12)', maxHeight: 320, overflowY: 'auto',
        }}>
          {sugerencias.length === 0 && <div style={s.vacio}>Sin coincidencias</div>}
          {sugerencias.map((e) => (
            <div key={e.equipo} role="button" tabIndex={0} onClick={() => elegir(e)}
              onKeyDown={(ev) => { if (ev.key === 'Enter') elegir(e) }}
              style={{ padding: '10px 12px', borderBottom: `1px solid ${C.borde}`, cursor: 'pointer', fontSize: 14 }}>
              <Etiqueta e={e} />
            </div>
          ))}
        </div>
      )}
      {abierto && elegido && (
        <button type="button" onClick={() => { setAbierto(false); setTexto('') }}
          style={{ marginTop: 4, border: 'none', background: 'none', color: C.gris, cursor: 'pointer', fontSize: 13, padding: 0 }}>
          Cancelar
        </button>
      )}
    </div>
  )
}
