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
const TIMEZONE = process.env.BUSINESS_TIMEZONE || 'Africa/Porto-Novo';

if (!API_KEY || API_KEY.length < 32) {
  console.error('AFROCONNECT_API_KEY doit contenir au moins 32 caractères.');
  process.exit(1);
}

app.use(helmet());
app.use(express.json({ limit: '32kb' }));

function authenticate(req, res, next) {
  const supplied = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(supplied);
  const b = Buffer.from(API_KEY);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

// À appeler uniquement depuis un adaptateur serveur RADIUS/HotSpot de confiance
// après confirmation d'une authentification réussie, jamais depuis le navigateur.
app.post('/api/v1/activations', authenticate, async (req, res) => {
  const { ticketCode, routerCode, activatedAt, sourceEventId } = req.body || {};
  if (typeof ticketCode !== 'string' || !ticketCode.trim() ||
      typeof routerCode !== 'string' || !routerCode.trim()) {
    return res.status(400).json({ error: 'ticketCode_and_routerCode_required' });
  }
  const when = activatedAt ? DateTime.fromISO(activatedAt, { setZone: true }) : DateTime.now();
  if (!when.isValid) return res.status(400).json({ error: 'invalid_activation_time' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT t.id, t.status, t.first_activated_at, r.id AS router_id
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
      return res.json({ counted: false, reason: 'already_counted', firstActivatedAt: ticket.first_activated_at });
    }

    await client.query(
      `UPDATE tickets SET first_activated_at = $2,
         first_activation_router_id = $3, status = 'ACTIVATED'
       WHERE id = $1 AND first_activated_at IS NULL`,
      [ticket.id, when.toUTC().toISO(), ticket.router_id]
    );
    await client.query(
      `INSERT INTO activation_events(ticket_id, router_id, activated_at, source_event_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (ticket_id, event_type) DO NOTHING`,
      [ticket.id, ticket.router_id, when.toUTC().toISO(), sourceEventId || null]
    );
    await client.query('COMMIT');
    return res.status(201).json({ counted: true, firstActivatedAt: when.toUTC().toISO() });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Activation error:', error.message);
    return res.status(500).json({ error: 'activation_processing_failed' });
  } finally {
    client.release();
  }
});

app.get('/api/v1/reports/weekly', authenticate, async (req, res) => {
  const requestedStart = typeof req.query.start === 'string' ? req.query.start : null;
  let start, end;
  if (requestedStart) {
    const local = DateTime.fromISO(requestedStart, { zone: TIMEZONE });
    if (!local.isValid) return res.status(400).json({ error: 'invalid_start_date' });
    const thisMonday = local.startOf('day').minus({ days: local.weekday - 1 });
    start = thisMonday.minus({ weeks: 1 }).toUTC().toISO();
    end = thisMonday.toUTC().toISO();
  } else {
    const now = DateTime.now().setZone(TIMEZONE);
    const thisMonday = now.startOf('day').minus({ days: now.weekday - 1 });
    start = thisMonday.minus({ weeks: 1 }).toUTC().toISO();
    end = thisMonday.toUTC().toISO();
  }

  try {
    const q = await pool.query(
      `SELECT r.id AS reseller_id, r.reseller_code, r.display_name,
              COUNT(t.id)::int AS ticket_count,
              COALESCE(SUM(t.price_minor_snapshot),0)::bigint AS gross_sales_minor,
              FLOOR(COALESCE(SUM(t.price_minor_snapshot),0) * 0.10)::bigint AS commission_minor,
              (COALESCE(SUM(t.price_minor_snapshot),0)
                - FLOOR(COALESCE(SUM(t.price_minor_snapshot),0) * 0.10))::bigint AS remittance_minor
       FROM tickets t
       JOIN resellers r ON r.id = t.reseller_id
       WHERE t.first_activated_at >= $1 AND t.first_activated_at < $2
       GROUP BY r.id, r.reseller_code, r.display_name
       ORDER BY r.display_name`,
      [start, end]
    );
    res.json({ timezone: TIMEZONE, period: { start, end }, commissionRate: 0.10, rows: q.rows });
  } catch (error) {
    console.error('Report error:', error.message);
    res.status(500).json({ error: 'weekly_report_failed' });
  }
});

app.listen(PORT, () => console.log(`AFROCONNECT API listening on ${PORT}; timezone=${TIMEZONE}`));
