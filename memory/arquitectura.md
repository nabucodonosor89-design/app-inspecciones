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
