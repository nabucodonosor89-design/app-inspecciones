-- ============================================================
-- SETUP: Recordatorio semanal de inspecciones
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

-- 1. Función que devuelve los equipos sin inspección reciente
--    (más de 14 días sin inspección o sin inspección alguna)
-- ============================================================
CREATE OR REPLACE FUNCTION equipos_sin_inspeccion_reciente()
RETURNS TABLE (
  id                    uuid,
  numero_identificacion text,
  denominacion          text,
  tipo_equipo           text,
  ubicacion_actual      text,
  estado_operativo      text,
  semaforo_actual       text,
  ultima_inspeccion     timestamptz,
  dias_sin_inspeccion   integer
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    e.id,
    e.numero_identificacion,
    e.denominacion,
    e.tipo_equipo,
    e.ubicacion_actual,
    e.estado_operativo,
    e.semaforo_actual,
    MAX(i.fecha_hora)                                              AS ultima_inspeccion,
    EXTRACT(DAY FROM NOW() - MAX(i.fecha_hora))::integer          AS dias_sin_inspeccion
  FROM equipos e
  LEFT JOIN inspecciones i ON i.equipo_id = e.id
  WHERE e.activo = true
  GROUP BY
    e.id, e.numero_identificacion, e.denominacion,
    e.tipo_equipo, e.ubicacion_actual, e.estado_operativo, e.semaforo_actual
  HAVING
    MAX(i.fecha_hora) < NOW() - INTERVAL '14 days'   -- con inspección vieja
    OR MAX(i.fecha_hora) IS NULL                       -- o sin inspección alguna
  ORDER BY dias_sin_inspeccion DESC NULLS FIRST;
$$;


-- ============================================================
-- 2. Habilitar pg_cron (solo si no está habilitado)
--    En Supabase: Dashboard → Database → Extensions → pg_cron
--    O ejecutar:
-- ============================================================
-- CREATE EXTENSION IF NOT EXISTS pg_cron;


-- ============================================================
-- 3. Programar el cron: lunes 7:00 AM Paraguay (= 11:00 AM UTC)
-- ============================================================
SELECT cron.schedule(
  'recordatorio-inspecciones-lunes',   -- nombre del job
  '0 11 * * 1',                        -- cron: lunes a las 11:00 UTC = 7:00 AM PY
  $$
    SELECT net.http_post(
      url     := current_setting('app.supabase_url') || '/functions/v1/recordatorio-inspecciones',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.supabase_anon_key')
      ),
      body    := '{}'::jsonb
    );
  $$
);


-- ============================================================
-- 4. Verificar que quedó registrado
-- ============================================================
SELECT jobid, jobname, schedule, command, active
FROM cron.job
WHERE jobname = 'recordatorio-inspecciones-lunes';


-- ============================================================
-- COMANDOS ÚTILES
-- ============================================================

-- Ver el historial de ejecuciones del cron:
-- SELECT * FROM cron.job_run_details WHERE jobname = 'recordatorio-inspecciones-lunes' ORDER BY start_time DESC LIMIT 10;

-- Pausar el cron temporalmente:
-- SELECT cron.unschedule('recordatorio-inspecciones-lunes');

-- Probar la función a mano (sin esperar el lunes):
-- SELECT * FROM equipos_sin_inspeccion_reciente();
