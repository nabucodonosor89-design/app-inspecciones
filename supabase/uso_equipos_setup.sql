-- =====================================================================
-- MÓDULO USO DE EQUIPOS v1 — cruce rastreo · combustible · parte diario · SAP
-- supabase/uso_equipos_setup.sql   (idempotente: se puede correr N veces)
-- =====================================================================
--
-- ── MAPEO DE FUENTES (verificado contra la base el 16/10/2026) ─────────
--
--  Lógico             Real
--  -----------------  --------------------------------------------------
--  Rastreo            consumo_combustible (flujo n8n "Reporte Diario de Flota - Monitor")
--                       equipo = nombre_movil (ID técnico) · fecha
--                       horas motor = horas_marcha (YA INCLUYE el ralentí: horas_ralenti nunca supera a horas_marcha;
--                       corregido 16/10/2026, antes se sumaban las dos y se duplicaba el ralentí)
--                       km = distancia_km
--                       Diario. Un móvil sin uso aparece con 0 → "tiene rastreo" = existe la fila.
--                       Historia desde 26/08/2026.
--                       GPS trabado (≥ 15 h y 0 km) o sin señal (≥ 3 días seguidos en 0 con partes o combustible):
--                       esos días no cuentan como rastreo y el equipo va a Datos faltantes.
--  Parte diario       pd_partes (Jotform → n8n)
--                       equipo · fecha · obra (texto "OBRA_1022 Ruta…") · modo h|km
--                       cantidad = contador_fin − contador_ini (solo filas valido = true)
--                       Varias filas por equipo+día → se suman.
--  Certificación SAP  sap_imputaciones con clase_coste 7100000001 (FACT. INTERNA EQUIPOS T&C, h/km) o
--                       7100000002 (FLETES T&C PARA OBRAS, UN): ambas cuentan como imputado (16/10/2026)
--                       equipo · fecha · umedida HRA|KM · cantidad · obra_codigo ('1022')
--                       Granularidad equipo + día. Historia desde 06/04/2026.
--                       El costo unitario sale solo de 7100000001 (h/km).
--  Combustible        sap_cargas_combustible (ingesta 'consumos'): equipo · fecha · litros
--                       Su columna "obra" (OB34, CL01…) es otro código y NO se usa.
--  costo_equipo       ES LA MISMA sap_imputaciones (ingesta 'costo_equipo'):
--                       F (cantidad de trabajo) = cantidad · J (valor) = valor_pyg
--                       unidad = umedida (HRA→h, KM→km) · período = fecha
--  Clase inventario   equipos.clase_vehiculo
--  Tipo de equipo     equipos.tipo_equipo ∈ V/P/M/B; si no sap_equipos.tipo_equipo ∈ V/P/M/B; si no 'S'
--  Obra               clave = código de centro de 4 dígitos:
--                       parte → primer grupo de 4 dígitos del texto (OBRA_1022…, CONF_1017…, OB1001_006…)
--                               o tabla uso_obras_alias para textos sin código (Complejo Ypane, TALLER…)
--                       SAP   → sap_imputaciones.obra_codigo
--                       actual→ sap_equipos.centro (la ubicación técnica que mantiene corr_sync_sap R3)
--                       nombre→ tabla uso_obras (editable)
--  En taller          mantenimientos tipo 'Correctivo':
--                       Espera/Entrada → desde coalesce(fecha_ingreso_taller, fecha_inicio_averia) hasta hoy
--                       Salida con fecha_liberacion → hasta la liberación (inclusive)
--                       Salida sin fecha_liberacion → se toma como liberado (no cuenta)
--  Perfiles           usuarios (+ columna nueva uso_equipos_acceso)
--
-- ── DECISIONES DE ANDRÉS (16/10/2026) ──────────────────────────────────
--  · Cada regla arranca cuando empiezan todas sus fuentes (no desde el 1/1):
--      SAP = primer dato del año (06/04) · rastreo = primer dato del año (26/08)
--      combustible = 01/08/2026 (parámetro INICIO_COMBUSTIBLE; antes casi no hay cargas)
--  · parte_sin_sap: vale como imputado si hay imputación del equipo a ±TOL_DIAS_SAP días (3).
--      Solo partes con trabajo (> 0): los partes "A disposición" con 0 no se imputan.
--  · Unidad del equipo: costo_equipo (la de mayor monto) → modo más frecuente de sus
--      partes → equipos.periodo_mtto_unidad.
--  · "Taller Salida" sin fecha de liberación = liberado.
--
-- Parámetros: tabla uso_parametros (UPDATE por SQL Editor, efecto en el próximo refresco).
-- Acceso:     update usuarios set uso_equipos_acceso = 'gestion'  where email = 'x@itcsa.com.py';
--             update usuarios set uso_equipos_acceso = 'gerencia' where email = 'x@itcsa.com.py';
--             (null = sin acceso). No se asigna a nadie desde esta migración.
-- =====================================================================


-- =====================================================================
-- 1. ACCESO
-- =====================================================================
alter table public.usuarios
  add column if not exists uso_equipos_acceso text
  check (uso_equipos_acceso in ('gestion','gerencia'));

create or replace function public.uso_acceso() returns text
language sql stable security definer set search_path = public as $$
  select uso_equipos_acceso from usuarios
  where email = auth.email() and activo = true
  limit 1
$$;

create or replace function public.puede_uso_equipos() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.uso_acceso() in ('gestion','gerencia'), false)
$$;

create or replace function public.es_gerencia_uso() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.uso_acceso() = 'gerencia', false)
$$;

create or replace function public.uso_usuario_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from usuarios where email = auth.email() and activo = true limit 1
$$;


-- =====================================================================
-- 2. PARÁMETROS Y CATÁLOGOS
-- =====================================================================
create table if not exists public.uso_parametros (
  clave       text primary key,
  valor       numeric,
  fecha       date,
  descripcion text
);

insert into public.uso_parametros (clave, valor, fecha, descripcion) values
  ('DIAS_OCIOSO',               3,    null, 'Días evaluables seguidos sin uso en ninguna fuente para ser ocioso'),
  ('TOL_PARTE_SOBRE_RASTREO_H', 1,    null, 'parte − rastreo (h) tolerado'),
  ('TOL_RASTREO_SOBRE_PARTE_H', 3,    null, 'rastreo − parte (h) tolerado (con el %: lo que ocurra primero)'),
  ('TOL_RASTREO_SOBRE_PARTE_PCT',0.30,null, 'rastreo − parte tolerado como fracción del parte (h y km)'),
  ('TOL_PARTE_SOBRE_RASTREO_KM',10,   null, 'parte − rastreo (km) tolerado — provisorio'),
  ('TOL_RASTREO_SOBRE_PARTE_KM',30,   null, 'rastreo − parte (km) tolerado — provisorio'),
  ('UMBRAL_USO_RASTREO_H',      0.5,  null, 'Mínimo de horas de motor para considerar uso — provisorio'),
  ('UMBRAL_USO_RASTREO_KM',     2,    null, 'Mínimo de km para considerar uso — provisorio'),
  ('UMBRAL_GPS_TRABADO_H',      15,   null, 'Día con ≥ N h de motor y 0 km = GPS dudoso (encendido trabado): no cuenta como rastreo'),
  ('DIAS_GPS_SIN_SENAL',        3,    null, 'N días seguidos con 0 h y 0 km mientras hay partes con trabajo o combustible = GPS sin señal: esos días no cuentan como rastreo'),
  ('DIAS_GRACIA_SAP',           7,    null, 'Días que tiene la obra para imputar un parte — provisorio'),
  ('TOL_DIAS_SAP',              3,    null, 'Un parte cuenta como imputado si hay imputación del equipo a ± N días'),
  ('VENTANA_COMBUSTIBLE',       3,    null, 'Días antes y después de la carga en que se buscan partes'),
  ('INICIO_RASTREO',            null, null, 'Inicio de reglas con rastreo (null = primer dato del año)'),
  ('INICIO_SAP',                null, null, 'Inicio de reglas con SAP (null = primer dato del año)'),
  ('INICIO_COMBUSTIBLE',        null, '2026-08-01', 'Inicio de reglas con combustible (null = primer dato del año)')
on conflict (clave) do nothing;

create or replace function public.uso_param(p text) returns numeric
language sql stable set search_path = public as $$
  select valor from uso_parametros where clave = p
$$;

-- Nombres de obra por código (editable). 'SIN' agrupa lo que no se pudo resolver.
create table if not exists public.uso_obras (
  codigo       text primary key,
  nombre       text not null,
  se_certifica boolean not null default true   -- false = sus partes no generan parte_sin_sap
);
insert into public.uso_obras (codigo, nombre) values ('SIN', 'Sin obra resoluble')
on conflict (codigo) do nothing;

-- Textos de obra del parte que no traen código de 4 dígitos.
create table if not exists public.uso_obras_alias (
  texto  text primary key,   -- en MAYÚSCULAS, sin espacios a los costados
  codigo text not null
);
insert into public.uso_obras_alias (texto, codigo) values
  ('COMPLEJO YPANE',      '1002'),
  ('TALLER',              '1002'),
  ('OFICINA CENTRAL TYC', '1001'),
  ('CANTERA VILLA HAYES', '1003')
on conflict (texto) do nothing;

create or replace function public.uso_obra_codigo(t text) returns text
language sql stable set search_path = public as $$
  select coalesce(
    substring(t from '(\d{4})'),
    (select a.codigo from uso_obras_alias a where a.texto = upper(trim(t)))
  )
$$;


-- =====================================================================
-- 3. TABLAS DEL CÁLCULO
-- =====================================================================

-- 3.1 Ficha por equipo del universo (se recalcula en cada refresco)
create table if not exists public.uso_equipos_info (
  equipo          text primary key,
  denominacion    text,
  tipo            text,
  clase           text,
  unidad          text check (unidad in ('h','km')),
  unidad_origen   text,          -- costo | parte | mantenimiento
  costo_unitario  numeric,       -- Gs por h o km
  costo_por_clase boolean not null default false,
  centro          text,          -- sap_equipos.centro (obra actual)
  ubicacion       text           -- sap_equipos.ubicacion (texto)
);

-- 3.2 Equipo + día de la ventana
create table if not exists public.uso_diario (
  equipo        text not null,
  fecha         date not null,
  unidad        text,
  tiene_rastreo boolean not null default false,
  rastreo_h     numeric,
  rastreo_km    numeric,
  rastreo_q     numeric,          -- en la unidad del equipo
  uso_rastreo   boolean not null default false,
  partes_n      int not null default 0,
  parte_q       numeric,          -- válidos, en la unidad del equipo
  parte_trabajo boolean not null default false,  -- algún parte válido con cantidad > 0
  parte_obra    text,
  tiene_sap     boolean not null default false,
  sap_q         numeric,          -- en la unidad del equipo
  sap_obra      text,
  litros        numeric,
  en_taller     boolean not null default false,
  obra          text,
  obra_origen   smallint,         -- 1 parte · 2 SAP · 3 anterior · 4 ubicación actual
  primary key (equipo, fecha)
);
-- GPS dudoso: ≥ UMBRAL_GPS_TRABADO_H h de motor con 0 km → el día se toma como sin rastreo
alter table public.uso_diario add column if not exists gps_dudoso boolean not null default false;
-- GPS sin señal: racha de ≥ DIAS_GPS_SIN_SENAL días con 0 h y 0 km mientras hay partes con trabajo o combustible
alter table public.uso_diario add column if not exists gps_sin_senal boolean not null default false;

-- 3.3 Hallazgos
create table if not exists public.uso_hallazgos (
  id                       uuid primary key default gen_random_uuid(),
  equipo                   text not null,
  fecha                    date not null,      -- combustible: fecha de la (primera) carga
  tipo                     text not null check (tipo in
                             ('uso_sin_parte','combustible_sin_parte','parte_sin_sap',
                              'parte_sobre_rastreo','rastreo_sobre_parte')),
  obra                     text not null default 'SIN',
  obra_origen              smallint,
  denominacion             text,
  tipo_equipo              text,
  clase                    text,
  unidad                   text,
  rastreo_q                numeric,
  parte_q                  numeric,
  sap_q                    numeric,
  litros                   numeric,
  periodo_desde            date,               -- solo combustible
  periodo_hasta            date,
  cantidad_sin_respaldo    numeric,
  costo_unitario           numeric,
  costo_por_clase          boolean not null default false,
  monto                    numeric,
  estado                   text not null default 'abierto'
                             check (estado in ('abierto','justificado','resuelto','vencido')),
  valores_justificados     jsonb,
  justificado_por          uuid,
  justificado_at           timestamptz,
  comentario_justificacion text,
  detectado_at             timestamptz not null default now(),
  reabierto_at             timestamptz,
  resuelto_at              timestamptz,
  actualizado_at           timestamptz not null default now(),
  unique (equipo, fecha, tipo)
);
-- Monto contado una sola vez por equipo + día (si un día tiene dos hallazgos, cuenta solo el mayor)
alter table public.uso_hallazgos add column if not exists monto_neto numeric;

-- 3.4 Ociosos (estado actual)
create table if not exists public.uso_ociosos (
  equipo           text primary key,
  denominacion     text,
  tipo_equipo      text,
  clase            text,
  obra             text,
  obra_origen      smallint,
  ultimo_uso       date,
  desde            date,
  hasta            date,
  dias             int,
  dias_con_rastreo int,
  confirmado       boolean
);

-- 3.5 Casos por obra y bitácora
create table if not exists public.uso_casos (
  id                uuid primary key default gen_random_uuid(),
  obra              text not null,
  estado            text not null default 'nuevo'
                      check (estado in ('nuevo','en_gestion','escalado','cerrado')),
  creado_at         timestamptz not null default now(),
  ultima_gestion_at timestamptz,
  escalado_at       timestamptz,
  cerrado_at        timestamptz
);
create unique index if not exists uso_casos_activo_uk
  on public.uso_casos (obra) where estado <> 'cerrado';

create table if not exists public.uso_caso_gestiones (
  id         uuid primary key default gen_random_uuid(),
  caso_id    uuid not null references public.uso_casos(id),
  tipo       text not null check (tipo in
               ('gestion','escalado','devuelto','justificacion','nota_gerencia','auto')),
  texto      text not null,
  usuario_id uuid,
  created_at timestamptz not null default now()
);

-- 3.6 Log de refrescos
create table if not exists public.uso_refrescos (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  duracion_ms int,
  resumen   jsonb
);

-- 3.7 Índices
create index if not exists uso_diario_fecha_idx        on public.uso_diario (fecha);
create index if not exists uso_hallazgos_estado_obra   on public.uso_hallazgos (estado, obra);
create index if not exists uso_hallazgos_equipo_fecha  on public.uso_hallazgos (equipo, fecha);
create index if not exists uso_caso_gestiones_caso_idx on public.uso_caso_gestiones (caso_id, created_at);
create index if not exists sap_imput_clase_fecha_idx   on public.sap_imputaciones (fecha) where clase_coste = 7100000001;
create index if not exists sap_cargas_fecha_idx        on public.sap_cargas_combustible (fecha);


-- =====================================================================
-- 4. CASOS: sincronizar con los hallazgos abiertos
-- =====================================================================
create or replace function public.uso_casos_sync() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_nuevos int; v_cerrados int;
begin
  with ins as (
    insert into uso_casos (obra, estado)
    select distinct h.obra, 'nuevo' from uso_hallazgos h
    where h.estado = 'abierto'
      and not exists (select 1 from uso_casos c where c.obra = h.obra and c.estado <> 'cerrado')
    returning id
  ), b as (
    insert into uso_caso_gestiones (caso_id, tipo, texto)
    select id, 'auto', 'Caso creado: hay hallazgos abiertos' from ins
    returning 1
  ) select count(*) into v_nuevos from b;

  with upd as (
    update uso_casos c set estado = 'cerrado', cerrado_at = now()
    where c.estado <> 'cerrado'
      and not exists (select 1 from uso_hallazgos h where h.obra = c.obra and h.estado = 'abierto')
    returning id
  ), b as (
    insert into uso_caso_gestiones (caso_id, tipo, texto)
    select id, 'auto', 'Cerrado automáticamente: sin hallazgos abiertos' from upd
    returning 1
  ) select count(*) into v_cerrados from b;

  return jsonb_build_object('casos_nuevos', v_nuevos, 'casos_cerrados', v_cerrados);
end $$;


-- =====================================================================
-- 5. REFRESCO
-- =====================================================================
create or replace function public.uso_refrescar() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t0     timestamptz := clock_timestamp();
  v_hoy  date := (now() at time zone 'America/Asuncion')::date;
  v_ini  date := date_trunc('year', (now() at time zone 'America/Asuncion'))::date;
  c_r date; c_p date; c_s date; c_c date; c_o date;
  i_r date; i_s date; i_c date;
  u_h numeric := uso_param('UMBRAL_USO_RASTREO_H');
  u_km numeric := uso_param('UMBRAL_USO_RASTREO_KM');
  u_gps numeric := coalesce(uso_param('UMBRAL_GPS_TRABADO_H'), 15);
  d_sin int := coalesce(uso_param('DIAS_GPS_SIN_SENAL'), 3)::int;
  tol_psr_h numeric := uso_param('TOL_PARTE_SOBRE_RASTREO_H');
  tol_psr_km numeric := uso_param('TOL_PARTE_SOBRE_RASTREO_KM');
  tol_rsp_h numeric := uso_param('TOL_RASTREO_SOBRE_PARTE_H');
  tol_rsp_km numeric := uso_param('TOL_RASTREO_SOBRE_PARTE_KM');
  tol_pct numeric := uso_param('TOL_RASTREO_SOBRE_PARTE_PCT');
  gracia int := uso_param('DIAS_GRACIA_SAP')::int;
  tol_d  int := uso_param('TOL_DIAS_SAP')::int;
  vc     int := uso_param('VENTANA_COMBUSTIBLE')::int;
  d_oc   int := uso_param('DIAS_OCIOSO')::int;
  r_nuevos jsonb; r_resueltos jsonb; r_reabiertos jsonb; r_casos jsonb;
  n_venc int; n_cur int; v_res jsonb;
begin
  -- Permiso: service_role (n8n), conexión directa sin JWT (SQL Editor) o gerencia
  if not (coalesce(auth.role(), 'directo') in ('service_role','directo') or es_gerencia_uso()) then
    raise exception 'Sin permiso para recalcular' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('uso_refrescar'));

  -- Cortes por fuente
  select max(fecha) into c_r from consumo_combustible where fecha <= v_hoy;
  select max(fecha) into c_p from pd_partes where fecha <= v_hoy;
  select max(fecha) into c_s from sap_imputaciones where clase_coste = 7100000001 and fecha <= v_hoy;
  select max(fecha) into c_c from sap_cargas_combustible where fecha <= v_hoy;
  c_o := least(c_r, c_p, c_s, c_c);

  -- Inicio de evaluación por fuente
  i_r := greatest(v_ini, coalesce((select fecha from uso_parametros where clave='INICIO_RASTREO'),
                                  (select min(fecha) from consumo_combustible where fecha >= v_ini)));
  i_s := greatest(v_ini, coalesce((select fecha from uso_parametros where clave='INICIO_SAP'),
                                  (select min(fecha) from sap_imputaciones where clase_coste = 7100000001 and fecha >= v_ini)));
  i_c := greatest(v_ini, coalesce((select fecha from uso_parametros where clave='INICIO_COMBUSTIBLE'),
                                  (select min(fecha) from sap_cargas_combustible where fecha >= v_ini)));

  -- ── 5.1 Nombres de obra nuevos (no pisa los editados) ──────────────
  -- Código de obra por texto del parte: se calcula una vez por texto distinto (no por fila)
  drop table if exists t_oc;
  create temp table t_oc (obra text primary key, codigo text, n int) on commit drop;
  insert into t_oc (obra, codigo, n)
  select obra, uso_obra_codigo(obra), n
  from (select obra, count(*) n from pd_partes
        where fecha >= v_ini and obra is not null group by 1) x;

  insert into uso_obras (codigo, nombre)
  select codigo, nombre from (
    select distinct on (codigo) codigo, nombre from (
      select codigo,
             coalesce(nullif(trim(regexp_replace(obra, '^\S*\d{4}\S*\s*', '')), ''), obra) nombre,
             sum(n) n
      from t_oc
      group by 1, 2
      union all
      select centro, ubicacion, count(*) from sap_equipos
      where centro ~ '^\d{4}$' and ubicacion is not null group by 1, 2
    ) x where codigo is not null
    order by codigo, n desc
  ) y
  on conflict (codigo) do nothing;

  -- ── 5.2 Ficha de equipos ────────────────────────────────────────────
  delete from uso_equipos_info;
  insert into uso_equipos_info (equipo, denominacion, tipo, clase, unidad, unidad_origen,
                                costo_unitario, costo_por_clase, centro, ubicacion)
  with e as (
    select distinct on (numero_identificacion) numero_identificacion equipo, denominacion,
           tipo_equipo, clase_vehiculo, periodo_mtto_unidad
    from equipos
    where activo = true and nullif(trim(numero_identificacion), '') is not null
    order by numero_identificacion, updated_at desc nulls last
  ), s as (
    select distinct on (trim(equipo)) trim(equipo) equipo, tipo_equipo, centro, ubicacion, denominacion
    from sap_equipos where nullif(trim(equipo), '') is not null
    order by trim(equipo), actualizado_en desc nulls last
  ), c as (
    select equipo, case umedida when 'HRA' then 'h' else 'km' end u,
           sum(cantidad) f, sum(valor_pyg) j
    from sap_imputaciones
    where clase_coste = 7100000001 and umedida in ('HRA','KM') and fecha >= v_ini
    group by 1, 2
  ), cu as (
    select distinct on (equipo) equipo, u from c order by equipo, j desc nulls last
  ), pm as (
    select distinct on (equipo) equipo, modo from (
      select equipo, modo, count(*) n from pd_partes
      where fecha >= v_ini and valido and modo in ('h','km') group by 1, 2
    ) x order by equipo, n desc
  ), base as (
    select e.equipo,
           coalesce(e.denominacion, s.denominacion) denominacion,
           case when e.tipo_equipo in ('V','P','M','B') then e.tipo_equipo
                when s.tipo_equipo in ('V','P','M','B') then s.tipo_equipo
                else 'S' end tipo,
           e.clase_vehiculo clase,
           coalesce(cu.u, pm.modo,
                    case when e.periodo_mtto_unidad in ('h','km') then e.periodo_mtto_unidad end) unidad,
           case when cu.u is not null then 'costo'
                when pm.modo is not null then 'parte'
                when e.periodo_mtto_unidad in ('h','km') then 'mantenimiento' end unidad_origen,
           case when s.centro ~ '^\d{4}$' then s.centro end centro,
           s.ubicacion
    from e left join s using (equipo) left join cu using (equipo) left join pm using (equipo)
  ), cc as (
    select b.clase, c.u, sum(c.f) f, sum(c.j) j
    from c join base b using (equipo)
    where b.clase is not null group by 1, 2
  )
  select b.equipo, b.denominacion, b.tipo, b.clase, b.unidad, b.unidad_origen,
         case when c.f > 0 then round(c.j / c.f, 2)
              when cc.f > 0 then round(cc.j / cc.f, 2) end,
         (coalesce(c.f, 0) <= 0 and coalesce(cc.f, 0) > 0),
         b.centro, b.ubicacion
  from base b
  left join c  on c.equipo = b.equipo and c.u = b.unidad
  left join cc on cc.clase = b.clase  and cc.u = b.unidad;

  -- ── 5.3 Equipo + día ────────────────────────────────────────────────
  truncate uso_diario;
  insert into uso_diario (equipo, fecha, unidad, tiene_rastreo, rastreo_h, rastreo_km, rastreo_q,
                          uso_rastreo, partes_n, parte_q, parte_trabajo, parte_obra,
                          tiene_sap, sap_q, sap_obra, litros, en_taller, obra, obra_origen, gps_dudoso, gps_sin_senal)
  with d as (
    select e.equipo, e.unidad, e.centro, g::date fecha
    from uso_equipos_info e
    cross join generate_series(v_ini, v_hoy, interval '1 day') g
  ), r as (
    select nombre_movil equipo, fecha,
           sum(coalesce(horas_marcha, 0)) h,   -- horas_marcha ya incluye el ralentí
           sum(coalesce(distancia_km, 0)) km
    from consumo_combustible where fecha between v_ini and v_hoy group by 1, 2
  ), p as (
    select equipo, fecha, count(*) n,
           sum(contador_fin - contador_ini) filter (where valido and modo = 'h')  qh,
           sum(contador_fin - contador_ini) filter (where valido and modo = 'km') qkm,
           bool_or(valido and contador_fin - contador_ini > 0) trabajo,
           mode() within group (order by oc.codigo) obra
    from pd_partes left join t_oc oc using (obra)
    where fecha between v_ini and v_hoy group by 1, 2
  ), s as (
    select equipo, fecha,
           sum(cantidad) filter (where umedida = 'HRA') qh,
           sum(cantidad) filter (where umedida = 'KM')  qkm,
           mode() within group (order by nullif(trim(obra_codigo), '')) obra
    from sap_imputaciones
    -- 7100000001 = horas/km · 7100000002 = fletes (volquetes y camiones se certifican por flete):
    -- cualquiera de las dos cuenta como "imputado"; las cantidades h/km salen solo de HRA/KM
    where clase_coste in (7100000001, 7100000002) and fecha between v_ini and v_hoy group by 1, 2
  ), c as (
    select equipo, fecha, sum(litros) litros
    from sap_cargas_combustible where fecha between v_ini and v_hoy group by 1, 2
  ), t as (
    select distinct eq.numero_identificacion equipo, g::date fecha
    from mantenimientos m
    join equipos eq on eq.id = m.equipo_id
    cross join lateral generate_series(
      greatest(coalesce(m.fecha_ingreso_taller, m.fecha_inicio_averia), v_ini),
      case when m.estado in ('Taller Espera','Taller Entrada') then v_hoy
           else least(m.fecha_liberacion, v_hoy) end,
      interval '1 day') g
    where m.tipo_mantenimiento = 'Correctivo'
      and coalesce(m.fecha_ingreso_taller, m.fecha_inicio_averia) is not null
      and (m.estado in ('Taller Espera','Taller Entrada')
           or (m.estado = 'Taller Salida' and m.fecha_liberacion is not null))
  ), j as (
    select d.equipo, d.fecha, d.unidad, d.centro,
           (r.equipo is not null) tiene_rastreo, r.h, r.km,
           case d.unidad when 'h' then r.h when 'km' then r.km end rq,
           coalesce(p.n, 0) pn,
           case d.unidad when 'h' then p.qh when 'km' then p.qkm end pq,
           coalesce(p.trabajo, false) ptrab, p.obra pobra,
           (s.equipo is not null) tsap,
           case d.unidad when 'h' then s.qh when 'km' then s.qkm end sq,
           s.obra sobra, c.litros,
           (t.equipo is not null) taller,
           coalesce(p.obra, s.obra) obra12
    from d
    left join r on r.equipo = d.equipo and r.fecha = d.fecha
    left join p on p.equipo = d.equipo and p.fecha = d.fecha
    left join s on s.equipo = d.equipo and s.fecha = d.fecha
    left join c on c.equipo = d.equipo and c.fecha = d.fecha
    left join t on t.equipo = d.equipo and t.fecha = d.fecha
  ), g as (
    select j.*, count(obra12) over (partition by equipo order by fecha) grp from j
  ), k as (
    select g.*, first_value(obra12) over (partition by equipo, grp order by fecha) obra_ant,
           (tiene_rastreo and coalesce(h, 0) >= u_gps and coalesce(km, 0) <= 0.1) dud,
           (tiene_rastreo and coalesce(h, 0) = 0 and coalesce(km, 0) <= 0.1) cero
    from g
  ), z as (   -- rachas de días seguidos con GPS en cero
    select k.*, row_number() over (partition by equipo order by fecha)
              - row_number() over (partition by equipo, cero order by fecha) isla
    from k
  ), zr as (
    select z.*,
           cero and count(*) over (partition by equipo, cero, isla) >= d_sin
                and bool_or(ptrab or coalesce(litros, 0) > 0) over (partition by equipo, cero, isla) sin_senal
    from z
  )
  select equipo, fecha, unidad, tiene_rastreo and not dud and not sin_senal, h, km,
         case when dud or sin_senal then null else rq end,
         case when not tiene_rastreo or dud or sin_senal then false
              when unidad = 'h'  then coalesce(h, 0)  >= u_h
              when unidad = 'km' then coalesce(km, 0) >= u_km
              else coalesce(h, 0) >= u_h or coalesce(km, 0) >= u_km end,
         pn, pq, ptrab, pobra, tsap, sq, sobra, litros, taller,
         coalesce(pobra, sobra, obra_ant, centro, 'SIN'),
         case when pobra is not null then 1 when sobra is not null then 2
              when obra_ant is not null then 3 when centro is not null then 4 end,
         dud, sin_senal
  from zr;

  -- ── 5.4 Hallazgos detectados hoy ────────────────────────────────────
  drop table if exists t_h;
  create temp table t_h (
    equipo text, fecha date, tipo text, obra text, obra_origen smallint,
    rastreo_q numeric, parte_q numeric, sap_q numeric, litros numeric,
    periodo_desde date, periodo_hasta date, cantidad numeric
  ) on commit drop;

  -- uso_sin_parte
  insert into t_h
  select equipo, fecha, 'uso_sin_parte', obra, obra_origen, rastreo_q, null, sap_q, litros, null, null, rastreo_q
  from uso_diario
  where fecha between i_r and least(c_r, c_p)
    and not en_taller and unidad is not null
    and uso_rastreo and partes_n = 0;

  -- parte_sin_sap
  insert into t_h
  select u.equipo, u.fecha, 'parte_sin_sap', u.obra, u.obra_origen, u.rastreo_q, u.parte_q, null, u.litros, null, null, u.parte_q
  from uso_diario u
  left join uso_obras o on o.codigo = u.obra
  where u.fecha between i_s and least(v_hoy - gracia, c_s - tol_d, c_p)
    and not u.en_taller and u.parte_trabajo
    and coalesce(o.se_certifica, true)
    and not exists (select 1 from uso_diario u2
                    where u2.equipo = u.equipo and u2.tiene_sap
                      and u2.fecha between u.fecha - tol_d and u.fecha + tol_d);

  -- parte_sobre_rastreo / rastreo_sobre_parte
  insert into t_h
  select equipo, fecha, 'parte_sobre_rastreo', obra, obra_origen, rastreo_q, parte_q, sap_q, litros, null, null,
         parte_q - rastreo_q
  from uso_diario
  where fecha between i_r and least(c_r, c_p)
    and not en_taller and unidad is not null and tiene_rastreo and parte_q is not null
    and parte_q - coalesce(rastreo_q, 0) > case unidad when 'h' then tol_psr_h else tol_psr_km end;

  insert into t_h
  select equipo, fecha, 'rastreo_sobre_parte', obra, obra_origen, rastreo_q, parte_q, sap_q, litros, null, null,
         rastreo_q - parte_q
  from uso_diario
  where fecha between i_r and least(c_r, c_p)
    and not en_taller and unidad is not null and tiene_rastreo and parte_q is not null
    and rastreo_q - parte_q >
        greatest(case unidad when 'h' then u_h else u_km end,
                 least(case unidad when 'h' then tol_rsp_h else tol_rsp_km end,
                       tol_pct * greatest(parte_q, 0)));

  -- combustible_sin_parte (una por carga; cargas con ventanas superpuestas se unifican)
  insert into t_h
  with cand as (
    select u.equipo, u.fecha, u.litros, u.obra, u.obra_origen
    from uso_diario u
    where u.litros > 0
      and u.fecha between i_c and least(c_c, c_r, c_p - vc)
      and not u.tiene_rastreo and not u.en_taller
      and not exists (select 1 from uso_diario u2
                      where u2.equipo = u.equipo and u2.partes_n > 0
                        and u2.fecha between u.fecha - vc and u.fecha + vc)
  ), lg as (
    select cand.*, fecha - lag(fecha) over (partition by equipo order by fecha) gap from cand
  ), isl as (
    select lg.*,
           sum(case when gap <= 2 * vc then 0 else 1 end)
             over (partition by equipo order by fecha rows unbounded preceding) grp
    from lg
  )
  select equipo, min(fecha), 'combustible_sin_parte',
         (array_agg(obra order by fecha))[1], (array_agg(obra_origen order by fecha))[1],
         null, null, null, sum(litros), min(fecha) - vc, max(fecha) + vc, null
  from isl group by equipo, grp;

  select count(*) into n_cur from t_h;

  -- ── 5.5 Estados ─────────────────────────────────────────────────────
  update uso_hallazgos set estado = 'vencido', actualizado_at = now()
  where estado = 'abierto' and fecha < v_ini;
  get diagnostics n_venc = row_count;

  -- nuevos
  with ins as (
    insert into uso_hallazgos (equipo, fecha, tipo, obra, obra_origen, denominacion, tipo_equipo, clase, unidad,
                               rastreo_q, parte_q, sap_q, litros, periodo_desde, periodo_hasta,
                               cantidad_sin_respaldo, costo_unitario, costo_por_clase, monto)
    select t.equipo, t.fecha, t.tipo, t.obra, t.obra_origen, e.denominacion, e.tipo, e.clase, e.unidad,
           t.rastreo_q, t.parte_q, t.sap_q, t.litros, t.periodo_desde, t.periodo_hasta,
           t.cantidad, e.costo_unitario, e.costo_por_clase,
           case when t.tipo <> 'combustible_sin_parte' then round(t.cantidad * e.costo_unitario) end
    from t_h t join uso_equipos_info e using (equipo)
    on conflict (equipo, fecha, tipo) do nothing
    returning tipo
  ) select coalesce(jsonb_object_agg(tipo, n), '{}') into r_nuevos
    from (select tipo, count(*) n from ins group by 1) x;

  -- reabiertos: justificado con cantidades distintas, o resuelto que vuelve a aparecer
  with re as (
    update uso_hallazgos h set estado = 'abierto', reabierto_at = now(), resuelto_at = null, actualizado_at = now()
    from t_h t
    where h.equipo = t.equipo and h.fecha = t.fecha and h.tipo = t.tipo
      and (h.estado = 'resuelto'
           or (h.estado = 'justificado' and h.valores_justificados is distinct from
               jsonb_build_object('rastreo', round(t.rastreo_q, 2), 'parte', round(t.parte_q, 2),
                                  'sap', round(t.sap_q, 2), 'litros', round(t.litros, 2))))
    returning h.tipo
  ) select coalesce(jsonb_object_agg(tipo, n), '{}') into r_reabiertos
    from (select tipo, count(*) n from re group by 1) x;

  -- actualizar cantidades / obra / monto de abiertos y justificados
  update uso_hallazgos h set
    obra = t.obra, obra_origen = t.obra_origen,
    denominacion = e.denominacion, tipo_equipo = e.tipo, clase = e.clase, unidad = e.unidad,
    rastreo_q = t.rastreo_q, parte_q = t.parte_q, sap_q = t.sap_q, litros = t.litros,
    periodo_desde = t.periodo_desde, periodo_hasta = t.periodo_hasta,
    cantidad_sin_respaldo = t.cantidad, costo_unitario = e.costo_unitario, costo_por_clase = e.costo_por_clase,
    monto = case when t.tipo <> 'combustible_sin_parte' then round(t.cantidad * e.costo_unitario) end,
    actualizado_at = now()
  from t_h t join uso_equipos_info e using (equipo)
  where h.equipo = t.equipo and h.fecha = t.fecha and h.tipo = t.tipo
    and h.estado in ('abierto','justificado')
    and (h.obra, h.rastreo_q, h.parte_q, h.sap_q, h.litros, h.cantidad_sin_respaldo, h.costo_unitario)
        is distinct from
        (t.obra, t.rastreo_q, t.parte_q, t.sap_q, t.litros, t.cantidad, e.costo_unitario);

  -- resueltos: abiertos que ya no se detectan
  with res as (
    update uso_hallazgos h set estado = 'resuelto', resuelto_at = now(), actualizado_at = now()
    where h.estado = 'abierto'
      and not exists (select 1 from t_h t where t.equipo = h.equipo and t.fecha = h.fecha and t.tipo = h.tipo)
    returning h.tipo
  ) select coalesce(jsonb_object_agg(tipo, n), '{}') into r_resueltos
    from (select tipo, count(*) n from res group by 1) x;

  -- monto neto: una sola vez por equipo + día entre los abiertos (el mayor)
  update uso_hallazgos h set monto_neto = x.neto
  from (select id, case when row_number() over (partition by equipo, fecha
                                               order by monto desc nulls last, tipo) = 1
                        then monto else 0 end neto
        from uso_hallazgos where estado = 'abierto') x
  where h.id = x.id and h.monto_neto is distinct from x.neto;

  -- ── 5.6 Ociosos ─────────────────────────────────────────────────────
  delete from uso_ociosos;
  insert into uso_ociosos (equipo, denominacion, tipo_equipo, clase, obra, obra_origen,
                           ultimo_uso, desde, hasta, dias, dias_con_rastreo, confirmado)
  with m as (
    select u.equipo,
           max(u.fecha) filter (where u.uso_rastreo or u.parte_trabajo or u.tiene_sap
                                   or coalesce(u.litros, 0) > 0) ultimo_uso,
           max(u.fecha) filter (where u.en_taller) ultimo_taller
    from uso_diario u where u.fecha <= c_o group by 1
  ), r as (
    select m.*, greatest(coalesce(ultimo_uso, v_ini - 1), coalesce(ultimo_taller, v_ini - 1)) + 1 desde
    from m
  )
  select r.equipo, e.denominacion, e.tipo, e.clase, u.obra, u.obra_origen,
         r.ultimo_uso, r.desde, c_o, c_o - r.desde + 1,
         (select count(*) from uso_diario x where x.equipo = r.equipo and x.tiene_rastreo
            and x.fecha between r.desde and c_o),
         (select count(*) from uso_diario x where x.equipo = r.equipo and x.tiene_rastreo
            and x.fecha between r.desde and c_o) = c_o - r.desde + 1
  from r
  join uso_equipos_info e using (equipo)
  join uso_diario u on u.equipo = r.equipo and u.fecha = c_o
  where not u.en_taller and c_o - r.desde + 1 >= d_oc
    and r.ultimo_uso is not null;   -- sin ningún uso en el año → Datos faltantes, no ocioso

  -- ── 5.7 Casos ───────────────────────────────────────────────────────
  r_casos := uso_casos_sync();

  v_res := jsonb_build_object(
    'nuevos', r_nuevos, 'resueltos', r_resueltos, 'reabiertos', r_reabiertos, 'vencidos', n_venc,
    'detectados', n_cur, 'casos', r_casos,
    'cortes', jsonb_build_object('rastreo', c_r, 'partes', c_p, 'sap', c_s, 'combustible', c_c),
    'inicios', jsonb_build_object('rastreo', i_r, 'sap', i_s, 'combustible', i_c),
    'duracion_ms', (extract(epoch from clock_timestamp() - t0) * 1000)::int);

  insert into uso_refrescos (duracion_ms, resumen)
  values ((extract(epoch from clock_timestamp() - t0) * 1000)::int, v_res);

  return v_res;
end $$;


-- =====================================================================
-- 6. RPC DE GESTIÓN
-- =====================================================================
create or replace function public.uso__caso_check(p_caso uuid, p_texto text) returns uso_casos
language plpgsql stable security definer set search_path = public as $$
declare c uso_casos;
begin
  if not puede_uso_equipos() then raise exception 'Sin acceso' using errcode = '42501'; end if;
  if length(trim(coalesce(p_texto, ''))) < 3 then raise exception 'El texto es obligatorio'; end if;
  select * into c from uso_casos where id = p_caso;
  if not found then raise exception 'Caso inexistente'; end if;
  if c.estado = 'cerrado' then raise exception 'El caso está cerrado'; end if;
  return c;
end $$;

create or replace function public.uso_registrar_gestion(p_caso uuid, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare c uso_casos;
begin
  c := uso__caso_check(p_caso, p_texto);
  if c.estado not in ('nuevo','en_gestion') then
    raise exception 'Solo se registra gestión en casos nuevos o en gestión (este está %)', c.estado;
  end if;
  update uso_casos set estado = 'en_gestion', ultima_gestion_at = now() where id = p_caso;
  insert into uso_caso_gestiones (caso_id, tipo, texto, usuario_id)
  values (p_caso, 'gestion', trim(p_texto), uso_usuario_id());
end $$;

create or replace function public.uso_escalar(p_caso uuid, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare c uso_casos;
begin
  c := uso__caso_check(p_caso, p_texto);
  if c.estado = 'escalado' then raise exception 'El caso ya está escalado'; end if;
  update uso_casos set estado = 'escalado', escalado_at = now(), ultima_gestion_at = now() where id = p_caso;
  insert into uso_caso_gestiones (caso_id, tipo, texto, usuario_id)
  values (p_caso, 'escalado', trim(p_texto), uso_usuario_id());
end $$;

create or replace function public.uso_devolver(p_caso uuid, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare c uso_casos;
begin
  if not es_gerencia_uso() then raise exception 'Solo gerencia' using errcode = '42501'; end if;
  c := uso__caso_check(p_caso, p_texto);
  if c.estado <> 'escalado' then raise exception 'Solo se devuelven casos escalados'; end if;
  update uso_casos set estado = 'en_gestion', ultima_gestion_at = now() where id = p_caso;
  insert into uso_caso_gestiones (caso_id, tipo, texto, usuario_id)
  values (p_caso, 'devuelto', trim(p_texto), uso_usuario_id());
end $$;

create or replace function public.uso_nota_gerencia(p_caso uuid, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare c uso_casos;
begin
  if not es_gerencia_uso() then raise exception 'Solo gerencia' using errcode = '42501'; end if;
  c := uso__caso_check(p_caso, p_texto);
  insert into uso_caso_gestiones (caso_id, tipo, texto, usuario_id)
  values (p_caso, 'nota_gerencia', trim(p_texto), uso_usuario_id());
end $$;

create or replace function public.uso_justificar(p_hallazgos uuid[], p_comentario text) returns int
language plpgsql security definer set search_path = public as $$
declare n int; v_user uuid := uso_usuario_id();
begin
  if not puede_uso_equipos() then raise exception 'Sin acceso' using errcode = '42501'; end if;
  if length(trim(coalesce(p_comentario, ''))) < 3 then raise exception 'El comentario es obligatorio'; end if;
  if coalesce(array_length(p_hallazgos, 1), 0) = 0 then raise exception 'No hay hallazgos seleccionados'; end if;
  if exists (select 1 from uso_hallazgos where id = any(p_hallazgos) and estado <> 'abierto') then
    raise exception 'Solo se justifican hallazgos abiertos';
  end if;

  update uso_hallazgos set
    estado = 'justificado',
    valores_justificados = jsonb_build_object('rastreo', round(rastreo_q, 2), 'parte', round(parte_q, 2),
                                              'sap', round(sap_q, 2), 'litros', round(litros, 2)),
    justificado_por = v_user, justificado_at = now(),
    comentario_justificacion = trim(p_comentario), actualizado_at = now()
  where id = any(p_hallazgos);
  get diagnostics n = row_count;

  insert into uso_caso_gestiones (caso_id, tipo, texto, usuario_id)
  select c.id, 'justificacion',
         'Justificados ' || count(*) || ' hallazgo(s): ' || trim(p_comentario), v_user
  from uso_hallazgos h join uso_casos c on c.obra = h.obra and c.estado <> 'cerrado'
  where h.id = any(p_hallazgos) group by c.id;

  update uso_casos c set ultima_gestion_at = now()
  where c.estado <> 'cerrado'
    and exists (select 1 from uso_hallazgos h where h.id = any(p_hallazgos) and h.obra = c.obra);

  perform uso_casos_sync();
  return n;
end $$;


-- =====================================================================
-- 7. VISTAS (security_invoker)
-- =====================================================================
create or replace view public.v_uso_frescura with (security_invoker = true) as
select
  (r.resumen -> 'cortes' ->> 'rastreo')::date     corte_rastreo,
  (r.resumen -> 'cortes' ->> 'partes')::date      corte_partes,
  (r.resumen -> 'cortes' ->> 'sap')::date         corte_sap,
  (r.resumen -> 'cortes' ->> 'combustible')::date corte_combustible,
  r.at                                             recalculado_at,
  r.duracion_ms,
  (now() at time zone 'America/Asuncion')::date    hoy
from (select * from uso_refrescos order by id desc limit 1) r
where puede_uso_equipos();

create or replace view public.v_uso_hallazgos_abiertos with (security_invoker = true) as
select h.id, h.equipo, h.denominacion, h.fecha, h.tipo, h.obra, o.nombre obra_nombre, h.obra_origen,
       h.tipo_equipo, h.clase, h.unidad, h.rastreo_q, h.parte_q, h.sap_q, h.litros,
       h.periodo_desde, h.periodo_hasta, h.cantidad_sin_respaldo, h.costo_unitario, h.costo_por_clase,
       h.monto, h.detectado_at, h.reabierto_at, c.id caso_id,
       (c.ultima_gestion_at is not null
        and greatest(h.detectado_at, coalesce(h.reabierto_at, h.detectado_at)) > c.ultima_gestion_at) nuevo,
       h.monto_neto
from uso_hallazgos h
left join uso_obras o on o.codigo = h.obra
left join uso_casos c on c.obra = h.obra and c.estado <> 'cerrado'
where h.estado = 'abierto';

create or replace view public.v_uso_bandeja with (security_invoker = true) as
select c.id caso_id, c.obra, o.nombre obra_nombre, c.estado, c.creado_at, c.ultima_gestion_at, c.escalado_at,
       count(h.id) abiertos,
       count(h.id) filter (where h.tipo = 'uso_sin_parte')         n_uso_sin_parte,
       count(h.id) filter (where h.tipo = 'combustible_sin_parte') n_combustible_sin_parte,
       count(h.id) filter (where h.tipo = 'parte_sin_sap')         n_parte_sin_sap,
       count(h.id) filter (where h.tipo = 'parte_sobre_rastreo')   n_parte_sobre_rastreo,
       count(h.id) filter (where h.tipo = 'rastreo_sobre_parte')   n_rastreo_sobre_parte,
       coalesce(sum(h.monto_neto), 0)                               monto_abierto,
       min(h.fecha)                                                 fecha_mas_vieja,
       (now() at time zone 'America/Asuncion')::date - min(h.fecha) dias_mas_viejo,
       count(h.id) filter (where c.ultima_gestion_at is not null
         and greatest(h.detectado_at, coalesce(h.reabierto_at, h.detectado_at)) > c.ultima_gestion_at) nuevos_desde_gestion,
       g.created_at ultima_gestion_fecha, g.texto ultima_gestion_texto, g.tipo ultima_gestion_tipo
from uso_casos c
left join uso_obras o on o.codigo = c.obra
left join uso_hallazgos h on h.obra = c.obra and h.estado = 'abierto'
left join lateral (
  select created_at, texto, tipo from uso_caso_gestiones x
  where x.caso_id = c.id and x.tipo <> 'auto' order by created_at desc limit 1
) g on true
where c.estado <> 'cerrado'
group by c.id, c.obra, o.nombre, c.estado, c.creado_at, c.ultima_gestion_at, c.escalado_at,
         g.created_at, g.texto, g.tipo;

create or replace view public.v_uso_ociosos with (security_invoker = true) as
select z.*, o.nombre obra_nombre
from uso_ociosos z left join uso_obras o on o.codigo = z.obra
where es_gerencia_uso();

create or replace view public.v_uso_indicadores_obra with (security_invoker = true) as
with ini as (select date_trunc('year', (now() at time zone 'America/Asuncion'))::date d),
h as (
  select h.obra,
         count(*) filter (where estado = 'abierto') abiertos,
         coalesce(sum(monto_neto) filter (where estado = 'abierto'), 0) monto_abierto,
         count(*) filter (where estado = 'resuelto')    resueltos,
         count(*) filter (where estado = 'justificado') justificados,
         count(*) filter (where estado = 'vencido')     vencidos,
         count(*) filter (where detectado_at >= now() - interval '30 days') nuevos_30d,
         round(avg(resuelto_at::date - fecha) filter (where estado = 'resuelto'), 1) dias_prom_resolucion
  from uso_hallazgos h, ini
  where h.fecha >= ini.d or h.estado = 'vencido' and h.actualizado_at >= ini.d
  group by 1
), e as (
  select c.obra, count(*) veces_escalada
  from uso_caso_gestiones g join uso_casos c on c.id = g.caso_id, ini
  where g.tipo = 'escalado' and g.created_at >= ini.d group by 1
)
select h.*, coalesce(e.veces_escalada, 0) veces_escalada, o.nombre obra_nombre
from h left join e using (obra) left join uso_obras o on o.codigo = h.obra
where es_gerencia_uso();

create or replace view public.v_uso_datos_faltantes with (security_invoker = true) as
with a as (
  select equipo,
         bool_or(uso_rastreo or parte_trabajo or tiene_sap or coalesce(litros, 0) > 0) con_uso,
         bool_or(obra <> 'SIN') con_obra,
         count(*) filter (where gps_dudoso and fecha >= (now() at time zone 'America/Asuncion')::date - 30) gps_dias,
         count(*) filter (where gps_sin_senal and fecha >= (now() at time zone 'America/Asuncion')::date - 30) sin_senal_dias
  from uso_diario group by 1
)
select e.equipo, e.denominacion, e.tipo, e.clase, e.unidad, e.unidad_origen, e.costo_unitario, e.centro,
       (e.unidad is null) sin_unidad,
       (e.costo_unitario is null) sin_costo,
       not coalesce(a.con_obra, false) sin_obra,
       not coalesce(a.con_uso, false) sin_actividad_anio,   -- activo en el maestro sin ningún uso en el año
       coalesce(a.gps_dias, 0) gps_dudoso_dias_30,          -- días con GPS dudoso (encendido trabado) en 30 días
       coalesce(a.sin_senal_dias, 0) gps_sin_senal_dias_30  -- días con GPS sin señal (0 h y 0 km con trabajo) en 30 días
from uso_equipos_info e left join a using (equipo)
where e.unidad is null or e.costo_unitario is null
   or not coalesce(a.con_obra, false) or not coalesce(a.con_uso, false) or coalesce(a.gps_dias, 0) > 0
   or coalesce(a.sin_senal_dias, 0) > 0;


-- =====================================================================
-- 8. RLS Y PERMISOS
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['uso_parametros','uso_obras','uso_obras_alias','uso_equipos_info','uso_diario',
                           'uso_hallazgos','uso_casos','uso_caso_gestiones','uso_refrescos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.puede_uso_equipos()))',
                   t || '_sel', t);
  end loop;
end $$;

alter table public.uso_ociosos enable row level security;
revoke all on public.uso_ociosos from anon, authenticated;
grant select on public.uso_ociosos to authenticated;
drop policy if exists uso_ociosos_sel on public.uso_ociosos;
create policy uso_ociosos_sel on public.uso_ociosos for select to authenticated using ((select public.es_gerencia_uso()));
-- (select …) hace que la política se evalúe una vez por consulta y no por fila (16/10/2026: v_uso_datos_faltantes pasó de 17 s a 0,2 s)

revoke all on public.v_uso_frescura, public.v_uso_hallazgos_abiertos, public.v_uso_bandeja,
              public.v_uso_ociosos, public.v_uso_indicadores_obra, public.v_uso_datos_faltantes
  from anon, authenticated;
grant select on public.v_uso_frescura, public.v_uso_hallazgos_abiertos, public.v_uso_bandeja,
               public.v_uso_ociosos, public.v_uso_indicadores_obra, public.v_uso_datos_faltantes
  to authenticated;

-- Funciones: nadie por defecto; authenticated solo las que validan adentro
revoke all on function public.uso_acceso(), public.puede_uso_equipos(), public.es_gerencia_uso(),
  public.uso_usuario_id(), public.uso_param(text), public.uso_obra_codigo(text), public.uso_casos_sync(),
  public.uso_refrescar(), public.uso__caso_check(uuid, text), public.uso_registrar_gestion(uuid, text),
  public.uso_escalar(uuid, text), public.uso_devolver(uuid, text), public.uso_nota_gerencia(uuid, text),
  public.uso_justificar(uuid[], text)
  from public, anon;

grant execute on function public.uso_acceso(), public.puede_uso_equipos(), public.es_gerencia_uso()
  to authenticated, service_role;
grant execute on function public.uso_refrescar(), public.uso_registrar_gestion(uuid, text),
  public.uso_escalar(uuid, text), public.uso_devolver(uuid, text), public.uso_nota_gerencia(uuid, text),
  public.uso_justificar(uuid[], text)
  to authenticated, service_role;
revoke execute on function public.uso_casos_sync(), public.uso__caso_check(uuid, text),
  public.uso_usuario_id(), public.uso_param(text), public.uso_obra_codigo(text)
  from authenticated;
grant execute on function public.uso_casos_sync() to service_role;

-- Rendimiento (16/10/2026): uso_diario se recalcula entero en cada refresco → sin registro de recuperación;
-- más memoria para los ordenamientos de la función.
alter table public.uso_diario set unlogged;
alter function public.uso_refrescar() set work_mem = '64MB';

-- Refresco automático: todos los días 14:30 Asunción (17:30 UTC), después de la ingesta SAP.
-- Sin botón Recalcular (decisión 16/10/2026). Ver/cambiar: select * from cron.job;
select cron.unschedule('uso_equipos_refresco_diario')
where exists (select 1 from cron.job where jobname = 'uso_equipos_refresco_diario');
select cron.schedule('uso_equipos_refresco_diario', '30 17 * * *', $$select public.uso_refrescar()$$);

-- Fin
