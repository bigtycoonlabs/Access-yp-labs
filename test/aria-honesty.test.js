'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*(?:<!--|\/\/)?\s*/g, ' ').replace(/\s+/g, ' ');

test('the moderation queue does not claim to be a list', { skip: 'the review queue was replaced by /market-control.html' }, () => {
  // role="list" promises a screen reader its children are list items. The queue's children are
  // review cards containing a heading, a note field and several buttons, so the whole queue was
  // being announced wrongly — a real defect on the page staff use most.
  const mod = fs.readFileSync('public/moderation.html', 'utf8');
  assert.ok(!/id="queue"[^>]*role="list"/.test(mod), 'no false list role');
  assert.match(mod, /id="queue" aria-labelledby="queue-h"/);
  assert.match(flat(mod), /a list role promises a screen reader that its children are list items/i);
});

test('the Dream Market door has a real heading', () => {
  // It was a paragraph styled to look like a title, so the page had NO heading at all — somebody
  // navigating by headings found nothing to orient by, on the one page standing between them and
  // the whole market.
  const enter = fs.readFileSync('public/enter.html', 'utf8');
  assert.match(enter, /<h1 class="kicker">/);
  assert.ok(!/<p class="kicker">/.test(enter));
});

test('every ARIA list role in the app has listitem children', () => {
  // The class the moderation bug belonged to. A role="list" whose children are anything else is a
  // promise the markup does not keep.
  const offenders = [];
  for (const f of fs.readdirSync('public').filter((x) => x.endsWith('.html'))) {
    const raw = fs.readFileSync('public/' + f, 'utf8');
    // Strip comments first. The moderation page EXPLAINS this bug in a comment that contains the
    // words role="list", and a check that cannot tell an explanation from an element flags the very
    // file that fixed it — which is how a guard trains you to ignore it.
    const src = raw.replace(/<!--[\s\S]*?-->/g, ' ');
    if (!/role="list"/.test(src)) continue;

    // A page may add role="listitem" at runtime rather than in markup — People does exactly that,
    // and looking only at static HTML would call it broken when it is correct. So accept either the
    // markup or the script that fills the container.
    const script = fs.existsSync('public/js/' + f.replace('.html', '.js'))
      ? fs.readFileSync('public/js/' + f.replace('.html', '.js'), 'utf8') : '';
    const pool = src + script;
    const hasItems = /role=["']listitem["']|setAttribute\(['"]role['"],\s*['"]listitem['"]\)|<li[ >]/.test(pool);
    if (!hasItems) offenders.push(f);
  }
  assert.deepStrictEqual([...new Set(offenders)], [],
    'these declare a list with nothing that can be a list item: ' + offenders.join(', '));
});
