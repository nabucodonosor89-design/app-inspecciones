-- ============================================================
-- SETUP: Módulo de Logística de Fletes
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

-- 1. Tabla pedidos_logistica
-- Solicitudes de movimiento de material hacia una obra
-- ============================================================
CREATE TABLE IF NOT EXISTS pedidos_logistica (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id        uuid NOT NULL REFERENCES obras(id),
  origen         text NOT NULL,
  material       text NOT NULL,
  cantidad_total numeric(12,3) NOT NULL CHECK (cantidad_total > 0),
  unidad         text NOT NULL DEFAULT 'unidades',
  notas          text,
  estado         text NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN ('pendiente','en_proceso','completado','cancelado')),
  creado_por     uuid NOT NULL REFERENCES usuarios(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- 2. Tabla fletes
-- Viajes concretos asociados a un pedido
-- ============================================================
CREATE TABLE IF NOT EXISTS fletes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id        uuid NOT NULL REFERENCES pedidos_logistica(id) ON DELETE RESTRICT,
  equipo_id        uuid REFERENCES equipos(id),
  operador_id      uuid REFERENCES operadores(id),
  cantidad         numeric(12,3) NOT NULL CHECK (cantidad > 0),
  estado           text NOT NULL DEFAULT 'pendiente'
                     CHECK (estado IN ('pendiente','asignado','en_transito','entregado','cancelado')),
  fecha_asignacion timestamptz,
  fecha_salida     timestamptz,
  fecha_entrega    timestamptz,
  km_recorridos    numeric(10,2),
  notas            text,
  creado_por       uuid NOT NULL REFERENCES usuarios(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- 3. Tabla fletes_auditoria
-- Historial de cada cambio de estado — nunca se borra
-- ============================================================
CREATE TABLE IF NOT EXISTS fletes_auditoria (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flete_id        uuid NOT NULL REFERENCES fletes(id) ON DELETE CASCADE,
  estado_anterior text,
  estado_nuevo    text NOT NULL,
  notas           text,
  usuario_id      uuid NOT NULL REFERENCES usuarios(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 4. Índices
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_pedidos_logistica_obra_id  ON pedidos_logistica(obra_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_logistica_estado   ON pedidos_logistica(estado);
CREATE INDEX IF NOT EXISTS idx_fletes_pedido_id           ON fletes(pedido_id);
CREATE INDEX IF NOT EXISTS idx_fletes_equipo_id           ON fletes(equipo_id);
CREATE INDEX IF NOT EXISTS idx_fletes_estado              ON fletes(estado);
CREATE INDEX IF NOT EXISTS idx_fletes_auditoria_flete_id  ON fletes_auditoria(flete_id);

-- 5. Row Level Security
-- ============================================================
ALTER TABLE pedidos_logistica ENABLE ROW LEVEL SECURITY;
ALTER TABLE fletes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE fletes_auditoria  ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier usuario autenticado
CREATE POLICY "Leer pedidos_logistica" ON pedidos_logistica
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Leer fletes" ON fletes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Leer fletes_auditoria" ON fletes_auditoria
  FOR SELECT TO authenticated USING (true);

-- Inserción: el creado_por debe ser el usuario autenticado
CREATE POLICY "Insertar pedidos_logistica" ON pedidos_logistica
  FOR INSERT TO authenticated
  WITH CHECK (creado_por = (
    SELECT id FROM usuarios WHERE email = auth.email() LIMIT 1
  ));

CREATE POLICY "Insertar fletes" ON fletes
  FOR INSERT TO authenticated
  WITH CHECK (creado_por = (
    SELECT id FROM usuarios WHERE email = auth.email() LIMIT 1
  ));

CREATE POLICY "Insertar fletes_auditoria" ON fletes_auditoria
  FOR INSERT TO authenticated
  WITH CHECK (usuario_id = (
    SELECT id FROM usuarios WHERE email = auth.email() LIMIT 1
  ));

-- Actualización: cualquier usuario autenticado
-- (fletes_auditoria no tiene UPDATE ni DELETE — trazabilidad total)
CREATE POLICY "Actualizar pedidos_logistica" ON pedidos_logistica
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Actualizar fletes" ON fletes
  FOR UPDATE TO authenticated USING (true);
