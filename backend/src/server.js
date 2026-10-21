import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import crypto from 'node:crypto';
import pg from 'pg';
import { DateTime } from 'luxon';

const { Pool } = pg;
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PORT = Number(process.env.PORT || 8080);
const API_KEY = process.env.AFROCONNECT_API_KEY;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const TIMEZONE = process.env.BUSINESS_TIMEZONE || 'Africa/Porto-Novo';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

if (
  !API_KEY || API_KEY.length < 32 ||
  !ADMIN_USERNAME || !ADMIN_PASSWORD ||
  !SESSION_SECRET || SESSION_SECRET.length < 32
) {
  console.error('Variables de sécurité manquantes ou trop courtes.');
  process.exit(1);
}

app.use(helmet());
app.use(express.json({ limit: '32kb' }));

// Domaines autorisés à appeler l'API depuis le navigateur.
const allowedOrigins = new Set([
  'https://myisse229.github.io',
  'https://afroconnectworld.com',
  'https://www.afroconnectworld.com',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
]);

app.use((req, res, next) => {
  const origin = req.get('origin');

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authenticateApiKey(req, res, next) {
  const supplied = (req.get('authorization') || '')
    .replace(/^Bearer\s+/i, '');

  if (!safeEqual(supplied, API_KEY)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  next();
}

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(data)
    .digest('base64url');

  return `${data}.${signature}`;
}

function authenticateAdmin(req, res, next) {
  const token = (req.get('authorization') || '')
    .replace(/^Bearer\s+/i, '');
  const parts = token.split('.');

  if (parts.length !== 2) {
    return res.status(401).json({ error: 'admin_auth_required' });
  }

  const [data, signature] = parts;
  const expected = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(data)
    .digest('base64url');

  if (!safeEqual(signature, expected)) {
    return res.status(401).json({ error: 'invalid_session' });
  }

  try {
    const payload = JSON.parse(
      Buffer.from(data, 'base64url').toString('utf8')
    );

    if (
      payload.exp <= Math.floor(Date.now() / 1000) ||
      payload.sub !== ADMIN_USERNAME
    ) {
      return res.status(401).json({ error: 'session_expired' });
    }

    req.admin = { username: payload.sub };
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_session' });
  }
}

function validText(value, max = 100) {
  return typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim().length <= max;
}

function validPositiveInt(value, max = 1000000000) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 && n <= max;
}

// Vérification de l'API et de la base de données.
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch {
    res.status(503).json({
      status: 'error',
      database: 'unavailable'
    });
  }
});

// Connexion administrateur.
app.post('/api/v1/auth/login', (req, res) => {
  const { username, password } = req.body || {};

  if (
    !safeEqual(username, ADMIN_USERNAME) ||
    !safeEqual(password, ADMIN_PASSWORD)
  ) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const now = Math.floor(Date.now() / 1000);
  const token = sign({
    sub: ADMIN_USERNAME,
    iat: now,
    exp: now + SESSION_TTL_SECONDS
  });

  res.json({
    token,
    tokenType: 'Bearer',
    expiresIn: SESSION_TTL_SECONDS
  });
});

// Liste des revendeurs.
app.get('/api/v1/resellers', authenticateAdmin, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, reseller_code, display_name, whatsapp_e164,
              active, created_at
       FROM resellers
       ORDER BY display_name`
    );

    res.json({ rows: result.rows });
  } catch (error) {
    console.error('Resellers list error:', error.message);
    res.status(500).json({ error: 'resellers_list_failed' });
  }
});

// Création d'un revendeur.
app.post('/api/v1/resellers', authenticateAdmin, async (req, res) => {
  const { code, name, whatsapp } = req.body || {};

  if (
    !validText(code, 40) ||
    !validText(name, 120) ||
    (whatsapp != null && !validText(whatsapp, 30))
  ) {
    return res.status(400).json({ error: 'invalid_reseller_fields' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO resellers
         (reseller_code, display_name, whatsapp_e164)
       VALUES ($1, $2, $3)
       RETURNING id, reseller_code, display_name, whatsapp_e164, active`,
      [
        code.trim().toUpperCase(),
        name.trim(),
        whatsapp?.trim() || null
      ]
    );

    res.status(201).json({ reseller: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'reseller_code_exists' });
    }

    console.error('Reseller create error:', error.message);
    res.status(500).json({ error: 'reseller_create_failed' });
  }
});

// Liste des forfaits.
app.get('/api/v1/plans', authenticateAdmin, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, plan_code, name, price_minor, currency, created_at
       FROM plans
       ORDER BY price_minor, name`
    );

    res.json({ rows: result.rows });
  } catch (error) {
    console.error('Plans list error:', error.message);
    res.status(500).json({ error: 'plans_list_failed' });
  }
});

// Création d'un forfait.
app.post('/api/v1/plans', authenticateAdmin, async (req, res) => {
  const { code, name, priceMinor, currency = 'XOF' } = req.body || {};

  if (
    !validText(code, 40) ||
    !validText(name, 120) ||
    !validPositiveInt(priceMinor) ||
    typeof currency !== 'string' ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    return res.status(400).json({ error: 'invalid_plan_fields' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO plans (plan_code, name, price_minor, currency)
       VALUES ($1, $2, $3, $4)
       RETURNING id, plan_code, name, price_minor, currency`,
      [code.trim().toUpperCase(), name.trim(), priceMinor, currency]
    );

    res.status(201).json({ plan: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'plan_code_exists' });
    }

    console.error('Plan create error:', error.message);
    res.status(500).json({ error: 'plan_create_failed' });
  }
});

// Liste des tickets enregistrés dans PostgreSQL pour le gestionnaire.
app.get('/api/v1/tickets', authenticateAdmin, async (req, res) => {
  const limitValue = Number(req.query.limit || 500);
  const limit = Number.isInteger(limitValue)
    ? Math.min(Math.max(limitValue, 1), 2000)
    : 500;

  try {
    const result = await pool.query(
      `SELECT t.id, t.ticket_code, t.status, t.generated_at,
              t.first_activated_at, t.price_minor_snapshot,
              t.currency_snapshot,
              r.id AS reseller_id,
              r.reseller_code,
              r.display_name AS reseller_name,
              p.id AS plan_id,
              p.plan_code,
              p.name AS plan_name
       FROM tickets t
       JOIN resellers r ON r.id = t.reseller_id
       JOIN plans p ON p.id = t.plan_id
       ORDER BY t.generated_at DESC, t.id DESC
       LIMIT $1`,
      [limit]
    );

    res.json({ rows: result.rows });
  } catch (error) {
    console.error('Tickets list error:', error.message);
    res.status(500).json({ error: 'tickets_list_failed' });
  }
});

// Création d'un lot de tickets enregistrés dans PostgreSQL.
app.post('/api/v1/tickets/batches', authenticateAdmin, async (req, res) => {
  const { resellerId, planId, quantity } = req.body || {};

  if (
    !validPositiveInt(resellerId) ||
    !validPositiveInt(planId) ||
