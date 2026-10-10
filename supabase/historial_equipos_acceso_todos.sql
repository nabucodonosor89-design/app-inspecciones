-- Historial de equipos: abrir a todos los roles (10/10/2026) — PENDIENTE DE APLICAR en el SQL Editor de Supabase.
-- Antes: solo rol = 'admin'. Ahora: cualquier usuario activo de la tabla usuarios (inspector, supervisor, admin, logistica).
-- Solo cambia esta función; las 4 RPC historial_* la usan y no se tocan.
create or replace function public.puede_ver_historial() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuarios where email = auth.email() and activo = true)
$$;
