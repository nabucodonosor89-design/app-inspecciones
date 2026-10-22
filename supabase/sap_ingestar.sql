-- =====================================================================
-- INGESTA SAP → Supabase: sap_ingestar() + cierre de costo_equipo
-- supabase/sap_ingestar.sql   (idempotente)
-- Llamada por n8n "Ingesta SAP → Supabase (historial + alertas)" (id F4ewZvGWtoqHsI7L).
-- =====================================================================
--
-- ── costo_equipo (sap_imputaciones) — corregido 22/10/2026 ────────────
--  El export costo_equipo es una FOTO de los últimos ~6 meses. SAP recalcula la facturación
--  interna y le da una `secuencia` nueva a la misma línea; la vieja deja de existir en SAP.
--  Antes la ingesta solo agregaba por secuencia → la misma imputación quedaba 2…8 veces
--  (oct-2026: 3,7 filas por línea real).
--  Ahora:
--   1. Cada lote hace upsert por secuencia y marca `visto_ingesta` = ingesta del archivo.
--   2. Después del último lote, n8n manda un lote extra con p_fuente = 'costo_equipo_cierre'
--      → sap_imputaciones_cerrar(): borra las filas con fecha dentro del rango del archivo
--      que no vinieron en él. FRENO: si el archivo trae menos del 80 % de las líneas distintas
--      que hay en la base para ese rango, no borra nada y lo avisa (cierre_omitido).
--   3. Signo: cantidad/valores = − lo que trae SAP (la imputación normal viene negativa).
--      Imputación normal → positiva; anulación → negativa. Antes se guardaba abs() y las
--      anulaciones se sumaban.
--  Respaldo previo a la limpieza: sap_imputaciones_bkp_20261022 (borrar cuando no haga falta).
-- =====================================================================

alter table public.sap_imputaciones add column if not exists visto_ingesta bigint;
alter table public.sap_ingestas add column if not exists filas_borradas int;
alter table public.sap_ingestas add column if not exists cierre jsonb;


-- Cierre de un archivo costo_equipo: borra lo que ya no está en SAP dentro del rango del archivo
create or replace function public.sap_imputaciones_cerrar(p_file_id text, p_umbral numeric default 0.8)
returns jsonb
language plpgsql set search_path = public as $$
declare
  v_ing    bigint;
  v_desde  date;
  v_hasta  date;
  v_vistas int;
  v_base   int;
  v_borrar int;
  v_res    jsonb;
begin
  select id into v_ing from sap_ingestas where fuente = 'costo_equipo' and drive_file_id = p_file_id;
  if v_ing is null then
    raise exception 'No hay ingesta costo_equipo para el archivo %', p_file_id;
  end if;

  select min(fecha), max(fecha), count(*) into v_desde, v_hasta, v_vistas
  from sap_imputaciones where visto_ingesta = v_ing;

  if v_vistas = 0 then
    v_res := jsonb_build_object('ok', false, 'motivo', 'el archivo no trajo filas', 'borradas', 0);
  else
    -- Líneas distintas que hay en la base para el rango (los duplicados cuentan una vez)
    select count(distinct (equipo, clase_coste, umedida, cantidad, valor_pyg, obra_codigo, observacion, fecha)),
           count(*) filter (where visto_ingesta is distinct from v_ing)
      into v_base, v_borrar
    from sap_imputaciones where fecha between v_desde and v_hasta;

    if v_vistas < p_umbral * v_base then
      v_res := jsonb_build_object('ok', false, 'borradas', 0, 'desde', v_desde, 'hasta', v_hasta,
                 'vistas', v_vistas, 'base', v_base, 'a_borrar', v_borrar,
                 'motivo', format('el archivo trae %s líneas y la base %s para el rango: no se borra nada', v_vistas, v_base));
    else
      delete from sap_imputaciones
      where fecha between v_desde and v_hasta and visto_ingesta is distinct from v_ing;
      get diagnostics v_borrar = row_count;
      v_res := jsonb_build_object('ok', true, 'borradas', v_borrar, 'desde', v_desde, 'hasta', v_hasta,
                 'vistas', v_vistas, 'base', v_base);
    end if;
  end if;

  update sap_ingestas set filas_borradas = (v_res->>'borradas')::int, cierre = v_res, procesado_en = now()
  where id = v_ing;
  return v_res;
end $$;
revoke all on function public.sap_imputaciones_cerrar(text, numeric) from public, anon, authenticated;
grant execute on function public.sap_imputaciones_cerrar(text, numeric) to service_role;


create or replace function public.sap_ingestar(p_fuente text, p_archivo text, p_file_id text, p_rows jsonb)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_ing    bigint;
  v_leidas int := coalesce(jsonb_array_length(p_rows), 0);
  v_nuevas int := 0;
  v_cambio int := 0;
  v_alert  int := 0;
  v_cierre jsonb;
begin
  -- Lote final de costo_equipo (lo agrega n8n después del último lote del archivo)
  if p_fuente = 'costo_equipo_cierre' then
    v_cierre := sap_imputaciones_cerrar(p_file_id);
    return jsonb_build_object('fuente', 'costo_equipo', 'archivo', p_archivo, 'leidas', 0,
                              'nuevas_o_actualizadas', 0, 'eventos', 0, 'alertas_nuevas', 0,
                              'borradas', coalesce((v_cierre->>'borradas')::int, 0),
                              'cierre_ok', (v_cierre->>'ok')::boolean,
                              'cierre_motivo', v_cierre->>'motivo');
  end if;

  insert into sap_ingestas (fuente, archivo, drive_file_id, filas_leidas, filas_nuevas, filas_cambio)
  values (p_fuente, p_archivo, p_file_id, 0, 0, 0)
  on conflict (fuente, drive_file_id) do update set procesado_en = now()
  returning id into v_ing;

  if p_fuente = 'consumos' then
    with raw as (
      select sap_num(r->'equipo')::bigint                      as equipo_sap,
             sap_txt(r->'descripcion del equipo')              as descr,
             sap_fecha(r->'fecha')                             as fecha,
             sap_num(r->'hkm')                                 as horometro,
             round(sap_num(r->'combustible') / 1000000.0, 2)   as litros,
             sap_num(r->'consumo')                             as l_por_unidad,
             sap_txt(r->'obra')                                as obra
      from jsonb_array_elements(p_rows) r
    ), norm as (
      select raw.*,
             coalesce(e.equipo, split_part(raw.descr, ' ', 1)) as equipo,
             row_number() over (partition by raw.equipo_sap, raw.fecha, raw.horometro, raw.litros) as ocurrencia
      from raw left join sap_equipos e on e.equipo_sap = raw.equipo_sap
      where raw.equipo_sap is not null and raw.fecha is not null and raw.litros is not null
    )
    insert into sap_cargas_combustible (equipo_sap, equipo, fecha, horometro, litros, l_por_unidad, obra, ocurrencia, ingesta_id)
    select equipo_sap, equipo, fecha, horometro, litros, l_por_unidad, obra, ocurrencia, v_ing from norm
    on conflict (equipo_sap, fecha, horometro, litros, ocurrencia) do nothing;
    get diagnostics v_nuevas = row_count;
    v_alert := sap_generar_alertas_combustible();

  elsif p_fuente = 'costo_equipo' then
    -- Upsert por secuencia; marca visto_ingesta para el cierre. Signo: − lo que trae SAP.
    with src as (
      select distinct on (sap_num(r->'secuencia')::bigint)
             sap_num(r->'secuencia')::bigint      as secuencia,
             sap_fecha(r->'fecha', true)          as fecha,
             sap_txt(r->'equipo')                 as equipo,
             sap_num(r->'clase_de_coste')::bigint as clase_coste,
             sap_txt(r->'denom_clase_coste')      as denom_clase,
             sap_txt(r->'umedida')                as umedida,
             -sap_num(r->'cant_reg')              as cantidad,
             -sap_num(r->'valor_us')              as valor_usd,
             -sap_num(r->'valor_tr')              as valor_pyg,
             sap_txt(r->'interlocutor')           as interlocutor,
             substring(sap_txt(r->'interlocutor') from '(\d{4})') as obra_codigo,
             nullif(trim(split_part(sap_txt(r->'observacion'), ' ', 1)), '') as observacion
      from jsonb_array_elements(p_rows) r
      where sap_num(r->'secuencia') is not null and sap_fecha(r->'fecha', true) is not null
    ), up as (
      insert into sap_imputaciones as t (secuencia, fecha, equipo, clase_coste, denom_clase, umedida, cantidad,
                                         valor_usd, valor_pyg, interlocutor, obra_codigo, observacion, ingesta_id, visto_ingesta)
      select src.*, v_ing, v_ing from src
      on conflict (secuencia) do update set
        visto_ingesta = excluded.visto_ingesta,
        cantidad = excluded.cantidad, valor_usd = excluded.valor_usd, valor_pyg = excluded.valor_pyg
      returning (xmax = 0) as nuevo
    )
    select count(*) filter (where nuevo) into v_nuevas from up;

  elsif p_fuente = 'ie36' then
    create temp table _eq on commit drop as
    select sap_num(r->'Equipo')::bigint                           as equipo_sap,
           sap_txt(r->'Número-identificación técnica')            as equipo,
           sap_txt(r->'Denominación de objeto técnico')           as denominacion,
           sap_txt(r->'Clase de vehículo')                        as clase,
           sap_txt(r->'Tipo de equipo')                           as tipo_equipo,
           sap_txt(r->'Fabricante del activo fijo')               as fabricante,
           sap_txt(r->'Denominación de tipo')                     as modelo,
           sap_txt(r->'Matrícula vehículo')                       as matricula,
           sap_num(r->'Año de construcción')::int                 as anio,
           sap_txt(r->'Denominación de la ubicación técnica')     as ubicacion,
           sap_txt(r->'Ind.utilización')                          as ind_utilizacion,
           sap_txt(r->'Status de usuario')                        as status_usuario,
           sap_txt(r->'Status del sistema')                       as status_sistema,
           sap_num(r->'Valor de adquisición')                     as valor_adquisicion,
           sap_txt(r->'Moneda')                                   as moneda,
           coalesce(sap_txt(r->'Centro emplazamiento'), sap_txt(r->'Centro de emplazamiento'),
                    sap_txt(r->'Centro Emplazamiento'), sap_txt(r->'Ce.emplazamiento'))  as centro
    from jsonb_array_elements(p_rows) r
    where sap_num(r->'Equipo') is not null and sap_txt(r->'Número-identificación técnica') is not null;

    insert into sap_equipos_historial (equipo_sap, equipo, campo, valor_anterior, valor_nuevo, ingesta_id)
    select n.equipo_sap, n.equipo, c.campo, c.ant, c.nue, v_ing
    from _eq n
    left join sap_equipos o on o.equipo_sap = n.equipo_sap
    cross join lateral (values
      ('ubicacion',       o.ubicacion,       n.ubicacion),
      ('status_usuario',  o.status_usuario,  n.status_usuario),
      ('ind_utilizacion', o.ind_utilizacion, n.ind_utilizacion)
    ) c(campo, ant, nue)
    where (o.equipo_sap is null and c.nue is not null)
       or (o.equipo_sap is not null and c.ant is distinct from c.nue);
    get diagnostics v_cambio = row_count;

    insert into sap_equipos as t (equipo_sap, equipo, denominacion, clase, tipo_equipo, fabricante, modelo, matricula,
                                  anio, ubicacion, ind_utilizacion, status_usuario, status_sistema, valor_adquisicion, moneda, centro)
    select * from _eq
    on conflict (equipo_sap) do update set
      equipo = excluded.equipo, denominacion = excluded.denominacion, clase = excluded.clase,
      tipo_equipo = excluded.tipo_equipo, fabricante = excluded.fabricante, modelo = excluded.modelo,
      matricula = excluded.matricula, anio = excluded.anio, ubicacion = excluded.ubicacion,
      ind_utilizacion = excluded.ind_utilizacion, status_usuario = excluded.status_usuario,
      status_sistema = excluded.status_sistema, valor_adquisicion = excluded.valor_adquisicion,
      moneda = excluded.moneda, centro = excluded.centro, actualizado_en = now()
    where (t.ubicacion, t.status_usuario, t.ind_utilizacion, t.status_sistema, t.equipo, t.denominacion, t.centro)
          is distinct from
          (excluded.ubicacion, excluded.status_usuario, excluded.ind_utilizacion, excluded.status_sistema, excluded.equipo, excluded.denominacion, excluded.centro);
    get diagnostics v_nuevas = row_count;

  elsif p_fuente = 'trabajo' then
    create temp table _ord on commit drop as
    select sap_num(r->'Orden')::bigint                        as orden,
           sap_num(r->'Notificación')::bigint                 as aviso,
           sap_txt(r->'Clase de orden')                       as clase_orden,
           sap_txt(r->'Centro de coste')                      as equipo,
           sap_num(r->'Equipo')::bigint                       as equipo_sap,
           sap_txt(r->'Texto breve')                          as texto,
           sap_txt(r->'Denominación de la ubicación técnica') as ubicacion,
           sap_txt(r->'Status de usuario')                    as status_usuario,
           sap_txt(r->'Status del sistema')                   as status_sistema,
           sap_txt(r->'Prioridad')                            as prioridad,
           sap_txt(r->'Pto.tbjo.responsable')                 as pto_trabajo,
           sap_fecha(r->'Fecha entrada')                      as fecha_entrada,
           sap_fecha(r->'Fecha inicio real')                  as fecha_inicio_real,
           sap_fecha(r->'Fecha real de fin de la orden')      as fecha_fin_real,
           sap_fecha(r->'Fe.liberación real')                 as fecha_liberacion,
           sap_txt(r->'Autor')                                as autor
    from jsonb_array_elements(p_rows) r
    where sap_num(r->'Orden') is not null;

    insert into sap_ordenes_eventos (orden, estado_anterior, estado_nuevo, ingesta_id)
    select n.orden, o.status_usuario, n.status_usuario, v_ing
    from _ord n left join sap_ordenes o on o.orden = n.orden
    where o.orden is null or o.status_usuario is distinct from n.status_usuario;
    get diagnostics v_cambio = row_count;

    insert into sap_ordenes as t (orden, aviso, clase_orden, equipo, equipo_sap, texto, ubicacion, status_usuario,
                                  status_sistema, prioridad, pto_trabajo, fecha_entrada, fecha_inicio_real,
                                  fecha_fin_real, fecha_liberacion, autor)
    select * from _ord
    on conflict (orden) do update set
      aviso = excluded.aviso, clase_orden = excluded.clase_orden, equipo = excluded.equipo,
      equipo_sap = excluded.equipo_sap, texto = excluded.texto, ubicacion = excluded.ubicacion,
      status_usuario = excluded.status_usuario, status_sistema = excluded.status_sistema,
      prioridad = excluded.prioridad, pto_trabajo = excluded.pto_trabajo,
      fecha_entrada = excluded.fecha_entrada, fecha_inicio_real = excluded.fecha_inicio_real,
      fecha_fin_real = excluded.fecha_fin_real, fecha_liberacion = excluded.fecha_liberacion,
      autor = excluded.autor, actualizado_en = now()
    where (t.status_usuario, t.status_sistema, t.fecha_fin_real, t.fecha_liberacion, t.ubicacion, t.texto)
          is distinct from
          (excluded.status_usuario, excluded.status_sistema, excluded.fecha_fin_real, excluded.fecha_liberacion, excluded.ubicacion, excluded.texto);
    get diagnostics v_nuevas = row_count;

  elsif p_fuente = 'reservas' then
    create temp table _res on commit drop as
    with raw as (
      select sap_num(r->'Orden')::bigint                   as orden,
             sap_num(r->'Nº pos.reserva traslado')::int    as posicion,
             sap_txt(r->'Centro')                          as centro,
             sap_txt(r->'Material')                        as material,
             sap_txt(r->'Texto breve de material')         as descripcion,
             sap_num(r->'Cantidad necesaria')              as nec,
             sap_num(r->'Cantidad diferencia')             as dif,
             sap_txt(r->'Unidad medida base')              as unidad,
             sap_fecha(r->'Fecha de necesidad')            as fecha_necesidad,
             sap_fecha(r->'Fecha de solicitud')            as fecha_solicitud
      from jsonb_array_elements(p_rows) r
      where sap_num(r->'Orden') is not null and sap_num(r->'Nº pos.reserva traslado') is not null
    )
    select orden, posicion, centro, material, descripcion,
           case when inflada then nec / 1000 else nec end                            as cantidad_necesaria,
           case when inflada then greatest(nec / 1000 - (nec - dif), 0) else dif end as cantidad_pendiente,
           unidad, fecha_necesidad, fecha_solicitud
    from (
      select raw.*,
             (nec >= 100 and (nec - dif) > 0 and abs(nec / 1000 - (nec - dif)) <= nec / 1000 * 0.2) as inflada
      from raw
    ) x;

    insert into sap_reservas_eventos (orden, posicion, pendiente_anterior, pendiente_nuevo, ingesta_id)
    select n.orden, n.posicion, o.cantidad_pendiente, n.cantidad_pendiente, v_ing
    from _res n join sap_reservas_pos o on o.orden = n.orden and o.posicion = n.posicion
    where o.cantidad_pendiente is distinct from n.cantidad_pendiente;
    get diagnostics v_cambio = row_count;

    insert into sap_reservas_pos as t (orden, posicion, centro, material, descripcion, cantidad_necesaria,
                                       cantidad_pendiente, unidad, fecha_necesidad, fecha_solicitud)
    select * from _res
    on conflict (orden, posicion) do update set
      centro = excluded.centro, material = excluded.material, descripcion = excluded.descripcion,
      cantidad_necesaria = excluded.cantidad_necesaria, cantidad_pendiente = excluded.cantidad_pendiente,
      unidad = excluded.unidad, fecha_necesidad = excluded.fecha_necesidad,
      fecha_solicitud = excluded.fecha_solicitud, actualizado_en = now()
    where (t.cantidad_necesaria, t.cantidad_pendiente, t.fecha_necesidad, t.material)
          is distinct from
          (excluded.cantidad_necesaria, excluded.cantidad_pendiente, excluded.fecha_necesidad, excluded.material);
    get diagnostics v_nuevas = row_count;

  elsif p_fuente = 'stock' then
    insert into sap_stock as t (material, centro, a_fecha, de_fecha, descripcion, unidad, stock_inicial,
                                entradas, salidas, stock_cierre, denom_centro, ingesta_id)
    select sap_txt(r->'Material'),
           sap_txt(r->'Centro'),
           sap_fecha(r->'A fecha'),
           sap_fecha(r->'De fecha'),
           sap_txt(r->'Texto breve de material'),
           sap_txt(r->'Unidad medida base'),
           sap_num(r->'Stock inicial'),
           sap_num(r->'Total ctd.entrada mcía.'),
           sap_num(r->'Total cantidades salida'),
           sap_num(r->'Stock de cierre'),
           sap_txt(r->'Denominación del centro'),
           v_ing
    from jsonb_array_elements(p_rows) r
    where sap_txt(r->'Material') is not null and sap_txt(r->'Centro') is not null and sap_fecha(r->'A fecha') is not null
    on conflict (material, centro, a_fecha) do update set
      de_fecha = excluded.de_fecha, descripcion = excluded.descripcion, unidad = excluded.unidad,
      stock_inicial = excluded.stock_inicial, entradas = excluded.entradas, salidas = excluded.salidas,
      stock_cierre = excluded.stock_cierre, denom_centro = excluded.denom_centro, ingesta_id = excluded.ingesta_id
    where (t.stock_cierre, t.entradas, t.salidas) is distinct from (excluded.stock_cierre, excluded.entradas, excluded.salidas);
    get diagnostics v_nuevas = row_count;

  else
    raise exception 'Fuente desconocida: %', p_fuente;
  end if;

  update sap_ingestas
     set filas_leidas = coalesce(filas_leidas, 0) + v_leidas,
         filas_nuevas = coalesce(filas_nuevas, 0) + v_nuevas,
         filas_cambio = coalesce(filas_cambio, 0) + v_cambio
   where id = v_ing;

  return jsonb_build_object('fuente', p_fuente, 'archivo', p_archivo, 'ingesta_id', v_ing,
                            'leidas', v_leidas, 'nuevas_o_actualizadas', v_nuevas,
                            'eventos', v_cambio, 'alertas_nuevas', v_alert);
end $function$;

revoke all on function public.sap_ingestar(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.sap_ingestar(text, text, text, jsonb) to service_role;
