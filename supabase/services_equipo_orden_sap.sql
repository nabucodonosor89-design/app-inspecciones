-- ============================================================
-- MANTENIMIENTOS DESDE ÓRDENES SAP + ajustes de "Desde el último mantenimiento"
-- Parte de la Bandeja de preventivos (ver bandeja_preventivos.sql). Idempotente.
--
-- 1. services_equipo acepta mantenimientos sin contador:
--    · contador nullable; contador_estado = confirmado | estimado | pendiente
--    · origen 'orden_sap' (lo crea ip30_sync_cierres o la Bandeja al confirmar Concluido)
--    · orden bigint (única cuando no es null): la orden TCPV que cerró ese mantenimiento
-- 2. mantenimiento_seguimiento(): misma firma; el que carga se muestra "(orden SAP)".
-- 3. mantenimiento_seguimiento_v3(): v2 + estado del contador y orden del último mantenimiento.
--    Además es más rápida que v2 (el último parte se busca por índice, no agregando todos los partes).
-- 4. services_de_equipo_v2(): agrega orden y contador_estado (para la ventana 🔧 Mantenimiento).
-- 5. anular_service(): también anula los de origen orden_sap.
-- ============================================================

-- ------------------------------------------------------------
-- 1. services_equipo
-- ------------------------------------------------------------
alter table public.services_equipo alter column contador drop not null;
alter table public.services_equipo
  add column if not exists orden bigint,
  add column if not exists contador_estado text not null default 'confirmado';

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'services_equipo_origen_check'
             and pg_get_constraintdef(oid) not like '%orden_sap%') then
    alter table public.services_equipo drop constraint services_equipo_origen_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'services_equipo_origen_check') then
    alter table public.services_equipo add constraint services_equipo_origen_check
      check (origen in ('inspeccion', 'manual', 'orden_sap'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'services_equipo_contador_estado_check') then
    alter table public.services_equipo add constraint services_equipo_contador_estado_check
      check (contador_estado in ('confirmado', 'estimado', 'pendiente')
             and (contador is not null or contador_estado = 'pendiente'));
  end if;
end $$;
-- (el check contador >= 0 sigue igual: un null lo pasa)

create unique index if not exists services_equipo_orden_uk on public.services_equipo (orden) where orden is not null;
comment on column public.services_equipo.orden is 'Orden TCPV vinculada a este mantenimiento (bandeja de preventivos)';
comment on column public.services_equipo.contador_estado is 'confirmado (cargado por una persona) | estimado (parte diario del día del cierre) | pendiente (sin contador todavía)';

-- ------------------------------------------------------------
-- 2. mantenimiento_seguimiento(): solo cambia la etiqueta de quién cargó
-- ------------------------------------------------------------
create or replace function public.mantenimiento_seguimiento()
returns table (
  equipo text, denominacion text, ubicacion text, periodo numeric, periodo_unidad text,
  service_fecha date, service_contador numeric, service_inspeccion_fecha timestamptz, service_inspector text,
  carga_lectura numeric, carga_fecha date, por_contador numeric,
  tiene_rastreo boolean, rastreo_desde date, rastreo_completo boolean,
  rastreo_horas numeric, rastreo_ralenti numeric, rastreo_km numeric, rastreo_ultimo_dia date
)
language sql stable security definer
set search_path = public
as $$
  with eq as (
    select distinct on (upper(trim(e.equipo)))
           upper(trim(e.equipo)) as equipo, e.denominacion, nullif(trim(e.ubicacion), '') as ubicacion
    from sap_equipos e
    where coalesce(trim(e.equipo), '') <> ''
    order by upper(trim(e.equipo)), (nullif(trim(e.ubicacion), '') is null), e.actualizado_en desc nulls last
  ),
  per as (
    select distinct on (upper(trim(q.numero_identificacion)))
           upper(trim(q.numero_identificacion)) as equipo, q.periodo_mtto, q.periodo_mtto_unidad
    from equipos q
    where q.periodo_mtto is not null
    order by upper(trim(q.numero_identificacion)), q.activo desc, q.periodo_mtto_actualizado_en desc nulls last
  ),
  srv as (
    select distinct on (upper(trim(q.numero_identificacion)))
           upper(trim(q.numero_identificacion)) as equipo,
           s.fecha, s.contador, s.created_at as insp_fecha,
           coalesce(u.nombre_completo, '—') || case s.origen when 'manual' then ' (manual)' when 'orden_sap' then ' (orden SAP)' else '' end as inspector
    from services_equipo s
    join equipos q on q.id = s.equipo_id
    left join usuarios u on u.id = s.cargado_por
    where s.anulado_en is null
    order by upper(trim(q.numero_identificacion)), s.fecha desc, s.created_at desc
  ),
  carga as (
    select distinct on (upper(trim(c.equipo)))
           upper(trim(c.equipo)) as equipo, c.horometro as lectura, c.fecha
    from sap_cargas_combustible c
    where c.horometro > 0 and c.fecha is not null
    order by upper(trim(c.equipo)), c.fecha desc, c.horometro desc
  ),
  ras as (
    select upper(trim(r.nombre_movil)) as equipo,
           min(r.fecha) as desde, max(r.fecha) as hasta,
           bool_or(r.fecha >= current_date - interval '6 months' and (r.horas_marcha > 0 or r.distancia_km > 0)) as uso_6m
    from consumo_combustible r
    where coalesce(trim(r.nombre_movil), '') <> ''
    group by 1
  ),
  universo as (
    select upper(trim(c.equipo)) as equipo from sap_cargas_combustible c
      where c.fecha >= current_date - interval '6 months'
    union select equipo from ras where uso_6m
    union select equipo from srv
    union select equipo from per
  )
  select u.equipo,
         eq.denominacion,
         eq.ubicacion,
         per.periodo_mtto, per.periodo_mtto_unidad,
         s.fecha, s.contador, s.insp_fecha, s.inspector,
         c.lectura, c.fecha,
         case when s.contador is not null and c.lectura is not null then c.lectura - s.contador end,
         ras.equipo is not null,
         ras.desde,
         case when s.fecha is null or ras.equipo is null then null else s.fecha >= ras.desde - 1 end,
         case when s.fecha is not null and ras.equipo is not null then
           (select coalesce(sum(r.horas_marcha), 0) from consumo_combustible r
             where upper(trim(r.nombre_movil)) = u.equipo and r.fecha > s.fecha) end,
         case when s.fecha is not null and ras.equipo is not null then
           (select coalesce(sum(r.horas_ralenti), 0) from consumo_combustible r
             where upper(trim(r.nombre_movil)) = u.equipo and r.fecha > s.fecha) end,
         case when s.fecha is not null and ras.equipo is not null then
           (select coalesce(sum(r.distancia_km), 0) from consumo_combustible r
             where upper(trim(r.nombre_movil)) = u.equipo and r.fecha > s.fecha) end,
         ras.hasta
  from (select distinct equipo from universo where coalesce(equipo, '') <> '') u
  left join eq on eq.equipo = u.equipo
  left join per on per.equipo = u.equipo
  left join srv s on s.equipo = u.equipo
  left join carga c on c.equipo = u.equipo
  left join ras on ras.equipo = u.equipo
  where puede_completar_ordenes()
    and (eq.equipo is not null or s.equipo is not null or per.equipo is not null)
  order by 1
$$;

-- ------------------------------------------------------------
-- 3. mantenimiento_seguimiento_v3(): v2 + service_contador_estado, service_orden
--    Mismas reglas de parte que v2 (modo del período; si no hay período, el más reciente;
--    por_parte solo si el parte es del día del mantenimiento o posterior).
-- ------------------------------------------------------------
create or replace function public.mantenimiento_seguimiento_v3()
returns table(equipo text, denominacion text, ubicacion text, periodo numeric, periodo_unidad text,
  service_fecha date, service_contador numeric, service_inspeccion_fecha timestamptz, service_inspector text,
  carga_lectura numeric, carga_fecha date, por_contador numeric,
  tiene_rastreo boolean, rastreo_desde date, rastreo_completo boolean, rastreo_horas numeric,
  rastreo_ralenti numeric, rastreo_km numeric, rastreo_ultimo_dia date,
  pd_modo text, pd_fecha date, pd_contador numeric, por_parte numeric,
  service_contador_estado text, service_orden bigint)
language sql stable security definer
set search_path = public
as $$
  with base as (select * from mantenimiento_seguimiento()),
  pd_uso as (
    select distinct p.equipo from pd_partes p
    where p.valido and p.fecha >= current_date - interval '6 months'
      and coalesce(p.contador_fin, 0) > coalesce(p.contador_ini, 0)
  ),
  extra as (
    select distinct on (upper(trim(e.equipo)))
           upper(trim(e.equipo)) as equipo, e.denominacion, nullif(trim(e.ubicacion), '') as ubicacion
    from sap_equipos e
    join pd_uso u on u.equipo = upper(trim(e.equipo))
    where not exists (select 1 from base b where b.equipo = upper(trim(e.equipo)))
    order by upper(trim(e.equipo)), (nullif(trim(e.ubicacion), '') is null), e.actualizado_en desc nulls last
  ),
  todo as (
    select b.* from base b
    union all
    select x.equipo, x.denominacion, x.ubicacion, null, null, null, null, null, null, null, null, null,
           false, null, null, null, null, null, null
    from extra x
    where puede_completar_ordenes()
  ),
  srv as (
    select distinct on (upper(trim(q.numero_identificacion)))
           upper(trim(q.numero_identificacion)) as equipo, s.contador_estado, s.orden
    from services_equipo s
    join equipos q on q.id = s.equipo_id
    where s.anulado_en is null
    order by upper(trim(q.numero_identificacion)), s.fecha desc, s.created_at desc
  )
  select t.*, pd.modo, pd.fecha, pd.contador,
         case when t.service_contador is not null and pd.contador is not null and pd.fecha >= t.service_fecha
              then pd.contador - t.service_contador end,
         case when t.service_fecha is not null then srv.contador_estado end,
         case when t.service_fecha is not null then srv.orden end
  from todo t
  left join srv on srv.equipo = t.equipo
  left join lateral (
    select p.modo, p.fecha, max(p.contador_fin) as contador
    from pd_partes p
    where p.valido and p.equipo = t.equipo
    group by p.modo, p.fecha
    order by (p.modo is not distinct from t.periodo_unidad) desc, p.fecha desc, max(p.contador_fin) desc
    limit 1
  ) pd on true
  order by 1
$$;
revoke all on function public.mantenimiento_seguimiento_v3() from public, anon;
grant execute on function public.mantenimiento_seguimiento_v3() to authenticated;

-- ------------------------------------------------------------
-- 4. Ventana 🔧 Mantenimiento: historial con orden y estado del contador
-- ------------------------------------------------------------
create or replace function public.services_de_equipo_v2(p_equipo_id uuid)
returns table (id uuid, fecha date, contador numeric, origen text, cargado_por text, cargado_en timestamptz,
               orden bigint, contador_estado text)
language sql stable security definer
set search_path = public
as $$
  select s.id, s.fecha, s.contador, s.origen, u.nombre_completo, s.created_at, s.orden, s.contador_estado
  from services_equipo s
  left join usuarios u on u.id = s.cargado_por
  where puede_completar_ordenes() and s.equipo_id = p_equipo_id and s.anulado_en is null
  order by s.fecha desc, s.created_at desc
$$;
revoke all on function public.services_de_equipo_v2(uuid) from public, anon;
grant execute on function public.services_de_equipo_v2(uuid) to authenticated;

-- ------------------------------------------------------------
-- 5. anular_service(): manuales y de orden SAP (los de inspección no)
-- ------------------------------------------------------------
create or replace function public.anular_service(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_usuario uuid;
begin
  if not puede_completar_ordenes() then
    raise exception 'Sin permiso para anular mantenimientos';
  end if;
  select id into v_usuario from usuarios where email = auth.email();
  update services_equipo set anulado_en = now(), anulado_por = v_usuario
   where id = p_id and origen in ('manual', 'orden_sap') and anulado_en is null;
  if not found then
    raise exception 'Solo se pueden anular mantenimientos cargados a mano o desde una orden SAP';
  end if;
end $$;
