-- ============================================================
-- SETUP: Módulo de Caja Chica
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

-- 1. Tabla cajas_especiales
-- ============================================================
CREATE TABLE IF NOT EXISTS cajas_especiales (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monto_otorgado          numeric(12,2) NOT NULL CHECK (monto_otorgado > 0),
  fecha_apertura          date NOT NULL DEFAULT CURRENT_DATE,
  responsable             uuid NOT NULL REFERENCES usuarios(id),
  motivo                  text NOT NULL,
  estado                  text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'rendida')),
  monto_sobrante_devuelto numeric(12,2) DEFAULT NULL,
  fecha_rendicion         date DEFAULT NULL,
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- 2. Tabla caja_chica_movimientos
-- ============================================================
CREATE TABLE IF NOT EXISTS caja_chica_movimientos (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caja_especial_id      uuid DEFAULT NULL REFERENCES cajas_especiales(id) ON DELETE RESTRICT,
  tipo                  text NOT NULL CHECK (tipo IN ('ingreso', 'egreso')),
  fecha                 date NOT NULL DEFAULT CURRENT_DATE,
  nro_comprobante       text,
  proveedor             text,
  concepto              text NOT NULL,
  monto                 numeric(12,2) NOT NULL CHECK (monto > 0),
  foto_comprobante_url  text DEFAULT NULL,
  condicion_iva         text NOT NULL DEFAULT 'exento' CHECK (condicion_iva IN ('exento', 'iva_5', 'iva_10')),
  monto_iva             numeric(12,2) DEFAULT NULL,
  tiene_retencion       boolean NOT NULL DEFAULT false,
  monto_retencion       numeric(12,2) DEFAULT NULL,
  creado_por            uuid NOT NULL REFERENCES usuarios(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- 3. Índices
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_movimientos_caja_especial ON caja_chica_movimientos(caja_especial_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON caja_chica_movimientos(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_cajas_especiales_estado ON cajas_especiales(estado);

-- 4. Row Level Security
-- ============================================================
ALTER TABLE cajas_especiales ENABLE ROW LEVEL SECURITY;
ALTER TABLE caja_chica_movimientos ENABLE ROW LEVEL SECURITY;

-- Política: cualquier usuario autenticado puede leer todo
CREATE POLICY "Leer cajas_especiales" ON cajas_especiales
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Leer movimientos" ON caja_chica_movimientos
  FOR SELECT TO authenticated USING (true);

-- Política: el responsable/creado_por debe coincidir con el usuario autenticado (lookup por email)
CREATE POLICY "Insertar cajas_especiales" ON cajas_especiales
  FOR INSERT TO authenticated
  WITH CHECK (responsable = (
    SELECT id FROM usuarios WHERE email = auth.email() LIMIT 1
  ));

CREATE POLICY "Insertar movimientos" ON caja_chica_movimientos
  FOR INSERT TO authenticated
  WITH CHECK (creado_por = (
    SELECT id FROM usuarios WHERE email = auth.email() LIMIT 1
  ));

-- Política: cualquier usuario autenticado puede actualizar cajas_especiales
-- (para rendir cajas, actualizar estado, monto_sobrante_devuelto, fecha_rendicion)
CREATE POLICY "Actualizar cajas_especiales" ON cajas_especiales
  FOR UPDATE TO authenticated USING (true);

-- Nota: movimientos NO tienen política de UPDATE ni DELETE — trazabilidad total.
