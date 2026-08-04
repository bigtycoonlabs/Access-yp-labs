-- 026_site_domains.sql
-- Web addresses for a concept's site. Two kinds:
--   'subdomain' — instant, free, on our platform: <label>.sites.accessyplabs.com (active at once).
--   'custom'    — the creator's own domain via Cloudflare for SaaS (pending until Cloudflare
--                 validates ownership + issues TLS, then active).
CREATE TABLE IF NOT EXISTS site_domains (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id     uuid NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  owner_id       uuid NOT NULL,
  hostname       text NOT NULL,
  kind           text NOT NULL,                 -- 'subdomain' | 'custom'
  status         text NOT NULL DEFAULT 'pending', -- 'pending' | 'active'
  cf_hostname_id text,                           -- Cloudflare custom hostname id (custom only)
  verification   jsonb,                          -- DNS records to show the creator (custom only)
  created_at     timestamptz NOT NULL DEFAULT NOW(),
  updated_at     timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT site_domains_hostname_unique UNIQUE (hostname)
);
CREATE INDEX IF NOT EXISTS site_domains_concept_idx ON site_domains(concept_id);
CREATE INDEX IF NOT EXISTS site_domains_active_idx ON site_domains(hostname) WHERE status='active';
