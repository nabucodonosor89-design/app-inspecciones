-- ESTADO: DORMIDO (22/10/2026). Aplicado en Supabase, sin frontend ni cambios en n8n. Proyecto pausado por Andrés.
-- =====================================================================
-- CARGA DE PARTES A SAP v1
-- Control de continuidad de contadores + plantilla del programa intermedio (Daiana Romero).
-- Idempotente. Sin DROP ni DELETE sobre tablas con datos.
--
-- Decisiones de Andrés (22/10/2026) que ajustan la spec original:
--   · Partes valido = false con ítem con código → NO se pierden en silencio: salen como
--     problema 'contador_rechazado' (fuera de la plantilla).
--   · Odómetro parcial (modo km, contador_ini = 0 y contador_fin > 0): no entra en la cadena
--     de continuidad (ni se compara ni corta la del siguiente) y no se le aplica la validez
--     de pd_recalcular. Va a la plantilla si el ítem está bien.
--   · Eliminados por CLAVE (md5 del parte), no por ID: n8n pasa las filas del archivo y
--     pd_marcar_eliminados retira también la versión vieja de un parte editado.
--   · Si después de eso un ID sigue con más de una fila vigente → problema 'id_duplicado'
--     (el programa intermedio solo guardaría la primera).
--   · Partes con ítem con código y sin lectura (valido null) → problema 'sin_contador'.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. pd_partes: comentario, marca de eliminado, índice de la cadena
-- ---------------------------------------------------------------------
alter table public.pd_partes add column if not exists comentario text;
alter table public.pd_partes add column if not exists eliminado_en timestamptz;   -- null = vigente
comment on column public.pd_partes.comentario is 'Comentario del parte (Jotform). Cargas anteriores al 22/10/2026 quedan en null.';
comment on column public.pd_partes.eliminado_en is 'Marcado por pd_marcar_eliminados cuando el parte ya no está en el Excel de respuestas. null = vigente.';

-- Cadena de continuidad: anterior por equipo + modo en orden fecha, contador_ini, id_parte (clave desempata)
create index if not exists pd_partes_cadena_idx
  on public.pd_partes (equipo, modo, fecha, contador_ini, id_parte, clave)
  where valido and eliminado_en is null;
create index if not exists pd_partes_id_parte_idx on public.pd_partes (id_parte);

-- Partes vigentes: lo que leen todos los consumidores (sección 6)
create or replace view public.pd_partes_vigentes as
  select * from public.pd_partes where eliminado_en is null;
revoke all on public.pd_partes_vigentes from anon, authenticated;
comment on view public.pd_partes_vigentes is 'pd_partes sin los eliminados (eliminado_en is null). Usar esta en vez de pd_partes para leer.';

-- Misma fórmula que la columna generada pd_partes.clave (verificado: coincide en las 172.906 filas)
create or replace function public.pd_clave(p_id bigint, p_fecha date, p_equipo text, p_item text, p_obra text,
                                           p_modo text, p_ini numeric, p_fin numeric)
returns text language sql immutable
set search_path = public
as $$
  select md5(coalesce(p_id::text, '') || '|' || coalesce((p_fecha - date '2000-01-01')::text, '') || '|' || coalesce(p_equipo, '') || '|' ||
             coalesce(p_item, '') || '|' || coalesce(p_obra, '') || '|' || coalesce(p_modo, '') || '|' ||
             coalesce(p_ini::text, '') || '|' || coalesce(p_fin::text, ''))
$$;


-- ---------------------------------------------------------------------
-- 2. pd_marcar_eliminados — la llama n8n después de guardar el archivo
--    p_filas = las mismas filas limpias que se insertaron (id_parte, fecha, equipo, item, obra,
--    modo, contador_ini, contador_fin). Todo lo vigente de [p_desde, p_hasta] cuya clave no esté
--    en p_filas se marca eliminado; lo eliminado que vuelve se desmarca.
--    Freno: lista vacía o > 20 % de la ventana → no hace nada y devuelve ok = false.
-- ---------------------------------------------------------------------
create table if not exists public.pd_eliminados_log (
  id bigint generated always as identity primary key,
  ejecutado_en timestamptz not null default now(),
  desde date, hasta date,
  filas_archivo int, vigentes_antes int,
  marcados int, desmarcados int, vigentes_despues int,
  ok boolean not null,
  error text
);
alter table public.pd_eliminados_log enable row level security;
revoke all on public.pd_eliminados_log from anon, authenticated;

create or replace function public.pd_marcar_eliminados(p_desde date, p_hasta date, p_filas jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_claves text[];
  v_n_filas int;
  v_vig int; v_marcar int; v_marcados int := 0; v_desm int := 0; v_vig_desp int;
  v_eq_m text[]; v_eq_d text[]; v_eq text[];
  v_err text;
begin
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    v_err := 'Ventana inválida';
  elsif p_filas is null or jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    v_err := 'Lista de partes vacía: no se marca nada';
  end if;
  if v_err is not null then
    insert into pd_eliminados_log (desde, hasta, filas_archivo, ok, error)
    values (p_desde, p_hasta, coalesce(jsonb_array_length(case when jsonb_typeof(p_filas) = 'array' then p_filas end), 0), false, v_err);
    return jsonb_build_object('ok', false, 'error', v_err);
  end if;

  select array_agg(distinct pd_clave(r.id_parte, r.fecha, r.equipo, r.item, r.obra, r.modo, r.contador_ini, r.contador_fin)),
         count(*)
    into v_claves, v_n_filas
    from jsonb_to_recordset(p_filas) as r(id_parte bigint, fecha date, equipo text, item text, obra text,
                                          modo text, contador_ini numeric, contador_fin numeric);

  select count(*) into v_vig
    from pd_partes where fecha between p_desde and p_hasta and eliminado_en is null;

  select count(*), array_agg(distinct p.equipo) into v_marcar, v_eq_m
    from pd_partes p
   where p.fecha between p_desde and p_hasta and p.eliminado_en is null
     and not exists (select 1 from unnest(v_claves) c(clave) where c.clave = p.clave);

  if v_marcar > 0.2 * v_vig then
    v_err := format('Marcaría %s de %s partes vigentes de la ventana (> 20 %%): no se marca nada. ¿El archivo está completo?', v_marcar, v_vig);
    insert into pd_eliminados_log (desde, hasta, filas_archivo, vigentes_antes, marcados, ok, error)
    values (p_desde, p_hasta, v_n_filas, v_vig, v_marcar, false, v_err);
    return jsonb_build_object('ok', false, 'error', v_err, 'marcaria', v_marcar, 'vigentes', v_vig);
  end if;

  update pd_partes p set eliminado_en = now()
   where p.fecha between p_desde and p_hasta and p.eliminado_en is null
     and not exists (select 1 from unnest(v_claves) c(clave) where c.clave = p.clave);
  get diagnostics v_marcados = row_count;

  with d as (
    update pd_partes p set eliminado_en = null
     where p.eliminado_en is not null and p.clave = any(v_claves)
    returning p.equipo)
  select count(*), array_agg(distinct equipo) into v_desm, v_eq_d from d;

  select count(*) into v_vig_desp
    from pd_partes where fecha between p_desde and p_hasta and eliminado_en is null;

  -- La validez de los equipos tocados cambia: recalcular desde p_desde
  -- (los equipos del archivo ya los recalcula n8n; esto cubre los que no vinieron)
  select array_agg(distinct e) into v_eq
    from unnest(coalesce(v_eq_m, '{}') || coalesce(v_eq_d, '{}')) e where e is not null;
  if v_eq is not null then
    perform pd_recalcular(v_eq, p_desde);
  end if;

  insert into pd_eliminados_log (desde, hasta, filas_archivo, vigentes_antes, marcados, desmarcados, vigentes_despues, ok)
  values (p_desde, p_hasta, v_n_filas, v_vig, v_marcados, v_desm, v_vig_desp, true);

  return jsonb_build_object('ok', true, 'marcados', v_marcados, 'desmarcados', v_desm, 'vigentes', v_vig_desp);
end $$;
revoke all on function public.pd_marcar_eliminados(date, date, jsonb) from public, anon, authenticated;
-- (la llama n8n con la credencial de servicio, igual que la carga y pd_recalcular)


-- ---------------------------------------------------------------------
-- 3. Permiso ve_carga_partes
-- ---------------------------------------------------------------------
alter table public.usuarios add column if not exists ve_carga_partes boolean not null default false;
update public.usuarios set ve_carga_partes = true
 where email in ('daiana.romero@itcsa.com.py', 'andres.lopez@itcsa.com.py') and ve_carga_partes = false;
-- (authenticated y anon no tienen UPDATE sobre usuarios: nadie se lo puede dar a sí mismo)

create or replace function public.puede_carga_partes()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from usuarios
    where email = auth.email() and activo = true and ve_carga_partes = true
  )
$$;
revoke all on function public.puede_carga_partes() from public, anon;
grant execute on function public.puede_carga_partes() to authenticated;

create or replace function public.pdsap_usuario_id()
returns uuid language sql stable security definer set search_path = public
as $$ select id from usuarios where email = auth.email() limit 1 $$;
revoke all on function public.pdsap_usuario_id() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. Tablas del módulo (todas por RPC; RLS sin políticas)
-- ---------------------------------------------------------------------
create table if not exists public.pdsap_parametros (
  id int primary key default 1 check (id = 1),
  tolerancia_h numeric not null default 1,
  tolerancia_km numeric not null default 10,
  factor_horometro_nuevo numeric not null default 0.1,
  ventana_dias int not null default 60,
  fecha_inicio date            -- día en que el módulo empieza a usarse; partes anteriores no se arrastran
);
insert into public.pdsap_parametros (id, fecha_inicio) values (1, date '2026-10-22') on conflict (id) do nothing;
comment on table public.pdsap_parametros is 'Carga de partes a SAP. Una fila. Editar por SQL: update pdsap_parametros set tolerancia_h = 2;';

create table if not exists public.pdsap_obras (
  clave text primary key,          -- ej. TYE1002 (prefijo del código de ítem)
  obra_plantilla text not null,    -- valor de la columna OBRA del programa intermedio
  confirmado boolean not null default false,
  nota text
);
insert into public.pdsap_obras (clave, obra_plantilla, confirmado, nota) values
  ('OB1028', 'OBRA_1028', true, 'CSV Infraestructura'),
  ('OB1032', 'OBRA_1032', true, 'CSV Avelino'),
  ('PI1017', 'CONF_1017', true, 'CSV Confuso'),
  ('TYE1002', 'TYE_1002', true, 'CSV Ypané'),
  ('ADM1002', 'ADM_1002', true, 'CSV Ypané'),
  ('OB1005', 'OBRA_1005', false, 'Probable, sin CSV'),
  ('OB1019', 'OBRA_1019', false, 'Probable, sin CSV'),
  ('OB1020', 'OBRA_1020', false, 'Probable, sin CSV'),
  ('OB1022', 'OBRA_1022', false, 'Probable, sin CSV'),
  ('OB1024', 'OBRA_1024', false, 'Probable, sin CSV'),
  ('OB1025', 'OBRA_1025', false, 'Probable, sin CSV'),
  ('OB1026', 'OBRA_1026', false, 'Probable, sin CSV'),
  ('OB1029', 'OBRA_1029', false, 'Probable, sin CSV'),
  ('OB1030', 'OBRA_1030', false, 'Probable, sin CSV'),
  ('OB1033', 'OBRA_1033', false, 'Probable, sin CSV'),
  ('OB1034', 'OBRA_1034', false, 'Probable, sin CSV'),
  ('OB1036', 'OBRA_1036', false, 'Probable, sin CSV')
on conflict (clave) do nothing;
comment on table public.pdsap_obras is 'Clave de obra del ítem → OBRA de la plantilla. Agregar: insert into pdsap_obras values (''PH1029'', ''OBRA_1029'', true, ''confirmado con Daiana'');';

create table if not exists public.pdsap_confirmaciones (
  id_parte bigint primary key,
  motivo text not null check (motivo in ('taller', 'horometro_nuevo')),
  nota text,
  confirmado_por uuid,             -- usuarios.id
  confirmado_en timestamptz not null default now(),
  deshecha_en timestamptz,         -- Deshacer: se marca (no se borra la fila); null = vigente
  deshecha_por uuid
);
alter table public.pdsap_confirmaciones add column if not exists deshecha_en timestamptz;
alter table public.pdsap_confirmaciones add column if not exists deshecha_por uuid;

create table if not exists public.pdsap_entregas (
  id uuid primary key default gen_random_uuid(),
  desde date not null,
  hasta date not null,
  generado_por uuid,               -- usuarios.id
  generado_en timestamptz not null default now(),
  n_hora int not null default 0,
  n_odom int not null default 0,
  n_arrastrados int not null default 0,
  anulada boolean not null default false,
  anulada_por uuid,
  anulada_en timestamptz
);

create table if not exists public.pdsap_entrega_partes (
  entrega_id uuid not null references public.pdsap_entregas (id),
  id_parte bigint not null,
  primary key (entrega_id, id_parte)
);
create index if not exists pdsap_entrega_partes_id_idx on public.pdsap_entrega_partes (id_parte);

alter table public.pdsap_parametros enable row level security;
alter table public.pdsap_obras enable row level security;
alter table public.pdsap_confirmaciones enable row level security;
alter table public.pdsap_entregas enable row level security;
alter table public.pdsap_entrega_partes enable row level security;
revoke all on public.pdsap_parametros, public.pdsap_obras, public.pdsap_confirmaciones,
              public.pdsap_entregas, public.pdsap_entrega_partes from anon, authenticated;


-- ---------------------------------------------------------------------
-- 5. Lógica: pdsap_eval (interna) + RPC
-- ---------------------------------------------------------------------

-- 5.1 Evaluación de los partes del rango + candidatos a arrastre.
--     El parte anterior se busca en TODA la historia del equipo (índice pd_partes_cadena_idx).
create or replace function public.pdsap_eval(p_desde date, p_hasta date)
returns table (
  clave text, id_parte bigint, fecha date, equipo text, equipo_nombre text, obra_ubicacion text,
  item text, codigo_item text, clave_obra text, obra_plantilla text, modo text, tipo text,
  contador_ini numeric, contador_fin numeric, comentario text, operador text, estado_equipo text,
  valido boolean, motivo_validez text, parcial boolean,
  situacion text, problemas text[],
  prev_id_parte bigint, prev_fecha date, prev_contador_fin numeric, diferencia numeric, clase text,
  confirmacion_motivo text, confirmacion_nota text,
  arrastrado boolean, ya_entregado boolean
)
language sql stable security definer
set search_path = public
as $$
with par as (
  select coalesce(tolerancia_h, 1) tol_h, coalesce(tolerancia_km, 10) tol_km,
         coalesce(factor_horometro_nuevo, 0.1) factor, coalesce(ventana_dias, 60) ventana, fecha_inicio,
         (now() at time zone 'America/Asuncion')::date hoy
  from pdsap_parametros where id = 1
),
ent as (
  select distinct ep.id_parte
  from pdsap_entrega_partes ep join pdsap_entregas e on e.id = ep.entrega_id
  where not e.anulada
),
cand as (
  select p.*
  from pd_partes_vigentes p, par
  where p.fecha between p_desde and p_hasta
     or (p.fecha < p_desde and par.fecha_inicio is not null
         and p.fecha >= par.fecha_inicio and p.fecha >= par.hoy - par.ventana
         and not exists (select 1 from ent where ent.id_parte = p.id_parte))
),
b as (
  select c.*,
         substring(btrim(c.item) from '^([A-Z]+[0-9]+_[0-9]+)') as cod,
         substring(btrim(c.item) from '^([A-Z]+[0-9]+)_') as cob,
         coalesce(btrim(c.item) ilike 'control de horas%', false) as es_control,
         (c.item is null or btrim(c.item) = '') as sin_item,
         (c.modo = 'km' and c.contador_ini = 0 and c.contador_fin > 0) as es_parcial,
         (c.valido is true and c.modo is not null and c.contador_ini is not null and c.contador_fin is not null
          and not (c.modo = 'km' and c.contador_ini = 0 and c.contador_fin > 0)) as en_cadena
  from cand c
),
ch as (
  select b.*, pr.id_parte as p_id, pr.fecha as p_fecha, pr.contador_fin as p_fin
  from b
  left join lateral (
    select x.id_parte, x.fecha, x.contador_fin
    from pd_partes x
    where b.en_cadena
      and x.equipo = b.equipo and x.modo = b.modo and x.valido and x.eliminado_en is null
      and x.contador_ini is not null and x.contador_fin is not null
      and not (x.modo = 'km' and x.contador_ini = 0 and x.contador_fin > 0)
      and (x.fecha, x.contador_ini, x.id_parte, x.clave) < (b.fecha, b.contador_ini, b.id_parte, b.clave)
    order by x.fecha desc, x.contador_ini desc, x.id_parte desc, x.clave desc
    limit 1
  ) pr on true
),
cl as (
  select ch.*,
         case when ch.p_id is not null then ch.contador_ini - ch.p_fin end as dif,
         case
           when not ch.en_cadena then null
           when ch.contador_fin < ch.contador_ini then 'contador_invertido'
           when ch.p_id is null then null
           when ch.contador_ini - ch.p_fin >= (case ch.modo when 'h' then par.tol_h else par.tol_km end) then
             case when exists (
                    select 1 from mantenimientos m join equipos e on e.id = m.equipo_id
                    where e.numero_identificacion = ch.equipo
                      and coalesce(m.fecha_ingreso_taller, m.fecha_inicio_averia) <= ch.fecha
                      and coalesce(m.fecha_liberacion, ch.fecha) >= ch.p_fecha)
                  then 'posible_taller' else 'salto_sin_explicacion' end
           when ch.contador_ini - ch.p_fin <= -(case ch.modo when 'h' then par.tol_h else par.tol_km end) then
             case when ch.contador_ini < par.factor * ch.p_fin
                  then 'posible_horometro_nuevo' else 'retroceso_sin_explicacion' end
         end as cls
  from ch, par
),
dup as (
  select v.id_parte from pd_partes_vigentes v
  where v.id_parte in (select id_parte from cand)
  group by v.id_parte having count(*) > 1
),
pb as (
  select cl.*, o.obra_plantilla as obra_pl, cf.motivo as cf_motivo, cf.nota as cf_nota,
         (cl.sin_item and not (coalesce(cl.contador_fin, 0) > coalesce(cl.contador_ini, 0))) as es_adisp,
         (cl.id_parte in (select id_parte from dup)) as es_dup
  from cl
  left join pdsap_obras o on o.clave = cl.cob
  left join pdsap_confirmaciones cf on cf.id_parte = cl.id_parte and cf.deshecha_en is null
),
pp as (
  select pb.*,
         case when pb.es_control or pb.es_adisp then '{}'::text[]
         else array_remove(array[
           case when pb.sin_item then 'sin_item_con_movimiento' end,
           case when not pb.sin_item and pb.cod is null then 'item_no_reconocido' end,
           case when pb.cod is not null and pb.obra_pl is null then 'item_sin_obra' end,
           case when pb.cls is not null and pb.cf_motivo is null then 'retenido' end,
           case when pb.valido is false and not pb.es_parcial then 'contador_rechazado' end,
           case when pb.valido is null and not pb.es_parcial then 'sin_contador' end,
           case when pb.es_dup then 'id_duplicado' end
         ], null) end as probs
  from pb
)
select pp.clave, pp.id_parte, pp.fecha, pp.equipo, pp.equipo_nombre, pp.obra, pp.item,
       pp.cod, pp.cob, btrim(pp.obra_pl), pp.modo,
       case pp.modo when 'h' then 'H' when 'km' then 'O' end,
       pp.contador_ini, pp.contador_fin, pp.comentario, pp.operador, pp.estado_equipo,
       pp.valido, pp.motivo, pp.es_parcial,
       case when pp.es_control then 'control'
            when pp.es_adisp then 'a_disposicion'
            when cardinality(pp.probs) > 0 then 'con_problemas'
            else 'listo' end,
       pp.probs,
       pp.p_id, pp.p_fecha, pp.p_fin, pp.dif, pp.cls,
       pp.cf_motivo, pp.cf_nota,
       (pp.fecha < p_desde),
       exists (select 1 from ent where ent.id_parte = pp.id_parte)
from pp
where pp.fecha between p_desde and p_hasta
   or (pp.fecha < p_desde and not pp.es_control and not pp.es_adisp and cardinality(pp.probs) = 0)
$$;
revoke all on function public.pdsap_eval(date, date) from public, anon, authenticated;


-- 5.2 Partes del rango (+ arrastrados). Paginar de a 1000 con .range(); orden estable.
create or replace function public.pdsap_partes(p_desde date, p_hasta date)
returns table (
  clave text, id_parte bigint, fecha date, equipo text, equipo_nombre text, obra_ubicacion text,
  item text, codigo_item text, clave_obra text, obra_plantilla text, modo text, tipo text,
  contador_ini numeric, contador_fin numeric, comentario text, operador text, estado_equipo text,
  valido boolean, motivo_validez text, parcial boolean,
  situacion text, problemas text[],
  prev_id_parte bigint, prev_fecha date, prev_contador_fin numeric, diferencia numeric, clase text,
  confirmacion_motivo text, confirmacion_nota text,
  arrastrado boolean, ya_entregado boolean
)
language sql stable security definer
set search_path = public
as $$
  select e.* from pdsap_eval(p_desde, p_hasta) e
  where puede_carga_partes() and p_desde is not null and p_hasta is not null and p_desde <= p_hasta
    and p_hasta - p_desde <= 92
  order by e.fecha, e.equipo, e.id_parte, e.clave
$$;
revoke all on function public.pdsap_partes(date, date) from public, anon;
grant execute on function public.pdsap_partes(date, date) to authenticated;


-- 5.3 Confirmar / deshacer un salto legítimo.
--     Deshacer no borra la fila: la marca deshecha_en (queda el rastro; confirmar de nuevo la reactiva).
create or replace function public.pdsap_confirmar(p_id_parte bigint, p_motivo text, p_nota text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_fecha date; v_ret boolean;
begin
  if not puede_carga_partes() then raise exception 'Sin permiso'; end if;
  if p_motivo not in ('taller', 'horometro_nuevo') then raise exception 'Motivo inválido'; end if;
  if exists (select 1 from pdsap_confirmaciones where id_parte = p_id_parte and deshecha_en is null) then
    raise exception 'El parte % ya está confirmado', p_id_parte;
  end if;
  select min(fecha) into v_fecha from pd_partes_vigentes where id_parte = p_id_parte;
  if v_fecha is null then raise exception 'Parte % no encontrado', p_id_parte; end if;
  select bool_or(e.clase is not null) into v_ret
    from pdsap_eval(v_fecha, v_fecha) e where e.id_parte = p_id_parte;
  if not coalesce(v_ret, false) then
    raise exception 'El parte % no está retenido', p_id_parte;
  end if;
  insert into pdsap_confirmaciones (id_parte, motivo, nota, confirmado_por)
  values (p_id_parte, p_motivo, nullif(btrim(p_nota), ''), pdsap_usuario_id())
  on conflict (id_parte) do update
     set motivo = excluded.motivo, nota = excluded.nota, confirmado_por = excluded.confirmado_por,
         confirmado_en = now(), deshecha_en = null, deshecha_por = null;
end $$;
revoke all on function public.pdsap_confirmar(bigint, text, text) from public, anon;
grant execute on function public.pdsap_confirmar(bigint, text, text) to authenticated;

create or replace function public.pdsap_deshacer_confirmacion(p_id_parte bigint)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not puede_carga_partes() then raise exception 'Sin permiso'; end if;
  update pdsap_confirmaciones set deshecha_en = now(), deshecha_por = pdsap_usuario_id()
   where id_parte = p_id_parte and deshecha_en is null;
  if not found then raise exception 'El parte % no tenía confirmación', p_id_parte; end if;
end $$;
revoke all on function public.pdsap_deshacer_confirmacion(bigint) from public, anon;
grant execute on function public.pdsap_deshacer_confirmacion(bigint) to authenticated;


-- 5.4 Registrar entrega. Revalida en el servidor: cada ID tiene que estar listo (rango o arrastrado)
--     y tienen que venir TODOS los listos (si no, los datos cambiaron: recargar).
create or replace function public.pdsap_registrar_entrega(p_desde date, p_hasta date, p_ids bigint[])
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_malos bigint[]; v_faltan bigint[];
  v_h int; v_o int; v_arr int;
begin
  if not puede_carga_partes() then raise exception 'Sin permiso'; end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then raise exception 'Rango inválido'; end if;
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'No hay partes para entregar'; end if;
  if cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception 'IDs repetidos en la entrega';
  end if;

  -- Una sola evaluación (el CTE se materializa una vez)
  with ev as materialized (
    select e.id_parte, e.modo, e.arrastrado from pdsap_eval(p_desde, p_hasta) e where e.situacion = 'listo'
  )
  select (select array_agg(x) from unnest(p_ids) x where not exists (select 1 from ev where ev.id_parte = x)),
         (select array_agg(ev.id_parte) from ev where not (ev.id_parte = any(p_ids))),
         (select count(*) from ev where modo = 'h'),
         (select count(*) from ev where modo = 'km'),
         (select count(*) from ev where arrastrado)
    into v_malos, v_faltan, v_h, v_o, v_arr;

  if v_malos is not null then
    raise exception 'Partes que no están listos: % — recargá la pantalla', array_to_string(v_malos[1:20], ', ');
  end if;
  if v_faltan is not null then
    raise exception 'Faltan % partes listos (%) — los datos cambiaron, recargá la pantalla',
      cardinality(v_faltan), array_to_string(v_faltan[1:20], ', ');
  end if;

  insert into pdsap_entregas (desde, hasta, generado_por, n_hora, n_odom, n_arrastrados)
  values (p_desde, p_hasta, pdsap_usuario_id(), v_h, v_o, v_arr)
  returning id into v_id;

  insert into pdsap_entrega_partes (entrega_id, id_parte)
  select v_id, x from unnest(p_ids) x;

  return v_id;
end $$;
revoke all on function public.pdsap_registrar_entrega(date, date, bigint[]) from public, anon;
grant execute on function public.pdsap_registrar_entrega(date, date, bigint[]) to authenticated;


-- 5.5 Historial de entregas / anular
create or replace function public.pdsap_entregas_lista()
returns table (id uuid, desde date, hasta date, generado_en timestamptz, generado_por_nombre text,
               n_hora int, n_odom int, n_arrastrados int,
               anulada boolean, anulada_en timestamptz, anulada_por_nombre text)
language sql stable security definer
set search_path = public
as $$
  select e.id, e.desde, e.hasta, e.generado_en, u.nombre_completo, e.n_hora, e.n_odom, e.n_arrastrados,
         e.anulada, e.anulada_en, ua.nombre_completo
  from pdsap_entregas e
  left join usuarios u on u.id = e.generado_por
  left join usuarios ua on ua.id = e.anulada_por
  where puede_carga_partes()
  order by e.generado_en desc
  limit 200
$$;
revoke all on function public.pdsap_entregas_lista() from public, anon;
grant execute on function public.pdsap_entregas_lista() to authenticated;

create or replace function public.pdsap_anular_entrega(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not puede_carga_partes() then raise exception 'Sin permiso'; end if;
  update pdsap_entregas set anulada = true, anulada_por = pdsap_usuario_id(), anulada_en = now()
   where id = p_id and not anulada;
  if not found then raise exception 'Entrega no encontrada o ya anulada'; end if;
end $$;
revoke all on function public.pdsap_anular_entrega(uuid) from public, anon;
grant execute on function public.pdsap_anular_entrega(uuid) to authenticated;


-- 5.6 Frescura de la fuente + última entrega vigente (para el rango por defecto)
create or replace function public.pdsap_frescura()
returns table (ultima_carga timestamptz, ultima_fecha date, eliminados_ultima_carga int,
               ultima_marcacion timestamptz, ultima_marcacion_ok boolean, ultima_marcacion_error text,
               ultima_entrega_hasta date, fecha_inicio date)
language sql stable security definer
set search_path = public
as $$
  select (select max(cargado_en) from pd_partes),
         (select max(fecha) from pd_partes_vigentes),
         l.marcados, l.ejecutado_en, l.ok, l.error,
         (select max(hasta) from pdsap_entregas where not anulada),
         (select fecha_inicio from pdsap_parametros where id = 1)
  from (select 1) x
  left join lateral (select * from pd_eliminados_log order by id desc limit 1) l on true
  where puede_carga_partes()
$$;
revoke all on function public.pdsap_frescura() from public, anon;
grant execute on function public.pdsap_frescura() to authenticated;


-- ---------------------------------------------------------------------
-- 6. Consumidores de pd_partes → pd_partes_vigentes
--    Reemplaza la palabra pd_partes por pd_partes_vigentes en el cuerpo de cada función
--    (CREATE OR REPLACE con la misma firma: conserva dueño, permisos y SECURITY DEFINER).
--    Idempotente: después del reemplazo ya no hay coincidencias.
--    Los .sql de origen se actualizaron igual (bandeja_preventivos, partes_seguimiento,
--    services_equipo_orden_sap, trabajo_equipos, uso_equipos_setup, partes_diarios).
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.proname in ('pd_recalcular', 'mantenimiento_seguimiento_v2', 'mantenimiento_seguimiento_v3',
                        'ip30_base_equipos', 'ip30_bandeja_frescura', 'ip30_sync_cierres',
                        'trabajo_unidades', 'trabajo_equipo_dias', 'trabajo_equipo_frescura', 'uso_refrescar')
      and p.prosrc ~ '\mpd_partes\M'
  loop
    execute regexp_replace(pg_get_functiondef(r.oid), '\mpd_partes\M', 'pd_partes_vigentes', 'g');
  end loop;
end $$;

create or replace view public.pd_contador_diario as
  select equipo, modo, fecha, max(contador_fin) as contador, count(*) as lecturas
  from pd_partes_vigentes
  where valido
  group by equipo, modo, fecha;
revoke all on public.pd_contador_diario from anon, authenticated;
