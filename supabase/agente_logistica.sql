-- ============================================================
-- Agente de logística v1 (Telegram + n8n, SOLO CONSULTA)
-- - usuarios.telegram_chat_id
-- - bot_usuario_logistica(chat_id)             → valida admin/logistica activo
-- - bot_log_pendientes(chat_id)                → atrasados / sin asignar / por confirmar
-- - bot_log_agenda(chat_id, desde, hasta, eq)  → camión × día (libre, taller, conflicto)
-- - bot_consultas                              → registro de consultas (lo escribe n8n)
-- Todas SECURITY DEFINER, solo service_role. Idempotente.
-- Ver prompt-cowork-agente-logistica-v1.md
-- ============================================================

-- 1. Usuario de Telegram ---------------------------------------
-- Se carga a mano (SQL Editor):
--   update usuarios set telegram_chat_id = 1086753096 where email = 'andres.lopez@itcsa.com.py';
-- Quitar acceso: set telegram_chat_id = null.
-- La app no puede editarla: anon/authenticated no tienen INSERT/UPDATE sobre usuarios (14/10/2026).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telegram_chat_id bigint;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_telegram_chat_id_key') THEN
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_telegram_chat_id_key UNIQUE (telegram_chat_id);
  END IF;
END $$;

-- 2. Helper de formato: "jue 09/10" ------------------------------
CREATE OR REPLACE FUNCTION bot_fmt_dia(p date) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT (ARRAY['dom','lun','mar','mié','jue','vie','sáb'])[extract(dow FROM p)::int + 1]
         || ' ' || to_char(p, 'DD/MM')
$$;

-- 3. Validación del usuario --------------------------------------
CREATE OR REPLACE FUNCTION bot_usuario_logistica(p_chat_id bigint)
RETURNS TABLE (id uuid, nombre text, rol text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.nombre_completo, u.rol
    FROM usuarios u
   WHERE p_chat_id IS NOT NULL
     AND u.telegram_chat_id = p_chat_id
     AND u.activo = true
     AND u.rol IN ('admin','logistica')
$$;

-- 4. Camiones en taller hoy (cualquier tipo de mantenimiento abierto) ---
--    Interna: la usan las dos herramientas.
CREATE OR REPLACE FUNCTION bot_log_taller()
RETURNS TABLE (equipo_id uuid, estado_taller text, dias_taller int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.equipo_id,
         CASE WHEN bool_or(m.estado = 'Taller Entrada') THEN 'en reparación' ELSE 'en espera' END,
         (hoy_py() - min(coalesce(m.fecha_ingreso_taller, m.fecha_inicio_averia)))::int
    FROM mantenimientos m
    JOIN equipos e ON e.id = m.equipo_id AND e.es_logistica AND e.activo
   WHERE m.estado IN ('Taller Espera','Taller Entrada')
   GROUP BY m.equipo_id
$$;

-- 5. Fletes pendientes -------------------------------------------
--    Pendiente = abierto y (subestado atrasado | sin_asignar) o con entregas sin confirmar.
--    Sección con la misma precedencia que seccionDe() de la Bandeja:
--    atrasado > por_confirmar > sin_asignar. "En curso" no es pendiente.
--    Diferencia con la Bandeja: un sin_asignar con fecha requerida = hoy la Bandeja lo
--    muestra en "Para hoy"; acá va en sin_asignar (sigue sin camión).
CREATE OR REPLACE FUNCTION bot_log_pendientes(p_chat_id bigint)
RETURNS TABLE (
  seccion text, descripcion text, origen text, destino text,
  cantidad numeric, unidad text, cantidad_confirmada numeric, cantidad_sin_confirmar numeric,
  fecha_requerida date, dias_atraso int, proximos_camiones text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hoy date := hoy_py();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM bot_usuario_logistica(p_chat_id)) THEN
    RAISE EXCEPTION 'Acceso no autorizado';
  END IF;

  RETURN QUERY
  WITH taller AS (SELECT * FROM bot_log_taller()),
  base AS (
    SELECT v.*,
           CASE WHEN v.subestado = 'atrasado' THEN 'atrasado'
                WHEN v.n_entregadas > 0       THEN 'por_confirmar'
                WHEN v.subestado = 'sin_asignar' THEN 'sin_asignar' END AS sec
      FROM v_encargos v
     WHERE v.estado = 'abierto'
  )
  SELECT b.sec,
         b.descripcion, b.origen_nombre, b.destino_nombre,
         b.cantidad, b.unidad, b.cantidad_confirmada, b.cantidad_sin_confirmar,
         b.fecha_requerida,
         CASE WHEN b.sec = 'atrasado' THEN
           (v_hoy - least(
              CASE WHEN b.fecha_requerida < v_hoy THEN b.fecha_requerida END,
              (SELECT min(a.fecha) FROM asignaciones a
                WHERE a.encargo_id = b.id AND a.estado = 'planificada' AND a.fecha < v_hoy)))::int
         END,
         (SELECT string_agg(
                   e.numero_identificacion || ' ' ||
                   CASE WHEN a.fecha < v_hoy THEN 'pendiente desde ' ELSE '' END || bot_fmt_dia(a.fecha) ||
                   CASE WHEN t.equipo_id IS NOT NULL THEN ' ⚠ en taller' ELSE '' END,
                   ', ' ORDER BY a.fecha, e.numero_identificacion)
            FROM asignaciones a
            JOIN equipos e ON e.id = a.equipo_id
            LEFT JOIN taller t ON t.equipo_id = a.equipo_id
           WHERE a.encargo_id = b.id AND a.estado = 'planificada')
    FROM base b
   WHERE b.sec IS NOT NULL
   ORDER BY CASE b.sec WHEN 'atrasado' THEN 1 WHEN 'sin_asignar' THEN 2 ELSE 3 END,
            b.fecha_requerida NULLS LAST, b.created_at;
END $$;

-- 6. Agenda camión × día -----------------------------------------
--    Una fila por camión y día del rango (máx. 14 días), incluidos los días sin asignaciones.
--    Asignaciones del día = las de esa fecha (cualquier estado) + las planificadas de días
--    anteriores arrastradas (solo en días <= hoy), igual que la vista Día de la app.
--    Libre: sin asignaciones ese día y, si el día es hoy o anterior, no en taller.
--    Conflicto (por camión, en todas sus filas): en taller hoy y con alguna asignación
--    planificada (futura o arrastrada). conflicto_detalle lo describe.
CREATE OR REPLACE FUNCTION bot_log_agenda(p_chat_id bigint, p_desde date, p_hasta date, p_equipo text DEFAULT NULL)
RETURNS TABLE (
  fecha date, equipo text, denominacion text, chofer_habitual text,
  asignaciones jsonb, n_asignaciones int,
  en_taller_hoy boolean, estado_taller text, dias_taller int,
  libre boolean, conflicto boolean, conflicto_detalle text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hoy date := hoy_py();
  v_eq  text := nullif(upper(trim(p_equipo)), '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM bot_usuario_logistica(p_chat_id)) THEN
    RAISE EXCEPTION 'Acceso no autorizado';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL THEN
    RAISE EXCEPTION 'Faltan las fechas: indicá desde y hasta (AAAA-MM-DD)';
  END IF;
  IF p_hasta < p_desde THEN
    RAISE EXCEPTION 'Rango inválido: la fecha hasta (%) es anterior a desde (%)',
      to_char(p_hasta, 'DD/MM/YYYY'), to_char(p_desde, 'DD/MM/YYYY');
  END IF;
  IF p_hasta - p_desde > 13 THEN
    RAISE EXCEPTION 'El rango puede ser de 14 días como máximo (pediste %)', p_hasta - p_desde + 1;
  END IF;
  IF v_eq IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM equipos WHERE numero_identificacion = v_eq AND es_logistica AND activo) THEN
    RAISE EXCEPTION 'No hay un camión de logística activo con el ID %', v_eq;
  END IF;

  RETURN QUERY
  WITH camiones AS (
    SELECT e.id, e.numero_identificacion, e.denominacion,
           nullif(trim(coalesce(o.nombres,'') || ' ' || coalesce(o.apellidos,'')), '') AS chofer
      FROM equipos e
      LEFT JOIN operadores o ON o.id = e.operador_asignado_id
     WHERE e.es_logistica AND e.activo
       AND (v_eq IS NULL OR e.numero_identificacion = v_eq)
  ),
  dias AS (SELECT g::date AS d FROM generate_series(p_desde, p_hasta, interval '1 day') g),
  taller AS (SELECT * FROM bot_log_taller()),
  enc AS (
    SELECT e.id, e.descripcion,
           coalesce(lo.nombre, oo.nombre_obra) AS origen,
           coalesce(ld.nombre, od.nombre_obra) AS destino
      FROM encargos e
      LEFT JOIN lugares lo ON lo.id = e.origen_lugar_id
      LEFT JOIN obras   oo ON oo.id = e.origen_obra_id
      LEFT JOIN lugares ld ON ld.id = e.destino_lugar_id
      LEFT JOIN obras   od ON od.id = e.destino_obra_id
  ),
  ocup AS (   -- asignaciones que ocupan cada camión cada día
    SELECT a.equipo_id, a.fecha AS d, a.encargo_id, a.operador_id, a.estado, NULL::date AS pendiente_desde
      FROM asignaciones a
     WHERE a.fecha BETWEEN p_desde AND p_hasta
    UNION ALL
    SELECT a.equipo_id, dd.d, a.encargo_id, a.operador_id, a.estado, a.fecha
      FROM asignaciones a
      JOIN dias dd ON dd.d > a.fecha AND dd.d <= v_hoy
     WHERE a.estado = 'planificada' AND a.fecha < least(p_hasta, v_hoy)
  ),
  ocup_j AS (
    SELECT x.equipo_id, x.d,
           jsonb_agg(jsonb_build_object(
             'encargo', en.descripcion, 'origen', en.origen, 'destino', en.destino,
             'estado', x.estado,
             'chofer', nullif(trim(coalesce(o.nombres,'') || ' ' || coalesce(o.apellidos,'')), ''),
             'pendiente_desde', x.pendiente_desde)
             ORDER BY x.pendiente_desde NULLS LAST, en.descripcion) AS lista,
           count(*)::int AS n
      FROM ocup x
      JOIN enc en ON en.id = x.encargo_id
      LEFT JOIN operadores o ON o.id = x.operador_id
     GROUP BY x.equipo_id, x.d
  ),
  confl AS (
    SELECT a.equipo_id,
           string_agg(en.descripcion || ' → ' || coalesce(en.destino, '?') || ' (' ||
                      CASE WHEN a.fecha < v_hoy THEN 'pendiente desde ' ELSE '' END ||
                      bot_fmt_dia(a.fecha) || ')', '; ' ORDER BY a.fecha) AS detalle
      FROM asignaciones a
      JOIN taller t ON t.equipo_id = a.equipo_id
      JOIN enc en ON en.id = a.encargo_id
     WHERE a.estado = 'planificada'
     GROUP BY a.equipo_id
  )
  SELECT dd.d, c.numero_identificacion, c.denominacion, c.chofer,
         coalesce(oj.lista, '[]'::jsonb), coalesce(oj.n, 0),
         t.equipo_id IS NOT NULL, t.estado_taller, t.dias_taller,
         coalesce(oj.n, 0) = 0 AND (dd.d > v_hoy OR t.equipo_id IS NULL),
         cf.equipo_id IS NOT NULL, cf.detalle
    FROM camiones c
   CROSS JOIN dias dd
    LEFT JOIN ocup_j oj ON oj.equipo_id = c.id AND oj.d = dd.d
    LEFT JOIN taller t  ON t.equipo_id = c.id
    LEFT JOIN confl cf  ON cf.equipo_id = c.id
   ORDER BY dd.d, c.numero_identificacion;
END $$;

-- 7. Registro de consultas ---------------------------------------
CREATE TABLE IF NOT EXISTS bot_consultas (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  bot            text NOT NULL DEFAULT 'logistica',
  usuario_id     uuid REFERENCES usuarios(id),
  chat_id        bigint,           -- para ver quién intentó entrar (no_autorizado)
  pregunta       text,
  herramientas   text[],
  tokens_entrada int,
  tokens_salida  int,
  error          text
);
-- 23/10/2026: n8n no deja leer el uso de tokens desde el nodo Code; se guarda el id de ejecución
-- y los tokens se completan después leyendo la ejecución (tokenUsage del nodo Claude Haiku).
ALTER TABLE bot_consultas ADD COLUMN IF NOT EXISTS n8n_ejecucion text;
CREATE INDEX IF NOT EXISTS idx_bot_consultas_bot_fecha ON bot_consultas (bot, created_at DESC);
ALTER TABLE bot_consultas ENABLE ROW LEVEL SECURITY;   -- sin políticas: solo service_role
REVOKE ALL ON bot_consultas FROM anon, authenticated;
GRANT SELECT, INSERT ON bot_consultas TO service_role;

-- 8. Permisos -----------------------------------------------------
REVOKE ALL ON FUNCTION bot_fmt_dia(date)                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION bot_usuario_logistica(bigint)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION bot_log_taller()                           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION bot_log_pendientes(bigint)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION bot_log_agenda(bigint, date, date, text)   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION bot_fmt_dia(date)                        TO service_role;
GRANT EXECUTE ON FUNCTION bot_usuario_logistica(bigint)            TO service_role;
GRANT EXECUTE ON FUNCTION bot_log_taller()                         TO service_role;
GRANT EXECUTE ON FUNCTION bot_log_pendientes(bigint)               TO service_role;
GRANT EXECUTE ON FUNCTION bot_log_agenda(bigint, date, date, text) TO service_role;
