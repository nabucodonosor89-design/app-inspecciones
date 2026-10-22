-- =====================================================================
-- USO DE EQUIPOS — imputaciones SAP anómalas (22/10/2026)
-- supabase/uso_sap_anomalias.sql   (idempotente)
-- =====================================================================
--
-- Cuatro hallazgos nuevos, mismos casos por obra y mismo flujo que el resto:
--  sap_negativa     imputación negativa sin una positiva igual (equipo, día, unidad) que la anule.
--                   Ej.: 18/10 obra 1036 cargó el horómetro inicial como cantidad y con el signo
--                   invertido (PS-RP014 −446,1 h, VP-MX011 −444,4 h).
--  sap_imposible    más de MAX_SAP_DIA_H (24) h o MAX_SAP_DIA_KM (1.500) km imputados en un día.
--  sap_sobre_parte  SAP supera al parte en > TOL_SAP_PARTE_H (3 h) / _KM (30 km) y en más de
--                   FACTOR_SAP_PARTE (×2), en el día Y en la suma de 7 días (±3).
--  sap_bajo_parte   lo inverso: el parte supera a SAP (facturación que se pierde).
-- Requiere que sap_imputaciones tenga signo (supabase/sap_ingestar.sql, 22/10/2026).
-- Monto = cantidad × costo unitario del equipo (como el resto de los hallazgos).
-- Corren sobre todo el año (desde el inicio de SAP).
-- Aviso: n8n "Uso de equipos — anomalías SAP (Telegram)" a las 14:40, después del refresco de las 14:30.
-- =====================================================================

-- 1. Tipos nuevos
alter table public.uso_hallazgos drop constraint if exists uso_hallazgos_tipo_check;
alter table public.uso_hallazgos add constraint uso_hallazgos_tipo_check check (tipo in
  ('uso_sin_parte','combustible_sin_parte','parte_sin_sap','parte_sobre_rastreo','rastreo_sobre_parte',
   'sap_negativa','sap_imposible','sap_sobre_parte','sap_bajo_parte'));

-- 2. Parámetros
insert into public.uso_parametros (clave, valor, fecha, descripcion) values
  ('MAX_SAP_DIA_H',     24,   null, 'sap_imposible: más de N h imputadas a un equipo en un día'),
  ('MAX_SAP_DIA_KM',    1500, null, 'sap_imposible: más de N km imputados a un equipo en un día'),
  ('TOL_SAP_PARTE_H',   3,    null, 'sap_sobre_parte / sap_bajo_parte: diferencia mínima en h'),
  ('TOL_SAP_PARTE_KM',  30,   null, 'sap_sobre_parte / sap_bajo_parte: diferencia mínima en km'),
  ('FACTOR_SAP_PARTE',  2,    null, 'sap_sobre_parte / sap_bajo_parte: además, uno tiene que ser más de N veces el otro')
on conflict (clave) do nothing;

-- 3. Bandeja: conteos de los tipos nuevos (columnas al final)
create or replace view public.v_uso_bandeja with (security_invoker = true) as
 SELECT c.id AS caso_id, c.obra, o.nombre AS obra_nombre, c.estado, c.creado_at, c.ultima_gestion_at, c.escalado_at,
    count(h.id) AS abiertos,
    count(h.id) FILTER (WHERE h.tipo = 'uso_sin_parte') AS n_uso_sin_parte,
    count(h.id) FILTER (WHERE h.tipo = 'combustible_sin_parte') AS n_combustible_sin_parte,
    count(h.id) FILTER (WHERE h.tipo = 'parte_sin_sap') AS n_parte_sin_sap,
    count(h.id) FILTER (WHERE h.tipo = 'parte_sobre_rastreo') AS n_parte_sobre_rastreo,
    count(h.id) FILTER (WHERE h.tipo = 'rastreo_sobre_parte') AS n_rastreo_sobre_parte,
    COALESCE(sum(h.monto_neto), 0::numeric) AS monto_abierto,
    min(h.fecha) AS fecha_mas_vieja,
    ((now() AT TIME ZONE 'America/Asuncion')::date - min(h.fecha)) AS dias_mas_viejo,
    count(h.id) FILTER (WHERE c.ultima_gestion_at IS NOT NULL AND GREATEST(h.detectado_at, COALESCE(h.reabierto_at, h.detectado_at)) > c.ultima_gestion_at) AS nuevos_desde_gestion,
    g.created_at AS ultima_gestion_fecha, g.texto AS ultima_gestion_texto, g.tipo AS ultima_gestion_tipo,
    count(h.id) FILTER (WHERE h.tipo = 'sap_negativa') AS n_sap_negativa,
    count(h.id) FILTER (WHERE h.tipo = 'sap_imposible') AS n_sap_imposible,
    count(h.id) FILTER (WHERE h.tipo = 'sap_sobre_parte') AS n_sap_sobre_parte,
    count(h.id) FILTER (WHERE h.tipo = 'sap_bajo_parte') AS n_sap_bajo_parte
   FROM uso_casos c
     LEFT JOIN uso_obras o ON o.codigo = c.obra
     LEFT JOIN uso_hallazgos h ON h.obra = c.obra AND h.estado = 'abierto'
     LEFT JOIN LATERAL ( SELECT x.created_at, x.texto, x.tipo FROM uso_caso_gestiones x
          WHERE x.caso_id = c.id AND x.tipo <> 'auto' ORDER BY x.created_at DESC LIMIT 1) g ON true
  WHERE c.estado <> 'cerrado'
  GROUP BY c.id, c.obra, o.nombre, c.estado, c.creado_at, c.ultima_gestion_at, c.escalado_at, g.created_at, g.texto, g.tipo;

-- 4. Reglas dentro de uso_refrescar(): se insertan antes del conteo de detectados.
--    Se aplica sobre la función viva (que incluye el parche provisorio de SAP) y no se duplica.
do $do$
declare
  d text := pg_get_functiondef('public.uso_refrescar()'::regprocedure);
  ancla text := '  select count(*) into n_cur from t_h;';
  reglas text := $r$
  -- ── Imputaciones SAP anómalas (supabase/uso_sap_anomalias.sql) ─────
  -- sap_negativa: negativa sin una positiva igual que la anule
  insert into t_h
  select x.equipo, x.fecha, 'sap_negativa', coalesce(x.obra, u.obra, 'SIN'),
         case when x.obra is not null then 2::smallint else u.obra_origen end,
         u.rastreo_q, u.parte_q, u.sap_q, u.litros, null, null, x.q
  from (
    select n.equipo, n.fecha, min(nullif(trim(n.obra_codigo), '')) obra,
           -sum(case when (n.umedida = 'HRA' and e.unidad = 'h') or (n.umedida = 'KM' and e.unidad = 'km')
                     then n.cantidad end) q
    from sap_imputaciones n join uso_equipos_info e on e.equipo = n.equipo
    where n.cantidad < 0 and n.clase_coste in (7100000001, 7100000002)
      and n.fecha between i_s and c_s
      and not exists (select 1 from sap_imputaciones p
                      where p.equipo = n.equipo and p.fecha = n.fecha and p.umedida = n.umedida
                        and p.cantidad = -n.cantidad)
    group by 1, 2
  ) x
  left join uso_diario u on u.equipo = x.equipo and u.fecha = x.fecha;

  -- sap_imposible: más de 24 h / 1.500 km en un día
  insert into t_h
  select equipo, fecha, 'sap_imposible', coalesce(sap_obra, obra), case when sap_obra is not null then 2::smallint else obra_origen end,
         rastreo_q, parte_q, sap_q, litros, null, null, greatest(sap_q - coalesce(parte_q, 0), 0)
  from uso_diario
  where fecha between i_s and c_s and unidad is not null
    and sap_q > case unidad when 'h' then uso_param('MAX_SAP_DIA_H') else uso_param('MAX_SAP_DIA_KM') end;

  -- sap_sobre_parte / sap_bajo_parte: en el día y en la suma de 7 días (±3)
  insert into t_h
  with w as (
    select u.*,
           sum(coalesce(u.sap_q, 0))   over v sw,
           sum(coalesce(u.parte_q, 0)) over v pw,
           case u.unidad when 'h' then uso_param('TOL_SAP_PARTE_H') else uso_param('TOL_SAP_PARTE_KM') end tol,
           uso_param('FACTOR_SAP_PARTE') f
    from uso_diario u
    where u.unidad is not null and u.fecha between i_s - 3 and c_s
    window v as (partition by u.equipo order by u.fecha range between interval '3 days' preceding and interval '3 days' following)
  )
  select equipo, fecha, 'sap_sobre_parte', coalesce(sap_obra, obra), case when sap_obra is not null then 2::smallint else obra_origen end,
         rastreo_q, parte_q, sap_q, litros, null::date, null::date, sap_q - parte_q
  from w
  where fecha between i_s and least(c_s, c_p - 3)
    and parte_q is not null and sap_q >= 0
    and sap_q <= case unidad when 'h' then uso_param('MAX_SAP_DIA_H') else uso_param('MAX_SAP_DIA_KM') end
    and sap_q - parte_q > tol and sap_q > f * parte_q
    and sw - pw > tol and sw > f * pw
  union all
  select equipo, fecha, 'sap_bajo_parte', coalesce(sap_obra, parte_obra, obra), case when sap_obra is not null then 2::smallint else obra_origen end,
         rastreo_q, parte_q, sap_q, litros, null::date, null::date, parte_q - sap_q
  from w
  where fecha between i_s and least(v_hoy - gracia, c_s - 3, c_p)
    and tiene_sap and sap_q is not null and sap_q >= 0 and parte_q is not null
    and parte_q - sap_q > tol and parte_q > f * sap_q
    and pw - sw > tol and pw > f * sw;

$r$;
begin
  if position('sap_negativa' in d) > 0 then
    raise notice 'uso_refrescar ya tiene las reglas SAP: no se toca';
    return;
  end if;
  if position(ancla in d) = 0 then raise exception 'No encontré el ancla en uso_refrescar'; end if;
  d := replace(d, ancla, reglas || ancla);
  execute d;
end $do$;


-- 5. Para el aviso por Telegram (n8n "Uso de equipos — anomalías SAP (Telegram)", id Y5F5OWMymUP6KBP5, 14:40):
--    hallazgos sap_* abiertos detectados o reabiertos en las últimas p_horas. Solo service_role.
create or replace function public.uso_sap_anomalias_nuevas(p_horas int default 24)
returns table (tipo text, equipo text, fecha date, obra text, obra_nombre text, unidad text,
               sap_q numeric, parte_q numeric, cantidad numeric, monto numeric)
language sql stable security definer set search_path = public as $$
  select h.tipo, h.equipo, h.fecha, h.obra, o.nombre, h.unidad, h.sap_q, h.parte_q, h.cantidad_sin_respaldo, h.monto
  from uso_hallazgos h left join uso_obras o on o.codigo = h.obra
  where h.tipo like 'sap\_%' and h.estado = 'abierto'
    and greatest(h.detectado_at, coalesce(h.reabierto_at, h.detectado_at)) >= now() - make_interval(hours => p_horas)
  order by h.monto desc nulls last
$$;
revoke all on function public.uso_sap_anomalias_nuevas(int) from public, anon, authenticated;
grant execute on function public.uso_sap_anomalias_nuevas(int) to service_role;
