-- ============================================================
-- REPUESTOS v1 (MVP) — kits de mantenimiento y cobertura de stock
-- Idempotente. Solo lectura desde la app.
--
-- Patrón de seguridad (igual que Correctivos, ver correctivos_setup.sql):
--   * La lógica vive en el esquema privado `rep` (no expuesto por la API).
--   * Las tablas sap_* tienen RLS solo para agente_lector, así que las vistas
--     públicas v_rep_* corren con permisos del dueño (NO security_invoker:
--     con security_invoker devolverían 0 filas a authenticated) y filtran con
--     corr_usuario_activo() → anon 0 filas, usuario inactivo 0 filas.
--   * Quién ve el módulo lo decide la interfaz (usuarios.ve_repuestos,
--     ver repuestos_acceso.sql).
--
-- Orden de aplicación: repuestos_setup.sql → repuestos_seed_familias.sql → repuestos_acceso.sql
-- ============================================================

create schema if not exists rep;
revoke all on schema rep from public, anon, authenticated;

-- ------------------------------------------------------------
-- 1. Tablas
-- ------------------------------------------------------------

-- 1.1 Fabricante / modelo sugeridos y revisados por equipo.
-- No toca equipos.fabricante ni equipos.modelo. Se carga por SQL.
create table if not exists public.equipo_familia (
  equipo_id            uuid primary key references public.equipos(id) on delete cascade,
  fabricante_sugerido  text,
  modelo_sugerido      text,
  sugerido_cargado_en  timestamptz default now(),
  fabricante_revisado  text,
  modelo_revisado      text,
  revisado_en          timestamptz
);
alter table public.equipo_familia enable row level security;
drop policy if exists equipo_familia_lectura on public.equipo_familia;
create policy equipo_familia_lectura on public.equipo_familia for select to authenticated using (true);
revoke all on public.equipo_familia from anon;
revoke insert, update, delete, truncate on public.equipo_familia from authenticated;
grant select on public.equipo_familia to authenticated;

-- 1.2 Parámetros (se cambian por SQL; no hay pantalla)
create table if not exists public.rep_parametros (
  clave       text primary key,
  valor       numeric not null,
  descripcion text
);
alter table public.rep_parametros enable row level security;
drop policy if exists rep_parametros_lectura on public.rep_parametros;
create policy rep_parametros_lectura on public.rep_parametros for select to authenticated using (true);
revoke all on public.rep_parametros from anon;
revoke insert, update, delete, truncate on public.rep_parametros from authenticated;
grant select on public.rep_parametros to authenticated;

insert into public.rep_parametros (clave, valor, descripcion) values
  ('plazo_reposicion_meses', 1,    'Supuesto. Lo que tarda Compras en reponer'),
  ('margen_meses',           1,    'Margen de seguridad sobre el plazo'),
  ('umbral_kit',             0.5,  'Fracción mínima de mantenimientos de la familia que usan el material'),
  ('min_mantenimientos',     3,    'Mínimo de mantenimientos con consumo para calcular el kit de una familia'),
  ('dias_trabado',           30,   'Días sin consumir material para considerar un mantenimiento trabado'),
  ('centro_stock',           1002, 'Centro de Ypané')
on conflict (clave) do nothing;   -- no pisa valores cambiados a mano

-- ------------------------------------------------------------
-- 2. Helpers (esquema rep)
-- ------------------------------------------------------------

-- Hoy en Paraguay
create or replace function rep.hoy() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Asuncion')::date
$$;

-- Familia = FABRICANTE MODELO (mayúsculas, espacios colapsados). Modelo nulo → familia nula.
create or replace function rep.familia(p_fabricante text, p_modelo text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case when nullif(trim(p_modelo), '') is null then null
              else trim(regexp_replace(upper(coalesce(trim(p_fabricante), '') || ' ' || trim(p_modelo)), '\s+', ' ', 'g'))
         end
$$;

-- Tipo de material por la descripción (el orden importa)
create or replace function rep.tipo_material(p_descripcion text) returns text
language sql immutable parallel safe set search_path = '' as $$
  with d as (select translate(upper(coalesce(p_descripcion, '')), 'ÁÉÍÓÚÜ', 'AEIOUU') as t)
  select case
    when t like 'ACEITE%'                                   then 'Aceite'
    when t like '%GRASA%'                                   then 'Grasa'
    when t like '%FRASCO%'                                  then 'Análisis de aceite'
    when t like '%TRAMPA%' or t like '%SEPARADOR%'          then 'Filtro trampa de agua'
    when t like '%ACEITE%'                                  then 'Filtro de aceite'
    when t like '%AIRE%'                                    then 'Filtro de aire'
    when t like '%GASOIL%' or t like '%COMBUSTIBLE%' or t like '%NAFTA%' then 'Filtro de combustible'
    when t like '%HIDRAULICO%'                              then 'Filtro hidráulico'
    when t like '%REFRIGERANTE%'                            then 'Filtro refrigerante'
    else 'Otro' end
  from d
$$;

-- Número sin ceros de más (26.000 → 26, 1.50 → 1.5) para el texto de materiales
create or replace function rep.fmt(p numeric) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case when p is null then null
              when p = trunc(p) then trunc(p)::text
              else rtrim(rtrim(p::text, '0'), '.') end
$$;

-- Parámetros en una fila
create or replace view rep.par as
select
  coalesce(max(valor) filter (where clave = 'plazo_reposicion_meses'), 1)   as plazo,
  coalesce(max(valor) filter (where clave = 'margen_meses'), 1)             as margen,
  coalesce(max(valor) filter (where clave = 'umbral_kit'), 0.5)             as umbral_kit,
  coalesce(max(valor) filter (where clave = 'min_mantenimientos'), 3)       as min_mant,
  coalesce(max(valor) filter (where clave = 'dias_trabado'), 30)            as dias_trabado,
  coalesce(max(valor) filter (where clave = 'centro_stock'), 1002)::bigint::text as centro
from public.rep_parametros;

-- ------------------------------------------------------------
-- 3. Bases internas
-- ------------------------------------------------------------

-- 3.1 Universo de equipos con fabricante/modelo efectivos y familia
--     (activos, sin contenedores ni tanques ST-CN / ST-TN)
create or replace view rep.equipos as
with b as (
  select e.id as equipo_id, e.numero_identificacion as equipo,
         case
           when nullif(trim(f.modelo_revisado), '') is not null then 'revisado'
           when nullif(trim(f.modelo_sugerido), '') is not null then 'sugerido'
           when nullif(trim(e.modelo), '') is not null and upper(trim(e.modelo)) <> 'N/A' then 'app'
           else 'sin_modelo'
         end as origen_modelo,
         e.fabricante as fab_app, e.modelo as mod_app,
         f.fabricante_sugerido, f.modelo_sugerido, f.fabricante_revisado, f.modelo_revisado
  from public.equipos e
  left join public.equipo_familia f on f.equipo_id = e.id
  where e.activo = true and e.numero_identificacion !~ '^ST-(CN|TN)'
)
select equipo_id, equipo, origen_modelo,
       case origen_modelo when 'revisado' then fabricante_revisado when 'sugerido' then fabricante_sugerido
                          when 'app' then fab_app end as fabricante,
       case origen_modelo when 'revisado' then modelo_revisado when 'sugerido' then modelo_sugerido
                          when 'app' then mod_app end as modelo,
       case origen_modelo when 'revisado' then rep.familia(fabricante_revisado, modelo_revisado)
                          when 'sugerido' then rep.familia(fabricante_sugerido, modelo_sugerido)
                          when 'app' then rep.familia(fab_app, mod_app) end as familia
from b;

-- 3.2 Consumo por orden × material (todas las clases de orden)
--     Posición consumida: necesaria > pendiente. Cantidad = necesaria − pendiente.
create or replace view rep.consumo as
select o.orden, o.equipo, o.clase_orden, o.fecha_entrada, p.material,
       sum(greatest(p.cantidad_necesaria - coalesce(p.cantidad_pendiente, 0), 0)) as consumido
from public.sap_ordenes o
join public.sap_reservas_pos p on p.orden = o.orden
where p.cantidad_necesaria > coalesce(p.cantidad_pendiente, 0)
  and p.material is not null
group by o.orden, o.equipo, o.clase_orden, o.fecha_entrada, p.material;

-- 3.3 Mantenimientos (TCPV) con consumo de equipos con familia
create or replace view rep.mant_familia as
select c.orden, c.fecha_entrada, e.equipo, e.familia, c.material, c.consumido
from rep.consumo c
join rep.equipos e on e.equipo = c.equipo
where c.clase_orden = 'TCPV' and e.familia is not null;

-- 3.4 Kit por familia
create or replace view rep.kit as
with fam as (
  select familia, count(distinct orden) as n from rep.mant_familia group by familia
), mat as (
  select familia, material,
         count(*) as n_mat,                                   -- una fila por orden × material
         percentile_cont(0.5) within group (order by consumido) as cant,
         coalesce(sum(consumido) filter (where fecha_entrada >= rep.hoy() - 365), 0) as c12
  from rep.mant_familia group by familia, material
)
select m.familia, m.material,
       f.n                                   as mantenimientos_familia,
       m.n_mat                               as mantenimientos_con_material,
       round(m.n_mat::numeric / f.n, 4)      as porcentaje,
       m.cant::numeric                       as cantidad_por_mantenimiento,
       m.c12                                 as consumo_familia_12m
from mat m
join fam f using (familia)
cross join rep.par p
where f.n >= p.min_mant
  and m.n_mat::numeric / f.n >= p.umbral_kit;

-- 3.5 Stock por material: Ypané y total, cada centro en su último corte
create or replace view rep.stock as
with cortes as (
  select centro, max(a_fecha) as a_fecha from public.sap_stock group by centro
)
select s.material,
       coalesce(sum(s.stock_cierre) filter (where s.centro = p.centro), 0) as stock_ypane,
       coalesce(sum(s.stock_cierre), 0)                                   as stock_total
from public.sap_stock s
join cortes c on c.centro = s.centro and c.a_fecha = s.a_fecha
cross join rep.par p
group by s.material;

-- 3.6 Materiales de kit con consumo real (todas las órdenes, todos los equipos) y cobertura
create or replace view rep.materiales as
with km as (
  select material, count(*) as familias, string_agg(familia, ', ' order by familia) as familias_lista
  from rep.kit group by material
), c12 as (
  select c.material, sum(c.consumido) as consumo_12m
  from rep.consumo c
  where c.fecha_entrada >= rep.hoy() - 365 and c.material in (select material from km)
  group by c.material
), descr as (
  select distinct on (material) material, descripcion, unidad
  from public.sap_reservas_pos
  where material in (select material from km)
  order by material, actualizado_en desc nulls last
), base as (
  select km.material, d.descripcion, d.unidad, rep.tipo_material(d.descripcion) as tipo,
         km.familias, km.familias_lista,
         coalesce(c12.consumo_12m, 0)        as consumo_12m,
         coalesce(c12.consumo_12m, 0) / 12.0 as consumo_mensual,
         coalesce(st.stock_ypane, 0)         as stock_ypane,
         coalesce(st.stock_total, 0)         as stock_total
  from km
  left join c12 using (material)
  left join descr d using (material)
  left join rep.stock st using (material)
)
select b.*,
       case when b.consumo_12m > 0 then round(b.stock_ypane / b.consumo_mensual, 2) end as cobertura_meses,
       case when b.consumo_12m = 0                               then 'sin_consumo'
            when b.stock_ypane / b.consumo_mensual < p.plazo            then 'riesgo'
            when b.stock_ypane / b.consumo_mensual < p.plazo + p.margen then 'atencion'
            else 'ok' end as estado
from base b cross join rep.par p;

-- 3.7 Mantenimientos pendientes: TCPV últimos 12 meses con material reservado y nada consumido
create or replace view rep.pendientes as
with pos as (
  select o.orden, o.equipo, o.fecha_entrada, o.status_sistema, p.material,
         sum(greatest(p.cantidad_necesaria - coalesce(p.cantidad_pendiente, 0), 0)) as consumido,
         sum(coalesce(p.cantidad_pendiente, 0))                                     as pendiente
  from public.sap_ordenes o
  join public.sap_reservas_pos p on p.orden = o.orden
  where o.clase_orden = 'TCPV' and o.fecha_entrada >= rep.hoy() - 365
  group by o.orden, o.equipo, o.fecha_entrada, o.status_sistema, p.material
), ord as (
  select orden, equipo, fecha_entrada, status_sistema,
         string_agg(material || '×' || rep.fmt(pendiente), ', ' order by material) filter (where pendiente > 0) as materiales
  from pos
  group by orden, equipo, fecha_entrada, status_sistema
  having sum(consumido) = 0 and sum(pendiente) > 0
)
select e.familia, o.equipo, o.orden, o.fecha_entrada,
       rep.hoy() - o.fecha_entrada as dias,
       o.status_sistema,
       case when o.status_sistema like '%CTEC%'               then 'cerrada_sin_consumo'
            when rep.hoy() - o.fecha_entrada > p.dias_trabado then 'trabado'
            else 'en_curso' end as lectura,
       o.materiales
from ord o
left join rep.equipos e on e.equipo = o.equipo
cross join rep.par p;

-- 3.8 Familias con kit
create or replace view rep.familias as
with eq as (
  select familia, count(*) as equipos,
         string_agg(equipo, ', ' order by equipo) as equipos_lista,
         mode() within group (order by origen_modelo) as origen_modelo,
         mode() within group (order by fabricante)    as fabricante,
         mode() within group (order by modelo)        as modelo
  from rep.equipos where familia is not null group by familia
), mt as (
  select distinct familia, equipo, orden, fecha_entrada from rep.mant_familia
), m as (
  select familia, count(*) as hist,
         count(*) filter (where fecha_entrada >= rep.hoy() - 365) as m12,
         max(fecha_entrada) as ultimo
  from mt group by familia
), gaps as (
  select familia, fecha_entrada - lag(fecha_entrada) over (partition by equipo order by fecha_entrada, orden) as d
  from mt
), g as (
  select familia, percentile_cont(0.5) within group (order by d) as dias
  from gaps where d >= 14 group by familia
), k as (
  select k.familia, count(*) as materiales_kit,
         count(*) filter (where mm.estado = 'riesgo')   as kit_en_riesgo,
         count(*) filter (where mm.estado = 'atencion') as kit_en_atencion,
         min(mm.cobertura_meses) as peor_cobertura
  from rep.kit k join rep.materiales mm using (material)
  group by k.familia
), pe as (
  select familia, count(*) as n from rep.pendientes where familia is not null group by familia
)
select k.familia, eq.fabricante, eq.modelo, eq.equipos, eq.equipos_lista, eq.origen_modelo,
       coalesce(m.hist, 0) as mantenimientos_historial,
       coalesce(m.m12, 0)  as mantenimientos_12m,
       m.ultimo            as ultimo_mantenimiento,
       round(g.dias::numeric) as dias_entre_mantenimientos,
       k.materiales_kit, k.kit_en_riesgo, k.kit_en_atencion, k.peor_cobertura,
       coalesce(pe.n, 0)   as mantenimientos_pendientes
from k
join eq using (familia)
left join m using (familia)
left join g using (familia)
left join pe using (familia);

-- ------------------------------------------------------------
-- 4. Vistas públicas (filtradas por corr_usuario_activo())
-- ------------------------------------------------------------

create or replace view public.v_rep_equipos as
select equipo_id, equipo, fabricante, modelo, familia, origen_modelo
from rep.equipos
where (select public.corr_usuario_activo());

create or replace view public.v_rep_kit as
select familia, material, mantenimientos_familia, mantenimientos_con_material, porcentaje,
       cantidad_por_mantenimiento, consumo_familia_12m
from rep.kit
where (select public.corr_usuario_activo());

create or replace view public.v_rep_materiales as
select material, descripcion, unidad, tipo, familias, familias_lista, consumo_12m, consumo_mensual,
       stock_ypane, stock_total, cobertura_meses, estado
from rep.materiales
where (select public.corr_usuario_activo());

create or replace view public.v_rep_familias as
select familia, fabricante, modelo, equipos, equipos_lista, origen_modelo, mantenimientos_historial,
       mantenimientos_12m, ultimo_mantenimiento, dias_entre_mantenimientos, materiales_kit,
       kit_en_riesgo, kit_en_atencion, peor_cobertura, mantenimientos_pendientes
from rep.familias
where (select public.corr_usuario_activo());

create or replace view public.v_rep_mant_pendientes as
select familia, equipo, orden, fecha_entrada, dias, status_sistema, lectura, materiales
from rep.pendientes
where (select public.corr_usuario_activo());

-- Equipos con revisión cargada que cambia la familia sugerida (hoy vacía)
create or replace view public.v_rep_comparacion_modelos as
select e.numero_identificacion as equipo,
       f.fabricante_sugerido, f.modelo_sugerido, f.fabricante_revisado, f.modelo_revisado,
       rep.familia(f.fabricante_sugerido, f.modelo_sugerido) as familia_sugerida,
       rep.familia(f.fabricante_revisado, f.modelo_revisado) as familia_revisada
from public.equipo_familia f
join public.equipos e on e.id = f.equipo_id
where f.modelo_revisado is not null
  and rep.familia(f.fabricante_sugerido, f.modelo_sugerido) is distinct from rep.familia(f.fabricante_revisado, f.modelo_revisado)
  and (select public.corr_usuario_activo());

create or replace view public.v_rep_resumen as
select
  (select count(*) from rep.materiales where estado = 'riesgo')      as materiales_riesgo,
  (select count(*) from rep.materiales where estado = 'atencion')    as materiales_atencion,
  (select count(*) from rep.materiales where estado = 'ok')          as materiales_ok,
  (select count(*) from rep.materiales where estado = 'sin_consumo') as materiales_sin_consumo,
  (select count(distinct familia) from rep.kit)                      as familias_con_kit,
  (select count(*) from rep.equipos where familia is null)           as equipos_sin_familia,
  (select count(*) from rep.pendientes where lectura = 'trabado')             as pendientes_trabado,
  (select count(*) from rep.pendientes where lectura = 'en_curso')            as pendientes_en_curso,
  (select count(*) from rep.pendientes where lectura = 'cerrada_sin_consumo') as pendientes_cerrada_sin_consumo,
  (select max(a_fecha) from public.sap_stock s, rep.par p where s.centro = p.centro) as corte_stock_ypane,
  (select max(procesado_en) from public.sap_ingestas where fuente = 'trabajo')  as ordenes_procesado_en,
  (select max(procesado_en) from public.sap_ingestas where fuente = 'reservas') as reservas_procesado_en
where (select public.corr_usuario_activo());

revoke all on public.v_rep_equipos, public.v_rep_kit, public.v_rep_materiales, public.v_rep_familias,
              public.v_rep_mant_pendientes, public.v_rep_comparacion_modelos, public.v_rep_resumen
  from public, anon;
grant select on public.v_rep_equipos, public.v_rep_kit, public.v_rep_materiales, public.v_rep_familias,
               public.v_rep_mant_pendientes, public.v_rep_comparacion_modelos, public.v_rep_resumen
  to authenticated;
