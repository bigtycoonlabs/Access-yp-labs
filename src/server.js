require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 3000;

const requiredConfig = ['DATABASE_URL', 'JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'CLIENT_URL'];
const missingConfig = requiredConfig.filter((k) => !process.env[k]);
const weakSecrets = ['JWT_SECRET', 'REFRESH_TOKEN_SECRET'].filter((k) => process.env[k] && process.env[k].length < 64);
if (process.env.NODE_ENV === 'production' && (missingConfig.length || weakSecrets.length)) {
  console.error('YP Labs configuration incomplete.', { missing: missingConfig, weakSecrets });
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Stripe webhook needs the raw body for signature verification — mount before json.
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res, next) => {
  Promise.resolve(require('./routes/webhooks').stripeWebhook(req, res)).catch(next);
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please try again shortly.' },
});
app.use('/api/', apiLimiter);
// Server-rendered pages: Clay's Desk articles (each at its own address, with real HTML for search
// engines and link previews) and a generated sitemap. Mounted BEFORE the static handler so the
// generated sitemap wins over the static file.
app.use(require('./routes/deskPages'));

// Serve the site, but never let a browser keep running STALE app code. HTML and JS are served
// with no-cache, which does NOT mean "download every time" — the browser still revalidates with
// its ETag and gets a cheap 304 when nothing changed. Without this, a browser can hold on to an
// old script indefinitely, so a shipped fix silently never reaches the person: exactly what
// happened when a corrected chat/build routing kept behaving the old way in a live session. This
// matters even more for a screen-reader user, for whom "just hard-refresh" is not a simple move.
// Fingerprinted assets (images, fonts, CSS) keep normal caching.
app.use(express.static(path.join(__dirname, '../public'), {
  index: false,
  etag: true,
  setHeaders(res, filePath) {
    if (/\.(html|js)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  },
}));

// The Dream Market / Clay API surface
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/profiles',      require('./routes/profiles'));
 app.use('/api/preferences',   require('./routes/preferences'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/concepts',      require('./routes/concepts'));
app.use('/api/clay',          require('./routes/clay'));
app.use('/api/assets',        require('./routes/assets'));
app.use('/api/sellers',       require('./routes/sellers'));
app.use('/api/store',         require('./routes/store'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/maintenance',   require('./routes/maintenance'));
app.use('/api/listings',      require('./routes/listings'));
app.use('/api/waitlist',      require('./routes/waitlist'));
app.use('/api/launch',        require('./routes/launch'));
app.use('/api/site',          require('./routes/sites'));
app.use('/api/desk',          require('./routes/desk'));
app.use('/api',               require('./routes/visitor'));
app.use('/api/bids',          require('./routes/bids'));
app.use('/api/watches',       require('./routes/watches'));
app.use('/api/orders',        require('./routes/orders'));
app.use('/api/movers',        require('./routes/movers'));
app.use('/api/consultants',   require('./routes/consultants'));
app.use('/api/moderation',    require('./routes/moderation'));
app.use('/api/reports',       require('./routes/reports'));

app.get('/api/health', (req, res) => res.json({
  status: 'ok', service: 'yp-labs', platform: 'access-yp-labs', marketplace: 'the-dreamhold',
  build: 'clay-resilient-2026-07-30',
  clay: {
    configured: !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY),
    provider: process.env.OPENAI_API_KEY ? 'openai' : (process.env.ANTHROPIC_API_KEY ? 'anthropic' : null),
  },
  email_configured: !!process.env.RESEND_API_KEY,
  auth_configured: !!(process.env.JWT_SECRET && process.env.REFRESH_TOKEN_SECRET),
  image_rendering: !!(process.env.IMAGE_API_KEY && process.env.IMAGE_API_URL),
  research_configured: !!process.env.SEARCH_API_KEY,
  video_rendering: !!(process.env.VIDEO_API_KEY && process.env.VIDEO_API_URL),
}));
app.get('/api/ready', async (req, res) => {
  if (missingConfig.length || weakSecrets.length) {
    return res.status(503).json({ status: 'not_ready', configuration: { missing: missingConfig, weakSecrets } });
  }
  const { query } = require('./config/db');
  try { await query('SELECT 1'); res.json({ status: 'ok', database: 'connected' }); }
  catch (_) { res.status(503).json({ status: 'degraded', database: 'unavailable' }); }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
app.get('/desk', (req, res) => res.sendFile(path.join(__dirname, '../public/desk.html')));
app.get('/p/:slug', (req, res) => res.sendFile(path.join(__dirname, '../public/launch.html')));
app.get('/p/:slug/:page', (req, res) => res.sendFile(path.join(__dirname, '../public/launch.html')));
const siteHostDomains = require('./services/clay/domains');
app.get('*', (req, res) => {
  if (siteHostDomains.isSiteHost(siteHostDomains.hostOf(req))) {
    return res.sendFile(path.join(__dirname, '../public/launch.html'));
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use((err, req, res, next) => {
  if (!err.status || err.status >= 500) console.error(err.stack || err);
  res.status(err.status || 500).json({
    error: (err.status && err.status < 500)
      ? err.message
      : (process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : err.message),
    ...(err.details ? { details: err.details } : {}),
  });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Access YP Labs server running on port ${PORT}`));
  // Daily concept-expiry sweep: warn owners of quiet free concepts, then soft-expire the
  // ones that lapsed after being warned. Skipped in tests; a sweep error can't crash boot.
  if (process.env.NODE_ENV !== 'test') {
    const { runExpirySweep } = require('./services/expiry');
    const DAY_MS = 24 * 60 * 60 * 1000;
    const sweep = () => runExpirySweep()
      .then((r) => console.log('expiry sweep:', JSON.stringify(r)))
      .catch((e) => console.error('expiry sweep error:', e && e.message));
    setTimeout(sweep, 60 * 1000); // once, a minute after boot
    setInterval(sweep, DAY_MS);   // then daily

    // Stale-build sweep: fail builds orphaned in 'building' by a restart and email the person
    // the honest outcome, so no one is left waiting on a concept that will never arrive.
    const { sweepStaleBuilds } = require('./services/builds');
    const buildSweep = () => sweepStaleBuilds()
      .then((r) => { if (r && r.stale_failed) console.log('stale build sweep:', JSON.stringify(r)); })
      .catch((e) => console.error('stale build sweep error:', e && e.message));
    setTimeout(buildSweep, 90 * 1000);           // shortly after boot
    setInterval(buildSweep, 5 * 60 * 1000);      // then every 5 minutes

    // Auto-seed scheduler: when staff enable it, Clay tops up the Dream Market review queue on a
    // cadence (a couple a day, spaced out). Every seed lands in 'in_review' — nothing goes live
    // without staff approval. Default OFF; the tick claims a slot atomically, so it's safe across
    // restarts and multiple instances, and a failure can't crash boot.
    const seedScheduler = require('./services/clay/seedScheduler');
    const seedTick = () => seedScheduler.tick()
      .then((r) => { if (r && r.ok) console.log('scheduled seed done:', JSON.stringify(r)); })
      .catch((e) => console.error('seed scheduler error:', e && e.message));
    setTimeout(seedTick, 2 * 60 * 1000);         // a couple minutes after boot
    setInterval(seedTick, 30 * 60 * 1000);       // then every 30 minutes

    // Clay's weekly self-and-platform review. The tick claims a weekly slot atomically in the DB,
    // so checking every few hours is safe — it only actually runs once a week, emails the team,
    // and changes nothing. ON by default; a failure can't crash boot.
    const weeklyReview = require('./services/clay/weeklyReview');
    const reviewTick = () => weeklyReview.tick()
      .then((r) => { if (r && r.ok) console.log('weekly review done:', JSON.stringify(r)); })
      .catch((e) => console.error('weekly review error:', e && e.message));
    setTimeout(reviewTick, 5 * 60 * 1000);        // a few minutes after boot
    setInterval(reviewTick, 6 * 60 * 60 * 1000);  // then every 6 hours (DB claim gates it to weekly)

    // Clay drafting Desk pieces (help articles + witty stories). The tick claims a slot atomically
    // and only drafts when the pending queue is small, so it's gentle by design. It ONLY creates
    // drafts — nothing is ever published without an owner approving it. A failure can't crash boot.
    const deskCompose = require('./services/clay/deskCompose');
    const deskTick = () => deskCompose.tick()
      .then((r) => { if (r && r.ok) console.log('desk piece drafted:', JSON.stringify(r)); })
      .catch((e) => console.error('desk compose error:', e && e.message));
    setTimeout(deskTick, 8 * 60 * 1000);          // a few minutes after boot
    setInterval(deskTick, 12 * 60 * 60 * 1000);   // then twice a day (DB claim gates it to ~3 days)

    // The weekly creator proof prompt. The tick claims a weekly slot atomically, then generates and
    // emails a prompt to each creator who doesn't have one this week. Deterministic content (no LLM
    // needed), best-effort, capped, and it can never double-send. A failure can't crash boot.
    const proofPrompt = require('./services/clay/proofPrompt');
    const proofTick = () => proofPrompt.tick()
      .then((r) => { if (r && r.ok && (r.made || r.emailed)) console.log('proof prompts:', JSON.stringify(r)); })
      .catch((e) => console.error('proof prompt error:', e && e.message));
    setTimeout(proofTick, 10 * 60 * 1000);        // a few minutes after boot
    setInterval(proofTick, 12 * 60 * 60 * 1000);  // then twice a day (DB claim gates it to weekly)
  }
}
module.exports = app;
