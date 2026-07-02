# Glosario — Sistema de Gestión TyE

## Módulos de la app
| Nombre | Archivo | Descripción |
|--------|---------|-------------|
| Inspecciones | `src/NuevaInspeccion.jsx` | Formulario 3 pasos: equipo → checklist+fotos → confirmación |
| Panel de Flota | `src/DashboardFlota.jsx` | Dashboard operativo: semáforos, equipos sin actividad, fallas |
| Dashboard Ejecutivo | `src/DashboardEjecutivo.jsx` | KPIs gerenciales por obra/tipo |
| Mantenimientos | `src/ListaMantenimientos.jsx` | Kanban de OTs de mantenimiento |
| Pedidos de Compra | módulo en App.jsx | Solicitudes de materiales/repuestos |
| Pedidos de Equipos | módulo en App.jsx | Asignación de equipos a obras |
| Gestión de Equipos | módulo en App.jsx | CRUD del inventario de flota |
| Operadores | módulo en App.jsx | Gestión de operadores habilitados |
| Historial | `src/HistorialInspecciones.jsx` + `src/HistorialInspeccionesCompleto.jsx` | Búsqueda y filtro de inspecciones pasadas |

## Tablas de Supabase
| Tabla | Campos clave | Notas |
|-------|-------------|-------|
| `equipos` | id, numero_identificacion, denominacion, tipo_equipo, estado_operativo, semaforo_actual, ubicacion_actual, activo, operador_asignado_id, fabricante, modelo, matricula | Registro maestro de flota |
| `inspecciones` | id, equipo_id, inspector_id, tipo_inspeccion, fecha_hora, horometro_odometro, ubicacion, observaciones_generales, semaforo, estado, motivo_envio, operador_id | Una fila = una inspección completa |
| `checklist_items` | id, inspeccion_id, item_nombre, categoria, estado (ok/warning/fail), es_critico, observacion | Ítems individuales del checklist |
| `checklist_templates` | id, tipo_equipo, item_nombre, categoria, es_critico, orden | Plantillas de checklist por tipo de equipo |
| `mantenimientos` | id, equipo_id, inspeccion_id, tipo_mantenimiento, numero_aviso, numero_orden, descripcion_averia, prioridad (1-4), estado, fecha_inicio_averia, fecha_ingreso_taller, fecha_liberacion, pedido, ingresa_taller_ypane, taller_tercero | OTs de mantenimiento |
| `usuarios` | id, email, nombre_completo | Usuarios de la app (autenticados vía Supabase Auth) |
| `operadores` | id, nombres, apellidos, numero_documento, estado (activo/inactivo), tipos_equipos_habilitado | Operadores que manejan equipos |
| `obras` | id, nombre_obra, codigo_obra, activa | Obras/proyectos donde están los equipos |
| `pedidos_compra` | id, estado (en_proceso/recibido), created_at | Solicitudes de compra de materiales |
| `pedidos_equipos_lineas` | id, numero_pedido, email_solicitante, tipo_equipo_solicitado, cantidad_solicitada, obra_id, equipo_asignado_id, estado_aprobacion, estado_entrega, fecha_recepcion | Solicitudes de asignación de equipos a obras |
| `inspeccion_fotos` | id, inspeccion_id, url, public_id, descripcion, tipo | Fotos almacenadas en Cloudinary |

## Vocabulario del negocio
| Término | Significado |
|---------|-------------|
| **semáforo** | Estado visual de un equipo: 🟢 verde / 🟡 amarillo / 🔴 rojo |
| **rojo** | Al menos 1 ítem crítico en estado "fail" |
| **amarillo** | Ítem crítico en "warning", o 2+ ítems no críticos con problemas |
| **verde** | Todo OK |
| **crítico** | Ítem de checklist con `es_critico = true` — fallo implica rojo automático |
| **horómetro** | Horas de trabajo acumuladas del equipo (campo `horometro_odometro`) |
| **OT** | Orden de trabajo (mantenimiento) |
| **aviso SAP** | Número de aviso en SAP PM asociado al mantenimiento |
| **orden SAP** | Número de orden de trabajo en SAP |
| **envio** | Tipo inspección al salir el equipo hacia una obra |
| **recepcion** | Tipo inspección al volver de obra |
| **periodica** | Inspección de mantenimiento programado |
| **taller** | Inspección antes/después de pasar por taller |
| **almacenamiento** | Inspección de equipo en stock/bodega |
| **motivo envio** | pedido / reemplazo (por qué se envía el equipo) |
| **Complejo Ypane** | Base / taller central de T&C SA |
| **estado_operativo** | operativo / con_restriccion / fuera_servicio |
| **fuera_servicio** | Equipo no disponible para usar |
| **con_restriccion** | Equipo usable con limitaciones |

## Estados de mantenimiento (Kanban)
1. **Taller Espera** — OT creada, esperando ingreso
2. **Taller Entrada** — Equipo ingresó al taller
3. **Taller Salida** — Equipo liberado

## Prioridades de mantenimiento
| Código | Nombre |
|--------|--------|
| 1 | Muy Elevado |
| 2 | Alto |
| 3 | Medio |
| 4 | Bajo |

## Tipos de equipo (comunes)
- Camión / Camión articulado
- Camioneta / Pick-up
- Excavadora
- Motoniveladora
- Retroexcavadora
- Compactadora
- Grúa
- Generador

## RPC Functions en Supabase
| Función | Qué hace |
|---------|---------|
| `asignar_operador_a_equipo(p_equipo_id, p_operador_id, p_inspeccion_id, p_observaciones)` | Asigna operador a equipo, registra en inspección |
| `equipos_sin_inspeccion_reciente()` | Devuelve equipos activos con >14 días sin inspección |

## Archivos clave del proyecto
| Archivo | Rol |
|---------|-----|
| `src/App.jsx` | Raíz de la app — navegación por `modulo` state, 8 módulos |
| `src/lib/supabase.js` | Cliente Supabase único |
| `src/utils/semaforo.js` | `getSemaforoColor()`, `getSemaforoEmoji()`, `getSemaforoTexto()` |
| `src/utils/ui.js` | `toast(msg, tipo)` y `confirmar(msg)` via CustomEvent |
| `src/utils/cloudinary.js` | Upload de fotos a Cloudinary |
| `supabase/functions/recordatorio-inspecciones/index.ts` | Edge Function: email lunes 7AM |
| `supabase/recordatorio_setup.sql` | SQL: función + pg_cron para el recordatorio |
| `AUDITORIA_TECNICA.md` | 16 hallazgos de la auditoría técnica |
