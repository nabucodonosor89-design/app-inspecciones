-- ============================================================
-- CORRECTIVOS — Seguimiento por orden/aviso (informe del encargado)
-- Prompt: claude/prompt-cowork-correctivos-seguimiento-v1.md
-- Idempotente. Acceso a las tablas SOLO por funciones (RLS sin políticas).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tablas
-- ------------------------------------------------------------
create table if not exists public.corr_responsables (
  id serial primary key,
  nombre text not null unique,
  activo boolean not null default true,
  orden smallint not null default 0
);
insert into public.corr_responsables (nombre, orden) values
  ('Taller Ypané', 1), ('Compras', 2), ('Depósito', 3), ('Proveedor / taller tercero', 4),
  ('Obra', 5), ('Paracel (cliente)', 6), ('Transporte y Equipos', 7)
on conflict (nombre) do nothing;

create table if not exists public.corr_seg_parametros (
  id boolean primary key default true check (id),
  dias_sin_seguimiento int not null default 3
);
insert into public.corr_seg_parametros (id) values (true) on conflict do nothing;
comment on table public.corr_seg_parametros is 'Una fila. Editar por SQL: update corr_seg_parametros set dias_sin_seguimiento = 5;';

create table if not exists public.corr_seguimientos (
  id uuid primary key default gen_random_uuid(),
  equipo text not null,
  orden bigint unique,
  aviso bigint unique,
  origen text not null check (origen in ('sap', 'manual')),
  descripcion text,
  ubicacion text,
  terminado boolean not null default false,
  terminado_por uuid references public.usuarios(id),
  terminado_en timestamptz,
  motivo_termino text,
  creado_por uuid references public.usuarios(id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  check (orden is not null or aviso is not null)
);
create index if not exists corr_seguimientos_equipo_idx on public.corr_seguimientos (equipo);
create index if not exists corr_seguimientos_abiertos_idx on public.corr_seguimientos (terminado, terminado_en);
comment on table public.corr_seguimientos is 'Hilo de seguimiento por orden o aviso correctivo. Los crea corr_sync_seguimientos() (órdenes SAP) o corr_seg_alta_aviso() (avisos a mano).';

create table if not exists public.corr_novedades (
  id uuid primary key default gen_random_uuid(),
  seguimiento_id uuid not null references public.corr_seguimientos(id) on delete cascade,
  texto text not null check (length(trim(texto)) > 0),
  situacion text not null check (situacion in ('diagnostico','esperando_cotizacion','esperando_aprobacion','esperando_repuesto','en_reparacion','en_traslado','listo_para_liberar')),
  responsable_id int references public.corr_responsables(id),
  fecha_compromiso date,
  autor uuid references public.usuarios(id),
  creado_en timestamptz not null default now()
);
create index if not exists corr_novedades_seg_idx on public.corr_novedades (seguimiento_id, creado_en desc);
create index if not exists corr_novedades_fecha_idx on public.corr_novedades (creado_en);
comment on table public.corr_novedades is 'Novedades de un hilo. No se editan ni se borran: un error se corrige con otra novedad.';

create table if not exists public.corr_seguimientos_log (
  id bigserial primary key,
  ejecutado_en timestamptz not null default now(),
  accion text not null,
  seguimiento_id uuid,
  equipo text,
  detalle text
);

alter table public.corr_responsables enable row level security;
alter table public.corr_seg_parametros enable row level security;
alter table public.corr_seguimientos enable row level security;
alter table public.corr_novedades enable row level security;
alter table public.corr_seguimientos_log enable row level security;
revoke all on public.corr_responsables, public.corr_seg_parametros, public.corr_seguimientos,
  public.corr_novedades, public.corr_seguimientos_log from anon, authenticated;

-- ------------------------------------------------------------
-- 2. Permisos
-- ------------------------------------------------------------
-- Usuario actual (activo) o null
create or replace function public.corr_seg_usuario()
returns uuid language sql stable security definer set search_path = public as $$
  select id from usuarios where email = auth.email() and activo = true limit 1
$$;

-- Ve todos los hilos: admin o ve_correctivos
create or replace function public.corr_seg_ve_todo()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuarios where email = auth.email() and activo = true
                 and (rol = 'admin' or ve_correctivos = true))
$$;

-- Ubicaciones SAP de las zonas donde el usuario es residente vigente (titular o suplente)
create or replace function public.corr_seg_mis_ubicaciones()
returns setof text language sql stable security definer set search_path = public as $$
  select distinct iu.ubicacion_sap
  from usuarios u
  join insp_zona_inspectores zi on zi.usuario_id = u.id
  join insp_zonas z on z.id = zi.zona_id and z.tipo = 'residente'
  join insp_ubicaciones iu on iu.zona_id = z.id
  where u.email = auth.email() and u.activo = true
    and (zi.desde is null or zi.desde <= corr_hoy())
    and (zi.hasta is null or zi.hasta >= corr_hoy())
$$;

create or replace function public.corr_seg_puede_ver(p_ubicacion text)
returns boolean language sql stable security definer set search_path = public as $$
  select corr_seg_ve_todo() or p_ubicacion in (select corr_seg_mis_ubicaciones())
$$;

-- Lo que el front necesita saber del usuario
create or replace function public.corr_seg_permisos()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    've_todo', corr_seg_ve_todo(),
    'gestiona', correctivos_puede_gestionar(),
    'residente', exists (select corr_seg_mis_ubicaciones()),
    'ubicaciones', coalesce((select jsonb_agg(x) from corr_seg_mis_ubicaciones() x), '[]'::jsonb)
  )
$$;

-- ------------------------------------------------------------
-- 3. Sincronización SAP → hilos
-- ------------------------------------------------------------
create or replace function public.corr_sync_seguimientos()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_creados int := 0; v_vinculados int := 0; v_manual_app int := 0; r record;
begin
  -- c) Avisos de la app (mantenimientos en taller) sin orden y sin hilo → hilo manual
  with nuevos as (
    insert into corr_seguimientos (equipo, aviso, origen, descripcion, ubicacion, creado_por)
    select distinct on (corr_norm(m.numero_aviso)::bigint)
           e.numero_identificacion, corr_norm(m.numero_aviso)::bigint, 'manual', m.descripcion_averia,
           coalesce(i.ubicacion, 'COMPLEJO YPANE'), null
    from mantenimientos m
    join equipos e on e.id = m.equipo_id
    left join corr.par_inventario i on i.equipo = e.numero_identificacion
    where m.estado <> 'Taller Salida'
      and corr_norm(m.numero_orden) is null
      and corr_norm(m.numero_aviso) ~ '^1\d{7}$'
      and e.numero_identificacion is not null
      and not exists (select 1 from corr_seguimientos t where t.aviso = corr_norm(m.numero_aviso)::bigint)
    order by corr_norm(m.numero_aviso)::bigint, m.created_at desc
    on conflict do nothing
    returning 1
  ) select count(*) into v_manual_app from nuevos;

  -- a) Avisos manuales sin orden: vincular con la orden correctiva SAP de ese aviso (la más reciente, abierta o no)
  for r in
    select s.id, s.equipo, s.aviso, o.orden, o.equipo as equipo_sap
    from corr_seguimientos s
    join lateral (
      select x.orden, x.equipo from corr.ordenes x
      where x.es_correctiva and x.aviso = s.aviso
        and not exists (select 1 from corr_seguimientos t where t.orden = x.orden)
      order by x.fecha_entrada desc nulls last limit 1
    ) o on true
    where s.orden is null and s.aviso is not null
  loop
    update corr_seguimientos set orden = r.orden, actualizado_en = now() where id = r.id;
    insert into corr_seguimientos_log (accion, seguimiento_id, equipo, detalle)
    values ('vincula_orden', r.id, r.equipo, format('aviso %s → orden %s%s', r.aviso, r.orden,
      case when r.equipo_sap is distinct from r.equipo then format(' (en SAP el equipo es %s)', r.equipo_sap) else '' end));
    v_vinculados := v_vinculados + 1;
  end loop;

  -- b) Órdenes correctivas abiertas en SAP sin hilo
  with nuevas as (
    insert into corr_seguimientos (equipo, orden, aviso, origen, descripcion, ubicacion)
    select o.equipo, o.orden,
           case when o.aviso is null
                  or exists (select 1 from corr_seguimientos t where t.aviso = o.aviso)
                  or row_number() over (partition by o.aviso order by o.fecha_entrada desc nulls last, o.orden desc) > 1
                then null else o.aviso end,
           'sap', o.texto, coalesce(i.ubicacion, o.ubicacion)
    from corr.ordenes o
    left join corr.par_inventario i on i.equipo = o.equipo
    where o.es_correctiva and o.abierta and o.equipo is not null
      and not exists (select 1 from corr_seguimientos t where t.orden = o.orden)
    on conflict do nothing
    returning 1
  ) select count(*) into v_creados from nuevas;

  -- d) Ubicación actual del equipo (IE36)
  update corr_seguimientos s set ubicacion = i.ubicacion
  from corr.par_inventario i
  where i.equipo = s.equipo and not s.terminado and i.ubicacion is not null
    and s.ubicacion is distinct from i.ubicacion;

  insert into corr_seguimientos_log (accion, detalle)
  values ('sync', format('creados %s · vinculados %s · avisos app %s', v_creados, v_vinculados, v_manual_app));

  return jsonb_build_object('creados', v_creados, 'vinculados', v_vinculados, 'avisos_app', v_manual_app);
end $$;
revoke execute on function public.corr_sync_seguimientos() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4. Listado (con alertas) — filtra por permisos
-- ------------------------------------------------------------
create or replace function public.corr_seg_listar()
returns table (
  id uuid, equipo text, denominacion text, orden bigint, aviso bigint, origen text, descripcion text,
  ubicacion text, zona text, status_usuario text, status_sistema text, abierta_sap boolean, fecha_entrada date,
  dias_abierta int, terminado boolean, terminado_en timestamptz, motivo_termino text, creado_en timestamptz,
  cant_novedades int, ult_texto text, ult_situacion text, ult_responsable text, ult_compromiso date,
  ult_autor text, ult_fecha timestamptz, dias_sin_novedad int, alertas text[]
) language sql stable security definer set search_path = public as $$
  with par as (select dias_sin_seguimiento d from corr_seg_parametros limit 1),
  base as (
    select s.*, o.status_usuario, o.status_sistema, o.abierta, o.fecha_entrada, o.equipo as equipo_sap,
           inv.denominacion as den,
           (select z.nombre from insp_ubicaciones iu join insp_zonas z on z.id = iu.zona_id where iu.ubicacion_sap = s.ubicacion limit 1) as zona,
           (select x.equipo from corr.ordenes x where s.aviso is not null and x.aviso = s.aviso and x.equipo is distinct from s.equipo limit 1) as equipo_aviso_sap,
           n.*
    from corr_seguimientos s
    left join corr.ordenes o on o.orden = s.orden
    left join corr.par_inventario inv on inv.equipo = s.equipo
    left join lateral (
      select count(*) over () ::int as cant, nv.texto, nv.situacion, r.nombre as resp, nv.fecha_compromiso,
             u.nombre_completo as autor_nombre, nv.creado_en as nfecha
      from corr_novedades nv
      left join corr_responsables r on r.id = nv.responsable_id
      left join usuarios u on u.id = nv.autor
      where nv.seguimiento_id = s.id
      order by nv.creado_en desc limit 1
    ) n on true
    where (not s.terminado or s.terminado_en >= now() - interval '7 days')
      and corr_seg_puede_ver(s.ubicacion)
  )
  select b.id, b.equipo, b.den, b.orden, b.aviso, b.origen, b.descripcion, b.ubicacion, b.zona,
         b.status_usuario, b.status_sistema, b.abierta, b.fecha_entrada,
         (corr_hoy() - coalesce(b.fecha_entrada, (b.creado_en at time zone 'America/Asuncion')::date))::int,
         b.terminado, b.terminado_en, b.motivo_termino, b.creado_en,
         coalesce(b.cant, 0), b.texto, b.situacion, b.resp, b.fecha_compromiso, b.autor_nombre, b.nfecha,
         (corr_hoy() - (coalesce(b.nfecha, b.creado_en) at time zone 'America/Asuncion')::date)::int,
         array_remove(array[
           case when not b.terminado and coalesce(b.nfecha, b.creado_en) < now() - make_interval(days => (select d from par)) then 'sin_seguimiento' end,
           case when not b.terminado and b.fecha_compromiso < corr_hoy() then 'compromiso_vencido' end,
           case when not b.terminado and b.orden is not null and b.abierta = false then 'cerrada_sap_con_seguimiento' end,
           case when not b.terminado and b.status_usuario = '0TES' and b.situacion in ('en_reparacion','esperando_repuesto','listo_para_liberar') then 'otes_con_trabajo' end,
           case when (b.equipo_sap is not null and b.equipo_sap <> b.equipo) or b.equipo_aviso_sap is not null then 'equipo_distinto' end,
           case when b.terminado and b.abierta = true then 'terminado_abierta_sap' end
         ], null)
  from base b
$$;

create or replace function public.corr_seg_novedades(p_id uuid)
returns table (id uuid, texto text, situacion text, responsable text, fecha_compromiso date, autor text, creado_en timestamptz)
language sql stable security definer set search_path = public as $$
  select n.id, n.texto, n.situacion, r.nombre, n.fecha_compromiso, u.nombre_completo, n.creado_en
  from corr_novedades n
  join corr_seguimientos s on s.id = n.seguimiento_id
  left join corr_responsables r on r.id = n.responsable_id
  left join usuarios u on u.id = n.autor
  where n.seguimiento_id = p_id and corr_seg_puede_ver(s.ubicacion)
  order by n.creado_en desc
$$;

create or replace function public.corr_seg_responsables()
returns table (id int, nombre text) language sql stable security definer set search_path = public as $$
  select id, nombre from corr_responsables where activo and corr_seg_usuario() is not null order by orden, nombre
$$;

-- ------------------------------------------------------------
-- 5. Escritura
-- ------------------------------------------------------------
create or replace function public.corr_seg_agregar_novedad(
  p_seguimiento uuid, p_texto text, p_situacion text, p_responsable int default null, p_fecha_compromiso date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_u uuid := corr_seg_usuario(); v_ubic text; v_id uuid;
begin
  if v_u is null then raise exception 'Usuario no habilitado'; end if;
  select ubicacion into v_ubic from corr_seguimientos where id = p_seguimiento;
  if not found then raise exception 'Seguimiento inexistente'; end if;
  if not (correctivos_puede_gestionar() or v_ubic in (select corr_seg_mis_ubicaciones())) then
    raise exception 'No tenés permiso para cargar novedades en este equipo';
  end if;
  if p_fecha_compromiso is not null and p_fecha_compromiso < corr_hoy() then
    raise exception 'La fecha compromiso no puede ser anterior a hoy';
  end if;
  insert into corr_novedades (seguimiento_id, texto, situacion, responsable_id, fecha_compromiso, autor)
  values (p_seguimiento, trim(p_texto), p_situacion, p_responsable, p_fecha_compromiso, v_u)
  returning id into v_id;
  update corr_seguimientos set actualizado_en = now() where id = p_seguimiento;
  return v_id;
end $$;

-- Alta manual de un aviso. Si ya existe un hilo con ese aviso, devuelve ese hilo (existente = true).
create or replace function public.corr_seg_alta_aviso(
  p_equipo text, p_aviso bigint, p_descripcion text,
  p_texto text default null, p_situacion text default null, p_responsable int default null, p_fecha_compromiso date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_u uuid := corr_seg_usuario(); v_eq text := upper(trim(p_equipo)); v_ubic text; v_id uuid;
begin
  if v_u is null then raise exception 'Usuario no habilitado'; end if;
  if p_aviso is null or p_aviso::text !~ '^1\d{7}$' then raise exception 'El aviso debe tener 8 dígitos y empezar con 1'; end if;
  select id into v_id from corr_seguimientos where aviso = p_aviso;
  if found then return jsonb_build_object('id', v_id, 'existente', true); end if;
  select ubicacion into v_ubic from corr.par_inventario where equipo = v_eq;
  if not found then raise exception 'El equipo % no está en el inventario SAP', v_eq; end if;
  if not (correctivos_puede_gestionar() or v_ubic in (select corr_seg_mis_ubicaciones())) then
    raise exception 'El equipo % no está en tu obra', v_eq;
  end if;
  insert into corr_seguimientos (equipo, aviso, origen, descripcion, ubicacion, creado_por)
  values (v_eq, p_aviso, 'manual', nullif(trim(p_descripcion), ''), v_ubic, v_u)
  returning id into v_id;
  if nullif(trim(p_texto), '') is not null and p_situacion is not null then
    perform corr_seg_agregar_novedad(v_id, p_texto, p_situacion, p_responsable, p_fecha_compromiso);
  end if;
  perform corr_sync_seguimientos();  -- por si la orden de ese aviso ya existe en SAP
  return jsonb_build_object('id', v_id, 'existente', false);
end $$;

create or replace function public.corr_seg_terminar(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not correctivos_puede_gestionar() then raise exception 'Solo el encargado puede terminar un seguimiento'; end if;
  if nullif(trim(p_motivo), '') is null then raise exception 'Indicá el motivo'; end if;
  update corr_seguimientos set terminado = true, terminado_por = corr_seg_usuario(), terminado_en = now(),
    motivo_termino = trim(p_motivo), actualizado_en = now()
  where id = p_id and not terminado;
end $$;

create or replace function public.corr_seg_reabrir(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not correctivos_puede_gestionar() then raise exception 'Solo el encargado puede reabrir un seguimiento'; end if;
  update corr_seguimientos set terminado = false, terminado_por = null, terminado_en = null,
    motivo_termino = null, actualizado_en = now()
  where id = p_id and terminado;
end $$;

-- ------------------------------------------------------------
-- 6. Resumen diario para Telegram (n8n con service_role, o un usuario que ve todo)
-- ------------------------------------------------------------
create or replace function public.corr_html(x text)
returns text language sql immutable set search_path = '' as $$
  select replace(replace(replace(coalesce(x, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
$$;

create or replace function public.corr_resumen_diario(p_fecha date default null)
returns text language plpgsql stable security definer set search_path = public as $$
-- Texto en HTML de Telegram (parse_mode = HTML). Todo texto libre pasa por h().
declare
  v_f date := coalesce(p_fecha, corr_hoy() - 1);
  v_dias int := (select dias_sin_seguimiento from corr_seg_parametros limit 1);
  t text := ''; r record; n int; v_lineas text;
  etq jsonb := '{"diagnostico":"Diagnóstico","esperando_cotizacion":"Esp. cotización","esperando_aprobacion":"Esp. aprobación","esperando_repuesto":"Esp. repuesto","en_reparacion":"En reparación","en_traslado":"En traslado","listo_para_liberar":"Listo p/ liberar"}';
begin
  if auth.email() is not null and not corr_seg_ve_todo() then raise exception 'Sin permiso'; end if;

  t := format('<b>Correctivos · %s</b>', to_char(v_f, 'DD/MM')) || E'\n';

  -- 1. Novedades del día por obra
  select count(*) into n from corr_novedades where (creado_en at time zone 'America/Asuncion')::date = v_f;
  t := t || E'\n' || format('<b>Novedades (%s)</b>', n) || E'\n';
  if n = 0 then t := t || '— ninguna' || E'\n'; end if;
  for r in
    select coalesce(s.ubicacion, '(sin ubicación)') ub,
           string_agg(format('• <b>%s</b> · %s · %s: %s (%s)', corr_html(s.equipo), coalesce(s.orden::text, 'aviso ' || s.aviso),
             etq ->> nv.situacion, corr_html(left(nv.texto, 90)), corr_html(split_part(coalesce(u.nombre_completo, '?'), ' ', 1))),
             E'\n' order by s.equipo, nv.creado_en) l
    from corr_novedades nv join corr_seguimientos s on s.id = nv.seguimiento_id
    left join usuarios u on u.id = nv.autor
    where (nv.creado_en at time zone 'America/Asuncion')::date = v_f
    group by 1 order by 1
  loop
    t := t || format('<i>%s</i>', corr_html(r.ub)) || E'\n' || r.l || E'\n';
  end loop;

  -- 2. Compromisos vencidos (última novedad de hilos abiertos)
  with ult as (
    select distinct on (nv.seguimiento_id) nv.seguimiento_id, nv.fecha_compromiso, rr.nombre resp
    from corr_novedades nv left join corr_responsables rr on rr.id = nv.responsable_id
    order by nv.seguimiento_id, nv.creado_en desc
  )
  select count(*), string_agg(format('• <b>%s</b> · %s · %s · venció %s', corr_html(s.equipo), coalesce(s.orden::text, 'aviso ' || s.aviso),
           corr_html(coalesce(u.resp, 's/resp.')), to_char(u.fecha_compromiso, 'DD/MM')), E'\n' order by u.fecha_compromiso)
  into n, v_lineas
  from ult u join corr_seguimientos s on s.id = u.seguimiento_id
  where not s.terminado and u.fecha_compromiso < corr_hoy();
  t := t || E'\n' || format('<b>Compromisos vencidos (%s)</b>', n) || E'\n' || coalesce(v_lineas, '— ninguno') || E'\n';

  -- 3. Sin seguimiento por obra
  with ult as (select seguimiento_id, max(creado_en) f from corr_novedades group by 1)
  select count(*) into n
  from corr_seguimientos s left join ult u on u.seguimiento_id = s.id
  where not s.terminado and coalesce(u.f, s.creado_en) < now() - make_interval(days => v_dias);
  t := t || E'\n' || format('<b>Sin novedad hace más de %s días (%s)</b>', v_dias, n) || E'\n';
  for r in
    with ult as (select seguimiento_id, max(creado_en) f from corr_novedades group by 1)
    select coalesce(s.ubicacion, '(sin ubicación)') ub, count(*) c
    from corr_seguimientos s left join ult u on u.seguimiento_id = s.id
    where not s.terminado and coalesce(u.f, s.creado_en) < now() - make_interval(days => v_dias)
    group by 1 order by 2 desc limit 8
  loop
    t := t || format('• %s: %s', corr_html(r.ub), r.c) || E'\n';
  end loop;

  -- 4. Alertas de consistencia con SAP
  select count(*), string_agg(format('• %s · %s', corr_html(s.equipo), s.orden), E'\n' order by s.orden)
  into n, v_lineas
  from corr_seguimientos s join corr.ordenes o on o.orden = s.orden
  where not s.terminado and not o.abierta;
  if n > 0 then
    t := t || E'\n' || format('<b>Cerradas en SAP con seguimiento abierto (%s)</b>', n) || E'\n' || left(v_lineas, 600) || E'\n';
  end if;

  select count(*), string_agg(format('• %s · %s', corr_html(s.equipo), s.orden), E'\n' order by s.orden)
  into n, v_lineas
  from corr_seguimientos s join corr.ordenes o on o.orden = s.orden
  where not s.terminado and o.status_usuario = '0TES'
    and (select nv.situacion from corr_novedades nv where nv.seguimiento_id = s.id order by nv.creado_en desc limit 1)
        in ('en_reparacion', 'esperando_repuesto', 'listo_para_liberar');
  if n > 0 then
    t := t || E'\n' || format('<b>0TES con reparación en curso (%s)</b>', n) || E'\n' || left(v_lineas, 600) || E'\n';
  end if;

  select count(*), string_agg(format('• %s · %s', corr_html(s.equipo), s.orden), E'\n' order by s.orden)
  into n, v_lineas
  from corr_seguimientos s join corr.ordenes o on o.orden = s.orden
  where s.terminado and o.abierta;
  if n > 0 then
    t := t || E'\n' || format('<b>Terminadas en la app, abiertas en SAP (%s)</b>', n) || E'\n' || left(v_lineas, 600) || E'\n';
  end if;

  t := t || E'\nDetalle: app → Correctivos → Seguimiento.';
  if length(t) > 3900 then t := left(t, 3880) || E'\n… (recortado)'; end if;
  return t;
end $$;

-- ------------------------------------------------------------
-- 7. Grants
-- ------------------------------------------------------------
revoke execute on function public.corr_seg_usuario(), public.corr_seg_ve_todo(), public.corr_seg_mis_ubicaciones(),
  public.corr_seg_puede_ver(text) from public, anon;
grant execute on function public.corr_seg_permisos(), public.corr_seg_listar(), public.corr_seg_novedades(uuid),
  public.corr_seg_responsables(), public.corr_seg_agregar_novedad(uuid, text, text, int, date),
  public.corr_seg_alta_aviso(text, bigint, text, text, text, int, date),
  public.corr_seg_terminar(uuid, text), public.corr_seg_reabrir(uuid), public.corr_resumen_diario(date)
  to authenticated;
revoke execute on function public.corr_seg_permisos(), public.corr_seg_listar(), public.corr_seg_novedades(uuid),
  public.corr_seg_responsables(), public.corr_seg_agregar_novedad(uuid, text, text, int, date),
  public.corr_seg_alta_aviso(text, bigint, text, text, text, int, date),
  public.corr_seg_terminar(uuid, text), public.corr_seg_reabrir(uuid), public.corr_resumen_diario(date)
  from public, anon;

-- ------------------------------------------------------------
-- 8. Programación: la sync corre cada 2 horas (después de las ingestas SAP)
-- ------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'corr_sync_seguimientos';
select cron.schedule('corr_sync_seguimientos', '20 */2 * * *', 'select public.corr_sync_seguimientos()');
