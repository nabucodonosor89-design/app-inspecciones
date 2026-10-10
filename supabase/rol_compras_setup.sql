-- Rol "compras" (10/10/2026): solo accede al Historial de equipos.
-- El frontend lo manda directo a HistorialEquipo (sin menú). Los datos SAP los ve vía las RPC historial_*,
-- que ya permiten a cualquier usuario activo (puede_ver_historial()).
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol = ANY (ARRAY['inspector','supervisor','admin','logistica','compras']));
