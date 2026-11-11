-- ============================================================
-- DESDE EL ÚLTIMO MANTENIMIENTO — sin equipos estáticos (29/10/2026). Aplicado en Supabase.
-- mantenimiento_seguimiento_v3() excluye los estáticos: tipo_equipo = 'S' en equipos (app) o en sap_equipos.
-- Motivo: 13 contenedores ST-CN aparecían con un "mantenimiento" de contador 0 cargado desde inspecciones
-- anteriores al checklist de estáticos. No tienen horómetro ni mantenimiento preventivo.
-- Las calderas ST-CL (tipo P, con partes diarios) siguen apareciendo.
-- Misma definición que la versión en vivo (lee pd_partes_vigentes) + CTE estaticos + filtro final.
-- ============================================================
CREATE OR REPLACE FUNCTION public.mantenimiento_seguimiento_v3()
 RETURNS TABLE(equipo text, denominacion text, ubicacion text, periodo numeric, periodo_unidad text, service_fecha date, service_contador numeric, service_inspeccion_fecha timestamp with time zone, service_inspector text, carga_lectura numeric, carga_fecha date, por_contador numeric, tiene_rastreo boolean, rastreo_desde date, rastreo_completo boolean, rastreo_horas numeric, rastreo_ralenti numeric, rastreo_km numeric, rastreo_ultimo_dia date, pd_modo text, pd_fecha date, pd_contador numeric, por_parte numeric, service_contador_estado text, service_orden bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with base as (select * from mantenimiento_seguimiento()),
  pd_uso as (
    select distinct p.equipo from pd_partes_vigentes p
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
  -- Estáticos (contenedores, tanques, casetas): tipo S en la app o en SAP. No tienen horómetro ni mantenimiento.
  estaticos as (
    select upper(trim(numero_identificacion)) as equipo from equipos where tipo_equipo = 'S'
    union
    select upper(trim(equipo)) from sap_equipos where tipo_equipo = 'S'
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
    from pd_partes_vigentes p
    where p.valido and p.equipo = t.equipo
    group by p.modo, p.fecha
    order by (p.modo is not distinct from t.periodo_unidad) desc, p.fecha desc, max(p.contador_fin) desc
    limit 1
  ) pd on true
  where not exists (select 1 from estaticos z where z.equipo = t.equipo)
  order by 1
$function$;
revoke all on function public.mantenimiento_seguimiento_v3() from public, anon;
grant execute on function public.mantenimiento_seguimiento_v3() to authenticated;
