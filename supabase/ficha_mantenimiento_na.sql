-- =====================================================================
-- Ficha de mantenimiento: opción N/A (no aplica)
-- ---------------------------------------------------------------------
-- La ficha de mantenimiento es un ítem del checklist
-- ("Ficha de mantenimiento - Presente y actualizada") en checklist_items.
-- Se agrega el estado 'na' = el equipo no lleva mantenimiento preventivo.
--  * El semáforo (actualizar_semaforo_equipo) solo cuenta 'fail' y
--    'warning' críticos, así que 'na' no lo afecta.
--  * trg_inspeccion_service no cambia: con N/A el frontend no envía
--    contador ni fecha.
--  * Las inspecciones anteriores no se modifican.
-- Idempotente.
-- =====================================================================

ALTER TABLE checklist_items DROP CONSTRAINT IF EXISTS checklist_items_estado_check;
ALTER TABLE checklist_items ADD CONSTRAINT checklist_items_estado_check
  CHECK (estado = ANY (ARRAY['ok'::text, 'warning'::text, 'fail'::text, 'na'::text]));

COMMENT ON CONSTRAINT checklist_items_estado_check ON checklist_items IS
  'ok | warning | fail | na. ''na'' (no aplica) se usa solo en el ítem Ficha de mantenimiento, para equipos sin mantenimiento preventivo.';
