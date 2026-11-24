-- ============================================================
-- CORRECTIVOS → Seguimiento: marcar órdenes en TALLER EXTERNO (24/11/2026)
-- Una orden/aviso va a taller tercerizado si tiene un correctivo abierto en la app
-- (Mantenimientos, Taller Espera/Entrada) con ingresa_taller_ypane = false.
-- Se vincula por N° de orden o de aviso (corr_norm). Al pasar a Taller Salida deja de marcarse.
-- Regla de Andrés: todo lo que va a un tercero se registra en la app; si no está cargado, no se marca.
-- corr_equipos_seguimiento() suma items[].taller_externo (nombre del taller) y la columna
-- cant_taller_externo. Cambia el tipo de retorno → drop + create.
-- ============================================================

drop function if exists public.corr_equipos_seguimiento();

create or replace function public.corr_equipos_seguimiento()
returns table (
  equipo text, denominacion text, ubicacion text, centro text,
  cant_ordenes int, cant_avisos int, cant_avisos_app int, cant_sin_hilo int,
  parado boolean, estado_actividad text, parado_desde date, dias_parado int, motivo_parado text,
  alertas text[], dias_sin_novedad int, ult_novedad_en timestamptz,
  items jsonb,
  cant_taller_externo int
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
  -- Correctivos abiertos de la app (Espera/Entrada) que NO ingresan al taller de Ypané:
  -- van a un taller tercerizado (gestión exclusiva de TyE). Se vinculan por orden o aviso.
  ext as (
    select corr_norm(m.numero_orden) as o_n, corr_norm(m.numero_aviso) as a_n,
           coalesce(nullif(trim(m.taller_tercero), ''), 'sin nombre') as taller
    from mantenimientos m
    where m.tipo_mantenimiento = 'Correctivo'
      and m.estado in ('Taller Espera', 'Taller Entrada')
      and m.ingresa_taller_ypane = false
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
             'taller_externo', (select x.taller from ext x
                                where (h.orden is not null and x.o_n = h.orden::text)
                                   or (h.aviso is not null and x.a_n = h.aviso::text) limit 1),
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
             'taller_externo', (select x.taller from ext x
                                where ((e->>'orden') is not null and x.o_n = corr_norm(e->>'orden'))
                                   or ((e->>'aviso') is not null and x.a_n = corr_norm(e->>'aviso')) limit 1),
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
           count(*) filter (where t.sin_hilo)::int as n_sin,
           count(*) filter (where t.item->>'taller_externo' is not null)::int as n_ext
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
         coalesce(a.items, '[]'::jsonb),
         coalesce(a.n_ext, 0)
  from universo u
  left join agg a on a.eq = u.eq
  left join agg_h ah on ah.eq = u.eq
  left join pe p on p.equipo = u.eq
  left join corr.par_inventario inv on inv.equipo = u.eq;
end;
$$;

revoke all on function public.corr_equipos_seguimiento() from public, anon;
grant execute on function public.corr_equipos_seguimiento() to authenticated;
