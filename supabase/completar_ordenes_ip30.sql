-- ============================================================
-- COMPLETAR ÓRDENES IP30 — datos para completar el Excel de órdenes preventivas
-- Aplicado en Supabase el 15/10/2026 (orden estable para paginar: 15/10/2026). Idempotente.
--
-- Reemplaza la herramienta HTML "completar_ordenes": la encargada de preventivo
-- sube el Excel del IP30 y la app completa Ubicación técnica, Última carga y
-- Fecha de última carga con lo que la ingesta SAP ya dejó en Supabase:
--   · ubicación  → sap_equipos.ubicacion (IE36, texto tipo "RUTA 17 OBRA DE LA SOBERANIA")
--   · contador   → sap_cargas_combustible.horometro (consumos; horas o km)
-- El Excel NO se guarda en Supabase: se procesa y se descarga en el navegador.
--
-- Acceso: usuarios.ve_completar_ordenes = true (tarjeta del menú + validación en las RPC).
--   Dar acceso:    update public.usuarios set ve_completar_ordenes = true  where email = 'nombre@itcsa.com.py';
--   Quitar acceso: update public.usuarios set ve_completar_ordenes = false where email = 'nombre@itcsa.com.py';
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columna de permiso + usuarios iniciales
-- ------------------------------------------------------------
alter table public.usuarios
  add column if not exists ve_completar_ordenes boolean not null default false;

do $$
declare
  v_email text;
begin
  foreach v_email in array array['evelyn.gonzalez@itcsa.com.py', 'andres.lopez@itcsa.com.py'] loop
    if exists (select 1 from public.usuarios where email = v_email) then
      update public.usuarios set ve_completar_ordenes = true where email = v_email;
    else
      raise notice 'completar_ordenes_ip30: no existe el usuario %, no se creó nada', v_email;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 2. ¿El usuario logueado puede usar el módulo?
-- ------------------------------------------------------------
create or replace function public.puede_completar_ordenes()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from usuarios
    where email = auth.email() and activo = true and ve_completar_ordenes = true
  )
$$;

-- ------------------------------------------------------------
-- 3. Ubicación + última lectura por equipo (una fila por equipo)
-- ------------------------------------------------------------
-- Reglas (mismas que la herramienta HTML):
--   · Ubicación: si el equipo está repetido en el IE36, gana la fila con ubicación
--     no vacía y, entre esas, la actualizada más recientemente.
--     ubicaciones_distintas > 1 avisa que el IE36 tiene ubicaciones distintas.
--   · Lectura: solo horómetro > 0 con fecha; gana la fecha más reciente y, si hay
--     varias ese día, el valor mayor.
create or replace function public.ip30_datos_equipos()
returns table (
  equipo text,
  equipo_sap bigint,
  ubicacion text,
  ubicaciones_distintas int,
  en_ie36 boolean,
  lectura numeric,
  fecha_lectura date
)
language sql stable security definer
set search_path = public
as $$
  with eq as (
    select distinct on (upper(trim(e.equipo)))
           upper(trim(e.equipo)) as equipo, e.equipo_sap, nullif(trim(e.ubicacion), '') as ubicacion
    from sap_equipos e
    where coalesce(trim(e.equipo), '') <> ''
    order by upper(trim(e.equipo)), (nullif(trim(e.ubicacion), '') is null), e.actualizado_en desc nulls last
  ),
  dist as (
    select upper(trim(e.equipo)) as equipo, count(distinct nullif(trim(e.ubicacion), ''))::int as n
    from sap_equipos e
    group by 1
  ),
  lec as (
    select distinct on (upper(trim(c.equipo)))
           upper(trim(c.equipo)) as equipo, c.equipo_sap, c.horometro as lectura, c.fecha
    from sap_cargas_combustible c
    where c.horometro > 0 and c.fecha is not null and coalesce(trim(c.equipo), '') <> ''
    order by upper(trim(c.equipo)), c.fecha desc, c.horometro desc
  )
  select coalesce(eq.equipo, lec.equipo),
         coalesce(eq.equipo_sap, lec.equipo_sap),
         eq.ubicacion,
         coalesce(dist.n, 0),
         eq.equipo is not null,
         lec.lectura,
         lec.fecha
  from eq
  full join lec on lec.equipo = eq.equipo
  left join dist on dist.equipo = coalesce(eq.equipo, lec.equipo)
  where puede_completar_ordenes()
  order by 1  -- orden estable: la app pagina de a 1000 filas (límite de la API de Supabase)
$$;

-- ------------------------------------------------------------
-- 4. Frescura: última ingesta de IE36 y de consumos
-- ------------------------------------------------------------
create or replace function public.ip30_frescura()
returns table (ie36 timestamptz, consumos timestamptz, ultima_lectura date)
language sql stable security definer
set search_path = public
as $$
  select (select max(procesado_en) from sap_ingestas where fuente = 'ie36'),
         (select max(procesado_en) from sap_ingestas where fuente = 'consumos'),
         (select max(fecha) from sap_cargas_combustible)
  where puede_completar_ordenes()
$$;

-- ------------------------------------------------------------
-- 5. Permisos: solo usuarios logueados (la validación fina la hace puede_completar_ordenes)
-- ------------------------------------------------------------
revoke all on function public.puede_completar_ordenes() from public, anon;
revoke all on function public.ip30_datos_equipos()      from public, anon;
revoke all on function public.ip30_frescura()           from public, anon;
grant execute on function public.puede_completar_ordenes() to authenticated;
grant execute on function public.ip30_datos_equipos()      to authenticated;
grant execute on function public.ip30_frescura()           to authenticated;

-- ============================================================
-- 21/10/2026 — Próximo mantenimiento para Completar órdenes IP30 (aplicado en Supabase)
-- La pantalla lee ip30_datos_equipos_v2(): mismas columnas + prox_mantto / prox_unidad
-- prox_mantto = contador del último mantenimiento (services_equipo, no anulado; si el último no tiene
-- contador → null) + equipos.periodo_mtto. En el Excel solo se escribe si la celda PROX MANTTO está vacía.
-- FALTA/PASO se escribe como fórmula =SI(H o I vacías; ""; H−I).
-- ============================================================
create or replace function public.ip30_datos_equipos_v2()
returns table(equipo text, equipo_sap bigint, ubicacion text, ubicaciones_distintas integer, en_ie36 boolean,
              lectura numeric, fecha_lectura date, prox_mantto numeric, prox_unidad text)
language sql stable security definer
set search_path = public
as $$
  with d as (select * from ip30_datos_equipos()),
  q as (
    select distinct on (upper(trim(q.numero_identificacion)))
           upper(trim(q.numero_identificacion)) as equipo, q.id, q.periodo_mtto, q.periodo_mtto_unidad
    from equipos q
    where q.periodo_mtto is not null
    order by upper(trim(q.numero_identificacion)), q.activo desc, q.periodo_mtto_actualizado_en desc nulls last
  ),
  s as (
    select distinct on (s.equipo_id) s.equipo_id, s.contador
    from services_equipo s
    where s.anulado_en is null
    order by s.equipo_id, s.fecha desc, s.created_at desc
  )
  select d.equipo, d.equipo_sap, d.ubicacion, d.ubicaciones_distintas, d.en_ie36, d.lectura, d.fecha_lectura,
         case when s.contador is not null then s.contador + q.periodo_mtto end,
         case when s.contador is not null then q.periodo_mtto_unidad end
  from d
  left join q on q.equipo = d.equipo
  left join s on s.equipo_id = q.id
  where puede_completar_ordenes()
  order by 1
$$;
revoke all on function public.ip30_datos_equipos_v2() from public, anon;
grant execute on function public.ip30_datos_equipos_v2() to authenticated;
