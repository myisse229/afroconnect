CREATE TABLE IF NOT EXISTS resellers (
  id BIGSERIAL PRIMARY KEY,
  reseller_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  whatsapp_e164 TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS routers (
  id BIGSERIAL PRIMARY KEY,
  router_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'MikroTik',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
  id BIGSERIAL PRIMARY KEY,
  plan_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price_minor BIGINT NOT NULL CHECK (price_minor >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'XOF',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  id BIGSERIAL PRIMARY KEY,
  ticket_code TEXT NOT NULL UNIQUE,
  reseller_id BIGINT NOT NULL REFERENCES resellers(id),
  plan_id BIGINT NOT NULL REFERENCES plans(id),
  price_minor_snapshot BIGINT NOT NULL CHECK (price_minor_snapshot >= 0),
  currency_snapshot CHAR(3) NOT NULL DEFAULT 'XOF',
  router_id BIGINT REFERENCES routers(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_activated_at TIMESTAMPTZ,
  first_activation_router_id BIGINT REFERENCES routers(id),
  status TEXT NOT NULL DEFAULT 'STOCK' CHECK (status IN ('STOCK','ACTIVATED','REVOKED'))
);

CREATE TABLE IF NOT EXISTS activation_events (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id),
  router_id BIGINT REFERENCES routers(id),
  event_type TEXT NOT NULL DEFAULT 'FIRST_ACTIVATION' CHECK (event_type = 'FIRST_ACTIVATION'),
  activated_at TIMESTAMPTZ NOT NULL,
  source_event_id TEXT UNIQUE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_tickets_first_activation ON tickets(first_activated_at);
CREATE INDEX IF NOT EXISTS idx_tickets_reseller ON tickets(reseller_id);

CREATE TABLE IF NOT EXISTS weekly_settlements (
  id BIGSERIAL PRIMARY KEY,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'XOF',
  gross_sales_minor BIGINT NOT NULL DEFAULT 0,
  commission_minor BIGINT NOT NULL DEFAULT 0,
  remittance_minor BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PREPARED' CHECK (status IN ('PREPARED','REVIEWED','PAID')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period_start, period_end, timezone)
);

CREATE TABLE IF NOT EXISTS weekly_settlement_lines (
  id BIGSERIAL PRIMARY KEY,
  settlement_id BIGINT NOT NULL REFERENCES weekly_settlements(id) ON DELETE CASCADE,
  reseller_id BIGINT NOT NULL REFERENCES resellers(id),
  ticket_count INTEGER NOT NULL,
  gross_sales_minor BIGINT NOT NULL,
  commission_minor BIGINT NOT NULL,
  remittance_minor BIGINT NOT NULL,
  UNIQUE (settlement_id, reseller_id)
);
