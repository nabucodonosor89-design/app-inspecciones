-- ============================================================
-- MÓDULO CORRECTIVOS — vistas de solo lectura (Parte A)
-- Idempotente. Aplicado en Supabase el 12/10/2026 (migración correctivos_setup_v1).
--
-- Diseño de seguridad (difiere del prompt original, ver CLAUDE.md):
--   Las tablas sap_* tienen RLS con una única política para el rol
--   agente_lector, así que un usuario `authenticated` no ve filas.
--   En vez de abrir esas políticas, se sigue el patrón del Historial:
--   la lógica vive en el esquema privado `corr` (no expuesto por la API)
--   y las vistas públicas v_corr_* se ejecutan con permisos del dueño,
--   filtradas por corr_usuario_activo() (usuario activo en `usuarios`).
--   anon → 0 filas. Usuario desactivado → 0 filas.
-- ============================================================

create schema if not exists corr;
revoke all on schema corr from public, anon, authenticated;

-- ------------------------------------------------------------
-- 0. Helpers
-- ------------------------------------------------------------
-- Normaliza números SAP (orden / aviso): trim, sin ceros a la izquierda, '' → null
create or replace function public.corr_norm(x text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select nullif(ltrim(trim(x), '0'), '')
$$;

-- Hoy en Paraguay
create or replace function public.corr_hoy() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Asuncion')::date
$$;

-- ¿El usuario logueado está activo en la tabla usuarios?
create or replace function public.corr_usuario_activo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuarios where email = auth.email() and activo = true)
$$;
revoke execute on function public.corr_usuario_activo() from public, anon;
grant execute on function public.corr_usuario_activo() to authenticated;

-- Log de la sincronización SAP → app (la escribe corr_sync_sap, ver correctivos_sync.sql).
-- Vive en el esquema privado: los clientes solo lo leen vía v_corr_cambios.
create table if not exists corr.sync_log (
  id             bigserial primary key,
  ejecutado_en   timestamptz not null default now(),
  dry_run        boolean not null,
  regla          text not null,          -- R1 / R2 / R3 / ERROR
  tabla          text,
  registro_id    text,
  equipo         text,
  campo          text,
  valor_anterior text,
  valor_nuevo    text,
  resultado      text not null,          -- aplicado / omitido_ambiguo / omitido_dry_run / error
  detalle        text
);
create index if not exists idx_corr_sync_log_fecha on corr.sync_log (ejecutado_en desc);

-- ------------------------------------------------------------
-- 1. Bases internas (esquema corr)
-- ------------------------------------------------------------

-- 1.1 Todas las órdenes SAP normalizadas (para el cruce se usan todas las clases)
create or replace view corr.ordenes as
select o.orden,
       o.aviso,
       corr_norm(o.orden::text)            as orden_n,
       corr_norm(o.aviso::text)            as aviso_n,
       o.clase_orden,
       (o.clase_orden in ('TCOC','TCUR'))  as es_correctiva,
       nullif(trim(o.equipo), '')          as equipo,
       o.texto,
       coalesce(nullif(trim(o.ubicacion), ''), '(sin ubicación)') as ubicacion,
       o.status_usuario,
       o.status_sistema,
       o.fecha_entrada,
       o.fecha_fin_real,
       (coalesce(o.status_sistema, '') not like '%CTEC%'
        and o.status_usuario is distinct from '9EQL') as abierta
from public.sap_ordenes o;

-- 1.2 Dimensión equipo: equipos de la app + sap_equipos (deduplicado) como respaldo.
--     Tipo: equipos.tipo_equipo → sap_equipos.tipo_equipo → 'S'. Solo V/P/M/B son válidos.
create or replace view corr.eq as
with s as (
  select distinct on (trim(equipo)) trim(equipo) as equipo, denominacion, tipo_equipo
  from public.sap_equipos
  where nullif(trim(equipo), '') is not null
  order by trim(equipo), actualizado_en desc nulls last
), e as (
  select distinct on (numero_identificacion) numero_identificacion as equipo, denominacion, tipo_equipo, es_critico
  from public.equipos
  where nullif(trim(numero_identificacion), '') is not null
  order by numero_identificacion, activo desc nulls last, updated_at desc nulls last
)
select coalesce(e.equipo, s.equipo) as equipo,
       coalesce(e.denominacion, s.denominacion) as denominacion,
       case
         when e.tipo_equipo in ('V','P','M','B') then e.tipo_equipo
         when s.tipo_equipo in ('V','P','M','B') then s.tipo_equipo
         else 'S'
       end as tipo,
       coalesce(e.es_critico, false) as es_critico
from e full join s on s.equipo = e.equipo;

-- 1.3 Correctivos de la app abiertos, con la orden SAP cruzada (una sola por correctivo)
create or replace view corr.app as
with m as (
  select m.id, m.equipo_id, m.numero_aviso, m.numero_orden,
         corr_norm(m.numero_orden) as orden_n,
         corr_norm(m.numero_aviso) as aviso_n,
         m.prioridad, m.estado, m.pedido, m.ingresa_taller_ypane, m.taller_tercero,
         m.descripcion_averia,
         coalesce(m.fecha_ingreso_taller, m.fecha_inicio_averia) as fecha_ref
  from public.mantenimientos m
  where m.tipo_mantenimiento = 'Correctivo'
    and m.estado in ('Taller Espera','Taller Entrada')
), cand as (
  -- por N° de orden
  select m.id, o.orden, o.abierta, o.status_usuario, o.fecha_entrada
  from m join corr.ordenes o on o.orden_n = m.orden_n
  where m.orden_n is not null
  union all
  -- por aviso, solo si la app no tiene orden
  select m.id, o.orden, o.abierta, o.status_usuario, o.fecha_entrada
  from m join corr.ordenes o on o.aviso_n = m.aviso_n
  where m.orden_n is null and m.aviso_n is not null
), elegida as (
  select distinct on (id) id, orden, abierta, status_usuario
  from cand
  order by id, abierta desc, fecha_entrada desc nulls last, orden desc
)
select m.id,
       eqa.numero_identificacion as equipo,
       coalesce(d.denominacion, eqa.denominacion) as denominacion,
       coalesce(d.tipo, case when eqa.tipo_equipo in ('V','P','M','B') then eqa.tipo_equipo else 'S' end) as tipo,
       coalesce(eqa.es_critico, false) as es_critico,
       m.numero_aviso, m.numero_orden, m.orden_n, m.aviso_n,
       c.orden                          as orden_cruzada,
       (c.orden is not null)            as cruza,
       coalesce(c.abierta, false)       as orden_abierta,
       c.status_usuario                 as status_sap,
       m.prioridad, m.estado,
       case m.estado when 'Taller Espera' then 'En espera'
                     when 'Taller Entrada' then 'En reparación' end as estado_label,
       m.pedido,
       case when coalesce(m.ingresa_taller_ypane, nullif(trim(m.taller_tercero), '') is null)
            then 'Ypané' else 'Tercero' end as taller_tipo,
       case when coalesce(m.ingresa_taller_ypane, nullif(trim(m.taller_tercero), '') is null)
            then 'Ypané' else coalesce(nullif(trim(m.taller_tercero), ''), '(tercero sin nombre)') end as taller,
       m.descripcion_averia,
       m.fecha_ref,
       corr_hoy() - m.fecha_ref as dias_taller
from m
left join public.equipos eqa on eqa.id = m.equipo_id
left join corr.eq d on d.equipo = eqa.numero_identificacion
left join elegida c on c.id = m.id;

-- 1.4 Órdenes correctivas SAP abiertas
create or replace view corr.sap_abiertas as
select o.orden, o.aviso, o.equipo,
       d.denominacion,
       coalesce(d.tipo, 'S') as tipo,
       coalesce(d.es_critico, false) as es_critico,
       o.ubicacion, o.texto, o.status_usuario, o.fecha_entrada,
       corr_hoy() - o.fecha_entrada as dias_abierta,
       exists (select 1 from corr.app a where a.orden_cruzada = o.orden) as en_app
from corr.ordenes o
left join corr.eq d on d.equipo = o.equipo
where o.es_correctiva and o.abierta;

-- 1.5 Inconsistencias: correctivos de la app que no deberían estar en taller
create or replace view corr.inconsistencias as
select a.id, a.equipo, a.denominacion, a.tipo, a.taller, a.numero_aviso, a.numero_orden,
       a.orden_cruzada, a.status_sap, a.dias_taller,
       case
         when a.cruza and not a.orden_abierta              then 'orden_cerrada'
         when a.orden_n is null and a.aviso_n is null      then 'sin_orden_ni_aviso'
         when a.orden_n is not null and not a.cruza        then 'orden_no_encontrada'
         when a.orden_n is null and not a.cruza            then 'aviso_sin_orden'
       end as motivo
from corr.app a
where (a.cruza and not a.orden_abierta) or not a.cruza;

-- 1.6 Stock: último corte por centro
create or replace view corr.stock as
select s.centro, s.material, s.a_fecha, s.stock_cierre
from public.sap_stock s
join (select centro, max(a_fecha) as a_fecha from public.sap_stock group by centro) u
  on u.centro = s.centro and u.a_fecha = s.a_fecha;

-- ------------------------------------------------------------
-- 2. Vistas públicas (todas filtradas por corr_usuario_activo())
-- ------------------------------------------------------------

-- 2.1 Frescura
create or replace view public.v_corr_frescura as
select
  max(procesado_en) filter (where fuente = 'ie36')         as ie36,
  max(procesado_en) filter (where fuente = 'trabajo')      as trabajo,
  max(procesado_en) filter (where fuente = 'reservas')     as reservas,
  max(procesado_en) filter (where fuente = 'stock')        as stock,
  max(procesado_en) filter (where fuente = 'consumos')     as consumos,
  max(procesado_en) filter (where fuente = 'costo_equipo') as costo_equipo,
  (select max(a_fecha) from public.sap_stock where centro = '1002') as corte_stock_1002,
  (select max(ejecutado_en) from corr.sync_log)            as ultima_sync,
  (select bool_or(dry_run) from corr.sync_log
    where ejecutado_en = (select max(ejecutado_en) from corr.sync_log)) as ultima_sync_dry_run
from public.sap_ingestas
where (select corr_usuario_activo());

-- 2.2 Órdenes SAP abiertas
create or replace view public.v_corr_sap_abiertas as
select orden, aviso, equipo, denominacion, tipo, es_critico, ubicacion, texto,
       status_usuario, fecha_entrada, dias_abierta, en_app
from corr.sap_abiertas
where (select corr_usuario_activo());

-- 2.3 Correctivos de la app (Ypané + terceros)
create or replace view public.v_corr_ypane as
select id, equipo, denominacion, tipo, es_critico, numero_aviso, numero_orden, orden_cruzada,
       prioridad, estado_label, pedido, taller_tipo, taller, descripcion_averia, dias_taller,
       status_sap, orden_abierta
from corr.app
where (select corr_usuario_activo());

-- 2.4 Inconsistencias
create or replace view public.v_corr_inconsistencias as
select id, equipo, denominacion, tipo, taller, numero_aviso, numero_orden, orden_cruzada,
       status_sap, dias_taller, motivo
from corr.inconsistencias
where (select corr_usuario_activo());

-- 2.5 Equipos con más de una orden/aviso abierto
create or replace view public.v_corr_duplicados as
with u as (
  select equipo, denominacion, tipo, aviso::text as aviso, orden::text as orden, ubicacion,
         dias_abierta as dias, status_usuario as status,
         case when en_app then 'En app' else 'Solo SAP' end as origen
  from corr.sap_abiertas
  where equipo is not null
  union all
  select equipo, denominacion, tipo, numero_aviso, numero_orden, taller,
         dias_taller, estado_label, 'Solo app (sin orden SAP abierta)'
  from corr.app
  where not (cruza and orden_abierta) and equipo is not null
), c as (
  select u.*, count(*) over (partition by equipo) as cantidad from u
)
select equipo, denominacion, tipo, aviso, orden, ubicacion, dias, status, origen, cantidad
from c
where cantidad > 1 and (select corr_usuario_activo());

-- 2.6 Materiales con cobertura parcial
create or replace view public.v_corr_materiales as
with ords as (
  -- una fila por orden correctiva abierta; si está en la app, datos del correctivo
  select o.orden, o.equipo, o.es_critico,
         case when a.id is not null then 'App' else 'Solo SAP' end as origen,
         coalesce(a.taller, o.ubicacion) as taller_o_ubicacion,
         coalesce(a.dias_taller, o.dias_abierta) as dias
  from corr.sap_abiertas o
  left join lateral (
    select x.id, x.taller, x.dias_taller from corr.app x
    where x.orden_cruzada = o.orden order by x.dias_taller desc nulls last limit 1
  ) a on true
), lin as (
  select ords.*, r.posicion, r.material, r.descripcion, r.cantidad_pendiente, r.unidad,
         coalesce(r.centro, '1002') as centro,
         s.stock_cierre as stock_centro
  from ords
  join public.sap_reservas_pos r on r.orden = ords.orden and r.cantidad_pendiente > 0
  left join corr.stock s on s.centro = coalesce(r.centro, '1002') and s.material = r.material
), asig as (
  select lin.*,
         coalesce(sum(cantidad_pendiente) over (
           partition by material, centro
           order by es_critico desc, dias desc nulls last, orden, posicion
           rows between unbounded preceding and 1 preceding), 0) as demanda_previa
  from lin
), cub as (
  select asig.*,
         least(cantidad_pendiente, greatest(coalesce(stock_centro, 0) - demanda_previa, 0)) as cantidad_cubierta
  from asig
)
select equipo, orden, origen, taller_o_ubicacion, es_critico, dias, material, descripcion,
       cantidad_pendiente, unidad, centro, stock_centro, cantidad_cubierta,
       cantidad_pendiente - cantidad_cubierta as cantidad_faltante,
       case when cantidad_cubierta >= cantidad_pendiente then 'despacho'
            when cantidad_cubierta > 0 then 'parcial'
            else 'bloqueo' end as situacion,
       posicion
from cub
where (select corr_usuario_activo());

-- 2.7 Solo SAP por obra
create or replace view public.v_corr_solo_sap_por_obra as
select ubicacion, count(*) as total, count(*) filter (where dias_abierta > 10) as mas_10_dias
from corr.sap_abiertas
where not en_app and (select corr_usuario_activo())
group by ubicacion;

-- 2.8 MTTR: cierres de los últimos 90 días (base) y outliers (> 60 días)
create or replace view corr.cierres_90 as
select m.id, e.numero_identificacion as equipo,
       case when coalesce(m.ingresa_taller_ypane, nullif(trim(m.taller_tercero), '') is null)
            then 'Ypané' else coalesce(nullif(trim(m.taller_tercero), ''), '(tercero sin nombre)') end as taller,
       coalesce(m.fecha_ingreso_taller, m.fecha_inicio_averia) as ingreso,
       m.fecha_liberacion as liberacion,
       m.fecha_liberacion - coalesce(m.fecha_ingreso_taller, m.fecha_inicio_averia) as dias
from public.mantenimientos m
left join public.equipos e on e.id = m.equipo_id
where m.tipo_mantenimiento = 'Correctivo'
  and m.fecha_liberacion is not null
  and m.fecha_liberacion between corr_hoy() - 90 and corr_hoy()  -- excluye fechas futuras mal cargadas
  and coalesce(m.fecha_ingreso_taller, m.fecha_inicio_averia) is not null
  and m.fecha_liberacion >= coalesce(m.fecha_ingreso_taller, m.fecha_inicio_averia);

create or replace view public.v_corr_mttr_outliers as
select equipo, taller, ingreso, liberacion, dias
from corr.cierres_90
where dias > 60 and (select corr_usuario_activo());

-- 2.8b Cambios automáticos de la sincronización (últimos 7 días)
create or replace view public.v_corr_cambios as
select id, ejecutado_en, dry_run, regla, equipo, campo, valor_anterior, valor_nuevo, resultado, detalle
from corr.sync_log
where ejecutado_en >= now() - interval '7 days' and (select corr_usuario_activo());

-- 2.9 KPIs
create or replace view public.v_corr_kpis as
select
  -- Empresa
  (select count(*) from corr.sap_abiertas)                                         as sap_abiertas,
  (select count(*) from corr.sap_abiertas where en_app)                            as sap_en_app,
  (select count(*) from corr.sap_abiertas where not en_app)                        as sap_solo_sap,
  (select count(*) from corr.sap_abiertas where not en_app and dias_abierta > 10)  as sap_solo_sap_10d,
  (select count(*) from corr.sap_abiertas where equipo is null)                    as sap_sin_equipo,
  (select count(distinct equipo) from public.v_corr_duplicados)                    as equipos_multi_orden,
  (select count(*) from public.v_corr_duplicados)                                  as ordenes_multi_orden,
  -- Por tipo (órdenes SAP abiertas)
  (select count(*) from corr.sap_abiertas where tipo = 'V') as tipo_v,
  (select count(*) from corr.sap_abiertas where tipo = 'P') as tipo_p,
  (select count(*) from corr.sap_abiertas where tipo = 'M') as tipo_m,
  (select count(*) from corr.sap_abiertas where tipo = 'B') as tipo_b,
  (select count(*) from corr.sap_abiertas where tipo = 'S') as tipo_s,
  -- Ypané (app)
  (select count(*) from corr.app)                                      as yp_en_taller,
  (select count(*) from corr.app where estado = 'Taller Espera')       as yp_en_espera,
  (select count(*) from corr.app where estado = 'Taller Entrada')      as yp_en_reparacion,
  (select count(*) from corr.app where taller_tipo = 'Tercero')        as yp_terceros,
  (select count(*) from corr.app where es_critico)                     as yp_criticos,
  (select count(*) from corr.app where orden_n is null)                as yp_sin_orden,
  (select count(*) from corr.app where not coalesce(pedido, false))    as yp_sin_pedido,
  (select count(*) from corr.app where dias_taller > 10)               as yp_urgentes,
  -- Inconsistencias
  (select count(*) from corr.inconsistencias)                                       as inc_total,
  (select count(*) from corr.inconsistencias where motivo = 'orden_cerrada')        as inc_orden_cerrada,
  (select count(*) from corr.inconsistencias where motivo = 'sin_orden_ni_aviso')   as inc_sin_orden_ni_aviso,
  (select count(*) from corr.inconsistencias where motivo = 'orden_no_encontrada')  as inc_orden_no_encontrada,
  (select count(*) from corr.inconsistencias where motivo = 'aviso_sin_orden')      as inc_aviso_sin_orden,
  -- Materiales
  (select count(*) from public.v_corr_materiales where situacion = 'bloqueo')  as mat_bloqueo,
  (select count(*) from public.v_corr_materiales where situacion = 'parcial')  as mat_parcial,
  (select count(*) from public.v_corr_materiales where situacion = 'despacho') as mat_despacho,
  -- MTTR 90 días sin outliers (> 60 días)
  (select round(avg(dias)::numeric, 1) from corr.cierres_90 where dias <= 60) as mttr_90d,
  (select count(*) from corr.cierres_90 where dias <= 60)                     as mttr_cierres,
  (select count(*) from corr.cierres_90 where dias > 60)                      as mttr_outliers
where (select corr_usuario_activo());

-- ------------------------------------------------------------
-- 3. Permisos
-- ------------------------------------------------------------
revoke all on public.v_corr_frescura, public.v_corr_sap_abiertas, public.v_corr_ypane,
              public.v_corr_inconsistencias, public.v_corr_duplicados, public.v_corr_materiales,
              public.v_corr_solo_sap_por_obra, public.v_corr_mttr_outliers, public.v_corr_kpis, public.v_corr_cambios
  from public, anon;
grant select on public.v_corr_frescura, public.v_corr_sap_abiertas, public.v_corr_ypane,
                public.v_corr_inconsistencias, public.v_corr_duplicados, public.v_corr_materiales,
                public.v_corr_solo_sap_por_obra, public.v_corr_mttr_outliers, public.v_corr_kpis, public.v_corr_cambios
  to authenticated;

-- ------------------------------------------------------------
-- 4. Índices (solo los que hacen falta según EXPLAIN ANALYZE)
-- ------------------------------------------------------------
create index if not exists idx_sap_ordenes_orden_n on public.sap_ordenes (corr_norm(orden::text));
create index if not exists idx_sap_ordenes_aviso_n on public.sap_ordenes (corr_norm(aviso::text));
create index if not exists idx_sap_reservas_pos_orden on public.sap_reservas_pos (orden);
create index if not exists idx_sap_stock_centro_fecha_mat on public.sap_stock (centro, a_fecha, material);
create index if not exists idx_mant_tipo_estado on public.mantenimientos (tipo_mantenimiento, estado);
