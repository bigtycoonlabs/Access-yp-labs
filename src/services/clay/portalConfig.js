// WHAT A CUSTOMER PORTAL CAN BE.
//
// Flexible within limits, by the owner's decision on 16 Sept 2026. The portal is made of a fixed set
// of sections. Each can be turned on or off, put in any order, and renamed; some can be filled in.
// That is the whole surface. Penny edits exactly this, the same way the screen does.
//
// Anything asked for that is not in here is not quietly dropped. normalise() returns what it ignored,
// in words, so Penny can say "I could not do that part", and beyond() recognises requests that need a
// backend, so she can say that is a custom web application, which she can also build.

const Scope = require('./scope');

const SECTIONS = {
  welcome: { title: 'Welcome', what: 'a welcome message you write' },
  owed: { title: 'What is open between us', what: 'what they owe you and what you owe them, with dates' },
  files: { title: 'Your files', what: 'files you have shared with that customer' },
  messages: { title: 'Messages', what: 'a private conversation between them and you' },
  request: { title: 'Ask us for something', what: 'a request form with fields you choose' },
  links: { title: 'Useful links', what: 'links you choose, such as your site or booking page' },
};
const ORDER = ['welcome', 'owed', 'files', 'messages', 'request', 'links'];
const ACCENTS = {
  violet: '#5B3FC9', blue: '#2C49B8', green: '#1F7A4D', teal: '#0F6E75', orange: '#B54708', slate: '#334155',
};
const FIELD_KINDS = ['text', 'long_text', 'email', 'phone', 'date', 'number'];
const LIMITS = { title: 80, welcome: 1000, intro: 300, label: 60, fields: 8, links: 10, url: 300 };

function clip(v, n) { return String(v == null ? '' : v).replace(/\u2014/g, ', ').trim().slice(0, n); }

function defaults(businessName) {
  return {
    title: clip((businessName || 'Our') + ' customer portal', LIMITS.title),
    welcome: 'Welcome. Here you can see what is open between us, get your files and send us a message.',
    accent: 'violet',
    sections: ORDER.map((type) => ({ type, title: SECTIONS[type].title,
      on: ['welcome', 'owed', 'files', 'messages'].includes(type) })),
    request: { intro: 'Tell us what you need and we will get back to you.',
      fields: [{ label: 'What do you need?', kind: 'long_text', required: true }] },
    links: [],
  };
}

// Takes whatever was asked for and returns a valid config, plus a list of what it could not apply.
function normalise(input, base) {
  const src = input && typeof input === 'object' ? input : {};
  const out = JSON.parse(JSON.stringify(base));
  const ignored = [];
  const known = ['title', 'welcome', 'accent', 'sections', 'request', 'links'];
  Object.keys(src).forEach((k) => {
    if (!known.includes(k)) ignored.push('"' + k + '" is not something the portal has');
  });

  if (src.title !== undefined) {
    const t = clip(src.title, LIMITS.title);
    if (t) out.title = t; else ignored.push('the title cannot be empty');
  }
  if (src.welcome !== undefined) out.welcome = clip(src.welcome, LIMITS.welcome);
  if (src.accent !== undefined) {
    if (ACCENTS[src.accent]) out.accent = src.accent;
    else ignored.push('the colour "' + clip(src.accent, 20) + '" (choose ' + Object.keys(ACCENTS).join(', ') + ')');
  }

  if (src.sections !== undefined) {
    if (!Array.isArray(src.sections)) ignored.push('sections must be a list');
    else {
      const seen = new Set();
      const next = [];
      src.sections.forEach((s) => {
        const type = s && s.type;
        if (!SECTIONS[type]) { ignored.push('a section called "' + clip(type, 30) + '", which the portal does not have'); return; }
        if (seen.has(type)) return;
        seen.add(type);
        const prev = out.sections.find((x) => x.type === type);
        next.push({ type, title: clip(s.title, LIMITS.label) || prev.title,
          on: s.on === undefined ? prev.on : !!s.on });
      });
      // Sections not mentioned keep their settings and go after the ones that were ordered.
      out.sections.forEach((s) => { if (!seen.has(s.type)) next.push(s); });
      out.sections = next;
    }
  }

  if (src.request !== undefined) {
    const r = src.request || {};
    if (r.intro !== undefined) out.request.intro = clip(r.intro, LIMITS.intro);
    if (r.fields !== undefined) {
      if (!Array.isArray(r.fields)) ignored.push('request fields must be a list');
      else {
        const fields = [];
        r.fields.forEach((f) => {
          const label = clip(f && f.label, LIMITS.label);
          if (!label) return;
          const kind = FIELD_KINDS.includes(f.kind) ? f.kind : null;
          if (!kind) { ignored.push('a "' + clip(f.kind, 20) + '" field for "' + label + '" (fields can be ' + FIELD_KINDS.join(', ') + ')'); return; }
          if (fields.length >= LIMITS.fields) { ignored.push('the field "' + label + '", because a form has at most ' + LIMITS.fields); return; }
          fields.push({ label, kind, required: !!f.required });
        });
        if (fields.length) out.request.fields = fields;
        else ignored.push('the request form needs at least one field, so the old fields were kept');
      }
    }
  }

  if (src.links !== undefined) {
    if (!Array.isArray(src.links)) ignored.push('links must be a list');
    else {
      const links = [];
      src.links.forEach((l) => {
        const label = clip(l && l.label, LIMITS.label);
        const url = clip(l && l.url, LIMITS.url);
        if (!label) return;
        if (!/^https:\/\/[^\s<>"]+$/i.test(url)) { ignored.push('the link "' + label + '", because only https addresses are allowed'); return; }
        if (links.length >= LIMITS.links) { ignored.push('the link "' + label + '", because there can be at most ' + LIMITS.links); return; }
        links.push({ label, url });
      });
      out.links = links;
    }
  }
  return { config: out, ignored };
}

// Does what was asked for go beyond what the portal can do? The same signals Penny uses for builds.
function beyond(askedFor) {
  const c = Scope.classify(askedFor);
  if (c.recommended !== 'custom_app') return { beyond: false };
  const why = c.signals.custom_app;
  return { beyond: true, why,
    says: 'The portal can show what is open between you, shared files, messages, a request form and '
      + 'links. ' + (why.length ? 'You mentioned ' + why.join(' and ') + ', which ' : 'That ')
      + 'needs its own backend and usually keys to other services, so it would be a custom web '
      + 'application. I can build that for you too.' };
}

function describe(config) {
  const on = config.sections.filter((s) => s.on).map((s) => s.title);
  return config.title + ' shows ' + (on.length ? on.join(', ') : 'nothing yet') + ', in that order.';
}

module.exports = { SECTIONS, ORDER, ACCENTS, FIELD_KINDS, LIMITS, defaults, normalise, beyond, describe };
