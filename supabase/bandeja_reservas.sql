-- ============================================================
-- BANDEJA DE PREVENTIVOS v3 — reservas, stock y propuesta de reservas
-- (28/11/2026) Spec: proyecto «APP DE INSPECCIONES» → prompt-cowork-bandeja-preventivos-v3.md
--
-- * centros_abastecimiento: de qué centro salen los repuestos de cada obra (centro del equipo, IE36).
--   Centro que no está en la tabla = se abastece desde sí mismo. Se edita por SQL:
--     insert into centros_abastecimiento values ('1034','1002','Paracel desde Ypané')
--       on conflict (centro_equipo) do update set centro_repuestos = excluded.centro_repuestos, nota = excluded.nota;
-- * ip30_reservas_resumen()        una fila por orden ABIERTA de la bandeja (nivel de sus reservas o propuesta).
-- * ip30_reservas_orden(p_orden)   posiciones pendientes de la reserva real con stock y avisos.
-- * ip30_reservas_propuesta(p_orden) propuesta = reserva completa de la TCPV anterior del mismo equipo con reserva.
--
-- Orden abierta = sin CTEC/CERR en sap_ordenes y no confirmada Concluido/Cancelado en la bandeja.
-- Stock = último corte (a_fecha) de cada material y centro en sap_stock; si no figura, 0.
-- Pendiente TCPV = suma de cantidad_pendiente > 0 de todas las TCPV abiertas en SAP (solo reservas reales;
-- las propuestas no cuentan para otras órdenes).
-- Niveles: quiebre (stock < lo pendiente de la posición) · riesgo (cubre la posición pero no el total
-- pendiente TCPV del material en ese centro) · ok. En la propuesta, riesgo = stock < pendiente TCPV real + cantidad propuesta.
-- La app NO escribe en SAP. Idempotente. Sin DROP ni DELETE.
-- ============================================================

-- ---------- centros de abastecimiento ----------
create table if not exists public.centros_abastecimiento (
  centro_equipo    text primary key,
  centro_repuestos text not null,
  nota             text
);
alter table public.centros_abastecimiento enable row level security;
revoke all on public.centros_abastecimiento from anon, authenticated;

insert into public.centros_abastecimiento (centro_equipo, centro_repuestos, nota) values
  ('1023', '1022', 'CANTERA SOBERANIA → Ruta 17'),
  ('1026', '1022', 'RUTA 13 → Ruta 17'),
  ('1028', '1002', 'INFRAESTRUCTURA → Ypané'),
  ('1032', '1002', 'AVELINO MARTINEZ → Ypané')
on conflict (centro_equipo) do nothing;

-- Para buscar la preventiva anterior del equipo
create index if not exists sap_ordenes_equipo_sap_clase_idx on public.sap_ordenes (equipo_sap, clase_orden, orden desc);

-- ---------- base interna: órdenes abiertas de la bandeja con su centro ----------
create or replace function public.ip30_res_abiertas()
returns table (orden bigint, equipo text, equipo_sap bigint, centro_equipo text, centro_abast text, tiene_reserva boolean)
language sql stable security definer set search_path = public as $$
  select o.orden, o.equipo, o.equipo_sap, e.centro,
         case when e.centro is null then null else coalesce(ca.centro_repuestos, e.centro) end,
         exists (select 1 from sap_reservas_pos r where r.orden = o.orden)
  from ip30_ordenes o
  left join sap_ordenes so on so.orden = o.orden
  left join sap_equipos e on e.equipo_sap = o.equipo_sap
  left join centros_abastecimiento ca on ca.centro_equipo = e.centro
  where coalesce(so.status_sistema, '') !~ '(CTEC|CERR)'
    and coalesce(o.estado_confirmado, '') not in ('concluido', 'cancelado')
$$;

-- Pendiente total de reservas reales por material y centro en TCPV abiertas de SAP
create or replace function public.ip30_res_pendiente_tcpv()
returns table (material text, centro text, pendiente numeric)
language sql stable security definer set search_path = public as $$
  select r.material, r.centro, sum(r.cantidad_pendiente)
  from sap_reservas_pos r
  join sap_ordenes so on so.orden = r.orden
  where so.clase_orden = 'TCPV' and coalesce(so.status_sistema, '') !~ '(CTEC|CERR)'
    and r.cantidad_pendiente > 0
  group by 1, 2
$$;

-- Orden de origen de la propuesta (TCPV anterior del mismo equipo con reserva) y cuántas se saltaron
create or replace function public.ip30_res_origen(p_orden bigint, p_equipo_sap bigint)
returns table (orden_origen bigint, saltadas integer)
language sql stable security definer set search_path = public as $$
  with o as (
    select p.orden from sap_ordenes p
    where p.equipo_sap = p_equipo_sap and p.clase_orden = 'TCPV' and p.orden < p_orden
      and exists (select 1 from sap_reservas_pos r where r.orden = p.orden)
    order by p.orden desc limit 1
  )
  select o.orden,
         (select count(*)::int from sap_ordenes q
          where q.equipo_sap = p_equipo_sap and q.clase_orden = 'TCPV' and q.orden > o.orden and q.orden < p_orden)
  from o
$$;

revoke all on function public.ip30_res_abiertas() from public, anon, authenticated;
revoke all on function public.ip30_res_pendiente_tcpv() from public, anon, authenticated;
revoke all on function public.ip30_res_origen(bigint, bigint) from public, anon, authenticated;

-- ---------- resumen por orden ----------
create or replace function public.ip30_reservas_resumen()
returns table (
  orden bigint, n_posiciones integer, peor_nivel text, otro_centro boolean,
  orden_propuesta bigint, n_propuesta integer, propuesta_peor text, stock_corte date
)
language sql stable security definer set search_path = public as $$
  with ab as (select * from ip30_res_abiertas() where puede_completar_ordenes()),
  corte as (select max(a_fecha) f from sap_stock),
  pend as (select * from ip30_res_pendiente_tcpv()),
  -- reservas reales
  pos as (
    select ab.orden, r.material, r.centro, r.cantidad_pendiente,
           (r.centro is distinct from ab.centro_abast and ab.centro_abast is not null) otro,
           coalesce(st.stock, 0) stock, coalesce(pe.pendiente, 0) tot
    from ab
    join sap_reservas_pos r on r.orden = ab.orden and r.cantidad_pendiente > 0
    left join pend pe on pe.material = r.material and pe.centro = r.centro
    left join lateral (select s.stock_cierre stock from sap_stock s
                       where s.material = r.material and s.centro = r.centro
                       order by s.a_fecha desc limit 1) st on true
  ),
  real as (
    select orden, count(*)::int n, bool_or(otro) otro,
           min(case when stock < cantidad_pendiente then 0 when stock < tot then 1 else 2 end) peor
    from pos group by orden
  ),
  -- propuestas (órdenes sin ninguna reserva)
  orig as (
    select ab.orden, ab.centro_abast, og.orden_origen
    from ab cross join lateral ip30_res_origen(ab.orden, ab.equipo_sap) og
    where not ab.tiene_reserva
  ),
  ppos as (
    select orig.orden, r.material, r.cantidad_necesaria cant,
           st.stock, coalesce(pe.pendiente, 0) tot, orig.centro_abast
    from orig
    join sap_reservas_pos r on r.orden = orig.orden_origen
    left join pend pe on pe.material = r.material and pe.centro = orig.centro_abast
    left join lateral (select s.stock_cierre stock from sap_stock s
                       where s.material = r.material and s.centro = orig.centro_abast
                       order by s.a_fecha desc limit 1) st on true
  ),
  prop as (
    select orden, count(*)::int n,
           case when bool_and(centro_abast is null) then null
                else min(case when coalesce(stock, 0) < cant then 0 when coalesce(stock, 0) < tot + cant then 1 else 2 end) end peor
    from ppos group by orden
  )
  select ab.orden,
         coalesce(real.n, 0),
         case when ab.tiene_reserva then (array['quiebre', 'riesgo', 'ok'])[coalesce(real.peor, 2) + 1]
              when orig.orden_origen is not null then 'propuesta'
              else 'sin_reserva' end,
         coalesce(real.otro, false),
         orig.orden_origen,
         prop.n,
         case when prop.peor is null then null else (array['quiebre', 'riesgo', 'ok'])[prop.peor + 1] end,
         (select f from corte)
  from ab
  left join real on real.orden = ab.orden
  left join orig on orig.orden = ab.orden
  left join prop on prop.orden = ab.orden
$$;

-- ---------- posiciones de la reserva real ----------
create or replace function public.ip30_reservas_orden(p_orden bigint)
returns table (
  posicion integer, material text, descripcion text, cantidad_pendiente numeric, unidad text,
  centro text, centro_esperado text, otro_centro boolean, stock numeric, pendiente_tcpv numeric,
  nivel text, stock_1002 numeric, stock_corte date
)
language sql stable security definer set search_path = public as $$
  with ab as (
    select o.orden, case when e.centro is null then null else coalesce(ca.centro_repuestos, e.centro) end centro_abast
    from ip30_ordenes o
    left join sap_equipos e on e.equipo_sap = o.equipo_sap
    left join centros_abastecimiento ca on ca.centro_equipo = e.centro
    where o.orden = p_orden and puede_completar_ordenes()
  ),
  pend as (select * from ip30_res_pendiente_tcpv()),
  x as (
    select r.posicion, r.material, r.descripcion, r.cantidad_pendiente, r.unidad, r.centro, ab.centro_abast,
           coalesce(st.stock, 0) stock, coalesce(pe.pendiente, 0) tot
    from ab
    join sap_reservas_pos r on r.orden = ab.orden and r.cantidad_pendiente > 0
    left join pend pe on pe.material = r.material and pe.centro = r.centro
    left join lateral (select s.stock_cierre stock from sap_stock s
                       where s.material = r.material and s.centro = r.centro
                       order by s.a_fecha desc limit 1) st on true
  )
  select x.posicion, x.material, x.descripcion, x.cantidad_pendiente, x.unidad, x.centro, x.centro_abast,
         (x.centro is distinct from x.centro_abast and x.centro_abast is not null),
         x.stock, x.tot,
         case when x.stock < x.cantidad_pendiente then 'quiebre' when x.stock < x.tot then 'riesgo' else 'ok' end,
         case when x.stock < x.cantidad_pendiente and x.centro <> '1002' then
           coalesce((select s.stock_cierre from sap_stock s where s.material = x.material and s.centro = '1002'
                     order by s.a_fecha desc limit 1), 0) end,
         (select max(a_fecha) from sap_stock)
  from x
  order by case when x.stock < x.cantidad_pendiente then 0 when x.stock < x.tot then 1 else 2 end, x.posicion
$$;

-- ---------- propuesta de reservas ----------
create or replace function public.ip30_reservas_propuesta(p_orden bigint)
returns table (
  orden_origen bigint, origen_texto text, origen_status text, origen_fecha date, saltadas integer,
  posicion integer, material text, descripcion text, cantidad numeric, unidad text,
  centro_sugerido text, stock numeric, pendiente_tcpv numeric, nivel text, stock_1002 numeric,
  no_salio_en_origen boolean, origen_viejo boolean, stock_corte date
)
language sql stable security definer set search_path = public as $$
  with ab as (
    select a.* from ip30_res_abiertas() a where a.orden = p_orden and not a.tiene_reserva and puede_completar_ordenes()
  ),
  og as (
    select ab.centro_abast, o.orden_origen, o.saltadas
    from ab cross join lateral ip30_res_origen(ab.orden, ab.equipo_sap) o
  ),
  fecha as (select max(r.fecha_solicitud) f from og join sap_reservas_pos r on r.orden = og.orden_origen),
  x as (
    select og.*, so.texto, so.status_sistema, so.status_usuario, r.posicion, r.material, r.descripcion,
           r.cantidad_necesaria cant, r.cantidad_pendiente, r.unidad,
           st.stock, coalesce(pe.pendiente, 0) tot
    from og
    join sap_ordenes so on so.orden = og.orden_origen
    join sap_reservas_pos r on r.orden = og.orden_origen
    left join ip30_res_pendiente_tcpv() pe on pe.material = r.material and pe.centro = og.centro_abast
    left join lateral (select s.stock_cierre stock from sap_stock s
                       where s.material = r.material and s.centro = og.centro_abast
                       order by s.a_fecha desc limit 1) st on true
  )
  select x.orden_origen, x.texto,
         trim(concat_ws(' ', x.status_sistema, x.status_usuario)),
         (select f from fecha), x.saltadas,
         x.posicion, x.material, x.descripcion, x.cant, x.unidad,
         x.centro_abast,
         case when x.centro_abast is null then null else coalesce(x.stock, 0) end,
         x.tot,
         case when x.centro_abast is null then null
              when coalesce(x.stock, 0) < x.cant then 'quiebre'
              when coalesce(x.stock, 0) < x.tot + x.cant then 'riesgo' else 'ok' end,
         case when x.centro_abast is not null and coalesce(x.stock, 0) < x.cant and x.centro_abast <> '1002' then
           coalesce((select s.stock_cierre from sap_stock s where s.material = x.material and s.centro = '1002'
                     order by s.a_fecha desc limit 1), 0) end,
         (x.cant > 0 and x.cantidad_pendiente >= x.cant),
         ((select f from fecha) < current_date - 365),
         (select max(a_fecha) from sap_stock)
  from x
  order by case when x.centro_abast is null then 3
                when coalesce(x.stock, 0) < x.cant then 0
                when coalesce(x.stock, 0) < x.tot + x.cant then 1 else 2 end, x.posicion
$$;

revoke all on function public.ip30_reservas_resumen() from public, anon;
revoke all on function public.ip30_reservas_orden(bigint) from public, anon;
revoke all on function public.ip30_reservas_propuesta(bigint) from public, anon;
grant execute on function public.ip30_reservas_resumen() to authenticated;
grant execute on function public.ip30_reservas_orden(bigint) to authenticated;
grant execute on function public.ip30_reservas_propuesta(bigint) to authenticated;
