-- Configuration du portail captif AFROCONNECT, une configuration par routeur.
CREATE TABLE IF NOT EXISTS captive_portal_settings (
  id BIGSERIAL PRIMARY KEY,
  router_id BIGINT NOT NULL UNIQUE REFERENCES routers(id) ON DELETE CASCADE,
  network_name VARCHAR(80) NOT NULL DEFAULT 'AfroConnect Wi-Fi',
  title VARCHAR(80) NOT NULL DEFAULT 'Bienvenue chez AfroConnect',
  message VARCHAR(180) NOT NULL DEFAULT 'Connectez-vous simplement et profitez d’Internet.',
  logo_url TEXT,
  brand_color CHAR(7) NOT NULL DEFAULT '#087f39',
  purchase_url TEXT,
  whatsapp VARCHAR(24),
  show_qr BOOLEAN NOT NULL DEFAULT TRUE,
  terms VARCHAR(1000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
