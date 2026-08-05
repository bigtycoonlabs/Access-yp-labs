'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const store = require('../src/services/clay/store');
const { shopHtml } = require('../src/services/clay/siteExport');

test('parsePriceToCents accepts clean money, rejects junk', () => {
  assert.strictEqual(store.parsePriceToCents('19.99'), 1999);
  assert.strictEqual(store.parsePriceToCents('$19.99'), 1999);
  assert.strictEqual(store.parsePriceToCents('20'), 2000);
  assert.strictEqual(store.parsePriceToCents(19.99), 1999);
  assert.strictEqual(store.parsePriceToCents('1,299.00'), 129900);
  assert.strictEqual(store.parsePriceToCents('0'), 0);
  assert.strictEqual(store.parsePriceToCents('abc'), null);
  assert.strictEqual(store.parsePriceToCents('-5'), null);
  assert.strictEqual(store.parsePriceToCents(''), null);
  assert.strictEqual(store.parsePriceToCents('19.999'), null); // 3 decimals is not money
  assert.strictEqual(store.parsePriceToCents(2000000), null);   // above the sanity cap
});

test('currency normalizes and formats', () => {
  assert.strictEqual(store.normalizeCurrency('USD'), 'usd');
  assert.strictEqual(store.normalizeCurrency('xyz'), 'usd');
  assert.strictEqual(store.normalizeCurrency('eur'), 'eur');
  assert.strictEqual(store.formatPrice(1999, 'usd'), '$19.99');
  assert.strictEqual(store.formatPrice(1999, 'gbp'), '£19.99');
  assert.strictEqual(store.formatPrice(1999, 'cad'), 'CA$19.99');
});

test('cleanImageUrl allows only https', () => {
  assert.strictEqual(store.cleanImageUrl('https://x.co/a.png'), 'https://x.co/a.png');
  assert.strictEqual(store.cleanImageUrl('http://x.co/a.png'), null);
  assert.strictEqual(store.cleanImageUrl('javascript:alert(1)'), null);
  assert.strictEqual(store.cleanImageUrl(''), null);
});

test('normalizeProduct validates name and price', () => {
  const ok = store.normalizeProduct({ name: '  Tee  ', price: '25', description: 'x', currency: 'usd' });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.product.name, 'Tee');
  assert.strictEqual(ok.product.price_cents, 2500);
  assert.strictEqual(store.normalizeProduct({ name: '', price: '5' }).ok, false);
  assert.strictEqual(store.normalizeProduct({ name: 'x', price: 'free' }).ok, false);
});

test('shopHtml renders active products, hides inactive, escapes', () => {
  assert.strictEqual(shopHtml([]), '');
  assert.strictEqual(shopHtml(null), '');
  const html = shopHtml([
    { name: 'Bold <Tee>', price_cents: 2500, currency: 'usd', description: 'nice', active: true },
    { name: 'Hidden', price_cents: 100, currency: 'usd', active: false },
  ]);
  assert.ok(html.includes('product-card'), 'renders a card');
  assert.ok(html.includes('$25.00'), 'formats price');
  assert.ok(html.includes('Bold &lt;Tee&gt;'), 'escapes the name');
  assert.ok(!html.includes('Hidden'), 'hides inactive products');
});
