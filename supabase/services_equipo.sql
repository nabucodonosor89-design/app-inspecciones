-- ============================================================
-- SERVICES POR EQUIPO — segunda vía de carga del último mantenimiento
-- Aplicado en Supabase el 15/10/2026. Idempotente.
--
-- Hasta ahora el último mantenimiento solo se cargaba en la inspección (ficha de mantenimiento,
-- ver desde_ultimo_service.sql). Ahora también lo carga la encargada de preventivo desde
-- Gestión de Equipos con los datos de cierre de la orden preventiva (solo contador y fecha).
--
-- Modelo: tabla services_equipo con un registro por mantenimiento y su origen:
--   · 'inspeccion' → lo crea/actualiza un trigger cuando la inspección trae ficha_service_*
--   · 'manual'     → registrar_service() desde Gestión de Equipos
-- service_desde_ultimo() toma el de FECHA DE SERVICE más reciente, sin importar el origen.
--
-- Acceso: solo por RPC (tabla con RLS y sin políticas). Ver/cargar/anular: usuarios con
-- ve_completar_ordenes = true. Correcciones: los manuales se ANULAN (anulado_en/anulado_por),
-- no se borran; los de inspección no se anulan desde acá.
-- (Aplicado en partes: services_equipo_tabla, _trigger, _rpc, _anular, service_desde_ultimo_usa_tabla)
-- ============================================================

create table if not exists public.services_equipo (
  id uuid primary key default gen_random_uuid(),
  equipo_id uuid not null references public.equipos(id),
  fecha date not null,
  contador numeric not null check (contador >= 0),
  origen text not null check (origen in ('inspeccion', 'manual')),
  inspeccion_id uuid unique references public.inspecciones(id) on delete cascade,
  cargado_por uuid,  -- usuarios.id (sin FK a propósito: un problema acá nunca debe impedir guardar una inspección)
  created_at timestamptz not null default now(),
  anulado_en timestamptz,
  anulado_por uuid
);
create index if not exists services_equipo_equipo_fecha_idx on public.services_equipo (equipo_id, fecha desc);
alter table public.services_equipo enable row level security;
revoke all on table public.services_equipo from anon, authenticated;
comment on table public.services_equipo is 'Último(s) mantenimiento(s) por equipo: desde la ficha de mantenimiento de la inspección (trigger) o carga manual de la encargada de preventivo. Acceso solo por RPC.';

-- ------------------------------------------------------------
-- 1. Inspección → services_equipo (trigger)
-- ------------------------------------------------------------
create or replace function public.trg_inspeccion_service()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.ficha_service_fecha is not null and new.ficha_service_contador is not null then
    insert into services_equipo (equipo_id, fecha, contador, origen, inspeccion_id, cargado_por, created_at)
    values (new.equipo_id, new.ficha_service_fecha, new.ficha_service_contador, 'inspeccion', new.id, new.inspector_id, coalesce(new.fecha_hora, now()))
    on conflict (inspeccion_id) do update
      set fecha = excluded.fecha, contador = excluded.contador, equipo_id = excluded.equipo_id;
  else
    delete from services_equipo where inspeccion_id = new.id;
  end if;
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'inspecciones_service' and tgrelid = 'public.inspecciones'::regclass) then
    create trigger inspecciones_service
      after insert or update of ficha_service_fecha, ficha_service_contador, equipo_id on public.inspecciones
      for each row execute function public.trg_inspeccion_service();
  end if;
end $$;

-- Lo ya cargado por inspección
insert into public.services_equipo (equipo_id, fecha, contador, origen, inspeccion_id, cargado_por, created_at)
select i.equipo_id, i.ficha_service_fecha, i.ficha_service_contador, 'inspeccion', i.id, i.inspector_id, coalesce(i.fecha_hora, now())
from public.inspecciones i
where i.ficha_service_fecha is not null and i.ficha_service_contador is not null
on conflict (inspeccion_id) do nothing;

-- ------------------------------------------------------------
-- 2. RPC para Gestión de Equipos
-- ------------------------------------------------------------
create or replace function public.services_de_equipo(p_equipo_id uuid)
returns table (id uuid, fecha date, contador numeric, origen text, cargado_por text, cargado_en timestamptz)
language sql stable security definer
set search_path = public
as $$
  select s.id, s.fecha, s.contador, s.origen, u.nombre_completo, s.created_at
  from services_equipo s
  left join usuarios u on u.id = s.cargado_por
  where puede_completar_ordenes() and s.equipo_id = p_equipo_id and s.anulado_en is null
  order by s.fecha desc, s.created_at desc
$$;

create or replace function public.registrar_service(p_equipo_id uuid, p_fecha date, p_contador numeric)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_usuario uuid;
  v_id uuid;
begin
  if not puede_completar_ordenes() then
    raise exception 'Sin permiso para registrar mantenimientos';
  end if;
  if p_fecha is null or p_contador is null then
    raise exception 'Faltan la fecha o el contador';
  end if;
  if p_fecha > (now() at time zone 'America/Asuncion')::date then
    raise exception 'La fecha del mantenimiento no puede ser futura';
  end if;
  if p_contador < 0 then
    raise exception 'El contador no puede ser negativo';
  end if;
  if not exists (select 1 from equipos where id = p_equipo_id) then
    raise exception 'Equipo inexistente';
  end if;
  select id into v_usuario from usuarios where email = auth.email();
  insert into services_equipo (equipo_id, fecha, contador, origen, cargado_por)
  values (p_equipo_id, p_fecha, p_contador, 'manual', v_usuario)
  returning id into v_id;
  return v_id;
end $$;

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
   where id = p_id and origen = 'manual' and anulado_en is null;
  if not found then
    raise exception 'Solo se pueden anular mantenimientos cargados a mano';
  end if;
end $$;

revoke all on function public.services_de_equipo(uuid)                 from public, anon;
revoke all on function public.registrar_service(uuid, date, numeric)    from public, anon;
revoke all on function public.anular_service(uuid)                      from public, anon;
grant execute on function public.services_de_equipo(uuid)               to authenticated;
grant execute on function public.registrar_service(uuid, date, numeric) to authenticated;
grant execute on function public.anular_service(uuid)                   to authenticated;

-- ------------------------------------------------------------
-- 3. service_desde_ultimo(): ahora lee services_equipo (inspección + manual)
--    Misma firma que antes. service_inspeccion_fecha = cuándo se cargó;
--    service_inspector = quién lo cargó + " (manual)" si vino de Gestión de Equipos.
-- ------------------------------------------------------------
create or replace function public.service_desde_ultimo()
returns table (
  equipo text,
  denominacion text,
  ubicacion text,
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
  )
  select u.equipo,
         eq.denominacion,
         eq.ubicacion,
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
  left join srv s on s.equipo = u.equipo
  left join carga c on c.equipo = u.equipo
  left join ras on ras.equipo = u.equipo
  where puede_completar_ordenes()
    and (eq.equipo is not null or s.equipo is not null)
  order by 1
$$;
