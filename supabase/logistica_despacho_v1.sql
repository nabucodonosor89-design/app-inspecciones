-- ============================================================
-- Logística · Tablero de despacho por frente (v1)
-- - equipos.tipo_camion (lo carga el gerente desde la pantalla Camiones)
-- - encargos.categoria + encargos.tipo_camion_requerido
-- - v_encargos: categoria, tipo_camion_requerido, destino_key
-- Idempotente. Se aplica SOBRE logistica_v2_setup.sql + logistica_v2_pendientes.sql.
-- No cambia asignaciones, lugares, entregar_asignacion, subestados, cierre ni cancelación.
-- Ver prompt-cowork-logistica-despacho-v1.md
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tipo de camión en equipos
-- ------------------------------------------------------------
ALTER TABLE equipos ADD COLUMN IF NOT EXISTS tipo_camion text;

-- 17/11/2026: 'carreton' pasó a 'carreta_granelera'; se agregaron 'grua' (camión con grúa) y 'camioncito'.
-- (Migración logistica_despacho_v1_tipos_camion: se soltaron los CHECK, se renombraron los valores y se volvieron a crear.)
ALTER TABLE equipos DROP CONSTRAINT IF EXISTS equipos_tipo_camion_check;
ALTER TABLE encargos DROP CONSTRAINT IF EXISTS encargos_tipo_camion_requerido_check;
UPDATE equipos SET tipo_camion = 'carreta_granelera' WHERE tipo_camion = 'carreton';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'encargos' AND column_name = 'tipo_camion_requerido') THEN
    UPDATE encargos SET tipo_camion_requerido = 'carreta_granelera' WHERE tipo_camion_requerido = 'carreton';
  END IF;
END $$;

ALTER TABLE equipos ADD CONSTRAINT equipos_tipo_camion_check
  CHECK (tipo_camion IS NULL OR tipo_camion IN ('volcadora','carreta_granelera','plancha','grua','camioncito','camioneta','otro'));

COMMENT ON COLUMN equipos.tipo_camion IS
  'Logística: tipo de camión (solo es_logistica). NULL = sin clasificar. Se escribe solo con set_tipo_camion().';

-- 1.1 Guardia: la política RLS de equipos (autenticados_acceso_total) permite UPDATE a cualquier
--     usuario logueado. Sin tocar esa política, este trigger impide que la app cambie tipo_camion
--     por fuera de la RPC (mismo patrón que asignaciones.fecha_programada).
--     No aplica a service_role ni al SQL Editor (auth.role() distinto de 'authenticated').
CREATE OR REPLACE FUNCTION equipos_tipo_camion_guardia() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(auth.role(), '') = 'authenticated'
     AND coalesce(current_setting('app.set_tipo_camion', true), '') <> '1' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.tipo_camion := NULL;
    ELSE
      NEW.tipo_camion := OLD.tipo_camion;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_equipos_tipo_camion_guardia ON equipos;
CREATE TRIGGER trg_equipos_tipo_camion_guardia BEFORE INSERT OR UPDATE OF tipo_camion ON equipos
  FOR EACH ROW EXECUTE FUNCTION equipos_tipo_camion_guardia();

-- 1.2 RPC set_tipo_camion: único camino desde la app (solo rol admin)
CREATE OR REPLACE FUNCTION set_tipo_camion(p_equipo_id uuid, p_tipo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios
                 WHERE email = auth.email() AND activo = true AND rol = 'admin') THEN
    RAISE EXCEPTION 'Solo un administrador puede cambiar el tipo de camión';
  END IF;
  IF p_tipo IS NOT NULL AND p_tipo NOT IN ('volcadora','carreta_granelera','plancha','grua','camioncito','camioneta','otro') THEN
    RAISE EXCEPTION 'Tipo de camión no válido: %', p_tipo;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM equipos WHERE id = p_equipo_id AND es_logistica = true) THEN
    RAISE EXCEPTION 'El equipo no existe o no es un camión de logística';
  END IF;

  PERFORM set_config('app.set_tipo_camion', '1', true);
  UPDATE equipos SET tipo_camion = p_tipo WHERE id = p_equipo_id;
  PERFORM set_config('app.set_tipo_camion', '', true);
END $$;

REVOKE ALL ON FUNCTION set_tipo_camion(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_tipo_camion(uuid, text) TO authenticated;

-- Lectura: equipos tiene la política autenticados_acceso_total (SELECT incluido),
-- así que el rol logistica ya lee tipo_camion. No se toca.

-- ------------------------------------------------------------
-- 2. Categoría de material y camión requerido en encargos
-- ------------------------------------------------------------
ALTER TABLE encargos ADD COLUMN IF NOT EXISTS categoria text NOT NULL DEFAULT 'varios';
ALTER TABLE encargos DROP CONSTRAINT IF EXISTS encargos_categoria_check;
ALTER TABLE encargos ADD CONSTRAINT encargos_categoria_check
  CHECK (categoria IN ('aridos','prefabricados','maquinaria','varios'));

ALTER TABLE encargos ADD COLUMN IF NOT EXISTS tipo_camion_requerido text;
ALTER TABLE encargos DROP CONSTRAINT IF EXISTS encargos_tipo_camion_requerido_check;
ALTER TABLE encargos ADD CONSTRAINT encargos_tipo_camion_requerido_check
  CHECK (tipo_camion_requerido IS NULL
         OR tipo_camion_requerido IN ('volcadora','carreta_granelera','plancha','grua','camioncito','camioneta','otro'));

COMMENT ON COLUMN encargos.categoria IS 'Categoría de material: aridos | prefabricados | maquinaria | varios';
COMMENT ON COLUMN encargos.tipo_camion_requerido IS
  'Tipo de camión que pide el encargo. NULL = cualquiera. No bloquea la asignación: solo avisos y sugerencias.';

-- 2.1 Historial: los cambios de categoría y camión requerido quedan como 'editado'
CREATE OR REPLACE FUNCTION encargos_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cambios jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO logistica_eventos (encargo_id, tipo, detalle)
    VALUES (NEW.id, 'creado', jsonb_build_object('descripcion', NEW.descripcion,
            'cantidad', NEW.cantidad, 'unidad', NEW.unidad, 'fecha_requerida', NEW.fecha_requerida,
            'categoria', NEW.categoria, 'tipo_camion_requerido', NEW.tipo_camion_requerido));
    RETURN NEW;
  END IF;

  IF NEW.estado <> OLD.estado THEN
    INSERT INTO logistica_eventos (encargo_id, tipo, detalle)
    VALUES (NEW.id, NEW.estado, CASE WHEN NEW.estado = 'cancelado'
            THEN jsonb_build_object('motivo', NEW.motivo_cancelacion) END);
    RETURN NEW;
  END IF;

  IF NEW.descripcion IS DISTINCT FROM OLD.descripcion THEN v_cambios := v_cambios || jsonb_build_object('descripcion', NEW.descripcion); END IF;
  IF NEW.cantidad IS DISTINCT FROM OLD.cantidad OR NEW.unidad IS DISTINCT FROM OLD.unidad THEN
    v_cambios := v_cambios || jsonb_build_object('cantidad', NEW.cantidad, 'unidad', NEW.unidad); END IF;
  IF NEW.fecha_requerida IS DISTINCT FROM OLD.fecha_requerida THEN v_cambios := v_cambios || jsonb_build_object('fecha_requerida', NEW.fecha_requerida); END IF;
  IF (NEW.origen_lugar_id, NEW.origen_obra_id, NEW.destino_lugar_id, NEW.destino_obra_id)
     IS DISTINCT FROM (OLD.origen_lugar_id, OLD.origen_obra_id, OLD.destino_lugar_id, OLD.destino_obra_id) THEN
    v_cambios := v_cambios || jsonb_build_object('ruta', true); END IF;
  IF NEW.notas IS DISTINCT FROM OLD.notas THEN v_cambios := v_cambios || jsonb_build_object('notas', true); END IF;
  IF NEW.categoria IS DISTINCT FROM OLD.categoria THEN v_cambios := v_cambios || jsonb_build_object('categoria', NEW.categoria); END IF;
  IF NEW.tipo_camion_requerido IS DISTINCT FROM OLD.tipo_camion_requerido THEN
    v_cambios := v_cambios || jsonb_build_object('tipo_camion_requerido', NEW.tipo_camion_requerido); END IF;

  IF v_cambios <> '{}'::jsonb THEN
    INSERT INTO logistica_eventos (encargo_id, tipo, detalle) VALUES (NEW.id, 'editado', v_cambios);
  END IF;
  RETURN NEW;
END $$;

-- ------------------------------------------------------------
-- 3. Vista v_encargos: columnas nuevas al final (CREATE OR REPLACE no permite reordenar)
--    Misma lógica que v2; se agregan categoria, tipo_camion_requerido y destino_key.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_encargos WITH (security_invoker = true) AS
SELECT
  e.id, e.descripcion, e.cantidad, e.unidad, e.fecha_requerida, e.notas,
  e.estado, e.motivo_cancelacion, e.created_at, e.updated_at, e.cerrado_at,
  e.origen_lugar_id, e.origen_obra_id, e.destino_lugar_id, e.destino_obra_id,
  coalesce(lo.nombre, oo.nombre_obra) AS origen_nombre,
  CASE WHEN e.origen_obra_id IS NOT NULL THEN 'obra' ELSE lo.tipo END AS origen_tipo,
  coalesce(ld.nombre, od.nombre_obra) AS destino_nombre,
  CASE WHEN e.destino_obra_id IS NOT NULL THEN 'obra' ELSE ld.tipo END AS destino_tipo,
  uc.nombre_completo AS creado_por_nombre,
  ucc.nombre_completo AS cerrado_por_nombre,
  coalesce(a.n_total, 0)        AS n_asignaciones,
  coalesce(a.n_planificadas, 0) AS n_planificadas,
  coalesce(a.n_entregadas, 0)   AS n_entregadas,
  coalesce(a.n_confirmadas, 0)  AS n_confirmadas,
  coalesce(a.n_atrasadas, 0)    AS n_atrasadas,
  coalesce(a.cant_confirmada, 0)   AS cantidad_confirmada,
  coalesce(a.cant_sin_confirmar, 0) AS cantidad_sin_confirmar,
  a.proxima_fecha,
  CASE
    WHEN e.estado <> 'abierto' THEN NULL
    WHEN coalesce(a.n_planificadas,0) = 0 AND coalesce(a.n_entregadas,0) = 0
         AND coalesce(a.n_confirmadas,0) > 0
         AND (e.cantidad IS NULL OR a.cant_confirmada >= e.cantidad) THEN 'listo_para_cerrar'
    WHEN coalesce(a.n_atrasadas,0) > 0
         OR (e.fecha_requerida IS NOT NULL AND e.fecha_requerida < hoy_py()) THEN 'atrasado'
    WHEN coalesce(a.n_total,0) = 0 THEN 'sin_asignar'
    ELSE 'en_curso'
  END AS subestado,
  -- Despacho v1
  e.categoria,
  e.tipo_camion_requerido,
  CASE WHEN e.destino_obra_id IS NOT NULL THEN 'obra:' || e.destino_obra_id::text
       ELSE 'lugar:' || e.destino_lugar_id::text END AS destino_key
FROM encargos e
LEFT JOIN lugares lo ON lo.id = e.origen_lugar_id
LEFT JOIN obras   oo ON oo.id = e.origen_obra_id
LEFT JOIN lugares ld ON ld.id = e.destino_lugar_id
LEFT JOIN obras   od ON od.id = e.destino_obra_id
LEFT JOIN usuarios uc  ON uc.id  = e.creado_por
LEFT JOIN usuarios ucc ON ucc.id = e.cerrado_por
LEFT JOIN LATERAL (
  SELECT
    count(*)                                              AS n_total,
    count(*) FILTER (WHERE s.estado = 'planificada')      AS n_planificadas,
    count(*) FILTER (WHERE s.estado = 'entregada')        AS n_entregadas,
    count(*) FILTER (WHERE s.estado = 'confirmada')       AS n_confirmadas,
    count(*) FILTER (WHERE s.estado = 'planificada' AND s.fecha < hoy_py()) AS n_atrasadas,
    sum(s.cantidad_real) FILTER (WHERE s.estado = 'confirmada') AS cant_confirmada,
    sum(s.cantidad_real) FILTER (WHERE s.estado = 'entregada')  AS cant_sin_confirmar,
    min(s.fecha) FILTER (WHERE s.estado = 'planificada')  AS proxima_fecha
  FROM asignaciones s WHERE s.encargo_id = e.id
) a ON true;

REVOKE ALL ON v_encargos FROM anon;

-- ------------------------------------------------------------
-- 4. Verificación rápida (correr a mano)
-- ------------------------------------------------------------
-- select numero_identificacion, tipo_camion from equipos where es_logistica and activo order by 1;
-- select categoria, tipo_camion_requerido, destino_key from v_encargos limit 5;
-- Como usuario logistica: select set_tipo_camion('<uuid>', 'carreta_granelera');  → error "Solo un administrador…"
-- Cargar tipos a mano (SQL Editor, alternativa a la pantalla Camiones):
--   update equipos set tipo_camion = 'carreta_granelera' where numero_identificacion = 'VP-CT026';
