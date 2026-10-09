-- Historial equipo -> órdenes -> componentes (YA APLICADO en Supabase el 09/10/2026; este archivo es solo referencia)
create or replace function public.puede_ver_historial() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuarios where email = auth.email() and activo = true and rol = 'admin')
$$;

create index if not exists sap_ordenes_equipo_idx on public.sap_ordenes (equipo, fecha_entrada desc);

create or replace function public.historial_equipo_ordenes(p_equipo text)
returns table (orden bigint, clase_orden text, fecha_entrada date, fecha_fin_real date, texto text,
               status_sistema text, cerrada boolean, n_materiales int, n_consumidos int)
language sql stable security definer set search_path = public as $$
  select o.orden, o.clase_orden, o.fecha_entrada, o.fecha_fin_real, o.texto, o.status_sistema,
         (o.status_sistema like 'CTEC%' or o.status_sistema like '%CERR%') as cerrada,
         count(p.posicion)::int,
         count(p.posicion) filter (where p.cantidad_necesaria > coalesce(p.cantidad_pendiente,0))::int
  from sap_ordenes o
  left join sap_reservas_pos p on p.orden = o.orden
  where puede_ver_historial() and o.equipo = upper(trim(p_equipo))
  group by o.orden
  order by o.fecha_entrada desc nulls last, o.orden desc
  limit 1000
$$;

create or replace function public.historial_orden_componentes(p_orden bigint)
returns table (posicion int, material text, descripcion text, cantidad_necesaria numeric,
               cantidad_usada numeric, cantidad_pendiente numeric, unidad text, fecha_necesidad date)
language sql stable security definer set search_path = public as $$
  select p.posicion, p.material, p.descripcion, p.cantidad_necesaria,
         greatest(p.cantidad_necesaria - coalesce(p.cantidad_pendiente,0), 0),
         p.cantidad_pendiente, p.unidad, p.fecha_necesidad
  from sap_reservas_pos p
  where puede_ver_historial() and p.orden = p_orden
  order by p.posicion
$$;

create or replace function public.historial_equipo_materiales(p_equipo text)
returns table (material text, descripcion text, unidad text, cantidad_usada numeric,
               n_ordenes int, primera date, ultima date)
language sql stable security definer set search_path = public as $$
  select p.material, max(p.descripcion), max(p.unidad),
         sum(greatest(p.cantidad_necesaria - coalesce(p.cantidad_pendiente,0), 0)),
         count(distinct o.orden)::int, min(o.fecha_entrada), max(o.fecha_entrada)
  from sap_ordenes o
  join sap_reservas_pos p on p.orden = o.orden
  where puede_ver_historial() and o.equipo = upper(trim(p_equipo))
    and p.cantidad_necesaria > coalesce(p.cantidad_pendiente,0)
  group by p.material
  order by 5 desc, 4 desc
  limit 500
$$;

create or replace function public.historial_buscar_material(p_texto text)
returns table (equipo text, orden bigint, fecha_entrada date, texto_orden text, material text,
               descripcion text, cantidad_usada numeric, unidad text)
language sql stable security definer set search_path = public as $$
  select o.equipo, o.orden, o.fecha_entrada, o.texto, p.material, p.descripcion,
         greatest(p.cantidad_necesaria - coalesce(p.cantidad_pendiente,0), 0), p.unidad
  from sap_reservas_pos p
  join sap_ordenes o on o.orden = p.orden
  where puede_ver_historial() and length(trim(p_texto)) >= 3
    and (p.material = trim(p_texto) or p.descripcion ilike '%' || trim(p_texto) || '%')
    and p.cantidad_necesaria > coalesce(p.cantidad_pendiente,0)
  order by o.fecha_entrada desc nulls last
  limit 300
$$;

revoke all on function public.historial_equipo_ordenes(text), public.historial_orden_componentes(bigint),
  public.historial_equipo_materiales(text), public.historial_buscar_material(text) from public, anon;
grant execute on function public.historial_equipo_ordenes(text), public.historial_orden_componentes(bigint),
  public.historial_equipo_materiales(text), public.historial_buscar_material(text), public.puede_ver_historial() to authenticated;
