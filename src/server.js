require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
// Railway puts exactly one proxy in front of us. 'true' trusts the WHOLE X-Forwarded-For chain,
// which means anyone can append a fake address and appear to be a different client — trivially
// defeating the per-IP rate limits, including the brute-force protection on sign-in. Trusting one
// hop takes the address Railway actually set and ignores anything the caller added themselves.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

const requiredConfig = ['DATABASE_URL', 'JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'CLIENT_URL'];
const missingConfig = requiredConfig.filter((k) => !process.env[k]);
const weakSecrets = ['JWT_SECRET', 'REFRESH_TOKEN_SECRET'].filter((k) => process.env[k] && process.env[k].length < 64);
if (process.env.NODE_ENV === 'production' && (missingConfig.length || weakSecrets.length)) {
  console.error('YP Labs configuration incomplete.', { missing: missingConfig, weakSecrets });
}

// A Content Security Policy was switched off entirely, which threw away helmet's most valuable
// protection: without it, an injected <script src> to any domain would simply run. It is on now.
//
// 'unsafe-inline' is included for scripts and styles because most pages carry inline blocks — an
// honest compromise rather than a pretend one. What this DOES buy, even so: no script can be loaded
// from a domain we do not name, no page can be framed by anyone (clickjacking), no plugins or
// objects, forms can only post back to us, and any http asset gets upgraded to https. Removing
// 'unsafe-inline' later means moving those blocks into files, which is worth doing but is not a
// reason to run with no policy at all in the meantime.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],          // generated + stored images arrive over https
      connectSrc: ["'self'", 'https:'],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],                      // nobody may frame this site
      formAction: ["'self'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,                    // would block third-party images we do use
}));
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

// Credential endpoints get a MUCH tighter limit than the rest of the API. The general limit allows
// 200 requests per quarter hour, which is sensible for browsing but would also permit roughly eight
// hundred password guesses an hour from a single address. Sign-in, sign-up and token refresh are
// where an attacker actually spends their effort, so they get their own budget. Successful sign-ins
// are not counted, so a person using the product normally will never meet this — only someone
// guessing will.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts from this device. Please wait a few minutes and try again.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/refresh', authLimiter);
// Server-rendered pages: Clay's Desk articles (each at its own address, with real HTML for search
// engines and link previews) and a generated sitemap. Mounted BEFORE the static handler so the
// generated sitemap wins over the static file.
app.use(require('./routes/deskPages'));
app.use(require('./routes/weeklyPages'));

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
app.use('/api/weekly',        require('./routes/weekly'));
app.use('/api/progress',      require('./routes/progress'));
app.use('/api/partners',      require('./routes/partners'));
app.use('/api/admin/users',   require('./routes/adminUsers'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/concepts',      require('./routes/concepts'));
app.use('/api/clay',          require('./routes/clay'));
app.use('/api/assets',        require('./routes/assets'));
app.use('/api/sellers',       require('./routes/sellers'));
app.use('/api/store',         require('./routes/store'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/maintenance',   require('./routes/maintenance'));
app.use('/', require('./routes/marketPages'));
app.use('/api/market-admin', require('./routes/marketAdmin'));
app.use('/api/console', require('./routes/console'));
app.use('/api/seed-listings', require('./routes/seedListings'));
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
  // A MALFORMED ID IS NOT A SERVER FAULT. Postgres rejects a bad uuid with 22P02, which surfaced
  // as a 500 carrying the raw database message — 'invalid input syntax for type uuid: "not-a-uuid"'.
  // Three things wrong with that: it blames us for a bad link, it tells a stranger what our database
  // is made of, and it fires the 500 alarms for something entirely routine. A wrong id means the
  // thing is not there, which is a 404, said in words a person can read.
  if (err && err.code === '22P02') {
    return res.status(404).json({ error: 'That link doesn’t point to anything here. It may be mistyped, or the thing it pointed to is gone.' });
  }
  // Likewise a value too long for its column: that is the person's input being too big, not a fault.
  if (err && err.code === '22001') {
    return res.status(400).json({ error: 'That was too long to save. Try something shorter.' });
  }
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
    // The one useful message before the fade warning. Ordering matters: a person should hear
    // "here is your next step" days before they ever hear "your dream is about to fade", or the
    // only thing this platform has ever said to them is that their work is dying.
    try {
      const { runNudges } = require('./services/clay/nextStep');
      setTimeout(() => {
        runNudges({ quietDays: 3, limit: 25 })
          .then((r) => console.log('next-step nudges:', JSON.stringify(r)))
          .catch((e) => console.error('next-step nudges failed:', e && e.message));
      }, 45000);
      setInterval(() => {
        runNudges({ quietDays: 3, limit: 25 })
          .then((r) => console.log('next-step nudges:', JSON.stringify(r)))
          .catch((e) => console.error('next-step nudges failed:', e && e.message));
      }, 24 * 60 * 60 * 1000).unref();
    } catch (e) { console.error('could not schedule next-step nudges:', e && e.message); }

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

    // Settling auctions whose clock has run out: record the winner and TELL BOTH SIDES. It takes no
    // money and transfers nothing — the winner completes the purchase through the normal flow — so
    // this is a fact being written down, not a transaction being forced. The claim only matches
    // unsettled rows, so running it often (and on several instances) can't double-settle or
    // double-email. A failure can't crash boot.
    const auctions = require('./services/clay/auctions');
    const auctionTick = () => auctions.settleDue()
      .then((r) => { if (r && r.ok && r.settled) console.log('auctions settled:', JSON.stringify(r)); })
      .then(() => auctions.reportEndlessAuctions())
      .then((r) => { if (r && r.ok && r.endless) console.log('endless auctions flagged:', r.endless); })
      .catch((e) => console.error('auction settle error:', e && e.message));
    setTimeout(auctionTick, 3 * 60 * 1000);        // shortly after boot
    setInterval(auctionTick, 10 * 60 * 1000);      // then every 10 minutes — a closed auction shouldn't wait

    // Telling people about the dreams they watch. Events are recorded as they happen and mailed in
    // batches, so a burst of activity on one listing becomes a single message rather than five.
    // Runs often because news that arrives late is barely news. A failure can't crash boot.
    const watchActivity = require('./services/clay/watchActivity');
    const watchTick = () => watchActivity.notifyWatchers()
      .then((r) => { if (r && r.ok && r.sent) console.log('watch activity sent:', JSON.stringify(r)); })
      .catch((e) => console.error('watch activity error:', e && e.message));
    setTimeout(watchTick, 4 * 60 * 1000);
    setInterval(watchTick, 15 * 60 * 1000);

    // Clay Weekly. The tick claims the week by inserting the issue row itself (weekly_issues is
    // unique on week_start), so running it every few hours is safe across restarts and instances —
    // it can only ever draft one issue per week. It drafts and then tells the owners it's waiting;
    // it never approves, publishes, or emails a single reader. A failure can't crash boot.
    const weeklyMag = require('./services/clay/weekly');
    const weeklyTick = () => weeklyMag.tick()
      .then((r) => { if (r && r.ok) console.log('clay weekly drafted:', JSON.stringify(r)); })
      .catch((e) => console.error('clay weekly error:', e && e.message));
    setTimeout(weeklyTick, 12 * 60 * 1000);        // a few minutes after boot
    setInterval(weeklyTick, 6 * 60 * 60 * 1000);   // then every 6 hours (the DB claim gates it to weekly)

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
