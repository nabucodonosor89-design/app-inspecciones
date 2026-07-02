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
