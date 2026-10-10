-- Operaciones de órdenes SAP para el Historial de equipos (10/10/2026) — PENDIENTE DE APLICAR en el SQL Editor.
-- Después de aplicar: Table Editor → sap_ordenes_operaciones → Import data from CSV → "Claude outputs/operaciones_import.csv".
create table if not exists public.sap_ordenes_operaciones (
  orden bigint not null,
  operacion int not null,
  texto text,
  puesto_trabajo text,
  trabajo_real numeric,           -- "Trabajo real" de la notificación (unidad según SAP, normalmente H)
  fecha_inicio_real date,
  fecha_fin_real date,
  actualizado_en timestamptz not null default now(),
  primary key (orden, operacion)
);
alter table public.sap_ordenes_operaciones enable row level security;
-- Igual que las demás tablas sap_*: lectura directa solo para el agente; la app lee vía RPC.
create policy agente_lectura on public.sap_ordenes_operaciones for select to agente_lector using (true);
grant select on public.sap_ordenes_operaciones to agente_lector;

create or replace function public.historial_orden_operaciones(p_orden bigint)
returns table (operacion int, texto text, puesto_trabajo text, trabajo_real numeric,
               fecha_inicio_real date, fecha_fin_real date)
language sql stable security definer set search_path = public as $$
  select op.operacion, op.texto, op.puesto_trabajo, op.trabajo_real, op.fecha_inicio_real, op.fecha_fin_real
  from sap_ordenes_operaciones op
  where puede_ver_historial() and op.orden = p_orden
  order by op.operacion
$$;
revoke all on function public.historial_orden_operaciones(bigint) from public, anon;
grant execute on function public.historial_orden_operaciones(bigint) to authenticated;
