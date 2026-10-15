-- ============================================================
-- PERÍODO DE MANTENIMIENTO POR EQUIPO + indicador "cuánto falta"
-- Aplicado en Supabase el 15/10/2026. Idempotente.
--
-- Cada equipo tiene su período de mantenimiento preventivo con unidad propia
-- (ej. camionetas 250 h, 5.000 km, 7.000 km o 10.000 km: varía equipo por equipo).
-- Si el período es en horas, el inspector registra horas (el odómetro probablemente no funciona);
-- la app asume que período, contador del mantenimiento y carga de combustible están en la misma unidad.
--
-- Lo carga la encargada de preventivo desde Gestión de Equipos → 🔧 Mantenimiento.
-- Acceso: usuarios.ve_completar_ordenes = true.
--
-- mantenimiento_seguimiento() reemplaza a service_desde_ultimo() en la pantalla
-- "Desde el último mantenimiento" (mismas columnas + periodo y unidad). Las versiones
-- viejas service_desde_ultimo() y service_seguimiento() quedan sin uso.
-- ============================================================

alter table public.equipos
  add column if not exists periodo_mtto numeric,
  add column if not exists periodo_mtto_unidad text,
  add column if not exists periodo_mtto_actualizado_en timestamptz,
  add column if not exists periodo_mtto_actualizado_por uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'equipos_periodo_mtto_chk') then
    alter table public.equipos add constraint equipos_periodo_mtto_chk
      check ((periodo_mtto is null and periodo_mtto_unidad is null)
          or (periodo_mtto > 0 and periodo_mtto_unidad in ('h', 'km')));
  end if;
end $$;

comment on column public.equipos.periodo_mtto is 'Período de mantenimiento preventivo (cada cuántas horas o km). Lo carga la encargada de preventivo.';
comment on column public.equipos.periodo_mtto_unidad is 'Unidad del período: h (horas) o km';

-- ------------------------------------------------------------
-- RPC: ver y fijar el período de un equipo
-- ------------------------------------------------------------
create or replace function public.mantenimiento_periodo(p_equipo_id uuid)
returns table (periodo numeric, unidad text, actualizado_en timestamptz, actualizado_por text)
language sql stable security definer
set search_path = public
as $$
  select e.periodo_mtto, e.periodo_mtto_unidad, e.periodo_mtto_actualizado_en, u.nombre_completo
  from equipos e
  left join usuarios u on u.id = e.periodo_mtto_actualizado_por
  where puede_completar_ordenes() and e.id = p_equipo_id
$$;

create or replace function public.fijar_periodo_mantenimiento(p_equipo_id uuid, p_periodo numeric, p_unidad text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_usuario uuid;
begin
  if not puede_completar_ordenes() then
    raise exception 'Sin permiso para cambiar el período de mantenimiento';
  end if;
  if p_periodo is not null and (p_periodo <= 0 or p_unidad not in ('h', 'km')) then
    raise exception 'El período tiene que ser mayor a 0 y en horas o km';
  end if;
  select id into v_usuario from usuarios where email = auth.email();
  update equipos
     set periodo_mtto = p_periodo,
         periodo_mtto_unidad = case when p_periodo is null then null else p_unidad end,
         periodo_mtto_actualizado_en = now(),
         periodo_mtto_actualizado_por = v_usuario
   where id = p_equipo_id;
  if not found then
    raise exception 'Equipo inexistente';
  end if;
end $$;

revoke all on function public.mantenimiento_periodo(uuid)                     from public, anon;
revoke all on function public.fijar_periodo_mantenimiento(uuid, numeric, text) from public, anon;
grant execute on function public.mantenimiento_periodo(uuid)                     to authenticated;
grant execute on function public.fijar_periodo_mantenimiento(uuid, numeric, text) to authenticated;

-- ------------------------------------------------------------
-- Seguimiento con período
-- ------------------------------------------------------------
create or replace function public.mantenimiento_seguimiento()
returns table (
  equipo text,
  denominacion text,
  ubicacion text,
  periodo numeric,
  periodo_unidad text,
  service_fecha date,
  service_contador numeric,
  service_inspeccion_fecha timestamptz,
  service_inspector text,
  carga_lectura numeric,
  carga_fecha date,
  por_contador numeric,
  tiene_rastreo boolean,
  rastreo_desde date,
  rastreo_completo boolean,
  rastreo_horas numeric,
  rastreo_ralenti numeric,
  rastreo_km numeric,
  rastreo_ultimo_dia date
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
           coalesce(u.nombre_completo, '—') || case when s.origen = 'manual' then ' (manual)' else '' end as inspector
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

revoke all on function public.mantenimiento_seguimiento() from public, anon;
grant execute on function public.mantenimiento_seguimiento() to authenticated;
