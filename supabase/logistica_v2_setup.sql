-- ============================================================
-- SETUP: Módulo Logística v2 — Encargos + Asignaciones
-- Reemplaza pedidos_logistica / fletes / fletes_auditoria
-- Ejecutado vía migración el 2026-10-07
-- ============================================================

-- 0. Limpieza del modelo anterior (solo tenía datos de prueba)
DROP TABLE IF EXISTS fletes_auditoria CASCADE;
DROP TABLE IF EXISTS fletes CASCADE;
DROP TABLE IF EXISTS pedidos_logistica CASCADE;

-- 1. Rol 'logistica'
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol = ANY (ARRAY['inspector','supervisor','admin','logistica']));

-- 2. Helpers
CREATE OR REPLACE FUNCTION usuario_actual_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM usuarios WHERE email = auth.email() AND activo = true LIMIT 1
$$;

CREATE OR REPLACE FUNCTION puede_logistica() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios
    WHERE email = auth.email() AND activo = true AND rol IN ('admin','logistica')
  )
$$;

CREATE OR REPLACE FUNCTION hoy_py() RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'America/Asuncion')::date
$$;

-- 3. Lugares (bases, proveedores, otros). Las obras salen de la tabla obras.
CREATE TABLE IF NOT EXISTS lugares (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      text NOT NULL CHECK (length(trim(nombre)) > 0),
  tipo        text NOT NULL CHECK (tipo IN ('base','proveedor','otro')),
  activo      boolean NOT NULL DEFAULT true,
  creado_por  uuid REFERENCES usuarios(id) DEFAULT usuario_actual_id(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_lugares_nombre ON lugares (lower(trim(nombre)));

INSERT INTO lugares (nombre, tipo)
SELECT v.nombre, v.tipo FROM (VALUES
  ('Complejo Ypané','base'),
  ('Depósito Central','base'),
  ('Costanera','otro')
) AS v(nombre, tipo)
WHERE NOT EXISTS (SELECT 1 FROM lugares l WHERE lower(l.nombre) = lower(v.nombre));

-- 4. Encargos
CREATE TABLE IF NOT EXISTS encargos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  descripcion        text NOT NULL CHECK (length(trim(descripcion)) > 0),
  origen_lugar_id    uuid REFERENCES lugares(id),
  origen_obra_id     uuid REFERENCES obras(id),
  destino_lugar_id   uuid REFERENCES lugares(id),
  destino_obra_id    uuid REFERENCES obras(id),
  cantidad           numeric(12,3) CHECK (cantidad > 0),
  unidad             text CHECK (unidad IN ('un','tn','m3','viajes')),
  fecha_requerida    date,
  notas              text,
  estado             text NOT NULL DEFAULT 'abierto'
                       CHECK (estado IN ('abierto','cerrado','cancelado')),
  motivo_cancelacion text,
  creado_por         uuid REFERENCES usuarios(id) DEFAULT usuario_actual_id(),
  cerrado_por        uuid REFERENCES usuarios(id),
  cerrado_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT encargos_origen_unico  CHECK ((origen_lugar_id IS NULL) <> (origen_obra_id IS NULL)),
  CONSTRAINT encargos_destino_unico CHECK ((destino_lugar_id IS NULL) <> (destino_obra_id IS NULL)),
  CONSTRAINT encargos_cantidad_unidad CHECK ((cantidad IS NULL) = (unidad IS NULL)),
  CONSTRAINT encargos_origen_distinto_destino CHECK (
    origen_lugar_id IS DISTINCT FROM destino_lugar_id OR origen_lugar_id IS NULL),
  CONSTRAINT encargos_obra_distinta CHECK (
    origen_obra_id IS DISTINCT FROM destino_obra_id OR origen_obra_id IS NULL),
  CONSTRAINT encargos_motivo_cancelacion CHECK (
    estado <> 'cancelado' OR length(trim(coalesce(motivo_cancelacion,''))) > 0)
);

-- 5. Asignaciones (camión + día + encargo)
CREATE TABLE IF NOT EXISTS asignaciones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encargo_id      uuid NOT NULL REFERENCES encargos(id) ON DELETE RESTRICT,
  fecha           date NOT NULL,
  equipo_id       uuid NOT NULL REFERENCES equipos(id),
  operador_id     uuid REFERENCES operadores(id),
  estado          text NOT NULL DEFAULT 'planificada'
                    CHECK (estado IN ('planificada','entregada','confirmada')),
  cantidad_real   numeric(12,3) CHECK (cantidad_real > 0),
  notas           text,
  creado_por      uuid REFERENCES usuarios(id) DEFAULT usuario_actual_id(),
  entregada_at    timestamptz,
  confirmada_por  uuid REFERENCES usuarios(id),
  confirmada_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asignaciones_unica UNIQUE (encargo_id, fecha, equipo_id)
);

-- 6. Historial
CREATE TABLE IF NOT EXISTS logistica_eventos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encargo_id     uuid NOT NULL REFERENCES encargos(id) ON DELETE CASCADE,
  asignacion_id  uuid,
  tipo           text NOT NULL,
  detalle        jsonb,
  usuario_id     uuid REFERENCES usuarios(id) DEFAULT usuario_actual_id(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 7. Índices
CREATE INDEX IF NOT EXISTS idx_encargos_estado_fecha   ON encargos(estado, fecha_requerida);
CREATE INDEX IF NOT EXISTS idx_asignaciones_fecha_eq   ON asignaciones(fecha, equipo_id);
CREATE INDEX IF NOT EXISTS idx_asignaciones_encargo    ON asignaciones(encargo_id);
CREATE INDEX IF NOT EXISTS idx_asignaciones_estado     ON asignaciones(estado);
CREATE INDEX IF NOT EXISTS idx_log_eventos_encargo     ON logistica_eventos(encargo_id, created_at);

-- ============================================================
-- 8. Reglas de negocio (triggers)
-- ============================================================

-- 8.1 Encargos: cierre, cancelación, ediciones
CREATE OR REPLACE FUNCTION encargos_validar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pend int; v_hechas int; v_total int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.estado := 'abierto';
    NEW.cerrado_por := NULL; NEW.cerrado_at := NULL; NEW.motivo_cancelacion := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.estado <> 'abierto' THEN
    RAISE EXCEPTION 'El encargo ya está % y no se puede modificar', OLD.estado;
  END IF;

  SELECT count(*) FILTER (WHERE estado IN ('planificada','entregada')),
         count(*) FILTER (WHERE estado IN ('entregada','confirmada')),
         count(*)
    INTO v_pend, v_hechas, v_total
    FROM asignaciones WHERE encargo_id = NEW.id;

  IF NEW.estado = 'cerrado' THEN
    IF v_pend > 0 THEN
      RAISE EXCEPTION 'No se puede cerrar: hay % asignación(es) sin confirmar o sin entregar', v_pend;
    END IF;
    NEW.cerrado_por := usuario_actual_id();
    NEW.cerrado_at  := now();
  ELSIF NEW.estado = 'cancelado' THEN
    IF v_hechas > 0 THEN
      RAISE EXCEPTION 'No se puede cancelar: el encargo ya tiene entregas registradas';
    END IF;
    DELETE FROM asignaciones WHERE encargo_id = NEW.id AND estado = 'planificada';
    NEW.cerrado_por := usuario_actual_id();
    NEW.cerrado_at  := now();
  END IF;

  IF (OLD.cantidad IS NULL) <> (NEW.cantidad IS NULL) AND v_total > 0 THEN
    RAISE EXCEPTION 'No se puede agregar o quitar la cantidad de un encargo que ya tiene asignaciones';
  END IF;

  NEW.created_at := OLD.created_at;
  NEW.creado_por := OLD.creado_por;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_encargos_validar ON encargos;
CREATE TRIGGER trg_encargos_validar BEFORE INSERT OR UPDATE ON encargos
  FOR EACH ROW EXECUTE FUNCTION encargos_validar();

-- 8.2 Asignaciones: estados, reprogramación, cantidades
CREATE OR REPLACE FUNCTION asignaciones_validar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_enc encargos%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.estado <> 'planificada' THEN
      RAISE EXCEPTION 'Solo se pueden quitar asignaciones planificadas (esta está %)', OLD.estado;
    END IF;
    RETURN OLD;
  END IF;

  SELECT * INTO v_enc FROM encargos WHERE id = NEW.encargo_id;
  IF v_enc.estado <> 'abierto' THEN
    RAISE EXCEPTION 'El encargo está % — no admite cambios en sus asignaciones', v_enc.estado;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.encargo_id <> OLD.encargo_id THEN
      RAISE EXCEPTION 'No se puede mover una asignación a otro encargo';
    END IF;
    IF OLD.estado <> 'planificada'
       AND (NEW.fecha, NEW.equipo_id, NEW.operador_id) IS DISTINCT FROM (OLD.fecha, OLD.equipo_id, OLD.operador_id) THEN
      RAISE EXCEPTION 'Solo se pueden reprogramar asignaciones planificadas';
    END IF;
    IF OLD.estado = 'confirmada' AND NEW.estado <> 'confirmada' THEN
      RAISE EXCEPTION 'Una asignación confirmada no puede volver atrás';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.creado_por := OLD.creado_por;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.equipo_id IS DISTINCT FROM OLD.equipo_id THEN
    IF NOT EXISTS (SELECT 1 FROM equipos WHERE id = NEW.equipo_id AND es_logistica AND activo) THEN
      RAISE EXCEPTION 'El equipo seleccionado no es un camión de logística activo';
    END IF;
  END IF;

  -- Cantidades
  IF v_enc.cantidad IS NULL THEN
    NEW.cantidad_real := NULL;
  ELSIF NEW.estado = 'planificada' THEN
    NEW.cantidad_real := NULL;
  ELSIF NEW.estado = 'confirmada' AND NEW.cantidad_real IS NULL THEN
    RAISE EXCEPTION 'Para confirmar hay que cargar la cantidad real entregada';
  END IF;

  -- Sellos de tiempo
  IF NEW.estado = 'planificada' THEN
    NEW.entregada_at := NULL; NEW.confirmada_at := NULL; NEW.confirmada_por := NULL;
  ELSE
    IF NEW.entregada_at IS NULL THEN NEW.entregada_at := now(); END IF;
    IF NEW.estado = 'confirmada' THEN
      IF TG_OP = 'INSERT' OR OLD.estado <> 'confirmada' THEN
        NEW.confirmada_at := now();
        NEW.confirmada_por := usuario_actual_id();
      END IF;
    ELSE
      NEW.confirmada_at := NULL; NEW.confirmada_por := NULL;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_asignaciones_validar ON asignaciones;
CREATE TRIGGER trg_asignaciones_validar BEFORE INSERT OR UPDATE OR DELETE ON asignaciones
  FOR EACH ROW EXECUTE FUNCTION asignaciones_validar();

-- 8.3 Historial automático
CREATE OR REPLACE FUNCTION encargos_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cambios jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO logistica_eventos (encargo_id, tipo, detalle)
    VALUES (NEW.id, 'creado', jsonb_build_object('descripcion', NEW.descripcion,
            'cantidad', NEW.cantidad, 'unidad', NEW.unidad, 'fecha_requerida', NEW.fecha_requerida));
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

  IF v_cambios <> '{}'::jsonb THEN
    INSERT INTO logistica_eventos (encargo_id, tipo, detalle) VALUES (NEW.id, 'editado', v_cambios);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_encargos_log ON encargos;
CREATE TRIGGER trg_encargos_log AFTER INSERT OR UPDATE ON encargos
  FOR EACH ROW EXECUTE FUNCTION encargos_log();

CREATE OR REPLACE FUNCTION asignaciones_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_eq text; v_eq_old text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT numero_identificacion INTO v_eq FROM equipos WHERE id = OLD.equipo_id;
    INSERT INTO logistica_eventos (encargo_id, asignacion_id, tipo, detalle)
    VALUES (OLD.encargo_id, OLD.id, 'desasignado', jsonb_build_object('fecha', OLD.fecha, 'equipo', v_eq));
    RETURN OLD;
  END IF;

  SELECT numero_identificacion INTO v_eq FROM equipos WHERE id = NEW.equipo_id;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO logistica_eventos (encargo_id, asignacion_id, tipo, detalle)
    VALUES (NEW.encargo_id, NEW.id, 'asignado', jsonb_build_object('fecha', NEW.fecha, 'equipo', v_eq));
    IF NEW.estado <> 'planificada' THEN
      INSERT INTO logistica_eventos (encargo_id, asignacion_id, tipo, detalle)
      VALUES (NEW.encargo_id, NEW.id, NEW.estado, jsonb_build_object('equipo', v_eq, 'cantidad', NEW.cantidad_real));
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.fecha, NEW.equipo_id) IS DISTINCT FROM (OLD.fecha, OLD.equipo_id) THEN
    SELECT numero_identificacion INTO v_eq_old FROM equipos WHERE id = OLD.equipo_id;
    INSERT INTO logistica_eventos (encargo_id, asignacion_id, tipo, detalle)
    VALUES (NEW.encargo_id, NEW.id, 'reprogramado', jsonb_build_object(
      'de_fecha', OLD.fecha, 'de_equipo', v_eq_old, 'a_fecha', NEW.fecha, 'a_equipo', v_eq));
  END IF;

  IF NEW.estado <> OLD.estado THEN
    INSERT INTO logistica_eventos (encargo_id, asignacion_id, tipo, detalle)
    VALUES (NEW.encargo_id, NEW.id,
            CASE WHEN NEW.estado = 'planificada' THEN 'entrega_deshecha' ELSE NEW.estado END,
            jsonb_build_object('equipo', v_eq, 'fecha', NEW.fecha, 'cantidad', NEW.cantidad_real));
  ELSIF NEW.estado = 'confirmada' AND NEW.cantidad_real IS DISTINCT FROM OLD.cantidad_real THEN
    INSERT INTO logistica_eventos (encargo_id, asignacion_id, tipo, detalle)
    VALUES (NEW.encargo_id, NEW.id, 'cantidad_corregida', jsonb_build_object(
      'equipo', v_eq, 'fecha', NEW.fecha, 'de', OLD.cantidad_real, 'a', NEW.cantidad_real));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_asignaciones_log ON asignaciones;
CREATE TRIGGER trg_asignaciones_log AFTER INSERT OR UPDATE OR DELETE ON asignaciones
  FOR EACH ROW EXECUTE FUNCTION asignaciones_log();

-- ============================================================
-- 9. Vista para la bandeja
-- ============================================================
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
  END AS subestado
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

-- ============================================================
-- 10. RLS
-- ============================================================
ALTER TABLE lugares           ENABLE ROW LEVEL SECURITY;
ALTER TABLE encargos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE asignaciones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE logistica_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lugares_sel ON lugares;
DROP POLICY IF EXISTS lugares_ins ON lugares;
DROP POLICY IF EXISTS lugares_upd ON lugares;
CREATE POLICY lugares_sel ON lugares FOR SELECT TO authenticated USING (puede_logistica());
CREATE POLICY lugares_ins ON lugares FOR INSERT TO authenticated WITH CHECK (puede_logistica());
CREATE POLICY lugares_upd ON lugares FOR UPDATE TO authenticated USING (puede_logistica()) WITH CHECK (puede_logistica());

DROP POLICY IF EXISTS encargos_sel ON encargos;
DROP POLICY IF EXISTS encargos_ins ON encargos;
DROP POLICY IF EXISTS encargos_upd ON encargos;
CREATE POLICY encargos_sel ON encargos FOR SELECT TO authenticated USING (puede_logistica());
CREATE POLICY encargos_ins ON encargos FOR INSERT TO authenticated WITH CHECK (puede_logistica());
CREATE POLICY encargos_upd ON encargos FOR UPDATE TO authenticated USING (puede_logistica()) WITH CHECK (puede_logistica());

DROP POLICY IF EXISTS asignaciones_sel ON asignaciones;
DROP POLICY IF EXISTS asignaciones_ins ON asignaciones;
DROP POLICY IF EXISTS asignaciones_upd ON asignaciones;
DROP POLICY IF EXISTS asignaciones_del ON asignaciones;
CREATE POLICY asignaciones_sel ON asignaciones FOR SELECT TO authenticated USING (puede_logistica());
CREATE POLICY asignaciones_ins ON asignaciones FOR INSERT TO authenticated WITH CHECK (puede_logistica());
CREATE POLICY asignaciones_upd ON asignaciones FOR UPDATE TO authenticated USING (puede_logistica()) WITH CHECK (puede_logistica());
CREATE POLICY asignaciones_del ON asignaciones FOR DELETE TO authenticated USING (puede_logistica());

DROP POLICY IF EXISTS log_eventos_sel ON logistica_eventos;
CREATE POLICY log_eventos_sel ON logistica_eventos FOR SELECT TO authenticated USING (puede_logistica());

REVOKE ALL ON lugares, encargos, asignaciones, logistica_eventos, v_encargos FROM anon;
