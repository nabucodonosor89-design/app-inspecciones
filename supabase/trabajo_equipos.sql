-- =====================================================================
-- MÓDULO TRABAJO DE EQUIPOS v1 — consulta por equipo y día (solo lectura)
-- supabase/trabajo_equipos.sql   (idempotente: se puede correr N veces)
-- =====================================================================
--
-- Responde: ¿cuánto trabajó tal equipo en un período, día por día, y a qué
-- obras se cargó? Abierto a cualquier usuario activo. Solo informa: sin
-- alarmas ni diferencias (eso sigue en Uso de equipos).
--
-- ── FUENTES (las mismas de Uso de equipos; verificado 22/10/2026) ──────
--  SAP          sap_imputaciones · equipo · fecha · umedida · cantidad · obra_codigo
--                 clase 7100000001 HRA → h, KM → km (MON se ignora)
--                 clase 7100000002 UN  → viaje (fletes)
--                 obra = obra_codigo (4 dígitos) → nombre en uso_obras
--  Parte        pd_partes (solo valido = true) · equipo · fecha · modo h|km
--                 cantidad = contador_fin − contador_ini
--                 obra = uso_obra_codigo(texto) (4 dígitos o uso_obras_alias) → uso_obras;
--                 si no se resuelve, el texto tal cual
--  GPS          consumo_combustible · nombre_movil · fecha
--                 h = horas_marcha (ya incluye ralentí) · km = distancia_km · sin obra
--                 Se muestran los valores crudos (Uso de equipos además descarta
--                 días de GPS dudoso / sin señal para sus alarmas; acá no hay alarmas)
--  Combustible  sap_cargas_combustible · equipo · fecha · litros
--                 obra = columna "obra" (OB34, CL01…): es el CENTRO DE LA CARGA, otro
--                 código que no es el de 4 dígitos; se muestra tal cual, sin nombre
--  Unidad       la de uso_equipos_info (misma que el tablero); si el equipo no está
--                 ahí (inactivo, etc.): costo_equipo de mayor valor → modo más
--                 frecuente de sus partes válidos → equipos.periodo_mtto_unidad
--
-- Nunca se devuelven valores, costos ni montos.
-- Las tablas fuente no se tocan (sap_* solo tienen RLS para agente_lector):
-- el acceso es por estas RPC SECURITY DEFINER, que validan usuario activo
-- con corr_usuario_activo() (mismo patrón que Correctivos / Repuestos).
-- =====================================================================


-- =====================================================================
-- 1. Unidad de un conjunto de equipos (helper interno, no expuesto)
-- =====================================================================
create or replace function public.trabajo_unidades(p_equipos text[] default null)
returns table (equipo text, unidad text, unidad_origen text)
language sql stable security definer set search_path = public as $$
  with e as (
    select distinct on (numero_identificacion) numero_identificacion equipo, periodo_mtto_unidad
    from equipos
    where nullif(trim(numero_identificacion), '') is not null
      and (p_equipos is null or numero_identificacion = any(p_equipos))
    order by numero_identificacion, updated_at desc nulls last
  ), c as (
    select distinct on (equipo) equipo, case umedida when 'HRA' then 'h' else 'km' end u
    from sap_imputaciones
    where clase_coste = 7100000001 and umedida in ('HRA','KM')
      and (p_equipos is null or equipo = any(p_equipos))
    group by equipo, umedida
    order by equipo, sum(valor_pyg) desc nulls last
  ), pm as (
    select distinct on (equipo) equipo, modo from (
      select equipo, modo, count(*) n from pd_partes
      where valido and modo in ('h','km')
        and fecha >= (now() at time zone 'America/Asuncion')::date - 365
        and (p_equipos is null or equipo = any(p_equipos))
      group by 1, 2
    ) x order by equipo, n desc
  )
  select e.equipo,
         coalesce(ui.unidad, c.u, pm.modo,
                  case when e.periodo_mtto_unidad in ('h','km') then e.periodo_mtto_unidad end),
         case when ui.unidad is not null then coalesce(ui.unidad_origen, 'costo')
              when c.u is not null then 'costo'
              when pm.modo is not null then 'parte'
              when e.periodo_mtto_unidad in ('h','km') then 'mantenimiento' end
  from e
  left join uso_equipos_info ui on ui.equipo = e.equipo
  left join c  on c.equipo  = e.equipo
  left join pm on pm.equipo = e.equipo
$$;
revoke all on function public.trabajo_unidades(text[]) from public, anon, authenticated;


-- =====================================================================
-- 2. Lista de equipos para el selector (ID técnico, denominación, unidad)
-- =====================================================================
create or replace function public.trabajo_equipos_lista()
returns table (equipo text, denominacion text, activo boolean, unidad text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not corr_usuario_activo() then
    raise exception 'Usuario inactivo o sin perfil' using errcode = '42501';
  end if;
  return query
  select distinct on (e.numero_identificacion)
         e.numero_identificacion::text, e.denominacion::text, coalesce(e.activo, false), u.unidad
  from equipos e
  left join trabajo_unidades(null) u on u.equipo = e.numero_identificacion
  where nullif(trim(e.numero_identificacion), '') is not null
  order by e.numero_identificacion, e.updated_at desc nulls last;
end $$;


-- =====================================================================
-- 3. Trabajo por día, fuente y obra (formato largo)
-- =====================================================================
-- Si algún día cambian las columnas de salida: antes correr
--   drop function if exists public.trabajo_equipo_dias(text, date, date);
create or replace function public.trabajo_equipo_dias(p_equipo text, p_desde date, p_hasta date)
returns table (fecha date, fuente text, obra text, obra_nombre text, cantidad numeric, unidad text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_eq text := upper(trim(p_equipo));
begin
  if not corr_usuario_activo() then
    raise exception 'Usuario inactivo o sin perfil' using errcode = '42501';
  end if;
  if v_eq is null or v_eq = '' then
    raise exception 'Falta el equipo' using errcode = '22023';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'Rango de fechas inválido: "desde" tiene que ser anterior o igual a "hasta"' using errcode = '22023';
  end if;
  if p_hasta - p_desde + 1 > 366 then
    raise exception 'El rango no puede superar 366 días (pediste % días)', p_hasta - p_desde + 1 using errcode = '22023';
  end if;

  return query
  -- SAP: h / km (7100000001) y viajes (7100000002)
  select i.fecha, 'sap'::text,
         nullif(trim(i.obra_codigo), ''),
         o.nombre,
         sum(i.cantidad),
         case i.umedida when 'HRA' then 'h' when 'KM' then 'km' else 'viaje' end
  from sap_imputaciones i
  left join uso_obras o on o.codigo = nullif(trim(i.obra_codigo), '')
  where i.equipo = v_eq and i.fecha between p_desde and p_hasta
    and ((i.clase_coste = 7100000001 and i.umedida in ('HRA','KM'))
         or i.clase_coste = 7100000002)
  group by 1, 3, 4, 6

  union all
  -- Parte diario (solo válidos)
  select p.fecha, 'parte'::text,
         coalesce(uso_obra_codigo(p.obra), nullif(trim(p.obra), '')),
         o.nombre,
         sum(p.contador_fin - p.contador_ini),
         p.modo
  from pd_partes p
  left join uso_obras o on o.codigo = uso_obra_codigo(p.obra)
  where p.equipo = v_eq and p.fecha between p_desde and p_hasta
    and p.valido and p.modo in ('h','km')
  group by 1, 3, 4, 6

  union all
  -- GPS: horas de motor y km (sin obra)
  select g.fecha, 'gps'::text, null::text, null::text, x.q, x.u
  from (
    select c.fecha, sum(coalesce(c.horas_marcha, 0)) h, sum(coalesce(c.distancia_km, 0)) km
    from consumo_combustible c
    where c.nombre_movil = v_eq and c.fecha between p_desde and p_hasta
    group by 1
  ) g
  cross join lateral (values (g.h, 'h'), (g.km, 'km')) x(q, u)

  union all
  -- Combustible: litros por centro de la carga
  select l.fecha, 'combustible'::text, nullif(trim(l.obra), ''), null::text, sum(l.litros), 'l'::text
  from sap_cargas_combustible l
  where l.equipo = v_eq and l.fecha between p_desde and p_hasta
  group by 1, 3

  order by 1 desc, 2, 3;
end $$;


-- =====================================================================
-- 4. Frescura: último dato cargado de cada fuente
-- =====================================================================
create or replace function public.trabajo_equipo_frescura()
returns table (sap date, parte date, gps date, combustible date)
language plpgsql stable security definer set search_path = public as $$
declare v_hoy date := (now() at time zone 'America/Asuncion')::date;
begin
  if not corr_usuario_activo() then
    raise exception 'Usuario inactivo o sin perfil' using errcode = '42501';
  end if;
  return query select
    (select max(i.fecha) from sap_imputaciones i
      where i.clase_coste in (7100000001, 7100000002) and i.fecha <= v_hoy),
    (select max(p.fecha) from pd_partes p where p.fecha <= v_hoy),
    (select max(c.fecha) from consumo_combustible c where c.fecha <= v_hoy),
    (select max(l.fecha) from sap_cargas_combustible l where l.fecha <= v_hoy);
end $$;


-- =====================================================================
-- 5. Permisos
-- =====================================================================
revoke all on function public.trabajo_equipos_lista()                   from public, anon;
revoke all on function public.trabajo_equipo_dias(text, date, date)      from public, anon;
revoke all on function public.trabajo_equipo_frescura()                 from public, anon;
grant execute on function public.trabajo_equipos_lista()               to authenticated;
grant execute on function public.trabajo_equipo_dias(text, date, date) to authenticated;
grant execute on function public.trabajo_equipo_frescura()             to authenticated;

-- Índices: ya existen por (equipo, fecha) en las cuatro fuentes
--   ix_sap_imput_equipo_fecha · pd_partes_equipo_fecha_idx (equipo, modo, fecha)
--   ix_consumo_comb_movil_fecha · ix_sap_cargas_equipo_fecha
-- No se crean índices nuevos.
