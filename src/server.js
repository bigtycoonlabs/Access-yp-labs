require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
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
app.use(express.static(path.join(__dirname, '../public')));

// The Dreamhold / Clay API surface
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/profiles',      require('./routes/profiles'));
 app.use('/api/preferences',   require('./routes/preferences'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/concepts',      require('./routes/concepts'));
app.use('/api/clay',          require('./routes/clay'));
app.use('/api/assets',        require('./routes/assets'));
app.use('/api/sellers',       require('./routes/sellers'));
app.use('/api/maintenance',   require('./routes/maintenance'));
app.use('/api/listings',      require('./routes/listings'));
app.use('/api/bids',          require('./routes/bids'));
app.use('/api/watches',       require('./routes/watches'));
app.use('/api/orders',        require('./routes/orders'));
app.use('/api/consultants',   require('./routes/consultants'));
app.use('/api/moderation',    require('./routes/moderation'));
app.use('/api/reports',       require('./routes/reports'));

app.get('/api/health', (req, res) => res.json({
  status: 'ok', service: 'yp-labs', platform: 'the-dreamhold',
  clay: {
    configured: !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY),
    provider: process.env.OPENAI_API_KEY ? 'openai' : (process.env.ANTHROPIC_API_KEY ? 'anthropic' : null),
  },
  image_rendering: !!(process.env.IMAGE_API_KEY && process.env.IMAGE_API_URL),
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
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

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
  app.listen(PORT, () => console.log(`YP Labs (The Dreamhold) server running on port ${PORT}`));
}
module.exports = app;
