-- =====================================================================
-- Inspección de equipos estáticos (tipo S: contenedores ST-CN y tanques ST-TN)
-- ---------------------------------------------------------------------
--  1. tipo_equipo 'S' permitido en equipos y checklist_templates (solo el CHECK;
--     no se cambia ningún dato de equipos).
--  2. checklist_templates.clases text[]: null = aplica a todas las clases del tipo;
--     con valores = solo a equipos cuya clase_vehiculo esté en la lista.
--  3. Checklist tipo S (15 ítems: 4 comunes, 5 de tanque, 6 de contenedor).
--  4. Frecuencia por tipo: insp_parametros.frecuencia_dias_<tipo> (S = 60) y
--     función insp_frecuencia_dias(tipo). Reemplaza el uso directo de
--     frecuencia_dias en: actualizar_semaforo_equipo (proxima_inspeccion_programada),
--     insp_estado_equipos (vencidos, plan semanal, KPI, Mi lista) e insp_carga_zonas.
--  5. Estado 'na' (ya existía) habilitado también en los ítems "(N/A si ...)".
--  Las inspecciones anteriores no se modifican. Idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tipo S permitido
-- ---------------------------------------------------------------------
alter table public.equipos drop constraint if exists equipos_tipo_equipo_check;
alter table public.equipos add constraint equipos_tipo_equipo_check
  check (tipo_equipo = any (array['V','P','B','M','S']));

alter table public.checklist_templates drop constraint if exists checklist_templates_tipo_equipo_check;
alter table public.checklist_templates add constraint checklist_templates_tipo_equipo_check
  check (tipo_equipo = any (array['V','P','B','M','S']));

-- ---------------------------------------------------------------------
-- 2. Columna clases
-- ---------------------------------------------------------------------
alter table public.checklist_templates add column if not exists clases text[] null;
comment on column public.checklist_templates.clases is
  'null = el ítem aplica a todas las clases del tipo. Con valores = solo a equipos cuya clase_vehiculo esté en la lista.';

-- ---------------------------------------------------------------------
-- 3. Checklist tipo S
-- ---------------------------------------------------------------------
insert into public.checklist_templates (tipo_equipo, orden, item_nombre, categoria, es_critico, clases)
select 'S', v.orden, v.item_nombre, v.categoria, v.es_critico, v.clases
from (values
  (1,  'Identificación - Código visible',                                   'Documentación', false, null::text[]),
  (2,  'Estructura - Sin corrosión avanzada, golpes ni deformaciones',      'General',       false, null::text[]),
  (3,  'Base/apoyo - Nivelado y estable',                                   'Seguridad',     true,  null::text[]),
  (4,  'Entorno - Orden, limpieza y acceso',                                'General',       false, null::text[]),
  (5,  'Pérdidas - Sin fugas ni derrames',                                  'General',       true,  array['ST-TN']),
  (6,  'Válvulas y conexiones - Funcionan, sin goteo',                      'Operatividad',  true,  array['ST-TN']),
  (7,  'Boca de carga/tapa - Cierra correctamente',                         'General',       false, array['ST-TN']),
  (8,  'Calefacción - Funciona (N/A si no tiene)',                          'Operatividad',  false, array['ST-TN']),
  (9,  'Escalera/pasarela - Segura',                                        'Seguridad',     false, array['ST-TN']),
  (10, 'Cerramiento - Puertas, ventanas y cerraduras funcionan',            'General',       false, array['ST-CN']),
  (11, 'Techo - Sin filtraciones',                                          'General',       false, array['ST-CN']),
  (12, 'Instalación eléctrica - Tablero, cables y tomas sin riesgo',        'Seguridad',     true,  array['ST-CN']),
  (13, 'Aire acondicionado - Funciona (N/A si no tiene)',                   'Operatividad',  false, array['ST-CN']),
  (14, 'Instalación sanitaria - Sin pérdidas, desagüe funciona (N/A si no es baño o cocina)', 'Operatividad', false, array['ST-CN']),
  (15, 'Equipamiento - Camas, mesadas y muebles en estado (N/A si no es vivienda)',           'General',      false, array['ST-CN'])
) as v(orden, item_nombre, categoria, es_critico, clases)
where not exists (
  select 1 from public.checklist_templates t
  where t.tipo_equipo = 'S' and t.item_nombre = v.item_nombre
)
on conflict (tipo_equipo, orden) do nothing;

-- ---------------------------------------------------------------------
-- 4. Frecuencia por tipo
-- ---------------------------------------------------------------------
insert into public.insp_parametros (clave, valor, descripcion) values
  ('frecuencia_dias_S', 60, 'Días entre inspecciones para equipos estáticos (tipo S)')
on conflict (clave) do nothing;

update public.insp_parametros
set descripcion = 'Días entre inspecciones (todos los tipos salvo los que tengan frecuencia_dias_<tipo>)'
where clave = 'frecuencia_dias';

-- frecuencia_dias_<tipo> si existe; si no, frecuencia_dias; si tampoco, 30.
-- SECURITY DEFINER: la llama el trigger de checklist_items (corre como el inspector)
-- e insp_parametros solo es legible por admin.
create or replace function public.insp_frecuencia_dias(p_tipo text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select valor from insp_parametros where clave = 'frecuencia_dias_' || p_tipo),
    (select valor from insp_parametros where clave = 'frecuencia_dias'),
    30)
$$;
revoke all on function public.insp_frecuencia_dias(text) from public, anon;
grant execute on function public.insp_frecuencia_dias(text) to authenticated, service_role;

-- 4.1 Trigger del semáforo: proxima_inspeccion_programada según el tipo
create or replace function public.actualizar_semaforo_equipo()
returns trigger
language plpgsql
as $function$
DECLARE
  criticos_fail INTEGER;
  criticos_warning INTEGER;
  nuevo_semaforo TEXT;
BEGIN
  -- Contar ítems críticos en fail y warning de esta inspección
  SELECT
    COUNT(*) FILTER (WHERE estado = 'fail' AND es_critico = true),
    COUNT(*) FILTER (WHERE estado = 'warning' AND es_critico = true)
  INTO criticos_fail, criticos_warning
  FROM checklist_items
  WHERE inspeccion_id = NEW.inspeccion_id;

  -- Calcular semáforo según lógica definida
  IF criticos_fail > 0 THEN
    nuevo_semaforo := 'rojo';
  ELSIF criticos_warning >= 3 THEN
    nuevo_semaforo := 'rojo';
  ELSIF criticos_warning >= 1 THEN
    nuevo_semaforo := 'amarillo';
  ELSE
    nuevo_semaforo := 'verde';
  END IF;

  -- Actualizar semáforo en la inspección
  UPDATE inspecciones
  SET semaforo = nuevo_semaforo
  WHERE id = NEW.inspeccion_id;

  -- Actualizar semáforo del equipo si esta es la inspección más reciente
  -- (próxima inspección = fecha + frecuencia del tipo de equipo: S 60 días, resto 30)
  UPDATE equipos e
  SET
    semaforo_actual = nuevo_semaforo,
    fecha_ultima_inspeccion = (SELECT fecha_hora FROM inspecciones WHERE id = NEW.inspeccion_id),
    proxima_inspeccion_programada = (SELECT fecha_hora FROM inspecciones WHERE id = NEW.inspeccion_id)::date
                                    + make_interval(days => public.insp_frecuencia_dias(e.tipo_equipo)::int),
    updated_at = NOW()
  WHERE e.id = (SELECT equipo_id FROM inspecciones WHERE id = NEW.inspeccion_id)
    AND NOT EXISTS (
      SELECT 1 FROM inspecciones i2
      WHERE i2.equipo_id = e.id
        AND i2.fecha_hora > (SELECT fecha_hora FROM inspecciones WHERE id = NEW.inspeccion_id)
    );

  RETURN NEW;
END;
$function$;

-- 4.2 Estado de inspección por equipo (vencidos, plan semanal, KPI semanal, Mi lista)
create or replace function public.insp_estado_equipos(p_corte timestamptz default now())
returns table (
  equipo_id uuid, numero_identificacion text, denominacion text, ubicacion_sap text,
  zona_id uuid, zona_nombre text, zona_tipo text,
  fecha_ultima_inspeccion timestamptz, vence date, dias_vencido int, estado text, prioridad int
)
language sql stable security definer set search_path = public as $$
  with par as (
    select (p_corte at time zone 'America/Asuncion')::date as ref
  ),
  sap as (
    select distinct on (equipo) equipo, ubicacion
    from sap_equipos
    order by equipo, (ubicacion is null), actualizado_en desc nulls last
  ),
  ult as (
    select i.equipo_id, max(i.fecha_hora) as f
    from inspecciones i
    where i.fecha_hora < p_corte or (p_corte >= now() and i.fecha_hora <= p_corte)   -- "ahora" incluye lo recién guardado
    group by 1
  ),
  base as (
    select e.id, e.numero_identificacion, e.denominacion, s.ubicacion,
           z.id as zid, z.nombre as znom, z.tipo as ztipo,
           -- frecuencia según el tipo de equipo (S = 60, resto = frecuencia_dias)
           insp_frecuencia_dias(e.tipo_equipo)::int as freq,
           -- el campo de equipos solo cuando el corte es "ahora"
           greatest(ult.f, case when p_corte >= now() then e.fecha_ultima_inspeccion end) as f
    from equipos e
    left join sap s on s.equipo = e.numero_identificacion
    left join insp_ubicaciones u on u.ubicacion_sap = s.ubicacion
    left join insp_zonas z on z.id = u.zona_id and z.activa
    left join ult on ult.equipo_id = e.id
    where e.activo = true
      and (s.ubicacion is null or u.inspecciona = true)
  ),
  calc as (
    select b.*,
           ((b.f at time zone 'America/Asuncion')::date + b.freq) as v,
           case when b.f is null then null
                else par.ref - ((b.f at time zone 'America/Asuncion')::date + b.freq) end as dv
    from base b cross join par
  )
  select id, numero_identificacion, denominacion, ubicacion, zid, znom, ztipo, f, v, dv,
         case when f is null then 'nunca' when dv > 0 then 'vencido' else 'al_dia' end,
         (row_number() over (order by (f is null) desc, dv desc nulls first, numero_identificacion))::int
  from calc
$$;

-- 4.3 Carga por zona: cada equipo pesa 1 / (días hábiles de SU ciclo).
--     carga = Σ(1/ciclo_equipo) ÷ capacidad diaria. dias_habiles_ciclo = ciclo promedio
--     efectivo de la zona (universo ÷ Σ 1/ciclo), así la tabla sigue cerrando:
--     carga = universo ÷ (capacidad × dias_habiles_ciclo). Con todos en 30 da igual que antes.
create or replace function public.insp_carga_zonas()
returns table (zona_id uuid, zona_nombre text, zona_tipo text, universo int, capacidad_diaria int,
               dias_habiles_ciclo numeric, carga numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_dh    numeric := coalesce(insp_param('dias_habiles_semana'), 5);
  v_ciclo numeric := coalesce(insp_param('frecuencia_dias'), 30) * v_dh / 7.0;  -- solo para zonas sin equipos
begin
  if not insp_es_admin() then raise exception 'Solo admin' using errcode = '42501'; end if;
  return query
  with u as (select e.zona_id, count(*)::int as n,
                    sum(1.0 / (insp_frecuencia_dias(q.tipo_equipo) * v_dh / 7.0)) as tasa
             from insp_estado_equipos(now()) e
             join equipos q on q.id = e.equipo_id
             group by 1),
       c as (select v.zona_id, sum(v.capacidad_diaria)::int as cap
             from insp__vigentes(insp__lunes(insp__hoy())) v group by 1)
  select z.id, z.nombre, z.tipo, coalesce(u.n, 0), coalesce(c.cap, 0),
         case when coalesce(u.n, 0) = 0 then round(v_ciclo, 1) else round(u.n / u.tasa, 1) end,
         case when coalesce(c.cap, 0) = 0 then null
              else round(coalesce(u.tasa, 0) / c.cap, 3) end
  from insp_zonas z left join u on u.zona_id = z.id left join c on c.zona_id = z.id
  where z.activa order by z.nombre;
end $$;

-- Mismos permisos que en planificador_inspecciones.sql (create or replace los conserva; se repiten por las dudas)
revoke all on function public.insp_estado_equipos(timestamptz), public.insp_carga_zonas() from public, anon;
revoke execute on function public.insp_estado_equipos(timestamptz) from authenticated;
grant execute on function public.insp_estado_equipos(timestamptz) to service_role;
grant execute on function public.insp_carga_zonas() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Estado 'na': ahora también en los ítems "(N/A si ...)" del checklist S
-- ---------------------------------------------------------------------
comment on constraint checklist_items_estado_check on public.checklist_items is
  'ok | warning | fail | na. ''na'' (no aplica): ítem Ficha de mantenimiento (equipos sin preventivo) y los ítems cuyo nombre dice "(N/A si ...)" (checklist tipo S).';
