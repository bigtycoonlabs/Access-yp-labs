# Access YP Labs — The Kiln

A neutral marketplace and launchpad for pre-proven business concepts you can run
from anywhere. **Shape it with Clay. Fire it in The Kiln.**

Part of Set Up Your Place LLC. Isolated from YP Flow and Access Your Place —
this app connects only to the `yp_labs` Postgres schema.

## What it is
- **Clay** — a conversational AI idea printer (Create / Enhance) that assembles a
  full, ownable concept package and never fabricates data.
- **The Kiln** — a peer-to-peer marketplace where members sell concepts outright.
  Sellers set price ($50 floor), flat or auction; ownership transfers on delivery.
- **Consultants** — $150 / 90-min sessions, NDA-gated, with a 12-hour free
  continuation window. Platform take is 20% across the board.

## Stack
Node.js / Express · PostgreSQL (`yp_labs` schema) · Stripe Connect · Anthropic
(Clay) · Resend (delivery) · Railway. Accessibility is a first-class requirement.

## Run
```
npm install
cp .env.example .env   # fill in secrets
npm start              # or: npm run dev
npm test
```

## API surface
`/api/auth` · `/api/profiles` · `/api/subscriptions` · `/api/concepts` ·
`/api/clay` · `/api/assets` · `/api/listings` · `/api/bids` · `/api/watches` ·
`/api/orders` · `/api/consultants` · `/api/moderation` · `/api/health` · `/api/ready`

## Database
Schema lives in `docs/schema.sql`; transition history in `docs/migrations/`
(003 retires the old housing model, 004 builds the marketplace, 005 broadens roles).
