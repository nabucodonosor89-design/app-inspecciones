-- ============================================================
-- DESDE EL ÚLTIMO SERVICE — ficha de mantenimiento en la inspección + módulo de seguimiento
-- Aplicado en Supabase el 15/10/2026. Idempotente.
--
-- 1) La inspección guarda el contador y la fecha del último mantenimiento que figuran en la
--    ficha de mantenimiento (obligatorios si el ítem "Ficha de mantenimiento" está OK,
--    opcionales si está en aviso). Columnas nuevas en inspecciones.
-- 2) RPC service_desde_ultimo(): una fila por equipo "que sabemos que trabaja"
--    (carga de combustible o uso en el rastreo en los últimos 6 meses, o mantenimiento cargado)
--    con el último mantenimiento y el trabajo desde entonces por dos fuentes:
--      · por contador: última carga de combustible (sap_cargas_combustible.horometro) − contador del mantenimiento
--      · por rastreo: suma de horas_marcha, horas_ralenti y distancia_km de consumo_combustible (Monitor)
--        en los días POSTERIORES a la fecha del mantenimiento
--    Solo lectura. Acceso: usuarios.ve_completar_ordenes = true (mismo permiso que IP30).
--
-- Rastreo: consumo_combustible guarda horas/km diarios de todos los móviles de Monitor
-- desde el 26/08/2026 (los sin sensor de combustible se cargaron hacia atrás el 15/10/2026).
-- Nota: la primera versión se llamó service_seguimiento() (sin horas de ralentí). Quedó sin uso;
-- se puede borrar con: drop function public.service_seguimiento();
-- ============================================================

-- ------------------------------------------------------------
-- 1. Ficha de mantenimiento en la inspección
-- ------------------------------------------------------------
alter table public.inspecciones
  add column if not exists ficha_service_contador numeric,
  add column if not exists ficha_service_fecha date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inspecciones_ficha_service_chk') then
    alter table public.inspecciones add constraint inspecciones_ficha_service_chk
      check (ficha_service_contador is null or ficha_service_contador >= 0);  -- la fecha (no futura) la valida la app
  end if;
end $$;

comment on column public.inspecciones.ficha_service_contador is 'Horómetro/odómetro del último mantenimiento según la ficha de mantenimiento (cargado por el inspector)';
comment on column public.inspecciones.ficha_service_fecha is 'Fecha del último mantenimiento según la ficha de mantenimiento (cargada por el inspector)';

-- ------------------------------------------------------------
-- 2. Seguimiento desde el último mantenimiento
--    horas de marcha y de ralentí van separadas: el horómetro cuenta motor encendido (marcha + ralentí)
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
           i.ficha_service_fecha as fecha, i.ficha_service_contador as contador,
           i.fecha_hora as insp_fecha, u.nombre_completo as inspector
    from inspecciones i
    join equipos q on q.id = i.equipo_id
    left join usuarios u on u.id = i.inspector_id
    where i.ficha_service_fecha is not null and i.ficha_service_contador is not null
    order by upper(trim(q.numero_identificacion)), i.ficha_service_fecha desc, i.fecha_hora desc
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
    and (eq.equipo is not null or s.equipo is not null)  -- fuera motos/móviles de Monitor que no son equipos del IE36
  order by 1  -- orden estable: la app pagina de a 1000 filas
$$;

create or replace function public.service_frescura()
returns table (rastreo date, consumos timestamptz, ie36 timestamptz)
language sql stable security definer
set search_path = public
as $$
  select (select max(fecha) from consumo_combustible),
         (select max(procesado_en) from sap_ingestas where fuente = 'consumos'),
         (select max(procesado_en) from sap_ingestas where fuente = 'ie36')
  where puede_completar_ordenes()
$$;

revoke all on function public.service_desde_ultimo() from public, anon;
revoke all on function public.service_frescura()    from public, anon;
grant execute on function public.service_desde_ultimo() to authenticated;
grant execute on function public.service_frescura()    to authenticated;
