-- Migration MikroTik AFROCONNECT : exécuter une seule fois sur PostgreSQL.
ALTER TABLE routers
  ADD COLUMN IF NOT EXISTS router_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_uptime TEXT,
  ADD COLUMN IF NOT EXISTS last_identity TEXT;

CREATE TABLE IF NOT EXISTS router_sessions (
  id BIGSERIAL PRIMARY KEY,
  router_id BIGINT NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  username TEXT NOT NULL,
  ip_address INET NOT NULL,
  mac_address TEXT NOT NULL,
  hotspot_server TEXT,
  session_uptime TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  UNIQUE (router_id, session_key)
);

CREATE INDEX IF NOT EXISTS idx_router_sessions_active
  ON router_sessions(router_id, active, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_routers_last_seen
  ON routers(last_seen_at);
