-- ============================================================
-- Bandeja de preventivos — fecha propuesta de reprogramación (MVP, 19/11/2026)
--
-- Para cada orden abierta cuya sugerencia es "reprogramado" (J > umbral), propone la nueva fecha
-- según el ritmo reciente del equipo:
--   ritmo   = avance por día en los últimos 14 días, en la unidad de la orden (h o km)
--             fuente: parte diario (pd_partes_vigentes, contador_fin, ≥ 5 días de rango)
--                     → rastreo (consumo_combustible horas_marcha / distancia_km + jd_horometro_diario, ÷ 14)
--                     → combustible (sap_cargas_combustible.horometro, ≥ 5 días de rango)
--   días    = ceil(70 % de lo que falta (J) ÷ ritmo), con tope 30 días
--   sin ritmo o ritmo 0 → 30 días (el tope)
--   fecha   = hoy (Asunción) + días
--
-- Premisas validadas con una prueba hacia atrás sobre 2026 (planilla «Seguimiento de Órdenes»):
-- con 70 % / tope 30 la orden vuelve ~2,8 veces hasta que el equipo llega (hoy ~5,1) y la fecha
-- queda tarde (> 7 días después de llegar) ~7 % de las veces (hoy ~4 %). Mismo criterio para obras lejanas.
-- Es una propuesta: la encargada la confirma o la cambia.
-- ============================================================

create or replace function public.ip30_fecha_propuesta()
returns table(orden bigint, equipo text, unidad text, falta numeric,
              ritmo numeric, ritmo_fuente text, dias integer, fecha_propuesta date)
language sql stable security definer set search_path to 'public'
as $function$
  with par as (select 14 as ventana, 0.7::numeric as factor, 30 as tope,
                      (now() at time zone 'America/Asuncion')::date as hoy),
  o as (
    select c.orden, c.equipo, c.unidad, c.j
    from ip30_calc() c
    where puede_completar_ordenes()
      and c.estado_sugerido = 'reprogramado' and c.j > 0
      and c.estado_sap not in ('CTEC', 'CERR')
  ),
  eqs as (select distinct o.equipo from o),
  pp as (  -- parte diario: contador del día, rango de la ventana
    select d.equipo, d.modo, max(d.fecha) - min(d.fecha) as span, max(d.c) - min(d.c) as avance
    from (
      select p.equipo, p.modo, p.fecha, max(p.contador_fin) as c
      from pd_partes_vigentes p cross join par
      where p.valido and p.contador_fin is not null and p.modo in ('h', 'km')
        and p.fecha between par.hoy - par.ventana and par.hoy
        and p.equipo in (select equipo from eqs)
      group by 1, 2, 3
    ) d
    group by 1, 2
  ),
  rg as (  -- rastreo: horas de marcha / km por día (GPS) + horómetro John Deere
    select r.eq, sum(r.h) as h, sum(r.km) as km
    from (
      select c.nombre_movil as eq, coalesce(c.horas_marcha, 0) as h, coalesce(c.distancia_km, 0) as km
      from consumo_combustible c cross join par
      where c.fecha >= par.hoy - par.ventana and c.fecha < par.hoy
        and c.nombre_movil in (select equipo from eqs)
      union all
      select upper(trim(d.equipo)), d.horas_dia, 0
      from jd_horometro_diario d cross join par
      where d.fecha >= par.hoy - par.ventana and d.fecha < par.hoy
        and upper(trim(d.equipo)) in (select equipo from eqs)
    ) r
    group by 1
  ),
  cc as (  -- cargas de combustible SAP: horómetro / odómetro informado en la carga
    select upper(trim(c.equipo)) as eq, max(c.fecha) - min(c.fecha) as span, max(c.horometro) - min(c.horometro) as avance
    from sap_cargas_combustible c cross join par
    where c.horometro > 0 and c.fecha between par.hoy - par.ventana and par.hoy
      and upper(trim(c.equipo)) in (select equipo from eqs)
    group by 1
  ),
  r as (
    select o.*,
      case when pp.span >= 5 then pp.avance / pp.span end as r_parte,
      case when rg.eq is not null then (case when o.unidad = 'km' then rg.km else rg.h end) / par.ventana end as r_gps,
      case when cc.span >= 5 then cc.avance / cc.span end as r_comb
    from o
    cross join par
    left join pp on pp.equipo = o.equipo and pp.modo = o.unidad
    left join rg on rg.eq = o.equipo
    left join cc on cc.eq = o.equipo
  ),
  x as (
    select r.*, coalesce(r.r_parte, r.r_gps, r.r_comb) as rate,
      case when r.r_parte is not null then 'parte' when r.r_gps is not null then 'rastreo'
           when r.r_comb is not null then 'combustible' end as fuente
    from r
  )
  select x.orden, x.equipo, x.unidad, x.j, round(x.rate, 2), x.fuente,
         d.dias, par.hoy + d.dias
  from x
  cross join par
  cross join lateral (
    select case when x.rate > 0 then least(greatest(ceil(x.j * par.factor / x.rate)::int, 1), par.tope)
                else par.tope end as dias
  ) d
  order by x.orden
$function$;

revoke all on function public.ip30_fecha_propuesta() from public, anon;
grant execute on function public.ip30_fecha_propuesta() to authenticated, service_role;
