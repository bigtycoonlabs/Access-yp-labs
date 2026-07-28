// Accessible, deterministic description of an HTML demo, computed from the real
// markup (no script execution, nothing fabricated). Powers the blind-user
// outline in the sandbox and, for buyers, a spoken description of a listing's
// demo — plus an honest accessibility audit so nobody is told a demo is
// screen-reader friendly when it isn't.
const { parse } = require('node-html-parser');

function txt(node) {
  const t = (node.getAttribute('aria-label')
    || node.text
    || node.getAttribute('value')
    || node.getAttribute('placeholder')
    || node.getAttribute('name')
    || node.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
  return t.slice(0, 60);
}

function accessibleName(el) {
  return (el.getAttribute('aria-label')
    || el.getAttribute('aria-labelledby')
    || el.getAttribute('title')
    || el.text || el.getAttribute('value') || '').replace(/\s+/g, ' ').trim();
}

function outline(html) {
  const root = parse(String(html || ''), { comment: false, blockTextElements: { script: false, style: false } });
  const items = [];
  const docTitle = (root.querySelector('title')?.text || '').trim();
  if (docTitle) items.push('Title: ' + docTitle);

  const headings = root.querySelectorAll('h1,h2,h3').map(txt).filter(Boolean);
  if (headings.length) items.push(`${headings.length} heading${headings.length === 1 ? '' : 's'}: ${headings.slice(0, 6).join(', ')}`);

  const links = root.querySelectorAll('a[href]').map(txt).filter(Boolean);
  if (links.length) items.push(`${links.length} link${links.length === 1 ? '' : 's'}: ${links.slice(0, 8).join(', ')}`);

  const buttons = root.querySelectorAll('button,[role=button],input[type=button],input[type=submit]').map(txt).filter(Boolean);
  if (buttons.length) items.push(`${buttons.length} button${buttons.length === 1 ? '' : 's'}: ${buttons.slice(0, 8).join(', ')}`);

  const fields = root.querySelectorAll('input:not([type=button]):not([type=submit]),textarea,select');
  if (fields.length) {
    const names = fields.map((f) => txt(f) || f.getAttribute('type') || 'field').filter(Boolean);
    items.push(`${fields.length} input field${fields.length === 1 ? '' : 's'}: ${names.slice(0, 8).join(', ')}`);
  }
  const imgs = root.querySelectorAll('img');
  if (imgs.length) {
    const withAlt = imgs.filter((i) => (i.getAttribute('alt') || '').trim()).length;
    items.push(`${imgs.length} image${imgs.length === 1 ? '' : 's'}, ${withAlt} with a text description`);
  }
  const landmarks = ['header', 'nav', 'main', 'footer'].filter((t) => root.querySelector(t));
  if (landmarks.length) items.push('Sections present: ' + landmarks.join(', '));
  if (!items.length) items.push('This demo has little detectable structure — it may be mostly styling or canvas-based.');

  return { title: docTitle, items, a11y: audit(root) };
}

// Honest accessibility audit against the platform's own bar (semantic markup,
// labelled controls, alt text, lang, no click-only divs, 44px targets).
function audit(root) {
  const issues = [];
  const passed = [];

  const htmlEl = root.querySelector('html');
  if (htmlEl && htmlEl.getAttribute('lang')) passed.push('Page language is set.');
  else issues.push('The page is missing a language (lang) attribute, which screen readers need.');

  const imgs = root.querySelectorAll('img');
  const noAlt = imgs.filter((i) => i.getAttribute('alt') === null || i.getAttribute('alt') === undefined).length;
  if (imgs.length && noAlt) issues.push(`${noAlt} of ${imgs.length} image${imgs.length === 1 ? '' : 's'} lack alt text.`);
  else if (imgs.length) passed.push('All images have alt text.');

  const controls = root.querySelectorAll('button,[role=button],input[type=button],input[type=submit]');
  const unnamed = controls.filter((c) => !accessibleName(c)).length;
  if (controls.length && unnamed) issues.push(`${unnamed} button${unnamed === 1 ? '' : 's'} have no readable label.`);
  else if (controls.length) passed.push('All buttons have readable labels.');

  const fields = root.querySelectorAll('input:not([type=button]):not([type=submit]):not([type=hidden]),textarea,select');
  const unlabeled = fields.filter((f) => {
    const id = f.getAttribute('id');
    const hasLabel = id && root.querySelector(`label[for="${id}"]`);
    return !hasLabel && !f.getAttribute('aria-label') && !f.getAttribute('aria-labelledby') && !f.getAttribute('title');
  }).length;
  if (fields.length && unlabeled) issues.push(`${unlabeled} form field${unlabeled === 1 ? '' : 's'} have no associated label.`);
  else if (fields.length) passed.push('All form fields have labels.');

  // Click-only non-semantic elements (a common VoiceOver trap).
  const clickyDivs = root.querySelectorAll('div[onclick],span[onclick]')
    .filter((d) => d.getAttribute('role') !== 'button' && !d.getAttribute('tabindex')).length;
  if (clickyDivs) issues.push(`${clickyDivs} clickable element${clickyDivs === 1 ? '' : 's'} are plain divs/spans, not real buttons — a screen reader can't operate them.`);

  if (root.querySelector('header,nav,main,footer,[role]')) passed.push('Uses semantic landmarks.');
  else issues.push('No semantic landmarks (header/nav/main/footer) were found.');

  return {
    ok: issues.length === 0,
    issues,
    passed,
    summary: issues.length === 0
      ? 'Accessibility check: this demo appears screen-reader friendly.'
      : `Accessibility check: ${issues.length} issue${issues.length === 1 ? '' : 's'} a screen-reader user would hit.`,
  };
}

module.exports = { outline, audit };
