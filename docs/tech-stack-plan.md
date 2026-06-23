# AccessYPLabs.com — Technical Architecture & Stack Plan

YP Labs is the agency: it builds and delivers, per client, a branded marketing site, direct-booking engine, AI hospitality concierge, React Native + web apps, SOPs, a VA training dashboard, and staffed virtual assistants. AccessYPLabs.com is the intake, production-tracking, and delivery platform that powers that agency work — not a product with those features built into itself. The wizard is the front door into two tracks: **Full Blueprint** (everything built as one package, 14 business days) or **À La Carte** (individual deliverables added to an existing business, 24–72 hour turnaround per item).

## 1. Guiding Principles

- **The wizard is a request router, not a feature list.** Its job is to capture what a client needs and turn it into one or more production tickets, each pointing at a deliverable pipeline below.
- **Every deliverable type needs its own templated production pipeline.** Marketing sites, booking engines, mobile apps, AI concierge bots, SOPs, and VA training dashboards are each built per client — design each as a repeatable generator/template system, not a one-off build every time.
- **SLA varies by track, so tracking has to be flexible.** A Full Blueprint client has one 14-day milestone sequence; an À La Carte client may have three different line items each running their own 24–72 hour clock simultaneously.
- **Adapter pattern for integrations.** PMS/channel-manager APIs, calendar tools, and payment processors all change or expand over time — isolate each behind a thin adapter so adding a new one doesn't touch core logic.
- **Multi-tenant from day one for the AI concierge.** Every client's bot needs its own config (scripts, knowledge base, phone number) — design that as per-client data, not a hardcoded single instance.

## 2. The Deliverable Catalog

These are the seven things YP Labs actually produces for a client. Everything else in this document exists to route requests into these pipelines and track their completion.

| Deliverable | What it is | Production approach |
|---|---|---|
| Marketing website | Branded, conversion-focused site for the client's own business | Templated Next.js theme, populated per client (copy, palette, logo) |
| Direct booking engine | Client-facing booking site/app wired to their PMS/channel manager | Shared booking-engine codebase + per-client PMS adapter config |
| AI hospitality concierge | Voice/text bot for lead capture, scheduling, resident intake | Multi-tenant bot platform; one config record per client |
| React Native mobile app | iOS/Android booking app for the client's customers | Templated RN codebase, per-client branding + build pipeline |
| Web application | Any additional custom web tool the client needs | Built from a shared component/scaffold library, scoped per request |
| SOPs & employee manuals | Branded operational documents | Template + AI-assisted first draft, specialist-reviewed before delivery |
| VA training dashboard | Onboarding/LMS-style portal tracking VA handbook compliance | Shared dashboard product, instantiated per client with their handbook content |

VA staffing itself (matching clients to vetted virtual assistants) is a service layered on top of the training dashboard, not a separate deliverable — see Section 12.

## 3. Frontend

| Layer | Recommendation | Why |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | SSR for marketing SEO, same codebase for public site + authenticated dashboard |
| Styling | Tailwind CSS | Matches the "minimalist dark interface, interactive process nodes" visual direction without heavy custom CSS overhead |
| Wizard | React Hook Form + Zod, multi-step state machine | Handles the Full Blueprint vs À La Carte branch and validates each step before progression |
| Dashboard | Same Next.js app, route-protected | Avoids running two separate frontends |
| Hosting | Vercel | Native Next.js support, preview deployments per PR |

## 4. Backend & Data

- **API layer:** Next.js Route Handlers or a separate NestJS service if logic grows complex (AI orchestration, deliverable-pipeline orchestration). Start with Route Handlers; split out once a service genuinely needs independent scaling.
- **Database:** PostgreSQL (Supabase or Neon). Core tables: `clients`, `wizard_submissions`, `projects`, `order_line_items`, `milestones`, `documents`, `va_profiles`, `va_assignments`, `concierge_bots`, `pms_connections`, `service_catalog`, `pricing_rules`, `payment_plans`, `contracts`, `messages`.
- **File storage:** Cloudflare R2 or S3 — for generated SOPs, handbooks, logo uploads, contracts.

## 5. Authentication & Access Control

- **Provider:** Clerk or Supabase Auth for the "Investor & Client Login" gateway.
- **Roles:** `client`, `vendor`, `specialist` (internal), `admin`. Dashboard views and data scoping driven by role, not just authentication state.

## 6. The Business Printer Wizard

**Entry choice:**
- **Track A — Full Blueprint:** the full questionnaire (housing type, booking channels, brand inputs, automation add-ons). One order is created spanning all seven deliverable types, with a single 14-business-day SLA.
- **Track B — À La Carte:** a catalog of individual deliverables, each with its own price and SLA (24–72 hours). Clients select one or more items, cart-style, rather than going through the full questionnaire.

**Data model implication:** a `service_catalog` table holds each à la carte offering (`deliverable_type`, `name`, `price`, `sla_hours`). Every wizard submission — Full Blueprint or À La Carte — creates a `projects` row plus one or more `order_line_items`, each pointing at a deliverable type and carrying its own SLA deadline and status. This lets one client have, say, a marketing-site refresh due in 48 hours and an SOP rewrite due in 72 hours, tracked independently.

**Final wizard step — pricing & payment arrangement:** once selections are complete, the wizard runs them through the pricing engine (Section 7) and shows an itemized breakdown. The client then picks **one-time upfront** or **90-day financing (direct through YP Labs)** — this is a preference, not a charge. No payment is collected at this point.

**On submission:** trigger (a) internal Slack/email alert to the assigned specialist, (b) auto-create the `projects` + `order_line_items` records with status `awaiting_specialist_contact` and the chosen `payment_plans` record in `pending_confirmation` state, (c) send the client a confirmation email with expected delivery windows and a summary of the price breakdown and payment arrangement they selected.

## 7. Pricing Engine

- `pricing_rules` holds the components that make up a price: a base price per housing-type/package selection, flat or percentage modifiers per automation add-on (AI concierge, channel integrations, etc.), and à la carte item prices from `service_catalog`.
- The wizard's pricing step is a pure calculation against this table — no hardcoded prices in frontend code, so a specialist/admin can adjust pricing without a deploy.
- **90-day financing math:** store the financing terms (e.g., a flat financing fee or 3-installment schedule) as a rule too, so the breakdown shown to the client already reflects what each option actually costs — total upfront vs. total financed, with the installment schedule spelled out before they choose.

## 8. Client Dashboard & Project Tracking

Everything a client needs — beyond the initial specialist conversation — should be completable from inside the dashboard: viewing status, signing the contract, paying or setting up financing, and messaging the team.

- **Status visibility:** each project (and, for À La Carte, each line item) shows one of: `awaiting_specialist_contact` → `onboarding` (specialist gathering details/finalizing scope) → `awaiting_payment` (contract sent, payment/financing not yet completed) → `in_production` → milestone-by-milestone progress → `delivered`. The client always knows whether work has started or what it's waiting on.
- **In-dashboard contract signing:** embed e-signature directly in the portal (Dropbox Sign or Documenso both support embedded signing rather than redirecting off-platform) rather than sending a separate external link.
- **In-dashboard payment/financing setup:** once the contract is signed, the dashboard surfaces a "complete payment setup" step — Stripe Checkout embedded for one-time, or a Stripe-based installment schedule for the 90-day plan — moving the project from `awaiting_payment` to `in_production` once done.
- **In-dashboard messaging:** a `messages` thread per project lets the client communicate directly with their assigned specialist/tech team without leaving the dashboard (Supabase Realtime or Pusher for live updates; email notification as a fallback so specialists aren't required to live in the dashboard).
- Document deliverables (SOPs, handbooks, brand assets) attach to the relevant line item and become downloadable once marked complete.

## 9. AI Concierge & Automation Layer

This is the most novel piece and should be built as its own service from the start.

- **Voice/text orchestration:** Vapi, Retell AI, or Bland AI — these handle the call/SMS infrastructure and LLM turn-taking so you're not building telephony from scratch.
- **Telephony/SMS carrier:** Twilio underneath, for number provisioning per client.
- **Conversation logic/LLM:** Claude via the Anthropic API, with a per-client system prompt assembled from their wizard answers (property type, booking channels, brand voice) plus a retrieval layer over their SOPs/FAQs.
- **Scheduling action:** Same Cal.com integration as the wizard, exposed as a callable tool to the bot for appointment booking and resident intake.
- **Compliance note:** call recording/AI-disclosure laws vary by state — surface a disclosure script requirement per client jurisdiction; don't treat this as optional.

## 10. PMS / Channel Manager Integration Layer

- Build a connector interface (`connect()`, `syncListings()`, `pushAvailability()`) implemented per platform (Hostaway, Guesty, Lodgify, OwnerRez, etc.) — this powers each client's direct booking engine.
- Store credentials per client in an encrypted `pms_connections` table; never hardcode client API keys into app code or env files.
- Start with the 1–2 platforms your earliest clients actually use rather than building all connectors speculatively.

## 11. Client App Production Pipeline (React Native + Web)

- Maintain one templated React Native codebase and one web-app scaffold, each parameterized by client branding, PMS connection, and feature flags rather than forked per client — forking guarantees maintenance pain at scale.
- A build pipeline (Expo EAS for mobile, Vercel for web) takes a client's config record and produces a branded build/deploy, tracked as an `order_line_item` against that client's project.
- One-off web app requests (the "Web application" catalog item) draw from the same shared component library rather than starting from scratch each time.

## 12. Document & SOP Generation Engine

- Template-based generation (docxtemplater or similar) for SOPs, employee manuals, and brand blueprint docs.
- First-draft content can be generated via the Anthropic API from the client's wizard inputs (mission statement, target audience, brand palette), then reviewed/edited by the assigned US-based specialist before delivery — keeps the "human-in-the-loop guarantee" honest rather than fully automated.

## 13. VA Training Dashboard & Global Staffing Network

- The training dashboard is itself a deliverable: an LMS-style portal instantiated per client, pre-loaded with their SOPs/handbook, tracking each VA's completion/compliance before they're cleared to work.
- `va_profiles`: skills, region, rate expectations, language, availability — feeds a filterable directory rather than a full bidding marketplace initially, matching the "client retains full compensation autonomy" model.
- Agreement execution via DocuSign API once a client selects a VA; on hire, the VA is auto-enrolled in that client's training dashboard instance.

## 14. Payments & Financing

- **No charge at wizard completion.** The wizard only records which arrangement the client prefers in `payment_plans` (`one_time` or `financed_90day`) — actual collection happens later in the dashboard, after the specialist call and contract signing, per Section 8.
- **One-time:** standard Stripe Checkout for the full package or à la carte total.
- **90-day financing, direct through YP Labs:** this is in-house financing, not a third-party BNPL provider, so YP Labs carries the receivable. Model it as a `payment_plans` record with an installment schedule (e.g., 3 charges over 90 days) executed via Stripe's installment/subscription billing, plus whatever financing fee or markup is defined in `pricing_rules`. Track `paid`/`past_due`/`outstanding_balance` per installment so specialists can see financing health per client.
- **No-refund policy enforcement:** explicit checkbox acceptance logged with timestamp/IP at checkout, referencing the policy text, before any custom production work is marked as started — applies to both payment arrangements and both tracks.

## 15. Infrastructure Summary

| Concern | Tool |
|---|---|
| Hosting | Vercel (frontend/API) |
| Database | Supabase/Neon Postgres |
| File storage | Cloudflare R2 |
| DNS/CDN | Cloudflare |
| Mobile build pipeline | Expo EAS |
| Embedded e-signature | Dropbox Sign or Documenso |
| Realtime dashboard messaging | Supabase Realtime or Pusher |
| Error monitoring | Sentry |
| Analytics | PostHog or GA4 |
| Internal automation glue | n8n (self-hosted) for things like "wizard submitted → CRM record → Slack alert" |

## 16. Phased Build Roadmap

1. **Foundation** — repo, design system, domain, hosting, auth scaffold.
2. **Marketing site + wizard (both tracks, front end only)** — Full Blueprint questionnaire and À La Carte catalog/cart both live, including the pricing breakdown and payment-arrangement selection step; submissions email/CRM the team manually.
3. **Wizard backend + pricing engine** — `service_catalog`, `pricing_rules`, `order_line_items`, `payment_plans` all wired so quotes are calculated, not hardcoded.
4. **Client dashboard core** — role-based portal showing project/line-item status (`awaiting_specialist_contact` → `onboarding` → `awaiting_payment` → `in_production` → milestones → `delivered`).
5. **In-dashboard contract signing + payments/financing** — embedded e-signature, Stripe checkout for one-time, installment billing for the 90-day plan, no-refund acceptance flow.
6. **In-dashboard messaging** — client/specialist thread per project.
7. **Document engine** — templated SOP/handbook generation.
8. **App production pipeline** — templated React Native + web app generator, first client builds shipped manually through the pipeline.
9. **AI concierge MVP** — single-tenant voice/text bot, one pilot client, manual config.
10. **PMS integrations** — adapters for the platforms your active clients actually use.
11. **VA training dashboard + staffing network** — dashboard product instantiation, profile directory, hire flow, e-signature.
12. **Multi-tenant AI concierge scaling** — self-serve bot configuration per new client, analytics on call/conversion performance.

Each phase is shippable on its own — you don't need the AI concierge, app pipeline, or staffing network automated to start taking clients through the wizard, signing contracts, and collecting payment in the meantime.
