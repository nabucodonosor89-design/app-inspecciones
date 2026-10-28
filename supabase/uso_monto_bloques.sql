-- ============================================================
-- USO DE EQUIPOS — monto por bloque (28/10/2026)
-- Prompt: claude/prompt-cowork-uso-equipos-monto-por-bloque.md (proyecto)
--
-- Problema: uso_hallazgos.monto es siempre positivo y los totales sumaban en un solo
-- número lo que falta imputar, lo imputado de más y los indicios de rastreo.
-- Decisión: no se netea. Cada hallazgo pertenece a un bloque:
--   sap_falta  (+)  parte_sin_sap, sap_bajo_parte, sap_negativa
--   sap_de_mas (−)  sap_sobre_parte, sap_imposible
--   rastreo    (+, informativo)  uso_sin_parte, rastreo_sobre_parte, parte_sobre_rastreo,
--                                combustible_sin_parte (sin monto)
-- `monto` sigue siendo la MAGNITUD (para ordenar por importancia); el signo va en
-- monto_signado / monto_neto_signado. Idempotente.
-- ============================================================

-- ── 1. Bloque por tipo ──────────────────────────────────────────
create or replace function public.uso_bloque(p_tipo text)
returns text language sql immutable parallel safe as $$
  select case p_tipo
    when 'parte_sin_sap'         then 'sap_falta'
    when 'sap_bajo_parte'        then 'sap_falta'
    when 'sap_negativa'          then 'sap_falta'   -- la imputación negativa le baja la facturación a la obra
    when 'sap_sobre_parte'       then 'sap_de_mas'
    when 'sap_imposible'         then 'sap_de_mas'
    when 'uso_sin_parte'         then 'rastreo'
    when 'rastreo_sobre_parte'   then 'rastreo'
    when 'parte_sobre_rastreo'   then 'rastreo'
    when 'combustible_sin_parte' then 'rastreo'
  end   -- tipo nuevo sin mapear → NULL (la verificación del punto 5 lo detecta)
$$;

-- ── 2. Columnas generadas en uso_hallazgos ──────────────────────
-- Columnas generadas (no las toca uso_refrescar): siempre consistentes con tipo/monto.
-- Una generada no puede referenciar otra generada, por eso todas llaman a uso_bloque(tipo).
alter table public.uso_hallazgos
  add column if not exists bloque text
    generated always as (public.uso_bloque(tipo)) stored;
alter table public.uso_hallazgos
  add column if not exists monto_signado numeric
    generated always as (case when public.uso_bloque(tipo) = 'sap_de_mas' then -monto else monto end) stored;
alter table public.uso_hallazgos
  add column if not exists monto_neto_signado numeric
    generated always as (case when public.uso_bloque(tipo) = 'sap_de_mas' then -monto_neto else monto_neto end) stored;

-- ── 3. monto_neto por equipo + día + BLOQUE (en uso_refrescar) ──
-- Antes: una sola vez por equipo + día (el mayor), así un SAP de más y un parte > rastreo
-- del mismo día se pisaban. Se parchea la definición viva en vez de reescribir la función
-- entera (25 kB); queda idempotente: si ya está parcheada no hace nada.
do $$
declare
  v_def text := pg_get_functiondef('public.uso_refrescar()'::regprocedure);
  v_nuevo text;
begin
  if v_def ~ 'partition by equipo, fecha, uso_bloque\(tipo\)' then
    raise notice 'uso_refrescar ya particiona monto_neto por bloque';
    return;
  end if;
  v_nuevo := regexp_replace(v_def,
    'row_number\(\) over \(partition by equipo, fecha(\s*)order by monto desc nulls last, tipo\)',
    'row_number() over (partition by equipo, fecha, uso_bloque(tipo)\1order by monto desc nulls last, tipo)');
  if v_nuevo = v_def then
    raise exception 'No se encontró el bloque de monto_neto en uso_refrescar: revisar a mano';
  end if;
  v_nuevo := replace(v_nuevo,
    '-- monto neto: una sola vez por equipo + día entre los abiertos (el mayor)',
    '-- monto neto: una sola vez por equipo + día + bloque entre los abiertos (el mayor) — 28/10/2026');
  execute v_nuevo;
end $$;

-- ── 4. Vistas (se agregan columnas AL FINAL; no se quita ninguna) ──
create or replace view public.v_uso_hallazgos_abiertos with (security_invoker = true) as
 SELECT h.id, h.equipo, h.denominacion, h.fecha, h.tipo, h.obra, o.nombre AS obra_nombre, h.obra_origen,
    h.tipo_equipo, h.clase, h.unidad, h.rastreo_q, h.parte_q, h.sap_q, h.litros, h.periodo_desde,
    h.periodo_hasta, h.cantidad_sin_respaldo, h.costo_unitario, h.costo_por_clase, h.monto,
    h.detectado_at, h.reabierto_at, c.id AS caso_id,
    c.ultima_gestion_at IS NOT NULL AND GREATEST(h.detectado_at, COALESCE(h.reabierto_at, h.detectado_at)) > c.ultima_gestion_at AS nuevo,
    h.monto_neto,
    h.bloque, h.monto_signado, h.monto_neto_signado
   FROM uso_hallazgos h
     LEFT JOIN uso_obras o ON o.codigo = h.obra
     LEFT JOIN uso_casos c ON c.obra = h.obra AND c.estado <> 'cerrado'::text
  WHERE h.estado = 'abierto'::text;

create or replace view public.v_uso_bandeja with (security_invoker = true) as
 SELECT c.id AS caso_id, c.obra, o.nombre AS obra_nombre, c.estado, c.creado_at, c.ultima_gestion_at, c.escalado_at,
    count(h.id) AS abiertos,
    count(h.id) FILTER (WHERE h.tipo = 'uso_sin_parte'::text) AS n_uso_sin_parte,
    count(h.id) FILTER (WHERE h.tipo = 'combustible_sin_parte'::text) AS n_combustible_sin_parte,
    count(h.id) FILTER (WHERE h.tipo = 'parte_sin_sap'::text) AS n_parte_sin_sap,
    count(h.id) FILTER (WHERE h.tipo = 'parte_sobre_rastreo'::text) AS n_parte_sobre_rastreo,
    count(h.id) FILTER (WHERE h.tipo = 'rastreo_sobre_parte'::text) AS n_rastreo_sobre_parte,
    COALESCE(sum(h.monto_neto), 0::numeric) AS monto_abierto,   -- obsoleto: mezcla bloques (compatibilidad)
    min(h.fecha) AS fecha_mas_vieja,
    (now() AT TIME ZONE 'America/Asuncion'::text)::date - min(h.fecha) AS dias_mas_viejo,
    count(h.id) FILTER (WHERE c.ultima_gestion_at IS NOT NULL AND GREATEST(h.detectado_at, COALESCE(h.reabierto_at, h.detectado_at)) > c.ultima_gestion_at) AS nuevos_desde_gestion,
    g.created_at AS ultima_gestion_fecha, g.texto AS ultima_gestion_texto, g.tipo AS ultima_gestion_tipo,
    count(h.id) FILTER (WHERE h.tipo = 'sap_negativa'::text) AS n_sap_negativa,
    count(h.id) FILTER (WHERE h.tipo = 'sap_imposible'::text) AS n_sap_imposible,
    count(h.id) FILTER (WHERE h.tipo = 'sap_sobre_parte'::text) AS n_sap_sobre_parte,
    count(h.id) FILTER (WHERE h.tipo = 'sap_bajo_parte'::text) AS n_sap_bajo_parte,
    COALESCE(sum(h.monto_neto_signado) FILTER (WHERE h.bloque = 'sap_falta'), 0::numeric) AS monto_sap_falta,
    COALESCE(sum(h.monto_neto_signado) FILTER (WHERE h.bloque = 'sap_de_mas'), 0::numeric) AS monto_sap_de_mas,
    COALESCE(sum(h.monto_neto_signado) FILTER (WHERE h.bloque = 'rastreo'), 0::numeric) AS monto_rastreo
   FROM uso_casos c
     LEFT JOIN uso_obras o ON o.codigo = c.obra
     LEFT JOIN uso_hallazgos h ON h.obra = c.obra AND h.estado = 'abierto'::text
     LEFT JOIN LATERAL ( SELECT x.created_at, x.texto, x.tipo
           FROM uso_caso_gestiones x
          WHERE x.caso_id = c.id AND x.tipo <> 'auto'::text
          ORDER BY x.created_at DESC
         LIMIT 1) g ON true
  WHERE c.estado <> 'cerrado'::text
  GROUP BY c.id, c.obra, o.nombre, c.estado, c.creado_at, c.ultima_gestion_at, c.escalado_at, g.created_at, g.texto, g.tipo;

create or replace view public.v_uso_indicadores_obra with (security_invoker = true) as
 WITH ini AS (
         SELECT date_trunc('year'::text, (now() AT TIME ZONE 'America/Asuncion'::text))::date AS d
        ), h AS (
         SELECT h_1.obra,
            count(*) FILTER (WHERE h_1.estado = 'abierto'::text) AS abiertos,
            COALESCE(sum(h_1.monto_neto) FILTER (WHERE h_1.estado = 'abierto'::text), 0::numeric) AS monto_abierto,
            count(*) FILTER (WHERE h_1.estado = 'resuelto'::text) AS resueltos,
            count(*) FILTER (WHERE h_1.estado = 'justificado'::text) AS justificados,
            count(*) FILTER (WHERE h_1.estado = 'vencido'::text) AS vencidos,
            count(*) FILTER (WHERE h_1.detectado_at >= (now() - '30 days'::interval)) AS nuevos_30d,
            round(avg(h_1.resuelto_at::date - h_1.fecha) FILTER (WHERE h_1.estado = 'resuelto'::text), 1) AS dias_prom_resolucion,
            COALESCE(sum(h_1.monto_neto_signado) FILTER (WHERE h_1.estado = 'abierto'::text AND h_1.bloque = 'sap_falta'), 0::numeric) AS monto_sap_falta,
            COALESCE(sum(h_1.monto_neto_signado) FILTER (WHERE h_1.estado = 'abierto'::text AND h_1.bloque = 'sap_de_mas'), 0::numeric) AS monto_sap_de_mas,
            COALESCE(sum(h_1.monto_neto_signado) FILTER (WHERE h_1.estado = 'abierto'::text AND h_1.bloque = 'rastreo'), 0::numeric) AS monto_rastreo
           FROM uso_hallazgos h_1, ini
          WHERE h_1.fecha >= ini.d OR h_1.estado = 'vencido'::text AND h_1.actualizado_at >= ini.d
          GROUP BY h_1.obra
        ), e AS (
         SELECT c.obra, count(*) AS veces_escalada
           FROM uso_caso_gestiones g
             JOIN uso_casos c ON c.id = g.caso_id, ini
          WHERE g.tipo = 'escalado'::text AND g.created_at >= ini.d
          GROUP BY c.obra
        )
 SELECT h.obra, h.abiertos, h.monto_abierto, h.resueltos, h.justificados, h.vencidos, h.nuevos_30d,
    h.dias_prom_resolucion, COALESCE(e.veces_escalada, 0::bigint) AS veces_escalada, o.nombre AS obra_nombre,
    h.monto_sap_falta, h.monto_sap_de_mas, h.monto_rastreo
   FROM h
     LEFT JOIN e USING (obra)
     LEFT JOIN uso_obras o ON o.codigo = h.obra
  WHERE es_gerencia_uso();

-- ── 5. Telegram 14:30: sumar bloque (cambia el RETURNS → drop + create) ──
drop function if exists public.uso_sap_anomalias_nuevas(integer);
create function public.uso_sap_anomalias_nuevas(p_horas integer DEFAULT 24)
 RETURNS TABLE(tipo text, equipo text, fecha date, obra text, obra_nombre text, unidad text,
               sap_q numeric, parte_q numeric, cantidad numeric, monto numeric, bloque text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select h.tipo, h.equipo, h.fecha, h.obra, o.nombre, h.unidad, h.sap_q, h.parte_q, h.cantidad_sin_respaldo, h.monto, h.bloque
  from uso_hallazgos h left join uso_obras o on o.codigo = h.obra
  where h.tipo like 'sap\_%' and h.estado = 'abierto'
    and greatest(h.detectado_at, coalesce(h.reabierto_at, h.detectado_at)) >= now() - make_interval(hours => p_horas)
  order by h.monto desc nulls last   -- magnitud: lo más grande primero, sea de más o de menos
$function$;
revoke all on function public.uso_sap_anomalias_nuevas(integer) from public, anon, authenticated;
grant execute on function public.uso_sap_anomalias_nuevas(integer) to service_role;

-- ── 6. Recalcular (para que monto_neto tome el nuevo particionado) ──
-- select public.uso_refrescar();
