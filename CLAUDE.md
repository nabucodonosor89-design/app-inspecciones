# Memoria — app-inspecciones

## Quién soy
Andrés López, Encargado del Departamento de Transporte y Equipos (TyE) en **T&C SA** (Ingeniería de Topografía y Caminos S.A.). Gestiono la flota de equipos pesados y vehículos de la empresa.

## El proyecto
**Sistema de Gestión TyE** — app React 19 + Vite 7 + Supabase + Cloudinary.  
Ruta local: `C:\Users\andres.lopez\Desktop\app-inspecciones`  
Objetivo principal: cuidar los equipos, saber cómo están, evitar sorpresas al momento de usarlos.

## Módulos de la app
| Módulo | Descripción |
|--------|-------------|
| **Inspecciones** | Formulario multi-paso: seleccionar equipo → checklist → fotos → guardar |
| **Panel de Flota** | Dashboard operativo diario con semáforos, equipos sin actividad, fallas críticas |
| **Dashboard Ejecutivo** | KPIs por obra: operativos / restricción / fuera de servicio / vencidos |
| **Mantenimientos** | Kanban: Taller Espera → Taller Entrada → Taller Salida |
| **Pedidos de Compra** | Solicitudes de materiales (estados: en_proceso / recibido) |
| **Pedidos de Equipos** | Solicitudes de equipos para obras (aprobado / asignado / entregado) |
| **Gestión de Equipos** | CRUD del inventario de flota |
| **Operadores** | CRUD de operadores habilitados por tipo de equipo |

## Conceptos clave
| Término | Significado |
|---------|-------------|
| **semáforo** | Estado calculado de la inspección: verde / amarillo / rojo |
| **crítico** | Ítem del checklist marcado como `es_critico = true` |
| rojo | Al menos 1 ítem crítico en falla |
| amarillo | Crítico en aviso, o 2+ no críticos con problemas |
| verde | Todo OK |
| **envio** | Tipo de inspección al salir a obra |
| **recepcion** | Tipo de inspección al volver de obra |
| **horómetro** | Medidor de horas de trabajo del equipo (campo `horometro_odometro`) |
| **Complejo Ypane** | Base / taller central de T&C SA |
| **estado_operativo** | operativo / con_restriccion / fuera_servicio (campo en tabla `equipos`) |

→ Glosario completo: `memory/glossary.md`  
→ Arquitectura técnica: `memory/arquitectura.md`  
→ Deuda técnica pendiente: `memory/deuda_tecnica.md`

## Tareas en curso / pendientes
| Tarea | Estado |
|-------|--------|
| Recordatorio semanal (email lunes 7AM) | ✅ Código listo — falta activar en Supabase |
| Auditoría técnica completa | ✅ Ver `AUDITORIA_TECNICA.md` |
| Credenciales Cloudinary → Edge Function | 🔴 Pendiente (CRÍTICO) |
| `select('*')` → columnas explícitas | 🟠 Pendiente |
| DashboardEjecutivo: query sin límite | 🔴 Pendiente |
| `console.log` en producción | 🟡 Fácil: 1 línea en vite.config.js |
| Memory leak en SubidaFotos | 🟡 Pendiente |

## Stack técnico
- **Frontend:** React 19, Vite 7, estilos inline (sin Tailwind ni CSS framework)
- **Backend:** Supabase (PostgreSQL + Auth + Storage + Edge Functions)
- **Fotos:** Cloudinary (upload directo desde cliente — pendiente mover a server-side)
- **Email:** Resend (a configurar)
- **PDF:** jsPDF + jsPDF-autotable
- **Excel:** xlsx (SheetJS)
