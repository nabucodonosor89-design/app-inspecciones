# Guía: Reporte Semanal de Pedidos de Equipos

Sistema de notificaciones automáticas vía Power Automate + Supabase Edge Function.

---

## Arquitectura del flujo

```
Lunes 7:00 AM (Paraguay)
        │
        ▼
Power Automate — Recurrence Trigger
        │
        ▼
HTTP POST → supabase/functions/reporte-pedidos-semanal
        │  (con header x-api-secret)
        │
        ▼
Edge Function consulta pedidos_equipos_lineas
Arma HTML de cada correo
Devuelve JSON
        │
        ▼
PA → Apply to Each → Enviar correo a cada solicitante (Outlook)
PA → Enviar correo resumen al equipo TyE interno
```

---

## Paso 1 — Desplegar la Edge Function en Supabase

### 1.1 Subir el archivo

La función ya está en: `supabase/functions/reporte-pedidos-semanal/index.ts`

En la terminal, desde la raíz del proyecto:

```bash
supabase functions deploy reporte-pedidos-semanal --no-verify-jwt
```

> `--no-verify-jwt` es necesario porque Power Automate llama con un header propio, no con un JWT de Supabase.

Si no tenés Supabase CLI instalado localmente, podés pegar el contenido del archivo directamente en el **Supabase Dashboard → Edge Functions → New Function**.

### 1.2 Configurar variables de entorno

En el **Supabase Dashboard → Settings → Edge Functions → Secrets** (o vía CLI):

| Variable | Valor |
|----------|-------|
| `SUPABASE_URL` | Tu URL del proyecto (ej: `https://xyzxyz.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | La **service_role** key (NO la anon key) |
| `REPORTE_PEDIDOS_SECRET` | Una contraseña larga que vos inventás (ej: `tye-reportes-2026-abc123`) |
| `EMAIL_INTERNO_TYE` | Correo del equipo TyE que recibe el resumen (ej: `transporte@tyc.com.py`) |

Via CLI:
```bash
supabase secrets set REPORTE_PEDIDOS_SECRET="tye-reportes-2026-abc123"
supabase secrets set EMAIL_INTERNO_TYE="transporte@tyc.com.py"
```

> **Importante:** `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya están disponibles automáticamente en todas las edge functions de Supabase. Solo necesitás setear las otras dos.

### 1.3 Verificar que funciona

```bash
curl -X GET \
  "https://TU_PROYECTO.supabase.co/functions/v1/reporte-pedidos-semanal" \
  -H "x-api-secret: tye-reportes-2026-abc123"
```

Respuesta esperada (si hay pedidos pendientes):
```json
{
  "ok": true,
  "total_pendientes": 5,
  "total_solicitantes": 3,
  "solicitantes": [
    {
      "email": "solicitante@obra.com",
      "total": 2,
      "asunto": "📋 Estado de tus pedidos de equipos — Semana 37 / 2026",
      "html_body": "<!DOCTYPE html>..."
    }
  ],
  "email_interno": {
    "asunto": "📦 Pedidos de equipos pendientes — Semana 37 / 2026",
    "html_body": "<!DOCTYPE html>..."
  }
}
```

Si `total_pendientes` es 0, la respuesta tendrá `ok: true` pero los arrays vacíos.

---

## Paso 2 — Crear el flujo en Power Automate

Ir a **make.powerautomate.com** → **Mis flujos** → **+ Nuevo flujo** → **Flujo de nube programado**.

### 2.1 Trigger: Recurrence (Programado)

| Campo | Valor |
|-------|-------|
| Frecuencia | Semana |
| Intervalo | 1 |
| En estos días | Lunes |
| A las horas | 10 (10:00 AM UTC = 7:00 AM Paraguay, UTC-3) |
| A los minutos | 0 |
| Zona horaria | (UTC) Coordinated Universal Time |

> Paraguay usa UTC-3 todo el año (no tiene horario de verano).

### 2.2 Acción: HTTP

| Campo | Valor |
|-------|-------|
| Método | GET |
| URI | `https://TU_PROYECTO.supabase.co/functions/v1/reporte-pedidos-semanal` |
| Encabezados | `x-api-secret` → `tye-reportes-2026-abc123` |

En **Encabezados** hacer clic en "Agregar nuevo elemento":
- Clave: `x-api-secret`
- Valor: `tye-reportes-2026-abc123`

### 2.3 Acción: Analizar JSON (Parse JSON)

| Campo | Valor |
|-------|-------|
| Contenido | `Body` (salida del paso HTTP anterior) |
| Esquema | Ver esquema abajo |

**Esquema JSON para pegar:**

```json
{
  "type": "object",
  "properties": {
    "ok": { "type": "boolean" },
    "total_pendientes": { "type": "integer" },
    "total_solicitantes": { "type": "integer" },
    "solicitantes": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "email": { "type": "string" },
          "total": { "type": "integer" },
          "asunto": { "type": "string" },
          "html_body": { "type": "string" }
        }
      }
    },
    "email_interno": {
      "type": "object",
      "properties": {
        "asunto": { "type": "string" },
        "html_body": { "type": "string" }
      }
    }
  }
}
```

### 2.4 Acción: Condición

Agregar una condición para no enviar correos si no hay nada pendiente:

- **Valor izquierdo:** `total_pendientes` (del Parse JSON)
- **Operador:** `es mayor que`
- **Valor derecho:** `0`

Toda la lógica de envío va dentro de la rama **Si es verdadero**.

### 2.5 (Dentro de "Si es verdadero") Aplicar a cada uno — Solicitantes

Acción: **Aplicar a cada uno**
- **Seleccionar salida:** `solicitantes` (del Parse JSON)

Dentro del bucle, agregar acción: **Enviar un correo electrónico (V2)** (conector Office 365 Outlook)

| Campo | Valor |
|-------|-------|
| Para | `email` (elemento actual del bucle) |
| Asunto | `asunto` (elemento actual del bucle) |
| Cuerpo | `html_body` (elemento actual del bucle) |
| **Es HTML** | **Sí** ← ¡Importante activar esto! |

> Para acceder a los campos del elemento actual: en el campo "Para", escribir `@items('Aplicar_a_cada_uno')?['email']` o usar el selector de contenido dinámico → "Elemento actual".

### 2.6 (Después del bucle, aún dentro de "Si es verdadero") Correo Interno TyE

Agregar otra acción: **Enviar un correo electrónico (V2)**

| Campo | Valor |
|-------|-------|
| Para | Dirección del equipo TyE (ej: `transporte@tyc.com.py`) |
| Asunto | `asunto` (de `email_interno` del Parse JSON) |
| Cuerpo | `html_body` (de `email_interno` del Parse JSON) |
| **Es HTML** | **Sí** |

> En el selector dinámico buscar `email_interno` → `asunto` y `email_interno` → `html_body`.

---

## Paso 3 — Guardar y probar

### 3.1 Probar manualmente en PA

En la esquina superior derecha del flujo: **Probar** → **Manualmente** → **Ejecutar flujo**.

### 3.2 Verificar los correos

Revisar que lleguen correctamente a los solicitantes y al equipo TyE. Confirmar que el HTML se renderiza bien (tablas con colores, etc.).

### 3.3 Activar el flujo

Una vez verificado, activar el flujo. Se ejecutará automáticamente todos los lunes a las 10:00 UTC (7:00 AM Paraguay).

---

## Referencia: estructura del JSON de respuesta

```
{
  ok: true,
  total_pendientes: N,        ← total de líneas pendientes (todos los solicitantes)
  total_solicitantes: N,      ← cuántos emails distintos tienen pedidos abiertos
  solicitantes: [
    {
      email: "...",           ← destino del correo individual
      total: N,               ← cuántos pedidos tiene este solicitante
      asunto: "...",          ← subject del correo
      html_body: "..."        ← HTML completo listo para enviar
    },
    ...
  ],
  email_interno: {
    asunto: "...",            ← subject del correo interno TyE
    html_body: "..."          ← HTML con todos los pedidos agrupados por solicitante
  }
}
```

---

## Troubleshooting

| Problema | Causa probable | Solución |
|----------|----------------|----------|
| HTTP 401 | `x-api-secret` incorrecto o no enviado | Verificar que el header y el secret en Supabase coincidan |
| HTTP 500 | Error en la edge function | Ver logs en Supabase Dashboard → Edge Functions → Logs |
| Correo sin formato / texto plano | "Es HTML" desactivado en PA | Activar la opción "Es HTML" en cada acción de envío |
| No llegan correos pero el flujo pasa | `total_pendientes = 0` | Verificar que haya pedidos con estado distinto a entregado/cancelado/rechazado |
| Error en Parse JSON | Schema no coincide | Hacer un test manual con curl primero y copiar la respuesta real al generador de schema de PA |

---

## Mantenimiento

- Si se agregan nuevos estados a `estado_aprobacion` o `estado_entrega`, actualizar la función `etiquetaEstado()` en `index.ts` y redesplegar.
- El secreto `REPORTE_PEDIDOS_SECRET` puede rotarse en cualquier momento: actualizar en Supabase Secrets y en el flujo de PA.
- Para pausar temporalmente: desactivar el flujo en PA (sin eliminar nada).

