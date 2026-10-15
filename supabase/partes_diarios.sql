-- ============================================================
-- PARTES DIARIOS (Jotform) → contador de referencia por equipo y fecha
-- Aplicado en Supabase el 15/10/2026. Idempotente.
--
-- Carga: Andrés exporta de Jotform una vez por semana, KNIME filtra las últimas 3 semanas
-- y el archivo (.csv o .xlsx) va a la carpeta de Drive "PartesDiarios_TyE"; n8n lo carga acá (upsert) y
-- recalcula la validez. La historia (desde 2020) se cargó una vez en tandas.
--
-- Limpieza (acordada 15/10/2026):
--   · Se ignora la columna "Eliminado" del export.
--   · Filas sin ID: basura del export → no se cargan (las filtra n8n).
--   · Filas idénticas: una sola (clave = md5 de los campos del parte).
--   · ID repetido con contenido distinto: se guardan todas; el ID solo no alcanza para saber cuál es la buena.
--   · Solo equipos de T&C (con "Nombre de equipos de T&C SA"); terceros no.
-- Validez del contador (por equipo y modo de medición, en orden de fecha):
--   · no puede bajar respecto a la última lectura válida  → motivo 'baja'
--   · motivo 'sin lectura' (valido null): sin modo o contador final vacío / 0
--   · no puede avanzar más de 24 h/día (horómetro) o 1.500 km/día (odómetro) desde la última válida → 'salto'
--   · si hay 3 lecturas rechazadas seguidas coherentes entre sí, se toman como la nueva referencia
--     (por si la que estaba mal era la anterior)
--   · el contador del día = la mayor lectura válida de esa fecha (vista pd_contador_diario)
-- ============================================================

create table if not exists public.pd_partes (
  clave text generated always as (md5(
    coalesce(id_parte::text, '') || '|' || coalesce((fecha - date '2000-01-01')::text, '') || '|' || coalesce(equipo, '') || '|' ||
    coalesce(item, '') || '|' || coalesce(obra, '') || '|' || coalesce(modo, '') || '|' ||
    coalesce(contador_ini::text, '') || '|' || coalesce(contador_fin::text, ''))) stored,
  id_parte bigint not null,
  fecha date not null,
  equipo text not null,            -- ID técnico (ej. VL-CN036)
  equipo_nombre text,              -- tal como viene ("VL-CN036 - Camioneta")
  obra text,
  item text,
  modo text check (modo in ('h', 'km')),
  contador_ini numeric,
  contador_fin numeric,
  operador text,
  apuntador text,
  estado_equipo text,
  valido boolean,                  -- null = sin lectura / sin calcular
  motivo text,                     -- 'baja' | 'salto' | 'sin lectura'
  cargado_en timestamptz not null default now()
);
create unique index if not exists pd_partes_clave_uk on public.pd_partes (clave);
create index if not exists pd_partes_equipo_fecha_idx on public.pd_partes (equipo, modo, fecha);
create index if not exists pd_partes_fecha_idx on public.pd_partes (fecha);
alter table public.pd_partes enable row level security;
revoke all on table public.pd_partes from anon, authenticated;
comment on table public.pd_partes is 'Partes diarios de equipos (Jotform), limpios. Carga semanal vía n8n (carpeta Drive "Partes diarios"). valido/motivo los calcula pd_recalcular().';

-- ------------------------------------------------------------
-- Validez del contador
-- pd_recalcular(p_equipos, p_desde): recalcula solo esos equipos (null = todos) desde esa fecha
-- (null = toda la historia), anclando en la última lectura válida anterior a p_desde.
-- n8n la llama en grupos de 25 equipos con p_desde = primera fecha del archivo (timeout de 8 s de la API).
-- OJO: existe también una sobrecarga vieja pd_recalcular(text[]) que no se pudo borrar (el guard
-- cancela los DROP): llamar SIEMPRE con los dos parámetros.
-- 'desmentida': pico que se tomó como válido pero 3 lecturas posteriores coherentes lo contradicen
-- (solo si antes del pico hay una lectura válida más baja; si no, es cambio de horómetro y la historia se respeta).
-- ------------------------------------------------------------
create or replace function public.pd_recalcular(p_equipos text[] default null, p_desde date default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  r record;
  grupo text := null;
  a_fecha date; a_fin numeric;
  pend_claves text[] := '{}'; pend_fechas date[] := '{}'; pend_fins numeric[] := '{}';
  tope numeric; dias int; coherente boolean;
  ids text[] := '{}'; vals boolean[] := '{}'; mots text[] := '{}'; fins numeric[] := '{}'; grps text[] := '{}';
  n int := 0; corte int;
begin
  for r in
    select clave, equipo, modo, fecha, contador_fin
    from pd_partes
    where (p_equipos is null or equipo = any(p_equipos))
      and (p_desde is null or fecha >= p_desde)
    order by equipo, modo, fecha, contador_fin nulls first, id_parte
  loop
    if grupo is distinct from (r.equipo || '|' || coalesce(r.modo, '')) then
      grupo := r.equipo || '|' || coalesce(r.modo, '');
      a_fecha := null; a_fin := null;
      pend_claves := '{}'; pend_fechas := '{}'; pend_fins := '{}';
      if p_desde is not null and r.modo is not null then
        -- referencia: última lectura válida anterior al período recalculado
        select x.fecha, x.contador_fin into a_fecha, a_fin
        from pd_partes x
        where x.equipo = r.equipo and x.modo = r.modo and x.valido and x.fecha < p_desde
        order by x.fecha desc, x.contador_fin desc
        limit 1;
      end if;
    end if;

    if array_length(ids, 1) >= 2000 and pend_claves = '{}' then
      update pd_partes p set valido = u.v, motivo = u.m
        from unnest(ids, vals, mots) as u(c, v, m)
       where p.clave = u.c and (p.valido is distinct from u.v or p.motivo is distinct from u.m);
      n := n + array_length(ids, 1);
      ids := '{}'; vals := '{}'; mots := '{}'; fins := '{}'; grps := '{}';
    end if;

    if r.modo is null or r.contador_fin is null or r.contador_fin <= 0 then
      ids := ids || r.clave; vals := vals || null::boolean; mots := mots || 'sin lectura'::text; fins := fins || r.contador_fin; grps := grps || grupo;
      continue;
    end if;

    if a_fin is null then
      ids := ids || r.clave; vals := vals || true; mots := mots || null::text; fins := fins || r.contador_fin; grps := grps || grupo;
      a_fecha := r.fecha; a_fin := r.contador_fin;
      continue;
    end if;

    tope := case when r.modo = 'km' then 1500 else 24 end;
    dias := greatest(1, r.fecha - a_fecha);
    if r.contador_fin < a_fin then
      ids := ids || r.clave; vals := vals || false; mots := mots || 'baja'::text; fins := fins || r.contador_fin; grps := grps || grupo;
    elsif r.contador_fin - a_fin > tope * dias then
      ids := ids || r.clave; vals := vals || false; mots := mots || 'salto'::text; fins := fins || r.contador_fin; grps := grps || grupo;
    else
      ids := ids || r.clave; vals := vals || true; mots := mots || null::text; fins := fins || r.contador_fin; grps := grps || grupo;
      a_fecha := r.fecha; a_fin := r.contador_fin;
      pend_claves := '{}'; pend_fechas := '{}'; pend_fins := '{}';
      continue;
    end if;

    pend_claves := pend_claves || r.clave; pend_fechas := pend_fechas || r.fecha; pend_fins := pend_fins || r.contador_fin;
    if array_length(pend_claves, 1) >= 3 then
      pend_claves := pend_claves[array_length(pend_claves,1)-2:]; pend_fechas := pend_fechas[array_length(pend_fechas,1)-2:]; pend_fins := pend_fins[array_length(pend_fins,1)-2:];
      coherente := pend_fins[2] >= pend_fins[1] and pend_fins[3] >= pend_fins[2]
        and pend_fins[2] - pend_fins[1] <= tope * greatest(1, pend_fechas[2] - pend_fechas[1])
        and pend_fins[3] - pend_fins[2] <= tope * greatest(1, pend_fechas[3] - pend_fechas[2]);
      if coherente then
        -- ¿Pico suelto o cambio de horómetro? Si antes del pico hay una lectura válida <= la nueva
        -- referencia, lo que vino después y quedó por encima era un pico → 'desmentida'.
        -- Si no hay ninguna (toda la historia está por encima), es un reinicio del contador:
        -- la historia anterior se respeta.
        corte := 0;
        for i in 1..array_length(ids, 1) loop
          if grps[i] = grupo and vals[i] and fins[i] <= pend_fins[1] then corte := i; end if;
        end loop;
        for i in 1..array_length(ids, 1) loop
          if ids[i] = any(pend_claves) then
            vals[i] := true; mots[i] := null;
          elsif corte > 0 and i > corte and grps[i] = grupo and vals[i] and fins[i] > pend_fins[1] then
            vals[i] := false; mots[i] := 'desmentida';
          end if;
        end loop;
        a_fecha := pend_fechas[3]; a_fin := pend_fins[3];
        pend_claves := '{}'; pend_fechas := '{}'; pend_fins := '{}';
      end if;
    end if;
  end loop;

  if array_length(ids, 1) > 0 then
    update pd_partes p set valido = u.v, motivo = u.m
      from unnest(ids, vals, mots) as u(c, v, m)
     where p.clave = u.c and (p.valido is distinct from u.v or p.motivo is distinct from u.m);
    n := n + array_length(ids, 1);
  end if;
  return n;
end $$;

revoke all on function public.pd_recalcular(text[], date) from public, anon, authenticated;
-- (la llama n8n con la credencial de servicio)

create or replace view public.pd_contador_diario as
  select equipo, modo, fecha, max(contador_fin) as contador, count(*) as lecturas
  from pd_partes
  where valido
  group by equipo, modo, fecha;
revoke all on public.pd_contador_diario from anon, authenticated;
