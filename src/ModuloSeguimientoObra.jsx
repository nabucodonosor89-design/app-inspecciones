import { C, s } from './correctivos/constantes'
import Seguimiento from './correctivos/Seguimiento'

// ============================================================
// SEGUIMIENTO CORRECTIVOS — vista para residentes de obra (celular).
// Ve y carga novedades de las ubicaciones de su zona (insp_zona_inspectores, zona tipo
// 'residente', vigente) y de los hilos donde participa (reportó o cargó novedades, aunque
// el equipo esté en otra obra). Reporta problemas sin aviso, termina sus hilos y arma el
// «Parte del día» para WhatsApp (24/11/2026). La RPC filtra; acá no se decide nada de permisos.
// ============================================================
export default function ModuloSeguimientoObra({ onVolver }) {
  return (
    <div style={{ minHeight: '100vh', background: C.fondo }}>
      <div style={s.wrap}>
        <div style={s.header}>
          <button style={s.boton} onClick={onVolver} aria-label="Volver">←</button>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Seguimiento de correctivos</h2>
            <div style={s.meta}>Órdenes y avisos de tu obra · cargá qué pasa con cada uno y armá el parte del día</div>
          </div>
        </div>
        <Seguimiento modo="residente" />
      </div>
    </div>
  )
}
