# Arquitectura técnica — app-inspecciones

## Stack
| Capa | Tecnología | Versión |
|------|-----------|---------|
| Frontend | React | 19 |
| Build | Vite | 7 |
| Backend / BD | Supabase (PostgreSQL) | — |
| Auth | Supabase Auth | — |
| Edge Functions | Deno (TypeScript) en Supabase | — |
| Scheduler | pg_cron (extensión PostgreSQL) | — |
| Almacenamiento fotos | Cloudinary | — |
| Email transaccional | Resend | — |
| PDF | jsPDF + jspdf-autotable | — |
| Excel | xlsx (SheetJS) | — |

## Flujo de autenticación
1. Login con `supabase.auth.signInWithPassword()`
2. Tras el login, consulta tabla `usuarios` con `select('*')` (overfetch — pendiente optimizar)
3. Estado del usuario en memoria de React (no persistido entre reloads salvo sesión de Supabase)

## Arquitectura de navegación
- **Sin React Router** — navegación por variable de estado `modulo` en `App.jsx`
- Cada módulo es un componente que se renderiza condicionalmente
- Consecuencia: URL no refleja el módulo activo (no hay deep-linking)

## Flujo de inspección
1. **Paso 1:** Seleccionar equipo activo de la tabla `equipos`
2. **Paso 2:** Checklist generado desde `checklist_templates` filtrado por `tipo_equipo`
   - Cada ítem: ok / warning / fail
   - `calcularSemaforo()` se recalcula en cada render (sin useMemo — pendiente)
   - Asignación de operador vía RPC `asignar_operador_a_equipo()`
   - Fotos subidas a Cloudinary secuencialmente
3. **Paso 3:** Confirmación → `INSERT` en `inspecciones` + `checklist_items` + `inspeccion_fotos`

## Consultas Supabase — patrones actuales
```js
// Patrón común (actual — problemático):
const { data } = await supabase.from('tabla').select('*')  // sin .limit()

// Patrón recomendado:
const { data } = await supabase.from('tabla')
  .select('id, campo1, campo2')
  .limit(100)
  .range(offset, offset + 24)   // paginación real
```

## DashboardFlota — cómo carga datos
- 5 consultas en paralelo con `Promise.all()`
- Trae inspecciones de los últimos 90 días sin límite de filas
- Tiene un bug conocido de PostgREST: filtros sobre relaciones JOIN no funcionan como se espera — se resuelve filtrando en el cliente con `.filter()` de JS

## Sistema de email (Resend + Edge Function + pg_cron)
```
pg_cron (lunes 11:00 UTC = 7:00 AM PY)
    → llama net.http_post a la Edge Function
    → Edge Function llama RPC equipos_sin_inspeccion_reciente()
    → separa en urgentes (>30 días) y avisos (14-30 días)
    → consulta tabla usuarios para destinatarios
    → envía email HTML a cada usuario via Resend API
```

## Variables de entorno (frontend — vite.config.js)
| Variable | Uso |
|----------|-----|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Clave pública de Supabase |
| `VITE_CLOUDINARY_CLOUD_NAME` | Cloud name de Cloudinary (⚠️ expuesto en bundle) |
| `VITE_CLOUDINARY_UPLOAD_PRESET` | Upload preset (⚠️ expuesto en bundle) |

## Variables de entorno (Edge Function — secrets en Supabase)
| Variable | Uso |
|----------|-----|
| `RESEND_API_KEY` | API key de Resend |
| `SUPABASE_URL` | URL del proyecto |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave server-side con acceso total |

## Sistema de UI utilitario
```js
// Toast notifications — disparado vía CustomEvent
import { toast } from './utils/ui'
toast('Mensaje', 'exito')   // también: 'error', 'info', 'advertencia'
toast('✅ OK')              // auto-detecta tipo por emoji/palabras

// Confirmación modal
import { confirmar } from './utils/ui'
const ok = await confirmar('¿Estás seguro?')
```

## Módulo Correctivos y sincronización SAP → app (oct-2026)
- **Vistas**: `supabase/correctivos_setup.sql`. La lógica vive en el esquema privado `corr` (no expuesto por la API). Las vistas públicas `v_corr_*` corren con permisos del dueño porque las tablas `sap_*` solo tienen política RLS para `agente_lector`; cada vista filtra con `corr_usuario_activo()` (usuario activo en `usuarios` por email). `anon` no tiene permiso; un usuario inactivo ve 0 filas.
- **Sync**: `supabase/correctivos_sync.sql` → `public.corr_sync_sap(p_dry_run boolean default true)`, SECURITY DEFINER, ejecutable solo por `service_role`. Todo en una transacción: si falla, se revierte y queda una fila `ERROR` en `corr.sync_log`. Cada corrida deja una fila `RUN` con el resumen.
- **Fecha de liberación (R2)**: `sap_ordenes.fecha_fin_real`; si es nula (~45 % de las cerradas), la fecha de la última ingesta de `trabajo`.
- **Nodo n8n (pendiente)**: al final del workflow de ingesta diaria, después de cargar `ie36` y `trabajo`, agregar un HTTP Request:
  - `POST https://typeuonpnhwqsryqeuef.supabase.co/rest/v1/rpc/corr_sync_sap`
  - Headers: `apikey` y `Authorization: Bearer <service_role key>`, `Content-Type: application/json`
  - Body: `{"p_dry_run": true}` las primeras 2 semanas; después `{"p_dry_run": false}` y apagar la rutina de Cowork ese mismo día.
  - Si la respuesta trae `"ok": false`, notificar por el mismo canal de errores de la ingesta.
- Revisar el modo prueba: Correctivos → Resumen → Cambios automáticos (o `select * from corr.sync_log order by id desc`).


## Uso de equipos — refresco
- `uso_refrescar()` recalcula `uso_equipos_info`, `uso_diario` (UNLOGGED), `uso_hallazgos` (upsert con estados), `uso_ociosos` y casos. Corre por **pg_cron** todos los días a las 14:30 Asunción (job `uso_equipos_refresco_diario`, `30 17 * * *` UTC), después de la ingesta SAP (~11:00–13:45). No hay botón en la app: por PostgREST el rol authenticated corta a los 8 s y el refresco tarda 5–8 s.
- Permiso de `uso_refrescar`: service_role, conexión directa sin JWT (SQL Editor / pg_cron) o usuario gerencia.

## Agente de logística (Telegram + n8n, solo consulta) — 23/10/2026
- Workflow n8n **"Agente logística (Telegram)"** (id `5sD9qJBNIpYnPj7H`, export en `n8n/agente_logistica.json`). Inactivo hasta las pruebas.
- Flujo: Telegram Trigger (bot propio) → `POST rpc/bot_usuario_logistica {p_chat_id}` → si no hay fila: insert en `bot_consultas` con `error = 'no_autorizado'` y **no se responde** → AI Agent (Claude Haiku 5.5, Simple Memory por chat_id con 3 interacciones, máx. 6 iteraciones) con dos HTTP Request tools → Code (escapa HTML, parte en mensajes de ≤ 4.000 caracteres, arma el registro) → Telegram + insert en `bot_consultas`.
- Herramientas: `rpc/bot_log_pendientes {p_chat_id}` y `rpc/bot_log_agenda {p_chat_id, p_desde, p_hasta, p_equipo}`. `p_chat_id` sale del trigger (expresión); el modelo solo completa `p_desde`, `p_hasta`, `p_equipo` ($fromAI). `neverError` activado: si la función hace RAISE, el modelo recibe el JSON de PostgREST (`message`) y lo repite.
- Credenciales: Supabase account 2 (service key), Anthropic account, Telegram del bot nuevo (por crear), errores por Telegram account 2 al chat de Andrés (Error Trigger dentro del mismo flujo).
- Fechas: el mensaje al agente lleva hoy, mañana, esta semana y la semana que viene ya calculadas (hora de Asunción) para que el modelo no las calcule.
- Tokens: el nodo Code intenta leer `tokenUsage` de las corridas del nodo *Claude Haiku*; si n8n no lo expone, `tokens_entrada/salida` quedan null y hay que verlos en la ejecución.

### System prompt
```
Sos el asistente de logística del Departamento de Transporte y Equipos de T&C SA (Paraguay). Respondés por Telegram consultas sobre fletes y camiones de logística. SOLO CONSULTÁS: no podés crear, asignar, entregar, cerrar ni modificar nada.

HERRAMIENTAS (usá solo estas dos)
1) pendientes: fletes pendientes. Devuelve una fila por encargo con seccion (atrasado | sin_asignar | por_confirmar), descripcion, origen, destino, cantidad, unidad, cantidad_confirmada, cantidad_sin_confirmar, fecha_requerida, dias_atraso y proximos_camiones (camiones planificados; "⚠ en taller" si ese camión está en taller).
2) agenda: una fila por camión y por día entre p_desde y p_hasta (máximo 14 días), opcional un solo camión (p_equipo). Columnas: fecha, equipo, chofer_habitual, asignaciones (lista con encargo, origen, destino, estado, chofer, pendiente_desde), n_asignaciones, en_taller_hoy, estado_taller, dias_taller, libre, conflicto, conflicto_detalle.

CÓMO ELEGIR
- "¿Qué fletes pendientes hay?" → pendientes.
- "¿Qué camiones libres hay hoy?" → agenda con desde = hasta = hoy, sin p_equipo. Listá los libre = true.
- "¿Qué actividad tiene hoy el VP-CT012?" → agenda de hoy con p_equipo.
- "¿Qué hay planeado para la semana que viene / esta semana?" → agenda con el lunes y el domingo que te paso abajo.
- Preguntas de seguimiento ("¿y mañana?") se resuelven con la conversación previa.
- Fechas siempre en formato AAAA-MM-DD. Usá las fechas calculadas que vienen en cada mensaje; no las calcules vos.

REGLAS
- Equipos siempre por ID técnico (ej. VP-CT012), tal como vienen.
- Una asignación con pendiente_desde es un viaje que no se marcó entregado: decí "pendiente desde lun 12/10".
- Un camión en taller (en_taller_hoy = true) hoy NO está libre. En días futuros puede figurar libre: aclaralo con "(en taller hoy)".
- Conflictos primero: si alguna fila tiene conflicto = true, empezá la respuesta con "⚠ <equipo> tiene <conflicto_detalle> pero está en taller (<estado_taller>, <dias_taller> días)". Una vez por camión, en cualquier pregunta. En pendientes, avisá igual si proximos_camiones dice "⚠ en taller".
- Informá solo lo que devuelven las herramientas. No inventes ni estimes. Si una herramienta devuelve un error (campo message o code), decí el mensaje tal cual (ej. "No hay un camión de logística activo con el ID VP-CT999").
- Si te piden hacer algo (asignar, entregar, cerrar, cancelar, mover): respondé que este bot solo consulta y que eso se hace en la app.
- Si la pregunta no es de logística: decí que este bot solo responde sobre fletes y camiones de logística.

FORMATO (Telegram, se lee en el celular)
- Español de Paraguay, informal, directo y corto. Líneas breves, listas con "• ". Sin tablas, sin Markdown, sin asteriscos ni etiquetas.
- Fechas como "jue 09/10". Números en formato es-PY: "296,8 tn", "1.250 un".
- Para una semana, agrupá por día y mostrá solo los camiones con actividad; al final, cuántos quedan libres por día.
```

### Mensaje de usuario (plantilla)
```
Hoy es {{ $now.setZone("America/Asuncion").setLocale("es").toFormat("cccc dd/LL/yyyy") }} ({{ $now.setZone("America/Asuncion").toISODate() }}). Mañana: {{ $now.setZone("America/Asuncion").plus({days: 1}).toISODate() }}. Esta semana: {{ $now.setZone("America/Asuncion").startOf("week").toISODate() }} a {{ $now.setZone("America/Asuncion").endOf("week").toISODate() }}. Semana que viene: {{ $now.setZone("America/Asuncion").startOf("week").plus({weeks: 1}).toISODate() }} a {{ $now.setZone("America/Asuncion").endOf("week").plus({weeks: 1}).toISODate() }}.
Pregunta: {{ $("Mensaje al bot de logística").item.json.message.text || "(mensaje sin texto: este bot solo lee texto)" }}
```
