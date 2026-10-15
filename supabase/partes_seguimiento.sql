-- ============================================================
-- "Desde el último mantenimiento" v2: suma los PARTES DIARIOS como tercera referencia.
-- Aplicado en Supabase el 15/10/2026. Reemplaza a mantenimiento_seguimiento() en la app
-- (la vieja queda viva porque las migraciones con DROP las cancela el guard).
--
-- Columnas nuevas:
--   pd_modo, pd_fecha, pd_contador → última lectura VÁLIDA de los partes (pd_contador_diario)
--      · si el equipo tiene período, se usa el modo de la unidad del período (h→horómetro, km→odómetro)
--      · si no, el modo con la lectura más reciente
--   por_parte → pd_contador − contador del último mantenimiento (solo si la lectura es posterior o
--      del mismo día que el mantenimiento)
-- Universo: se agregan los equipos con partes válidos con avance en los últimos 6 meses.
-- ============================================================
create or replace function public.mantenimiento_seguimiento_v2()
returns table(equipo text, denominacion text, ubicacion text, periodo numeric, periodo_unidad text,
  service_fecha date, service_contador numeric, service_inspeccion_fecha timestamptz, service_inspector text,
  carga_lectura numeric, carga_fecha date, por_contador numeric,
  tiene_rastreo boolean, rastreo_desde date, rastreo_completo boolean, rastreo_horas numeric,
  rastreo_ralenti numeric, rastreo_km numeric, rastreo_ultimo_dia date,
  pd_modo text, pd_fecha date, pd_contador numeric, por_parte numeric)
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
    -- equipos que solo aparecen por partes (mismo armado que la base, sin service/carga/rastreo)
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
  pd as (
    select distinct on (d.equipo) d.equipo, d.modo, d.fecha, d.contador
    from pd_contador_diario d
    join todo t on t.equipo = d.equipo
    order by d.equipo, (d.modo is not distinct from t.periodo_unidad) desc, d.fecha desc, d.contador desc
  )
  select t.*, pd.modo, pd.fecha, pd.contador,
         case when t.service_contador is not null and pd.contador is not null and pd.fecha >= t.service_fecha
              then pd.contador - t.service_contador end
  from todo t
  left join pd on pd.equipo = t.equipo
  order by 1
$$;
revoke all on function public.mantenimiento_seguimiento_v2() from public, anon;
grant execute on function public.mantenimiento_seguimiento_v2() to authenticated;
