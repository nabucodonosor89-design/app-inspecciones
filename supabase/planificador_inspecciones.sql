-- =====================================================================
-- PLANIFICADOR DE INSPECCIONES v1  (oct-2026)
-- Objetivo: la menor cantidad posible de equipos con la inspección vencida.
-- Reemplaza al Dashboard Ejecutivo y al Panel de Flota.
--
-- Idempotente: se puede correr entero las veces que haga falta.
-- Las cargas iniciales (zonas, inspectores, ubicaciones, parámetros) NO pisan lo que
-- el admin haya cambiado después: solo insertan lo que falta.
--
-- Reglas:
--   Universo      equipos.activo = true, con ubicación IE36 (sap_equipos.ubicacion) cuya fila en
--                 insp_ubicaciones tiene inspecciona = true, o SIN ubicación (figuran como
--                 "Sin ubicación": cuentan en el KPI pero no se asignan a ninguna zona).
--                 Una ubicación IE36 sin fila en insp_ubicaciones queda afuera y sale como alerta.
--   Ubicación     sap_equipos.ubicacion (join sap_equipos.equipo = equipos.numero_identificacion).
--                 Si un equipo tiene más de una fila en sap_equipos, vale la que tiene ubicación y,
--                 entre esas, la más recientemente actualizada. NO se usa equipos.ubicacion_actual.
--   Vencida       última inspección nula, o anterior a hoy − frecuencia_dias (fecha de Asunción).
--   Reloj         cualquier inspección (periódica, taller, envío, recepción) de cualquier usuario.
--                 Se lee de inspecciones.fecha_hora (misma fuente que equipos.fecha_ultima_inspeccion,
--                 que actualiza el trigger trigger_actualizar_semaforo de checklist_items; verificado
--                 16/10/2026: coinciden en el 100 % de los equipos). Leer la tabla permite calcular el
--                 estado "al lunes 00:00" para el plan.
--   Prioridad     nunca inspeccionados primero; después días vencido de mayor a menor.
--   Prioridad de obra (itinerante) = Σ días vencido de sus equipos vencidos; un nunca inspeccionado
--                 cuenta como dias_nunca_inspeccionado.
--   Hecho         no se guarda: un equipo del plan está hecho si tiene una inspección de cualquier tipo
--                 con fecha_hora >= lunes 00:00 (Asunción) de esa semana (y < lunes siguiente).
--
-- Horario: Paraguay usa UTC−3 todo el año (sin horario de verano desde oct-2024). El servidor está
-- en UTC → lunes 06:00 Asunción = lunes 09:00 UTC → cron '0 9 * * 1'.
-- =====================================================================


-- =====================================================================
-- 1. TABLAS
-- =====================================================================
create table if not exists public.insp_parametros (
  clave       text primary key,
  valor       numeric not null,
  descripcion text,
  updated_at  timestamptz not null default now()
);

create table if not exists public.insp_zonas (
  id     uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  tipo   text not null check (tipo in ('residente', 'itinerante')),
  activa boolean not null default true
);

create table if not exists public.insp_ubicaciones (
  ubicacion_sap text primary key,                 -- texto exacto de la IE36
  inspecciona   boolean not null default true,
  zona_id       uuid references public.insp_zonas(id),
  updated_at    timestamptz not null default now()
);

-- desde null = cargado como posible suplente, sin vigencia (no cuenta para la capacidad ni ve la lista)
create table if not exists public.insp_zona_inspectores (
  id               uuid primary key default gen_random_uuid(),
  zona_id          uuid not null references public.insp_zonas(id),
  usuario_id       uuid not null references public.usuarios(id),
  rol              text not null check (rol in ('titular', 'suplente')),
  capacidad_diaria int  not null default 10 check (capacidad_diaria > 0),
  desde            date,
  hasta            date,                          -- null = sin fin
  created_at       timestamptz not null default now(),
  check (hasta is null or desde is null or hasta >= desde)
);
create index if not exists insp_zona_inspectores_usuario on public.insp_zona_inspectores (usuario_id);

create table if not exists public.insp_plan_semanal (
  semana                  date not null,          -- lunes
  zona_id                 uuid not null references public.insp_zonas(id),
  equipo_id               uuid not null references public.equipos(id),
  orden                   int  not null,
  ubicacion_sap           text,
  dias_vencido_al_generar int,                    -- null = nunca inspeccionado; ≤ 0 = vence esta semana
  generado_en             timestamptz not null default now(),
  primary key (semana, equipo_id)
);
create index if not exists insp_plan_semanal_zona on public.insp_plan_semanal (semana, zona_id, orden);

-- Serie histórica del KPI (zona_id null = toda la flota)
create table if not exists public.insp_kpi_semanal (
  semana        date not null,
  zona_id       uuid references public.insp_zonas(id),
  universo      int  not null default 0,
  al_dia        int  not null default 0,
  vencidos      int  not null default 0,
  nunca         int  not null default 0,
  planificados  int  not null default 0,
  hechos        int  not null default 0,
  es_linea_base boolean not null default false,  -- la foto de la línea base no se pisa al generar
  foto_en       timestamptz not null default now()
);
create unique index if not exists insp_kpi_semanal_uk
  on public.insp_kpi_semanal (semana, (coalesce(zona_id, '00000000-0000-0000-0000-000000000000'::uuid)));


-- =====================================================================
-- 2. PARÁMETROS Y CARGA INICIAL
-- =====================================================================
insert into public.insp_parametros (clave, valor, descripcion) values
  ('frecuencia_dias', 30, 'Días entre inspecciones (igual para toda la flota)'),
  ('dias_nunca_inspeccionado', 60, 'Días vencido que cuenta un equipo nunca inspeccionado en la prioridad de obra'),
  ('dias_habiles_semana', 5, 'Días hábiles por semana para la capacidad')
on conflict (clave) do nothing;

insert into public.insp_zonas (nombre, tipo) values
  ('Ruta 17', 'residente'),
  ('Paracel', 'residente'),
  ('Itinerante', 'itinerante')
on conflict (nombre) do nothing;

-- Ubicaciones: todas las distintas de la IE36 de hoy. Solo inserta las que faltan.
insert into public.insp_ubicaciones (ubicacion_sap, inspecciona, zona_id)
select u.ubicacion,
       u.ubicacion <> 'EN REPARACIÓN TALLER CENTRAL',
       case
         when u.ubicacion = 'EN REPARACIÓN TALLER CENTRAL' then null
         when u.ubicacion in ('RUTA 17 OBRA DE LA SOBERANIA', 'CANTERA SOBERANIA', 'RUTA 13')
           then (select id from public.insp_zonas where nombre = 'Ruta 17')
         when u.ubicacion = 'Obra Paracel' then (select id from public.insp_zonas where nombre = 'Paracel')
         else (select id from public.insp_zonas where nombre = 'Itinerante')   -- incluye Ypané
       end
from (select distinct ubicacion from public.sap_equipos where ubicacion is not null) u
on conflict (ubicacion_sap) do nothing;

-- Inspectores (por email; si el usuario no existe se avisa y no se crea)
do $$
declare
  r record;
  v_usuario uuid;
begin
  for r in
    select * from (values
      ('Ruta 17',    'richard.silvero@itcsa.com.py', 'titular',  true),
      ('Paracel',    'manuel.ramirez@itcsa.com.py',  'titular',  true),
      ('Itinerante', 'antonio.cabrera@itcsa.com.py', 'titular',  true),
      ('Itinerante', 'david.carballo@itcsa.com.py',  'suplente', false)   -- posible suplente, sin fechas
    ) as t(zona, email, rol, vigente)
  loop
    select id into v_usuario from public.usuarios where lower(email) = r.email;
    if v_usuario is null then
      raise warning 'Planificador: no existe el usuario % (zona %). No se creó.', r.email, r.zona;
      continue;
    end if;
    insert into public.insp_zona_inspectores (zona_id, usuario_id, rol, capacidad_diaria, desde)
    select z.id, v_usuario, r.rol, 10, case when r.vigente then date '2026-10-12' end
    from public.insp_zonas z
    where z.nombre = r.zona
      and not exists (select 1 from public.insp_zona_inspectores i
                      where i.zona_id = z.id and i.usuario_id = v_usuario);
  end loop;
  -- Mario Flores todavía no tiene usuario: no se crea.
end $$;


-- =====================================================================
-- 3. HELPERS
-- =====================================================================
create or replace function public.insp_param(p text) returns numeric
language sql stable security definer set search_path = public as $$
  select valor from insp_parametros where clave = p
$$;

create or replace function public.insp_es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuarios where email = auth.email() and activo = true and rol = 'admin')
$$;

-- Permiso de las tareas de sistema: service_role, conexión directa sin JWT (SQL Editor / pg_cron) o admin
create or replace function public.insp__puede_sistema() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.role(), 'directo') in ('service_role', 'directo') or insp_es_admin()
$$;

create or replace function public.insp__hoy() returns date
language sql stable as $$ select (now() at time zone 'America/Asuncion')::date $$;

create or replace function public.insp__lunes(p date) returns date
language sql immutable as $$ select date_trunc('week', p)::date $$;

-- Inicio del día p a las 00:00 de Asunción
create or replace function public.insp__ts(p date) returns timestamptz
language sql stable as $$ select (p::timestamp at time zone 'America/Asuncion') $$;


-- =====================================================================
-- 4. ESTADO DE LOS EQUIPOS
-- p_corte: momento de referencia. Solo cuentan las inspecciones anteriores a p_corte y "hoy" es la
-- fecha de Asunción de p_corte. Por defecto, ahora. Para el plan se usa el lunes 00:00.
-- =====================================================================
create or replace function public.insp_estado_equipos(p_corte timestamptz default now())
returns table (
  equipo_id uuid, numero_identificacion text, denominacion text, ubicacion_sap text,
  zona_id uuid, zona_nombre text, zona_tipo text,
  fecha_ultima_inspeccion timestamptz, vence date, dias_vencido int, estado text, prioridad int
)
language sql stable security definer set search_path = public as $$
  with par as (
    select coalesce(insp_param('frecuencia_dias'), 30)::int as freq,
           (p_corte at time zone 'America/Asuncion')::date as ref
  ),
  sap as (
    select distinct on (equipo) equipo, ubicacion
    from sap_equipos
    order by equipo, (ubicacion is null), actualizado_en desc nulls last
  ),
  ult as (
    select i.equipo_id, max(i.fecha_hora) as f
    from inspecciones i
    where i.fecha_hora < p_corte or (p_corte >= now() and i.fecha_hora <= p_corte)   -- "ahora" incluye lo recién guardado
    group by 1
  ),
  base as (
    select e.id, e.numero_identificacion, e.denominacion, s.ubicacion,
           z.id as zid, z.nombre as znom, z.tipo as ztipo,
           -- el campo de equipos solo cuando el corte es "ahora"
           greatest(ult.f, case when p_corte >= now() then e.fecha_ultima_inspeccion end) as f
    from equipos e
    left join sap s on s.equipo = e.numero_identificacion
    left join insp_ubicaciones u on u.ubicacion_sap = s.ubicacion
    left join insp_zonas z on z.id = u.zona_id and z.activa
    left join ult on ult.equipo_id = e.id
    where e.activo = true
      and (s.ubicacion is null or u.inspecciona = true)
  ),
  calc as (
    select b.*,
           ((b.f at time zone 'America/Asuncion')::date + par.freq) as v,
           case when b.f is null then null
                else par.ref - ((b.f at time zone 'America/Asuncion')::date + par.freq) end as dv
    from base b cross join par
  )
  select id, numero_identificacion, denominacion, ubicacion, zid, znom, ztipo, f, v, dv,
         case when f is null then 'nunca' when dv > 0 then 'vencido' else 'al_dia' end,
         (row_number() over (order by (f is null) desc, dv desc nulls first, numero_identificacion))::int
  from calc
$$;


-- =====================================================================
-- 5. CAPACIDAD Y GENERACIÓN DEL PLAN
-- =====================================================================
-- Inspectores vigentes en la semana del lunes p_lunes (titulares y suplentes)
create or replace function public.insp__vigentes(p_lunes date)
returns setof public.insp_zona_inspectores
language sql stable security definer set search_path = public as $$
  select * from insp_zona_inspectores
  where desde is not null and desde <= p_lunes + 6 and (hasta is null or hasta >= p_lunes)
$$;

-- Recalcula la columna hechos de la serie del KPI (semanas con plan)
create or replace function public.insp__refrescar_hechos() returns void
language sql security definer set search_path = public as $$
  with h as (
    select p.semana, p.zona_id, count(*) as plan,
           count(*) filter (where exists (
             select 1 from inspecciones i
             where i.equipo_id = p.equipo_id
               and i.fecha_hora >= insp__ts(p.semana) and i.fecha_hora < insp__ts(p.semana + 7))) as hechos
    from insp_plan_semanal p group by 1, 2
  )
  update insp_kpi_semanal k
  set hechos = coalesce((select sum(h.hechos) from h where h.semana = k.semana
                          and (k.zona_id is null or h.zona_id = k.zona_id)), 0)
  where exists (select 1 from h where h.semana = k.semana)
$$;

create or replace function public.insp_generar_plan(p_semana date default null, p_forzar boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_lunes date := insp__lunes(coalesce(p_semana, insp__hoy()));
  v_dom   date;
  v_corte timestamptz;
  v_dh    int  := coalesce(insp_param('dias_habiles_semana'), 5)::int;
  v_dn    int  := coalesce(insp_param('dias_nunca_inspeccionado'), 60)::int;
  z       record;
  v_cap   int;
  v_n     int;
  v_zonas jsonb := '[]'::jsonb;
  v_sin   jsonb := '[]'::jsonb;
begin
  if not insp__puede_sistema() then
    raise exception 'Sin permiso para generar el plan' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('insp_generar_plan'));

  v_dom   := v_lunes + 6;
  v_corte := insp__ts(v_lunes);

  if exists (select 1 from insp_plan_semanal where semana = v_lunes) and not p_forzar then
    return jsonb_build_object('ok', false, 'motivo', 'ya_existe', 'semana', v_lunes);
  end if;
  delete from insp_plan_semanal where semana = v_lunes;

  -- Estado al lunes 00:00 (el plan de la semana no cambia según el día en que se genere)
  drop table if exists pg_temp._insp_est;
  create temp table _insp_est on commit drop as select * from insp_estado_equipos(v_corte);

  for z in select * from insp_zonas where activa order by nombre loop
    select coalesce(sum(capacidad_diaria), 0) * v_dh into v_cap
    from insp__vigentes(v_lunes) where zona_id = z.id;

    if v_cap = 0 then
      v_sin := v_sin || to_jsonb(z.nombre);
      continue;
    end if;

    if z.tipo = 'residente' then
      -- Vencidos por prioridad; si sobra capacidad, los que vencen hasta el domingo
      insert into insp_plan_semanal (semana, zona_id, equipo_id, orden, ubicacion_sap, dias_vencido_al_generar)
      select v_lunes, z.id, c.equipo_id, row_number() over (order by c.grp, c.prioridad), c.ubicacion_sap, c.dias_vencido
      from (
        select e.*, case when e.estado = 'al_dia' then 1 else 0 end as grp
        from _insp_est e
        where e.zona_id = z.id and (e.estado <> 'al_dia' or e.vence <= v_dom)
        order by grp, e.prioridad
        limit v_cap
      ) c;
    else
      -- Itinerante: obras por prioridad (Σ días vencido), obras completas en orden; la última que no
      -- entra entera se completa con sus equipos de mayor prioridad (el corte por capacidad lo hace).
      insert into insp_plan_semanal (semana, zona_id, equipo_id, orden, ubicacion_sap, dias_vencido_al_generar)
      select v_lunes, z.id, c.equipo_id, row_number() over (order by c.prio_obra desc, c.ubicacion_sap, c.prioridad),
             c.ubicacion_sap, c.dias_vencido
      from (
        select e.*, sum(case when e.estado = 'nunca' then v_dn else e.dias_vencido end)
                      over (partition by e.ubicacion_sap) as prio_obra
        from _insp_est e
        where e.zona_id = z.id and e.estado <> 'al_dia'
        order by prio_obra desc, e.ubicacion_sap, e.prioridad
        limit v_cap
      ) c;
    end if;

    get diagnostics v_n = row_count;
    v_zonas := v_zonas || jsonb_build_object('zona', z.nombre, 'capacidad', v_cap, 'planificados', v_n);
  end loop;

  -- Foto del KPI por zona y para toda la flota (la línea base conserva su foto; solo suma planificados)
  insert into insp_kpi_semanal as k (semana, zona_id, universo, al_dia, vencidos, nunca, planificados, foto_en)
  select v_lunes, g.zona_id, g.universo, g.al_dia, g.vencidos, g.nunca,
         (select count(*) from insp_plan_semanal p where p.semana = v_lunes
            and (g.zona_id is null or p.zona_id = g.zona_id)),
         now()
  from (
    select zz.id as zona_id,
           count(e.equipo_id) as universo,
           count(e.equipo_id) filter (where e.estado = 'al_dia') as al_dia,
           count(e.equipo_id) filter (where e.estado = 'vencido') as vencidos,
           count(e.equipo_id) filter (where e.estado = 'nunca') as nunca
    from insp_zonas zz left join _insp_est e on e.zona_id = zz.id
    where zz.activa group by zz.id
    union all
    select null, count(*), count(*) filter (where estado = 'al_dia'),
           count(*) filter (where estado = 'vencido'), count(*) filter (where estado = 'nunca')
    from _insp_est
  ) g
  on conflict (semana, (coalesce(zona_id, '00000000-0000-0000-0000-000000000000'::uuid))) do update set
    universo     = case when k.es_linea_base then k.universo else excluded.universo end,
    al_dia       = case when k.es_linea_base then k.al_dia   else excluded.al_dia end,
    vencidos     = case when k.es_linea_base then k.vencidos else excluded.vencidos end,
    nunca        = case when k.es_linea_base then k.nunca    else excluded.nunca end,
    foto_en      = case when k.es_linea_base then k.foto_en  else excluded.foto_en end,
    planificados = excluded.planificados;

  perform insp__refrescar_hechos();

  return jsonb_build_object('ok', true, 'semana', v_lunes, 'zonas', v_zonas, 'sin_inspector', v_sin);
end $$;


-- =====================================================================
-- 6. LECTURAS PARA LA APP (todas validan adentro)
-- =====================================================================
-- Zonas en las que el usuario logueado está asignado con vigencia esta semana
create or replace function public.insp_mi_zona()
returns table (zona_id uuid, zona_nombre text, zona_tipo text, rol text)
language sql stable security definer set search_path = public as $$
  select distinct z.id, z.nombre, z.tipo, v.rol
  from insp__vigentes(insp__lunes(insp__hoy())) v
  join insp_zonas z on z.id = v.zona_id and z.activa
  where v.usuario_id = usuario_actual_id()
$$;

-- Lista de la semana del usuario logueado (titular y suplente de la misma zona ven la misma lista)
create or replace function public.insp_mi_lista()
returns table (
  semana date, zona_id uuid, zona_nombre text, orden int, equipo_id uuid, numero_identificacion text,
  denominacion text, ubicacion_sap text, dias_vencido_al_generar int, hecho boolean, hecho_en timestamptz
)
language sql stable security definer set search_path = public as $$
  with s as (select insp__lunes(insp__hoy()) as lunes)
  select p.semana, p.zona_id, z.nombre, p.orden, p.equipo_id, e.numero_identificacion, e.denominacion,
         p.ubicacion_sap, p.dias_vencido_al_generar, h.f is not null, h.f
  from s
  join insp_plan_semanal p on p.semana = s.lunes
  join insp_zonas z on z.id = p.zona_id
  join equipos e on e.id = p.equipo_id
  left join lateral (
    select min(i.fecha_hora) as f from inspecciones i
    where i.equipo_id = p.equipo_id and i.fecha_hora >= insp__ts(p.semana) and i.fecha_hora < insp__ts(p.semana + 7)
  ) h on true
  where p.zona_id in (select zona_id from insp_mi_zona())
  order by z.nombre, p.orden
$$;

-- Estado actual de toda la flota del universo (admin)
create or replace function public.insp_panel_estado()
returns table (
  equipo_id uuid, numero_identificacion text, denominacion text, ubicacion_sap text,
  zona_id uuid, zona_nombre text, zona_tipo text,
  fecha_ultima_inspeccion timestamptz, vence date, dias_vencido int, estado text, prioridad int
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not insp_es_admin() then raise exception 'Solo admin' using errcode = '42501'; end if;
  return query select * from insp_estado_equipos(now());
end $$;

-- Cumplimiento por semana y zona, en vivo (admin)
create or replace function public.insp_cumplimiento()
returns table (semana date, zona_id uuid, zona_nombre text, planificados int, hechos int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not insp_es_admin() then raise exception 'Solo admin' using errcode = '42501'; end if;
  return query
  select p.semana, p.zona_id, z.nombre, count(*)::int,
         (count(*) filter (where exists (
            select 1 from inspecciones i where i.equipo_id = p.equipo_id
              and i.fecha_hora >= insp__ts(p.semana) and i.fecha_hora < insp__ts(p.semana + 7))))::int
  from insp_plan_semanal p join insp_zonas z on z.id = p.zona_id
  group by 1, 2, 3 order by 1 desc, 3;
end $$;

-- Serie histórica del KPI (admin)
create or replace function public.insp_kpi_serie()
returns table (semana date, zona_id uuid, zona_nombre text, universo int, al_dia int, vencidos int,
               nunca int, planificados int, hechos int, es_linea_base boolean, foto_en timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not insp_es_admin() then raise exception 'Solo admin' using errcode = '42501'; end if;
  return query
  select k.semana, k.zona_id, z.nombre, k.universo, k.al_dia, k.vencidos, k.nunca, k.planificados,
         k.hechos, k.es_linea_base, k.foto_en
  from insp_kpi_semanal k left join insp_zonas z on z.id = k.zona_id
  order by k.semana, z.nombre nulls first;
end $$;

-- Carga por zona = universo ÷ (capacidad diaria vigente × días hábiles en frecuencia_dias) (admin)
create or replace function public.insp_carga_zonas()
returns table (zona_id uuid, zona_nombre text, zona_tipo text, universo int, capacidad_diaria int,
               dias_habiles_ciclo numeric, carga numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_ciclo numeric := coalesce(insp_param('frecuencia_dias'), 30) * coalesce(insp_param('dias_habiles_semana'), 5) / 7.0;
begin
  if not insp_es_admin() then raise exception 'Solo admin' using errcode = '42501'; end if;
  return query
  with u as (select e.zona_id, count(*)::int as n from insp_estado_equipos(now()) e group by 1),
       c as (select v.zona_id, sum(v.capacidad_diaria)::int as cap
             from insp__vigentes(insp__lunes(insp__hoy())) v group by 1)
  select z.id, z.nombre, z.tipo, coalesce(u.n, 0), coalesce(c.cap, 0), round(v_ciclo, 1),
         case when coalesce(c.cap, 0) = 0 then null
              else round(coalesce(u.n, 0) / (c.cap * v_ciclo), 3) end
  from insp_zonas z left join u on u.zona_id = z.id left join c on c.zona_id = z.id
  where z.activa order by z.nombre;
end $$;

-- Alertas (admin)
create or replace function public.insp_alertas() returns jsonb
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v jsonb;
begin
  if not insp_es_admin() then raise exception 'Solo admin' using errcode = '42501'; end if;
  with sap as (
    select distinct on (equipo) equipo, ubicacion from sap_equipos
    order by equipo, (ubicacion is null), actualizado_en desc nulls last
  )
  select jsonb_build_object(
    'ubicaciones_nuevas', coalesce((
      select jsonb_agg(jsonb_build_object('ubicacion', x.ubicacion, 'equipos', x.n) order by x.n desc)
      from (select s.ubicacion, count(e.id) as n
            from (select distinct ubicacion from sap_equipos where ubicacion is not null) s
            left join sap on sap.ubicacion = s.ubicacion
            left join equipos e on e.numero_identificacion = sap.equipo and e.activo
            where not exists (select 1 from insp_ubicaciones u where u.ubicacion_sap = s.ubicacion)
            group by 1) x), '[]'::jsonb),
    'ubicaciones_sin_zona', coalesce((
      select jsonb_agg(u.ubicacion_sap order by u.ubicacion_sap) from insp_ubicaciones u
      left join insp_zonas z on z.id = u.zona_id and z.activa
      where u.inspecciona and z.id is null), '[]'::jsonb),
    'sin_ubicacion', coalesce((
      select jsonb_agg(jsonb_build_object('equipo_id', e.id, 'equipo', e.numero_identificacion,
                                          'denominacion', e.denominacion, 'en_ie36', sap.equipo is not null)
                       order by e.numero_identificacion)
      from equipos e left join sap on sap.equipo = e.numero_identificacion
      where e.activo and sap.ubicacion is null), '[]'::jsonb),
    'zonas_sin_inspector', coalesce((
      select jsonb_agg(z.nombre order by z.nombre) from insp_zonas z
      where z.activa and not exists (select 1 from insp__vigentes(insp__lunes(insp__hoy())) v where v.zona_id = z.id)
    ), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- Detalle del plan de una semana (admin, solo lectura)
create or replace function public.insp_plan_detalle(p_semana date default null)
returns table (semana date, zona_id uuid, zona_nombre text, orden int, equipo_id uuid, numero_identificacion text,
               denominacion text, ubicacion_sap text, dias_vencido_al_generar int, hecho boolean, hecho_en timestamptz,
               generado_en timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_lunes date := insp__lunes(coalesce(p_semana, insp__hoy()));
begin
  if not insp_es_admin() then raise exception 'Solo admin' using errcode = '42501'; end if;
  return query
  select p.semana, p.zona_id, z.nombre, p.orden, p.equipo_id, e.numero_identificacion, e.denominacion,
         p.ubicacion_sap, p.dias_vencido_al_generar, h.f is not null, h.f, p.generado_en
  from insp_plan_semanal p
  join insp_zonas z on z.id = p.zona_id
  join equipos e on e.id = p.equipo_id
  left join lateral (
    select min(i.fecha_hora) as f from inspecciones i
    where i.equipo_id = p.equipo_id and i.fecha_hora >= insp__ts(p.semana) and i.fecha_hora < insp__ts(p.semana + 7)
  ) h on true
  where p.semana = v_lunes
  order by z.nombre, p.orden;
end $$;


-- =====================================================================
-- 7. ADMINISTRACIÓN DE ZONAS (admin; escrituras solo por RPC)
-- =====================================================================
create or replace function public.insp_zonas_listado()
returns table (zona_id uuid, nombre text, tipo text, activa boolean, inspectores jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_lunes date := insp__lunes(insp__hoy());
begin
  if not insp_es_admin() then raise exception 'Solo admin' using errcode = '42501'; end if;
  return query
  select z.id, z.nombre, z.tipo, z.activa,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', i.id, 'usuario_id', i.usuario_id, 'nombre', u.nombre_completo, 'email', u.email,
                     'rol', i.rol, 'capacidad_diaria', i.capacidad_diaria, 'desde', i.desde, 'hasta', i.hasta,
                     'vigente_semana', (i.desde is not null and i.desde <= v_lunes + 6 and (i.hasta is null or i.hasta >= v_lunes)))
                     order by i.rol desc, u.nombre_completo, i.desde)
                   from insp_zona_inspectores i join usuarios u on u.id = i.usuario_id
                   where i.zona_id = z.id), '[]'::jsonb)
  from insp_zonas z order by z.nombre;
end $$;

create or replace function public.insp_ubicaciones_listado()
returns table (ubicacion_sap text, registrada boolean, inspecciona boolean, zona_id uuid, equipos_activos int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not insp_es_admin() then raise exception 'Solo admin' using errcode = '42501'; end if;
  return query
  with sap as (
    select distinct on (equipo) equipo, ubicacion from sap_equipos
    order by equipo, (ubicacion is null), actualizado_en desc nulls last
  ),
  todas as (
    select ubicacion_sap as ub from insp_ubicaciones
    union
    select distinct ubicacion from sap_equipos where ubicacion is not null
  )
  select t.ub, u.ubicacion_sap is not null, coalesce(u.inspecciona, true), u.zona_id,
         (select count(*) from sap join equipos e on e.numero_identificacion = sap.equipo and e.activo
          where sap.ubicacion = t.ub)::int
  from todas t left join insp_ubicaciones u on u.ubicacion_sap = t.ub
  order by (u.zona_id is null and coalesce(u.inspecciona, true)) desc, t.ub;
end $$;

create or replace function public.insp_guardar_ubicacion(p_ubicacion text, p_inspecciona boolean, p_zona_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not insp_es_admin() then raise exception 'Solo admin' using errcode = '42501'; end if;
  if coalesce(trim(p_ubicacion), '') = '' then raise exception 'Ubicación vacía'; end if;
  insert into insp_ubicaciones (ubicacion_sap, inspecciona, zona_id, updated_at)
  values (p_ubicacion, coalesce(p_inspecciona, true), p_zona_id, now())
  on conflict (ubicacion_sap) do update
    set inspecciona = excluded.inspecciona, zona_id = excluded.zona_id, updated_at = now();
end $$;

create or replace function public.insp_usuarios_activos()
returns table (id uuid, nombre_completo text, email text, rol text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not insp_es_admin() then raise exception 'Solo admin' using errcode = '42501'; end if;
  return query select u.id, u.nombre_completo, u.email, u.rol from usuarios u
               where u.activo order by u.nombre_completo;
end $$;

-- p_id null = alta; con id = edición
create or replace function public.insp_guardar_inspector(
  p_id uuid, p_zona_id uuid, p_usuario_id uuid, p_rol text, p_capacidad int, p_desde date, p_hasta date)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not insp_es_admin() then raise exception 'Solo admin' using errcode = '42501'; end if;
  if p_rol not in ('titular', 'suplente') then raise exception 'Rol inválido'; end if;
  if coalesce(p_capacidad, 0) <= 0 then raise exception 'La capacidad diaria tiene que ser mayor a 0'; end if;
  if p_hasta is not null and p_desde is not null and p_hasta < p_desde then
    raise exception 'La fecha hasta es anterior a desde';
  end if;
  if p_id is null then
    insert into insp_zona_inspectores (zona_id, usuario_id, rol, capacidad_diaria, desde, hasta)
    values (p_zona_id, p_usuario_id, p_rol, p_capacidad, p_desde, p_hasta) returning id into v_id;
  else
    update insp_zona_inspectores
    set zona_id = p_zona_id, usuario_id = p_usuario_id, rol = p_rol, capacidad_diaria = p_capacidad,
        desde = p_desde, hasta = p_hasta
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Asignación inexistente'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.insp_quitar_inspector(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not insp_es_admin() then raise exception 'Solo admin' using errcode = '42501'; end if;
  delete from insp_zona_inspectores where id = p_id;
end $$;

create or replace function public.insp_parametros_listado()
returns table (clave text, valor numeric, descripcion text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not insp_es_admin() then raise exception 'Solo admin' using errcode = '42501'; end if;
  return query select p.clave, p.valor, p.descripcion from insp_parametros p order by p.clave;
end $$;

create or replace function public.insp_guardar_parametro(p_clave text, p_valor numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not insp_es_admin() then raise exception 'Solo admin' using errcode = '42501'; end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'El valor tiene que ser mayor a 0'; end if;
  update insp_parametros set valor = p_valor, updated_at = now() where clave = p_clave;
  if not found then raise exception 'Parámetro inexistente: %', p_clave; end if;
end $$;


-- =====================================================================
-- 8. RLS Y PERMISOS
-- Tablas: RLS activo, lectura directa solo para admin, sin escritura desde la app (todo por RPC).
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['insp_parametros','insp_zonas','insp_ubicaciones','insp_zona_inspectores',
                           'insp_plan_semanal','insp_kpi_semanal'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.insp_es_admin()))',
                   t || '_sel', t);
  end loop;
end $$;

revoke all on function
  public.insp_param(text), public.insp_es_admin(), public.insp__puede_sistema(), public.insp__hoy(),
  public.insp__lunes(date), public.insp__ts(date), public.insp_estado_equipos(timestamptz),
  public.insp__vigentes(date), public.insp__refrescar_hechos(), public.insp_generar_plan(date, boolean),
  public.insp_mi_zona(), public.insp_mi_lista(), public.insp_panel_estado(), public.insp_cumplimiento(),
  public.insp_kpi_serie(), public.insp_carga_zonas(), public.insp_alertas(), public.insp_plan_detalle(date),
  public.insp_zonas_listado(), public.insp_ubicaciones_listado(), public.insp_guardar_ubicacion(text, boolean, uuid),
  public.insp_usuarios_activos(), public.insp_guardar_inspector(uuid, uuid, uuid, text, int, date, date),
  public.insp_quitar_inspector(uuid), public.insp_parametros_listado(), public.insp_guardar_parametro(text, numeric)
  from public, anon;

-- authenticated: solo las que validan adentro (o que solo devuelven datos del propio usuario)
grant execute on function
  public.insp_es_admin(), public.insp_generar_plan(date, boolean),
  public.insp_mi_zona(), public.insp_mi_lista(), public.insp_panel_estado(), public.insp_cumplimiento(),
  public.insp_kpi_serie(), public.insp_carga_zonas(), public.insp_alertas(), public.insp_plan_detalle(date),
  public.insp_zonas_listado(), public.insp_ubicaciones_listado(), public.insp_guardar_ubicacion(text, boolean, uuid),
  public.insp_usuarios_activos(), public.insp_guardar_inspector(uuid, uuid, uuid, text, int, date, date),
  public.insp_quitar_inspector(uuid), public.insp_parametros_listado(), public.insp_guardar_parametro(text, numeric)
  to authenticated, service_role;
-- helpers internos: sin acceso desde la API (las funciones SECURITY DEFINER los llaman como dueño)
revoke execute on function
  public.insp_param(text), public.insp__puede_sistema(), public.insp_estado_equipos(timestamptz),
  public.insp__vigentes(date), public.insp__refrescar_hechos()
  from authenticated;
grant execute on function public.insp_estado_equipos(timestamptz), public.insp_generar_plan(date, boolean)
  to service_role;


-- =====================================================================
-- 9. PG_CRON: todos los lunes 06:00 Asunción = 09:00 UTC (servidor en UTC, Paraguay UTC−3 fijo)
-- =====================================================================
select cron.unschedule('insp_generar_plan_semanal')
where exists (select 1 from cron.job where jobname = 'insp_generar_plan_semanal');
select cron.schedule('insp_generar_plan_semanal', '0 9 * * 1', $$select public.insp_generar_plan()$$);


-- =====================================================================
-- 10. LÍNEA BASE: foto de la semana actual aunque no haya plan (solo la primera vez)
-- =====================================================================
do $$
declare v_lunes date := public.insp__lunes(public.insp__hoy());
begin
  if exists (select 1 from public.insp_kpi_semanal where es_linea_base) then return; end if;
  insert into public.insp_kpi_semanal (semana, zona_id, universo, al_dia, vencidos, nunca, planificados, es_linea_base, foto_en)
  select v_lunes, g.zona_id, g.universo, g.al_dia, g.vencidos, g.nunca, 0, true, now()
  from (
    select z.id as zona_id, count(e.equipo_id) as universo,
           count(e.equipo_id) filter (where e.estado = 'al_dia') as al_dia,
           count(e.equipo_id) filter (where e.estado = 'vencido') as vencidos,
           count(e.equipo_id) filter (where e.estado = 'nunca') as nunca
    from public.insp_zonas z left join public.insp_estado_equipos(now()) e on e.zona_id = z.id
    where z.activa group by z.id
    union all
    select null, count(*), count(*) filter (where estado = 'al_dia'),
           count(*) filter (where estado = 'vencido'), count(*) filter (where estado = 'nunca')
    from public.insp_estado_equipos(now())
  ) g
  on conflict do nothing;
end $$;

-- Fin
