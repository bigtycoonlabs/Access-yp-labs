'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const paper = fs.readFileSync('docs/WHITEPAPER-YP-Labs.md', 'utf8');
const pages = fs.readFileSync(require.resolve('../src/routes/deskPages.js'), 'utf8');
const weekly = fs.readFileSync(require.resolve('../src/services/clay/weekly.js'), 'utf8');

test('the white paper states what things actually cost', () => {
  // A paper that explains its philosophy and hides its pricing is not being straight with anyone.
  assert.match(paper, /\$19 a month/);
  assert.match(paper, /we take 20% and you keep 80%/i);
  assert.match(paper, /we take nothing at all/i);
  assert.match(paper, /earns 5% of a sale/i);
});

test('it keeps the uncomfortable part in', () => {
  assert.match(paper, /median seller earns around \$72/i);
  assert.match(paper, /anyone who tells you a listing is a payday is selling you something/i);
});

test('it describes the platform as it is now, not as it was', () => {
  assert.match(paper, /Launch Partner board/);
  assert.match(paper, /Clay Weekly/);
  assert.match(paper, /build spec/i);
  assert.match(paper, /we don't build or host applications/i);
  assert.ok(!/\$2\.99|\$49\.99|Sculptor|consultant's fee.*book/i.test(paper), 'no retired pricing or offers');
});

test('there is ONE white paper, read from the markdown', () => {
  // A second copy pasted into a page would drift, and the version a reader saw would stop matching
  // the version we edit.
  assert.match(pages, /WHITEPAPER-YP-Labs\.md/);
  assert.match(flat(pages), /so there is ONE white paper/i);
});

test('it ships with the FIRST issue and never again', () => {
  // Checked against whether any issue has ever been sent, not a flag someone must remember to clear,
  // so an issue can be rebuilt or rewritten without losing it — and it cannot reappear in issue two.
  assert.match(weekly, /SELECT COUNT\(\*\)::int AS n FROM weekly_issues WHERE sent_at IS NOT NULL/);
  assert.match(weekly, /white_paper: isFirstIssue \?/);
  assert.match(flat(weekly), /THE WHITE PAPER RIDES WITH THE FIRST ISSUE ONLY/i);
});
