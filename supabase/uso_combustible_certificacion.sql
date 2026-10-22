-- =====================================================================
-- USO DE EQUIPOS — Combustible vs certificación (Gerencia) — 22/10/2026
-- supabase/uso_combustible_certificacion.sql   (idempotente)
-- =====================================================================
--
-- Por equipo y mes: certificación neta SAP (Gs, clases 7100000001 + 7100000002, con signo)
-- contra litros cargados en SAP (sap_cargas_combustible). Es la versión en la app del gráfico
-- de dispersión de Power BI con el que Andrés encontró la PS-RP014 (18/10, −446,1 h).
--
-- Alarmas (solo meses cerrados y desde CC_INICIO = sep-2026; el mes en curso se ve pero no alarma.
--  Antes de mediados de sep-2026 las cargas de combustible SAP están incompletas):
--   comb_sin_cert  carga ≥ CC_MIN_LITROS (50) L en el mes y la certificación neta es ≤ 0
--   cert_sin_comb  certifica ≥ CC_MIN_CERT_GS (1 M Gs) y no carga combustible
-- Sin reglas por condición del equipo (eléctrico, alquilado…): salta todo y Andrés revisa
-- caso por caso. "Revisado" con nota: alcance 'siempre' (silencia esa alarma del equipo para
-- siempre) o 'mes' (solo ese mes; si vuelve a pasar otro mes, salta de nuevo). Se anulan, no se borran.
-- Terceros: alguna imputación del período con interlocutor TYE_… (servicio a terceros, obra 1002).
-- Acceso: solo gerencia de Uso de equipos (es_gerencia_uso()).
-- =====================================================================

insert into public.uso_parametros (clave, valor, fecha, descripcion) values
  ('CC_MIN_LITROS',  50,      null, 'Combustible vs certificación: litros mínimos en el mes para alarmar "carga y no certifica"'),
  ('CC_MIN_CERT_GS', 1000000, null, 'Combustible vs certificación: certificación mínima (Gs) en el mes para alarmar "certifica sin combustible"'),
  ('CC_INICIO', null, '2026-09-01', 'Combustible vs certificación: primer mes que alarma (antes, las cargas de combustible SAP están incompletas)')
on conflict (clave) do nothing;

create table if not exists public.uso_cc_revisiones (
  id          bigint generated always as identity primary key,
  equipo      text not null,
  alarma      text not null check (alarma in ('comb_sin_cert','cert_sin_comb')),
  alcance     text not null check (alcance in ('siempre','mes')),
  anio        int,
  mes         int check (mes between 1 and 12),
  nota        text not null,
  usuario_id  uuid,
  created_at  timestamptz not null default now(),
  anulado_at  timestamptz,
  check (alcance = 'siempre' or (anio is not null and mes is not null))
);
alter table public.uso_cc_revisiones enable row level security;   -- sin políticas: solo por RPC
create index if not exists uso_cc_revisiones_equipo on public.uso_cc_revisiones (equipo, alarma) where anulado_at is null;


-- Datos del año: una fila por equipo y mes con actividad (certificación o combustible)
create or replace function public.uso_cc_datos(p_anio int)
returns table (equipo text, denominacion text, clase text, mes int, cerrado boolean,
               cert_gs numeric, cert_h numeric, cert_km numeric, cert_viajes numeric,
               litros numeric, cargas int, terceros boolean,
               alarma text, revision_id bigint, revision_alcance text, revision_nota text, revision_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_ini date := make_date(p_anio, 1, 1);
  v_fin date := make_date(p_anio, 12, 31);
  v_mes_actual date := date_trunc('month', (now() at time zone 'America/Asuncion'))::date;
  v_min_l numeric := coalesce(uso_param('CC_MIN_LITROS'), 50);
  v_min_g numeric := coalesce(uso_param('CC_MIN_CERT_GS'), 1000000);
  v_inicio date := date_trunc('month', coalesce((select p.fecha from uso_parametros p where p.clave = 'CC_INICIO'), date '2026-09-01'))::date;
begin
  if not es_gerencia_uso() then
    raise exception 'Solo gerencia de Uso de equipos' using errcode = '42501';
  end if;

  return query
  with c as (
    select i.equipo e, extract(month from i.fecha)::int m,
           sum(i.valor_pyg) gs,
           sum(i.cantidad) filter (where i.umedida = 'HRA') h,
           sum(i.cantidad) filter (where i.umedida = 'KM') km,
           sum(i.cantidad) filter (where i.umedida = 'UN') un,
           bool_or(i.interlocutor ilike 'TYE%') ter
    from sap_imputaciones i
    where i.clase_coste in (7100000001, 7100000002) and i.fecha between v_ini and v_fin
    group by 1, 2
  ), l as (
    select x.equipo e, extract(month from x.fecha)::int m, sum(x.litros) lit, count(*)::int n
    from sap_cargas_combustible x
    where x.fecha between v_ini and v_fin
    group by 1, 2
  ), j as (
    select coalesce(c.e, l.e) e, coalesce(c.m, l.m) m,
           coalesce(c.gs, 0) gs, c.h, c.km, c.un, coalesce(l.lit, 0) lit, coalesce(l.n, 0) n,
           coalesce(c.ter, false) ter,
           (make_date(p_anio, coalesce(c.m, l.m), 1) < v_mes_actual) cerrado
    from c full join l on l.e = c.e and l.m = c.m
  ), a as (
    select j.*,
           case when not j.cerrado or make_date(p_anio, j.m, 1) < v_inicio then null
                when j.lit >= v_min_l and j.gs <= 0 then 'comb_sin_cert'
                when j.gs >= v_min_g and j.lit = 0 then 'cert_sin_comb' end alarma
    from j
  ), eq as (
    select distinct on (trim(s.equipo)) trim(s.equipo) e, s.denominacion, s.clase
    from sap_equipos s order by trim(s.equipo), s.actualizado_en desc nulls last
  )
  select a.e, coalesce(eq.denominacion, ap.denominacion), coalesce(eq.clase, ap.clase_vehiculo, left(a.e, 5)),
         a.m, a.cerrado, a.gs, a.h, a.km, a.un, a.lit, a.n, a.ter, a.alarma,
         r.id, r.alcance, r.nota, r.created_at
  from a
  left join eq on eq.e = a.e
  left join lateral (select x.denominacion, x.clase_vehiculo from equipos x where x.numero_identificacion = a.e limit 1) ap on true
  left join lateral (
    select rv.id, rv.alcance, rv.nota, rv.created_at from uso_cc_revisiones rv
    where rv.equipo = a.e and rv.alarma = a.alarma and rv.anulado_at is null
      and (rv.alcance = 'siempre' or (rv.anio = p_anio and rv.mes = a.m))
    order by rv.created_at desc limit 1
  ) r on a.alarma is not null
  order by a.e, a.m;
end $$;

create or replace function public.uso_cc_revisar(p_equipo text, p_alarma text, p_alcance text,
                                                 p_anio int, p_mes int, p_nota text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not es_gerencia_uso() then raise exception 'Solo gerencia de Uso de equipos' using errcode = '42501'; end if;
  if length(trim(coalesce(p_nota, ''))) < 3 then raise exception 'La nota es obligatoria'; end if;
  if p_alcance not in ('siempre','mes') then raise exception 'Alcance inválido'; end if;
  insert into uso_cc_revisiones (equipo, alarma, alcance, anio, mes, nota, usuario_id)
  values (upper(trim(p_equipo)), p_alarma, p_alcance,
          case when p_alcance = 'mes' then p_anio end, case when p_alcance = 'mes' then p_mes end,
          trim(p_nota), uso_usuario_id())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.uso_cc_anular(p_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_gerencia_uso() then raise exception 'Solo gerencia de Uso de equipos' using errcode = '42501'; end if;
  update uso_cc_revisiones set anulado_at = now() where id = p_id and anulado_at is null;
end $$;

revoke all on function public.uso_cc_datos(int) from public, anon;
revoke all on function public.uso_cc_revisar(text, text, text, int, int, text) from public, anon;
revoke all on function public.uso_cc_anular(bigint) from public, anon;
grant execute on function public.uso_cc_datos(int) to authenticated;
grant execute on function public.uso_cc_revisar(text, text, text, int, int, text) to authenticated;
grant execute on function public.uso_cc_anular(bigint) to authenticated;
revoke all on table public.uso_cc_revisiones from anon, authenticated;

-- Tipo de equipo (V/P/M/B) para el filtro de tipos del módulo (uso_equipos_info → equipos → sap_equipos)
create or replace function public.uso_cc_tipos()
returns table (equipo text, tipo text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_gerencia_uso() then raise exception 'Solo gerencia de Uso de equipos' using errcode = '42501'; end if;
  return query
  select distinct on (x.e) x.e, x.t from (
    select u.equipo e, u.tipo t, 1 o from uso_equipos_info u
    union all
    select numero_identificacion, case when tipo_equipo in ('V','P','M','B') then tipo_equipo end, 2 from equipos
    union all
    select trim(s.equipo), case when s.tipo_equipo in ('V','P','M','B') then s.tipo_equipo end, 3 from sap_equipos s
  ) x where x.e is not null and x.t is not null
  order by x.e, x.o;
end $$;
revoke all on function public.uso_cc_tipos() from public, anon;
grant execute on function public.uso_cc_tipos() to authenticated;
