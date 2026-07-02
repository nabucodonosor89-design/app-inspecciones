# Auditoría Técnica — app-inspecciones
**Sistema de Gestión TyE** · React 19 + Vite 7 + Supabase  
Fecha: 2026-06-26 · Auditor: Claude (Ingeniería de Sistemas)

---

## Resumen ejecutivo

La app funciona y tiene una UX coherente. Sin embargo, acumula deuda técnica en cuatro áreas que, a medida que crece el volumen de datos o el equipo de usuarios, van a impactar directamente en performance, seguridad y mantenibilidad. El riesgo más urgente es el overfetch de datos combinado con credenciales de Cloudinary expuestas en el bundle del cliente.

**Tabla de hallazgos por severidad:**

| # | Área | Hallazgo | Severidad |
|---|------|----------|-----------|
| 1 | Seguridad | Cloudinary upload_preset expuesto en el bundle | 🔴 CRÍTICO |
| 2 | Seguridad | `select('*')` en 15+ queries — overfetch de columnas sensibles | 🔴 CRÍTICO |
| 3 | Performance | DashboardEjecutivo trae TODAS las inspecciones sin límite | 🔴 CRÍTICO |
| 4 | Performance | HistorialInspecciones: filtros en cliente sin paginación en query | 🟠 ALTO |
| 5 | Seguridad | Usuario sin revalidación de sesión post-login | 🟠 ALTO |
| 6 | Performance | `calcularSemaforo()` recalcula en cada render sin useMemo | 🟠 ALTO |
| 7 | Performance | DashboardFlota: filtro de join PostgREST no funciona como se espera | 🟠 ALTO |
| 8 | Arquitectura | App.jsx monolítico de 770 líneas — sin router | 🟠 ALTO |
| 9 | Código | Memory leak en SubidaFotos — `URL.createObjectURL` nunca se revoca | 🟡 MEDIO |
| 10 | Arquitectura | Sin estado global — prop drilling del objeto `user` | 🟡 MEDIO |
| 11 | Arquitectura | Manipulación directa del DOM en hover (rompe Virtual DOM) | 🟡 MEDIO |
| 12 | Código | 95 `console.log/error` activos en producción | 🟡 MEDIO |
| 13 | Código | `key={index}` en listas dinámicas — puede causar bugs de render | 🟡 MEDIO |
| 14 | UX | Sin `confirmar()` al salir de formularios con datos cargados | 🟡 MEDIO |
| 15 | Código | Período de inspección hardcodeado a 30 días en DashboardEjecutivo | 🟢 BAJO |
| 16 | Código | Comentarios "// NUEVO:", "// CAMBIADO:" — indica parches encima de parches | 🟢 BAJO |

---

## 1. SEGURIDAD

### 🔴 [SEC-01] Cloudinary upload_preset expuesto en el cliente

**Archivo:** `src/utils/cloudinary.js` + `.env.local`

```js
const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET
```

Las variables `VITE_*` de Vite se incrustan literalmente en el bundle JavaScript. Cualquier persona que abra DevTools → Sources puede ver tu `cloud_name` y `upload_preset`. Con esos dos datos, puede subir imágenes a tu cuenta de Cloudinary consumiendo tu cuota (y potencialmente contenido inapropiado).

**Solución:** Configurar el upload preset de Cloudinary como "signed" y procesar las subidas a través de una Edge Function de Supabase que firme las requests. El cliente nunca debería tener credenciales directas de Cloudinary.

---

### 🔴 [SEC-02] `select('*')` en 15+ lugares

**Archivos:** App.jsx, Login.jsx, DashboardEjecutivo.jsx, DetalleInspeccion.jsx (×2), EquiposList.jsx, HistorialInspecciones.jsx (×3), ListaEquipos.jsx, NuevaInspeccion.jsx (×5)

```js
// Login.jsx línea 26 — trae TODOS los campos de la tabla usuarios
const { data: userData } = await supabase
  .from('usuarios')
  .select('*')      // ← incluye posibles campos sensibles
  .eq('email', email)
  .single()
```

Problemas concretos:
- Transfiere columnas que nunca se usan (aumenta payload de red).
- Si algún día se agrega un campo `password_hash`, `token_reset` u otro dato sensible a la tabla, se expone automáticamente al cliente.
- Dificulta entender qué datos realmente necesita cada componente.

**Solución:** Especificar columnas explícitamente. Ejemplo:
```js
.select('id, nombre_completo, email, rol')
```

---

### 🟠 [SEC-03] Usuario sin revalidación de sesión

**Archivo:** `src/App.jsx` — `checkUser()`

Al cargar la app, se busca el usuario en la tabla `usuarios` con el email de la sesión activa. Ese objeto se guarda en estado React y no vuelve a verificarse. Si el usuario es desactivado, cambia de rol, o sus datos se modifican en la BD, la sesión activa en el cliente sigue funcionando con los datos viejos hasta que cierre y vuelva a abrir la app.

**Solución:** Usar `supabase.auth.onAuthStateChange()` para detectar cambios de sesión y revalidar el perfil del usuario periódicamente, o al menos en cada navegación entre módulos.

---

## 2. PERFORMANCE

### 🔴 [PERF-01] DashboardEjecutivo — overfetch sin límite

**Archivo:** `src/DashboardEjecutivo.jsx` líneas 22–38

```js
// Trae TODOS los equipos con todas sus columnas
const { data: equipos } = await supabase
  .from('equipos')
  .select('*')           // ← columnas innecesarias
  .order('ubicacion_actual')

// Trae TODAS las inspecciones históricas sin límite
const { data: inspecciones } = await supabase
  .from('inspecciones')
  .select('equipo_id, fecha_hora')
  .order('fecha_hora', { ascending: false })
  // ← sin .limit() ni rango de fechas
```

Con 200 equipos y 5.000 inspecciones históricas, esta pantalla transfiere decenas de miles de filas desde Supabase para calcular estadísticas que podrían resolverse con una sola query SQL agregada. El cálculo de "inspecciones vencidas" en líneas 86–116 es un bucle JavaScript sobre todos los datos que podría ser una query `GROUP BY` con `MAX(fecha_hora)`.

**Solución recomendada:**
```sql
-- Vista o RPC en Supabase que devuelva directamente los KPIs
SELECT 
  e.id,
  e.estado_operativo,
  MAX(i.fecha_hora) as ultima_inspeccion,
  EXTRACT(DAY FROM NOW() - MAX(i.fecha_hora)) as dias_sin_inspeccion
FROM equipos e
LEFT JOIN inspecciones i ON i.equipo_id = e.id
GROUP BY e.id, e.estado_operativo
```

---

### 🟠 [PERF-02] HistorialInspecciones — filtros 100% en cliente

**Archivo:** `src/HistorialInspeccionesCompleto.jsx` y `src/HistorialInspecciones.jsx`

```js
// Trae TODAS las inspecciones con JOINs
const { data } = await supabase
  .from('inspecciones')
  .select(`*, equipos(...), usuarios(...), operadores(...)`)
  .order('fecha_hora', { ascending: false })
  // ← sin ningún filtro, sin .limit()

// Los filtros se aplican en JavaScript del cliente
const inspeccionesFiltradas = inspecciones.filter(insp => { ... })
```

La paginación (25 items por página) es solo visual — ya transfirió todos los datos. Si hay 2.000 inspecciones, las trae todas al primer render.

**Solución:** Aplicar filtros en la query Supabase y paginar desde el servidor:
```js
.range(offset, offset + 24)   // paginación real
.eq('tipo_inspeccion', filtroTipo)  // filtro en BD
.gte('fecha_hora', filtroDesde)
```

---

### 🟠 [PERF-03] DashboardFlota — filtro de join PostgREST no funciona

**Archivo:** `src/DashboardFlota.jsx` líneas 34–39

```js
supabase.from('checklist_items')
  .select(`id, item_nombre, es_critico, observacion, inspeccion_id,
    inspecciones(equipo_id, fecha_hora, equipos(numero_identificacion, denominacion))`)
  .eq('estado', 'fail')
  .eq('es_critico', true)
  .gte('inspecciones.fecha_hora', hace7dias)  // ← ESTE FILTRO NO FUNCIONA COMO SE ESPERA
```

En PostgREST/Supabase, `.gte('tabla_relacionada.columna', valor)` no actúa como un `WHERE` en el JOIN — filtra filas de la tabla principal que tengan *al menos una* relación que cumpla la condición, pero puede traer datos adicionales. Por eso hay un workaround posterior en el código:

```js
// Línea 53-56: filtro manual porque el de arriba no alcanzó
const fallasCriticas = (fallasCriticasRes.data || []).filter(f =>
  f.inspecciones?.fecha_hora && f.inspecciones.fecha_hora >= hace7dias
)
```

Esto indica que la query puede estar trayendo más registros de los necesarios y filtrando en cliente.

**Solución:** Usar una RPC o subconsulta para filtrar por fecha de inspección directamente en PostgreSQL.

---

### 🟠 [PERF-04] `calcularSemaforo()` recalcula en cada render

**Archivo:** `src/NuevaInspeccion.jsx` línea 370

```js
// Se ejecuta en CADA render, aunque checklist no haya cambiado
const semaforoPreview = calcularSemaforo()
```

La función itera sobre todos los items del checklist y hace múltiples `.filter()`. Con 30–50 items de checklist, en un formulario con muchos eventos de teclado (observaciones), esto se ejecuta decenas de veces por segundo.

**Solución:**
```js
const semaforoPreview = useMemo(() => calcularSemaforo(), [checklist, checklistTemplates])
```

---

### 🟡 [PERF-05] NuevaInspeccion — carga todos los equipos con `select('*')`

**Archivo:** `src/NuevaInspeccion.jsx` líneas 78–83

```js
async function getEquipos() {
  const { data } = await supabase
    .from('equipos')
    .select('*')           // todas las columnas de todos los equipos
    .order('numero_identificacion')
  setEquipos(data || [])
}
```

Para el paso 1 (selector de equipo), solo se necesitan `id`, `numero_identificacion`, `denominacion`, `tipo_equipo`, `operador_asignado_id`. Traer `*` incluye columnas como historial, fotos, etc.

---

## 3. ARQUITECTURA

### 🟠 [ARCH-01] App.jsx monolítico — sin router

**Archivo:** `src/App.jsx` — 770 líneas

Todo el sistema de navegación está en un único archivo con condicionales:
```js
if (modulo === 'inspecciones') { return <div>...</div> }
if (modulo === 'pedidos-compra') { return <div>...</div> }
// etc.
```

Consecuencias:
- Cualquier cambio de estado en cualquier módulo provoca que React evalúe los condicionales de los 8 módulos.
- No hay URLs — no se puede compartir un link directo a una inspección específica, no funciona el botón Atrás del navegador.
- El header de cada módulo (botón "← Menú Principal") está duplicado 7 veces con ligeras variaciones.

**Solución:** Migrar a React Router v6 (`createBrowserRouter`). El refactor del menú principal tarda 2–3 horas y resuelve navegación, URLs, botón atrás y lazy loading de módulos.

---

### 🟡 [ARCH-02] Manipulación directa del DOM en eventos hover

**Archivo:** App.jsx (16 ocurrencias), EquiposList.jsx, ListaMantenimientos.jsx, y otros

```js
onMouseEnter={(e) => {
  e.currentTarget.style.transform = 'translateY(-8px)'   // ← manipulación directa
  e.currentTarget.style.boxShadow = '0 12px 24px rgba(102, 126, 234, 0.3)'
  e.currentTarget.style.borderColor = '#667eea'
}}
```

Modificar `element.style` directamente en React evita el Virtual DOM y puede causar inconsistencias de estado en re-renders. Además, 51 instancias de `onMouseEnter`/`onMouseLeave` en el código.

**Solución:** Usar CSS classes con `:hover` o un pequeño estado local `const [hovered, setHovered] = useState(false)`.

---

### 🟡 [ARCH-03] Sin estado global — prop drilling del objeto `user`

El objeto `user` se pasa como prop desde App.jsx hacia abajo. Actualmente es manejable, pero cualquier componente que necesite el usuario en el futuro (ej: un modal profundamente anidado) requiere pasar la prop por múltiples niveles.

**Solución:** Un `UserContext` con `useContext` resuelve esto con ~20 líneas de código:
```js
// src/context/UserContext.jsx
export const UserContext = createContext(null)
export const useUser = () => useContext(UserContext)
```

---

## 4. CALIDAD DE CÓDIGO

### 🟡 [CODE-01] Memory leak en SubidaFotos

**Archivo:** `src/SubidaFotos.jsx` línea 45

```js
nuevasFotos.push({
  url: resultado.url,
  public_id: resultado.public_id,
  descripcion: '',
  nombre: archivo.name,
  preview: URL.createObjectURL(archivo)  // ← LEAK: nunca se revoca
})
```

`URL.createObjectURL()` crea una referencia en memoria al archivo. Si no se llama `URL.revokeObjectURL()` cuando la foto se elimina o el componente se desmonta, el archivo permanece en memoria indefinidamente.

**Solución:**
```js
// En la función eliminarFoto()
const eliminarFoto = (index) => {
  if (fotos[index].preview) URL.revokeObjectURL(fotos[index].preview)  // ← agregar
  const fotosActualizadas = fotos.filter((_, i) => i !== index)
  ...
}

// useEffect de cleanup
useEffect(() => {
  return () => fotos.forEach(f => f.preview && URL.revokeObjectURL(f.preview))
}, [])
```

---

### 🟡 [CODE-02] 95 `console.log` activos en producción

**Distribución:** NuevaInspeccion.jsx (19), FormularioEquipo.jsx (16), HistorialInspecciones.jsx (11), otros.

Ejemplos de lo que se expone en DevTools de producción:
```js
console.log('🚀 CLICK EN GUARDAR - Estado actual de fotos:', fotos)
console.log('📍 Actualizando ubicación del equipo a:', ubicacion)
console.log('📋 Pedidos para equipo ' + equipoSeleccionado.numero_identificacion + ':', data)
```

Estos logs exponen la estructura interna de los datos, IDs de BD y flujo de negocio a cualquier usuario que abra DevTools.

**Solución rápida:** Agregar en `vite.config.js`:
```js
export default defineConfig({
  plugins: [react()],
  esbuild: {
    drop: ['console', 'debugger'],  // ← elimina console.* en build de producción
  }
})
```

---

### 🟡 [CODE-03] `key={index}` en listas dinámicas

**Archivos:** DashboardEjecutivo.jsx (tabla de obras), DashboardFlota.jsx (fallas críticas)

```js
{stats.porObra.map((obra, index) => (
  <tr key={index}>   // ← key inestable
```

Usar el índice como key causa bugs cuando la lista se reordena o se elimina un elemento del medio — React puede reutilizar el DOM de un elemento para otro, perdiendo estado de inputs o causando animaciones incorrectas.

**Solución:** Usar un identificador único estable:
```js
<tr key={obra.nombre}>
// o
<div key={f.id}>
```

---

### 🟡 [CODE-04] Sin advertencia al salir de formularios con datos

Si el usuario está en el paso 2 de NuevaInspeccion con el checklist a medio completar y presiona "← Menú Principal", pierde todo sin ninguna advertencia. Lo mismo aplica a NuevoMantenimiento y NuevoPedidoCompra.

La utilidad `confirmar()` ya existe en `src/utils/ui.js`. Solo falta usarla:

```js
async function handleVolver() {
  if (Object.values(checklist).some(v => v !== null)) {
    const ok = await confirmar('¿Salir sin guardar? Se perderán los datos del formulario.')
    if (!ok) return
  }
  onVolver()
}
```

---

### 🟢 [CODE-05] Período de inspección hardcodeado

**Archivo:** `src/DashboardEjecutivo.jsx` líneas 101–102

```js
// Asumiendo que inspecciones deben hacerse cada 30 días
const diasParaProxima = 30 - diasDesdeInspeccion
```

El "30 días" está hardcodeado. Si los tipos de equipo tienen frecuencias diferentes (camiones cada 15 días, generadores cada 60 días), esto no lo contempla.

**Solución:** Agregar un campo `frecuencia_inspeccion_dias` a la tabla `equipos` o `checklist_templates`.

---

## 5. RESUMEN DE ACCIONES RECOMENDADAS

### Urgente (esta semana)
1. **[SEC-01]** Configurar Cloudinary signed uploads vía Edge Function para ocultar credenciales.
2. **[PERF-01]** Limitar query de inspecciones en DashboardEjecutivo a los últimos 90 días y mover cálculos de KPIs a una RPC de Supabase.
3. **[CODE-02]** Agregar `drop: ['console']` en vite.config.js para builds de producción.

### Corto plazo (próximas 2 semanas)
4. **[SEC-02]** Reemplazar todos los `select('*')` con columnas explícitas.
5. **[PERF-02]** Agregar filtros server-side en HistorialInspecciones + paginación real con `.range()`.
6. **[CODE-01]** Agregar `URL.revokeObjectURL()` en SubidaFotos.
7. **[PERF-04]** Envolver `calcularSemaforo()` en `useMemo`.
8. **[CODE-04]** Agregar `confirmar()` en botones de navegación de formularios con datos.

### Medio plazo (1 mes)
9. **[ARCH-01]** Migrar a React Router v6 para navegación basada en URLs.
10. **[ARCH-03]** Crear `UserContext` para eliminar prop drilling.
11. **[ARCH-02]** Reemplazar `onMouseEnter/Leave` con CSS classes (buscar-reemplazar global).
12. **[PERF-03]** Reescribir query de fallas críticas en DashboardFlota como RPC.

---

*Informe generado el 2026-06-26. Código auditado: 25 archivos, ~6.500 líneas.*
