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
    !validPositiveInt(quantity, 500)
  ) {
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
       FROM resellers
       WHERE id = $1 AND active = TRUE`,
      [resellerId]
    );

    const planResult = await client.query(
      `SELECT id, plan_code, name, price_minor, currency
       FROM plans
       WHERE id = $1`,
      [planId]
    );

    if (!resellerResult.rowCount || !planResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'reseller_or_plan_not_found'
      });
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
    try {
      await client.query('ROLLBACK');
    } catch {
      // La transaction peut déjà avoir été interrompue.
    }

    console.error('Ticket batch error:', error.message);
    res.status(500).json({ error: 'ticket_batch_failed' });
  } finally {
    client.release();
  }
});

// Enregistrement de la première activation d'un ticket.
app.post('/api/v1/activations', authenticateApiKey, async (req, res) => {
  const {
    ticketCode,
    routerCode,
    activatedAt,
    sourceEventId
  } = req.body || {};

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
      return res.status(404).json({
        error: 'ticket_or_router_not_found'
      });
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
    try {
      await client.query('ROLLBACK');
    } catch {
      // La transaction peut déjà avoir été interrompue.
    }

    console.error('Activation error:', error.message);
    return res.status(500).json({
      error: 'activation_processing_failed'
    });
  } finally {
    client.release();
  }
});

// Synthèse du tableau de bord : uniquement les tickets activés sont comptés.
// Le système ne stocke pas encore de transactions de paiement ni de sessions en direct.
app.get('/api/v1/admin/reports/dashboard', authenticateAdmin, async (_req, res) => {
  try {
    const totalsResult = await pool.query(
      `WITH bounds AS (
         SELECT
           (date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1) AS day_start,
           (date_trunc('week', now() AT TIME ZONE $1) AT TIME ZONE $1) AS week_start,
           (date_trunc('month', now() AT TIME ZONE $1) AT TIME ZONE $1) AS month_start,
           (date_trunc('year', now() AT TIME ZONE $1) AT TIME ZONE $1) AS year_start
       )
       SELECT
         COUNT(t.id) FILTER (WHERE t.first_activated_at >= b.day_start)::int AS today_count,
         COALESCE(SUM(t.price_minor_snapshot) FILTER (WHERE t.first_activated_at >= b.day_start), 0)::bigint AS today_amount,
         COUNT(t.id) FILTER (WHERE t.first_activated_at >= b.week_start)::int AS week_count,
         COALESCE(SUM(t.price_minor_snapshot) FILTER (WHERE t.first_activated_at >= b.week_start), 0)::bigint AS week_amount,
         COUNT(t.id) FILTER (WHERE t.first_activated_at >= b.month_start)::int AS month_count,
         COALESCE(SUM(t.price_minor_snapshot) FILTER (WHERE t.first_activated_at >= b.month_start), 0)::bigint AS month_amount,
         COUNT(t.id) FILTER (WHERE t.first_activated_at >= b.year_start)::int AS year_count,
         COALESCE(SUM(t.price_minor_snapshot) FILTER (WHERE t.first_activated_at >= b.year_start), 0)::bigint AS year_amount,
         COUNT(t.id)::int AS total_count,
         COALESCE(SUM(t.price_minor_snapshot), 0)::bigint AS total_amount
       FROM tickets t
       CROSS JOIN bounds b
       WHERE t.status = 'ACTIVATED' AND t.first_activated_at IS NOT NULL`,
      [TIMEZONE]
    );

    const recentResult = await pool.query(
      `SELECT t.ticket_code, t.first_activated_at AS occurred_at,
              t.price_minor_snapshot AS amount,
              t.currency_snapshot AS currency,
              r.display_name AS reseller_name,
              p.name AS plan_name,
              rt.display_name AS router_name
       FROM tickets t
       JOIN resellers r ON r.id = t.reseller_id
       JOIN plans p ON p.id = t.plan_id
       LEFT JOIN routers rt ON rt.id = t.first_activation_router_id
       WHERE t.status = 'ACTIVATED' AND t.first_activated_at IS NOT NULL
       ORDER BY t.first_activated_at DESC
       LIMIT 15`
    );

    const row = totalsResult.rows[0];
    const period = (count, amount) => ({ count: Number(row[count] || 0), amount: Number(row[amount] || 0) });
    res.json({
      timezone: TIMEZONE,
      generatedAt: new Date().toISOString(),
      summary: {
        today: period('today_count', 'today_amount'),
        week: period('week_count', 'week_amount'),
        month: period('month_count', 'month_amount'),
        year: period('year_count', 'year_amount'),
        total: period('total_count', 'total_amount')
      },
      recentActivations: recentResult.rows.map(item => ({
        ticketCode: item.ticket_code,
        occurredAt: item.occurred_at,
        amount: Number(item.amount || 0),
        currency: String(item.currency || 'XOF').trim(),
        resellerName: item.reseller_name,
        planName: item.plan_name,
        routerName: item.router_name
      }))
    });
  } catch (error) {
    console.error('Dashboard report error:', error.message);
    res.status(500).json({ error: 'dashboard_report_failed' });
  }
});

// Rapport des activations de la semaine précédente.
async function weeklyReport(startDate) {
  let local;

  if (startDate) {
    local = DateTime.fromISO(startDate, { zone: TIMEZONE });

    if (!local.isValid) {
      throw new Error('invalid_start_date');
    }
  } else {
    local = DateTime.now().setZone(TIMEZONE);
  }

  const thisMonday = local.startOf('day')
    .minus({ days: local.weekday - 1 });

  const start = thisMonday.minus({ weeks: 1 }).toUTC().toISO();
  const end = thisMonday.toUTC().toISO();

  const result = await pool.query(
    `SELECT r.id AS reseller_id,
            r.reseller_code,
            r.display_name,
            COUNT(t.id)::int AS ticket_count,
            COALESCE(SUM(t.price_minor_snapshot), 0)::bigint
              AS gross_sales_minor,
            FLOOR(
              COALESCE(SUM(t.price_minor_snapshot), 0) * 0.10
            )::bigint AS commission_minor,
            (
              COALESCE(SUM(t.price_minor_snapshot), 0)
              - FLOOR(
                  COALESCE(SUM(t.price_minor_snapshot), 0) * 0.10
                )
            )::bigint AS remittance_minor
     FROM tickets t
     JOIN resellers r ON r.id = t.reseller_id
     WHERE t.first_activated_at >= $1
       AND t.first_activated_at < $2
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

app.get(
  '/api/v1/admin/reports/weekly',
  authenticateAdmin,
  async (req, res) => {
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
  }
);

app.listen(PORT, () => {
  console.log(
    `AFROCONNECT API listening on ${PORT}; timezone=${TIMEZONE}`
  );
});
