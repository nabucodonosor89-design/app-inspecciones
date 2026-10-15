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
| **Logística** | Planificación de fletes con camiones propios: encargos → asignaciones camión + día (solo admin / logistica). Ver `supabase/logistica_v2_setup.sql`. Planificadas atrasadas se proyectan como copia visual hasta hoy; "Entregado" siempre vía RPC `entregar_asignacion` (guarda `fecha_programada` si el viaje se hizo otro día). Ver `supabase/logistica_v2_pendientes.sql` |
| **Historial de equipos** | Solo lectura (todos los roles): equipo → órdenes SAP → operaciones y componentes consumidos, y búsqueda inversa material → equipos. Lee vía RPC `historial_*` (SECURITY DEFINER). La columna **Órdenes** (Por material y Por equipo → Materiales) se abre y muestra las órdenes de esa combinación equipo × material vía `historial_material_ordenes` (carga perezosa, sin tope). En Por material, filtro **Clase** (`equipos.clase_vehiculo`, tal como está; excluyente con Equipo): una fila por material con Equipos (desplegable → equipos de la clase) · Órdenes · Total · Última, vía `historial_clase_materiales` y `historial_clase_material_equipos`; equipos sin clase no aparecen. Ver `supabase/historial_equipos_setup.sql` `historial_equipos_acceso_todos.sql` `historial_operaciones_setup.sql` `historial_material_ordenes.sql` y `historial_clase_materiales.sql` |
| **Rol compras** | Usuarios de Compras: al loguearse van directo al Historial de equipos, sin menú ni otros módulos. Ver `supabase/rol_compras_setup.sql` |
| **Correctivos** | Tablero de solo lectura, **solo usuarios con `usuarios.ve_correctivos = true`** (restricción de interfaz: tarjeta del menú + bloqueo del render en `App.jsx`; las vistas no cambian). Dar/quitar acceso por SQL: `update usuarios set ve_correctivos = true where email = 'x@itcsa.com.py';` (`false` para quitar). Ver `supabase/correctivos_acceso.sql`. Cruza correctivos de la app con órdenes, reservas y stock SAP. Pestañas Resumen · Ypané · Empresa · Materiales. Lee vistas `v_corr_*` (lógica en el esquema privado `corr`, filtradas por `corr_usuario_activo()`). Ver `supabase/correctivos_setup.sql`. Distinto del **Analista Correctivo** (`AnalistaCorrectivo.jsx`), que sigue igual |
| **Correctivos → Reunión** | Pestaña para la reunión semanal de equipos parados (proyectada). Parado = última hora/km (o carga de combustible si no tiene horas) más de 4 días antes del corte de su obra. "Qué lo frena" por orden: liberar → definir_repuestos → compras → traslado → retirar → ejecutar; por equipo el peor (compras > traslado > retirar > liberar > definir_repuestos > ejecutar). Ubicación y centro siempre de `sap_equipos`. Tareas en `correctivos_tareas` (crean/cierran admin o `usuarios.gestiona_correctivos`; sin delete). Lee `v_correctivos_parados` y `correctivos_parados_reservas(equipo)`. Ver `supabase/correctivos_reunion_setup.sql` |
| **Tabla `usuarios`** | Solo lectura desde la app (14/10/2026): `anon` y `authenticated` sin INSERT/UPDATE/DELETE. Rol, activo, `gestiona_correctivos`, `ve_correctivos` y `ve_completar_ordenes` se cambian solo por SQL Editor. El perfil se carga con columnas explícitas (`src/lib/perfil.js` → `PERFIL_COLUMNAS`, usado en `App.jsx` y `Login.jsx`) |
| **Completar órdenes IP30** | Para la encargada de preventivo (Evelyn), **solo usuarios con `usuarios.ve_completar_ordenes = true`** (tarjeta + RPC). Sube el Excel de órdenes del IP30 y la app completa Ubicación técnica (`sap_equipos.ubicacion`), Última carga y Fecha de última carga (último `sap_cargas_combustible.horometro` > 0; mismo día → el mayor) y devuelve el mismo Excel con formato intacto (`src/completarOrdenes/excelPatch.js` edita el XML con jszip; no se guarda nada). Resumen: sin IE36, sin lectura, lectura > 30 días, IE36 con ubicaciones distintas. Reemplaza la herramienta HTML `completar_ordenes`. Parte diario afuera. Lee RPC `ip30_datos_equipos` e `ip30_frescura`. Ver `supabase/completar_ordenes_ip30.sql`. **Fase 2 pendiente:** horas desde el último preventivo (falta fecha de cierre/horómetro del mantenimiento en la ingesta) |
| **Desde el último mantenimiento** | Solo lectura, mismo permiso `ve_completar_ordenes`. En la inspección, si "Ficha de mantenimiento" está OK se piden obligatorios el contador y la fecha del último mantenimiento (en aviso, opcionales); validación: contador ≤ horómetro de la inspección, fecha no futura. Se guardan en `inspecciones.ficha_service_contador` / `ficha_service_fecha` y se ven en el detalle. El módulo lista los equipos que trabajan (carga de combustible o uso en rastreo en 6 meses, o mantenimiento cargado; solo IE36) con el último mantenimiento y el trabajo desde entonces **por contador** (última carga SAP − contador del mantenimiento) y **por rastreo** (horas de marcha + ralentí y km de `consumo_combustible` desde el día siguiente al mantenimiento). Sin regla automática: decide la encargada. Lee RPC `service_desde_ultimo` y `service_frescura`. Ver `supabase/desde_ultimo_service.sql`. **Desde 15/10/2026 los mantenimientos viven en `services_equipo`** (origen `inspeccion` vía trigger sobre `inspecciones`, u origen `manual`): la encargada también los carga desde **Gestión de Equipos → 🔧 Mantenimiento** (solo contador y fecha, con datos del cierre de la orden preventiva; botón visible solo con `ve_completar_ordenes`). Vale el de fecha de mantenimiento más reciente. Correcciones: los manuales se anulan (`anular_service`, no se borran). Ver `supabase/services_equipo.sql`. **Período de mantenimiento por equipo** (`equipos.periodo_mtto` + `periodo_mtto_unidad` h/km; varía equipo por equipo, ej. camionetas 250 h, 5.000/7.000/10.000 km; si es por horas el inspector registra horas): se carga en la misma ventana 🔧 Mantenimiento (`fijar_periodo_mantenimiento`). La pantalla usa ahora `mantenimiento_seguimiento()` (reemplaza a `service_desde_ultimo`) y muestra **Próximo mantenimiento**: falta/pasado por contador y por rastreo (h motor o km según la unidad); verde, ámbar si falta ≤10 % del período, rojo si se pasó; ordena rojos → ámbar → resto; filtro "Sin período". Ver `supabase/periodo_mantenimiento.sql`. `service_seguimiento()` es una versión vieja sin uso (se puede borrar) |
| **Rastreo Monitor (n8n)** | Flujo "Reporte Diario de Flota - Monitor": desde 15/10/2026 guarda en `consumo_combustible` horas de marcha, ralentí y km de **todos** los móviles (sin sensor de combustible → litros null). Historia de los sin sensor cargada hacia atrás desde 26/08/2026. Usuario/contraseña de Monitor están en un nodo Code (pendiente pasarlos a credencial) |
| **Sincronización SAP → app** | `corr_sync_sap(p_dry_run)` reemplaza la rutina de Cowork: R1 asigna N° de orden a avisos, R2 libera correctivos con orden cerrada en SAP, R3 actualiza `equipos.ubicacion_actual`. Log en `corr.sync_log` (visible en Resumen → Cambios automáticos). Solo `service_role`. Ver `supabase/correctivos_sync.sql` |

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
| Ingesta automática de operaciones y avisos SAP | ⏸️ Ver con TI — hoy solo carga manual (CSV) |
| Recetario aviso → repuestos (parte del objeto × modelo → materiales usados históricamente) | 💡 Futuro — depende de la ingesta de avisos. Prueba con "Alternador": 97/151 órdenes con material relacionado; receta por modelo = correas/rulemanes |
| Vista por modelo (qué falla / qué consume) y sugerencia de repuestos por horas trabajadas | 💡 Futuro — horas en `sap_imputaciones` solo desde abr-2026 |
| Memory leak en SubidaFotos | 🟡 Pendiente |
| `sap_ordenes.equipo` es el **centro de costo**, no el ID técnico (el correcto sale de `equipo_sap` → `sap_equipos.equipo`). Difieren en ~550 órdenes / 39 valores (ej. VP-CZ000, VP-CG000, EL-LAB00, ADM_1002). Afecta historial_*, `corr.ordenes`, `corr.par_ordenes_abiertas` (Reunión), `ag_ordenes`, `v_compras_materiales`. Además 80 `equipo_sap` sin maestro en `sap_equipos` | ⏸️ Decidido dejar como está (14/10/2026) — bajo impacto. Propuesta si se retoma: columna `sap_ordenes.equipo_id` resuelta por trigger |
| Sync SAP → app: nodo n8n al final de la ingesta llamando `rpc/corr_sync_sap` con `{"p_dry_run": true}` | 🟠 Pendiente — ver `memory/arquitectura.md` |
| Sync SAP → app: salir del modo prueba (cambiar a `{"p_dry_run": false}`) **y el mismo día apagar la rutina de Cowork** | ⏸️ Después de 2 semanas en prueba (desde que n8n la llame) |

## Stack técnico
- **Frontend:** React 19, Vite 7, estilos inline (sin Tailwind ni CSS framework)
- **Backend:** Supabase (PostgreSQL + Auth + Storage + Edge Functions)
- **Fotos:** Cloudinary (upload directo desde cliente — pendiente mover a server-side)
- **Email:** Resend (a configurar)
- **PDF:** jsPDF + jsPDF-autotable
- **Excel:** xlsx (SheetJS)
