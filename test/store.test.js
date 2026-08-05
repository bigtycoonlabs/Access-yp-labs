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

test('shopHtml renders a real Buy form only when a concept id is given', () => {
  const products = [{ id: 'prod_123', name: 'Tee', price_cents: 2500, currency: 'usd', active: true }];
  const noForm = shopHtml(products); // no conceptId → catalog only, no buy button
  assert.ok(!noForm.includes('<form'), 'no buy form without a concept id');
  const withForm = shopHtml(products, 'concept_abc');
  assert.ok(withForm.includes('/api/store/concept_abc/checkout'), 'posts to the checkout endpoint');
  assert.ok(withForm.includes('name="product_id" value="prod_123"'), 'carries the product id');
  assert.ok(withForm.includes('type="submit"'), 'is a real button');
});

test('summarizeOrders counts only paid orders as revenue', () => {
  const rows = [
    { status: 'paid', amount_cents: 2500, currency: 'usd' },
    { status: 'paid', amount_cents: 1000, currency: 'usd' },
    { status: 'pending', amount_cents: 9999, currency: 'usd' },
    { status: 'failed', amount_cents: 5000, currency: 'usd' },
  ];
  const s = store.summarizeOrders(rows);
  assert.strictEqual(s.paid_count, 2, 'two paid');
  assert.strictEqual(s.paid_total_cents, 3500, 'only paid summed');
  assert.strictEqual(s.unfinished, 2, 'pending+failed are unfinished');
  assert.strictEqual(s.currency, 'usd');
});

test('summarizeOrders handles empty and junk input safely', () => {
  assert.deepStrictEqual(store.summarizeOrders([]), { paid_count: 0, paid_total_cents: 0, currency: 'usd', unfinished: 0 });
  assert.deepStrictEqual(store.summarizeOrders(null), { paid_count: 0, paid_total_cents: 0, currency: 'usd', unfinished: 0 });
});

test('normalizeKind defaults to digital and only allows physical explicitly', () => {
  assert.strictEqual(store.normalizeKind('physical'), 'physical');
  assert.strictEqual(store.normalizeKind('PHYSICAL'), 'physical');
  assert.strictEqual(store.normalizeKind('digital'), 'digital');
  assert.strictEqual(store.normalizeKind('nonsense'), 'digital');
  assert.strictEqual(store.normalizeKind(undefined), 'digital');
});

test('normalizeProduct carries kind and an https-only fulfillment link', () => {
  const a = store.normalizeProduct({ name: 'Guide', price: '9.99', kind: 'digital', fulfillment_url: 'https://ex.com/file.pdf' });
  assert.ok(a.ok);
  assert.strictEqual(a.product.kind, 'digital');
  assert.strictEqual(a.product.fulfillment_url, 'https://ex.com/file.pdf');
  const b = store.normalizeProduct({ name: 'Mug', price: '15', kind: 'physical', fulfillment_url: 'http://insecure.com/x' });
  assert.ok(b.ok);
  assert.strictEqual(b.product.kind, 'physical');
  assert.strictEqual(b.product.fulfillment_url, null, 'non-https delivery link is rejected');
});
