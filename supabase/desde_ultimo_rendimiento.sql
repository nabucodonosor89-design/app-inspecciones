-- ============================================================
-- DESDE EL ÚLTIMO MANTENIMIENTO — rendimiento (06/11/2026). Aplicado en Supabase.
-- Problema: la pantalla se cortaba con 57014 "canceling statement due to statement timeout" (límite 8 s de
-- authenticated). mantenimiento_seguimiento_v3() tardaba 3–5 s en frío y pasaba los 8 s con carga.
-- Causas: (1) el estimado IP30 del 05/11 recorría est_lec (~21.000 lecturas) con subconsultas correlacionadas,
-- varias veces por equipo (~1,7 s); (2) el último parte de v3 agrupaba TODOS los partes de cada equipo (~3 s).
-- Arreglo, sin cambiar resultados (comparado fila por fila: 388 = 388, 0 diferencias, 34 estimados):
--   * est / est_agg / est_fecha: agregados agrupados en vez de subconsultas correlacionadas.
--   * v3: primero ubica el día (índice) y agrupa solo ese día.
--   * índices parciales pd_partes_ult_modo_idx y pd_partes_ult_idx (partes válidos y no eliminados).
-- Resultado: v3 ~0,3 s (antes ~4,6 s).
-- Incluye el filtro del 04/11 (PI-, BM-DA, BM-RM, ST-CL fuera) y el de estáticos del 29/10.
-- ============================================================
create index if not exists pd_partes_ult_modo_idx on public.pd_partes (equipo, modo, fecha) include (contador_fin)
  where valido and eliminado_en is null;
create index if not exists pd_partes_ult_idx on public.pd_partes (equipo, fecha) include (modo, contador_fin)
  where valido and eliminado_en is null;
CREATE OR REPLACE FUNCTION public.mantenimiento_seguimiento()
 RETURNS TABLE(equipo text, denominacion text, ubicacion text, periodo numeric, periodo_unidad text, service_fecha date, service_contador numeric, service_inspeccion_fecha timestamp with time zone, service_inspector text, carga_lectura numeric, carga_fecha date, por_contador numeric, tiene_rastreo boolean, rastreo_desde date, rastreo_completo boolean, rastreo_horas numeric, rastreo_ralenti numeric, rastreo_km numeric, rastreo_ultimo_dia date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    from equipos q where q.periodo_mtto is not null
    order by upper(trim(q.numero_identificacion)), q.activo desc, q.periodo_mtto_actualizado_en desc nulls last
  ),
  srv_real as (
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

  -- 05/11/2026: equipos sin service real -> último estimado desde la última orden IP30 con PROX MANT.
  -- Orden concluida (confirmada en la app, o CTEC/CERR en SAP y no cancelada): último = PROX de esa orden.
  -- Orden pendiente: último = PROX - período.
  -- Fecha = primera lectura >= estimado posterior a la última lectura < estimado (cargas SAP + partes).
  -- No se estima si: estimado < 0, sin lectura, lectura actual < estimado, lectura - estimado > 2 períodos,
  -- o no hay lectura por debajo del estimado (mantenimiento anterior a los datos), salvo estimado = 0.
  -- 06/11/2026: mismo resultado, pero con agregados agrupados en vez de subconsultas correlacionadas
  -- sobre est_lec (antes ~1,7 s y la pantalla se cortaba por statement_timeout de 8 s).
  ip30_prox as (
    select distinct on (upper(trim(o.equipo)))
           upper(trim(o.equipo)) as equipo, o.orden, o.prox_mantto, coalesce(o.ultima_carga, o.primera_carga) as cargado,
           (coalesce(o.estado_confirmado, '') = 'concluido'
            or (coalesce(so.status_sistema, '') ~ '\m(CTEC|CERR)\M' and coalesce(o.estado_confirmado, '') <> 'cancelado')) as hecha
    from ip30_ordenes o
    left join sap_ordenes so on so.orden = o.orden
    where o.prox_mantto is not null and coalesce(trim(o.equipo), '') <> ''
    order by upper(trim(o.equipo)), o.fecha_plan desc nulls last, o.orden desc
  ),
  est_base as materialized (
    select o.equipo, o.orden, o.hecha, o.prox_mantto, o.cargado, per.periodo_mtto, per.periodo_mtto_unidad,
           case when o.hecha then o.prox_mantto else o.prox_mantto - per.periodo_mtto end as contador
    from ip30_prox o
    join per on per.equipo = o.equipo
    where not exists (select 1 from srv_real r where r.equipo = o.equipo)
  ),
  carga as materialized (
    select distinct on (upper(trim(c.equipo)))
           upper(trim(c.equipo)) as equipo, c.horometro as lectura, c.fecha
    from sap_cargas_combustible c
    where c.horometro > 0 and c.fecha is not null
    order by upper(trim(c.equipo)), c.fecha desc, c.horometro desc
  ),
  est_lec as materialized (
    select b.equipo, b.contador, c.fecha, c.horometro as v
    from est_base b join sap_cargas_combustible c on upper(trim(c.equipo)) = b.equipo
    where c.horometro > 0 and c.fecha is not null
    union all
    select b.equipo, b.contador, p.fecha, p.contador_fin
    from est_base b join pd_partes_vigentes p on p.equipo = b.equipo and p.modo = b.periodo_mtto_unidad
    where p.valido and p.contador_fin is not null
  ),
  est_agg as (
    select l.equipo, max(l.v) as lec_max, max(l.fecha) filter (where l.v < l.contador) as ult_debajo
    from est_lec l group by l.equipo
  ),
  est as materialized (
    select b.*, coalesce(c.lectura, a.lec_max) as lect, a.ult_debajo
    from est_base b
    left join carga c on c.equipo = b.equipo
    left join est_agg a on a.equipo = b.equipo
  ),
  est_fecha as (
    select l.equipo, min(l.fecha) as fecha
    from est_lec l join est e on e.equipo = l.equipo
    where l.v >= e.contador and l.fecha > coalesce(e.ult_debajo, '1900-01-01'::date)
    group by l.equipo
  ),
  srv_est as (
    select e.equipo, f.fecha,
           e.contador, e.cargado as insp_fecha,
           case when e.hecha
             then 'ESTIMADO IP30 (orden ' || e.orden || ' concluida a ' || replace(trim(to_char(e.prox_mantto, 'FM999,999,990')), ',', '.') || ')'
             else 'ESTIMADO IP30 (próx. ' || replace(trim(to_char(e.prox_mantto, 'FM999,999,990')), ',', '.') || ' − período ' || replace(trim(to_char(e.periodo_mtto, 'FM999,999,990')), ',', '.') || ')'
           end as inspector
    from est e
    left join est_fecha f on f.equipo = e.equipo
    where e.contador >= 0 and e.lect is not null and e.lect >= e.contador
      and e.lect - e.contador <= 2 * e.periodo_mtto
      and (e.ult_debajo is not null or e.contador = 0)
  ),
  srv as materialized (
    select * from srv_real
    union all
    select * from srv_est where fecha is not null
  ),
  -- Una sola pasada sobre consumo_combustible: normaliza el nombre una vez y calcula todo.
  cc as materialized (
    select upper(trim(r.nombre_movil)) as equipo, r.fecha, r.horas_marcha, r.horas_ralenti, r.distancia_km
    from consumo_combustible r
    where coalesce(trim(r.nombre_movil), '') <> ''
  ),
  ras as (
    select cc.equipo, min(cc.fecha) as desde, max(cc.fecha) as hasta,
           bool_or(cc.fecha >= current_date - interval '6 months' and (cc.horas_marcha > 0 or cc.distancia_km > 0)) as uso_6m
    from cc group by 1
  ),
  -- 02/11/2026: acumulados post-service en un join agregado (antes: 3 subconsultas correlacionadas por equipo)
  ras_post as (
    select cc.equipo, coalesce(sum(cc.horas_marcha),0) as horas, coalesce(sum(cc.horas_ralenti),0) as ralenti, coalesce(sum(cc.distancia_km),0) as km
    from cc join srv s on s.equipo = cc.equipo and cc.fecha > s.fecha
    group by 1
  ),
  jdd as materialized (
    select upper(trim(d.equipo)) as equipo, d.fecha, d.horometro_fin, d.horas_dia
    from jd_horometro_diario d where coalesce(trim(d.equipo), '') <> ''
  ),
  jd as (
    select jdd.equipo, min(jdd.fecha) as desde, max(jdd.fecha) as hasta,
           (array_agg(jdd.horometro_fin order by jdd.fecha desc))[1] as lectura
    from jdd group by 1
  ),
  jd_post as (
    select jdd.equipo, coalesce(sum(jdd.horas_dia),0) as horas
    from jdd join srv s on s.equipo = jdd.equipo and jdd.fecha > s.fecha
    group by 1
  ),
  universo as (
    select upper(trim(c.equipo)) as equipo from sap_cargas_combustible c
      where c.fecha >= current_date - interval '6 months'
    union select equipo from ras where uso_6m
    union select equipo from srv
    union select equipo from per
    union select equipo from jd
  )
  select u.equipo, eq.denominacion, eq.ubicacion,
         per.periodo_mtto, per.periodo_mtto_unidad,
         s.fecha, s.contador, s.insp_fecha, s.inspector,
         c.lectura, c.fecha,
         case when s.contador is not null and c.lectura is not null then c.lectura - s.contador end,
         (ras.equipo is not null or jd.equipo is not null),
         coalesce(jd.desde, ras.desde),
         case when s.fecha is null then null
              when jd.equipo is not null then (s.contador is not null or s.fecha >= jd.desde - 1)
              when ras.equipo is null then null
              else s.fecha >= ras.desde - 1 end,
         case when s.fecha is not null and jd.equipo is not null then coalesce(jd.lectura - s.contador, jp.horas, 0)
              when s.fecha is not null and ras.equipo is not null then coalesce(rp.horas, 0) end,
         case when jd.equipo is not null then null
              when s.fecha is not null and ras.equipo is not null then coalesce(rp.ralenti, 0) end,
         case when s.fecha is not null and jd.equipo is not null then 0
              when s.fecha is not null and ras.equipo is not null then coalesce(rp.km, 0) end,
         coalesce(jd.hasta, ras.hasta)
  from (select distinct equipo from universo where coalesce(equipo, '') <> '' and equipo !~ '^(PI-|BM-DA|BM-RM|ST-CL)') u  -- 04/11/2026: plantas PI, dragas BM-DA y remolcadores BM-RM y calderas ST-CL fuera del seguimiento
  left join eq on eq.equipo = u.equipo
  left join per on per.equipo = u.equipo
  left join srv s on s.equipo = u.equipo
  left join carga c on c.equipo = u.equipo
  left join ras on ras.equipo = u.equipo
  left join ras_post rp on rp.equipo = u.equipo
  left join jd on jd.equipo = u.equipo
  left join jd_post jp on jp.equipo = u.equipo
  where puede_completar_ordenes()
    and (eq.equipo is not null or s.equipo is not null or per.equipo is not null)
  order by 1
$function$;
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
  -- Último parte: el día más reciente en el modo del período (h/km); si no hay en ese modo, el día más
  -- reciente en cualquier modo. Contador = máximo del día. 06/11/2026: se ubica primero el día con
  -- índice (pd_partes_ult_idx) y se agrupa solo ese día (antes agrupaba todos los partes del equipo).
  left join lateral (
    select g.modo, g.fecha, g.contador
    from (
      select p.modo, p.fecha, max(p.contador_fin) as contador,
             (p.modo is not distinct from t.periodo_unidad) as pref
      from pd_partes_vigentes p
      where p.valido and p.equipo = t.equipo
        and p.fecha = coalesce(
              case when t.periodo_unidad is null
                   then (select max(p1.fecha) from pd_partes_vigentes p1 where p1.valido and p1.equipo = t.equipo and p1.modo is null)
                   else (select max(p1.fecha) from pd_partes_vigentes p1 where p1.valido and p1.equipo = t.equipo and p1.modo = t.periodo_unidad)
              end,
              (select max(p2.fecha) from pd_partes_vigentes p2 where p2.valido and p2.equipo = t.equipo))
      group by p.modo, p.fecha
    ) g
    order by g.pref desc, g.contador desc
    limit 1
  ) pd on true
  where not exists (select 1 from estaticos z where z.equipo = t.equipo)
    and t.equipo !~ '^(PI-|BM-DA|BM-RM|ST-CL)'  -- 04/11/2026: plantas PI, dragas BM-DA y remolcadores BM-RM y calderas ST-CL fuera del seguimiento
  order by 1
$function$;
revoke all on function public.mantenimiento_seguimiento() from public, anon;
grant execute on function public.mantenimiento_seguimiento() to authenticated, service_role;
revoke all on function public.mantenimiento_seguimiento_v3() from public, anon;
grant execute on function public.mantenimiento_seguimiento_v3() to authenticated, service_role;
drop function if exists public._mseg_v3_nuevo();
drop function if exists public._mseg_nuevo();
