// PENNY'S WORKSPACE TOOLS — how she answers "what do I owe?"
//
// Every one of these is a read or a write against the spine. None of them asks a model to work
// anything out. That is the point: the ranked list is arithmetic, and arithmetic should not be
// probabilistic. Penny's job is to SAY it, not to compute it.
//
// THE RULE THAT GOVERNS EVERY EXECUTOR IN THIS FILE:
//
//   Penny inherits the permissions of whoever she is talking to. Not filtered output — the check
//   happens before the data is read, and when the answer is no she says what exists, that it is
//   restricted, and who can grant it.
//
//   A screen that hides a number is not a permission if Penny will say it out loud. She is a second
//   way into the same data and the check has to hold here too.
//
// AND THE HONESTY RULE INHERITED FROM ARBO:
//
//   Every result is classified — answered, empty, unavailable or refused. A failed read is never a
//   zero. "You have nothing due" and "I could not read your obligations" are different sentences and
//   collapsing them is the single most dangerous thing this product could do, because the first one
//   closes the door on work the person then does not do.

const { query } = require('../../config/db');
const P = require('../../lib/permissions');
const R = require('../../lib/ranking');
const D = require('./documents');
const C = require('./customers');
const Bld = require('./builder');
const Files = require('./files');
const Portal = require('./portal');

// Result shapes. Borrowed from Arbo, where they exist because an unread balance once printed as
// "$0.00" — indistinguishable from the money being gone.
const answered = (data, says) => ({ status: 'answered', ...data, says });
const empty = (says) => ({ status: 'empty', says });
const unavailable = (reason, says) => ({ status: 'unavailable', reason, says });
const refused = (says) => ({ status: 'refused', says });

const TOOLS = {
  whats_due: {
    irreversible: false, requires_confirmation: false, required: [], optional: ['business_id', 'horizon_days'], enums: {},
    summary: 'What the person owes right now across every business they can see, ranked by what missing each thing costs. Read-only.',
  },
  whats_coming: {
    irreversible: false, requires_confirmation: false, required: [], optional: ['business_id', 'days'], enums: {},
    summary: 'What falls due over the next stretch of days, in date order. Read-only.',
  },
  list_businesses: {
    irreversible: false, requires_confirmation: false, required: [], enums: {},
    summary: 'The businesses this person runs or has been given access to. Read-only.',
  },
  record_obligation: {
    irreversible: false,
    requires_confirmation: false,
    required: ['business_id', 'kind', 'title'],
    optional: ['detail', 'counterparty', 'counterparty_kind', 'due_at', 'cost_if_missed_cents',
      'cost_basis', 'consequence', 'recurs_every'],
    enums: {
      kind: ['filing', 'licence', 'permit', 'registration', 'insurance', 'tax', 'task', 'promise',
        'invoice_out', 'invoice_in', 'renewal', 'meeting', 'other'],
      counterparty_kind: ['government', 'customer', 'supplier', 'employee', 'contractor', 'landlord', 'self', 'other'],
      cost_basis: ['known', 'estimated', 'unknown'],
    },
    summary: 'Record something the business owes — a filing, a task, a promise, an invoice to send.',
  },
  whats_missing: {
    irreversible: false, requires_confirmation: false, required: ['business_id'], enums: {},
    summary: 'What documents should be on file for a business and are not, plus anything expired or '
      + 'expiring. Read-only.',
  },
  whats_outstanding_with_customers: {
    irreversible: false, requires_confirmation: false, required: ['business_id'], enums: {},
    summary: 'What you owe customers and what customers owe you, by person, with anything late '
      + 'first. Read-only.',
  },
  start_build: {
    // Both questions are enforced here, not only in the prompt. Without tier the executor starts
    // nothing and returns a recommendation with reasons; without mock_first it returns that question.
    irreversible: false, requires_confirmation: false,
    required: ['business_id', 'asked_for'], optional: ['kind', 'tier', 'mock_first', 'edit_of'],
    enums: { kind: ['page', 'site', 'portal', 'form', 'tool', 'automation', 'other'],
      tier: ['labs_site', 'labs_portal', 'custom_app'], mock_first: ['yes', 'no'] },
    summary: 'Build or change a site, page, form or app. Call first without tier: it returns a '
      + 'recommendation and reasons. Explain the homes: labs_site is hosted here (landing page, '
      + 'wedding site, quote form); labs_portal is the customer portal (not built yet); custom_app '
      + 'is a web app with its own backend on their own accounts. Suggest the smallest that works, '
      + 'then ask which they want. Then ask if they want a mock-up first. Never assume either. '
      + 'edit_of changes a finished build and keeps its home. Takes a minute or two.',
  },
  publish_build: {
    irreversible: false, requires_confirmation: true,
    required: ['build_id', 'address'], optional: ['online'], enums: { online: ['yes', 'no'] },
    summary: 'Put a finished Labs-hosted site online at accessyplabs.com/s/<address>, or take it '
      + 'offline with online no. Only real builds hosted on Labs; custom apps go live on the '
      + 'client\'s own accounts, which is not switched on yet.',
    ask: 'Put this site online at the address shown, where anyone with the link can open it.',
  },
  portal_status: {
    irreversible: false, requires_confirmation: false, required: ['business_id'], enums: {},
    summary: 'The customer portal for a business: its address, whether it is open, its current '
      + 'settings (title, welcome, colour, sections in order, request fields, links), the allowed '
      + 'sections and colours, and its customers. Read-only. Read this before customize_portal.',
  },
  customize_portal: {
    irreversible: false, requires_confirmation: false,
    required: ['business_id', 'config_json'], optional: ['asked_for'], enums: {},
    summary: 'Change the customer portal. config_json is a JSON object with any of: title, welcome, '
      + 'accent, sections (list of {type, title, on} in order), request ({intro, fields: [{label, '
      + 'kind, required}]}), links ([{label, url}]). Pass the person\'s words as asked_for. Report '
      + 'what the result says it could not apply. If it says the request needs a backend, explain '
      + 'that is a custom web application and offer to build it with start_build.',
  },
  list_builds: {
    irreversible: false, requires_confirmation: false, required: ['business_id'], enums: {},
    summary: 'What has been built for a business, what is still building, and the address to open '
      + 'each finished one. Read-only.',
  },
  list_files: {
    irreversible: false, requires_confirmation: false, required: ['business_id'], enums: {},
    summary: 'The files and photos a business keeps, newest first, with each photo\'s description '
      + 'and who wrote it, and any share links still open. Read-only.',
  },
  complete_obligation: {
    // Reversible in the sense that it can be reopened, but it moves a real thing off the list and a
    // recurring one forward a year, so it is confirmed rather than assumed from a passing remark.
    irreversible: false, requires_confirmation: true, required: ['obligation_id'], enums: {},
    summary: 'Mark something done. Recurring things come back with their next date.',
    // Two audiences, two strings. `summary` is written to the model about when it may act; `ask` is
    // the sentence a person reads at the moment they say yes. Handing the first to the second is a
    // paragraph of instructions addressed to somebody else, arriving exactly when a decision is
    // being asked for — and through a screen reader it is read out in full.
    ask: 'Mark this off as done. If it is something that repeats, the next one will be set up with its new date.',
  },
};

// --------------------------------------------------------------------------- executors

async function whats_due(viewer, params = {}) {
  try {
    const businessIds = params.business_id ? [params.business_id] : null;
    const rows = await R.rankedToday(viewer.id, {
      businessIds,
      horizonDays: Math.min(365, Math.max(1, parseInt(params.horizon_days, 10) || R.DEFAULT_HORIZON_DAYS)),
    });
    if (!rows.length) {
      // A real answer, and it has to be distinguishable from a failed read. See unavailable() below.
      return empty('Nothing is due. Nothing overdue either.');
    }
    return answered({
      count: rows.length,
      overdue: rows.filter((r) => r.overdue).length,
      items: rows.map((r) => ({
        id: r.id, title: r.title, business: r.business_name, kind: r.kind,
        due_at: r.due_at, cost_if_missed_cents: r.cost_if_missed_cents,
        cost_basis: r.cost_basis, overdue: r.overdue, says: R.explain(r),
      })),
    }, R.summarise(rows));
  } catch (e) {
    return unavailable(e.message,
      'I could not read your obligations just now, so I do not know what is due. That is a failure '
      + 'on my side rather than an empty list — do not take it as nothing being owed.');
  }
}

async function whats_coming(viewer, params = {}) {
  try {
    const days = Math.min(365, Math.max(1, parseInt(params.days, 10) || 30));
    const rows = await R.coming(viewer.id, {
      days, businessIds: params.business_id ? [params.business_id] : null,
    });
    if (!rows.length) return empty('Nothing falls due in the next ' + days + ' days.');
    return answered({ days, count: rows.length, items: rows.map((r) => ({
      id: r.id, title: r.title, business: r.business_name, due_at: r.due_at, says: R.explain(r),
    })) }, rows.length + ' thing' + (rows.length === 1 ? '' : 's') + ' in the next ' + days + ' days.');
  } catch (e) {
    return unavailable(e.message, 'I could not read what is coming up. Treat that as unknown rather than clear.');
  }
}

async function list_businesses(viewer) {
  try {
    const rows = await P.myBusinesses(viewer.id);
    if (!rows.length) {
      return empty('You have not told me about a business yet. Tell me what you do and where, and I will take it from there.');
    }
    return answered({ count: rows.length, businesses: rows },
      rows.length === 1 ? rows[0].name + '.'
        : rows.length + ' businesses: ' + rows.map((b) => b.name).join(', ') + '.');
  } catch (e) {
    return unavailable(e.message, 'I could not read your businesses just now.');
  }
}

async function record_obligation(viewer, params = {}) {
  const area = R.KIND_AREA[params.kind] || 'projects';
  const gate = await P.can(viewer.id, params.business_id, area, 'act');
  if (!gate.ok) {
    return refused(P.refusalLine(gate, area, gate.perms && gate.perms.business.name));
  }
  // A cost without a basis is refused by the database. Penny should never learn this by throwing.
  if (params.cost_if_missed_cents != null && !params.cost_basis) {
    return refused('I can record that, but not with a number on it unless you tell me whether that '
      + 'is a known figure or your estimate. A cost I cannot explain is one you should not trust.');
  }
  try {
    const r = await query(
      `INSERT INTO obligations (business_id, kind, title, detail, counterparty, counterparty_kind,
          due_at, recurs_every, cost_if_missed_cents, cost_basis, consequence, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'penny') RETURNING *`,
      [params.business_id, params.kind, String(params.title).trim(), params.detail || null,
        params.counterparty || null, params.counterparty_kind || null, params.due_at || null,
        params.recurs_every || null, params.cost_if_missed_cents ?? null,
        params.cost_basis || null, params.consequence || null]);
    const row = Object.assign({}, r.rows[0],
      { overdue: r.rows[0].due_at && new Date(r.rows[0].due_at) < new Date() });
    // Report what the tool SAVED, never what it was told. Penny once confirmed an $8,000 deal that
    // was never written, because the tool had no field for the asking price and dropped it silently.
    return answered({ obligation: row }, 'Recorded: ' + row.title + '. ' + R.explain(row));
  } catch (e) {
    return unavailable(e.message, 'I could not save that. It is not recorded — please do not assume it is.');
  }
}

async function complete_obligation(viewer, params = {}) {
  let cur;
  try {
    cur = await query('SELECT * FROM obligations WHERE id=$1', [params.obligation_id]);
  } catch (e) {
    return unavailable(e.message, 'I could not reach that to mark it done.');
  }
  if (!cur.rows.length) return refused('I cannot find that one.');
  const o = cur.rows[0];
  const area = R.KIND_AREA[o.kind] || 'projects';
  const gate = await P.can(viewer.id, o.business_id, area, 'act');
  if (!gate.ok) return refused(P.refusalLine(gate, area, gate.perms && gate.perms.business.name));
  if (o.status === 'done') return answered({ obligation: o }, 'That one was already done.');

  try {
    await query('UPDATE obligations SET status=$1, completed_at=now(), updated_at=now() WHERE id=$2',
      ['done', o.id]);
    let next = null;
    if (o.recurs_every && o.due_at) {
      const n = await query(
        `INSERT INTO obligations (business_id, subject_id, kind, title, detail, counterparty,
            counterparty_kind, due_at, recurs_every, cost_if_missed_cents, cost_basis, cost_note,
            consequence, source, source_ref)
         SELECT business_id, subject_id, kind, title, detail, counterparty, counterparty_kind,
                due_at + recurs_every, recurs_every, cost_if_missed_cents, cost_basis, cost_note,
                consequence, source, source_ref
           FROM obligations WHERE id=$1 RETURNING *`, [o.id]);
      next = n.rows[0];
    }
    return answered({ done: true, next },
      next ? o.title + ' is done. The next one is due ' + new Date(next.due_at).toISOString().slice(0, 10) + '.'
        : o.title + ' is done.');
  } catch (e) {
    return unavailable(e.message, 'I could not mark that done. It is still open.');
  }
}

// Documents are read under the documents area, not compliance — a bookkeeper with documents:view
// should be able to see that a W-9 is missing without being shown the filings.
async function whats_missing(viewer, params = {}) {
  const gate = await P.can(viewer.id, params.business_id, 'documents', 'view');
  if (!gate.ok) return refused(P.refusalLine(gate, 'documents', gate.perms && gate.perms.business.name));
  const r = await D.missingFor(params.business_id);
  if (!r.ok) {
    return unavailable(r.reason,
      'I could not check what is on file, so I do not know what is missing. Treat that as unknown '
      + 'rather than as nothing missing — an empty shelf and a failed look are different things.');
  }
  if (!r.missing.length && !r.expired.length && !r.expiring.length) return empty(r.says);
  return answered({ missing: r.missing, expired: r.expired, expiring: r.expiring,
    on_file: r.on_file }, r.says);
}

async function whats_outstanding_with_customers(viewer, params = {}) {
  const gate = await P.can(viewer.id, params.business_id, 'customers', 'view');
  if (!gate.ok) {
    return refused(P.refusalLine(gate, 'customers', gate.perms && gate.perms.business.name));
  }
  const r = await C.forBusiness(params.business_id);
  if (!r.ok) {
    return unavailable(r.reason,
      'I could not read what is outstanding with customers, so I do not know. That is different '
      + 'from there being nothing outstanding.');
  }
  if (!r.customers.length) return empty(r.says);
  return answered({ customers: r.customers }, r.says);
}

async function start_build(viewer, params = {}) {
  const r = await Bld.start(viewer, params);
  if (r.ok && r.needs === 'tier_choice') {
    return { status: 'needs_answer', recommended: r.recommended,
      says: 'Nothing has started. Explain this to them in your own words and ask where it should '
        + 'live: ' + r.says };
  }
  if (r.ok && r.needs === 'mock_choice') {
    return { status: 'needs_answer', question: r.question,
      says: 'Nothing has started. Ask them this, word for word, and wait for the answer: '
        + r.question };
  }
  if (!r.ok) {
    if (r.kind === 'refused') return refused(r.says);
    if (r.kind === 'unclear') return { status: 'needs_answer', says: r.says };
    return unavailable('build_not_started', r.says);
  }
  // Generation runs in the background; required lazily so the tool list loads without a model.
  require('./buildGen').kick(r.build.id);
  return answered({ build_id: r.build.id, stage: r.build.stage, status: r.build.status }, r.says);
}

async function publish_build(viewer, params = {}) {
  const r = params.online === 'no'
    ? await Bld.unpublish(viewer, { build_id: params.build_id })
    : await Bld.publish(viewer, { build_id: params.build_id, address: params.address,
      origin: (process.env.CLIENT_URL || 'https://accessyplabs.com') });
  if (!r.ok) {
    if (r.kind === 'refused') return refused(r.says);
    if (r.kind === 'unclear') return { status: 'needs_answer', says: r.says };
    return unavailable('publish_failed', r.says);
  }
  return answered({ url: r.url || null }, r.says);
}

async function portal_status(viewer, params = {}) {
  const r = await Portal.get(viewer, params.business_id);
  if (!r.ok) return r.kind === 'refused' ? refused(r.says) : unavailable('portal_unreadable', r.says);
  const c = await Portal.customers(viewer, params.business_id);
  return answered({
    address: r.portal.url, open: r.portal.is_open, config: r.portal.config,
    allowed_sections: Object.keys(r.sections), allowed_colours: Object.keys(r.accents),
    field_kinds: r.field_kinds, limits: r.limits,
    customers: c.ok ? c.customers.map((x) => ({ name: x.name, signed_in: !!x.last_seen_at, waiting: x.waiting > 0 })) : null,
  }, r.says + (c.ok ? ' ' + c.says : ' I could not read the customer list.'));
}

async function customize_portal(viewer, params = {}) {
  let changes;
  try { changes = JSON.parse(params.config_json || '{}'); } catch (_) {
    return { status: 'needs_answer', says: 'That change was not in a form I could read, so nothing was saved.' };
  }
  const r = await Portal.customise(viewer, params.business_id, { changes, asked_for: params.asked_for });
  if (!r.ok) return r.kind === 'refused' ? refused(r.says) : unavailable('portal_not_saved', r.says);
  return answered({ ignored: r.ignored, needs_custom_app: r.beyond }, r.says);
}

async function list_builds(viewer, params = {}) {
  const r = await Bld.listFor(viewer, params.business_id);
  if (!r.ok) {
    return r.kind === 'refused' ? refused(r.says) : unavailable('builds_unreadable', r.says);
  }
  if (!r.builds.length) return empty(r.says);
  return answered({ builds: r.builds.map((b) => ({
    id: b.id, stage: b.stage, status: b.status, asked_for: b.asked_for,
    open_at: b.status === 'ready' ? b.preview_url : null,
    home: b.tier, online_at: b.published_slug ? '/s/' + b.published_slug : null,
    why_not_ready: b.status === 'failed' ? b.says : null,
  })) }, r.says);
}

async function list_files(viewer, params = {}) {
  const r = await Files.list(viewer, params.business_id);
  if (!r.ok) return r.kind === 'refused' ? refused(r.says) : unavailable('files_unreadable', r.says);
  if (!r.files.length) return empty(r.says);
  return answered({ files: r.files.slice(0, 50).map((f) => ({
    id: f.id, name: f.name, kind: f.kind, added: f.created_at,
    description: f.description, described_by: f.description_by,
    open_links: (f.shares || []).map((s) => ({ with: s.shared_with, until: s.expires_at, opens: s.opens })),
  })) }, r.says);
}

const EXECUTORS = { whats_due, whats_coming, list_businesses, record_obligation,
  complete_obligation, whats_missing, whats_outstanding_with_customers, start_build, publish_build, list_builds, list_files,
  portal_status, customize_portal };

module.exports = { TOOLS, EXECUTORS, answered, empty, unavailable, refused };
