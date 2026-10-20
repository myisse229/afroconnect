
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

if (!API_KEY || API_KEY.length < 32 ||
    !ADMIN_USERNAME || !ADMIN_PASSWORD ||
    !SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('Variables de sécurité manquantes ou trop courtes.');
  process.exit(1);
}

app.use(helmet());
app.use(express.json({ limit: '32kb' }));

const allowedOrigins = new Set([
  'https://myisse229.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
]);

app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
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
    if (payload.exp <= Math.floor(Date.now() / 1000) ||
        payload.sub !== ADMIN_USERNAME) {
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

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

// Authentification administrateur : aucun secret n'est envoyé au navigateur
// sauf le jeton de session temporaire.
app.post('/api/v1/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!safeEqual(username, ADMIN_USERNAME) ||
      !safeEqual(password, ADMIN_PASSWORD)) {
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

// Revendeurs
app.get('/api/v1/resellers', authenticateAdmin, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, reseller_code, display_name, whatsapp_e164, active, created_at
       FROM resellers ORDER BY display_name`
    );
    res.json({ rows: result.rows });
  } catch (error) {
    console.error('Resellers list error:', error.message);
    res.status(500).json({ error: 'resellers_list_failed' });
  }
});

app.post('/api/v1/resellers', authenticateAdmin, async (req, res) => {
  const { code, name, whatsapp } = req.body || {};
  if (!validText(code, 40) || !validText(name, 120) ||
      (whatsapp != null && !validText(whatsapp, 30))) {
    return res.status(400).json({ error: 'invalid_reseller_fields' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO resellers (reseller_code, display_name, whatsapp_e164)
       VALUES ($1, $2, $3)
       RETURNING id, reseller_code, display_name, whatsapp_e164, active`,
      [code.trim().toUpperCase(), name.trim(), whatsapp?.trim() || null]
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

// Forfaits : le schéma actuel stocke code, nom, prix et devise.
app.get('/api/v1/plans', authenticateAdmin, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, plan_code, name, price_minor, currency, created_at
       FROM plans ORDER BY price_minor, name`
    );
    res.json({ rows: result.rows });
  } catch (error) {
    console.error('Plans list error:', error.message);
    res.status(500).json({ error: 'plans_list_failed' });
  }
});

app.post('/api/v1/plans', authenticateAdmin, async (req, res) => {
  const { code, name, priceMinor, currency = 'XOF' } = req.body || {};
  if (!validText(code, 40) || !validText(name, 120) ||
      !validPositiveInt(priceMinor) ||
      typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
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

// Génération d'un lot de tickets persistés dans PostgreSQL.
app.post('/api/v1/tickets/batches', authenticateAdmin, async (req, res) => {
  const { resellerId, planId, quantity } = req.body || {};
  if (!validPositiveInt(resellerId) ||
      !validPositiveInt(planId) ||
      !validPositiveInt(quantity, 500)) {
    return res.status(400).json({
      error: 'resellerId_planId_quantity_required',
      maxQuantity: 500
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const resellerResult = await client.query(
      `SELECT id, reseller_code, display_name
       FROM resellers WHERE id = $1 AND active = TRUE`,
      [resellerId]
    );
    const planResult = await client.query(
      `SELECT id, plan_code, name, price_minor, currency
       FROM plans WHERE id = $1`,
      [planId]
    );

    if (!resellerResult.rowCount || !planResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'reseller_or_plan_not_found' });
    }

    const reseller = resellerResult.rows[0];
    const plan = planResult.rows[0];
    const tickets = [];

    for (let i = 0; i < quantity; i++) {
      const random = crypto.randomBytes(5).toString('hex').toUpperCase();
      const ticketCode = `AC-${reseller.reseller_code}-${random}`;

      const inserted = await client.query(
        `INSERT INTO tickets
          (ticket_code, reseller_id, plan_id, price_minor_snapshot,
           currency_snapshot, status)
         VALUES ($1, $2, $3, $4, $5, 'STOCK')
         RETURNING id, ticket_code, status, generated_at`,
        [
          ticketCode,
          reseller.id,
          plan.id,
          plan.price_minor,
          plan.currency
        ]
      );
      tickets.push(inserted.rows[0]);
    }

    await client.query('COMMIT');
    res.status(201).json({
      reseller: {
        id: reseller.id,
        code: reseller.reseller_code,
        name: reseller.display_name
      },
      plan: {
        id: plan.id,
        code: plan.plan_code,
        name: plan.name,
        priceMinor: plan.price_minor,
        currency: plan.currency
      },
      quantity: tickets.length,
      tickets
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ticket batch error:', error.message);
    res.status(500).json({ error: 'ticket_batch_failed' });
  } finally {
    client.release();
  }
});

// Activations : appel réservé à un adaptateur serveur RADIUS/HotSpot fiable.
app.post('/api/v1/activations', authenticateApiKey, async (req, res) => {
  const { ticketCode, routerCode, activatedAt, sourceEventId } = req.body || {};
  if (!validText(ticketCode, 120) || !validText(routerCode, 120)) {
    return res.status(400).json({
      error: 'ticketCode_and_routerCode_required'
    });
  }

  const when = activatedAt
    ? DateTime.fromISO(activatedAt, { setZone: true })
    : DateTime.now();

  if (!when.isValid) {
    return res.status(400).json({ error: 'invalid_activation_time' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT t.id, t.status, t.first_activated_at,
              r.id AS activated_router_id
       FROM tickets t
       JOIN routers r ON r.router_code = $2 AND r.active = TRUE
       WHERE t.ticket_code = $1
       FOR UPDATE OF t`,
      [ticketCode.trim(), routerCode.trim()]
    );

    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'ticket_or_router_not_found' });
    }

    const ticket = result.rows[0];

    if (ticket.status === 'REVOKED') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'ticket_revoked' });
    }

    if (ticket.first_activated_at) {
      await client.query('COMMIT');
      return res.json({
        counted: false,
        reason: 'already_counted',
        firstActivatedAt: ticket.first_activated_at
      });
    }

    const activatedAtUtc = when.toUTC().toISO();

    await client.query(
      `UPDATE tickets
       SET first_activated_at = $2,
           first_activation_router_id = $3,
           status = 'ACTIVATED'
       WHERE id = $1 AND first_activated_at IS NULL`,
      [ticket.id, activatedAtUtc, ticket.activated_router_id]
    );

    await client.query(
      `INSERT INTO activation_events
        (ticket_id, router_id, activated_at, source_event_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (ticket_id, event_type) DO NOTHING`,
      [
        ticket.id,
        ticket.activated_router_id,
        activatedAtUtc,
        validText(sourceEventId, 200) ? sourceEventId : null
      ]
    );

    await client.query('COMMIT');
    return res.status(201).json({
      counted: true,
      firstActivatedAt: activatedAtUtc
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Activation error:', error.message);
    return res.status(500).json({
      error: 'activation_processing_failed'
    });
  } finally {
    client.release();
  }
});

async function weeklyReport(startDate) {
  let local;
  if (startDate) {
    local = DateTime.fromISO(startDate, { zone: TIMEZONE });
    if (!local.isValid) throw new Error('invalid_start_date');
  } else {
    local = DateTime.now().setZone(TIMEZONE);
  }

  const thisMonday = local.startOf('day')
    .minus({ days: local.weekday - 1 });
  const start = thisMonday.minus({ weeks: 1 }).toUTC().toISO();
  const end = thisMonday.toUTC().toISO();

  const result = await pool.query(
    `SELECT r.id AS reseller_id, r.reseller_code, r.display_name,
            COUNT(t.id)::int AS ticket_count,
            COALESCE(SUM(t.price_minor_snapshot), 0)::bigint
              AS gross_sales_minor,
            FLOOR(COALESCE(SUM(t.price_minor_snapshot), 0) * 0.10)::bigint
              AS commission_minor,
            (COALESCE(SUM(t.price_minor_snapshot), 0)
              - FLOOR(COALESCE(SUM(t.price_minor_snapshot), 0) * 0.10)
            )::bigint AS remittance_minor
     FROM tickets t
     JOIN resellers r ON r.id = t.reseller_id
     WHERE t.first_activated_at >= $1 AND t.first_activated_at < $2
     GROUP BY r.id, r.reseller_code, r.display_name
     ORDER BY r.display_name`,
    [start, end]
  );

  return {
    timezone: TIMEZONE,
    period: { start, end },
    commissionRate: 0.10,
    rows: result.rows
  };
}

app.get('/api/v1/reports/weekly', authenticateApiKey, async (req, res) => {
  try {
    res.json(await weeklyReport(
      typeof req.query.start === 'string' ? req.query.start : null
    ));
  } catch (error) {
    if (error.message === 'invalid_start_date') {
      return res.status(400).json({ error: 'invalid_start_date' });
    }
    console.error('Weekly report error:', error.message);
    res.status(500).json({ error: 'weekly_report_failed' });
  }
});

app.get('/api/v1/admin/reports/weekly', authenticateAdmin, async (req, res) => {
  try {
    res.json(await weeklyReport(
      typeof req.query.start === 'string' ? req.query.start : null
    ));
  } catch (error) {
    if (error.message === 'invalid_start_date') {
      return res.status(400).json({ error: 'invalid_start_date' });
    }
    console.error('Admin weekly report error:', error.message);
    res.status(500).json({ error: 'weekly_report_failed' });
  }
});

app.listen(PORT, () => {
  console.log(`AFROCONNECT API listening on ${PORT}; timezone=${TIMEZONE}`);
});
