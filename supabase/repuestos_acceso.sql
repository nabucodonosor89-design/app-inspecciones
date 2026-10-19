-- ============================================================
-- REPUESTOS — restringir visibilidad del módulo
-- Aplicado en Supabase el 19/10/2026. Idempotente.
-- Restricción de INTERFAZ (igual que ve_correctivos): la app muestra la tarjeta y
-- el módulo solo si usuarios.ve_repuestos = true. Las vistas v_rep_* y sus
-- permisos NO cambian (filtran por usuario activo, ver repuestos_setup.sql).
--
-- Dar acceso:    update public.usuarios set ve_repuestos = true  where email = 'nombre@itcsa.com.py';
-- Quitar acceso: update public.usuarios set ve_repuestos = false where email = 'nombre@itcsa.com.py';
-- (desde el SQL Editor de Supabase; no hay pantalla de administración)
-- ============================================================

-- 1. Columna de permiso
alter table public.usuarios
  add column if not exists ve_repuestos boolean not null default false;

-- 2. Usuarios con acceso inicial (no crea usuarios: si falta alguno, avisa)
do $$
declare
  v_email text;
begin
  foreach v_email in array array['evelyn.gonzalez@itcsa.com.py', 'andres.lopez@itcsa.com.py'] loop
    if exists (select 1 from public.usuarios where email = v_email) then
      update public.usuarios set ve_repuestos = true where email = v_email;
    else
      raise notice 'repuestos_acceso: no existe el usuario %, no se creó nada', v_email;
    end if;
  end loop;
end $$;

-- 3. Nadie puede cambiarse el permiso desde la app.
-- Ya rige desde correctivos_acceso.sql (sección 3): anon y authenticated no tienen
-- INSERT/UPDATE/DELETE sobre usuarios. Se repite por si se aplica en otra base.
revoke insert, update, delete, truncate on table public.usuarios from anon, authenticated;
