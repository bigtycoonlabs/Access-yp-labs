# Access YP Labs — Clay Website Builder: Living Roadmap

The vision: Clay doesn't just help someone *plan* a business — he helps them *build* and *run* it.
A concept starts as an idea, gets proven, and can become a real, stunning website the creator owns
and can host anywhere. The platform becomes a place to **build and to run** — the "video game
experience" of taking something from idea to a live thing. Everything stays inside the Access YP
Labs brand; the line we do not cross is building full applications — for those, Clay advises and
points elsewhere.

This is a living document. Check items off as we ship them.

---

## Shipped

**Multi-page sites.** A concept is a real site, not one page: a home (its landing page) plus any
number of pages — About, Resources, real articles and blog posts. Served at
`/p/<site-slug>/<page-slug>` with working navigation. Every page keeps email capture, so the whole
site gathers proof. Owner-managed in the Laboratory and buildable by Clay.

**Stunning look — themes + rich content.** Six themes (warm, ink, clean, bold, forest, dusk), a
hero image across the top, and rich content blocks: headings, bullet lists, images, pull-quotes,
dividers, and call-to-action buttons. All authored content is rendered safely (no HTML injection).

**Clay builds it, page by page.** Tools: `set_launch_page` (home copy + theme + hero + publish),
`add_site_page`, `edit_site_page`, `list_site_pages`. Clay is instructed to write real,
article-quality content and offer to build a site out with the creator.

**Export — own everything.** "Download your site" produces one self-contained, themed HTML file the
creator can host anywhere, on any host or their own domain. Owning and being able to leave is the
point.

**The app boundary + honest advice.** Clay builds websites and content/booking/property sites, not
full web or mobile applications. For real apps he points to Claude Code, ChatGPT, or Lovable — and
gives the honest trade-off: fast builders like Lovable/Replit can mean lock-in, ongoing cost, and
limited ownership, versus building with Claude and hosting on your own cloud so you own everything.

**Run, not just build.** Clay frames a working site as the moment a proven concept becomes a live
business someone can start running — or a buyer can switch on.

**Access Your Place tie-in.** Clay can build a property/booking site and tell the owner how to embed
a booking widget from Hospitable, Hostaway, Hostfully, Lodgify, or OwnerRez so the site takes real
bookings.

**Sculptor website allowance.** 10 newly-published sites per calendar month on Sculptor; the gate is
enforced on publish (counts a site once, by first-publish month). An active `site_addon` lifts the
cap. (The purchasable $2.99/month add-on itself is the next billing item — see below.)

**Web addresses.** Every site can have a real address: an instant free subdomain on our platform
(`<label>.sites.accessyplabs.com`, live immediately, claimable by Clay via `claim_web_address` or in
the Laboratory) or the creator's own domain connected via Cloudflare for SaaS (one CNAME, auto-HTTPS).
Host-based serving resolves either to the right site; the whole app layer is complete.

**Staff operations (Clay, role-gated).** Clay can now help the team RUN the platform, not just
talk about it — one Clay whose staff tools are gated by role. Staff (e.g. Kennedy): platform pulse,
marketplace review + decisions on policy grounds, report moderation, and health checks. Admins add
account suspend/reinstate. Owners (Vission, Rel) add `manage_staff` to onboard the team. Regular
builders are never offered a staff tool; every platform-changing action needs explicit confirmation
and is refused at the executor if the role disallows it. The consequential listing decision is shared
by the review route and Clay via `services/moderationCore.js` so it can't drift. Desk stories were
rebuilt with a bigger topic pool and rotating narrative lenses so they stop feeling stale.

A step-by-step **Cloudflare activation guide for Brandon** is delivered separately
(Cloudflare-Activation-Access-YP-Labs.docx) covering the zone, the `*.sites` wildcard + certificate,
Cloudflare for SaaS, the API token, and the Railway env vars.

Infra: `site_pages` table (migration 025, live); `site_domains` table (migration 026, live);
`launch_page` jsonb now carries `theme`, `hero_image`, `published_at`. 184 tests passing.

---

## Next unlocks (and what each takes)

### 1. Image upload — small lift, no new infrastructure
Today images work by URL (`![alt](https://...)`). Next: let creators upload images from the
Laboratory to **Supabase Storage** (already in our stack) and get a URL back. Needs: a Storage
bucket, an upload endpoint, and a small file-picker in the site manager. This is the cheapest
quality jump after themes.

### 2. Custom domains — app layer SHIPPED; needs the Cloudflare switch-on (one-time, YP)
The whole application side is built: instant subdomains, a "connect your domain" flow that calls
Cloudflare for SaaS and shows the creator the single CNAME to add, a status re-check, and Host-based
serving so a subdomain or a custom domain resolves to the right site.

To switch it on in production, one time:
1. Put the app behind Cloudflare (the accessyplabs.com zone on Cloudflare).
2. Enable **Cloudflare for SaaS** (custom hostnames) on that zone.
3. Create the SaaS fallback origin / CNAME target and set env `CF_CNAME_TARGET` to it — this is what
   creators point their domain's CNAME at. Add a wildcard DNS record `*.sites.accessyplabs.com` → the
   app so instant subdomains resolve (Cloudflare issues the wildcard cert).
4. Set env `CF_API_TOKEN` (permission to edit custom hostnames) and `CF_ZONE_ID`. Optional: `SITES_ROOT`
   (default `sites.accessyplabs.com`) and `APP_HOSTS` (any extra main-app hostnames).

Until those are set, the "connect your own domain" button honestly says custom domains aren't switched
on yet; subdomains go live as soon as the wildcard DNS record exists.

### 3. The $2.99/month "more websites" add-on — billing
The quota gate is built and an active `site_addon` subscription already lifts it. Remaining: a Stripe
Checkout/subscription for the add-on and the webhook that flips `site_addon` active/inactive — the
same pattern as the existing Maker/Sculptor plans.

### 4. Richer content + better export
More blocks (columns, image galleries, embeds — e.g. a booking-widget embed block for property
sites). Multi-file export (separate HTML files + assets) as a zip, once we add a zip dependency;
today export is one self-contained file.

### 5. App-builder handoff, deepened
Beyond advising, Clay could generate a starter spec or scaffold to hand to Claude Code, making the
"go build the app, and own it" path concrete — without us hosting the app.

---

## Principles that don't move
- **Brand wall is absolute** — this is Access YP Labs / Clay only; never mixes with Access Your
  Place / Penny or Access YP Flow / Arbo.
- **Own everything** — creators can always export and leave. We earn by being the best place to
  build and run, not by lock-in.
- **Honesty over hype** — Clay tells the real trade-offs (app builders, lock-in, difficulty), never
  flatters, never fabricates.
- **Accessibility first-class** — every control speakable and reachable by VoiceOver; content
  renders as clean, linear, readable pages.
- **Proof is behavior** — a published site with real signups is proof; a plan is not.
