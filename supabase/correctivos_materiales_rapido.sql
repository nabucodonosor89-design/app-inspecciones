-- ============================================================
-- CORRECTIVOS — v_corr_materiales más rápida (27/10/2026)
-- Antes: LEFT JOIN LATERAL a corr.app por cada línea de reserva → corr.app
-- (una vista pesada) se recalculaba cientos de veces: ~2,2–3 s.
-- Ahora: corr.app se calcula UNA vez (CTE materializado, DISTINCT ON por orden,
-- mismo criterio: el de más días en taller) y se une por orden: ~0,1 s.
-- Verificado: mismo resultado fila por fila (264 filas, 0 diferencias).
-- Mismas columnas, mismo dueño y permisos (create or replace).
-- ============================================================
create or replace view public.v_corr_materiales as
WITH app1 AS MATERIALIZED (
         SELECT DISTINCT ON (x.orden_cruzada) x.orden_cruzada, x.id, x.taller, x.dias_taller
           FROM corr.app x
          WHERE x.orden_cruzada IS NOT NULL
          ORDER BY x.orden_cruzada, x.dias_taller DESC NULLS LAST
        ), ords AS (
         SELECT o.orden,
            o.equipo,
            o.es_critico,
                CASE
                    WHEN (a.id IS NOT NULL) THEN 'App'::text
                    ELSE 'Solo SAP'::text
                END AS origen,
            COALESCE(a.taller, o.ubicacion) AS taller_o_ubicacion,
            COALESCE(a.dias_taller, o.dias_abierta) AS dias,
            o.texto AS texto_orden,
            o.aviso,
            o.denominacion
           FROM corr.sap_abiertas o
             LEFT JOIN app1 a ON a.orden_cruzada = o.orden
        ), lin AS (
         SELECT ords.orden, ords.equipo, ords.es_critico, ords.origen, ords.taller_o_ubicacion, ords.dias,
            ords.texto_orden, ords.aviso, ords.denominacion,
            r.posicion, r.material, r.descripcion, r.cantidad_pendiente, r.unidad,
            COALESCE(r.centro, '1002'::text) AS centro,
            s.stock_cierre AS stock_centro
           FROM ords
             JOIN sap_reservas_pos r ON r.orden = ords.orden AND r.cantidad_pendiente > (0)::numeric
             LEFT JOIN corr.stock s ON s.centro = COALESCE(r.centro, '1002'::text) AND s.material = r.material
        ), asig AS (
         SELECT lin.*,
            COALESCE(sum(lin.cantidad_pendiente) OVER (PARTITION BY lin.material, lin.centro ORDER BY lin.es_critico DESC, lin.dias DESC NULLS LAST, lin.orden, lin.posicion ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), (0)::numeric) AS demanda_previa
           FROM lin
        ), cub AS (
         SELECT asig.*,
            LEAST(asig.cantidad_pendiente, GREATEST((COALESCE(asig.stock_centro, (0)::numeric) - asig.demanda_previa), (0)::numeric)) AS cantidad_cubierta
           FROM asig
        )
 SELECT equipo,
    orden,
    origen,
    taller_o_ubicacion,
    es_critico,
    dias,
    material,
    descripcion,
    cantidad_pendiente,
    unidad,
    centro,
    stock_centro,
    cantidad_cubierta,
    (cantidad_pendiente - cantidad_cubierta) AS cantidad_faltante,
        CASE
            WHEN (cantidad_cubierta >= cantidad_pendiente) THEN 'despacho'::text
            WHEN (cantidad_cubierta > (0)::numeric) THEN 'parcial'::text
            ELSE 'bloqueo'::text
        END AS situacion,
    posicion,
    texto_orden,
    aviso,
    denominacion
   FROM cub
  WHERE ( SELECT corr_usuario_activo() AS corr_usuario_activo);
