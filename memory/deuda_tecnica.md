# Deuda técnica — app-inspecciones

Basado en auditoría técnica del 26/06/2026. Ver `AUDITORIA_TECNICA.md` para el detalle completo con snippets de código.

## Por severidad

### 🔴 Crítico
| # | Problema | Archivo | Solución |
|---|---------|---------|---------|
| 1 | Credenciales Cloudinary expuestas en bundle cliente | `src/utils/cloudinary.js` | Mover uploads a una Edge Function de Supabase con firma |
| 2 | DashboardEjecutivo: fetch ALL sin límite | `src/DashboardEjecutivo.jsx` | Crear RPC en PostgreSQL que agrupe y filtre server-side |

### 🟠 Alto
| # | Problema | Archivo | Solución |
|---|---------|---------|---------|
| 3 | `select('*')` en todos los queries | Login, Dashboards, etc. | Especificar solo columnas necesarias |
| 4 | Historial carga todo sin paginación real | `src/HistorialInspeccionesCompleto.jsx` | `.range(offset, offset+24)` en Supabase + paginación server-side |
| 5 | DashboardFlota: 90 días sin límite de filas | `src/DashboardFlota.jsx` | Agregar `.limit()` y filtros server-side |
| 6 | Bug PostgREST: filtro JOIN no funciona | `src/DashboardFlota.jsx` | Usar RPC SQL o filtrar con `.filter()` en cliente (workaround actual) |

### 🟡 Medio
| # | Problema | Archivo | Solución |
|---|---------|---------|---------|
| 7 | `calcularSemaforo()` en cada render | `src/NuevaInspeccion.jsx` | Envolver con `useMemo` |
| 8 | `URL.createObjectURL()` sin revocar | `src/SubidaFotos.jsx` | Llamar `URL.revokeObjectURL()` en cleanup |
| 9 | 95 `console.log` en producción | múltiples archivos | `esbuild: { drop: ['console'] }` en vite.config.js |
| 10 | 16 pares onMouseEnter/Leave manipulando DOM | `src/App.jsx` | CSS hover puro (`:hover`) |
| 11 | Sin React Router — URLs sin deep-linking | `src/App.jsx` | Migrar a React Router v6 |
| 12 | App.jsx monolítico (770 líneas) | `src/App.jsx` | Separar módulos en componentes + layout |

### 🟢 Bajo / Mejoras
| # | Problema | Archivo | Solución |
|---|---------|---------|---------|
| 13 | Upload fotos secuencial (lento) | `src/SubidaFotos.jsx` | `Promise.all()` para uploads en paralelo |
| 14 | Sin manejo de errores de red | varios | Wrappers con retry y mensajes de error amigables |
| 15 | Ausencia de loading skeletons | varios | Shimmer/skeleton mientras cargan los datos |
| 16 | Sin tests automatizados | — | Al menos smoke tests con Vitest + React Testing Library |

## Orden de ataque recomendado

**Sprint 1 — Seguridad y performance crítica** (1-2 días)
1. `console.log` en producción → 1 línea en `vite.config.js` → **30 segundos**
2. Credenciales Cloudinary → Edge Function de Supabase → **medio día**
3. `select('*')` en Dashboard Ejecutivo + Login → **2 horas**

**Sprint 2 — Performance de datos** (2-3 días)
4. DashboardEjecutivo → RPC con agrupación SQL
5. Historial → paginación server-side real
6. DashboardFlota → `.limit()` + fix PostgREST

**Sprint 3 — Calidad de código** (2-3 días)
7. `useMemo` en calcularSemaforo
8. Memory leak en SubidaFotos
9. CSS hover (eliminar 16 pares onMouseEnter/Leave)
10. Uploads paralelos en SubidaFotos

**Sprint 4 — Arquitectura** (1 semana)
11. React Router v6
12. Descomponer App.jsx
13. Tests básicos

## Fácil/rápido (high value, low effort)
```js
// vite.config.js — elimina todos los console.log en producción
export default defineConfig({
  build: {
    minify: 'esbuild',
  },
  esbuild: {
    drop: ['console', 'debugger'],
  },
})
```

## Pendientes de activación (no código, sino configuración)
- [ ] Crear cuenta en Resend → `https://resend.com`
- [ ] Subir Edge Function `recordatorio-inspecciones` a Supabase
- [ ] Configurar secrets en la Edge Function (RESEND_API_KEY, etc.)
- [ ] Ejecutar `supabase/recordatorio_setup.sql` en SQL Editor
- [ ] Activar extensión pg_cron en Supabase Dashboard → Database → Extensions
- [ ] (Opcional) Verificar dominio de email en Resend

## Actualización 16/11/2026

Detalle en `AUDITORIA_TECNICA.md` → sección 6.

| # | Sev. | Problema | Archivo | Solución |
|---|------|---------|---------|---------|
| 17 | 🔴 | Tope de 1.000 filas: Mantenimientos pierde 42 (3 abiertos) e Inspecciones deja 26 equipos activos como "sin inspección" | `ListaMantenimientos.jsx`, `DashboardMantenimientos.jsx`, `EquiposList.jsx`, `HistorialInspeccionesCompleto.jsx` | Mantenimientos: cargar solo abiertos y completados por búsqueda (decisión de Andrés: no hace falta verlos). EquiposList: usar `equipos.fecha_ultima_inspeccion`. Historial: paginar en servidor |
| 18 | 🟠 | Un solo bundle (1,5 MB), sin carga por módulo | `App.jsx` | `React.lazy` por módulo + `import()` dinámico de xlsx/jspdf |
| 19 | 🟠 | Listas grandes sin paginar ni `useMemo` | Mantenimientos, `EquiposList.jsx`, `ListaPedidosEquipos.jsx` | Paginar / memoizar filtros |
| 20 | 🟡 | Helpers duplicados (`num` ×8, `ddmm` ×4, `hoyPY` ×3, `hoyISO` ×3, `fechaCorta` ×3, `diasEntre` ×3) | varios | `src/utils/formato.js` y `estados.js` |
| 21 | 🟡 | Pantallas gemelas (EquiposList/ListaEquipos, dos historiales) y 19 consultas a `equipos` | varios | Unificar carga |
| 22 | 🟡 | Consultas en serie | `NuevaInspeccion.jsx` y otras | `Promise.all` |
| 23 | 🟢 | Código muerto: `utils/ExportarPedidosExdel.js`, dependencia `file-server` | — | Borrar |

**Orden:** 17 → 18 → 20 → 19.

**De junio:** siguen pendientes 1 (Cloudinary), 3 (`select('*')`, quedan 18), 9 (`console.log`, quedan 38), 12 (App.jsx ahora 1.571 líneas).

**Hecho 16/11/2026:** #17 en Mantenimientos (lista: solo abiertos + búsqueda de completados en servidor; dashboard: paginado y pestaña Análisis oculta). De #17 falta `EquiposList`, Historial de inspecciones y Dashboard Ejecutivo.
