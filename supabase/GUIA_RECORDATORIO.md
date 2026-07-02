# Guía de instalación — Recordatorio semanal de inspecciones

Tiempo estimado: **20 minutos**  
Resultado: cada lunes a las 7:00 AM llegará un email a todos los usuarios con los equipos que necesitan inspección.

---

## Paso 1 — Crear cuenta en Resend (servicio de email)

1. Abrí **https://resend.com** y creá una cuenta gratuita.
2. En el dashboard de Resend, andá a **API Keys** → **Create API Key**.
3. Poné un nombre como `tye-inspecciones`, dejá permisos en *Full access* y copiá la clave (empieza con `re_...`). **Guardala**, la necesitás en el Paso 3.

> El plan gratuito de Resend permite 3.000 emails/mes y 100 emails/día — más que suficiente para este uso.

---

## Paso 2 — Subir la Edge Function a Supabase

1. Abrí tu proyecto en **https://supabase.com/dashboard**.
2. En el menú izquierdo andá a **Edge Functions**.
3. Hacé clic en **New Function** y nombrala exactamente: `recordatorio-inspecciones`.
4. Borrá el código de ejemplo y pegá el contenido completo del archivo:
   ```
   supabase/functions/recordatorio-inspecciones/index.ts
   ```
5. Hacé clic en **Deploy**.

---

## Paso 3 — Configurar las variables de entorno de la función

En la misma pantalla de Edge Functions, entrá a la función `recordatorio-inspecciones` → **Settings** → **Secrets**.

Agregá estas tres variables:

| Nombre | Valor |
|--------|-------|
| `RESEND_API_KEY` | La clave que copiaste en el Paso 1 (`re_...`) |
| `SUPABASE_URL` | La URL de tu proyecto (ej: `https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | En Supabase: **Settings → API → service_role key** |

> ⚠️ La `service_role key` tiene acceso total a la BD — solo se usa en Edge Functions del servidor, nunca en el frontend.

---

## Paso 4 — Ejecutar el SQL de configuración

1. En Supabase andá a **SQL Editor**.
2. Abrí el archivo `supabase/recordatorio_setup.sql` y ejecutá primero el **bloque 1** (la función SQL):

```sql
CREATE OR REPLACE FUNCTION equipos_sin_inspeccion_reciente() ...
```

3. Para probar que la función funciona:
```sql
SELECT * FROM equipos_sin_inspeccion_reciente();
```
Deberías ver los equipos que llevan más de 14 días sin inspeccionar.

---

## Paso 5 — Activar pg_cron y programar el envío

1. En Supabase andá a **Database → Extensions**.
2. Buscá **pg_cron** y activalo si no está activo.
3. Volvé al **SQL Editor** y ejecutá el **bloque 3** del archivo SQL:

```sql
SELECT cron.schedule(
  'recordatorio-inspecciones-lunes',
  '0 11 * * 1',
  ...
);
```

4. Verificá que quedó registrado:
```sql
SELECT jobid, jobname, schedule, active FROM cron.job;
```

---

## Paso 6 — Configurar el dominio del email (opcional pero recomendado)

Por defecto Resend envía desde `onboarding@resend.dev`. Para que llegue desde `recordatorios@tye.itcsa.com.py`:

1. En Resend → **Domains** → **Add Domain** → ingresá `itcsa.com.py`.
2. Resend te da registros DNS para agregar en tu proveedor de dominio.
3. Una vez verificado, cambiá el campo `from` en la Edge Function:
   ```
   from: 'TyE Inspecciones <recordatorios@tye.itcsa.com.py>'
   ```

---

## Probar sin esperar al lunes

Podés disparar la función manualmente desde Supabase → Edge Functions → `recordatorio-inspecciones` → **Invoke**.

O desde terminal:
```bash
curl -X POST https://TU-PROYECTO.supabase.co/functions/v1/recordatorio-inspecciones \
  -H "Authorization: Bearer TU_ANON_KEY"
```

---

## Cómo se ve el email

El email llega con:
- Un resumen de cuántos equipos están **URGENTES** (más de 30 días) y **PENDIENTES** (14-30 días).
- Una tabla con cada equipo: código, descripción, ubicación actual y días sin inspección.
- Los equipos más críticos arriba en rojo, los pendientes en amarillo.

---

## Ajustar los umbrales

Si querés cambiar cuándo un equipo aparece como urgente, editá las primeras líneas de la Edge Function:

```typescript
const DIAS_CRITICO = 30   // más de 30 días → URGENTE (rojo)
const DIAS_AVISO   = 14   // 14-30 días    → PENDIENTE (amarillo)
```

---

## Archivos creados

```
supabase/
├── functions/
│   └── recordatorio-inspecciones/
│       └── index.ts          ← la Edge Function (subir a Supabase)
├── recordatorio_setup.sql    ← ejecutar en SQL Editor de Supabase
└── GUIA_RECORDATORIO.md      ← esta guía
```
