-- ============================================================
-- CORRECTIVOS — fusión de las pestañas Reunión y Seguimiento (23/11/2026)
-- Spec: prompt-cowork-correctivos-reunion-seguimiento-fusion.md (proyecto Claude)
--
-- 1. Rendimiento: corr.par_reservas reescrita (mismo resultado, 0 diferencias).
--    Antes calculaba el stock de TODAS las reservas pendientes de SAP (~8.600)
--    con subconsultas correlacionadas y después se quedaba con las de órdenes
--    abiertas (~300): par_ordenes ~4,7 s y v_correctivos_parados hasta ~16 s.
-- 2. El freno por orden ya estaba separado en corr.par_ordenes (todas las
--    órdenes abiertas, paradas o no). No se cambia la regla ni v_correctivos_parados.
-- 3. RPC nueva corr_equipos_seguimiento(): una fila por equipo con TODAS sus
--    órdenes y avisos abiertos en items (jsonb). Sin "peor situación".
-- 4. Migración idempotente de correctivos_tareas a novedades.
-- Idempotente: se puede correr varias veces.
-- ============================================================

-- ------------------------------------------------------------
-- 1. corr.par_reservas sin subconsultas correlacionadas
-- ------------------------------------------------------------
create or replace view corr.par_reservas as
with ab as (
  select orden, equipo from corr.par_ordenes_abiertas
), r as (
  select r.orden, a.equipo, r.posicion, r.material, r.descripcion, r.cantidad_pendiente, r.unidad, r.centro
  from sap_reservas_pos r
  join ab a on a.orden = r.orden
  where r.cantidad_pendiente > 0
), st as (
  -- último corte por material y centro (misma regla que corr.par_stock), solo materiales reservados
  select distinct on (s.material, s.centro) s.material, s.centro, coalesce(s.stock_cierre, 0) as stock
  from sap_stock s
  where s.material in (select material from r)
  order by s.material, s.centro, s.a_fecha desc
), tot as (
  select material, sum(stock) as stock_total from st where stock > 0 group by material
)
select r.orden,
       r.equipo,
       r.posicion,
       r.material,
       r.descripcion,
       r.cantidad_pendiente,
       r.unidad,
       r.centro as centro_reserva,
       inv.centro as centro_equipo,
       coalesce(t.stock_total, 0::numeric) as stock_total,
       coalesce(sc.stock, 0::numeric) as stock_centro_equipo
from r
left join corr.par_inventario inv on inv.equipo = r.equipo
left join tot t on t.material = r.material
left join st sc on sc.material = r.material and sc.centro = inv.centro and sc.stock > 0;

-- ------------------------------------------------------------
-- 2. RPC corr_equipos_seguimiento(): una fila por equipo
--    Universo: equipos con hilos abiertos (corr_seguimientos no terminados)
--              + equipos parados de corr.par_equipos (aunque no tengan hilo).
--    items: TODAS las órdenes y avisos abiertos del equipo, uno por elemento:
--      - cada hilo abierto (con su última novedad, alertas y freno)
--      - las órdenes SAP / avisos de la app de corr.par_equipos que todavía no tienen hilo
--        (sin_hilo = true: no se les puede cargar novedad).
--    Manda la situación cargada a mano; el freno es solo etiqueta. No hay "peor situación".
--    Reusa corr_seg_listar() (mismas alertas) y corr.par_ordenes (mismo freno que Reunión).
-- ------------------------------------------------------------
create or replace function public.corr_equipos_seguimiento()
returns table (
  equipo text, denominacion text, ubicacion text, centro text,
  cant_ordenes int, cant_avisos int, cant_avisos_app int, cant_sin_hilo int,
  parado boolean, estado_actividad text, parado_desde date, dias_parado int, motivo_parado text,
  alertas text[], dias_sin_novedad int, ult_novedad_en timestamptz,
  items jsonb
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not exists (
    select 1 from usuarios u
    where u.email = auth.email() and u.activo = true and (u.rol = 'admin' or u.ve_correctivos = true)
  ) then
    raise exception 'Sin permiso para ver Correctivos' using errcode = '42501';
  end if;

  return query
  with h as (
    select l.* from corr_seg_listar() l where not l.terminado
  ),
  pe as (
    select * from corr.par_equipos
  ),
  po as (
    select o.orden, o.freno from corr.par_ordenes o
  ),
  it_hilos as (
    select h.equipo as eq,
           (h.orden is not null) as es_orden,
           h.alertas as al,
           h.dias_sin_novedad as dsn,
           h.ult_fecha as uf,
           jsonb_build_object(
             'seguimiento_id', h.id,
             'tipo', case when h.orden is not null then 'orden' else 'aviso' end,
             'origen', h.origen,
             'orden', h.orden,
             'aviso', h.aviso,
             'texto', h.descripcion,
             'status_sap', h.status_usuario,
             'abierta_sap', h.abierta_sap,
             'fecha_entrada', h.fecha_entrada,
             'dias_abierta', h.dias_abierta,
             'situacion', h.ult_situacion,
             'ult_texto', h.ult_texto,
             'ult_fecha', h.ult_fecha,
             'ult_autor', h.ult_autor,
             'responsable', h.ult_responsable,
             'compromiso', h.ult_compromiso,
             'cant_novedades', h.cant_novedades,
             'dias_sin_novedad', h.dias_sin_novedad,
             'alertas', to_jsonb(h.alertas),
             'freno', case when h.orden is null then 'generar_orden' else po.freno end,
             'sin_hilo', false
           ) as item,
           (h.alertas && array['compromiso_vencido','cerrada_sap_con_seguimiento','otes_con_trabajo']) as roja,
           h.fecha_entrada as fe
    from h
    left join po on po.orden = h.orden
  ),
  universo as (
    select distinct x.eq from (
      select ih.eq from it_hilos ih
      union
      select p.equipo from pe p where p.estado_actividad = 'parado'
    ) x
  ),
  it_sin_hilo as (
    -- órdenes SAP y avisos de la app de par_equipos que no tienen hilo de seguimiento
    select p.equipo as eq,
           (e->>'orden') is not null as es_orden,
           jsonb_build_object(
             'seguimiento_id', null,
             'tipo', case when (e->>'orden') is not null then 'orden' else 'aviso' end,
             'origen', e->>'origen',
             'orden', (e->>'orden')::bigint,
             'aviso', e->>'aviso',
             'texto', e->>'texto',
             'status_sap', e->>'status_usuario',
             'abierta_sap', case when (e->>'orden') is not null then true end,
             'fecha_entrada', e->>'fecha_entrada',
             'situacion', null,
             'alertas', '[]'::jsonb,
             'freno', e->>'freno',
             'sin_hilo', true
           ) as item,
           (e->>'fecha_entrada')::date as fe
    from pe p
    join universo u on u.eq = p.equipo
    cross join lateral jsonb_array_elements(p.ordenes) e
    where not exists (
      select 1 from h
      where ((e->>'orden') is not null and h.orden = (e->>'orden')::bigint)
         or ((e->>'orden') is null and (e->>'aviso') is not null and h.aviso::text = (e->>'aviso'))
    )
  ),
  todos as (
    select ih.eq, ih.es_orden, ih.item, ih.roja, ih.fe, false as sin_hilo from it_hilos ih
    union all
    select s.eq, s.es_orden, s.item, false, s.fe, true from it_sin_hilo s
  ),
  agg as (
    select t.eq,
           jsonb_agg(t.item order by t.roja desc, t.sin_hilo, t.fe asc nulls last) as items,
           count(*) filter (where t.es_orden)::int as n_ord,
           count(*) filter (where not t.es_orden)::int as n_av,
           count(*) filter (where t.sin_hilo)::int as n_sin
    from todos t
    group by t.eq
  ),
  agg_h as (
    select ih.eq,
           array(select distinct a from unnest(array_agg_flat) a order by a) as al,
           dsn, uf
    from (
      select ih.eq, max(ih.dsn) as dsn, max(ih.uf) as uf,
             array_agg(a) filter (where a is not null) as array_agg_flat
      from it_hilos ih
      left join lateral unnest(ih.al) a on true
      group by ih.eq
    ) ih
  )
  select u.eq,
         coalesce(inv.denominacion, p.denominacion),
         coalesce(inv.ubicacion, p.ubicacion, 'Sin ubicación'),
         coalesce(inv.centro, p.centro),
         coalesce(a.n_ord, 0),
         coalesce(a.n_av, 0),
         coalesce(p.cant_avisos_app, 0)::int,
         coalesce(a.n_sin, 0),
         coalesce(p.estado_actividad = 'parado', false),
         p.estado_actividad,
         p.parado_desde,
         p.dias_parado::int,
         p.motivo_parado,
         coalesce(ah.al, '{}'::text[]),
         ah.dsn,
         ah.uf,
         coalesce(a.items, '[]'::jsonb)
  from universo u
  left join agg a on a.eq = u.eq
  left join agg_h ah on ah.eq = u.eq
  left join pe p on p.equipo = u.eq
  left join corr.par_inventario inv on inv.equipo = u.eq;
end;
$$;

revoke all on function public.corr_equipos_seguimiento() from public, anon;
grant execute on function public.corr_equipos_seguimiento() to authenticated;

-- ------------------------------------------------------------
-- 3. Migración de correctivos_tareas → novedades (idempotente)
--    correctivos_tareas NO se modifica: el control va en una tabla de log aparte.
--    Hilo destino: el de la orden de la tarea; si no tiene (o no hay hilo para esa orden),
--    el primer hilo abierto del equipo. Sin hilo abierto → no se migra y se informa.
-- ------------------------------------------------------------
create table if not exists public.corr_tareas_migradas (
  tarea_id   uuid primary key references public.correctivos_tareas(id),
  novedad_id uuid not null references public.corr_novedades(id),
  migrado_en timestamptz not null default now()
);
alter table public.corr_tareas_migradas enable row level security;  -- sin políticas: solo SQL / service_role

with t as (
  select t.*,
         coalesce(
           (select s.id from corr_seguimientos s where t.orden is not null and s.orden = t.orden and not s.terminado limit 1),
           (select s.id from corr_seguimientos s where s.equipo = t.equipo and not s.terminado order by s.creado_en, s.id limit 1)
         ) as hilo,
         exists (select 1 from corr_seguimientos s where t.orden is not null and s.orden = t.orden and not s.terminado) as hilo_de_su_orden
  from correctivos_tareas t
  where not exists (select 1 from corr_tareas_migradas m where m.tarea_id = t.id)
), ins as (
  insert into corr_novedades (id, seguimiento_id, texto, situacion, responsable_id, fecha_compromiso, autor, creado_en)
  select gen_random_uuid(), t.hilo,
         '[Tarea migrada] ' || t.descripcion
           || ' · objetivo ' || to_char(t.fecha_objetivo, 'DD/MM')
           || case when t.orden is not null and not t.hilo_de_su_orden then ' · orden ' || t.orden else '' end
           || case when t.estado = 'hecha' then ' · hecha ' || to_char(t.cerrado_en at time zone 'America/Asuncion', 'DD/MM') else '' end,
         'diagnostico', null, null, t.creado_por, t.creado_en
  from t where t.hilo is not null
  returning id, seguimiento_id, creado_en, autor
)
insert into corr_tareas_migradas (tarea_id, novedad_id)
select t.id, ins.id
from ins join t on t.hilo = ins.seguimiento_id and t.creado_en = ins.creado_en and t.creado_por is not distinct from ins.autor;

-- Resultado: migradas y no migradas (sin hilo abierto)
select t.id, t.equipo, t.orden, t.descripcion, m.novedad_id, n.seguimiento_id,
       case when m.tarea_id is null then 'NO MIGRADA: el equipo no tiene hilo abierto' else 'migrada' end as resultado
from correctivos_tareas t
left join corr_tareas_migradas m on m.tarea_id = t.id
left join corr_novedades n on n.id = m.novedad_id
order by t.creado_en;
