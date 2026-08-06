// ANNOUNCEMENTS — a message from Clay to everyone who has an account.
//
// This is deliberately separate from Clay Weekly. The magazine is something people opted into and
// can leave; an announcement is an ACCOUNT NOTICE — a change to what someone pays, what they own,
// or what they were promised. Those go to everyone with an account, including people who left the
// magazine, because opting out of a newsletter is not opting out of being told your terms changed.
//
// That distinction cuts both ways, and the rules here enforce it:
//   * Announcements must be rare and must actually matter. If it could go in the magazine, it should.
//   * Every send is recorded by key, and the same announcement can NEVER go out twice — a duplicate
//     "we're changing your pricing" email is its own small betrayal of trust.
//   * The count reported is what the mail provider accepted, never what we hoped for.
//   * Nothing sends without a human deciding. There is no schedule and no automatic trigger.

const { query } = require('../../config/db');
const { sendBatch } = require('../email');

const SITE = () => (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/+$/, '');

// The pricing change, written as Clay would say it: what changed, what it means for you, and the
// part most companies bury — what you are NOT losing.
function pricingChange() {
  const url = SITE();
  const text = `Hi {{name}},

Clay here. We changed how Access YP Labs charges, and I want you to hear it from me rather than notice it later.

What changed:

Your first project is now free. Not a trial — free, in full, forever. You can build it with me, upload your own material to it, keep adding to it, download it, take it off the platform entirely, work with a launch partner on it, list it in the Dream Market, and sell it, without paying anything.

Everything beyond that first project is now one plan at $19 a month. It covers unlimited projects, and it now includes the website builder and landing pages, which used to cost extra. Images I make while we work are included too.

What went away: the $2.99-per-project charge, the $49.99 plan, and the image packs. Charging you for each idea was a bad idea on our part — it made you think twice about having another one, which is the opposite of the point.

What has not changed: building with me is still free and unlimited. You can shape as many projects as you like, for as long as you like, and pay nothing.

If you are already on an older plan, nothing about it changes. You keep exactly what you are paying for, at the price you agreed. We are not moving anyone onto the new plan or quietly repricing you.

One more thing, because it is worth being plain about. When something sells through the Dream Market, the platform takes 20% and you keep 80% — that applies to every marketplace sale, whether we sent the buyer or you did. When you sell through the website we build for your project, direct to your own customers, we take nothing at all.

That is the whole change. Nothing needs doing on your side.

${url}

— Clay`;

  const html = `<p>Hi {{name}},</p>
<p>Clay here. We changed how Access YP Labs charges, and I want you to hear it from me rather than notice it later.</p>
<p><strong>Your first project is now free.</strong> Not a trial — free, in full, forever. Build it with me, upload your own material, keep adding to it, download it, take it off the platform, work with a launch partner, list it in the Dream Market, and sell it, without paying anything.</p>
<p><strong>Everything beyond that first project is one plan at $19 a month.</strong> Unlimited projects, and it now includes the website builder and landing pages, which used to cost extra. Images I make while we work are included too.</p>
<p><strong>What went away:</strong> the $2.99-per-project charge, the $49.99 plan, and the image packs. Charging you for each idea was a bad idea on our part — it made you think twice about having another one, which is the opposite of the point.</p>
<p><strong>What has not changed:</strong> building with me is still free and unlimited. As many projects as you like, for as long as you like, at no cost.</p>
<p>If you are already on an older plan, nothing about it changes. You keep exactly what you are paying for, at the price you agreed. We are not moving anyone across or quietly repricing you.</p>
<p>One more thing, because it is worth being plain about. When something sells <strong>through the Dream Market</strong>, the platform takes 20% and you keep 80% — every marketplace sale, whether we sent the buyer or you did. When you sell through <strong>the website we build for your project</strong>, direct to your own customers, we take nothing at all.</p>
<p>That is the whole change. Nothing needs doing on your side.</p>
<p><a href="${url}">${url.replace(/^https?:\/\//, '')}</a></p>
<p>— Clay</p>`;

  return { key: 'pricing-2026-08', subject: 'A change to what Access YP Labs costs', text, html };
}

const ANNOUNCEMENTS = { 'pricing-2026-08': pricingChange };

function preview(key) {
  const make = ANNOUNCEMENTS[key];
  if (!make) return null;
  const a = make();
  return { key: a.key, subject: a.subject, text: a.text.replace('{{name}}', 'there') };
}

// Has this announcement already gone out? Recorded in email_log, which already exists for exactly
// this purpose — every send attempt, including failures.
async function alreadySent(key) {
  const r = await query(
    `SELECT count(*)::int AS n FROM email_log WHERE kind = $1 AND sent = true`, ['announce:' + key]);
  return (r.rows[0] && r.rows[0].n) > 0;
}

// Send to every account holder. Returns honest counts.
async function send(key) {
  const make = ANNOUNCEMENTS[key];
  if (!make) return { ok: false, reason: 'unknown_announcement' };
  if (await alreadySent(key)) return { ok: false, reason: 'already_sent' };

  const a = make();
  const rec = await query(
    `SELECT id, email, COALESCE(NULLIF(name,''),'there') AS name
       FROM users WHERE email IS NOT NULL AND status <> 'suspended'`);
  if (!rec.rows.length) return { ok: false, reason: 'no_recipients' };

  let sent = 0;
  for (let i = 0; i < rec.rows.length; i += 100) {
    const chunk = rec.rows.slice(i, i + 100).map((u) => ({
      to: u.email,
      subject: a.subject,
      text: a.text.replace('{{name}}', u.name),
      html: a.html.replace('{{name}}', u.name),
    }));
    const out = await sendBatch(chunk);
    sent += (out && out.sent) || 0;
  }

  // Record it so it can never be sent a second time, even from another instance.
  await query(
    `INSERT INTO email_log (to_email, kind, sent, reason) VALUES ($1,$2,$3,$4)`,
    ['(all accounts)', 'announce:' + key, sent > 0, `delivered ${sent} of ${rec.rows.length}`]);

  return { ok: true, sent, attempted: rec.rows.length };
}

module.exports = { preview, send, alreadySent, ANNOUNCEMENTS };
