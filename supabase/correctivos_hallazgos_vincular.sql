-- ============================================================
-- CORRECTIVOS → Hallazgos: vincular un mantenimiento ya registrado (12/11/2026)
-- Caso: la avería ya estaba detectada y el correctivo registrado antes de la
-- inspección → el hallazgo no lo veía (solo reconoce mantenimientos.inspeccion_id).
-- Reglas acordadas con Andrés:
--   * se ofrecen solo correctivos ABIERTOS (Taller Espera / Taller Entrada) del
--     mismo equipo, con aviso (en correctivos el aviso es obligatorio);
--   * el vínculo vive en el hallazgo (mantenimientos no se toca); un mismo
--     mantenimiento puede quedar vinculado a varios hallazgos; si después pasa a
--     Taller Salida el vínculo se mantiene;
--   * prioridad del aviso: mantenimiento creado desde la inspección → vinculado →
--     aviso a mano («Solo aviso»);
--   * se puede desvincular (vuelve al aviso a mano si había, o a Sin aviso);
--   * un hallazgo vinculado no se puede «Cerrar sin aviso»;
--   * carga única: hallazgos con aviso a mano que coincide con un correctivo del
--     mismo equipo quedan vinculados (12/11/2026: 0 casos).
-- Requiere supabase/correctivos_hallazgos.sql. Idempotente.
-- ============================================================

-- 1. Columnas ----------------------------------------------------
alter table public.seguimiento_hallazgos
  add column if not exists mantenimiento_vinculado_id uuid null references public.mantenimientos(id) on delete set null,
  add column if not exists vinculado_por uuid null references public.usuarios(id),
  add column if not exists vinculado_en timestamptz null;
create index if not exists seguimiento_hallazgos_mvinc_idx on public.seguimiento_hallazgos(mantenimiento_vinculado_id);

-- 2. Lectura (misma firma; suma el mantenimiento vinculado) ----------
-- aviso_origen: 'mantenimiento' (desde la inspección) | 'vinculado' | 'hallazgo' (a mano)
create or replace function public.hallazgos_listar()
returns table (
  id uuid, inspeccion_id uuid, equipo_id uuid, equipo text, denominacion text,
  ubicacion text, fecha_hora timestamptz, inspector text, dias integer,
  tipo_inspeccion text, semaforo text, horometro_odometro numeric, observaciones_generales text,
  numero_aviso text, aviso_cargado_por text, aviso_cargado_en timestamptz,
  cierre_manual boolean, motivo_cierre text, cerrado_por text, cerrado_en timestamptz,
  estado text, alerta boolean, items jsonb, ordenes jsonb,
  aviso_origen text, mantenimiento_id uuid, mantenimiento_estado text,
  mantenimiento_ingreso date, mantenimiento_email boolean
) language plpgsql stable security definer set search_path = public as $$
begin
  if hall_usuario() is null then
    raise exception 'Sin permiso de Correctivos' using errcode = '42501';
  end if;
  return query
  with pre as (
    select h.*,
           m.id as mi_id, m.estado as mi_estado, m.fecha_ingreso_taller as mi_ingreso, m.email_enviado as mi_email, m.aviso_norm as mi_av,
           mv.id as mv_id, mv.estado as mv_estado, mv.fecha_ingreso_taller as mv_ingreso, mv.email_enviado as mv_email,
           case when btrim(mv.numero_aviso) ~ '^[0-9]{1,18}$' then nullif(ltrim(btrim(mv.numero_aviso), '0'), '') end as mv_av
      from seguimiento_hallazgos h
      left join lateral hall_mantenimiento(h.inspeccion_id) m on true
      left join mantenimientos mv on mv.id = h.mantenimiento_vinculado_id
  ), base as (
    select p.*,
           case when p.mi_av is null and p.mv_id is not null then p.mv_id else p.mi_id end as m_id,
           case when p.mi_av is null and p.mv_id is not null then p.mv_estado else p.mi_estado end as m_estado,
           case when p.mi_av is null and p.mv_id is not null then p.mv_ingreso else p.mi_ingreso end as m_ingreso,
           case when p.mi_av is null and p.mv_id is not null then p.mv_email else p.mi_email end as m_email,
           coalesce(p.mi_av, p.mv_av, p.numero_aviso) as av,
           case when p.mi_av is not null then 'mantenimiento'
                when p.mv_av is not null then 'vinculado'
                when p.numero_aviso is not null then 'hallazgo' end as av_origen,
           i.fecha_hora as f_insp, i.ubicacion as ubic, i.tipo_inspeccion as tipo,
           i.semaforo as sem, i.horometro_odometro as horo, i.observaciones_generales as obs,
           e.numero_identificacion as eq, e.denominacion as den, ui.nombre_completo as insp,
           ua.nombre_completo as ua_nom, uc.nombre_completo as uc_nom,
           ((now() at time zone 'America/Asuncion')::date - (i.fecha_hora at time zone 'America/Asuncion')::date) as d,
           (select coalesce(jsonb_agg(jsonb_build_object('item_nombre', c.item_nombre, 'categoria', c.categoria, 'observacion', c.observacion)
                                      order by c.categoria, c.item_nombre), '[]'::jsonb)
              from checklist_items c where c.inspeccion_id = p.inspeccion_id and c.es_critico and c.estado = 'fail') as its,
           (select coalesce(jsonb_agg(jsonb_build_object('orden', o.orden, 'clase_orden', o.clase_orden,
                                      'status_sistema', o.status_sistema, 'status_usuario', o.status_usuario, 'texto', o.texto,
                                      'cerrada', (' ' || coalesce(o.status_sistema, '') || ' ') ~ ' (CTEC|CERR) ')
                                      order by o.orden), '[]'::jsonb)
              from sap_ordenes o where coalesce(p.mi_av, p.mv_av, p.numero_aviso) is not null
                                   and o.aviso = coalesce(p.mi_av, p.mv_av, p.numero_aviso)::bigint) as ords
      from pre p
      join inspecciones i on i.id = p.inspeccion_id
      join equipos e on e.id = p.equipo_id
      left join usuarios ui on ui.id = i.inspector_id
      left join usuarios ua on ua.id = p.aviso_cargado_por
      left join usuarios uc on uc.id = p.cerrado_por
  ), est as (
    select b.*,
           case
             when b.cierre_manual then 'cerrado_sin_aviso'
             when b.av is null then 'sin_aviso'
             when jsonb_array_length(b.ords) = 0 then 'aviso_sin_orden'
             when not jsonb_path_exists(b.ords, '$[*] ? (@.cerrada == false)') then 'resuelto'
             else 'en_curso'
           end as est
      from base b
     where jsonb_array_length(b.its) > 0 or b.av is not null
  )
  select x.id, x.inspeccion_id, x.equipo_id, x.eq, x.den, x.ubic, x.f_insp, x.insp, x.d,
         x.tipo, x.sem, x.horo, x.obs,
         x.av, x.ua_nom, x.aviso_cargado_en, x.cierre_manual, x.motivo_cierre, x.uc_nom, x.cerrado_en,
         x.est,
         (x.est = 'sin_aviso' and x.d > 2) or (x.est = 'aviso_sin_orden' and x.d > 7),
         x.its, x.ords,
         x.av_origen, x.m_id, x.m_estado, x.m_ingreso, x.m_email
    from est x
   order by (x.est = 'sin_aviso') desc, x.f_insp asc;
end $$;

-- 3. Correctivos abiertos del equipo del hallazgo --------------------
create or replace function public.hallazgo_mantenimientos_abiertos(p_id uuid)
returns table (id uuid, numero_aviso text, estado text, fecha_ingreso_taller date,
               fecha_inicio_averia date, descripcion_averia text, creado date, vinculado boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if hall_usuario() is null then raise exception 'Sin permiso de Correctivos' using errcode = '42501'; end if;
  return query
  select m.id, btrim(m.numero_aviso), m.estado, m.fecha_ingreso_taller, m.fecha_inicio_averia,
         m.descripcion_averia, m.created_at::date, (m.id = h.mantenimiento_vinculado_id)
    from seguimiento_hallazgos h
    join mantenimientos m on m.equipo_id = h.equipo_id
   where h.id = p_id
     and m.tipo_mantenimiento = 'Correctivo'
     and m.estado in ('Taller Espera', 'Taller Entrada')
     and btrim(m.numero_aviso) ~ '^[0-9]{1,18}$'
   order by m.created_at desc;
end $$;

-- 4. Vincular / desvincular -------------------------------------------
create or replace function public.vincular_mantenimiento_hallazgo(p_id uuid, p_mantenimiento uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_u uuid := hall_usuario(); v_h seguimiento_hallazgos%rowtype;
begin
  if v_u is null then raise exception 'Sin permiso de Correctivos' using errcode = '42501'; end if;
  select * into v_h from seguimiento_hallazgos where id = p_id;
  if not found then raise exception 'Hallazgo no encontrado'; end if;
  if v_h.cierre_manual then raise exception 'El hallazgo está cerrado: reabrilo para vincular'; end if;
  if exists (select 1 from hall_mantenimiento(v_h.inspeccion_id) m where m.aviso_norm is not null) then
    raise exception 'El hallazgo ya tiene un mantenimiento registrado desde la inspección';
  end if;
  if not exists (select 1 from mantenimientos m
                  where m.id = p_mantenimiento and m.equipo_id = v_h.equipo_id
                    and m.tipo_mantenimiento = 'Correctivo'
                    and m.estado in ('Taller Espera', 'Taller Entrada')
                    and btrim(m.numero_aviso) ~ '^[0-9]{1,18}$') then
    raise exception 'Solo se puede vincular un correctivo abierto (Espera o Entrada) del mismo equipo';
  end if;
  update seguimiento_hallazgos
     set mantenimiento_vinculado_id = p_mantenimiento, vinculado_por = v_u, vinculado_en = now()
   where id = p_id;
end $$;

create or replace function public.desvincular_mantenimiento_hallazgo(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if hall_usuario() is null then raise exception 'Sin permiso de Correctivos' using errcode = '42501'; end if;
  update seguimiento_hallazgos
     set mantenimiento_vinculado_id = null, vinculado_por = null, vinculado_en = null
   where id = p_id;
  if not found then raise exception 'Hallazgo no encontrado'; end if;
end $$;

-- 5. Cerrar sin aviso: también bloquea si hay mantenimiento vinculado ----
create or replace function public.cerrar_hallazgo_sin_aviso(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_u uuid := hall_usuario();
begin
  if v_u is null then raise exception 'Sin permiso de Correctivos' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then raise exception 'El motivo es obligatorio'; end if;
  if exists (select 1 from seguimiento_hallazgos h left join lateral hall_mantenimiento(h.inspeccion_id) m on true
              where h.id = p_id and (h.numero_aviso is not null or m.aviso_norm is not null
                                     or h.mantenimiento_vinculado_id is not null)) then
    raise exception 'El hallazgo tiene aviso o mantenimiento vinculado: no se puede cerrar sin aviso';
  end if;
  update seguimiento_hallazgos
     set cierre_manual = true, motivo_cierre = btrim(p_motivo), cerrado_por = v_u, cerrado_en = now()
   where id = p_id;
  if not found then raise exception 'Hallazgo no encontrado'; end if;
end $$;

-- 6. Carga única: aviso a mano que coincide con un correctivo del equipo ---
-- (cualquier estado: el aviso es el mismo; vinculado_por null = automático)
update public.seguimiento_hallazgos h
   set mantenimiento_vinculado_id = x.mid, vinculado_en = now()
  from (select h2.id as hid,
               (select m.id from public.mantenimientos m
                 where m.equipo_id = h2.equipo_id and m.tipo_mantenimiento = 'Correctivo'
                   and btrim(m.numero_aviso) ~ '^[0-9]{1,18}$'
                   and nullif(ltrim(btrim(m.numero_aviso), '0'), '') = h2.numero_aviso
                 order by m.created_at desc limit 1) as mid
          from public.seguimiento_hallazgos h2
         where h2.numero_aviso is not null and h2.mantenimiento_vinculado_id is null
           and not exists (select 1 from public.hall_mantenimiento(h2.inspeccion_id) m where m.aviso_norm is not null)) x
 where h.id = x.hid and x.mid is not null;

-- 7. Permisos -----------------------------------------------------------
revoke all on function public.hallazgo_mantenimientos_abiertos(uuid) from public, anon;
revoke all on function public.vincular_mantenimiento_hallazgo(uuid, uuid) from public, anon;
revoke all on function public.desvincular_mantenimiento_hallazgo(uuid) from public, anon;
grant execute on function public.hallazgo_mantenimientos_abiertos(uuid) to authenticated;
grant execute on function public.vincular_mantenimiento_hallazgo(uuid, uuid) to authenticated;
grant execute on function public.desvincular_mantenimiento_hallazgo(uuid) to authenticated;
