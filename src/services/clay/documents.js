// WHAT SHOULD BE ON FILE AND IS NOT.
//
// Storing documents is the easy half and every tool does it. The half that matters is knowing what
// belongs there — because a business discovers the missing certificate of insurance on the day a
// client asks for it, not the day it lapsed.
//
// EXPECTATIONS COME FROM THE RECORD, NOT FROM A CHECKLIST. A generic "here are 12 documents every
// business needs" list is wrong for almost everybody and gets ignored within a week. These are
// derived from what this business actually has: a contractor on the team means a W-9 is expected; an
// LLC means formation papers are; a lapsed date means a renewal is.
//
// AND AN EXPIRED DOCUMENT IS WORSE THAN A MISSING ONE, which is why it ranks higher. Nobody believes
// they are covered by a certificate they never collected. Everybody believes they are covered by one
// that quietly expired in March.

const { query } = require('../../config/db');

// What each relationship kind implies, and what it costs not to have it.
const PERSON_DOCS = {
  contractor: [{
    kind: 'w9', label: 'W-9',
    why: 'Without it you cannot file their 1099 in January, and chasing a tax ID from somebody who '
      + 'has stopped working for you is much harder than asking on day one.',
  }],
  assistant: [{
    kind: 'w9', label: 'W-9 or W-8BEN',
    why: 'Whichever applies depends on where they are. Somebody working outside the US needs a '
      + 'W-8BEN rather than a W-9.',
  }],
};

// What the entity itself implies.
const BUSINESS_DOCS = {
  llc: [
    { kind: 'formation', label: 'Formation documents',
      why: 'Articles of organisation. A bank, a landlord or an insurer will ask for these and they '
        + 'are slow to replace under pressure.' },
    { kind: 'ein', label: 'EIN letter',
      why: 'The IRS confirmation of your employer identification number. Needed to open accounts '
        + 'and to file.' },
  ],
  s_corp: [{ kind: 'formation', label: 'Formation documents', why: 'A bank or insurer will ask.' }],
  c_corp: [{ kind: 'formation', label: 'Formation documents', why: 'A bank or insurer will ask.' }],
  partnership: [{
    kind: 'operating_agreement', label: 'Partnership agreement',
    why: 'Without one, a disagreement is settled by state default rules rather than by what the two '
      + 'of you actually agreed.',
  }],
};

// A business with more than one owner-ish person wants the agreement written down.
const PARTNER_DOC = {
  kind: 'operating_agreement', label: 'Operating agreement',
  why: 'With a partner and no written agreement, state default rules decide what each of you owns.',
};

async function missingFor(businessId) {
  let biz; let docs; let people;
  try {
    biz = (await query('SELECT * FROM businesses WHERE id=$1 AND archived_at IS NULL',
      [businessId])).rows[0];
    if (!biz) return { ok: false, reason: 'no_business' };
    docs = (await query('SELECT * FROM documents WHERE business_id=$1', [businessId])).rows;
    people = (await query(
      'SELECT * FROM relationships WHERE business_id=$1 AND ended_on IS NULL', [businessId])).rows;
  } catch (e) {
    // A failed read is not an empty shelf. Saying "nothing missing" here would be the worst
    // possible wrong answer, because it is exactly the reassurance somebody would act on.
    return { ok: false, reason: e.message };
  }

  const has = (kind, relId) => docs.some((d) => d.kind === kind
    && (relId ? d.relationship_id === relId : true));

  const missing = [];
  const expired = [];
  const expiring = [];

  for (const d of docs) {
    if (!d.expires_on) continue;
    const days = Math.ceil((new Date(d.expires_on) - Date.now()) / 86400000);
    if (days < 0) expired.push({ document: d, days_ago: -days });
    else if (days <= 45) expiring.push({ document: d, days });
  }

  for (const e of (BUSINESS_DOCS[biz.entity_type] || [])) {
    if (!has(e.kind)) missing.push({ kind: e.kind, label: e.label, why: e.why, about: null });
  }

  const partners = people.filter((p) => p.kind === 'partner');
  if (partners.length && !has('operating_agreement')) {
    missing.push({ kind: PARTNER_DOC.kind, label: PARTNER_DOC.label, why: PARTNER_DOC.why, about: null });
  }

  for (const p of people) {
    for (const e of (PERSON_DOCS[p.kind] || [])) {
      // A W-8BEN satisfies the same need as a W-9, so either counts.
      const satisfied = has(e.kind, p.id) || (e.kind === 'w9' && has('w8ben', p.id));
      if (!satisfied) {
        missing.push({ kind: e.kind, label: e.label + ' for ' + p.display_name, why: e.why,
          about: { relationship_id: p.id, name: p.display_name } });
      }
    }
  }

  return {
    ok: true,
    business: { id: biz.id, name: biz.name },
    on_file: docs.length,
    missing,
    expired,
    expiring,
    says: summarise({ missing, expired, expiring, onFile: docs.length }),
  };
}

// Expired first, always. Somebody who believes they are covered and is not is in more danger than
// somebody who knows they never collected the thing.
function summarise({ missing, expired, expiring, onFile }) {
  const parts = [];
  if (expired.length) {
    parts.push(expired.length === 1
      ? 'One document has expired — ' + expired[0].document.title + ', '
        + expired[0].days_ago + ' days ago'
      : expired.length + ' documents have expired');
  }
  if (missing.length) {
    parts.push(missing.length === 1
      ? 'one thing is not on file: ' + missing[0].label
      : missing.length + ' things are not on file');
  }
  if (expiring.length) {
    parts.push(expiring.length + ' expiring within 45 days');
  }
  if (!parts.length) {
    return onFile
      ? 'Nothing missing and nothing expiring. ' + onFile
        + (onFile === 1 ? ' document on file.' : ' documents on file.')
      : 'Nothing on file yet, and nothing I can tell is missing until you tell me more about the '
        + 'business.';
  }
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

module.exports = { missingFor, summarise, PERSON_DOCS, BUSINESS_DOCS };
