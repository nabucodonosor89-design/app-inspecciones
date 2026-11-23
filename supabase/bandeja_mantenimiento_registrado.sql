-- ============================================================
-- Bandeja de preventivos — coherencia con "Desde el último mantenimiento" (19/11/2026)
--
-- Problema: la bandeja comparaba el objetivo de cada orden (H) con la lectura de hoy aunque el
-- mantenimiento ya estuviera registrado en services_equipo (ej. VL-CN082: mantenimiento de 30.000 km
-- cargado el 20/10, orden 4014277 abierta en SAP → la bandeja decía "pasado 3.561 km" y
-- Desde el último mantenimiento "falta 1.439 km").
--
-- Regla "orden cubierta por un mantenimiento registrado":
--   orden abierta en SAP (no CTEC/CERR) con H cargado, y el último mantenimiento del equipo
--   (services_equipo, el mismo que usa Desde el último mantenimiento) tiene
--     contador ≥ H − umbral   y   fecha ≥ fecha plan − 60 días.
-- Si está cubierta:
--   · Sugerido = Concluido, motivo "mantenimiento registrado dd/mm/aaaa (contador) · falta cierre en SAP".
--   · H y J pasan a ser los del PRÓXIMO mantenimiento (contador del mantenimiento + período), igual que
--     Desde el último mantenimiento. Sin período cargado, J queda vacío.
--   · Aparece en "Falta cierre técnico" aunque la encargada todavía no la haya confirmado.
--   · Si ya estaba confirmada como Programado/Reprogramado, vuelve a Pendientes ("la sugerencia cambió").
-- Al confirmarla Concluido (ip30_confirmar_estado) sin contador ni fecha, la orden se vincula al
-- mantenimiento que la cubre (services_equipo.orden), para que el cierre automático no cree otro.
-- ============================================================

create or replace function public.ip30_calc()
 returns table(orden bigint, equipo text, equipo_sap bigint, denominacion text, texto text, fecha_plan date, fecha_plan_anterior date, ubicacion text, lejana boolean, ubicacion_sin_config boolean, periodo numeric, periodo_unidad text, srv_fecha date, srv_contador numeric, srv_contador_estado text, h numeric, h_fuente text, h_calculado numeric, h_difiere boolean, unidad text, umbral numeric, lectura numeric, lectura_fecha date, j numeric, j_fuente text, estado_sap text, fecha_cierre date, estado_sugerido text, motivo text, estado_confirmado text, nueva_fecha date, notas text, estado_confirmado_en timestamp with time zone, confirmado_por text, sugerencia_cambio boolean, volvio boolean, pendiente boolean, en_ultimo_ip30 boolean, salio_sin_cierre boolean, falta_cierre_tecnico boolean, primera_carga timestamp with time zone, ultima_carga timestamp with time zone, origen text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with o as (select * from ip30_ordenes),
  b as (select * from ip30_base_equipos((select array_agg(distinct o.equipo) from o))),
  x as (
    select o.*, b.denominacion, b.ubicacion, b.lejana, b.ubicacion_sin_config,
           b.periodo, b.periodo_unidad, b.srv_fecha, b.srv_contador, b.srv_contador_estado,
           b.pd_h, b.pd_km, b.lect_h, b.lect_h_fecha, b.lect_h_fuente, b.lect_h_invalida,
           b.lect_km, b.lect_km_fecha, b.lect_km_fuente, b.lect_km_invalida,
           case when b.srv_contador is not null and b.periodo is not null then b.srv_contador + b.periodo end as h_calc,
           so.status_sistema, so.fecha_fin_real, so.orden is not null as en_trabajo,
           ev.fecha as fecha_9eql, u.nombre_completo as confirmado_por_nombre
    from o
    left join b on b.equipo = o.equipo
    left join sap_ordenes so on so.orden = o.orden
    left join lateral (
      select min((e.detectado_en at time zone 'America/Asuncion')::date) as fecha
      from sap_ordenes_eventos e
      where e.orden = o.orden and e.estado_anterior is not null and e.estado_nuevo = '9EQL') ev on true
    left join usuarios u on u.id = o.estado_confirmado_por
  ),
  y as (
    select x.*,
      coalesce(x.prox_mantto, x.h_calc) as h_val0,
      case when x.prox_mantto is not null then 'cargado' when x.h_calc is not null then 'calculado' end as h_src0,
      coalesce(x.prox_unidad, x.periodo_unidad,
        case when x.pd_h is not null and x.pd_km is not null and coalesce(x.prox_mantto, x.h_calc) is not null
               then case when abs(x.pd_km - coalesce(x.prox_mantto, x.h_calc)) < abs(x.pd_h - coalesce(x.prox_mantto, x.h_calc)) then 'km' else 'h' end
             when x.pd_km is not null and x.pd_h is null then 'km'
             else 'h' end) as un,
      case when x.status_sistema ~ '\mCERR\M' then 'CERR' when x.status_sistema ~ '\mCTEC\M' then 'CTEC'
           when x.en_trabajo then 'abierta' else 'sin dato' end as est_sap
    from x
  ),
  z as (
    select y.*,
      case when y.un = 'km' then y.lect_km else y.lect_h end as lect,
      case when y.un = 'km' then y.lect_km_fecha else y.lect_h_fecha end as lect_fecha,
      case when y.un = 'km' then y.lect_km_fuente else y.lect_h_fuente end as lect_fuente,
      case when y.un = 'km' then y.lect_km_invalida else y.lect_h_invalida end as lect_inv,
      ip30_umbral(y.lejana, y.un) as umb,
      -- orden cubierta por un mantenimiento ya registrado (services_equipo, mismo dato que Desde el último mantenimiento)
      (y.est_sap not in ('CTEC', 'CERR')
       and y.prox_mantto is not null and y.srv_contador is not null and y.srv_fecha is not null
       and coalesce(y.prox_unidad, y.un) = coalesce(y.periodo_unidad, y.prox_unidad, y.un)
       and y.srv_contador >= y.prox_mantto - ip30_umbral(y.lejana, y.un)
       and (y.fecha_plan is null or y.srv_fecha >= y.fecha_plan - 60)) as cubierta
    from y
  ),
  z2 as (
    select z.*,
      case when z.cubierta then z.h_calc else z.h_val0 end as h_val,
      case when z.cubierta then case when z.h_calc is not null then 'calculado' end else z.h_src0 end as h_src
    from z
  ),
  w as (
    select z2.*,
      z2.h_val - z2.lect as j_val,
      case when z2.est_sap in ('CTEC', 'CERR') then 'concluido'
           when z2.cubierta then 'concluido'
           when z2.h_val is null or z2.lect is null then null
           when z2.h_val - z2.lect <= z2.umb then 'programado'
           else 'reprogramado' end as sug,
      case when z2.est_sap in ('CTEC', 'CERR') then 'cerrada en SAP'
           when z2.cubierta then format('mantenimiento registrado %s (%s) · falta cierre en SAP',
                                        to_char(z2.srv_fecha, 'DD/MM/YYYY'), rtrim(to_char(z2.srv_contador, 'FM999999990.##'), '.'))
           when z2.h_val is null then 'sin próximo mantenimiento'
           when z2.lect is null and z2.lect_inv then 'revisar contador'
           when z2.lect is null then 'sin lectura'
           when z2.h_val - z2.lect <= 0 then 'vencido'
           when z2.h_val - z2.lect <= z2.umb then 'dentro del umbral'
           else 'falta más que el umbral' end as mot
    from z2
  )
  select w.orden, w.equipo, w.equipo_sap, w.denominacion, w.texto, w.fecha_plan, w.fecha_plan_anterior,
         w.ubicacion, w.lejana, w.ubicacion_sin_config,
         w.periodo, w.periodo_unidad, w.srv_fecha, w.srv_contador, w.srv_contador_estado,
         w.h_val, w.h_src, w.h_calc,
         (not w.cubierta and w.prox_mantto is not null and w.h_calc is not null and w.periodo_unidad is not distinct from w.un
          and abs(w.prox_mantto - w.h_calc) >= 1),
         w.un, w.umb,
         w.lect, w.lect_fecha, w.j_val, w.lect_fuente,
         w.est_sap,
         case when w.est_sap in ('CTEC', 'CERR') then coalesce(w.fecha_fin_real, w.fecha_9eql) end,
         w.sug, w.mot,
         w.estado_confirmado, w.nueva_fecha, w.notas, w.estado_confirmado_en, w.confirmado_por_nombre,
         (w.estado_confirmado is not null and w.estado_sugerido_al_confirmar is not null
          and w.sug is distinct from w.estado_sugerido_al_confirmar),
         w.volvio,
         (w.estado_confirmado is null
          or w.volvio
          or (w.estado_sugerido_al_confirmar is not null and w.sug is distinct from w.estado_sugerido_al_confirmar)),
         w.en_ultimo_ip30,
         (not w.en_ultimo_ip30 and w.est_sap not in ('CTEC', 'CERR')
          and coalesce(w.estado_confirmado, '') not in ('concluido', 'cancelado')
          and not (w.estado_confirmado = 'reprogramado' and w.nueva_fecha > (now() at time zone 'America/Asuncion')::date)),
         -- falta cierre técnico: concluida por la encargada, o con mantenimiento registrado, y SAP sin cerrar
         (w.est_sap not in ('CTEC', 'CERR')
          and (w.estado_confirmado = 'concluido' or (w.cubierta and coalesce(w.estado_confirmado, '') <> 'cancelado'))),
         w.primera_carga, w.ultima_carga, w.origen
  from w
$function$;

-- Confirmar Concluido sin contador ni fecha: si la orden está cubierta por un mantenimiento registrado
-- sin orden, se vincula (services_equipo.orden) para que el cierre automático no cree otro.
create or replace function public.ip30_confirmar_estado(p_orden bigint, p_estado text, p_nueva_fecha date default null::date, p_notas text default null::text, p_contador numeric default null::numeric, p_fecha date default null::date)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_usuario uuid;
  v_o ip30_ordenes;
  v_sug text;
  v_mot text;
  v_cierre date;
  v_equipo_id uuid;
  v_srv record;
  v_res jsonb := null;
  v_hoy date := (now() at time zone 'America/Asuncion')::date;
begin
  if not puede_completar_ordenes() then raise exception 'Sin permiso para confirmar órdenes'; end if;
  if p_estado is not null and p_estado not in ('programado', 'reprogramado', 'concluido', 'cancelado', 'verificar') then
    raise exception 'Estado inválido: %', p_estado;
  end if;
  if p_estado = 'reprogramado' and p_nueva_fecha is null then
    raise exception 'Para reprogramar hace falta la nueva fecha';
  end if;
  if p_contador is not null and p_contador < 0 then raise exception 'El contador no puede ser negativo'; end if;
  if p_fecha is not null and p_fecha > v_hoy then raise exception 'La fecha del mantenimiento no puede ser futura'; end if;

  select * into v_o from ip30_ordenes where orden = p_orden for update;
  if not found then raise exception 'La orden % no está en la bandeja', p_orden; end if;
  select id into v_usuario from usuarios where email = auth.email();
  select c.estado_sugerido, c.fecha_cierre, c.motivo into v_sug, v_cierre, v_mot from ip30_calc() c where c.orden = p_orden;

  update ip30_ordenes set
    estado_confirmado = p_estado,
    estado_sugerido_al_confirmar = case when p_estado is null then null else v_sug end,
    nueva_fecha = case when p_estado = 'reprogramado' then p_nueva_fecha end,
    notas = nullif(trim(p_notas), ''),
    estado_confirmado_en = case when p_estado is null then null else now() end,
    estado_confirmado_por = case when p_estado is null then null else v_usuario end,
    volvio = false
  where orden = p_orden;

  if p_estado = 'concluido' and p_contador is null and p_fecha is null and v_mot like 'mantenimiento registrado%' then
    -- orden cubierta por un mantenimiento ya registrado: vincularlo si todavía no tiene orden
    select q.id into v_equipo_id from equipos q
     where upper(trim(q.numero_identificacion)) = v_o.equipo order by q.activo desc limit 1;
    if v_equipo_id is not null and not exists (select 1 from services_equipo where orden = p_orden) then
      update services_equipo set orden = p_orden
      where id = (select s.id from services_equipo s
                  where s.equipo_id = v_equipo_id and s.anulado_en is null
                  order by s.fecha desc, s.created_at desc limit 1)
        and orden is null
      returning jsonb_build_object('accion', 'vincular_registrado', 'service_id', id) into v_res;
    end if;
  end if;

  if p_estado = 'concluido' and (p_contador is not null or p_fecha is not null) then
    select q.id into v_equipo_id from equipos q
     where upper(trim(q.numero_identificacion)) = v_o.equipo order by q.activo desc limit 1;
    if v_equipo_id is null then
      raise exception 'El equipo % no está en Gestión de Equipos: no se puede registrar el mantenimiento', v_o.equipo;
    end if;
    select * into v_srv from services_equipo where orden = p_orden;
    if found then
      update services_equipo set
        contador = coalesce(p_contador, contador),
        fecha = coalesce(p_fecha, fecha),
        contador_estado = case when p_contador is not null then 'confirmado' else contador_estado end,
        cargado_por = coalesce(v_usuario, cargado_por)
      where id = v_srv.id;
      v_res := jsonb_build_object('accion', 'actualizar', 'service_id', v_srv.id);
    else
      if p_contador is null then
        raise exception 'Para registrar el mantenimiento hace falta el contador';
      end if;
      if coalesce(v_cierre, p_fecha) is null then
        raise exception 'Falta la fecha del mantenimiento';
      end if;
      v_res := ip30_mantenimiento_de_orden(p_orden, v_equipo_id, coalesce(v_cierre, p_fecha), p_contador, 'confirmado', v_usuario, false);
      if v_res->>'accion' = 'vincular' then
        update services_equipo set contador = p_contador, fecha = coalesce(p_fecha, fecha), contador_estado = 'confirmado'
         where id = (v_res->>'service_id')::uuid and contador_estado <> 'confirmado';
      elsif p_fecha is not null then
        update services_equipo set fecha = p_fecha where id = (v_res->>'service_id')::uuid;
      end if;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'orden', p_orden, 'estado', p_estado, 'mantenimiento', v_res);
end $function$;
