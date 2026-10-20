-- ============================================================
-- BANDEJA DE PREVENTIVOS (IP30) — reemplaza a "Completar órdenes IP30"
-- Requiere services_equipo_orden_sap.sql. Idempotente. Aplicado en Supabase el 20/10/2026.
--
-- Una fila por ORDEN TCPV (clave = N° de orden) que llegó en algún IP30 subido o que se importó
-- de la planilla "Seguimiento de Órdenes" (filas de 2026). Al re-subir el IP30 solo se actualizan
-- los datos SAP; lo que carga la encargada (estado, nueva fecha, próximo mantenimiento, notas) no se pisa.
--
-- H (próximo mantenimiento): lo carga la encargada desde SAP (prox_mantto + unidad). Si no lo cargó,
--   se calcula con el último mantenimiento + período del equipo (si existen).
-- J (falta/pasó) = H − lectura actual. Lectura: último parte diario válido en la unidad; si no hay o no
--   sirve, la última carga de combustible SAP. Una lectura no sirve si es anterior al último mantenimiento
--   o menor que su contador.
-- Umbral: obra lejana (insp_ubicaciones.lejana) 70 h / 2.000 km; resto 50 h / 700 km.
-- Estado sugerido: CTEC/CERR → concluido; J ≤ umbral → programado; J > umbral → reprogramado.
-- Estados confirmados: programado | reprogramado (con nueva fecha) | concluido | cancelado | verificar.
--
-- Fecha de cierre de una orden: sap_ordenes.fecha_fin_real si viene (casi nunca en TCPV); si no, el día
--   en que la ingesta de Trabajo detectó el paso del status de usuario a 9EQL (sap_ordenes_eventos,
--   registrado desde el 07/10/2026). Sin ninguna de las dos → "cerrada sin fecha".
--
-- Acceso: usuarios.ve_completar_ordenes (puede_completar_ordenes()). Tablas con RLS, solo por RPC.
-- ip30_sync_cierres(p_dry_run): service_role (n8n) o usuarios con el permiso.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Obras lejanas
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'insp_ubicaciones' and column_name = 'lejana') then
    alter table public.insp_ubicaciones add column lejana boolean not null default false;
    update public.insp_ubicaciones set lejana = true
     where ubicacion_sap in ('RUTA 17 OBRA DE LA SOBERANIA', 'CANTERA SOBERANIA', 'RUTA 13', 'Obra Paracel');
  end if;
end $$;
comment on column public.insp_ubicaciones.lejana is 'Obra lejana (el flete tarda): umbral de preventivo 70 h / 2.000 km en lugar de 50 h / 700 km';

create or replace function public.ip30_umbral(p_lejana boolean, p_unidad text)
returns numeric language sql immutable
as $$ select case when p_unidad = 'km' then case when p_lejana then 2000 else 700 end
                  else case when p_lejana then 70 else 50 end end::numeric $$;

-- ------------------------------------------------------------
-- 1. Tablas
-- ------------------------------------------------------------
create table if not exists public.ip30_ordenes (
  orden bigint primary key,
  -- datos SAP (se actualizan en cada subida)
  equipo text,                -- ID técnico
  equipo_sap bigint,
  clase text,
  fecha_plan date,            -- Fe/inic/extrema
  texto text,
  fecha_plan_anterior date,   -- la fecha plan que tenía antes del último cambio
  primera_carga timestamptz not null default now(),
  ultima_carga timestamptz,
  en_ultimo_ip30 boolean not null default false,
  origen text not null default 'ip30' check (origen in ('ip30', 'planilla')),
  -- lo de la encargada
  prox_mantto numeric check (prox_mantto >= 0),
  prox_unidad text check (prox_unidad in ('h', 'km')),
  prox_cargado_en timestamptz,
  prox_cargado_por uuid,
  estado_confirmado text check (estado_confirmado in ('programado', 'reprogramado', 'concluido', 'cancelado', 'verificar')),
  estado_sugerido_al_confirmar text,
  nueva_fecha date,
  estado_confirmado_en timestamptz,
  estado_confirmado_por uuid,
  notas text,
  volvio boolean not null default false,  -- reprogramada que volvió en un IP30 con otra fecha plan
  check (estado_confirmado is distinct from 'reprogramado' or nueva_fecha is not null or origen = 'planilla')
);
create index if not exists ip30_ordenes_equipo_idx on public.ip30_ordenes (equipo);

create table if not exists public.ip30_cargas (
  id bigserial primary key,
  archivo text,
  subido_por uuid,
  subido_en timestamptz not null default now(),
  n_filas int, n_nuevas int, n_actualizadas int, n_ausentes int, n_ignoradas int
);

create table if not exists public.ip30_sync_log (
  id bigserial primary key,
  ejecutado_en timestamptz not null default now(),
  dry_run boolean not null,
  orden bigint,
  equipo text,
  accion text not null,  -- RUN | vincular | crear | omitir | ERROR
  detalle jsonb
);

alter table public.ip30_ordenes  enable row level security;
alter table public.ip30_cargas   enable row level security;
alter table public.ip30_sync_log enable row level security;
revoke all on table public.ip30_ordenes, public.ip30_cargas, public.ip30_sync_log from anon, authenticated;
revoke all on sequence public.ip30_cargas_id_seq, public.ip30_sync_log_id_seq from anon, authenticated;

-- ------------------------------------------------------------
-- 2. Base por equipo (interna): ubicación, período, último mantenimiento, lecturas
--    lect_h / lect_km = lectura que se usa en cada unidad (parte válido → carga SAP válida)
-- ------------------------------------------------------------
create or replace function public.ip30_base_equipos(p_equipos text[])
returns table (
  equipo text, equipo_id uuid, denominacion text, ubicacion text, lejana boolean, ubicacion_sin_config boolean,
  periodo numeric, periodo_unidad text,
  srv_fecha date, srv_contador numeric, srv_contador_estado text,
  carga_fecha date, carga_lectura numeric,
  pd_h_fecha date, pd_h numeric, pd_km_fecha date, pd_km numeric,
  lect_h numeric, lect_h_fecha date, lect_h_fuente text, lect_h_invalida boolean,
  lect_km numeric, lect_km_fecha date, lect_km_fuente text, lect_km_invalida boolean
)
language sql stable security definer
set search_path = public
as $$
  with e as (select distinct upper(trim(x)) as equipo from unnest(p_equipos) x where coalesce(trim(x), '') <> ''),
  eq as (
    select distinct on (upper(trim(s.equipo)))
           upper(trim(s.equipo)) as equipo, s.denominacion, nullif(trim(s.ubicacion), '') as ubicacion
    from sap_equipos s join e on e.equipo = upper(trim(s.equipo))
    order by upper(trim(s.equipo)), (nullif(trim(s.ubicacion), '') is null), s.actualizado_en desc nulls last
  ),
  q as (
    select distinct on (upper(trim(q.numero_identificacion)))
           upper(trim(q.numero_identificacion)) as equipo, q.id, q.periodo_mtto, q.periodo_mtto_unidad
    from equipos q join e on e.equipo = upper(trim(q.numero_identificacion))
    order by upper(trim(q.numero_identificacion)), q.activo desc, q.periodo_mtto_actualizado_en desc nulls last
  ),
  b as (
    select e.equipo, q.id as equipo_id, eq.denominacion, eq.ubicacion,
           coalesce(u.lejana, false) as lejana,
           (eq.ubicacion is not null and u.ubicacion_sap is null) as sin_config,
           q.periodo_mtto, q.periodo_mtto_unidad,
           s.fecha as srv_fecha, s.contador as srv_contador, s.contador_estado,
           c.fecha as carga_fecha, c.horometro as carga,
           ph.fecha as ph_fecha, ph.contador as ph, pk.fecha as pk_fecha, pk.contador as pk
    from e
    left join eq on eq.equipo = e.equipo
    left join q on q.equipo = e.equipo
    left join insp_ubicaciones u on u.ubicacion_sap = eq.ubicacion
    left join lateral (
      select s.fecha, s.contador, s.contador_estado from services_equipo s
      where s.equipo_id = q.id and s.anulado_en is null
      order by s.fecha desc, s.created_at desc limit 1) s on true
    left join lateral (
      select c.fecha, c.horometro from sap_cargas_combustible c
      where upper(trim(c.equipo)) = e.equipo and c.horometro > 0 and c.fecha is not null
      order by c.fecha desc, c.horometro desc limit 1) c on true
    left join lateral (
      select p.fecha, max(p.contador_fin) as contador from pd_partes p
      where p.valido and p.equipo = e.equipo and p.modo = 'h' and p.contador_fin is not null
      group by p.fecha order by p.fecha desc limit 1) ph on true
    left join lateral (
      select p.fecha, max(p.contador_fin) as contador from pd_partes p
      where p.valido and p.equipo = e.equipo and p.modo = 'km' and p.contador_fin is not null
      group by p.fecha order by p.fecha desc limit 1) pk on true
  ),
  v as (
    -- una lectura sirve si no es anterior al último mantenimiento ni menor que su contador
    -- (el contador del mantenimiento está en la unidad del período: solo se compara en esa unidad)
    select b.*,
      (b.ph is not null and (b.srv_fecha is null or b.ph_fecha >= b.srv_fecha)
         and (b.srv_contador is null or coalesce(b.periodo_mtto_unidad, 'h') <> 'h' or b.ph >= b.srv_contador)) as ph_ok,
      (b.pk is not null and (b.srv_fecha is null or b.pk_fecha >= b.srv_fecha)
         and (b.srv_contador is null or coalesce(b.periodo_mtto_unidad, 'km') <> 'km' or b.pk >= b.srv_contador)) as pk_ok,
      (b.carga is not null and (b.srv_fecha is null or b.carga_fecha >= b.srv_fecha)
         and (b.srv_contador is null or b.carga >= b.srv_contador)) as c_ok
    from b
  )
  select v.equipo, v.equipo_id, v.denominacion, v.ubicacion, v.lejana, v.sin_config,
         v.periodo_mtto, v.periodo_mtto_unidad,
         v.srv_fecha, v.srv_contador, v.contador_estado,
         v.carga_fecha, v.carga, v.ph_fecha, v.ph, v.pk_fecha, v.pk,
         case when v.ph_ok then v.ph when v.c_ok then v.carga end,
         case when v.ph_ok then v.ph_fecha when v.c_ok then v.carga_fecha end,
         case when v.ph_ok then 'parte' when v.c_ok then 'contador' end,
         (not v.ph_ok and not v.c_ok and (v.ph is not null or v.carga is not null)),
         case when v.pk_ok then v.pk when v.c_ok then v.carga end,
         case when v.pk_ok then v.pk_fecha when v.c_ok then v.carga_fecha end,
         case when v.pk_ok then 'parte' when v.c_ok then 'contador' end,
         (not v.pk_ok and not v.c_ok and (v.pk is not null or v.carga is not null))
  from v
$$;
revoke all on function public.ip30_base_equipos(text[]) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. Cálculo por orden (interno)
-- ------------------------------------------------------------
create or replace function public.ip30_calc()
returns table (
  orden bigint, equipo text, equipo_sap bigint, denominacion text, texto text, fecha_plan date, fecha_plan_anterior date,
  ubicacion text, lejana boolean, ubicacion_sin_config boolean,
  periodo numeric, periodo_unidad text, srv_fecha date, srv_contador numeric, srv_contador_estado text,
  h numeric, h_fuente text, h_calculado numeric, h_difiere boolean, unidad text, umbral numeric,
  lectura numeric, lectura_fecha date, j numeric, j_fuente text,
  estado_sap text, fecha_cierre date,
  estado_sugerido text, motivo text,
  estado_confirmado text, nueva_fecha date, notas text, estado_confirmado_en timestamptz, confirmado_por text,
  sugerencia_cambio boolean, volvio boolean, pendiente boolean,
  en_ultimo_ip30 boolean, salio_sin_cierre boolean, falta_cierre_tecnico boolean,
  primera_carga timestamptz, ultima_carga timestamptz, origen text
)
language sql stable security definer
set search_path = public
as $$
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
      coalesce(x.prox_mantto, x.h_calc) as h_val,
      case when x.prox_mantto is not null then 'cargado' when x.h_calc is not null then 'calculado' end as h_src,
      -- unidad: la que cargó la encargada → la del período → la del parte más parecido a H → h
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
      ip30_umbral(y.lejana, y.un) as umb
    from y
  ),
  w as (
    select z.*,
      z.h_val - z.lect as j_val,
      case when z.est_sap in ('CTEC', 'CERR') then 'concluido'
           when z.h_val is null or z.lect is null then null
           when z.h_val - z.lect <= z.umb then 'programado'
           else 'reprogramado' end as sug,
      case when z.est_sap in ('CTEC', 'CERR') then 'cerrada en SAP'
           when z.h_val is null then 'sin próximo mantenimiento'
           when z.lect is null and z.lect_inv then 'revisar contador'
           when z.lect is null then 'sin lectura'
           when z.h_val - z.lect <= 0 then 'vencido'
           when z.h_val - z.lect <= z.umb then 'dentro del umbral'
           else 'falta más que el umbral' end as mot
    from z
  )
  select w.orden, w.equipo, w.equipo_sap, w.denominacion, w.texto, w.fecha_plan, w.fecha_plan_anterior,
         w.ubicacion, w.lejana, w.ubicacion_sin_config,
         w.periodo, w.periodo_unidad, w.srv_fecha, w.srv_contador, w.srv_contador_estado,
         w.h_val, w.h_src, w.h_calc,
         (w.prox_mantto is not null and w.h_calc is not null and w.periodo_unidad is not distinct from w.un
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
         (w.estado_confirmado = 'concluido' and w.est_sap not in ('CTEC', 'CERR')),
         w.primera_carga, w.ultima_carga, w.origen
  from w
$$;
revoke all on function public.ip30_calc() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4. RPC de la pantalla
-- ------------------------------------------------------------
create or replace function public.ip30_bandeja()
returns table (
  orden bigint, equipo text, equipo_sap bigint, denominacion text, texto text, fecha_plan date, fecha_plan_anterior date,
  ubicacion text, lejana boolean, ubicacion_sin_config boolean,
  periodo numeric, periodo_unidad text, srv_fecha date, srv_contador numeric, srv_contador_estado text,
  h numeric, h_fuente text, h_calculado numeric, h_difiere boolean, unidad text, umbral numeric,
  lectura numeric, lectura_fecha date, j numeric, j_fuente text,
  estado_sap text, fecha_cierre date,
  estado_sugerido text, motivo text,
  estado_confirmado text, nueva_fecha date, notas text, estado_confirmado_en timestamptz, confirmado_por text,
  sugerencia_cambio boolean, volvio boolean, pendiente boolean,
  en_ultimo_ip30 boolean, salio_sin_cierre boolean, falta_cierre_tecnico boolean,
  primera_carga timestamptz, ultima_carga timestamptz, origen text
)
language sql stable security definer
set search_path = public
as $$
  select * from ip30_calc() where puede_completar_ordenes() order by orden
$$;
revoke all on function public.ip30_bandeja() from public, anon;
grant execute on function public.ip30_bandeja() to authenticated;

-- Equipos con J ≤ umbral (H calculado: último mantenimiento + período) sin orden TCPV abierta en la bandeja.
-- Caso típico: SAP no lanzó la orden porque las cargas de combustible están atrasadas.
create or replace function public.ip30_equipos_sin_orden()
returns table (equipo text, denominacion text, ubicacion text, lejana boolean, unidad text, umbral numeric,
               srv_fecha date, srv_contador numeric, periodo numeric, h numeric,
               lectura numeric, lectura_fecha date, j numeric, j_fuente text, ultima_orden bigint)
language sql stable security definer
set search_path = public
as $$
  with cand as (
    select array_agg(distinct upper(trim(q.numero_identificacion))) as eqs
    from equipos q
    where q.periodo_mtto is not null
      and exists (select 1 from services_equipo s where s.equipo_id = q.id and s.anulado_en is null and s.contador is not null)
  ),
  b as (select * from ip30_base_equipos((select eqs from cand))),
  c as (
    select b.*, b.srv_contador + b.periodo as h,
           case when b.periodo_unidad = 'km' then b.lect_km else b.lect_h end as lect,
           case when b.periodo_unidad = 'km' then b.lect_km_fecha else b.lect_h_fecha end as lect_fecha,
           case when b.periodo_unidad = 'km' then b.lect_km_fuente else b.lect_h_fuente end as fuente,
           ip30_umbral(b.lejana, b.periodo_unidad) as umb
    from b where b.srv_contador is not null
  )
  select c.equipo, c.denominacion, c.ubicacion, c.lejana, c.periodo_unidad, c.umb,
         c.srv_fecha, c.srv_contador, c.periodo, c.h, c.lect, c.lect_fecha, c.h - c.lect, c.fuente,
         (select max(o.orden) from ip30_ordenes o where o.equipo = c.equipo)
  from c
  where puede_completar_ordenes()
    and c.lect is not null and c.h - c.lect <= c.umb
    and not exists (
      select 1 from ip30_ordenes o
      left join sap_ordenes so on so.orden = o.orden
      where o.equipo = c.equipo
        and coalesce(so.status_sistema, '') !~ '\m(CTEC|CERR)\M'
        and coalesce(o.estado_confirmado, '') not in ('concluido', 'cancelado'))
  order by c.h - c.lect, c.equipo
$$;
revoke all on function public.ip30_equipos_sin_orden() from public, anon;
grant execute on function public.ip30_equipos_sin_orden() to authenticated;

-- Mantenimientos creados desde órdenes SAP que todavía no tienen contador
create or replace function public.ip30_contador_pendiente()
returns table (service_id uuid, equipo text, fecha date, orden bigint, creado_en timestamptz)
language sql stable security definer
set search_path = public
as $$
  select s.id, upper(trim(q.numero_identificacion)), s.fecha, s.orden, s.created_at
  from services_equipo s join equipos q on q.id = s.equipo_id
  where puede_completar_ordenes() and s.anulado_en is null and s.contador_estado = 'pendiente'
  order by s.fecha desc
$$;
revoke all on function public.ip30_contador_pendiente() from public, anon;
grant execute on function public.ip30_contador_pendiente() to authenticated;

create or replace function public.ip30_bandeja_frescura()
returns table (ie36 timestamptz, consumos timestamptz, trabajo timestamptz, ultimo_parte date,
               carga_archivo text, carga_subida_en timestamptz, carga_por text,
               n_filas int, n_nuevas int, n_actualizadas int, n_ausentes int, n_ignoradas int)
language sql stable security definer
set search_path = public
as $$
  select (select max(procesado_en) from sap_ingestas where fuente = 'ie36'),
         (select max(procesado_en) from sap_ingestas where fuente = 'consumos'),
         (select max(procesado_en) from sap_ingestas where fuente = 'trabajo'),
         (select max(fecha) from pd_partes where valido),
         c.archivo, c.subido_en, u.nombre_completo, c.n_filas, c.n_nuevas, c.n_actualizadas, c.n_ausentes, c.n_ignoradas
  from (select 1) d
  left join lateral (select * from ip30_cargas order by id desc limit 1) c on true
  left join usuarios u on u.id = c.subido_por
  where puede_completar_ordenes()
$$;
revoke all on function public.ip30_bandeja_frescura() from public, anon;
grant execute on function public.ip30_bandeja_frescura() to authenticated;

-- ------------------------------------------------------------
-- 5. Subir el IP30 (el Excel se lee en el navegador; llegan solo filas)
--    p_filas: [{orden, equipo_sap, equipo, clase, fecha_plan (YYYY-MM-DD), texto}]
--    Sin tablas temporales ni DELETE (el guard de migraciones del MCP los frena).
-- ------------------------------------------------------------
create or replace function public.ip30_parsear_filas(p_filas jsonb)
returns table (orden bigint, equipo_sap bigint, equipo text, clase text, fecha_plan date, texto text)
language sql stable security definer
set search_path = public
as $$
  with r as (
    select * from jsonb_to_recordset(p_filas)
      as t(orden bigint, equipo_sap bigint, equipo text, clase text, fecha_plan date, texto text)
  )
  select distinct on (r.orden)
         r.orden, r.equipo_sap,
         coalesce((select upper(trim(s.equipo)) from sap_equipos s
                    where s.equipo_sap = r.equipo_sap and coalesce(trim(s.equipo), '') <> ''
                    order by s.actualizado_en desc nulls last limit 1),
                  nullif(upper(trim(r.equipo)), '')),
         nullif(upper(trim(r.clase)), ''), r.fecha_plan, nullif(trim(r.texto), '')
  from r where r.orden is not null
  order by r.orden, r.fecha_plan desc nulls last
$$;
revoke all on function public.ip30_parsear_filas(jsonb) from public, anon, authenticated;

create or replace function public.ip30_subir(p_filas jsonb, p_archivo text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_usuario uuid;
  v_filas int; v_nuevas int; v_act int; v_aus int; v_ign int;
  v_carga bigint;
  v_in jsonb;
begin
  if not puede_completar_ordenes() then raise exception 'Sin permiso para subir el IP30'; end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'El archivo no trae órdenes';
  end if;
  select id into v_usuario from usuarios where email = auth.email();

  -- filas ya resueltas (equipo por N° SAP) y solo TCPV (sin clase = se asume TCPV)
  select count(*), count(*) filter (where f.clase is not null and f.clase <> 'TCPV'),
         coalesce(jsonb_agg(to_jsonb(f)) filter (where f.clase is null or f.clase = 'TCPV'), '[]'::jsonb)
    into v_filas, v_ign, v_in
  from ip30_parsear_filas(p_filas) f;

  select count(*) filter (where o.orden is null), count(*) filter (where o.orden is not null)
    into v_nuevas, v_act
  from jsonb_to_recordset(v_in) as i(orden bigint) left join ip30_ordenes o on o.orden = i.orden;
  select count(*) into v_aus from ip30_ordenes o
   where o.en_ultimo_ip30 and not exists (select 1 from jsonb_to_recordset(v_in) as i(orden bigint) where i.orden = o.orden);

  update ip30_ordenes o set
    equipo = coalesce(i.equipo, o.equipo),
    equipo_sap = coalesce(i.equipo_sap, o.equipo_sap),
    clase = coalesce(i.clase, o.clase),
    texto = coalesce(i.texto, o.texto),
    fecha_plan_anterior = case when i.fecha_plan is distinct from o.fecha_plan and o.fecha_plan is not null then o.fecha_plan else o.fecha_plan_anterior end,
    -- una reprogramada que vuelve con otra fecha plan se revisa de nuevo (el estado no se pisa)
    volvio = o.volvio or (o.estado_confirmado = 'reprogramado' and o.fecha_plan is not null and i.fecha_plan is distinct from o.fecha_plan),
    fecha_plan = coalesce(i.fecha_plan, o.fecha_plan),
    ultima_carga = now(),
    en_ultimo_ip30 = true
  from jsonb_to_recordset(v_in) as i(orden bigint, equipo_sap bigint, equipo text, clase text, fecha_plan date, texto text)
  where i.orden = o.orden;

  insert into ip30_ordenes (orden, equipo, equipo_sap, clase, fecha_plan, texto, ultima_carga, en_ultimo_ip30, origen)
  select i.orden, i.equipo, i.equipo_sap, coalesce(i.clase, 'TCPV'), i.fecha_plan, i.texto, now(), true, 'ip30'
  from jsonb_to_recordset(v_in) as i(orden bigint, equipo_sap bigint, equipo text, clase text, fecha_plan date, texto text)
  where not exists (select 1 from ip30_ordenes o where o.orden = i.orden);

  update ip30_ordenes o set en_ultimo_ip30 = false
  where o.en_ultimo_ip30 and not exists (select 1 from jsonb_to_recordset(v_in) as i(orden bigint) where i.orden = o.orden);

  insert into ip30_cargas (archivo, subido_por, n_filas, n_nuevas, n_actualizadas, n_ausentes, n_ignoradas)
  values (p_archivo, v_usuario, v_filas, v_nuevas, v_act, v_aus, v_ign) returning id into v_carga;

  return jsonb_build_object('carga_id', v_carga, 'filas', v_filas, 'nuevas', v_nuevas, 'actualizadas', v_act,
                            'ausentes', v_aus, 'ignoradas', v_ign);
end $$;
revoke all on function public.ip30_subir(jsonb, text) from public, anon;
grant execute on function public.ip30_subir(jsonb, text) to authenticated;

-- ------------------------------------------------------------
-- 6. Mantenimiento desde una orden: vincular o crear (interna, la usan la sync y la confirmación)
--    Vincula si el equipo ya tiene un mantenimiento sin orden entre la fecha de referencia − 5 días
--    y la fecha de referencia (el más cercano). Si no, crea uno con origen orden_sap.
-- ------------------------------------------------------------
create or replace function public.ip30_mantenimiento_de_orden(
  p_orden bigint, p_equipo_id uuid, p_fecha_ref date, p_contador numeric, p_contador_estado text,
  p_usuario uuid, p_dry_run boolean)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_fecha date;
begin
  select s.id, s.fecha into v_id, v_fecha from services_equipo s
  where s.equipo_id = p_equipo_id and s.anulado_en is null and s.orden is null
    and s.fecha between p_fecha_ref - 5 and p_fecha_ref
  order by s.fecha desc, s.created_at desc limit 1;
  if v_id is not null then
    if not p_dry_run then update services_equipo set orden = p_orden where id = v_id; end if;
    return jsonb_build_object('accion', 'vincular', 'service_id', v_id, 'fecha', v_fecha);
  end if;
  if not p_dry_run then
    insert into services_equipo (equipo_id, fecha, contador, origen, orden, contador_estado, cargado_por)
    values (p_equipo_id, p_fecha_ref, p_contador, 'orden_sap', p_orden, p_contador_estado, p_usuario)
    returning id into v_id;
  end if;
  return jsonb_build_object('accion', 'crear', 'service_id', v_id, 'fecha', p_fecha_ref,
                            'contador', p_contador, 'contador_estado', p_contador_estado);
end $$;
revoke all on function public.ip30_mantenimiento_de_orden(bigint, uuid, date, numeric, text, uuid, boolean) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 7. Cierres automáticos: órdenes de la bandeja cerradas en SAP sin mantenimiento vinculado
--    La llama n8n al final de la ingesta de Trabajo (dos semanas con p_dry_run = true).
-- ------------------------------------------------------------
create or replace function public.ip30_sync_cierres(p_dry_run boolean default true)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  r record;
  v_equipo_id uuid;
  v_contador numeric;
  v_res jsonb;
  n_vinc int := 0; n_crea int := 0; n_sin_fecha int := 0; n_sin_equipo int := 0;
  v_ahora timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin')
     and not puede_completar_ordenes() then
    raise exception 'Sin permiso para sincronizar cierres';
  end if;

  -- unidad = la de la bandeja (cargada por la encargada → período → inferida del parte)
  for r in
    select c.orden, c.equipo, c.fecha_cierre, c.unidad
    from ip30_calc() c
    where c.estado_sap in ('CTEC', 'CERR')
      and not exists (select 1 from services_equipo s where s.orden = c.orden)
    order by c.orden
  loop
    if r.fecha_cierre is null then
      n_sin_fecha := n_sin_fecha + 1;  -- cerradas antes del 07/10/2026: no se loguean una por una
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

    -- contador estimado: parte válido del día del cierre, en la unidad
    select max(p.contador_fin) into v_contador from pd_partes p
     where p.valido and p.equipo = r.equipo and p.modo = r.unidad and p.fecha = r.fecha_cierre;

    v_res := ip30_mantenimiento_de_orden(r.orden, v_equipo_id, r.fecha_cierre, v_contador,
               case when v_contador is null then 'pendiente' else 'estimado' end, null, p_dry_run);
    if v_res->>'accion' = 'vincular' then n_vinc := n_vinc + 1; else n_crea := n_crea + 1; end if;
    insert into ip30_sync_log (ejecutado_en, dry_run, orden, equipo, accion, detalle)
    values (v_ahora, p_dry_run, r.orden, r.equipo, v_res->>'accion', v_res || jsonb_build_object('fecha_cierre', r.fecha_cierre));
  end loop;

  v_res := jsonb_build_object('vinculados', n_vinc, 'creados', n_crea, 'cerradas_sin_fecha', n_sin_fecha, 'sin_equipo', n_sin_equipo);
  insert into ip30_sync_log (ejecutado_en, dry_run, accion, detalle) values (v_ahora, p_dry_run, 'RUN', v_res);
  return jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'ejecutado_en', v_ahora) || v_res;
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke all on function public.ip30_sync_cierres(boolean) from public, anon;
grant execute on function public.ip30_sync_cierres(boolean) to authenticated, service_role;

-- Últimas corridas (para la pantalla)
create or replace function public.ip30_sync_log_ultimo()
returns table (ejecutado_en timestamptz, dry_run boolean, orden bigint, equipo text, accion text, detalle jsonb)
language sql stable security definer
set search_path = public
as $$
  select l.ejecutado_en, l.dry_run, l.orden, l.equipo, l.accion, l.detalle
  from ip30_sync_log l
  where puede_completar_ordenes()
    and l.ejecutado_en = (select max(ejecutado_en) from ip30_sync_log)
  order by (l.accion = 'RUN') desc, l.orden
$$;
revoke all on function public.ip30_sync_log_ultimo() from public, anon;
grant execute on function public.ip30_sync_log_ultimo() to authenticated;

-- ------------------------------------------------------------
-- 8. Lo que carga la encargada
-- ------------------------------------------------------------
-- Estado (+ nueva fecha si es Reprogramado). Concluido con contador/fecha → mantenimiento confirmado.
create or replace function public.ip30_confirmar_estado(
  p_orden bigint, p_estado text, p_nueva_fecha date default null, p_notas text default null,
  p_contador numeric default null, p_fecha date default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_usuario uuid;
  v_o ip30_ordenes;
  v_sug text;
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
  select c.estado_sugerido, c.fecha_cierre into v_sug, v_cierre from ip30_calc() c where c.orden = p_orden;

  update ip30_ordenes set
    estado_confirmado = p_estado,
    estado_sugerido_al_confirmar = case when p_estado is null then null else v_sug end,
    nueva_fecha = case when p_estado = 'reprogramado' then p_nueva_fecha end,
    notas = nullif(trim(p_notas), ''),
    estado_confirmado_en = case when p_estado is null then null else now() end,
    estado_confirmado_por = case when p_estado is null then null else v_usuario end,
    volvio = false
  where orden = p_orden;

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
        -- vinculado a uno ya cargado: si ese no estaba confirmado, se completa con lo que cargó la encargada
        update services_equipo set contador = p_contador, fecha = coalesce(p_fecha, fecha), contador_estado = 'confirmado'
         where id = (v_res->>'service_id')::uuid and contador_estado <> 'confirmado';
      elsif p_fecha is not null then
        update services_equipo set fecha = p_fecha where id = (v_res->>'service_id')::uuid;
      end if;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'orden', p_orden, 'estado', p_estado, 'mantenimiento', v_res);
end $$;
revoke all on function public.ip30_confirmar_estado(bigint, text, date, text, numeric, date) from public, anon;
grant execute on function public.ip30_confirmar_estado(bigint, text, date, text, numeric, date) to authenticated;

-- Próximo mantenimiento (H) cargado a mano desde SAP. p_valor null = borrar (vuelve al calculado).
create or replace function public.ip30_fijar_proximo(p_orden bigint, p_valor numeric, p_unidad text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_usuario uuid;
begin
  if not puede_completar_ordenes() then raise exception 'Sin permiso'; end if;
  if p_valor is not null and (p_valor < 0 or coalesce(p_unidad, '') not in ('h', 'km')) then
    raise exception 'El próximo mantenimiento tiene que ser un número ≥ 0 en h o km';
  end if;
  select id into v_usuario from usuarios where email = auth.email();
  update ip30_ordenes set prox_mantto = p_valor,
         prox_unidad = case when p_valor is null then null else p_unidad end,
         prox_cargado_en = now(), prox_cargado_por = v_usuario
   where orden = p_orden;
  if not found then raise exception 'La orden % no está en la bandeja', p_orden; end if;
end $$;
revoke all on function public.ip30_fijar_proximo(bigint, numeric, text) from public, anon;
grant execute on function public.ip30_fijar_proximo(bigint, numeric, text) to authenticated;

-- Solo notas (sin tocar el estado)
create or replace function public.ip30_guardar_notas(p_orden bigint, p_notas text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not puede_completar_ordenes() then raise exception 'Sin permiso'; end if;
  update ip30_ordenes set notas = nullif(trim(p_notas), '') where orden = p_orden;
  if not found then raise exception 'La orden % no está en la bandeja', p_orden; end if;
end $$;
revoke all on function public.ip30_guardar_notas(bigint, text) from public, anon;
grant execute on function public.ip30_guardar_notas(bigint, text) to authenticated;
