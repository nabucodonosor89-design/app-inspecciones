// Edge Function: recordatorio-inspecciones
// Disparo: cada lunes a las 7:00 AM (Paraguay, UTC-4)
// Qué hace: consulta equipos activos sin inspección reciente y envía
//           un email de resumen a todos los usuarios del sistema.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY  = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// ── Umbrales de alerta ────────────────────────────────────────────
const DIAS_CRITICO  = 30   // sin inspección hace más de 30 días → URGENTE
const DIAS_AVISO    = 14   // sin inspección hace 14-30 días    → PENDIENTE
// Equipos con inspección en los últimos 14 días se consideran al día.

// ── Tipos ─────────────────────────────────────────────────────────
interface Equipo {
  id: string
  numero_identificacion: string
  denominacion: string
  tipo_equipo: string
  ubicacion_actual: string
  estado_operativo: string
  semaforo_actual: string
  ultima_inspeccion: string | null
  dias_sin_inspeccion: number | null
}

interface Usuario {
  nombre_completo: string
  email: string
}

Deno.serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

    // ── 1. Consultar equipos activos con su última inspección ──────
    const { data: equipos, error: errEquipos } = await supabase.rpc(
      'equipos_sin_inspeccion_reciente'
    )
    if (errEquipos) throw errEquipos

    const pendientes = (equipos as Equipo[]) ?? []

    // Si todos los equipos están al día, no enviamos email
    if (pendientes.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, mensaje: 'Todos los equipos inspeccionados. No se envió email.' }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // ── 2. Separar por urgencia ────────────────────────────────────
    const urgentes  = pendientes.filter(e => (e.dias_sin_inspeccion ?? 999) >= DIAS_CRITICO)
    const avisos    = pendientes.filter(e => {
      const d = e.dias_sin_inspeccion ?? 999
      return d >= DIAS_AVISO && d < DIAS_CRITICO
    })

    // ── 3. Obtener destinatarios ───────────────────────────────────
    const { data: usuarios, error: errUsuarios } = await supabase
      .from('usuarios')
      .select('nombre_completo, email')

    if (errUsuarios) throw errUsuarios
    const destinatarios = (usuarios as Usuario[]) ?? []

    if (destinatarios.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: 'No hay usuarios en la tabla.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // ── 4. Armar el email ──────────────────────────────────────────
    const hoy    = new Date().toLocaleDateString('es-PY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    const asunto = urgentes.length > 0
      ? `🔴 ${urgentes.length} equipo${urgentes.length > 1 ? 's' : ''} URGENTE${urgentes.length > 1 ? 'S' : ''} sin inspección — TyE`
      : `📋 Resumen semanal de inspecciones — TyE`

    const html = armarEmailHTML({ urgentes, avisos, total: pendientes.length, hoy })

    // ── 5. Enviar a cada destinatario ──────────────────────────────
    const envios = await Promise.allSettled(
      destinatarios.map(u =>
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'TyE Inspecciones <recordatorios@tye.itcsa.com.py>',
            to: [u.email],
            subject: asunto,
            html,
          }),
        }).then(r => r.json())
      )
    )

    const enviados  = envios.filter(r => r.status === 'fulfilled').length
    const fallidos  = envios.filter(r => r.status === 'rejected').length

    return new Response(
      JSON.stringify({
        ok: true,
        equipos_pendientes: pendientes.length,
        urgentes: urgentes.length,
        avisos: avisos.length,
        emails_enviados: enviados,
        emails_fallidos: fallidos,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('Error en recordatorio-inspecciones:', err)
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})

// ── Generador del HTML del email ───────────────────────────────────
function armarEmailHTML({
  urgentes,
  avisos,
  total,
  hoy,
}: {
  urgentes: Equipo[]
  avisos: Equipo[]
  total: number
  hoy: string
}) {
  const filaEquipo = (e: Equipo, urgente: boolean) => {
    const dias     = e.dias_sin_inspeccion
    const diasTexto = dias === null ? 'Sin registro' : `${dias} días`
    const semaforo = e.semaforo_actual === 'rojo' ? '🔴'
                   : e.semaforo_actual === 'amarillo' ? '🟡'
                   : e.semaforo_actual === 'verde' ? '🟢' : '⚪'
    const bgFila   = urgente ? '#fff5f5' : '#fffbeb'
    const colorDias = urgente ? '#dc2626' : '#d97706'

    return `
      <tr style="background:${bgFila}; border-bottom:1px solid #e5e7eb;">
        <td style="padding:10px 12px; font-weight:700; color:#111827; white-space:nowrap;">
          ${semaforo} ${e.numero_identificacion}
        </td>
        <td style="padding:10px 12px; color:#374151; font-size:13px;">
          ${e.denominacion}
        </td>
        <td style="padding:10px 12px; color:#6b7280; font-size:13px;">
          ${e.ubicacion_actual || '—'}
        </td>
        <td style="padding:10px 12px; font-weight:700; color:${colorDias}; text-align:center; white-space:nowrap;">
          ${diasTexto}
        </td>
      </tr>`
  }

  const tablaEquipos = (lista: Equipo[], urgente: boolean) => lista.length === 0 ? '' : `
    <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden; margin-bottom:24px;">
      <thead>
        <tr style="background:${urgente ? '#fef2f2' : '#fffbeb'};">
          <th style="padding:10px 12px; text-align:left; font-size:12px; color:#6b7280; font-weight:700; border-bottom:2px solid ${urgente ? '#fca5a5' : '#fde68a'};">EQUIPO</th>
          <th style="padding:10px 12px; text-align:left; font-size:12px; color:#6b7280; font-weight:700; border-bottom:2px solid ${urgente ? '#fca5a5' : '#fde68a'};">DESCRIPCIÓN</th>
          <th style="padding:10px 12px; text-align:left; font-size:12px; color:#6b7280; font-weight:700; border-bottom:2px solid ${urgente ? '#fca5a5' : '#fde68a'};">UBICACIÓN</th>
          <th style="padding:10px 12px; text-align:center; font-size:12px; color:#6b7280; font-weight:700; border-bottom:2px solid ${urgente ? '#fca5a5' : '#fde68a'};">DÍAS SIN INSPECCIÓN</th>
        </tr>
      </thead>
      <tbody>
        ${lista.map(e => filaEquipo(e, urgente)).join('')}
      </tbody>
    </table>`

  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">

  <div style="max-width:680px; margin:32px auto; background:white; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%); padding:32px 40px;">
      <p style="margin:0; color:rgba(255,255,255,0.7); font-size:13px;">🏗️ Sistema de Gestión TyE</p>
      <h1 style="margin:8px 0 4px; color:white; font-size:24px; font-weight:700;">Recordatorio de Inspecciones</h1>
      <p style="margin:0; color:rgba(255,255,255,0.7); font-size:14px;">${hoy}</p>
    </div>

    <div style="padding:32px 40px;">

      <!-- Resumen -->
      <div style="display:flex; gap:16px; margin-bottom:32px;">
        <div style="flex:1; background:#fef2f2; border:2px solid #fca5a5; border-radius:12px; padding:20px; text-align:center;">
          <div style="font-size:32px; font-weight:800; color:#dc2626; line-height:1;">${urgentes.length}</div>
          <div style="font-size:13px; color:#991b1b; font-weight:600; margin-top:4px;">URGENTES<br><span style="font-weight:400;">(+30 días)</span></div>
        </div>
        <div style="flex:1; background:#fffbeb; border:2px solid #fde68a; border-radius:12px; padding:20px; text-align:center;">
          <div style="font-size:32px; font-weight:800; color:#d97706; line-height:1;">${avisos.length}</div>
          <div style="font-size:13px; color:#92400e; font-weight:600; margin-top:4px;">PENDIENTES<br><span style="font-weight:400;">(14-30 días)</span></div>
        </div>
        <div style="flex:1; background:#eff6ff; border:2px solid #bfdbfe; border-radius:12px; padding:20px; text-align:center;">
          <div style="font-size:32px; font-weight:800; color:#2563eb; line-height:1;">${total}</div>
          <div style="font-size:13px; color:#1e40af; font-weight:600; margin-top:4px;">TOTAL<br><span style="font-weight:400;">sin inspeccionar</span></div>
        </div>
      </div>

      ${urgentes.length > 0 ? `
      <!-- Urgentes -->
      <h2 style="margin:0 0 12px; font-size:16px; font-weight:700; color:#dc2626;">
        🔴 Urgentes — más de 30 días sin inspección
      </h2>
      ${tablaEquipos(urgentes, true)}` : ''}

      ${avisos.length > 0 ? `
      <!-- Avisos -->
      <h2 style="margin:0 0 12px; font-size:16px; font-weight:700; color:#d97706;">
        🟡 Pendientes — 14 a 30 días sin inspección
      </h2>
      ${tablaEquipos(avisos, false)}` : ''}

      <!-- CTA -->
      <div style="text-align:center; margin-top:8px;">
        <p style="color:#6b7280; font-size:14px; margin:0 0 16px;">
          Ingresá al sistema para registrar las inspecciones pendientes.
        </p>
      </div>

    </div>

    <!-- Footer -->
    <div style="background:#f9fafb; border-top:1px solid #e5e7eb; padding:20px 40px; text-align:center;">
      <p style="margin:0; font-size:12px; color:#9ca3af;">
        Sistema de Gestión TyE · T&amp;C SA · Este email se envía automáticamente cada lunes.
      </p>
    </div>

  </div>
</body>
</html>`
}
