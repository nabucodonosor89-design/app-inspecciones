-- Historial de equipos: materiales consumidos por una Clase vehículo (equipos.clase_vehiculo) (14/10/2026) — YA APLICADO en Supabase el 14/10/2026; este archivo es solo referencia.
-- Una fila por material (n_equipos, n_ordenes, total), y el detalle por equipo que se despliega desde "Equipos".
-- Mismo criterio de consumo que el resto de historial_* (cantidad_necesaria > pendiente).
-- La clase se toma tal como está en el inventario (sin limpiar); equipos sin clase no aparecen.
-- Idempotente. No toca las otras RPC historial_*.
create or replace function public.historial_clase_materiales(p_clase text)
returns table (material text, descripcion text, unidad text, n_equipos int, n_ordenes int,
               cantidad_usada numeric, ultima date)
language sql stable security definer set search_path = public as $$
  select p.material, max(p.descripcion), max(p.unidad),
         count(distinct o.equipo)::int, count(distinct o.orden)::int,
         sum(greatest(p.cantidad_necesaria - coalesce(p.cantidad_pendiente,0), 0)),
         max(o.fecha_entrada)
  from equipos e
  join sap_ordenes o on o.equipo = e.numero_identificacion
  join sap_reservas_pos p on p.orden = o.orden
  where puede_ver_historial()
    and trim(e.clase_vehiculo) = trim(p_clase)
    and p.cantidad_necesaria > coalesce(p.cantidad_pendiente,0)
  group by p.material
  order by 4 desc, 5 desc, 2
  limit 3000
$$;

create or replace function public.historial_clase_material_equipos(p_clase text, p_material text)
returns table (equipo text, denominacion text, n_ordenes int, cantidad_usada numeric, unidad text, ultima date)
language sql stable security definer set search_path = public as $$
  select o.equipo, max(e.denominacion), count(distinct o.orden)::int,
         sum(greatest(p.cantidad_necesaria - coalesce(p.cantidad_pendiente,0), 0)),
         max(p.unidad), max(o.fecha_entrada)
  from equipos e
  join sap_ordenes o on o.equipo = e.numero_identificacion
  join sap_reservas_pos p on p.orden = o.orden
  where puede_ver_historial()
    and trim(e.clase_vehiculo) = trim(p_clase)
    and p.material = trim(p_material)
    and p.cantidad_necesaria > coalesce(p.cantidad_pendiente,0)
  group by o.equipo
  order by 3 desc, 4 desc, 1
  limit 1000
$$;

revoke all on function public.historial_clase_materiales(text), public.historial_clase_material_equipos(text, text) from public, anon;
grant execute on function public.historial_clase_materiales(text), public.historial_clase_material_equipos(text, text) to authenticated;
