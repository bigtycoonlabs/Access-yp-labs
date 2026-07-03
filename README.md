# YP Labs Platform

> **A Set Up Your Place LLC Technology Company**  
> Technology infrastructure for furnished rental, corporate housing, mid-term rental, serviced accommodation, shared-living, and flexible housing operators.

## Current Product Direction

YP Labs builds React, React Native, automation, booking, dashboard, SOP, and staffing infrastructure for professional housing operators.

## Production Features

- Public housing technology site with a server-validated build request wizard
- Full Architecture Tech Package and a la carte infrastructure modules
- Account activation after project submission
- Role-aware client and staff workspace
- Admin dashboard at `/admin.html` for admin/master_staff users
- Admin APIs for account management, login activity, password reset, discount codes, and performance tracking
- Project milestones, messaging, document delivery, client requests, and appointments
- Signed Cloudinary file uploads
- Stripe Checkout with verified, idempotent webhooks
- PostgreSQL persistence and project-level authorization
- Liveness endpoint at `/api/health` and database readiness at `/api/ready`

## Core Modules

- Marketing Website
- Direct Booking Engine + PMS Integration
- AI Hospitality Concierge
- React Native Mobile App (iOS/Android)
- Web Application Portal
- SOPs & Employee Manual
- VA Training Dashboard

## Quick Start

```bash
npm install
cp .env.example .env
npm test
npm run dev
```

Run the database schema before using production data:

```bash
psql $DATABASE_URL -f docs/schema.sql
```

For existing databases, also apply migrations in `docs/migrations/`.
