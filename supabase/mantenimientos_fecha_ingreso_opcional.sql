-- ============================================================
-- MANTENIMIENTOS — fecha de ingreso al taller opcional (27/10/2026)
-- Al registrar la avería no se sabe cuándo entra al taller.
-- Consumidores revisados: corr.app, corr.cierres_90, bot_log_taller, uso_refrescar y
-- pdsap_eval ya usan coalesce(fecha_ingreso_taller, fecha_inicio_averia);
-- am_equipos / am_mantenimientos dan dias_en_taller null si falta.
-- Front: NuevoMantenimiento (campo opcional, vacío por defecto) y
-- DashboardMantenimientos (días en taller desde el inicio de la avería si falta).
-- ============================================================
alter table public.mantenimientos alter column fecha_ingreso_taller drop not null;
