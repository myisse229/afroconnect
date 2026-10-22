-- Registre des paiements AFROCONNECT.
-- Migration additive : ne modifie ni ne supprime les tickets existants.
-- À exécuter une seule fois sur la base PostgreSQL de Render avant le déploiement du code qui l'utilisera.

BEGIN;

CREATE TABLE IF NOT EXISTS payment_transactions (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL CHECK (
    provider IN ('FEDAPAY', 'CASH', 'MOBILE_MONEY_MANUAL', 'BANK_TRANSFER', 'OTHER')
  ),
  provider_transaction_id TEXT,
  idempotency_key TEXT,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
  ticket_code_snapshot TEXT,
  reseller_id BIGINT REFERENCES resellers(id) ON DELETE SET NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL DEFAULT 'XOF',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED', 'REFUNDED')
  ),
  payment_channel TEXT,
  payer_reference TEXT,
  source TEXT NOT NULL CHECK (source IN ('FEDAPAY_WEBHOOK', 'ADMIN_MANUAL', 'SYSTEM_IMPORT')),
  notes TEXT,
  provider_payload JSONB,
  recorded_by TEXT,
  paid_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'CONFIRMED' OR confirmed_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_provider_transaction
  ON payment_transactions(provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_idempotency
  ON payment_transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_transactions_created
  ON payment_transactions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_status_paid
  ON payment_transactions(status, paid_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_ticket
  ON payment_transactions(ticket_id);

CREATE TABLE IF NOT EXISTS payment_transaction_events (
  id BIGSERIAL PRIMARY KEY,
  payment_transaction_id BIGINT NOT NULL
    REFERENCES payment_transactions(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_payload JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_key)
);

CREATE INDEX IF NOT EXISTS idx_payment_events_transaction
  ON payment_transaction_events(payment_transaction_id, received_at DESC);

COMMIT;
