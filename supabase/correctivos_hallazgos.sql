-- ============================================================
-- CORRECTIVOS → pestaña "Hallazgos" (27/10/2026)
-- Seguimiento de inspecciones periódicas con ítems críticos en falla hasta
-- que la(s) orden(es) SAP del aviso lleguen a cierre técnico (CTEC/CERR).
-- Visibilidad: la misma que Correctivos (usuarios.ve_correctivos = true).
-- No toca: mantenimientos, trigger_actualizar_semaforo / actualizar_semaforo_equipo,
-- reporte diario de inspecciones. Idempotente.
-- ============================================================

-- 1. Tabla -----------------------------------------------------
create table if not exists public.seguimiento_hallazgos (
  id uuid primary key default gen_random_uuid(),
  inspeccion_id uuid not null unique references public.inspecciones(id) on delete cascade,
  equipo_id uuid not null references public.equipos(id),
  creado_en timestamptz not null default now(),
  numero_aviso text null check (numero_aviso is null or numero_aviso ~ '^[0-9]{1,18}$'),
  aviso_cargado_por uuid null references public.usuarios(id),
  aviso_cargado_en timestamptz null,
  cierre_manual boolean not null default false,
  motivo_cierre text null,
  cerrado_por uuid null references public.usuarios(id),
  cerrado_en timestamptz null,
  constraint seguimiento_hallazgos_motivo_chk
    check (not cierre_manual or (motivo_cierre is not null and btrim(motivo_cierre) <> ''))
);
create index if not exists seguimiento_hallazgos_equipo_idx on public.seguimiento_hallazgos(equipo_id);

alter table public.seguimiento_hallazgos enable row level security;  -- sin políticas: solo vía RPC
revoke all on table public.seguimiento_hallazgos from anon, authenticated;

-- 2. Parámetro: fecha de activación (configuraciones) ------------
-- Valor inicial = inicio del día del deploy (27/10/2026 00:00 Asunción). Cambiar:
--   update configuraciones set valor = '2026-10-27T00:00:00-03:00' where clave = 'fecha_activacion_hallazgos';
-- (si se adelanta la fecha, correr también la carga inicial de la sección 4b)
insert into public.configuraciones (clave, valor, descripcion)
select 'fecha_activacion_hallazgos', '2026-10-27T00:00:00-03:00',
       'Correctivos → Hallazgos: solo entran inspecciones periódicas con fecha_hora >= esta fecha'
where not exists (select 1 from public.configuraciones where clave = 'fecha_activacion_hallazgos');

create or replace function public.hall_fecha_activacion()
returns timestamptz language sql stable security definer set search_path = public as $$
  select coalesce((select valor::timestamptz from configuraciones where clave = 'fecha_activacion_hallazgos'), 'infinity'::timestamptz)
$$;
revoke all on function public.hall_fecha_activacion() from public, anon, authenticated;

-- 3. Permiso (mismo que Correctivos) ------------------------------
create or replace function public.hall_usuario()
returns uuid language sql stable security definer set search_path = public as $$
  select id from usuarios where email = auth.email() and activo = true and ve_correctivos = true limit 1
$$;
revoke all on function public.hall_usuario() from public, anon, authenticated;

-- 4. Alta automática (independiente del trigger de semáforo) ------
create or replace function public.hall_alta_checklist()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.es_critico is true and new.estado = 'fail' then
    begin
      insert into seguimiento_hallazgos (inspeccion_id, equipo_id)
      select i.id, i.equipo_id
        from inspecciones i
       where i.id = new.inspeccion_id
         and i.tipo_inspeccion = 'periodica'
         and i.equipo_id is not null
         and i.fecha_hora >= hall_fecha_activacion()
      on conflict (inspeccion_id) do nothing;
    exception when others then
      -- nunca bloquear el guardado de la inspección
      raise warning 'hall_alta_checklist: % (%)', sqlerrm, sqlstate;
    end;
  end if;
  return null;
end $$;
revoke all on function public.hall_alta_checklist() from public, anon, authenticated;

drop trigger if exists trigger_hallazgos_alta on public.checklist_items;
create trigger trigger_hallazgos_alta
  after insert or update of estado, es_critico on public.checklist_items
  for each row execute function public.hall_alta_checklist();

-- 4b. Carga inicial: inspecciones desde la activación cargadas antes del trigger
insert into public.seguimiento_hallazgos (inspeccion_id, equipo_id)
select i.id, i.equipo_id
  from public.inspecciones i
 where i.tipo_inspeccion = 'periodica'
   and i.equipo_id is not null
   and i.fecha_hora >= public.hall_fecha_activacion()
   and exists (select 1 from public.checklist_items c where c.inspeccion_id = i.id and c.es_critico and c.estado = 'fail')
on conflict (inspeccion_id) do nothing;

-- 5. Lectura: estado calculado ----------------------------------
-- Aviso efectivo (27/10/2026): el del mantenimiento vinculado a la inspección
-- (mantenimientos.inspeccion_id, el más reciente con aviso) y, si no hay, el cargado
-- en el hallazgo («Solo aviso»). Mantenimientos no se modifica: solo se lee.
create or replace function public.hall_mantenimiento(p_inspeccion uuid)
returns table (id uuid, estado text, fecha_ingreso_taller date, email_enviado boolean, aviso_norm text)
language sql stable security definer set search_path = public as $$
  select m.id, m.estado, m.fecha_ingreso_taller, m.email_enviado,
         case when btrim(m.numero_aviso) ~ '^[0-9]{1,18}$' then nullif(ltrim(btrim(m.numero_aviso), '0'), '') end
    from mantenimientos m
   where m.inspeccion_id = p_inspeccion
   order by (nullif(btrim(m.numero_aviso), '') is not null) desc, m.created_at desc
   limit 1
$$;
revoke all on function public.hall_mantenimiento(uuid) from public, anon, authenticated;

drop function if exists public.hallazgos_listar();
create function public.hallazgos_listar()
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
  with base as (
    select h.*, m.id as m_id, m.estado as m_estado, m.fecha_ingreso_taller as m_ingreso, m.email_enviado as m_email,
           coalesce(m.aviso_norm, h.numero_aviso) as av,
           case when m.aviso_norm is not null then 'mantenimiento' when h.numero_aviso is not null then 'hallazgo' end as av_origen,
           i.fecha_hora as f_insp, i.ubicacion as ubic, i.tipo_inspeccion as tipo,
           i.semaforo as sem, i.horometro_odometro as horo, i.observaciones_generales as obs,
           e.numero_identificacion as eq, e.denominacion as den, ui.nombre_completo as insp,
           ua.nombre_completo as ua_nom, uc.nombre_completo as uc_nom,
           ((now() at time zone 'America/Asuncion')::date - (i.fecha_hora at time zone 'America/Asuncion')::date) as d,
           (select coalesce(jsonb_agg(jsonb_build_object('item_nombre', c.item_nombre, 'categoria', c.categoria, 'observacion', c.observacion)
                                      order by c.categoria, c.item_nombre), '[]'::jsonb)
              from checklist_items c where c.inspeccion_id = h.inspeccion_id and c.es_critico and c.estado = 'fail') as its,
           (select coalesce(jsonb_agg(jsonb_build_object('orden', o.orden, 'clase_orden', o.clase_orden,
                                      'status_sistema', o.status_sistema, 'status_usuario', o.status_usuario, 'texto', o.texto,
                                      'cerrada', (' ' || coalesce(o.status_sistema, '') || ' ') ~ ' (CTEC|CERR) ')
                                      order by o.orden), '[]'::jsonb)
              from sap_ordenes o where coalesce(m.aviso_norm, h.numero_aviso) is not null
                                   and o.aviso = coalesce(m.aviso_norm, h.numero_aviso)::bigint) as ords
      from seguimiento_hallazgos h
      join inspecciones i on i.id = h.inspeccion_id
      left join lateral hall_mantenimiento(h.inspeccion_id) m on true
      join equipos e on e.id = h.equipo_id
      left join usuarios ui on ui.id = i.inspector_id
      left join usuarios ua on ua.id = h.aviso_cargado_por
      left join usuarios uc on uc.id = h.cerrado_por
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

-- 6. Escritura --------------------------------------------------
create or replace function public.cargar_aviso_hallazgo(p_id uuid, p_numero_aviso text)
returns void language plpgsql security definer set search_path = public as $$
declare v_u uuid := hall_usuario(); v_av text;
begin
  if v_u is null then raise exception 'Sin permiso de Correctivos' using errcode = '42501'; end if;
  v_av := nullif(btrim(coalesce(p_numero_aviso, '')), '');
  if v_av is not null then
    if v_av !~ '^[0-9]+$' then raise exception 'El N° de aviso debe tener solo dígitos'; end if;
    v_av := nullif(ltrim(v_av, '0'), '');
    if v_av is null or length(v_av) > 18 then raise exception 'N° de aviso inválido'; end if;
  end if;
  update seguimiento_hallazgos
     set numero_aviso = v_av,
         aviso_cargado_por = case when v_av is null then null else v_u end,
         aviso_cargado_en = case when v_av is null then null else now() end
   where id = p_id;
  if not found then raise exception 'Hallazgo no encontrado'; end if;
end $$;

create or replace function public.cerrar_hallazgo_sin_aviso(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_u uuid := hall_usuario();
begin
  if v_u is null then raise exception 'Sin permiso de Correctivos' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then raise exception 'El motivo es obligatorio'; end if;
  if exists (select 1 from seguimiento_hallazgos h left join lateral hall_mantenimiento(h.inspeccion_id) m on true
              where h.id = p_id and (h.numero_aviso is not null or m.aviso_norm is not null)) then
    raise exception 'El hallazgo tiene aviso: no se puede cerrar sin aviso';
  end if;
  update seguimiento_hallazgos
     set cierre_manual = true, motivo_cierre = btrim(p_motivo), cerrado_por = v_u, cerrado_en = now()
   where id = p_id;
  if not found then raise exception 'Hallazgo no encontrado'; end if;
end $$;

create or replace function public.reabrir_hallazgo(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if hall_usuario() is null then raise exception 'Sin permiso de Correctivos' using errcode = '42501'; end if;
  update seguimiento_hallazgos
     set cierre_manual = false, motivo_cierre = null, cerrado_por = null, cerrado_en = null
   where id = p_id;
  if not found then raise exception 'Hallazgo no encontrado'; end if;
end $$;

revoke all on function public.hallazgos_listar() from public, anon;
revoke all on function public.cargar_aviso_hallazgo(uuid, text) from public, anon;
revoke all on function public.cerrar_hallazgo_sin_aviso(uuid, text) from public, anon;
revoke all on function public.reabrir_hallazgo(uuid) from public, anon;
grant execute on function public.hallazgos_listar() to authenticated;
grant execute on function public.cargar_aviso_hallazgo(uuid, text) to authenticated;
grant execute on function public.cerrar_hallazgo_sin_aviso(uuid, text) to authenticated;
grant execute on function public.reabrir_hallazgo(uuid) to authenticated;
