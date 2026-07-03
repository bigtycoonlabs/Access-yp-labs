# YP Labs Housing Technology Platform Plan

YP Labs is a technology infrastructure business for furnished rental, corporate housing, mid-term rental, serviced accommodation, shared-living, and flexible housing operators.

## Product Scope

The public platform should route operators into a build request for one of two paths:

- **Track A — Full Architecture Tech Package:** complete architecture and implementation planning for the operator's web, mobile, booking, automation, dashboard, SOP, and staff systems.
- **Track B — A la carte modules:** individual modules selected from the service catalog.

## Modules

- Marketing Website
- Direct Booking Engine + PMS Integration
- AI Hospitality Concierge
- React Native Mobile App (iOS/Android)
- Web Application Portal
- SOPs & Employee Manual
- VA Training Dashboard

## Data Model Alignment

- `wizard_submissions.track` stores `A` or `B`.
- `housing_type`, `channel`, `mission`, and `brand_color` describe the housing operator profile.
- `projects` store the operational build request and payment plan.
- `order_line_items` store the selected infrastructure modules.
- `payment_plans` support one-time and financed project payment paths.

## Operating Workflow

1. Operator submits the wizard.
2. A pending client account is created or matched by email.
3. A project is created and line items are generated from server-side pricing.
4. Staff uses the workspace to assign a specialist, create milestones, request client information, upload files, and manage status.
5. Client uses the workspace for messages, requests, documents, and billing.
6. Admin users manage accounts, staff roles, discount codes, login activity, and performance records.
