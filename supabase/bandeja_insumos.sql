-- ============================================================
-- BANDEJA DE PREVENTIVOS — pestaña «Insumos» (28/11/2026)
-- Qué insumos van a necesitar los próximos mantenimientos preventivos y contra qué stock, para que la
-- encargada de preventivo lo revise con Depósito y pida la compra.
--
-- Universo (cada equipo una sola vez):
--   A) órdenes abiertas de la bandeja confirmadas «Programado» (abierta = ip30_res_abiertas: sin CTEC/CERR y
--      no Concluido/Cancelado). Reprogramadas no entran.
--   B) equipos PRÓXIMOS: último mantenimiento con contador (no pendiente) + período, y
--        · si tiene telemetría (telemetria_diario, JD/CAT) con lectura de los últimos 7 días y período en horas:
--          falta = período − (horómetro telemetría − contador del mantenimiento)   ← la telemetría manda
--        · si no: falta = período − por_parte (mantenimiento_seguimiento_v3; parte en la unidad del período)
--      próximo si falta ≤ 70 h / 1.000 km (también si ya pasó). Lectura negativa (menor que el contador) no cuenta.
--      Un equipo próximo con orden abierta en la bandeja usa esa orden (la más reciente); sin orden, la propuesta
--      de su última preventiva con reserva.
-- Insumos por mantenimiento: si la orden tiene reserva en SAP → lo pendiente (cantidad_pendiente > 0) en el centro
--   de la reserva; si no → la propuesta (reserva completa de la TCPV anterior del equipo con reserva) en el centro
--   de abastecimiento de la obra actual. Solo preventivos.
-- Stock: último corte de sap_stock por material y centro (sin fila = 0). Gap = necesario − stock (en el front).
-- Equipos del universo sin ningún insumo conocido: una fila con material = NULL.
-- Umbrales y días de telemetría: CTE «par». Valida puede_completar_ordenes(). Idempotente. Sin DROP ni DELETE.
-- ============================================================

create or replace function public.ip30_insumos()
returns table (
  centro text, material text, descripcion text, unidad text, cantidad numeric,
  stock numeric, stock_1002 numeric,
  equipo text, ubicacion text, orden bigint, fecha_plan date, motivo text,
  fuente_insumo text, orden_origen bigint,
  falta numeric, falta_unidad text, lectura_fuente text,
  stock_corte date
)
language sql stable security definer set search_path = public as $$
  with par as (select 70::numeric umbral_h, 1000::numeric umbral_km, 7 dias_telemetria),
  ok as (select puede_completar_ordenes() v),
  -- maestro IE36: una fila por equipo (la que tiene ubicación y la más reciente)
  eq as (
    select distinct on (e.equipo) e.equipo, e.ubicacion, e.centro
    from sap_equipos e where e.equipo is not null
    order by e.equipo, (e.ubicacion is null), e.actualizado_en desc nulls last
  ),
  ab as (select a.*, o.estado_confirmado, o.fecha_plan from ip30_res_abiertas() a join ip30_ordenes o using (orden)),
  -- ---------- próximos ----------
  seg as (select * from mantenimiento_seguimiento_v3() where (select v from ok)),
  tel as (
    select distinct on (t.equipo) t.equipo, t.fuente, t.fecha, t.horometro_cierre
    from telemetria_diario t
    where t.horometro_cierre is not null and t.fecha >= current_date - (select dias_telemetria from par)
    order by t.equipo, t.fecha desc
  ),
  calc as (
    select s.equipo, s.periodo_unidad,
      case
        when tel.equipo is not null and coalesce(s.periodo_unidad, 'h') = 'h' and tel.fecha >= s.service_fecha
             and tel.horometro_cierre - s.service_contador >= 0
          then s.periodo - (tel.horometro_cierre - s.service_contador)
        when s.por_parte is not null and s.por_parte >= 0 and (s.periodo_unidad is null or s.pd_modo = s.periodo_unidad)
          then s.periodo - s.por_parte
      end falta,
      case
        when tel.equipo is not null and coalesce(s.periodo_unidad, 'h') = 'h' and tel.fecha >= s.service_fecha
             and tel.horometro_cierre - s.service_contador >= 0
          then tel.fuente
        when s.por_parte is not null and s.por_parte >= 0 and (s.periodo_unidad is null or s.pd_modo = s.periodo_unidad)
          then 'parte'
      end fuente
    from seg s left join tel on tel.equipo = s.equipo
    where s.periodo is not null and s.service_fecha is not null
      and coalesce(s.service_contador_estado, '') <> 'pendiente' and s.service_contador is not null
  ),
  prox as (
    select c.* from calc c, par
    where c.falta is not null
      and c.falta <= case when c.periodo_unidad = 'km' then par.umbral_km else par.umbral_h end
  ),
  -- ---------- universo: un mantenimiento por equipo ----------
  prog as (select distinct on (ab.equipo) ab.* from ab where ab.estado_confirmado = 'programado' order by ab.equipo, ab.orden desc),
  univ as (
    select p.equipo, p.orden, p.fecha_plan, p.tiene_reserva, p.centro_abast, 'programado'::text motivo
    from prog p
    union all
    select x.equipo, a.orden, a.fecha_plan, coalesce(a.tiene_reserva, false),
           coalesce(a.centro_abast, case when eq.centro is null then null else coalesce(ca.centro_repuestos, eq.centro) end),
           'proximo'
    from prox x
    left join eq on eq.equipo = x.equipo
    left join centros_abastecimiento ca on ca.centro_equipo = eq.centro
    left join lateral (select ab.* from ab where ab.equipo = x.equipo order by ab.orden desc limit 1) a on true
    where not exists (select 1 from prog p where p.equipo = x.equipo)
  ),
  -- orden de origen de la propuesta (cualquier N° SAP del equipo)
  orig as (
    select u.equipo, (
      select p.orden from sap_ordenes p
      where p.clase_orden = 'TCPV' and p.orden < coalesce(u.orden, 9999999999)
        and p.equipo_sap in (select e.equipo_sap from sap_equipos e where e.equipo = u.equipo)
        and exists (select 1 from sap_reservas_pos r where r.orden = p.orden)
      order by p.orden desc limit 1) orden_origen
    from univ u where not u.tiene_reserva
  ),
  items as (
    -- reserva real pendiente
    select u.equipo, r.centro, r.material, r.descripcion, r.unidad, r.cantidad_pendiente cantidad, 'reserva'::text fuente, null::bigint orden_origen
    from univ u join sap_reservas_pos r on r.orden = u.orden and r.cantidad_pendiente > 0
    where u.tiene_reserva
    union all
    -- propuesta
    select u.equipo, u.centro_abast, r.material, r.descripcion, r.unidad, r.cantidad_necesaria, 'propuesta', o.orden_origen
    from univ u join orig o on o.equipo = u.equipo
    join sap_reservas_pos r on r.orden = o.orden_origen
    where o.orden_origen is not null
  ),
  stk as (
    select i.centro, i.material,
      coalesce((select s.stock_cierre from sap_stock s where s.material = i.material and s.centro = i.centro order by s.a_fecha desc limit 1), 0) stock,
      coalesce((select s.stock_cierre from sap_stock s where s.material = i.material and s.centro = '1002' order by s.a_fecha desc limit 1), 0) stock_1002
    from (select distinct centro, material from items) i
  )
  select i.centro, i.material, i.descripcion, i.unidad, i.cantidad,
         st.stock, st.stock_1002,
         u.equipo, eq.ubicacion, u.orden, u.fecha_plan, u.motivo,
         i.fuente, i.orden_origen,
         c.falta, c.periodo_unidad, c.fuente,
         (select max(a_fecha) from sap_stock)
  from univ u
  left join items i on i.equipo = u.equipo
  left join stk st on st.centro is not distinct from i.centro and st.material = i.material
  left join eq on eq.equipo = u.equipo
  left join calc c on c.equipo = u.equipo
  where (select v from ok)
$$;

revoke all on function public.ip30_insumos() from public, anon;
grant execute on function public.ip30_insumos() to authenticated;
