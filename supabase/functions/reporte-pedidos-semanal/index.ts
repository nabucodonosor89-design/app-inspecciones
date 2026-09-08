// Edge Function: reporte-pedidos-semanal
// Llamada por Power Automate cada lunes a las 7:00 AM (Paraguay, UTC-3)
// Qué hace: consulta todos los pedidos de equipos pendientes de entrega
//           y devuelve JSON con los emails HTML pre-armados, listos para
//           que PA los envíe por Outlook sin necesidad de construir HTML en el flujo.
//
// Seguridad: requiere el header  x-api-secret: <REPORTE_PEDIDOS_SECRET>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const API_SECRET   = Deno.env.get('REPORTE_PEDIDOS_SECRET')!

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface PedidoRaw {
  numero_pedido:          string
  email_solicitante:      string
  tipo_equipo_solicitado: string
  cantidad_solicitada:    number
  fecha_recepcion:        string
  estado_aprobacion:      string
  estado_entrega:         string
  fecha_estimada_entrega: string | null
  comentarios:            string | null
  obra:        { codigo_obra: string; nombre_obra: string } | null
  equipo_asignado: { numero_identificacion: string; denominacion: string } | null
  mantenimiento:   { numero_aviso: string; estado: string } | null
}

// ── Handler principal ─────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'x-api-secret',
      },
    })
  }

  // Validar secret
  const secret = req.headers.get('x-api-secret')
  if (!secret || secret !== API_SECRET) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

    // ── 1. Consultar pedidos pendientes ────────────────────────────────────────
    const { data, error } = await supabase
      .from('pedidos_equipos_lineas')
      .select(`
        numero_pedido,
        email_solicitante,
        tipo_equipo_solicitado,
        cantidad_solicitada,
        fecha_recepcion,
        estado_aprobacion,
        estado_entrega,
        fecha_estimada_entrega,
        comentarios,
        obra:obras(codigo_obra, nombre_obra),
        equipo_asignado:equipos(numero_identificacion, denominacion),
        mantenimiento:mantenimientos(numero_aviso, estado)
      `)
      .not('estado_entrega', 'in', '(entregado,cancelado)')
      .neq('estado_aprobacion', 'rechazado')
      .order('fecha_recepcion', { ascending: true })

    if (error) throw error

    const pedidos = (data || []) as PedidoRaw[]

    // Sin pendientes: no hay nada que enviar
    if (pedidos.length === 0) {
      return new Response(JSON.stringify({
        ok:               true,
        total_pendientes: 0,
        mensaje:          'No hay pedidos pendientes. No se generaron emails.',
        solicitantes:     [],
        email_interno:    null,
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    // ── 2. Agrupar por solicitante ─────────────────────────────────────────────
    const porSolicitante: Record<string, PedidoRaw[]> = {}
    for (const p of pedidos) {
      const email = (p.email_solicitante || 'sin_email').toLowerCase().trim()
      if (!porSolicitante[email]) porSolicitante[email] = []
      porSolicitante[email].push(p)
    }

    const semana   = getSemana()
    const fechaHoy = new Date().toLocaleDateString('es-PY', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })

    // ── 3. Armar email por solicitante ─────────────────────────────────────────
    const solicitantes = Object.entries(porSolicitante).map(([email, items]) => ({
      email,
      total:     items.length,
      asunto:    `📋 Estado de tus pedidos de equipos — ${semana}`,
      html_body: buildEmailSolicitante(email, items, fechaHoy),
    }))

    // ── 4. Armar email del equipo interno ──────────────────────────────────────
    const emailInterno = {
      asunto:    `📋 Pedidos pendientes de entrega — ${semana} (${pedidos.length} equipos)`,
      html_body: buildEmailInterno(
        porSolicitante,
        pedidos.length,
        Object.keys(porSolicitante).length,
        fechaHoy,
      ),
    }

    return new Response(JSON.stringify({
      ok:                  true,
      total_pendientes:    pedidos.length,
      total_solicitantes:  Object.keys(porSolicitante).length,
      solicitantes,
      email_interno:       emailInterno,
    }), { headers: { 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error('Error en reporte-pedidos-semanal:', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSemana(): string {
  const now   = new Date()
  const start = new Date(now.getFullYear(), 0, 1)
  const week  = Math.ceil(((now.getTime() - start.getTime()) / 86_400_000 + start.getDay() + 1) / 7)
  return `Semana ${week} / ${now.getFullYear()}`
}

function diasDesde(fecha: string): number {
  return Math.floor((Date.now() - new Date(fecha).getTime()) / 86_400_000)
}

function fmtFecha(f: string | null): string {
  if (!f) return '—'
  return new Date(f).toLocaleDateString('es-PY')
}

function etiquetaEstado(p: PedidoRaw): string {
  if (p.estado_aprobacion === 'pendiente_aprobacion') return '⏳ Pend. Aprobación'
  if (p.estado_entrega === 'asignado')                return '🔵 Asignado'
  return '⚪ Sin asignar'
}

function estiloEstado(p: PedidoRaw): { bg: string; color: string } {
  if (p.estado_aprobacion === 'pendiente_aprobacion') return { bg: '#fef3c7', color: '#92400e' }
  if (p.estado_entrega === 'asignado')                return { bg: '#dbeafe', color: '#1e40af' }
  return { bg: '#f3f4f6', color: '#4b5563' }
}

function comentariosPedido(p: PedidoRaw): string {
  return [
    p.mantenimiento?.estado ? `OT: ${p.mantenimiento.estado}` : null,
    p.comentarios,
  ].filter(Boolean).join(' · ') || '—'
}

// ── Builder: email para el solicitante ────────────────────────────────────────

function buildEmailSolicitante(
  email:    string,
  pedidos:  PedidoRaw[],
  fechaHoy: string,
): string {
  const filas = pedidos.map(p => {
    const obra    = p.obra ? `${p.obra.codigo_obra} — ${p.obra.nombre_obra}` : '—'
    const asig    = p.equipo_asignado?.numero_identificacion || '—'
    const est     = estiloEstado(p)
    const etiq    = etiquetaEstado(p)
    const fechaE  = fmtFecha(p.fecha_estimada_entrega)
    const coment  = comentariosPedido(p)

    return `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:10px 12px;color:#374151;font-size:13px;">${obra}</td>
        <td style="padding:10px 12px;color:#111827;font-weight:600;font-size:13px;">${p.tipo_equipo_solicitado}</td>
        <td style="padding:10px 12px;color:#374151;font-size:13px;">${asig}</td>
        <td style="padding:10px 12px;text-align:center;">
          <span style="background:${est.bg};color:${est.color};padding:3px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;">${etiq}</span>
        </td>
        <td style="padding:10px 12px;color:#6b7280;font-size:12px;text-align:center;white-space:nowrap;">${fechaE}</td>
        <td style="padding:10px 12px;color:#6b7280;font-size:12px;">${coment}</td>
      </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:700px;margin:32px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <div style="background:linear-gradient(135deg,#1e3a5f 0%,#10b981 100%);padding:32px 40px;">
    <p style="margin:0;color:rgba(255,255,255,0.7);font-size:13px;">🏗️ Departamento de Transporte y Equipos — T&amp;C SA</p>
    <h1 style="margin:8px 0 4px;color:white;font-size:22px;font-weight:700;">Estado de tus pedidos de equipos</h1>
    <p style="margin:0;color:rgba(255,255,255,0.8);font-size:14px;">${fechaHoy}</p>
  </div>

  <div style="padding:32px 40px;">

    <div style="background:#f0fdf4;border:2px solid #a7f3d0;border-radius:12px;padding:20px 24px;margin-bottom:28px;display:flex;align-items:center;gap:16px;">
      <div style="font-size:40px;line-height:1;">📋</div>
      <div>
        <div style="font-size:32px;font-weight:800;color:#065f46;line-height:1;">${pedidos.length}</div>
        <div style="font-size:14px;color:#047857;font-weight:600;margin-top:4px;">
          equipo${pedidos.length !== 1 ? 's' : ''} pendiente${pedidos.length !== 1 ? 's' : ''} de entrega
        </div>
      </div>
    </div>

    <table width="100%" cellspacing="0" cellpadding="0"
           style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#f9fafb;">
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:700;border-bottom:2px solid #e5e7eb;">OBRA</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:700;border-bottom:2px solid #e5e7eb;">EQUIPO SOLICITADO</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:700;border-bottom:2px solid #e5e7eb;">ASIGNADO</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;color:#6b7280;font-weight:700;border-bottom:2px solid #e5e7eb;">ESTADO</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;color:#6b7280;font-weight:700;border-bottom:2px solid #e5e7eb;">FECHA EST.</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:700;border-bottom:2px solid #e5e7eb;">COMENTARIOS</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>

    <p style="color:#6b7280;font-size:13px;margin-top:24px;line-height:1.6;">
      Para consultas sobre el estado de tus pedidos, contactá al Departamento de Transporte y Equipos.
    </p>

  </div>

  <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">
      Sistema de Gestión TyE · T&amp;C SA · Este reporte se envía automáticamente cada lunes.
    </p>
  </div>

</div>
</body>
</html>`
}

// ── Builder: email para el equipo interno ─────────────────────────────────────

function buildEmailInterno(
  porSolicitante: Record<string, PedidoRaw[]>,
  total:          number,
  totalSolic:     number,
  fechaHoy:       string,
): string {
  const secciones = Object.entries(porSolicitante).map(([email, items]) => {
    const filas = items.map(p => {
      const obra   = p.obra?.codigo_obra || '—'
      const asig   = p.equipo_asignado?.numero_identificacion || '—'
      const est    = estiloEstado(p)
      const etiq   = etiquetaEstado(p)
      const dias   = diasDesde(p.fecha_recepcion)
      const bgDias = dias > 14 ? '#fee2e2' : dias > 7 ? '#fef3c7' : '#d1fae5'
      const cDias  = dias > 14 ? '#dc2626' : dias > 7 ? '#d97706' : '#059669'
      const coment = comentariosPedido(p)

      return `
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:8px 12px;color:#6b7280;font-size:12px;white-space:nowrap;">${obra}</td>
          <td style="padding:8px 12px;color:#111827;font-weight:600;font-size:13px;">${p.tipo_equipo_solicitado}</td>
          <td style="padding:8px 12px;color:#374151;font-size:13px;">${asig}</td>
          <td style="padding:8px 12px;text-align:center;">
            <span style="background:${est.bg};color:${est.color};padding:2px 7px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap;">${etiq}</span>
          </td>
          <td style="padding:8px 12px;text-align:center;">
            <span style="background:${bgDias};color:${cDias};padding:2px 8px;border-radius:999px;font-size:12px;font-weight:700;">${dias}d</span>
          </td>
          <td style="padding:8px 12px;color:#6b7280;font-size:12px;">${coment}</td>
        </tr>`
    }).join('')

    return `
      <div style="margin-bottom:28px;">
        <div style="background:#f9fafb;border-left:4px solid #10b981;padding:10px 16px;margin-bottom:0;border-radius:6px 6px 0 0;">
          <span style="font-size:13px;font-weight:700;color:#065f46;">✉️ ${email}</span>
          <span style="font-size:12px;color:#6b7280;margin-left:12px;">${items.length} equipo${items.length !== 1 ? 's' : ''}</span>
        </div>
        <table width="100%" cellspacing="0" cellpadding="0"
               style="border-collapse:collapse;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;overflow:hidden;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:700;border-bottom:1px solid #e5e7eb;">OBRA</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:700;border-bottom:1px solid #e5e7eb;">EQUIPO SOLICITADO</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:700;border-bottom:1px solid #e5e7eb;">ASIGNADO</th>
              <th style="padding:8px 12px;text-align:center;font-size:11px;color:#6b7280;font-weight:700;border-bottom:1px solid #e5e7eb;">ESTADO</th>
              <th style="padding:8px 12px;text-align:center;font-size:11px;color:#6b7280;font-weight:700;border-bottom:1px solid #e5e7eb;">DÍAS</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:700;border-bottom:1px solid #e5e7eb;">COMENTARIOS</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:760px;margin:32px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <div style="background:linear-gradient(135deg,#1e3a5f 0%,#10b981 100%);padding:32px 40px;">
    <p style="margin:0;color:rgba(255,255,255,0.7);font-size:13px;">🏗️ Sistema de Gestión TyE — Uso Interno</p>
    <h1 style="margin:8px 0 4px;color:white;font-size:22px;font-weight:700;">Pedidos pendientes de entrega</h1>
    <p style="margin:0;color:rgba(255,255,255,0.8);font-size:14px;">${fechaHoy}</p>
  </div>

  <div style="padding:32px 40px;">

    <div style="display:flex;gap:16px;margin-bottom:28px;">
      <div style="flex:1;background:#fef3c7;border:2px solid #f59e0b;border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:36px;font-weight:800;color:#92400e;line-height:1;">${total}</div>
        <div style="font-size:13px;color:#92400e;font-weight:600;margin-top:6px;">EQUIPOS PENDIENTES</div>
      </div>
      <div style="flex:1;background:#eff6ff;border:2px solid #bfdbfe;border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:36px;font-weight:800;color:#1e40af;line-height:1;">${totalSolic}</div>
        <div style="font-size:13px;color:#1e40af;font-weight:600;margin-top:6px;">SOLICITANTES</div>
      </div>
    </div>

    <div style="background:#f9fafb;border-radius:8px;padding:12px 16px;margin-bottom:28px;font-size:12px;color:#6b7280;">
      <strong>Referencia — días pendientes:</strong>&nbsp;&nbsp;
      <span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:999px;font-weight:700;">+14d</span> Urgente &nbsp;
      <span style="background:#fef3c7;color:#d97706;padding:2px 8px;border-radius:999px;font-weight:700;">7–14d</span> Atención &nbsp;
      <span style="background:#d1fae5;color:#059669;padding:2px 8px;border-radius:999px;font-weight:700;">&lt;7d</span> Normal
    </div>

    ${secciones}

  </div>

  <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">
      Sistema de Gestión TyE · T&amp;C SA · Reporte interno — se envía automáticamente cada lunes.
    </p>
  </div>

</div>
</body>
</html>`
}
