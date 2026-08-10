'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*(?:\/\/|--)\s*/g, ' ').replace(/\s+/g, ' ');
const mod = fs.readFileSync('public/moderation.html', 'utf8');
const consoleApi = fs.readFileSync(require.resolve('../src/routes/console.js'), 'utf8');

test('you read the listing before you are offered the editor', () => {
  // The editor rendered ABOVE the project, so the first thing offered was changing a listing you
  // had not yet read. Review, then fix what you found.
  const materials = mod.indexOf('(d.materials||[]).forEach');
  const editor = mod.indexOf('if(d.is_clay_seed){ host.appendChild(clayEditor(d)); }');
  assert.ok(materials > -1 && editor > -1);
  assert.ok(materials < editor, 'materials render before the editor');
  assert.match(flat(mod), /EDIT AFTER READING, not before/i);
});

test('a listing with nothing to read says so', () => {
  // It rendered as silence with the approve button sitting there anyway, so the screen looked the
  // same whether a project was thin or simply had not loaded.
  assert.match(mod, /This listing has no materials attached/);
  assert.match(mod, /approving it publishes a listing a buyer cannot/);
});

test('every queue links somewhere that shows that queue', () => {
  // "Orders holding money" pointed at people.html, which does not mention escrow at all — so
  // following it left somebody looking for money on a page about accounts.
  assert.ok(!/'Orders holding money', 'people\.html'/.test(consoleApi));
  assert.match(consoleApi, /'Orders holding money', 'console\.html#business'/);
  const dest = [...consoleApi.matchAll(/SELECT '([^']+)', '([a-z.#]+)'/g)].map((m) => m[2]);
  dest.forEach((d) => {
    const file = 'public/' + d.split('#')[0];
    assert.ok(fs.existsSync(file), d + ' must be a page that exists');
  });
});
