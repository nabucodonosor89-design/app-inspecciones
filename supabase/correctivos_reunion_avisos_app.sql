-- ============================================================
-- CORRECTIVOS → Reunión: sumar avisos correctivos abiertos de la app (27/10/2026)
-- Caso que lo disparó: PO-RE025 (4 avisos abiertos) no aparecía: 2 avisos de la app
-- sin orden SAP y SAP le imputaba 0,3–0,8 h/día → figuraba «trabajando».
-- Decisiones (Andrés, 27/10/2026):
--   1. Universo = órdenes SAP correctivas abiertas + avisos correctivos abiertos en la app
--      (corr.app: Taller Espera / Taller Entrada) que no tengan una orden SAP abierta.
--      Un aviso sin orden frena con «generar_orden» (área Taller).
--   2. Cualquier aviso correctivo abierto en la app (Espera o Entrada) = PARADO,
--      sin mirar las horas SAP. Parado desde = fecha de ingreso al taller o, si falta,
--      inicio de la avería (corr.app.fecha_ref); si además SAP lo da parado desde antes,
--      vale la fecha más vieja. Días = hoy − desde (con aviso en app) o corte de obra −
--      última actividad (solo SAP, como antes).
-- Peor freno por equipo: compras > traslado > retirar > generar_orden > liberar >
--   definir_repuestos > ejecutar.
-- Columnas nuevas (al final): motivo_parado ('sap' | 'app' | 'app_y_sap'), cant_avisos_app.
-- Ítems de «ordenes» de la app: orden null, aviso, origen 'app'. Las de SAP: origen 'sap'.
-- ============================================================
create or replace view corr.par_equipos as
WITH app_items AS (
         SELECT a.equipo, a.numero_aviso AS aviso, a.descripcion_averia AS texto, a.estado_label, a.fecha_ref
           FROM corr.app a
          WHERE NULLIF(TRIM(BOTH FROM a.equipo), ''::text) IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM corr.par_ordenes_abiertas p WHERE p.orden = a.orden_cruzada)
        ), app_eq AS (
         SELECT TRIM(BOTH FROM a.equipo) AS equipo, min(a.fecha_ref) AS desde_app
           FROM corr.app a
          WHERE NULLIF(TRIM(BOTH FROM a.equipo), ''::text) IS NOT NULL
          GROUP BY TRIM(BOTH FROM a.equipo)
        ), u AS (
         SELECT par_ordenes.equipo, par_ordenes.orden, NULL::text AS aviso, par_ordenes.texto,
                par_ordenes.status_usuario, par_ordenes.freno, par_ordenes.fecha_entrada, 'sap'::text AS origen
           FROM corr.par_ordenes
        UNION ALL
         SELECT TRIM(BOTH FROM app_items.equipo), NULL::bigint, app_items.aviso, app_items.texto,
                app_items.estado_label, 'generar_orden'::text, app_items.fecha_ref, 'app'::text
           FROM app_items
        ), o AS (
         SELECT u.equipo,
            jsonb_agg(jsonb_build_object('orden', u.orden, 'aviso', u.aviso, 'origen', u.origen, 'texto', u.texto,
                      'status_usuario', u.status_usuario, 'freno', u.freno, 'fecha_entrada', u.fecha_entrada)
                      ORDER BY u.fecha_entrada DESC NULLS LAST, u.orden DESC NULLS LAST) AS ordenes,
            count(*) FILTER (WHERE u.origen = 'sap') AS cant_ordenes,
            count(*) FILTER (WHERE u.origen = 'app') AS cant_avisos_app,
            min(CASE u.freno
                    WHEN 'compras' THEN 1 WHEN 'traslado' THEN 2 WHEN 'retirar' THEN 3
                    WHEN 'generar_orden' THEN 4 WHEN 'liberar' THEN 5 WHEN 'definir_repuestos' THEN 6
                    ELSE 7 END) AS peor,
            bool_or(u.status_usuario = '0TES' AND u.origen = 'sap') AS tiene_0tes
           FROM u
          GROUP BY u.equipo
        ), base AS (
         SELECT o.*, a.estado_actividad AS estado_sap, a.fuente_actividad, a.ult_hora, a.ult_carga,
                a.ultima_actividad, a.corte_obra, ae.equipo IS NOT NULL AS con_app, ae.desde_app
           FROM o
             LEFT JOIN corr.par_actividad a ON a.equipo = o.equipo
             LEFT JOIN app_eq ae ON ae.equipo = o.equipo
        )
 SELECT b.equipo,
    inv.denominacion,
    COALESCE(inv.ubicacion, 'Sin ubicación'::text) AS ubicacion,
    inv.centro,
    CASE WHEN b.con_app THEN 'parado'::text ELSE COALESCE(b.estado_sap, 'sin_datos'::text) END AS estado_actividad,
    b.fuente_actividad,
    b.ult_hora,
    b.ult_carga,
    CASE
        WHEN b.con_app AND b.estado_sap = 'parado' THEN LEAST(b.ultima_actividad, b.desde_app)
        WHEN b.con_app THEN b.desde_app
        WHEN b.estado_sap = 'parado' THEN b.ultima_actividad
        ELSE NULL::date
    END AS parado_desde,
    CASE
        WHEN b.con_app THEN corr_hoy() - CASE WHEN b.estado_sap = 'parado' THEN LEAST(b.ultima_actividad, b.desde_app) ELSE b.desde_app END
        WHEN b.estado_sap = 'parado' THEN b.corte_obra - b.ultima_actividad
        ELSE NULL::integer
    END AS dias_parado,
    b.corte_obra,
    (ARRAY['compras'::text, 'traslado'::text, 'retirar'::text, 'generar_orden'::text, 'liberar'::text, 'definir_repuestos'::text, 'ejecutar'::text])[b.peor] AS freno,
    CASE b.peor WHEN 1 THEN 'Compras'::text WHEN 2 THEN 'Depósito/Transporte'::text ELSE 'Taller'::text END AS area_freno,
    b.cant_ordenes,
    b.ordenes,
    (b.tiene_0tes AND NOT b.con_app AND b.estado_sap = 'trabajando') AS tiene_candidata_cierre,
    CASE
        WHEN b.con_app AND b.estado_sap = 'parado' THEN 'app_y_sap'::text
        WHEN b.con_app THEN 'app'::text
        WHEN b.estado_sap = 'parado' THEN 'sap'::text
    END AS motivo_parado,
    b.cant_avisos_app
   FROM base b
     LEFT JOIN corr.par_inventario inv ON inv.equipo = b.equipo;

create or replace view public.v_correctivos_parados as
 SELECT equipo, denominacion, ubicacion, centro, estado_actividad, fuente_actividad, ult_hora, ult_carga,
    parado_desde, dias_parado, corte_obra, freno, area_freno, cant_ordenes, ordenes, tiene_candidata_cierre,
    motivo_parado, cant_avisos_app
   FROM corr.par_equipos
  WHERE ( SELECT corr_usuario_activo() AS corr_usuario_activo);
