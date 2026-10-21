-- ════════════════════════════════════════════════════════════════════════
-- USO DE EQUIPOS — PARCHE PROVISORIO "parte sin SAP" (21/10/2026)
-- ════════════════════════════════════════════════════════════════════════
-- Problema: el export diario costo_equipo (lo arma TI) filtra por fecha contable de los
-- últimos ~10 días. Las imputaciones que la obra carga en SAP más de 10 días después de la
-- fecha del parte nunca llegan a sap_imputaciones → falsos "parte_sin_sap" (2.114 de 2.617
-- al 21/10/2026). También falta completo el 01–10/09/2026.
-- TI está trabajando en la solución (pedido: filtrar por fecha de entrada CPUDT + carga
-- completa del año).
--
-- Parche: tabla aparte con equipo + día imputado según la facturación de equipos (KSB1)
-- que exporta Andrés. uso_refrescar() la suma SOLO para decidir "tiene_sap"; no aporta
-- cantidades, obra ni costo (así no se duplica nada cuando llegue la carga de TI).
-- Va aparte de sap_imputaciones porque el archivo no trae secuencia.
--
-- Criterio de carga: clases FACT. INT. EQUIPOS y FLETES T&C PARA OBRA; equipo = Centro de
-- coste; fecha = Fe.contabilización; se excluyen equipo+día+unidad con suma neta 0
-- (imputación anulada por SAP_ADDON).
-- Carga 21/10/2026: facturacionEquipos.XLSX, 01/01–19/10/2026, 40.349 equipo-día, 385 equipos.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.sap_imputaciones_provisorias (
  equipo     text not null,
  fecha      date not null,
  archivo    text,
  cargado_en timestamptz not null default now(),
  primary key (equipo, fecha)
);
alter table public.sap_imputaciones_provisorias enable row level security;
revoke all on public.sap_imputaciones_provisorias from anon, authenticated;

-- uso_refrescar(), sección 5.3, CTE "s" (aplicado en la base el 21/10/2026):
--
--   ), s as (
--     select equipo, fecha,
--            sum(qh) qh, sum(qkm) qkm,
--            mode() within group (order by obra) obra
--     from (
--       select equipo, fecha,
--              case when umedida = 'HRA' then cantidad end qh,
--              case when umedida = 'KM'  then cantidad end qkm,
--              nullif(trim(obra_codigo), '') obra
--       from sap_imputaciones
--       where clase_coste in (7100000001, 7100000002) and fecha between v_ini and v_hoy
--       union all
--       select equipo, fecha, null, null, null
--       from sap_imputaciones_provisorias
--       where fecha between v_ini and v_hoy
--     ) x
--     group by 1, 2
--   ), c as (
--
-- ── Actualizar con una facturación nueva ─────────────────────────────────
-- Pasarle el Excel a Claude (export de facturación de equipos, mismas columnas). Se insertan
-- los equipo+día nuevos (on conflict do nothing) y se corre select uso_refrescar();
--
-- ── Dar de baja (cuando TI corrija el export y llegue la carga completa) ─────
-- 1) Volver el CTE "s" de uso_refrescar() al original (supabase/uso_equipos_setup.sql):
--      ), s as (
--        select equipo, fecha,
--               sum(cantidad) filter (where umedida = 'HRA') qh,
--               sum(cantidad) filter (where umedida = 'KM')  qkm,
--               mode() within group (order by nullif(trim(obra_codigo), '')) obra
--        from sap_imputaciones
--        where clase_coste in (7100000001, 7100000002) and fecha between v_ini and v_hoy group by 1, 2
--      ), c as (
-- 2) drop table public.sap_imputaciones_provisorias;
-- 3) select uso_refrescar();  → si reaparecen "parte_sin_sap" que la provisoria tapaba,
--    la carga de TI todavía está incompleta.
