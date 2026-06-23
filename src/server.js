require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');
const billingRoutes = require('./routes/billing');

const app = express();
const PORT = process.env.PORT || 3000;

const requiredConfig = ['DATABASE_URL', 'JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'CLIENT_URL'];
const missingConfig = requiredConfig.filter((key) => !process.env[key]);
const weakSecrets = ['JWT_SECRET', 'REFRESH_TOKEN_SECRET']
  .filter((key) => process.env[key] && process.env[key].length < 64);

if (process.env.NODE_ENV === 'production' && (missingConfig.length || weakSecrets.length)) {
  console.error('YP Labs configuration incomplete.', {
    missing: missingConfig,
    weakSecrets,
  });
}

// ── Security middleware ──
app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled — CDN assets used in HTML
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Stripe requires the exact raw request body for signature verification.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), (req, res, next) => {
  Promise.resolve(billingRoutes.webhook(req, res)).catch(next);
});

// ── Body parsing ──
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting ──
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again shortly.' },
});
app.use('/api/', apiLimiter);

// ── Static files ──
app.use(express.static(path.join(__dirname, '../public')));

// ── API Routes ──
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/wizard',     require('./routes/wizard'));
app.use('/api/projects',   require('./routes/projects'));
app.use('/api/milestones', require('./routes/milestones'));
app.use('/api/messages',   require('./routes/messages'));
app.use('/api/files',      require('./routes/files'));
app.use('/api/requests',   require('./routes/requests'));
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/billing',    billingRoutes);
app.use('/api/clients',    require('./routes/clients'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'yp-labs' });
});

app.get('/api/ready', async (req, res) => {
  if (missingConfig.length || weakSecrets.length) {
    return res.status(503).json({
      status: 'not_ready',
      configuration: { missing: missingConfig, weakSecrets },
    });
  }
  const { query } = require('./config/db');
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(503).json({ status: 'degraded', database: 'unavailable' });
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));

// ── Catch-all — serve frontend ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Global error handler ──
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred.'
      : err.message,
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`YP Labs server running on port ${PORT}`);
  });
}

module.exports = app;
