-- ============================================================
-- CORRECTIVOS — restringir visibilidad del módulo
-- Aplicado en Supabase el 14/10/2026 (secciones 1, 2 y 3).
-- Idempotente. Restricción de INTERFAZ: la app muestra la tarjeta y el
-- módulo solo si usuarios.ve_correctivos = true. Las vistas v_corr_*,
-- sus permisos/RLS y la sincronización SAP (corr_sync_sap) NO cambian.
--
-- Dar acceso:   update public.usuarios set ve_correctivos = true  where email = 'nombre@itcsa.com.py';
-- Quitar acceso: update public.usuarios set ve_correctivos = false where email = 'nombre@itcsa.com.py';
-- (desde el SQL Editor de Supabase; no hay pantalla de administración)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columna de permiso
-- ------------------------------------------------------------
alter table public.usuarios
  add column if not exists ve_correctivos boolean not null default false;

-- ------------------------------------------------------------
-- 2. Usuarios con acceso inicial (no crea usuarios: si falta alguno, avisa)
-- ------------------------------------------------------------
do $$
declare
  v_email text;
begin
  foreach v_email in array array['david.carballo@itcsa.com.py', 'andres.lopez@itcsa.com.py'] loop
    if exists (select 1 from public.usuarios where email = v_email) then
      update public.usuarios set ve_correctivos = true where email = v_email;
    else
      raise notice 'correctivos_acceso: no existe el usuario %, no se creó nada', v_email;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 3. Bloquear escritura de usuarios desde la app
-- ------------------------------------------------------------
-- Antes: política "autenticados_acceso_total" (ALL, using true) + grants
-- INSERT/UPDATE/DELETE para anon y authenticated → cualquier usuario logueado
-- podía cambiar rol, activo, gestiona_correctivos o ve_correctivos de
-- cualquier fila (incluida la suya).
-- La app nunca escribe en usuarios (solo lee: App.jsx, Login.jsx, CajaChica,
-- Logística, Edge Function del recordatorio). Los cambios se hacen por SQL.
-- Cambio mínimo: quitar los permisos de escritura a anon/authenticated.
-- La lectura (SELECT) no cambia.
revoke insert, update, delete, truncate on table public.usuarios from anon, authenticated;

-- ------------------------------------------------------------
-- 4. David Carballo gestiona tareas de la Reunión (14/10/2026, aplicado)
-- ------------------------------------------------------------
-- Usa el permiso existente de correctivos_reunion_setup.sql (admin o gestiona_correctivos).
update public.usuarios set gestiona_correctivos = true where email = 'david.carballo@itcsa.com.py';
