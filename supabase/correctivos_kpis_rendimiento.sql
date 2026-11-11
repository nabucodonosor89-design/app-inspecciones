-- ============================================================
-- CORRECTIVOS → RESUMEN: v_corr_kpis en una pasada (06/11/2026). Aplicado en Supabase.
-- Antes cada KPI era una subconsulta propia: corr.sap_abiertas se calculaba 16 veces, corr.app 8,
-- corr.inconsistencias 5, v_corr_materiales 3, cierres_90 3 → ~7 s (statement_timeout de la app: 8 s).
-- Ahora cada fuente se calcula una vez (CTE MATERIALIZED) y los KPI salen con count(*) FILTER.
-- Mismas 34 columnas, mismo orden y mismos valores (comparado: 0 diferencias). ~0,4 s.
-- ============================================================
CREATE OR REPLACE VIEW public.v_corr_kpis AS
WITH sa AS MATERIALIZED (
         SELECT sap_abiertas.en_app, sap_abiertas.dias_abierta, sap_abiertas.equipo, sap_abiertas.tipo, sap_abiertas.accion
           FROM corr.sap_abiertas
        ), ap AS MATERIALIZED (
         SELECT app.estado, app.taller_tipo, app.es_critico, app.orden_n, app.pedido, app.dias_taller
           FROM corr.app
        ), inc AS MATERIALIZED (
         SELECT inconsistencias.motivo
           FROM corr.inconsistencias
        ), dup AS MATERIALIZED (
         SELECT v_corr_duplicados.equipo
           FROM v_corr_duplicados
        ), mat AS MATERIALIZED (
         SELECT v_corr_materiales.situacion
           FROM v_corr_materiales
        ), ci AS MATERIALIZED (
         SELECT cierres_90.dias
           FROM corr.cierres_90
        ), k_sa AS (
         SELECT count(*) AS sap_abiertas,
            count(*) FILTER (WHERE sa.en_app) AS sap_en_app,
            count(*) FILTER (WHERE NOT sa.en_app) AS sap_solo_sap,
            count(*) FILTER (WHERE NOT sa.en_app AND sa.dias_abierta > 10) AS sap_solo_sap_10d,
            count(*) FILTER (WHERE sa.equipo IS NULL) AS sap_sin_equipo,
            count(*) FILTER (WHERE sa.tipo = 'V'::text) AS tipo_v,
            count(*) FILTER (WHERE sa.tipo = 'P'::text) AS tipo_p,
            count(*) FILTER (WHERE sa.tipo = 'M'::text) AS tipo_m,
            count(*) FILTER (WHERE sa.tipo = 'B'::text) AS tipo_b,
            count(*) FILTER (WHERE sa.tipo = 'S'::text) AS tipo_s,
            count(*) FILTER (WHERE NOT sa.en_app AND sa.accion = 'cierre_candidato'::text) AS sap_cierre_candidatas,
            count(*) FILTER (WHERE NOT sa.en_app AND sa.accion = 'verificar'::text) AS sap_verificar,
            count(*) FILTER (WHERE NOT sa.en_app AND sa.accion = 'completar_equipo'::text) AS sap_completar_equipo
           FROM sa
        ), k_ap AS (
         SELECT count(*) AS yp_en_taller,
            count(*) FILTER (WHERE ap.estado = 'Taller Espera'::text) AS yp_en_espera,
            count(*) FILTER (WHERE ap.estado = 'Taller Entrada'::text) AS yp_en_reparacion,
            count(*) FILTER (WHERE ap.taller_tipo = 'Tercero'::text) AS yp_terceros,
            count(*) FILTER (WHERE ap.es_critico) AS yp_criticos,
            count(*) FILTER (WHERE ap.orden_n IS NULL) AS yp_sin_orden,
            count(*) FILTER (WHERE NOT COALESCE(ap.pedido, false)) AS yp_sin_pedido,
            count(*) FILTER (WHERE ap.dias_taller > 10) AS yp_urgentes
           FROM ap
        ), k_inc AS (
         SELECT count(*) AS inc_total,
            count(*) FILTER (WHERE inc.motivo = 'orden_cerrada'::text) AS inc_orden_cerrada,
            count(*) FILTER (WHERE inc.motivo = 'sin_orden_ni_aviso'::text) AS inc_sin_orden_ni_aviso,
            count(*) FILTER (WHERE inc.motivo = 'orden_no_encontrada'::text) AS inc_orden_no_encontrada,
            count(*) FILTER (WHERE inc.motivo = 'aviso_sin_orden'::text) AS inc_aviso_sin_orden
           FROM inc
        ), k_dup AS (
         SELECT count(DISTINCT dup.equipo) AS equipos_multi_orden,
            count(*) AS ordenes_multi_orden
           FROM dup
        ), k_mat AS (
         SELECT count(*) FILTER (WHERE mat.situacion = 'bloqueo'::text) AS mat_bloqueo,
            count(*) FILTER (WHERE mat.situacion = 'parcial'::text) AS mat_parcial,
            count(*) FILTER (WHERE mat.situacion = 'despacho'::text) AS mat_despacho
           FROM mat
        ), k_ci AS (
         SELECT round(avg(ci.dias) FILTER (WHERE ci.dias <= 60), 1) AS mttr_90d,
            count(*) FILTER (WHERE ci.dias <= 60) AS mttr_cierres,
            count(*) FILTER (WHERE ci.dias > 60) AS mttr_outliers
           FROM ci
        )
 SELECT k_sa.sap_abiertas, k_sa.sap_en_app, k_sa.sap_solo_sap, k_sa.sap_solo_sap_10d, k_sa.sap_sin_equipo,
    k_dup.equipos_multi_orden, k_dup.ordenes_multi_orden,
    k_sa.tipo_v, k_sa.tipo_p, k_sa.tipo_m, k_sa.tipo_b, k_sa.tipo_s,
    k_ap.yp_en_taller, k_ap.yp_en_espera, k_ap.yp_en_reparacion, k_ap.yp_terceros, k_ap.yp_criticos,
    k_ap.yp_sin_orden, k_ap.yp_sin_pedido, k_ap.yp_urgentes,
    k_inc.inc_total, k_inc.inc_orden_cerrada, k_inc.inc_sin_orden_ni_aviso, k_inc.inc_orden_no_encontrada, k_inc.inc_aviso_sin_orden,
    k_mat.mat_bloqueo, k_mat.mat_parcial, k_mat.mat_despacho,
    k_ci.mttr_90d, k_ci.mttr_cierres, k_ci.mttr_outliers,
    k_sa.sap_cierre_candidatas, k_sa.sap_verificar, k_sa.sap_completar_equipo
   FROM k_sa, k_ap, k_inc, k_dup, k_mat, k_ci
  WHERE ( SELECT corr_usuario_activo() AS corr_usuario_activo)
;
