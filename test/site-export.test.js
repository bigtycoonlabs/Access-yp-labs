const { test } = require('node:test');
const assert = require('node:assert');
const ex = require('../src/services/clay/siteExport');
const sq = require('../src/services/clay/siteQuota');

test('export escapes authored content — no HTML injection', () => {
  const f = ex.buildSingleFile(
    { title: 'T', launch_page: { headline: '<script>alert(1)</script>', theme: 'warm', slug: 's' } },
    [{ slug: 'p', title: '<img onerror=x>', body: '<b>hi</b> & "quotes"' }]);
  assert.ok(!/<script>alert/.test(f.html), 'script tag must be escaped');
  assert.ok(f.html.includes('&lt;script&gt;'), 'headline escaped');
  assert.ok(f.html.includes('&amp;'), 'ampersand escaped');
});

test('export renders markdown blocks to safe html', () => {
  const html = ex.bodyHtml('# Head\n\n- a\n- b\n\n> q\n\n![alt](https://x.io/i.jpg)\n\n[[Go]](https://x.io)\n\ntext [l](https://x.io)');
  assert.ok(html.includes('<h2>Head</h2>'));
  assert.ok(html.includes('<ul><li>a</li><li>b</li></ul>'));
  assert.ok(html.includes('<blockquote>q</blockquote>'));
  assert.ok(html.includes('<img src="https://x.io/i.jpg" alt="alt">'));
  assert.ok(html.includes('class="btn-cta"'));
  assert.ok(html.includes('<a href="https://x.io" target="_blank" rel="noopener">l</a>'));
});

test('a bad image URL is not rendered as an image', () => {
  const html = ex.bodyHtml('![x](javascript:alert(1))');
  assert.ok(!/<img/.test(html), 'javascript: URL must not become an img');
});

test('countedThisMonth is true only for a timestamp in the current month', () => {
  assert.strictEqual(sq.countedThisMonth({ published_at: new Date().toISOString() }), true);
  assert.strictEqual(sq.countedThisMonth({ published_at: '2001-01-01T00:00:00Z' }), false);
  assert.strictEqual(sq.countedThisMonth({}), false);
  assert.strictEqual(sq.countedThisMonth(null), false);
});
