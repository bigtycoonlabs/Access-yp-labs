'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const clay = fs.readFileSync(require.resolve('../src/routes/clay.js'), 'utf8');
const concepts = fs.readFileSync(require.resolve('../src/routes/concepts.js'), 'utf8');
const adminUsers = fs.readFileSync(require.resolve('../src/routes/adminUsers.js'), 'utf8');

test('staff cannot read a private project through Clay', () => {
  // Staff access is allowed ONLY where the project has already left the private stage, and only
  // for the reason it left. Blanket staff access is a privacy violation dressed as convenience.
  const q = clay.slice(clay.indexOf('WHERE c.id = $1'), clay.indexOf('[req.body.concept_id, req.user.id, staffViewer]'));
  assert.match(q, /c\.owner_id = \$2/, 'the owner always qualifies');
  assert.match(q, /clay_seed/, 'platform-owned projects qualify');
  assert.match(q, /launch_page->>'enabled'\) = 'true'/, 'already-public sites qualify');
  assert.match(q, /l\.status IN \('in_review', 'live', 'sold'\)/, 'projects awaiting or in the market qualify');
  // And nothing broader than that.
  assert.ok(!/\$3 = true\s*\)\s*\)/.test(q.replace(/\s+/g, ' ')), 'staff role alone must not be sufficient');
});

test('the reason for the boundary is written down, not just enforced', () => {
  const f = flat(clay);
  assert.match(f, /has not asked for an audience/i);
  assert.match(f, /not a trade that was ours to make/i);
});

test('reading a project directly stays owner-only', () => {
  assert.match(concepts, /SELECT \* FROM concepts WHERE id=\$1 AND owner_id=\$2/);
});

test('the staff people view shows counts, never project content', () => {
  assert.match(adminUsers, /count\(\*\) FROM concepts c WHERE c\.owner_id = u\.id/);
  assert.ok(!/SELECT[^;]*c\.title[^;]*FROM concepts/.test(adminUsers), 'no project titles are exposed');
});
