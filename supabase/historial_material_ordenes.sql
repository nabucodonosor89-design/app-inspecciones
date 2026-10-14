-- Historial de equipos: órdenes de una combinación equipo × material (14/10/2026) — YA APLICADO en Supabase el 14/10/2026; este archivo es solo referencia.
-- Alimenta la sub-tabla que se abre desde la columna "Órdenes" (Por material y Por equipo → Materiales).
-- Mismo criterio de consumo que historial_equipo_materiales (cantidad_necesaria > pendiente), así el
-- total coincide con n_ordenes. Una fila por orden (suma si el material está en varias posiciones).
-- Idempotente. No toca las otras RPC historial_*.
create or replace function public.historial_material_ordenes(p_equipo text, p_material text)
returns table (orden bigint, clase_orden text, fecha_entrada date, texto text,
               cantidad_usada numeric, unidad text, cerrada boolean)
language sql stable security definer set search_path = public as $$
  select o.orden, o.clase_orden, o.fecha_entrada, o.texto,
         sum(greatest(p.cantidad_necesaria - coalesce(p.cantidad_pendiente,0), 0)),
         max(p.unidad),
         (o.status_sistema like 'CTEC%' or o.status_sistema like '%CERR%')
  from sap_ordenes o
  join sap_reservas_pos p on p.orden = o.orden
  where puede_ver_historial()
    and o.equipo = upper(trim(p_equipo))
    and p.material = trim(p_material)
    and p.cantidad_necesaria > coalesce(p.cantidad_pendiente,0)
  group by o.orden, o.clase_orden, o.fecha_entrada, o.texto, o.status_sistema
  order by o.fecha_entrada desc nulls last, o.orden desc
  limit 1000
$$;

revoke all on function public.historial_material_ordenes(text, text) from public, anon;
grant execute on function public.historial_material_ordenes(text, text) to authenticated;
