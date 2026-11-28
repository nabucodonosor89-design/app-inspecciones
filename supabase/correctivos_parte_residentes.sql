-- ============================================================
-- CORRECTIVOS — Parte diario de los residentes desde la app (24/11/2026)
-- Spec: proyecto «APP DE INSPECCIONES» → claude/prompt-cowork-parte-diario-residentes.md
--
-- 1. Hilos sin aviso: un residente reporta un problema sin N° de aviso (origen 'residente').
-- 2. corr_seg_completar_aviso: David carga el aviso en ese hilo; si ya hay un hilo con
--    ese aviso, se fusionan (un aviso = un hilo).
-- 3. Permisos de residentes: ven, cargan y terminan los hilos donde participan
--    (los dieron de alta, los reportaron o cargaron novedades), aunque el equipo
--    esté en otra obra según SAP. Reabrir sigue siendo solo del encargado.
-- 4. Alerta 'ubicacion_distinta': hilo reportado por un residente sobre un equipo
--    que SAP (IE36) ubica fuera de su zona.
-- 5. corr_parte_residente(): datos del parte del día del residente logueado.
-- 6. corr_resumen_diario: muestra «sin aviso» en vez de vacío.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tabla
-- ------------------------------------------------------------
alter table corr_seguimientos add column if not exists reportado_por uuid references usuarios(id);
comment on column corr_seguimientos.reportado_por is
  'Quién reportó el problema (alta manual o fusión). Sirve para el parte del residente y la alerta ubicacion_distinta.';

alter table corr_seguimientos drop constraint if exists corr_seguimientos_origen_check;
alter table corr_seguimientos add constraint corr_seguimientos_origen_check
  check (origen in ('sap', 'manual', 'residente'));

alter table corr_seguimientos drop constraint if exists corr_seguimientos_check;
alter table corr_seguimientos add constraint corr_seguimientos_check
  check (orden is not null or aviso is not null or origen = 'residente');

-- Los avisos manuales cargados antes de hoy: quien los dio de alta los reportó
update corr_seguimientos set reportado_por = creado_por
where reportado_por is null and creado_por is not null and origen = 'manual';

create index if not exists corr_novedades_autor_idx on corr_novedades (autor, seguimiento_id);

-- ------------------------------------------------------------
-- 2. Helpers
-- ------------------------------------------------------------
-- Ubicaciones SAP de la zona de residente vigente de un usuario
create or replace function corr_seg_ubicaciones_de(p_usuario uuid)
returns setof text language sql stable security definer set search_path = public as $$
  select distinct iu.ubicacion_sap
  from insp_zona_inspectores zi
  join usuarios u on u.id = zi.usuario_id and u.activo = true
  join insp_zonas z on z.id = zi.zona_id and z.tipo = 'residente'
  join insp_ubicaciones iu on iu.zona_id = z.id
  where zi.usuario_id = p_usuario
    and (zi.desde is null or zi.desde <= corr_hoy())
    and (zi.hasta is null or zi.hasta >= corr_hoy())
$$;
revoke execute on function corr_seg_ubicaciones_de(uuid) from public, anon, authenticated;

-- ¿El usuario participa del hilo? (lo dio de alta, lo reportó o cargó novedades)
create or replace function corr_seg_participa(p_id uuid, p_usuario uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  with u as (select coalesce(p_usuario, corr_seg_usuario()) as id)
  select coalesce((select u.id from u) is not null and (
           exists (select 1 from corr_seguimientos s, u
                   where s.id = p_id and (s.creado_por = u.id or s.reportado_por = u.id))
        or exists (select 1 from corr_novedades n, u
                   where n.seguimiento_id = p_id and n.autor = u.id)
         ), false)
$$;
revoke execute on function corr_seg_participa(uuid, uuid) from public, anon;
grant execute on function corr_seg_participa(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 3. Alta de aviso: N° opcional, residentes en cualquier equipo
-- ------------------------------------------------------------
create or replace function public.corr_seg_alta_aviso(p_equipo text, p_aviso bigint, p_descripcion text,
  p_texto text default null, p_situacion text default null, p_responsable integer default null,
  p_fecha_compromiso date default null)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_u uuid := corr_seg_usuario();
  v_eq text := upper(trim(p_equipo));
  v_res boolean := exists (select corr_seg_mis_ubicaciones());
  v_ubic text; v_id uuid;
begin
  if v_u is null then raise exception 'Usuario no habilitado'; end if;
  if not (correctivos_puede_gestionar() or v_res) then
    raise exception 'No tenés permiso para reportar problemas';
  end if;
  if p_aviso is not null and p_aviso::text !~ '^1\d{7}$' then
    raise exception 'El aviso debe tener 8 dígitos y empezar con 1';
  end if;
  if p_aviso is null and nullif(trim(p_descripcion), '') is null then
    raise exception 'Describí el problema';
  end if;

  if p_aviso is not null then
    select id into v_id from corr_seguimientos where aviso = p_aviso;
    if found then
      -- quien lo reporta pasa a participar del hilo existente
      update corr_seguimientos set reportado_por = coalesce(reportado_por, v_u) where id = v_id;
      return jsonb_build_object('id', v_id, 'existente', true);
    end if;
  end if;

  select ubicacion into v_ubic from corr.par_inventario where equipo = v_eq;
  if not found then raise exception 'El equipo % no está en el inventario SAP', v_eq; end if;
  -- Decisión 24/11/2026: el residente puede reportar equipos que SAP ubica en otra obra
  -- (queda la alerta ubicacion_distinta para corregir la ubicación técnica).

  insert into corr_seguimientos (equipo, aviso, origen, descripcion, ubicacion, creado_por, reportado_por)
  values (v_eq, p_aviso, case when p_aviso is null then 'residente' else 'manual' end,
          nullif(trim(p_descripcion), ''), v_ubic, v_u, v_u)
  returning id into v_id;

  insert into corr_seguimientos_log (accion, seguimiento_id, equipo, detalle)
  values ('alta', v_id, v_eq, coalesce('aviso ' || p_aviso, 'sin aviso') || ' · ' || coalesce(nullif(trim(p_descripcion), ''), '—'));

  if nullif(trim(p_texto), '') is not null and p_situacion is not null then
    perform corr_seg_agregar_novedad(v_id, p_texto, p_situacion, p_responsable, p_fecha_compromiso);
  end if;
  perform corr_sync_seguimientos();
  return jsonb_build_object('id', v_id, 'existente', false);
end $function$;
revoke execute on function corr_seg_alta_aviso(text, bigint, text, text, text, integer, date) from public, anon;
grant execute on function corr_seg_alta_aviso(text, bigint, text, text, text, integer, date) to authenticated;

-- ------------------------------------------------------------
-- 4. Completar el aviso de un hilo sin aviso (con fusión)
-- ------------------------------------------------------------
create or replace function public.corr_seg_completar_aviso(p_id uuid, p_aviso bigint)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_u uuid := corr_seg_usuario();
  s corr_seguimientos%rowtype;
  t corr_seguimientos%rowtype;
  v_eq_aviso text;
  v_n int;
begin
  if not correctivos_puede_gestionar() then raise exception 'Solo el encargado puede cargar el N° de aviso'; end if;
  if p_aviso is null or p_aviso::text !~ '^1\d{7}$' then
    raise exception 'El aviso debe tener 8 dígitos y empezar con 1';
  end if;

  select * into s from corr_seguimientos where id = p_id for update;
  if not found then raise exception 'Seguimiento inexistente'; end if;
  if s.terminado then raise exception 'El seguimiento está terminado'; end if;
  if s.aviso is not null then raise exception 'Este seguimiento ya tiene el aviso %', s.aviso; end if;
  if s.orden is not null then raise exception 'Este seguimiento ya tiene la orden %', s.orden; end if;

  -- Equipo del aviso: SAP (si ya tiene orden) o el correctivo de la app
  select o.equipo into v_eq_aviso from corr.ordenes o where o.aviso = p_aviso and o.equipo is not null limit 1;
  if v_eq_aviso is null then
    select e.numero_identificacion into v_eq_aviso
    from mantenimientos m join equipos e on e.id = m.equipo_id
    where corr_norm(m.numero_aviso) = p_aviso::text limit 1;
  end if;
  if v_eq_aviso is not null and upper(v_eq_aviso) <> upper(s.equipo) then
    raise exception 'El aviso % es del equipo % y este seguimiento es de %', p_aviso, v_eq_aviso, s.equipo;
  end if;

  select * into t from corr_seguimientos where aviso = p_aviso and id <> p_id for update;
  if not found then
    update corr_seguimientos set aviso = p_aviso, actualizado_en = now() where id = p_id;
    insert into corr_seguimientos_log (accion, seguimiento_id, equipo, detalle)
    values ('completa_aviso', p_id, s.equipo, format('aviso %s cargado en el reporte', p_aviso));
    perform corr_sync_seguimientos(); -- si el aviso ya tiene orden SAP, la vincula
    return jsonb_build_object('id', p_id, 'fusionado', false);
  end if;

  -- Ya existe un hilo con ese aviso → se fusiona en ese (un aviso, un hilo)
  if t.terminado then
    raise exception 'El aviso % ya tiene un seguimiento terminado: reabrilo primero', p_aviso;
  end if;
  if upper(t.equipo) <> upper(s.equipo) then
    raise exception 'El aviso % ya tiene seguimiento con el equipo % (este es de %)', p_aviso, t.equipo, s.equipo;
  end if;

  update corr_novedades set seguimiento_id = t.id where seguimiento_id = s.id;
  get diagnostics v_n = row_count;
  update corr_seguimientos
     set reportado_por = coalesce(reportado_por, s.reportado_por, s.creado_por),
         descripcion = coalesce(nullif(trim(descripcion), ''), s.descripcion),
         actualizado_en = now()
   where id = t.id;
  update corr_seguimientos
     set terminado = true, terminado_por = v_u, terminado_en = now(), actualizado_en = now(),
         motivo_termino = format('Fusionado con el seguimiento del aviso %s', p_aviso)
   where id = s.id;
  insert into corr_seguimientos_log (accion, seguimiento_id, equipo, detalle)
  values ('fusiona', t.id, s.equipo, format('reporte %s (sin aviso) → aviso %s · %s novedades movidas', s.id, p_aviso, v_n));
  return jsonb_build_object('id', t.id, 'fusionado', true, 'novedades_movidas', v_n);
end $function$;
revoke execute on function corr_seg_completar_aviso(uuid, bigint) from public, anon;
grant execute on function corr_seg_completar_aviso(uuid, bigint) to authenticated;

-- ------------------------------------------------------------
-- 5. Permisos: ver / cargar / terminar con participación
-- ------------------------------------------------------------
create or replace function public.corr_seg_agregar_novedad(p_seguimiento uuid, p_texto text, p_situacion text,
  p_responsable integer default null, p_fecha_compromiso date default null)
returns uuid language plpgsql security definer set search_path = public as $function$
declare v_u uuid := corr_seg_usuario(); v_ubic text; v_id uuid;
begin
  if v_u is null then raise exception 'Usuario no habilitado'; end if;
  select ubicacion into v_ubic from corr_seguimientos where id = p_seguimiento;
  if not found then raise exception 'Seguimiento inexistente'; end if;
  if not (correctivos_puede_gestionar()
          or v_ubic in (select corr_seg_mis_ubicaciones())
          or corr_seg_participa(p_seguimiento, v_u)) then
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
end $function$;

create or replace function public.corr_seg_terminar(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $function$
begin
  if not (correctivos_puede_gestionar() or corr_seg_participa(p_id)) then
    raise exception 'Solo el encargado o quien reportó / cargó novedades puede terminar este seguimiento';
  end if;
  if nullif(trim(p_motivo), '') is null then raise exception 'Indicá el motivo'; end if;
  update corr_seguimientos set terminado = true, terminado_por = corr_seg_usuario(), terminado_en = now(),
    motivo_termino = trim(p_motivo), actualizado_en = now()
  where id = p_id and not terminado;
end $function$;

create or replace function public.corr_seg_novedades(p_id uuid)
returns table(id uuid, texto text, situacion text, responsable text, fecha_compromiso date, autor text, creado_en timestamptz)
language sql stable security definer set search_path = public as $function$
  select n.id, n.texto, n.situacion, r.nombre, n.fecha_compromiso, u.nombre_completo, n.creado_en
  from corr_novedades n
  join corr_seguimientos s on s.id = n.seguimiento_id
  left join corr_responsables r on r.id = n.responsable_id
  left join usuarios u on u.id = n.autor
  where n.seguimiento_id = p_id and (corr_seg_puede_ver(s.ubicacion) or corr_seg_participa(p_id))
  order by n.creado_en desc
$function$;

-- mis_hilos: hilos abiertos donde participa el usuario (para mostrar «Terminar» al residente)
create or replace function public.corr_seg_permisos()
returns jsonb language sql stable security definer set search_path = public as $function$
  with u as (select corr_seg_usuario() as id)
  select jsonb_build_object(
    've_todo', corr_seg_ve_todo(),
    'gestiona', correctivos_puede_gestionar(),
    'residente', exists (select corr_seg_mis_ubicaciones()),
    'ubicaciones', coalesce((select jsonb_agg(x) from corr_seg_mis_ubicaciones() x), '[]'::jsonb),
    'mis_hilos', coalesce((
      select jsonb_agg(distinct s.id)
      from corr_seguimientos s, u
      where not s.terminado and u.id is not null
        and (s.creado_por = u.id or s.reportado_por = u.id
             or exists (select 1 from corr_novedades n where n.seguimiento_id = s.id and n.autor = u.id))
    ), '[]'::jsonb)
  )
$function$;

-- corr_seg_listar: misma salida; ve también los hilos donde participa y suma la alerta ubicacion_distinta
create or replace function public.corr_seg_listar()
returns table(id uuid, equipo text, denominacion text, orden bigint, aviso bigint, origen text, descripcion text, ubicacion text, zona text, status_usuario text, status_sistema text, abierta_sap boolean, fecha_entrada date, dias_abierta integer, terminado boolean, terminado_en timestamptz, motivo_termino text, creado_en timestamptz, cant_novedades integer, ult_texto text, ult_situacion text, ult_responsable text, ult_compromiso date, ult_autor text, ult_fecha timestamptz, dias_sin_novedad integer, alertas text[])
language sql stable security definer set search_path = public as $function$
  with par as (select dias_sin_seguimiento d from corr_seg_parametros limit 1),
  base as (
    select s.*, o.status_usuario, o.status_sistema, o.abierta, o.fecha_entrada, o.equipo as equipo_sap,
           inv.denominacion as den,
           (select z.nombre from insp_ubicaciones iu join insp_zonas z on z.id = iu.zona_id where iu.ubicacion_sap = s.ubicacion limit 1) as zona,
           (select x.equipo from corr.ordenes x where s.aviso is not null and x.aviso = s.aviso and x.equipo is distinct from s.equipo limit 1) as equipo_aviso_sap,
           (s.reportado_por is not null and not s.terminado
              and exists (select 1 from corr_seg_ubicaciones_de(s.reportado_por))
              and coalesce(s.ubicacion, '') not in (select corr_seg_ubicaciones_de(s.reportado_por))) as ubic_distinta,
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
      and (corr_seg_puede_ver(s.ubicacion) or corr_seg_participa(s.id))
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
           case when b.terminado and b.abierta = true then 'terminado_abierta_sap' end,
           case when b.ubic_distinta then 'ubicacion_distinta' end
         ], null)
  from base b
$function$;

-- ------------------------------------------------------------
-- 6. Parte del día del residente logueado
-- ------------------------------------------------------------
create or replace function public.corr_parte_residente(p_fecha date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
  v_u uuid := corr_seg_usuario();
  v_fecha date := coalesce(p_fecha, corr_hoy());
  v_res jsonb;
begin
  if v_u is null then raise exception 'Usuario no habilitado'; end if;

  with zonas as (
    select string_agg(distinct z.nombre, ' / ') as nombres
    from insp_zona_inspectores zi
    join insp_zonas z on z.id = zi.zona_id and z.tipo = 'residente'
    where zi.usuario_id = v_u
      and (zi.desde is null or zi.desde <= corr_hoy())
      and (zi.hasta is null or zi.hasta >= corr_hoy())
  ),
  mis_ubic as (select corr_seg_ubicaciones_de(v_u) as u),
  ext as (
    select corr_norm(m.numero_orden) as o_n, corr_norm(m.numero_aviso) as a_n,
           coalesce(nullif(trim(m.taller_tercero), ''), 'sin nombre') as taller
    from mantenimientos m
    where m.tipo_mantenimiento = 'Correctivo'
      and m.estado in ('Taller Espera', 'Taller Entrada')
      and m.ingresa_taller_ypane = false
  ),
  h as (
    select s.*
    from corr_seguimientos s
    where not s.terminado
      and (s.creado_por = v_u or s.reportado_por = v_u
           or exists (select 1 from corr_novedades n where n.seguimiento_id = s.id and n.autor = v_u))
  ),
  filas as (
    select h.equipo, h.creado_en,
      jsonb_build_object(
        'seguimiento_id', h.id,
        'equipo', h.equipo,
        'denominacion', inv.denominacion,
        'descripcion', coalesce(nullif(trim(h.descripcion), ''), o.texto),
        'orden', h.orden,
        'aviso', h.aviso,
        'sin_aviso', h.orden is null and h.aviso is null,
        'dias_sin_orden', case when h.orden is null and h.aviso is not null
                               then corr_hoy() - (h.creado_en at time zone 'America/Asuncion')::date end,
        'situacion', n.situacion,
        'ultima_novedad_texto', n.texto,
        'ultima_novedad_en', n.creado_en,
        'novedad_del_dia', n.creado_en is not null and (n.creado_en at time zone 'America/Asuncion')::date >= v_fecha,
        'ubicacion', h.ubicacion,
        'ubicacion_distinta', exists (select 1 from mis_ubic) and coalesce(h.ubicacion, '') not in (select u from mis_ubic),
        'taller_externo', (select x.taller from ext x
                           where (h.orden is not null and x.o_n = h.orden::text)
                              or (h.aviso is not null and x.a_n = h.aviso::text) limit 1)
      ) as item
    from h
    left join corr.ordenes o on o.orden = h.orden
    left join corr.par_inventario inv on inv.equipo = h.equipo
    left join lateral (
      select nv.texto, nv.situacion, nv.creado_en
      from corr_novedades nv
      where nv.seguimiento_id = h.id and nv.autor = v_u
      order by nv.creado_en desc limit 1
    ) n on true
  )
  select jsonb_build_object(
    'fecha', v_fecha,
    'encabezado', (select nombres from zonas),
    'items', coalesce((select jsonb_agg(f.item order by f.equipo, f.creado_en) from filas f), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $function$;
revoke execute on function corr_parte_residente(date) from public, anon;
grant execute on function corr_parte_residente(date) to authenticated;

-- ------------------------------------------------------------
-- 7. Resumen diario (Telegram): «sin aviso» en vez de vacío
-- ------------------------------------------------------------
do $$
declare v_def text := pg_get_functiondef('public.corr_resumen_diario'::regproc);
        v_nuevo text;
begin
  v_nuevo := replace(v_def, 'coalesce(s.orden::text, ''aviso '' || s.aviso)',
                            'coalesce(s.orden::text, ''aviso '' || s.aviso, ''sin aviso'')');
  if v_nuevo <> v_def then execute v_nuevo; end if;
end $$;
