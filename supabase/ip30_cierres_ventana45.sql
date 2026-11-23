-- ============================================================
-- Bandeja de preventivos ↔ Desde el último mantenimiento: cierres automáticos coherentes (23/11/2026)
--
-- Objetivo: que las dos pantallas muestren el mismo último mantenimiento.
--
-- 1. Regla de vinculación orden ↔ mantenimiento (cierre automático y Concluido de la bandeja):
--    un mantenimiento del mismo equipo, sin orden, con fecha entre cierre − 45 días y el cierre
--    y contador ≥ próximo de la orden (H) − umbral (y < H + período − umbral, para no tomar el ciclo siguiente).
--    Medido sobre 97 cierres reales: el mantenimiento real está a una mediana de 10 días del cierre,
--    p90 33, p95 42 (con 5 días solo se vinculaba el 42 %). Sin contador, solo por fecha, 45 días
--    tomaba el ciclo anterior en 13 de 105 casos: por eso se exige el contador.
--    Si la orden no tiene H cargado se mantiene la regla vieja (5 días, solo fecha).
--    Si no hay nada que vincular pero la app ya tiene un mantenimiento con contador ≥ H − umbral
--    (hecho tarde o > 45 días antes del cierre), la orden queda «ya_cubierta» y no se crea nada.
--    Lo creado es un estimado: contador = H y fecha = día en que el equipo llegó a H (entre cierre − 45 y
--    el cierre); sin H, el parte del día del cierre o pendiente. Validado con BM-LC001: estima 24/10 a 5.357 h,
--    planilla de Evelyn 25/10 con carga 5.359.
-- 2. Mantenimiento real que llega después del automático: al registrar uno manual o por inspección,
--    si hay un automático (origen orden_sap, contador estimado o pendiente) del mismo equipo que
--    encaja con la misma regla, el automático se anula y la orden pasa al real.
-- 3. ip30_backfill_cierres_viejos(p_dry_run): carga única para órdenes cerradas en SAP antes de que
--    se registrara la fecha de cierre (sin fecha → el cierre automático no las toca), solo la última
--    concluida por equipo y solo si la app está atrasada. Contador = H (estimado); fecha = primer día
--    en que la lectura (cargas SAP + partes) llega a H; si no hay, la fecha plan de la orden.
-- ============================================================

-- Respaldo
create schema if not exists scratch;
create table if not exists scratch.services_equipo_bkp_20261123 as table public.services_equipo;

-- ---------- Regla de una orden: H, umbral y período ----------
create or replace function public.ip30_regla_orden(p_orden bigint)
returns table(h numeric, umbral numeric, periodo numeric)
language sql stable security definer set search_path to 'public'
as $$
  select o.prox_mantto,
         ip30_umbral(coalesce(u.lejana, false), coalesce(o.prox_unidad, q.periodo_mtto_unidad, 'h')),
         q.periodo_mtto
  from ip30_ordenes o
  left join lateral (
    select nullif(trim(s.ubicacion), '') as ubicacion from sap_equipos s
    where upper(trim(s.equipo)) = o.equipo
    order by (nullif(trim(s.ubicacion), '') is null), s.actualizado_en desc nulls last limit 1) se on true
  left join insp_ubicaciones u on u.ubicacion_sap = se.ubicacion
  left join lateral (
    select q.periodo_mtto, q.periodo_mtto_unidad from equipos q
    where upper(trim(q.numero_identificacion)) = o.equipo
    order by q.activo desc limit 1) q on true
  where o.orden = p_orden
$$;
revoke all on function public.ip30_regla_orden(bigint) from public, anon, authenticated;

-- ---------- Vincular o crear (misma firma: lo usan ip30_sync_cierres e ip30_confirmar_estado) ----------
create or replace function public.ip30_mantenimiento_de_orden(p_orden bigint, p_equipo_id uuid, p_fecha_ref date,
  p_contador numeric, p_contador_estado text, p_usuario uuid, p_dry_run boolean)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_id uuid;
  v_fecha date;
  v_cont numeric;
  v_r record;
  v_ventana constant int := 45;
begin
  select * into v_r from ip30_regla_orden(p_orden);

  if v_r.h is not null then
    select s.id, s.fecha into v_id, v_fecha from services_equipo s
    where s.equipo_id = p_equipo_id and s.anulado_en is null and s.orden is null
      and s.contador is not null
      and s.fecha between p_fecha_ref - v_ventana and p_fecha_ref
      and s.contador >= v_r.h - v_r.umbral
      and (v_r.periodo is null or s.contador < v_r.h + v_r.periodo - v_r.umbral)
    order by abs(s.contador - v_r.h), s.fecha desc limit 1;
  else
    -- sin próximo cargado: regla anterior (5 días, solo fecha)
    select s.id, s.fecha into v_id, v_fecha from services_equipo s
    where s.equipo_id = p_equipo_id and s.anulado_en is null and s.orden is null
      and s.fecha between p_fecha_ref - 5 and p_fecha_ref
    order by s.fecha desc, s.created_at desc limit 1;
  end if;

  if v_id is not null then
    if not p_dry_run then update services_equipo set orden = p_orden where id = v_id; end if;
    return jsonb_build_object('accion', 'vincular', 'service_id', v_id, 'fecha', v_fecha);
  end if;
  -- Automático (no confirmado por la encargada): si la app ya tiene un mantenimiento que cubre esta orden
  -- (contador >= H - umbral), no se crea nada: crearlo taparía un dato real con uno estimado.
  if v_r.h is not null and p_contador_estado <> 'confirmado' then
    select s.id, s.fecha, s.contador into v_id, v_fecha, v_cont from services_equipo s
    where s.equipo_id = p_equipo_id and s.anulado_en is null and s.contador is not null
      and s.contador >= v_r.h - v_r.umbral
    order by s.fecha desc limit 1;
    if v_id is not null then
      return jsonb_build_object('accion', 'ya_cubierta', 'service_id', v_id, 'fecha', v_fecha, 'contador', v_cont);
    end if;
  end if;

  if not p_dry_run then
    insert into services_equipo (equipo_id, fecha, contador, origen, orden, contador_estado, cargado_por)
    values (p_equipo_id, p_fecha_ref, p_contador, 'orden_sap', p_orden, p_contador_estado, p_usuario)
    returning id into v_id;
  end if;
  return jsonb_build_object('accion', 'crear', 'service_id', v_id, 'fecha', p_fecha_ref,
                            'contador', p_contador, 'contador_estado', p_contador_estado);
end $$;

-- ---------- El mantenimiento real reemplaza al automático ----------
create or replace function public.trg_service_reemplaza_automatico()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare
  a record;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if new.origen not in ('manual', 'inspeccion') or new.anulado_en is not null
     or new.contador is null or new.orden is not null then
    return null;
  end if;

  select s.id, s.orden, s.fecha, s.contador, s.contador_estado into a
  from services_equipo s
  cross join lateral ip30_regla_orden(s.orden) r
  where s.equipo_id = new.equipo_id and s.id <> new.id and s.anulado_en is null
    and s.origen = 'orden_sap' and s.orden is not null
    and s.contador_estado in ('estimado', 'pendiente')
    and s.fecha between new.fecha and new.fecha + 45
    and r.h is not null
    and new.contador >= r.h - r.umbral
    and (r.periodo is null or new.contador < r.h + r.periodo - r.umbral)
  order by s.fecha
  limit 1;

  if a.id is null then return null; end if;

  update services_equipo set anulado_en = now(), orden = null where id = a.id;
  update services_equipo set orden = a.orden where id = new.id;
  insert into ip30_sync_log (ejecutado_en, dry_run, orden, equipo, accion, detalle)
  select now(), false, a.orden, upper(trim(q.numero_identificacion)), 'reemplazado',
         jsonb_build_object('automatico_id', a.id, 'automatico_fecha', a.fecha, 'automatico_contador', a.contador,
                            'automatico_estado', a.contador_estado, 'real_id', new.id, 'real_fecha', new.fecha,
                            'real_contador', new.contador, 'real_origen', new.origen)
  from equipos q where q.id = new.equipo_id;
  return null;
end $$;

create or replace trigger services_reemplaza_automatico
  after insert or update of fecha, contador on public.services_equipo
  for each row execute function public.trg_service_reemplaza_automatico();

-- ---------- Carga única: órdenes cerradas sin fecha de cierre ----------
create or replace function public.ip30_backfill_cierres_viejos(p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  r record;
  v_equipo_id uuid;
  v_fecha date;
  v_res jsonb;
  n_vinc int := 0; n_crea int := 0; n_omit int := 0;
  v_ahora timestamptz := now();
begin
  if session_user not in ('postgres', 'supabase_admin') and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Solo desde el SQL Editor';
  end if;

  for r in
    with c as (select * from ip30_calc()),
    conc as (
      select distinct on (c.equipo) c.*
      from c
      where (c.estado_sap in ('CTEC', 'CERR') or c.estado_confirmado = 'concluido') and c.h is not null
      order by c.equipo, c.h desc)
    select conc.orden, conc.equipo, conc.h, conc.unidad, conc.fecha_plan, conc.srv_fecha, conc.srv_contador
    from conc
    where conc.estado_sap in ('CTEC', 'CERR') and conc.fecha_cierre is null
      and (conc.srv_contador is null or conc.h - conc.srv_contador > conc.umbral)
      and not exists (select 1 from services_equipo s where s.orden = conc.orden)
    order by conc.orden
  loop
    select q.id into v_equipo_id from equipos q
     where upper(trim(q.numero_identificacion)) = r.equipo order by q.activo desc limit 1;
    if v_equipo_id is null then
      n_omit := n_omit + 1;
      insert into ip30_sync_log (ejecutado_en, dry_run, orden, equipo, accion, detalle)
      values (v_ahora, p_dry_run, r.orden, r.equipo, 'backfill_omitir', jsonb_build_object('motivo', 'equipo no está en Gestión de Equipos'));
      continue;
    end if;

    -- fecha: primer día con lectura ≥ H después de la última lectura < H (cargas SAP + partes en la unidad)
    with lec as (
      select c.fecha, c.horometro as v from sap_cargas_combustible c
       where upper(trim(c.equipo)) = r.equipo and c.horometro > 0 and c.fecha is not null
      union all
      select p.fecha, p.contador_fin from pd_partes_vigentes p
       where p.valido and p.equipo = r.equipo and p.modo = r.unidad and p.contador_fin is not null)
    select min(l.fecha) into v_fecha from lec l
     where l.v >= r.h
       and l.fecha > coalesce((select max(l2.fecha) from lec l2 where l2.v < r.h), '1900-01-01'::date);
    v_fecha := coalesce(v_fecha, r.fecha_plan);

    if v_fecha is null or (r.srv_fecha is not null and v_fecha <= r.srv_fecha) then
      n_omit := n_omit + 1;
      insert into ip30_sync_log (ejecutado_en, dry_run, orden, equipo, accion, detalle)
      values (v_ahora, p_dry_run, r.orden, r.equipo, 'backfill_omitir',
              jsonb_build_object('motivo', case when v_fecha is null then 'sin fecha' else 'fecha anterior al último mantenimiento' end,
                                 'fecha', v_fecha, 'h', r.h, 'srv_fecha', r.srv_fecha, 'srv_contador', r.srv_contador));
      continue;
    end if;

    v_res := ip30_mantenimiento_de_orden(r.orden, v_equipo_id, v_fecha, r.h, 'estimado', null, p_dry_run);
    if v_res->>'accion' = 'vincular' then n_vinc := n_vinc + 1; else n_crea := n_crea + 1; end if;
    insert into ip30_sync_log (ejecutado_en, dry_run, orden, equipo, accion, detalle)
    values (v_ahora, p_dry_run, r.orden, r.equipo, 'backfill_' || (v_res->>'accion'),
            v_res || jsonb_build_object('h', r.h, 'srv_fecha', r.srv_fecha, 'srv_contador', r.srv_contador));
  end loop;

  v_res := jsonb_build_object('vinculados', n_vinc, 'creados', n_crea, 'omitidos', n_omit);
  insert into ip30_sync_log (ejecutado_en, dry_run, accion, detalle) values (v_ahora, p_dry_run, 'BACKFILL', v_res);
  return jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'ejecutado_en', v_ahora) || v_res;
end $$;
revoke all on function public.ip30_backfill_cierres_viejos(boolean) from public, anon, authenticated;

-- ---------- Día en que el equipo llegó a un contador ----------
create or replace function public.ip30_fecha_llego_a(p_equipo text, p_unidad text, p_valor numeric, p_desde date, p_hasta date)
returns date
language sql stable security definer set search_path to 'public'
as $$
  -- primer día en que la lectura (cargas SAP + partes en la unidad) llega a p_valor, después de la última lectura menor
  with lec as (
    select c.fecha, c.horometro as v from sap_cargas_combustible c
     where upper(trim(c.equipo)) = p_equipo and c.horometro > 0 and c.fecha is not null and c.fecha <= p_hasta
    union all
    select p.fecha, p.contador_fin from pd_partes_vigentes p
     where p.valido and p.equipo = p_equipo and p.modo = p_unidad and p.contador_fin is not null and p.fecha <= p_hasta)
  select min(l.fecha) from lec l
   where l.v >= p_valor and l.fecha >= coalesce(p_desde, '1900-01-01'::date)
     and l.fecha > coalesce((select max(l2.fecha) from lec l2 where l2.v < p_valor), '1900-01-01'::date)
$$;
revoke all on function public.ip30_fecha_llego_a(text, text, numeric, date, date) from public, anon, authenticated;

-- ---------- Cierre automático ----------
create or replace function public.ip30_sync_cierres(p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  r record;
  v_equipo_id uuid;
  v_contador numeric;
  v_estado text;
  v_fecha_est date;
  v_regla record;
  v_res jsonb;
  n_vinc int := 0; n_crea int := 0; n_cub int := 0; n_sin_fecha int := 0; n_sin_equipo int := 0;
  v_ahora timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin')
     and not puede_completar_ordenes() then
    raise exception 'Sin permiso para sincronizar cierres';
  end if;

  for r in
    select c.orden, c.equipo, c.fecha_cierre, c.unidad
    from ip30_calc() c
    where c.estado_sap in ('CTEC', 'CERR')
      and not exists (select 1 from services_equipo s where s.orden = c.orden)
      and not exists (select 1 from ip30_sync_log l where l.orden = c.orden and l.accion = 'ya_cubierta' and not l.dry_run)
    order by c.orden
  loop
    if r.fecha_cierre is null then
      n_sin_fecha := n_sin_fecha + 1;
      continue;
    end if;
    select q.id into v_equipo_id from equipos q
     where upper(trim(q.numero_identificacion)) = r.equipo
     order by q.activo desc limit 1;
    if v_equipo_id is null then
      n_sin_equipo := n_sin_equipo + 1;
      insert into ip30_sync_log (ejecutado_en, dry_run, orden, equipo, accion, detalle)
      values (v_ahora, p_dry_run, r.orden, r.equipo, 'omitir', jsonb_build_object('motivo', 'equipo no está en Gestión de Equipos'));
      continue;
    end if;

    select * into v_regla from ip30_regla_orden(r.orden);
    v_fecha_est := null;
    if v_regla.h is not null then
      v_contador := v_regla.h;
      v_estado := 'estimado';
      v_fecha_est := ip30_fecha_llego_a(r.equipo, r.unidad, v_regla.h, r.fecha_cierre - 45, r.fecha_cierre);
    else
      select max(p.contador_fin) into v_contador from pd_partes_vigentes p
       where p.valido and p.equipo = r.equipo and p.modo = r.unidad and p.fecha = r.fecha_cierre;
      v_estado := case when v_contador is null then 'pendiente' else 'estimado' end;
    end if;

    v_res := ip30_mantenimiento_de_orden(r.orden, v_equipo_id, r.fecha_cierre, v_contador, v_estado, null, p_dry_run);
    if v_res->>'accion' = 'crear' and v_fecha_est is not null then
      if not p_dry_run then
        update services_equipo set fecha = v_fecha_est where id = (v_res->>'service_id')::uuid;
      end if;
      v_res := v_res || jsonb_build_object('fecha', v_fecha_est);
    end if;

    if v_res->>'accion' = 'vincular' then n_vinc := n_vinc + 1;
    elsif v_res->>'accion' = 'ya_cubierta' then n_cub := n_cub + 1;
    else n_crea := n_crea + 1; end if;
    insert into ip30_sync_log (ejecutado_en, dry_run, orden, equipo, accion, detalle)
    values (v_ahora, p_dry_run, r.orden, r.equipo, v_res->>'accion', v_res || jsonb_build_object('fecha_cierre', r.fecha_cierre));
  end loop;

  v_res := jsonb_build_object('vinculados', n_vinc, 'creados', n_crea, 'ya_cubiertas', n_cub,
                              'cerradas_sin_fecha', n_sin_fecha, 'sin_equipo', n_sin_equipo);
  insert into ip30_sync_log (ejecutado_en, dry_run, accion, detalle) values (v_ahora, p_dry_run, 'RUN', v_res);
  return jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'ejecutado_en', v_ahora) || v_res;
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

-- ---------- Ejecución (23/11/2026) ----------
-- select ip30_sync_cierres(false);            -- 85 vinculados, 45 creados, 16 ya cubiertas, 1 sin equipo
-- select ip30_backfill_cierres_viejos(false); -- 49 creados, 22 omitidos (18 con fecha anterior al último mantenimiento: revisar a mano)
-- Equipos con la app atrasada respecto de la última orden concluida: 121 → 37.
-- Programado cada 2 h (la ingesta de Trabajo no tiene hora fija):
-- select cron.schedule('ip30_sync_cierres', '40 */2 * * *', $$select public.ip30_sync_cierres(false)$$);
-- Revisar: select * from ip30_sync_log order by id desc limit 50;
