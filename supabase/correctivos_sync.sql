-- ============================================================
-- MÓDULO CORRECTIVOS — Parte B: sincronización SAP → app
-- Reemplaza la rutina de Cowork (asignar N° de orden, liberar, ubicaciones).
-- Requiere correctivos_setup.sql (esquema corr, corr.sync_log, vistas corr.*).
--
-- Uso (desde n8n, con la service key, al final de la ingesta diaria):
--   POST /rest/v1/rpc/corr_sync_sap   body: {"p_dry_run": true}
-- Las primeras dos semanas: p_dry_run = true (solo registra lo que haría).
-- ============================================================

create or replace function public.corr_sync_sap(p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ts      timestamptz := now();
  v_res     text := case when p_dry_run then 'omitido_dry_run' else 'aplicado' end;
  v_f_ing   date;
  r         record;
  n_r1      int := 0; n_r1_amb int := 0;
  n_r2      int := 0;
  n_r3      int := 0; n_r3_amb int := 0;
begin
  -- Fecha de respaldo para la liberación: día (PY) de la última ingesta de órdenes
  select (max(procesado_en) at time zone 'America/Asuncion')::date into v_f_ing
  from sap_ingestas where fuente = 'trabajo';

  begin
    -- --------------------------------------------------------
    -- R1 — Asignar N° de orden a avisos (solo si hay exactamente una orden correctiva abierta)
    -- --------------------------------------------------------
    for r in
      select a.id, a.equipo, a.numero_aviso,
             count(o.orden) as n_abiertas,
             min(o.orden)   as orden
      from corr.app a
      join corr.ordenes o on o.aviso_n = a.aviso_n and o.es_correctiva and o.abierta
      where a.orden_n is null and a.aviso_n is not null
      group by a.id, a.equipo, a.numero_aviso
    loop
      if r.n_abiertas = 1 then
        if not p_dry_run then
          update mantenimientos set numero_orden = r.orden::text
          where id = r.id and corr_norm(numero_orden) is null;
        end if;
        insert into corr.sync_log (ejecutado_en, dry_run, regla, tabla, registro_id, equipo, campo, valor_anterior, valor_nuevo, resultado, detalle)
        values (v_ts, p_dry_run, 'R1', 'mantenimientos', r.id::text, r.equipo, 'numero_orden', null, r.orden::text, v_res,
                'Aviso ' || r.numero_aviso);
        n_r1 := n_r1 + 1;
      else
        insert into corr.sync_log (ejecutado_en, dry_run, regla, tabla, registro_id, equipo, campo, valor_anterior, valor_nuevo, resultado, detalle)
        values (v_ts, p_dry_run, 'R1', 'mantenimientos', r.id::text, r.equipo, 'numero_orden', null, null, 'omitido_ambiguo',
                'Aviso ' || r.numero_aviso || ' tiene ' || r.n_abiertas || ' órdenes abiertas');
        n_r1_amb := n_r1_amb + 1;
      end if;
    end loop;

    -- --------------------------------------------------------
    -- R2 — Liberar correctivos cuya orden SAP cruzada está CERRADA
    --      (nunca por ausencia de la orden; nunca sin cruce)
    -- --------------------------------------------------------
    for r in
      select a.id, a.equipo, a.estado, a.orden_cruzada, a.orden_n,
             coalesce(so.fecha_fin_real, v_f_ing) as f_lib,
             (so.fecha_fin_real is null) as usa_fecha_ingesta
      from corr.app a
      join sap_ordenes so on so.orden = a.orden_cruzada
      where a.cruza and not a.orden_abierta
    loop
      if not p_dry_run then
        update mantenimientos
           set estado = 'Taller Salida',
               fecha_liberacion = r.f_lib,
               numero_orden = coalesce(nullif(trim(numero_orden), ''), r.orden_cruzada::text)
         where id = r.id and estado in ('Taller Espera','Taller Entrada');
      end if;
      insert into corr.sync_log (ejecutado_en, dry_run, regla, tabla, registro_id, equipo, campo, valor_anterior, valor_nuevo, resultado, detalle)
      values (v_ts, p_dry_run, 'R2', 'mantenimientos', r.id::text, r.equipo, 'estado', r.estado, 'Taller Salida', v_res,
              'Orden ' || r.orden_cruzada || ' cerrada en SAP; liberación ' || to_char(r.f_lib, 'DD/MM/YYYY')
              || case when r.usa_fecha_ingesta then ' (fecha de ingesta: SAP sin fecha fin real)' else ' (fecha fin real SAP)' end);
      n_r2 := n_r2 + 1;
    end loop;

    -- --------------------------------------------------------
    -- R3 — Ubicación del equipo según SAP (sap_equipos.ubicacion, cargada desde IE36)
    -- --------------------------------------------------------
    for r in
      with s as (
        select trim(equipo) as equipo,
               count(distinct trim(ubicacion)) as n_ubic,
               min(trim(ubicacion)) as ubicacion
        from sap_equipos
        where nullif(trim(equipo), '') is not null and nullif(trim(ubicacion), '') is not null
        group by trim(equipo)
      )
      select e.id, e.numero_identificacion as equipo, e.ubicacion_actual, s.ubicacion, s.n_ubic
      from equipos e
      join s on s.equipo = e.numero_identificacion
      where s.ubicacion is distinct from e.ubicacion_actual
    loop
      if r.n_ubic = 1 then
        if not p_dry_run then
          update equipos set ubicacion_actual = r.ubicacion, updated_at = now() where id = r.id;
        end if;
        insert into corr.sync_log (ejecutado_en, dry_run, regla, tabla, registro_id, equipo, campo, valor_anterior, valor_nuevo, resultado, detalle)
        values (v_ts, p_dry_run, 'R3', 'equipos', r.id::text, r.equipo, 'ubicacion_actual', r.ubicacion_actual, r.ubicacion, v_res, null);
        n_r3 := n_r3 + 1;
      else
        insert into corr.sync_log (ejecutado_en, dry_run, regla, tabla, registro_id, equipo, campo, valor_anterior, valor_nuevo, resultado, detalle)
        values (v_ts, p_dry_run, 'R3', 'equipos', r.id::text, r.equipo, 'ubicacion_actual', r.ubicacion_actual, null, 'omitido_ambiguo',
                'El equipo figura ' || r.n_ubic || ' veces en sap_equipos con ubicaciones distintas');
        n_r3_amb := n_r3_amb + 1;
      end if;
    end loop;

    -- Marca de ejecución (aunque no haya cambios), para el sello de frescura
    insert into corr.sync_log (ejecutado_en, dry_run, regla, resultado, detalle)
    values (v_ts, p_dry_run, 'RUN', 'ok',
            format('R1=%s (ambiguos %s) · R2=%s · R3=%s (ambiguos %s)', n_r1, n_r1_amb, n_r2, n_r3, n_r3_amb));

  exception when others then
    -- Todo lo de arriba se revierte (savepoint del bloque); solo queda el error
    insert into corr.sync_log (ejecutado_en, dry_run, regla, resultado, detalle)
    values (v_ts, p_dry_run, 'ERROR', 'error', sqlstate || ': ' || sqlerrm);
    return jsonb_build_object('ok', false, 'dry_run', p_dry_run, 'error', sqlerrm);
  end;

  return jsonb_build_object(
    'ok', true, 'dry_run', p_dry_run, 'ejecutado_en', v_ts,
    'R1_asignar_orden', n_r1, 'R1_ambiguos', n_r1_amb,
    'R2_liberados', n_r2,
    'R3_ubicaciones', n_r3, 'R3_ambiguos', n_r3_amb);
end;
$$;

revoke execute on function public.corr_sync_sap(boolean) from public, anon, authenticated;
grant execute on function public.corr_sync_sap(boolean) to service_role;
