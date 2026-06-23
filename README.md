# YP Labs Platform

> **A Set Up Your Place LLC Technology Company**  
> Enterprise housing technology platform — custom software, AI concierge, mobile apps, SOPs, and VA staffing for professional flexible housing operators.

---

## Repository Structure

```
yp-labs/
├── public/                  # Static frontend (no build step required)
│   ├── index.html           # Main marketing site (accessyplabs.com)
│   ├── dashboard.html       # Client + Staff Admin dashboard
│   └── wizard.html          # Business Printer wizard (standalone)
├── src/                     # Node/Express backend
│   ├── server.js            # Entry point
│   ├── config/
│   │   └── db.js            # PostgreSQL connection pool
│   ├── middleware/
│   │   └── auth.js          # JWT authentication & role authorization
│   └── routes/
│       ├── auth.js          # Register, login, refresh, /me
│       ├── wizard.js        # Wizard submission → project creation
│       ├── projects.js      # Project CRUD (client + staff views)
│       ├── milestones.js    # Build milestone tracking
│       ├── messages.js      # Per-project threaded messaging
│       ├── files.js         # Staff file uploads → client downloads
│       ├── requests.js      # Staff→client action requests
│       ├── appointments.js  # Lead/client appointment scheduling
│       ├── billing.js       # Payment plan tracking
│       └── clients.js       # Staff CRM view
├── docs/
│   ├── schema.sql           # Full PostgreSQL schema — run this first
│   └── tech-stack-plan.md   # Architecture decisions & phased roadmap
├── .github/
│   └── workflows/
│       └── deploy.yml       # CI (test) + deploy to Railway on merge to main
├── .env.example             # Environment variable template
├── .gitignore
└── package.json
```

---

## Production Features

- Public service site with a server-validated project configurator
- Account activation after project submission
- Role-aware client and staff workspace
- Project milestones, messaging, document delivery, client requests, and appointments
- Signed Cloudinary file uploads
- Stripe Checkout with verified, idempotent webhooks
- PostgreSQL persistence and project-level authorization
- Liveness endpoint at `/api/health` and database readiness at `/api/ready`

## Quick Start (Local Dev)

### 1. Clone the repo
```bash
git clone https://github.com/YOUR_ORG/yp-labs.git
cd yp-labs
```

### 2. Install dependencies
```bash
npm install
```

### 3. Set up environment
```bash
cp .env.example .env
# Fill in DATABASE_URL, JWT_SECRET, and other required values
```

### 4. Set up the database
Create a PostgreSQL database on [Supabase](https://supabase.com) or [Neon](https://neon.tech), then run:
```bash
psql $DATABASE_URL -f docs/schema.sql
```

### 5. Start the dev server
```bash
npm run dev
# → http://localhost:3000
```

The server serves the static HTML files from `/public` at `/` and mounts all API routes under `/api/`.

---

## Deployment (Railway)

### One-time setup
1. Create a Railway project at [railway.app](https://railway.app)
2. Add a PostgreSQL service in Railway and copy the connection string to `DATABASE_URL`
3. Add all required environment variables from `.env.example` to Railway's environment settings
4. Add your Railway token as a GitHub secret named `RAILWAY_TOKEN`

### Automated deploys
Every push to `main` that passes tests automatically deploys to Railway via the GitHub Actions workflow.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | Min 64-char random string |
| `REFRESH_TOKEN_SECRET` | ✅ | Min 64-char random string |
| `STRIPE_SECRET_KEY` | ✅ | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Stripe webhook signing secret |
| `CLOUDINARY_URL` | For uploads | Signed Cloudinary SDK connection URL |

---

## API Reference

### Auth
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | None | Create client account |
| POST | `/api/auth/login` | None | Login — returns JWT |
| POST | `/api/auth/refresh` | None | Refresh access token |
| GET | `/api/auth/me` | Bearer | Get current user |

### Wizard
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/wizard/submit` | None | Submit wizard → creates project |

### Projects
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/projects` | Bearer | All projects (staff) or own (client) |
| GET | `/api/projects/:id` | Bearer | Single project + line items |
| PATCH | `/api/projects/:id` | Staff | Update status / notes / specialist |

### Messages
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/messages/:projectId` | Bearer | Full message thread |
| POST | `/api/messages/:projectId` | Bearer | Send message |

### Files
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/files/:projectId` | Bearer | List files |
| POST | `/api/files/:projectId` | Staff | Upload deliverable |
| DELETE | `/api/files/:projectId/:fileId` | Staff | Delete file |

### Requests
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/requests/:projectId` | Bearer | List requests |
| POST | `/api/requests/:projectId` | Staff | Create request for client |
| POST | `/api/requests/:projectId/:id/respond` | Client | Upload response |
| PATCH | `/api/requests/:projectId/:id` | Staff | Close / cancel |

### Appointments
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/appointments` | Staff | All appointments |
| POST | `/api/appointments` | Staff | Schedule appointment |
| PATCH | `/api/appointments/:id` | Staff | Reschedule / update status |

### Clients (Staff CRM)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/clients` | Staff | All clients with project info |
| GET | `/api/clients/:id` | Staff | Single client |
| PATCH | `/api/clients/:id` | Staff | Update CRM fields |

---

## User Roles

| Role | Access |
|---|---|
| `client` | Own project, messages, files, requests, billing |
| `staff` | All clients, project updates, file uploads, milestone management, appointments |
| `admin` | All staff access + user management |
| `master_staff` | Full platform access including admin controls |

Create the first staff account by registering normally, then promote it directly in PostgreSQL:

```sql
UPDATE users SET role = 'master_staff' WHERE email = 'admin@accessyplabs.com';
```

## Stripe Webhook

Create a Stripe webhook for `checkout.session.completed` at:

```text
https://YOUR_DOMAIN/api/billing/webhook
```

Set its signing secret as `STRIPE_WEBHOOK_SECRET`. Checkout payments update the matching payment plan only after the signed webhook is accepted.

---

## Platform Ecosystem

| Platform | URL | Status |
|---|---|---|
| Access YP Labs | accessyplabs.com | 🏗 This repo |
| Access Your Place | accessyourplace.com | ✅ Live |
| Access YP Flow | accessypflow.com | ✅ Live |

---

## Contact

**Success Team:** success@accessyourplace.com  
**Address:** 1150 NW 72nd Ave, Tower I, Suite 455, Miami, FL 33126  
**Owner:** Set Up Your Place LLC
