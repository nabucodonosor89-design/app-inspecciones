import { useEffect, useState } from 'react'
import BandejaLogistica from './logistica/BandejaLogistica'
import FormularioEncargo from './logistica/FormularioEncargo'
import DetalleEncargo from './logistica/DetalleEncargo'
import Planificacion from './logistica/Planificacion'
import { cargarCatalogos } from './logistica/datos'
import { useEsEscritorio, AZUL } from './logistica/constantes'

/**
 * Módulo Logística v2 — planificación de fletes con camiones propios.
 * Encargo (qué / desde / hacia / cantidad opcional) → Asignación (camión + día).
 * Solo para roles admin y logistica.
 */
export default function ModuloLogistica({ usuario, onVolver }) {
  const escritorio = useEsEscritorio()
  const [vista, setVista] = useState('bandeja') // bandeja | plan | nuevo | editar | detalle
  const [vistaBase, setVistaBase] = useState('bandeja') // a dónde vuelve el detalle
  const [encargoId, setEncargoId] = useState(null)
  const [encargoEditar, setEncargoEditar] = useState(null)
  const [catalogos, setCatalogos] = useState(null)
  const [errorCarga, setErrorCarga] = useState(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    cargarCatalogos().then(setCatalogos).catch(e => setErrorCarga(e.message || String(e)))
  }, [])

  const autorizado = usuario?.rol === 'admin' || usuario?.rol === 'logistica'
  if (!autorizado) return null

  const ir = (v) => {
    setVista(v)
    if (v === 'bandeja' || v === 'plan') {
      setVistaBase(v)
      // Releer catálogos: puede haber camiones u obras nuevos desde que se abrió el módulo
      cargarCatalogos().then(setCatalogos).catch(() => {})
    }
    window.scrollTo(0, 0)
  }
  const abrirEncargo = (id) => { setEncargoId(id); setVista('detalle'); window.scrollTo(0, 0) }
  const lugarCreado = (l) => setCatalogos(c => ({ ...c, lugares: [...c.lugares, l].sort((a, b) => a.nombre.localeCompare(b.nombre)) }))
  const huboCambio = () => setVersion(v => v + 1)

  const volver = () => {
    if (vista === 'detalle' || vista === 'nuevo') return ir(vistaBase)
    if (vista === 'editar') return setVista('detalle')
    if (vista === 'plan') return ir('bandeja')
    onVolver()
  }

  const titulo = {
    bandeja: 'Bandeja de encargos', plan: escritorio ? 'Planificación semanal' : 'Camiones por día',
    nuevo: 'Nuevo encargo', editar: 'Editar encargo', detalle: 'Detalle del encargo',
  }[vista]

  const tab = (id, label, icono) => {
    const activo = vista === id || (id !== 'nuevo' && vista !== 'nuevo' && vistaBase === id && ['detalle', 'editar'].includes(vista))
    return { id, label, icono, activo }
  }
  const tabs = [tab('bandeja', 'Bandeja', '📥'), tab('plan', escritorio ? 'Semana' : 'Día', '📅'), tab('nuevo', 'Encargo', '＋')]

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb' }}>
      {/* Header */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '10px 12px',
        display: 'flex', alignItems: 'center', gap: '10px', position: 'sticky', top: 0, zIndex: 50,
      }}>
        <button onClick={volver} title="Volver"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '24px', lineHeight: 1, padding: '6px 8px', minWidth: '44px', minHeight: '44px' }}>
          ←
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#111827' }}>🚛 Logística</div>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>{titulo}</div>
        </div>
        {escritorio && (
          <div style={{ display: 'flex', gap: '6px' }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => ir(t.id)} style={{
                padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px',
                border: t.activo ? `2px solid ${AZUL}` : '1px solid #d1d5db',
                background: t.id === 'nuevo' ? AZUL : t.activo ? '#eff6ff' : '#fff',
                color: t.id === 'nuevo' ? '#fff' : t.activo ? AZUL : '#374151', fontWeight: 700,
              }}>{t.icono} {t.id === 'nuevo' ? 'Nuevo encargo' : t.label}</button>
            ))}
          </div>
        )}
      </div>

      {errorCarga && (
        <div style={{ margin: '16px', padding: '14px', borderRadius: '10px', background: '#fef2f2', color: '#991b1b', fontSize: '14px' }}>
          No se pudieron cargar los datos del módulo: {errorCarga}
        </div>
      )}
      {!catalogos && !errorCarga && <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>Cargando…</div>}

      {catalogos && (
        <>
          {vista === 'bandeja' && (
            <BandejaLogistica catalogos={catalogos} version={version} onAbrirEncargo={abrirEncargo} onNuevo={() => ir('nuevo')} />
          )}
          {vista === 'plan' && (
            <Planificacion catalogos={catalogos} version={version} onAbrirEncargo={abrirEncargo} />
          )}
          {vista === 'nuevo' && (
            <FormularioEncargo catalogos={catalogos} onLugarCreado={lugarCreado}
              onGuardado={() => { huboCambio(); ir('bandeja') }} onCancelar={() => ir(vistaBase)} />
          )}
          {vista === 'editar' && encargoEditar && (
            <FormularioEncargo catalogos={catalogos} onLugarCreado={lugarCreado} encargo={encargoEditar}
              onGuardado={(id) => { huboCambio(); abrirEncargo(id) }} onCancelar={() => setVista('detalle')} />
          )}
          {vista === 'detalle' && encargoId && (
            <DetalleEncargo key={`${encargoId}-${version}`} encargoId={encargoId} catalogos={catalogos}
              onEditar={(e) => { setEncargoEditar(e); setVista('editar') }} onCambio={huboCambio} />
          )}
        </>
      )}

      {/* Navegación inferior (celular) */}
      {!escritorio && vista !== 'nuevo' && vista !== 'editar' && (
        <nav style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, background: '#fff', borderTop: '1px solid #e5e7eb',
          display: 'flex', zIndex: 1000, paddingBottom: 'env(safe-area-inset-bottom)',
        }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => ir(t.id)} style={{
              flex: 1, minHeight: '60px', border: 'none', background: 'none', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px',
              color: t.activo ? AZUL : '#6b7280', fontWeight: t.activo ? 800 : 600, fontSize: '12px',
            }}>
              {t.id === 'nuevo' ? (
                <span style={{ background: AZUL, color: '#fff', borderRadius: '999px', width: '34px', height: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>＋</span>
              ) : <span style={{ fontSize: '20px' }}>{t.icono}</span>}
              {t.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}
