-- ============================================================
-- Logística v2 · Addendum: asignaciones pendientes arrastradas
-- - Columna asignaciones.fecha_programada (fecha original de un viaje atrasado)
-- - RPC entregar_asignacion: único camino para marcar "Entregado"
-- Idempotente. Ver prompt-cowork-logistica-v2-pendientes.md
-- ============================================================

-- 1. Columna nueva
ALTER TABLE asignaciones ADD COLUMN IF NOT EXISTS fecha_programada date;

ALTER TABLE asignaciones DROP CONSTRAINT IF EXISTS asignaciones_fecha_programada_check;
ALTER TABLE asignaciones ADD CONSTRAINT asignaciones_fecha_programada_check
  CHECK (fecha_programada IS NULL OR fecha_programada < fecha);

-- 2. Guardia: fecha_programada solo la escribe entregar_asignacion.
--    Cualquier otro INSERT/UPDATE (frontend, SQL suelto) no la puede tocar.
--    Si una reprogramación posterior (p. ej. tras "Deshacer entrega") deja la fecha
--    en el día programado o antes, deja de ser un atraso y se limpia.
CREATE OR REPLACE FUNCTION asignaciones_fecha_programada() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('app.entregar_asignacion', true), '') <> '1' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.fecha_programada := NULL;
    ELSE
      NEW.fecha_programada := OLD.fecha_programada;
    END IF;
  END IF;
  IF NEW.fecha_programada IS NOT NULL AND NEW.fecha_programada >= NEW.fecha THEN
    NEW.fecha_programada := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_asignaciones_fecha_programada ON asignaciones;
CREATE TRIGGER trg_asignaciones_fecha_programada BEFORE INSERT OR UPDATE ON asignaciones
  FOR EACH ROW EXECUTE FUNCTION asignaciones_fecha_programada();

-- 3. RPC entregar_asignacion
CREATE OR REPLACE FUNCTION entregar_asignacion(
  p_id uuid, p_fecha_real date, p_cantidad_real numeric DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_a   asignaciones%ROWTYPE;
  v_enc encargos%ROWTYPE;
  v_hoy date := (now() AT TIME ZONE 'America/Asuncion')::date;
BEGIN
  IF NOT puede_logistica() THEN
    RAISE EXCEPTION 'No tenés permiso para registrar entregas';
  END IF;
  IF p_fecha_real IS NULL THEN
    RAISE EXCEPTION 'Indicá qué día se hizo el viaje';
  END IF;

  SELECT * INTO v_a FROM asignaciones WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La asignación no existe';
  END IF;
  IF v_a.estado <> 'planificada' THEN
    RAISE EXCEPTION 'La asignación ya está % — no se puede registrar la entrega otra vez', v_a.estado;
  END IF;

  SELECT * INTO v_enc FROM encargos WHERE id = v_a.encargo_id;
  IF v_enc.estado <> 'abierto' THEN
    RAISE EXCEPTION 'El encargo está % — no admite entregas', v_enc.estado;
  END IF;

  IF p_fecha_real < v_a.fecha OR p_fecha_real > v_hoy THEN
    RAISE EXCEPTION 'El día del viaje tiene que estar entre el % (programado) y hoy (%)',
      to_char(v_a.fecha, 'DD/MM'), to_char(v_hoy, 'DD/MM');
  END IF;

  IF v_enc.cantidad IS NULL AND p_cantidad_real IS NOT NULL THEN
    RAISE EXCEPTION 'Este encargo no lleva cantidad: no se puede cargar una cantidad real';
  END IF;
  IF p_cantidad_real IS NOT NULL AND p_cantidad_real <= 0 THEN
    RAISE EXCEPTION 'La cantidad real tiene que ser mayor que cero';
  END IF;

  -- Viaje hecho otro día: mover fecha y guardar la programada (un solo UPDATE, todavía planificada)
  IF p_fecha_real <> v_a.fecha THEN
    IF EXISTS (SELECT 1 FROM asignaciones
               WHERE encargo_id = v_a.encargo_id AND fecha = p_fecha_real
                 AND equipo_id = v_a.equipo_id AND id <> v_a.id) THEN
      RAISE EXCEPTION 'Ya hay una asignación de este encargo para este camión el %. Si es el mismo viaje, quitá la pendiente y marcá esa.',
        to_char(p_fecha_real, 'DD/MM')
        USING HINT = 'asignacion_duplicada';
    END IF;

    PERFORM set_config('app.entregar_asignacion', '1', true);
    UPDATE asignaciones
       SET fecha_programada = coalesce(fecha_programada, fecha),
           fecha = p_fecha_real
     WHERE id = v_a.id;
    PERFORM set_config('app.entregar_asignacion', '', true);
  END IF;

  -- Estado según reglas v2 (sellos y eventos los ponen los triggers existentes)
  UPDATE asignaciones
     SET estado = CASE
                    WHEN v_enc.cantidad IS NULL OR p_cantidad_real IS NOT NULL THEN 'confirmada'
                    ELSE 'entregada'
                  END,
         cantidad_real = p_cantidad_real
   WHERE id = v_a.id;
END $$;

REVOKE ALL ON FUNCTION entregar_asignacion(uuid, date, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION entregar_asignacion(uuid, date, numeric) TO authenticated;
