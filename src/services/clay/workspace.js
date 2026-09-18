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
const Keys = require('./keys');
const Launcher = require('./launcher');
const Compliance = require('./complianceResearch');
const Flow = require('./flowLink');
const Notes = require('./notes');

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
  write_document: {
    irreversible: false, requires_confirmation: false,
    required: ['business_id', 'name', 'text'], optional: ['description'], enums: {},
    summary: 'Write something into this business\'s documents so it is on file and you can read it '
      + 'back later: notes from a conversation, a policy, a checklist, a summary of a call, anything '
      + 'worth keeping. It is saved as a real document the person can read, share or delete. Prefer '
      + 'this over trying to hold a long thing in mind.',
  },
  write_spreadsheet: {
    irreversible: false, requires_confirmation: false,
    required: ['business_id', 'name', 'rows'], optional: ['format', 'description'], enums: { format: ['xlsx', 'csv'] },
    summary: 'Make a spreadsheet and save it in this business\'s documents: a shopping list, a price '
      + 'list, a schedule, anything with rows. rows is a list of rows, each one a list of cells, with '
      + 'the headings as the first row. format is xlsx unless they asked for csv.',
  },
  read_document: {
    irreversible: false, requires_confirmation: false,
    required: ['file_id'], optional: [], enums: {},
    summary: 'Read one of their files, by its id from list_files: a text document, a PDF, a '
      + 'spreadsheet or a CSV comes back as words, and a photo comes back as what can be seen in it. '
      + 'A scan with no text in it says so rather than being guessed at. Always read the file before '
      + 'answering a question about what it says.',
  },
  remember_this: {
    irreversible: false, requires_confirmation: false,
    required: ['note'], optional: ['business_id'], enums: {},
    summary: 'Keep something this person told you, in their own words, so you work that way in every '
      + 'later conversation: how they like things done, what their business is, what to do without '
      + 'asking, what never to do. Only what they actually said, never something you worked out about '
      + 'them. Leave business_id off when it is about them rather than one business.',
  },
  what_you_know: {
    irreversible: false, requires_confirmation: false,
    required: [], optional: [], enums: {},
    summary: 'Everything this person has told you to keep in mind, so they can hear it and change it. '
      + 'Read-only.',
  },
  forget_this: {
    irreversible: false, requires_confirmation: false,
    required: ['what'], optional: [], enums: {},
    summary: 'Drop something you were told to keep in mind. what is its id, or enough of its words to '
      + 'find it. Say what was dropped.',
  },
  connect_flow: {
    irreversible: false, requires_confirmation: false,
    required: ['email'], optional: [], enums: {},
    summary: 'Connect this person\'s YP Flow account, where their money lives with Arbo, so invoices '
      + 'can be handed over. email is the address on their YP Flow account. YP Flow emails them to '
      + 'confirm; they decide, not us. Say what it answered, including that no account exists if '
      + 'that is what it says.',
  },
  flow_status: {
    irreversible: false, requires_confirmation: false,
    required: ['email'], optional: [], enums: {},
    summary: 'Whether a YP Flow account is connected to this one: connected, waiting on their '
      + 'confirmation email, not connected, or no account at that address. Read-only.',
  },
  send_invoice_to_flow: {
    irreversible: false, requires_confirmation: true,
    required: ['email', 'counterparty', 'label', 'amount_usd'], optional: ['due_date'], enums: {},
    summary: 'Hand an invoice to Arbo in YP Flow: who owes it, what it is for, how much in dollars, '
      + 'and when it is due. Never invent the amount or who owes it; ask. It arrives in YP Flow '
      + 'awaiting their confirmation there and is not counted as money until they confirm it, so '
      + 'say that rather than telling them their books already show it.',
    ask: 'Shall I send this to YP Flow? It goes to Arbo as an invoice waiting for you to confirm it '
      + 'there, and until you do it is not counted as money you can spend.',
  },
  add_business: {
    irreversible: false, requires_confirmation: false,
    required: ['name'], optional: ['entity_type', 'formation_state', 'operating_states', 'city', 'trade', 'employees'],
    enums: { entity_type: ['sole_proprietor', 'llc', 's_corp', 'c_corp', 'partnership', 'nonprofit', 'other'] },
    summary: 'Put a business on file for this person when they describe one and want it set up. Give '
      + 'whatever they said: name, entity type, formation state, other states it works in, the city it '
      + 'runs from, what it does, and how many employees besides the owner. Never guess a detail they '
      + 'did not give. Check list_businesses first so the same business is not added twice.',
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
  research_compliance: {
    irreversible: false, requires_confirmation: false, required: ['business_id'],
    optional: ['action', 'area', 'question', 'fresh'],
    enums: { action: ['start', 'status'], area: ['all', 'formation', 'state_tax', 'sales_tax', 'employer', 'local_license',
      'trade_license', 'permits', 'federal'], fresh: ['yes', 'no'] },
    summary: 'Research a business\'s legal and tax requirements live on the web, with the pages each '
      + 'answer came from. The only source for compliance answers: never answer them from memory. '
      + 'action start (default) with area (all for the whole picture) or a question: answers at once '
      + 'if researched in the last 30 days, otherwise starts research that takes several minutes and '
      + 'says so. action status: what has been found so far and whether research is still running. '
      + 'fresh yes searches again.',
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
      + 'client\'s own accounts with launch_build.',
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
    required: ['business_id'], optional: ['config_json', 'asked_for', 'address', 'open'],
    enums: { open: ['yes', 'no'] },
    summary: 'Change the customer portal. config_json is a JSON object with any of: title, welcome, '
      + 'accent, signup (open, approve or off: who can create their own account), sections (list of {type, title, on} in order), request ({intro, fields: [{label, '
      + 'kind, required}]}), links ([{label, url}]). Pass the person\'s words as asked_for. Report '
      + 'what the result says it could not apply. If it says the request needs a backend, explain '
      + 'that is a custom web application and offer to build it with start_build. address gives the '
      + 'portal its web address (letters, numbers and dashes); open yes lets customers reach it, open '
      + 'no takes it down. A portal with no address or not open cannot be reached, so say which is missing.',
  },
  list_keys: {
    irreversible: false, requires_confirmation: false, required: ['business_id'], enums: {},
    summary: 'Which keys (GitHub, Railway, Supabase) a business has on file, what each was checked to '
      + 'reach, and when each is due to be replaced. Never the keys themselves. Read-only.',
  },
  launch_build: {
    irreversible: false, requires_confirmation: true,
    required: ['build_id', 'step'], optional: ['repo_name'], enums: { step: ['status', 'code', 'hosting', 'check'] },
    summary: 'Take a finished custom web application onto the person\'s own accounts, one step at a '
      + 'time. status says where it stands and what is next. code creates a private repository on '
      + 'their GitHub with the app. hosting starts it on their Railway (may not be switched on). '
      + 'check opens the live address. Until check passes, it is not live; say so.',
    ask: 'Go ahead with this step. It creates something in your own account.',
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
  // The database refuses a cost with no basis. Rather than refuse the whole reminder, an unexplained
  // cost is recorded as unknown and said to be unknown, and a cost that is not a number is dropped
  // and said to be dropped. Refusing outright lost a real reminder in the live walk (17 Sept 2026).
  let cost = params.cost_if_missed_cents == null || params.cost_if_missed_cents === '' ? null
    : Number(params.cost_if_missed_cents);
  const costUnreadable = cost !== null && !Number.isFinite(cost);
  if (costUnreadable) cost = null;
  const BASES = ['known', 'estimated', 'unknown'];
  const basis = cost === null ? (BASES.includes(params.cost_basis) ? params.cost_basis : null)
    : (BASES.includes(params.cost_basis) ? params.cost_basis : 'unknown');
  try {
    const r = await query(
      `INSERT INTO obligations (business_id, kind, title, detail, counterparty, counterparty_kind,
          due_at, recurs_every, cost_if_missed_cents, cost_basis, consequence, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'penny') RETURNING *`,
      [params.business_id, params.kind, String(params.title).trim(), params.detail || null,
        params.counterparty || null, params.counterparty_kind || null, params.due_at || null,
        params.recurs_every || null, cost, basis, params.consequence || null]);
    const row = Object.assign({}, r.rows[0],
      { overdue: r.rows[0].due_at && new Date(r.rows[0].due_at) < new Date() });
    // Report what the tool SAVED, never what it was told. Penny once confirmed an $8,000 deal that
    // was never written, because the tool had no field for the asking price and dropped it silently.
    let note = '';
    if (costUnreadable) note = ' I left the missed cost off, because what you gave me was not an amount.';
    else if (cost !== null && !BASES.includes(params.cost_basis)) note = ' The cost is recorded with its basis as unknown, because nobody has said where that figure comes from.';
    return answered({ obligation: row }, 'Recorded: ' + row.title + '. ' + R.explain(row) + note);
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
async function research_compliance(viewer, params = {}) {
  if (params.action === 'status') {
    const st = await Compliance.status(viewer, params.business_id);
    if (!st.ok) return st.kind === 'refused' ? refused(st.says) : unavailable('research_status_failed', st.says);
    if (!st.research.length) return empty(st.says);
    const day = (d) => String(d && d.toISOString ? d.toISOString() : d).slice(0, 10);
    const run = st.run && { status: st.run.status, says: st.run.says };
    // One area in full, when asked for; otherwise one line per area, so the whole picture fits.
    if (params.area && params.area !== 'all') {
      const x = st.research.find((r) => r.area === params.area);
      // Nothing under that heading does not mean nothing was found: a single question is filed as a
      // question, not as an area, and answering "nothing" hid a real finding in the live walk.
      if (!x) {
        if (!st.research.length) return empty('Nothing has been researched for this business yet. ' + st.says);
        return answered({ run, asked_about: params.area, not_researched_as_its_own_area: true,
          found_instead: st.research.map((r) => ({ area: r.area,
            question: r.area === 'question' ? String(r.question).slice(0, 200) : undefined,
            in_short: Compliance.shortOf(r.answer), has_government_source: r.official,
            main_source: r.sources[0] && { title: String(r.sources[0].title).slice(0, 100), url: r.sources[0].url },
            searched_on: day(r.searched_at) })) },
          params.area + ' has not been researched as its own area. Here is what has been found, which may cover it.');
      }
      return answered({ run, area: x.area, answer: String(x.answer).slice(0, 6000), sources: x.sources,
        has_government_source: x.official, searched_on: day(x.searched_at) }, st.says);
    }
    const found = st.research.map((x) => x.area);
    return answered({ run,
      overview: st.research.map((x) => ({ area: x.area,
        question: x.area === 'question' ? String(x.question).slice(0, 200) : undefined,
        in_short: Compliance.shortOf(x.answer), has_government_source: x.official,
        main_source: x.sources[0] && { title: String(x.sources[0].title).slice(0, 100), url: x.sources[0].url },
        searched_on: day(x.searched_at) })),
      not_yet_found: Compliance.AREA_NAMES.filter((a) => !found.includes(a)),
      note: 'in_short is a summary. An area in not_yet_found was never researched as its own area; a '
        + 'finding may still mention it, so say "not researched on its own yet", never "not required".',
      detail: 'Ask for one area with action status and that area to hear it in full with every source.',
    }, st.says);
  }
  const r = await Compliance.start(viewer, {
    business_id: params.business_id,
    areas: params.question ? null : [params.area || 'all'],
    question: params.question,
    fresh: params.fresh === 'yes',
  });
  if (!r.ok) return r.kind === 'refused' ? refused(r.says) : unavailable('research_failed', r.says);
  if (!r.ready) return answered({ started: true, business: r.business }, r.says);
  return answered({
    business: r.business, missing_facts: r.missing_facts,
    findings: r.results.map((x) => ({ area: x.area, answer: x.answer, sources: x.sources,
      has_government_source: x.official, searched_on: String(x.searched_at && x.searched_at.toISOString ? x.searched_at.toISOString() : x.searched_at).slice(0, 10) })),
  }, r.says);
}

const STATE_NAMES = { alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE',
  nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
  'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
  washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY' };
const STATE_CODES = new Set(Object.values(STATE_NAMES));
// "Texas", "tx" or "TX" → "TX"; anything else → null, never a guess.
function stateCode(v) {
  const t = String(v || '').trim();
  if (!t) return null;
  if (STATE_CODES.has(t.toUpperCase())) return t.toUpperCase();
  return STATE_NAMES[t.toLowerCase()] || null;
}

async function add_business(viewer, params = {}) {
  const name = String(params.name || '').trim().slice(0, 120);
  if (!name) return { status: 'needs_answer', says: 'What is the business called?' };
  const dupe = (await query(
    `SELECT id, name FROM businesses WHERE owner_id=$1 AND lower(name)=lower($2) AND archived_at IS NULL LIMIT 1`,
    [viewer.id, name])).rows[0];
  if (dupe) return answered({ business_id: dupe.id, name: dupe.name, already_on_file: true }, dupe.name + ' is already on file, so I did not add it again.');
  const formed = stateCode(params.formation_state);
  if (params.formation_state && !formed) {
    return { status: 'needs_answer', says: 'Which US state was it formed in? I did not recognise "' + String(params.formation_state).slice(0, 40) + '".' };
  }
  const others = (Array.isArray(params.operating_states) ? params.operating_states : String(params.operating_states || '').split(','))
    .map(stateCode).filter(Boolean);
  const operating = [...new Set([formed, ...others].filter(Boolean))];
  const city = String(params.city || '').trim().slice(0, 120);
  const employees = params.employees === undefined || params.employees === null || params.employees === '' ? null
    : Math.max(0, Math.min(100000, parseInt(params.employees, 10)));
  const entity = TOOLS.add_business.enums.entity_type.includes(params.entity_type) ? params.entity_type : null;
  const r = await query(
    `INSERT INTO businesses (owner_id, name, entity_type, formation_state, operating_states, localities, trade, headcount, stage)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'running') RETURNING id, name`,
    [viewer.id, name, entity, formed, operating, city ? [city] : [], String(params.trade || '').trim().slice(0, 120) || null,
      // headcount cannot be empty in the database. When nobody said, it is saved as none and the
      // person is told that was assumed, so compliance is never quietly based on a guess.
      Number.isFinite(employees) ? employees : 0]);
  const missing = [];
  if (!entity) missing.push('what kind of entity it is');
  if (!formed) missing.push('which state it was formed in');
  if (!city) missing.push('which city it runs from');
  if (!params.trade) missing.push('what it does');
  const assumed = !Number.isFinite(employees);
  return answered({ business_id: r.rows[0].id, name: r.rows[0].name, missing, assumed_no_employees: assumed },
    r.rows[0].name + ' is on file now.' + (missing.length ? ' I still do not know ' + missing.join(', ') + '.' : '')
    + (assumed ? ' I have noted no employees besides the owner for now; say so if that is wrong, because it changes what is owed.' : ''));
}

async function write_document(viewer, params = {}) {
  const r = await Files.write(viewer, { business_id: params.business_id, name: params.name,
    text: params.text, description: params.description });
  if (!r.ok) return r.kind === 'refused' ? refused(r.says) : r.kind === 'unclear'
    ? { status: 'needs_answer', says: r.says } : unavailable('document_not_saved', r.says);
  return answered({ file_id: r.file.id, name: r.file.name, bytes: r.file.bytes }, r.says);
}

async function write_spreadsheet(viewer, params = {}) {
  const r = await Files.writeSheet(viewer, { business_id: params.business_id, name: params.name,
    rows: params.rows, format: params.format, description: params.description });
  if (!r.ok) return r.kind === 'refused' ? refused(r.says) : r.kind === 'unclear'
    ? { status: 'needs_answer', says: r.says } : unavailable('sheet_not_saved', r.says);
  return answered({ file_id: r.file.id, name: r.file.name, bytes: r.file.bytes }, r.says);
}

async function read_document(viewer, params = {}) {
  const r = await Files.read(viewer, String(params.file_id || ''));
  if (!r.ok) {
    if (r.kind === 'refused') return refused(r.says);
    if (r.kind === 'empty') return empty(r.says);
    return unavailable('document_unreadable', r.says);
  }
  return answered({ name: r.name, text: r.text, truncated: !!r.truncated, is_photo: r.kind === 'photo' },
    r.says || (r.kind === 'photo' ? 'This is what I can see in ' + r.name + '.' : 'Here is what ' + r.name + ' says.'));
}

async function remember_this(viewer, params = {}) {
  const r = await Notes.remember(viewer.id, params.note, params.business_id);
  if (!r.ok) return r.kind === 'refused' ? refused(r.says) : { status: 'needs_answer', says: r.says };
  return answered({ note_id: r.id, already_had_it: !!r.already }, r.says);
}

async function what_you_know(viewer) {
  const held = await Notes.list(viewer.id, null);
  if (!held.length) {
    return empty('You have not told me anything to keep in mind yet. Tell me how you like to work, or '
      + 'anything about your business I should carry into every conversation, and I will hold it.');
  }
  return answered({ notes: held.map((h) => ({ id: h.id, note: h.note, business: h.business || null })) },
    'Here is everything you have told me to keep in mind.');
}

async function forget_this(viewer, params = {}) {
  const r = await Notes.forget(viewer.id, params.what);
  if (!r.ok) return r.kind === 'empty' ? empty(r.says) : { status: 'needs_answer', says: r.says };
  return answered({ dropped: r.dropped }, r.says);
}

async function connect_flow(viewer, params = {}) {
  const r = await Flow.connect(String(params.email || '').trim(), viewer.email);
  if (!r.ok) return r.kind === 'unclear' ? { status: 'needs_answer', says: r.says } : unavailable('flow_not_connected', r.says);
  return answered({ connection: r.status }, r.says);
}

async function flow_status(viewer, params = {}) {
  const r = await Flow.status(String(params.email || '').trim());
  if (r.ok === false && r.says && r.status !== 'no_account') return unavailable('flow_unreadable', r.says);
  return answered({ connection: r.status }, r.says);
}

async function send_invoice_to_flow(viewer, params = {}) {
  const r = await Flow.sendInvoice({
    email: String(params.email || '').trim(),
    counterparty: String(params.counterparty || '').trim(),
    label: String(params.label || '').trim(),
    amount_usd: params.amount_usd,
    due_date: params.due_date,
  });
  if (!r.ok) {
    if (r.kind === 'unclear' || r.status === 'incomplete') return { status: 'needs_answer', says: r.says };
    if (r.status === 'not_linked' || r.status === 'no_account') return refused(r.says);
    return unavailable('flow_invoice_failed', r.says || 'That did not reach YP Flow, so it is not in their books.');
  }
  // Reported exactly as Flow reported it: in their books, and NOT yet counted.
  return answered({ invoice_id: r.id, in_flow: true, awaiting_their_confirmation: true }, r.says);
}

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
  const said = [];
  if (Object.keys(changes).length) {
    const r = await Portal.customise(viewer, params.business_id, { changes, asked_for: params.asked_for });
    if (!r.ok) return r.kind === 'refused' ? refused(r.says) : unavailable('portal_not_saved', r.says);
    said.push({ says: r.says, ignored: r.ignored, beyond: r.beyond });
  }
  // The address and the open switch are how a portal becomes reachable at all.
  let reach = null;
  if (params.address || params.open) {
    reach = await Portal.setOpen(viewer, params.business_id, {
      address: params.address || undefined,
      open: params.open === undefined ? undefined : params.open === 'yes',
    });
    if (!reach.ok) return reach.kind === 'refused' ? refused(reach.says) : unavailable('portal_not_opened', reach.says);
    said.push({ says: reach.says });
  }
  if (!said.length) {
    const st = await Portal.status(viewer, params.business_id);
    return st.ok ? answered({ portal: st.portal }, st.says) : unavailable('portal_unreadable', st.says);
  }
  const last = said[said.length - 1];
  return answered({ ignored: last.ignored, needs_custom_app: last.beyond, address: reach && reach.address },
    said.map((x) => x.says).join(' '));
}

async function list_keys(viewer, params = {}) {
  const r = await Keys.list(viewer, params.business_id);
  if (!r.ok) return r.kind === 'refused' ? refused(r.says) : unavailable('keys_unreadable', r.says);
  return answered({ storage_ready: r.vault_ready, keys: r.keys.map((k) => ({
    service: k.service, ends_in: k.last4, checked: k.checked, replace_by: k.rotate_after, last_used: k.last_used_at,
  })) }, r.says);
}

async function launch_build(viewer, params = {}) {
  const fn = { status: Launcher.status, code: (v, id) => Launcher.pushCode(v, id, { repo_name: params.repo_name }),
    hosting: Launcher.host, check: Launcher.check }[params.step];
  if (!fn) return { status: 'needs_answer', says: 'Which step: status, code, hosting or check?' };
  const r = await fn(viewer, params.build_id);
  if (!r.ok) return r.kind === 'refused' ? refused(r.says) : unavailable('launch_step_failed', r.says);
  return answered({ repo_url: r.repo_url || (r.launch && r.launch.repo_url) || null,
    live_url: r.live_url || (r.launch && r.launch.live_url) || null }, r.says);
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
    code_on_github: b.repo_url || null,
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
  portal_status, customize_portal, list_keys, launch_build, research_compliance, add_business,
  connect_flow, flow_status, send_invoice_to_flow, remember_this, what_you_know, forget_this,
  write_document, read_document, write_spreadsheet };

module.exports = { TOOLS, EXECUTORS, answered, empty, unavailable, refused };
