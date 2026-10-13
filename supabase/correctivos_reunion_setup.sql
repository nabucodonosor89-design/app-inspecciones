-- ============================================================
-- CORRECTIVOS — vista "Reunión" de equipos parados
-- Idempotente. Sigue el patrón de correctivos_setup.sql:
--   lógica en el esquema privado `corr`, vistas públicas filtradas
--   por corr_usuario_activo() (las tablas sap_* no son legibles por
--   `authenticated`). Solo lectura sobre tablas SAP.
--   Única tabla nueva: correctivos_tareas.
-- Aplicado en Supabase el 13/10/2026.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columnas nuevas
-- ------------------------------------------------------------
-- 1.1 Centro de emplazamiento (lo carga sap_ingestar desde el IE36, columna "Centro emplazamiento")
alter table public.sap_equipos add column if not exists centro text;

-- 1.2 Permiso para gestionar tareas de la reunión
alter table public.usuarios add column if not exists gestiona_correctivos boolean not null default false;

-- ¿El usuario logueado puede crear / editar / cerrar tareas? (admin o gestiona_correctivos, activo)
create or replace function public.correctivos_puede_gestionar() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from usuarios
    where email = auth.email() and activo = true
      and (rol = 'admin' or gestiona_correctivos)
  )
$$;
revoke execute on function public.correctivos_puede_gestionar() from public, anon;
grant execute on function public.correctivos_puede_gestionar() to authenticated;

-- ------------------------------------------------------------
-- 2. Tareas de la reunión
-- ------------------------------------------------------------
create table if not exists public.correctivos_tareas (
  id              uuid primary key default gen_random_uuid(),
  equipo          text not null,                 -- ID técnico (ej. VL-CN081)
  orden           bigint,                        -- opcional, orden SAP relacionada
  descripcion     text not null check (length(trim(descripcion)) > 0),
  fecha_objetivo  date not null,
  estado          text not null default 'pendiente' check (estado in ('pendiente','hecha')),
  creado_por      uuid references public.usuarios(id) default public.usuario_actual_id(),
  creado_en       timestamptz not null default now(),
  cerrado_en      timestamptz,
  actualizado_en  timestamptz not null default now()
);
create index if not exists idx_corr_tareas_equipo on public.correctivos_tareas (equipo);
create index if not exists idx_corr_tareas_estado_fecha on public.correctivos_tareas (estado, fecha_objetivo);

-- actualizado_en + cerrado_en automáticos
create or replace function public.correctivos_tareas_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.actualizado_en := now();
  if new.estado = 'hecha' and (tg_op = 'INSERT' or old.estado is distinct from 'hecha') then
    new.cerrado_en := coalesce(new.cerrado_en, now());
  elsif new.estado = 'pendiente' then
    new.cerrado_en := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_correctivos_tareas_touch on public.correctivos_tareas;
create trigger trg_correctivos_tareas_touch before insert or update on public.correctivos_tareas
  for each row execute function public.correctivos_tareas_touch();

alter table public.correctivos_tareas enable row level security;
drop policy if exists corr_tareas_sel on public.correctivos_tareas;
drop policy if exists corr_tareas_ins on public.correctivos_tareas;
drop policy if exists corr_tareas_upd on public.correctivos_tareas;
create policy corr_tareas_sel on public.correctivos_tareas for select to authenticated
  using ((select corr_usuario_activo()));
create policy corr_tareas_ins on public.correctivos_tareas for insert to authenticated
  with check ((select correctivos_puede_gestionar()));
create policy corr_tareas_upd on public.correctivos_tareas for update to authenticated
  using ((select correctivos_puede_gestionar())) with check ((select correctivos_puede_gestionar()));
-- Sin política de DELETE: una tarea se cierra, no se borra.
revoke all on public.correctivos_tareas from anon;
revoke delete on public.correctivos_tareas from authenticated;
grant select, insert, update on public.correctivos_tareas to authenticated;

-- ------------------------------------------------------------
-- 3. Lógica de parados (esquema privado corr)
-- ------------------------------------------------------------

-- 3.1 Inventario SAP deduplicado por ID técnico (hay IDs repetidos en sap_equipos)
create or replace view corr.par_inventario as
select distinct on (trim(equipo))
       trim(equipo) as equipo, denominacion,
       nullif(trim(ubicacion), '') as ubicacion,
       nullif(trim(centro), '')    as centro
from public.sap_equipos
where nullif(trim(equipo), '') is not null
order by trim(equipo), (nullif(trim(ubicacion), '') is not null) desc, actualizado_en desc nulls last;

-- 3.2 Stock vigente: por (material, centro) la fila con a_fecha más reciente
create or replace view corr.par_stock as
select distinct on (material, centro) material, centro, a_fecha, coalesce(stock_cierre, 0) as stock
from public.sap_stock
order by material, centro, a_fecha desc;

-- 3.3 Órdenes correctivas abiertas (regla de la reunión)
create or replace view corr.par_ordenes_abiertas as
select o.orden, trim(o.equipo) as equipo, o.texto, o.status_usuario, o.fecha_entrada
from public.sap_ordenes o
where nullif(trim(o.equipo), '') is not null
  and o.clase_orden is distinct from 'TCPV'
  and coalesce(o.status_sistema, '') not like '%CERR%'
  and coalesce(o.status_sistema, '') not like '%CTEC%';

-- 3.4 Reservas pendientes de esas órdenes, con stock vigente
create or replace view corr.par_reservas as
select r.orden, a.equipo, r.posicion, r.material, r.descripcion, r.cantidad_pendiente, r.unidad,
       r.centro as centro_reserva,
       inv.centro as centro_equipo,
       coalesce((select sum(st.stock) from corr.par_stock st where st.material = r.material and st.stock > 0), 0) as stock_total,
       coalesce((select sum(st.stock) from corr.par_stock st where st.material = r.material and st.stock > 0
                  and st.centro = inv.centro), 0) as stock_centro_equipo
from public.sap_reservas_pos r
join corr.par_ordenes_abiertas a on a.orden = r.orden
left join corr.par_inventario inv on inv.equipo = a.equipo
where r.cantidad_pendiente > 0;

-- 3.5 Freno por orden
create or replace view corr.par_ordenes as
with res as (
  select a.orden,
         exists (select 1 from public.sap_reservas_pos r where r.orden = a.orden) as tiene_reservas,
         bool_or(p.stock_total = 0)                                      as hay_compras,
         bool_or(p.stock_total > 0 and p.stock_centro_equipo = 0)        as hay_traslado,
         bool_or(p.stock_centro_equipo > 0)                              as hay_retirar
  from corr.par_ordenes_abiertas a
  left join corr.par_reservas p on p.orden = a.orden
  group by a.orden
)
select a.*,
       case
         when a.status_usuario = '0TES' then 'liberar'
         when not r.tiene_reservas      then 'definir_repuestos'
         when r.hay_compras             then 'compras'
         when r.hay_traslado            then 'traslado'
         when r.hay_retirar             then 'retirar'
         else 'ejecutar'
       end as freno
from corr.par_ordenes_abiertas a
join res r on r.orden = a.orden;

-- 3.6 Actividad por equipo (horas/km → combustible) medida contra el corte de la obra
create or replace view corr.par_actividad as
with eq as (select distinct equipo from corr.par_ordenes_abiertas),
hora as (
  select distinct on (equipo) equipo, fecha as ult_hora, obra_codigo
  from public.sap_imputaciones
  where umedida in ('HRA','KM') and equipo in (select equipo from eq)
  order by equipo, fecha desc, secuencia desc
),
corte_h as (
  select obra_codigo, max(fecha) as corte from public.sap_imputaciones
  where umedida in ('HRA','KM') group by obra_codigo
),
carga as (
  select distinct on (equipo) equipo, fecha as ult_carga, obra
  from public.sap_cargas_combustible
  where equipo in (select equipo from eq)
  order by equipo, fecha desc, id desc
),
corte_c as (
  select obra, max(fecha) as corte from public.sap_cargas_combustible group by obra
)
select eq.equipo,
       h.ult_hora, h.obra_codigo, ch.corte as corte_horas,
       c.ult_carga, c.obra as obra_carga, cc.corte as corte_combustible,
       case when h.ult_hora is not null then 'horas'
            when c.ult_carga is not null then 'combustible' end as fuente_actividad,
       coalesce(h.ult_hora, c.ult_carga) as ultima_actividad,
       case when h.ult_hora is not null then ch.corte else cc.corte end as corte_obra,
       case
         when h.ult_hora is not null then case when h.ult_hora < ch.corte - 4 then 'parado' else 'trabajando' end
         when c.ult_carga is not null then case when c.ult_carga < cc.corte - 4 then 'parado' else 'trabajando' end
         else 'sin_datos'
       end as estado_actividad
from eq
left join hora h     on h.equipo = eq.equipo
left join corte_h ch on ch.obra_codigo = h.obra_codigo
left join carga c    on c.equipo = eq.equipo
left join corte_c cc on cc.obra = c.obra;

-- 3.7 Una fila por equipo con orden correctiva abierta
create or replace view corr.par_equipos as
with o as (
  select equipo,
         jsonb_agg(jsonb_build_object('orden', orden, 'texto', texto, 'status_usuario', status_usuario,
                                      'freno', freno, 'fecha_entrada', fecha_entrada)
                   order by fecha_entrada desc nulls last, orden desc) as ordenes,
         count(*) as cant_ordenes,
         min(case freno when 'compras' then 1 when 'traslado' then 2 when 'retirar' then 3
                        when 'liberar' then 4 when 'definir_repuestos' then 5 else 6 end) as peor,
         bool_or(status_usuario = '0TES') as tiene_0tes
  from corr.par_ordenes
  group by equipo
)
select o.equipo,
       inv.denominacion,
       coalesce(inv.ubicacion, 'Sin ubicación') as ubicacion,
       inv.centro,
       a.estado_actividad,
       a.fuente_actividad,
       a.ult_hora,
       a.ult_carga,
       case when a.estado_actividad = 'parado' then a.ultima_actividad end as parado_desde,
       case when a.estado_actividad = 'parado' then a.corte_obra - a.ultima_actividad end as dias_parado,
       a.corte_obra,
       (array['compras','traslado','retirar','liberar','definir_repuestos','ejecutar'])[o.peor] as freno,
       case o.peor when 1 then 'Compras' when 2 then 'Depósito/Transporte' else 'Taller' end as area_freno,
       o.cant_ordenes,
       o.ordenes,
       (o.tiene_0tes and a.estado_actividad = 'trabajando') as tiene_candidata_cierre
from o
join corr.par_actividad a on a.equipo = o.equipo
left join corr.par_inventario inv on inv.equipo = o.equipo;

-- ------------------------------------------------------------
-- 4. Interfaz pública (filtrada por usuario activo)
-- ------------------------------------------------------------
create or replace view public.v_correctivos_parados as
select equipo, denominacion, ubicacion, centro, estado_actividad, fuente_actividad, ult_hora, ult_carga,
       parado_desde, dias_parado, corte_obra, freno, area_freno, cant_ordenes, ordenes, tiene_candidata_cierre
from corr.par_equipos
where (select corr_usuario_activo());

revoke all on public.v_correctivos_parados from public, anon;
grant select on public.v_correctivos_parados to authenticated;

-- Detalle desplegable: reservas pendientes de un equipo con stock vigente por centro
create or replace function public.correctivos_parados_reservas(p_equipo text)
returns table (orden bigint, posicion integer, material text, descripcion text, cantidad_pendiente numeric,
               unidad text, centro_reserva text, centro_equipo text, stock_por_centro jsonb)
language sql stable security definer set search_path = public as $$
  select p.orden, p.posicion, p.material, p.descripcion, p.cantidad_pendiente, p.unidad,
         p.centro_reserva, p.centro_equipo,
         coalesce((select jsonb_agg(jsonb_build_object('centro', st.centro, 'stock', st.stock, 'a_fecha', st.a_fecha)
                                    order by st.stock desc)
                   from corr.par_stock st where st.material = p.material and st.stock > 0), '[]'::jsonb)
  from corr.par_reservas p
  where p.equipo = trim(p_equipo)
    and corr_usuario_activo()
  order by p.orden, p.posicion
$$;
revoke execute on function public.correctivos_parados_reservas(text) from public, anon;
grant execute on function public.correctivos_parados_reservas(text) to authenticated;

-- Índices: no hacen falta nuevos. Ya existen ix_sap_imput_equipo_fecha, ix_sap_cargas_equipo_fecha
-- e ix_sap_stock_material; v_correctivos_parados corre en ~0,3 s (EXPLAIN ANALYZE 13/10/2026).
