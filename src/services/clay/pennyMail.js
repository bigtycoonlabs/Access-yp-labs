// PENNY'S REMINDER EMAIL.
//
// The sweep has been writing in-app notifications since it was built, which only reach somebody who
// opens the app — and the whole premise is reaching the person who does not. This is the half that
// makes the ledger worth having.
//
// SENDING FROM accessyplabs.com, which is verified and sending-enabled on the Resend account. Access
// YP Labs is the brand and accessyplabs.com its home (owner, 16 Sept 2026); there is no move coming.
//
// REPLIES GO TO A PERSON. Receiving is disabled on every domain on this Resend account, so a reply
// to the from-address alone would vanish silently. Every email carries a reply-to pointing at the
// Success Team mailbox, which somebody reads, and the email says so in words, because a person who
// is unsure whether replying reaches anyone will not reply.
//
// AND IT THROWS ON FAILURE, ON PURPOSE. The sweep records a reminder as given only after delivery
// returns cleanly. A sender that swallows its own errors would let somebody believe they were warned
// about a $400 filing they never heard about.

const FROM = 'Penny <penny@accessyplabs.com>';

// Where a reply actually goes. Shared with every other sender so the two can never disagree.
const { REPLY_TO } = require('../email');

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// Plain text is written first and the HTML is built from it, rather than the other way round. Most
// reminder email is designed as HTML and degraded into text; that produces the stripped, punctuation
// -less mess a screen reader actually receives.
function compose({ name, headline, body, businessName, dueAt }) {
  const hello = name ? 'Hi ' + name.split(' ')[0] + ',' : 'Hi,';
  const when = dueAt ? new Date(dueAt).toISOString().slice(0, 10) : null;

  const text = [
    hello,
    '',
    headline + (businessName ? ', for ' + businessName : '') + '.',
    '',
    body,
    '',
    when ? 'The date is ' + when + '.' : null,
    '',
    'You can see everything you owe, in the order it costs you, at:',
    'https://accessyplabs.com/today.html',
    '',
    'Reply to this email and it reaches the Success Team at ' + REPLY_TO + '.',
    '',
    'Penny',
  ].filter((l) => l !== null).join('\n');

  const html = '<!DOCTYPE html><html><body style="margin:0;padding:24px;'
    + 'font-family:Inter,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'
    + 'font-size:16px;line-height:1.55;color:#101A2E;background:#F8FAFC;">'
    + '<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;'
    + 'border-radius:12px;padding:24px;">'
    + '<p style="margin:0 0 16px;">' + escapeHtml(hello) + '</p>'
    + '<p style="margin:0 0 8px;font-size:18px;font-weight:600;">' + escapeHtml(headline)
    + (businessName ? '<span style="font-weight:400;color:#5A6478;">, for '
      + escapeHtml(businessName) + '</span>' : '') + '</p>'
    + '<p style="margin:0 0 16px;color:#5A6478;">' + escapeHtml(body) + '</p>'
    + (when ? '<p style="margin:0 0 16px;">The date is <strong>' + escapeHtml(when)
      + '</strong>.</p>' : '')
    // A 44px target in an email as much as on a screen — this gets tapped in a van.
    + '<p style="margin:0 0 20px;"><a href="https://accessyplabs.com/today.html" '
    + 'style="display:inline-block;min-height:44px;line-height:44px;padding:0 20px;'
    + 'background:#5B3FC9;color:#fff;text-decoration:none;border-radius:12px;font-weight:600;">'
    + 'See everything you owe</a></p>'
    + '<p style="margin:0;font-size:13px;color:#5A6478;">Reply to this email and it reaches the '
    + 'Success Team at <a href="mailto:' + REPLY_TO + '" style="color:#5B3FC9;">'
    + REPLY_TO + '</a>.</p>'
    + '</div></body></html>';

  return { text, html };
}

// The sender the sweep is handed. Throws on anything that is not a clean send.
function makeSender({ apiKey = process.env.RESEND_API_KEY, fetchImpl = fetch } = {}) {
  return async function send({ to, name, headline, body, obligation }) {
    if (!apiKey) {
      // Not configured is not the same as delivered, and must not be silently treated as either.
      throw new Error('RESEND_API_KEY is not set, so nothing was sent.');
    }
    const { text, html } = compose({
      name,
      headline,
      body,
      businessName: obligation && obligation.business_name,
      dueAt: obligation && obligation.due_at,
    });

    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        reply_to: REPLY_TO,
        subject: headline,
        text,
        html,
      }),
    });

    if (!res.ok) {
      let detail = '';
      try { detail = JSON.stringify(await res.json()); } catch (e) { detail = res.statusText; }
      // The body is included because a 4xx from this API says WHY, and an earlier failure in this
      // estate cost three rounds to diagnose because the response body was never logged.
      throw new Error('Resend refused the send (' + res.status + '): ' + detail);
    }
    return res.json();
  };
}

module.exports = { makeSender, compose, FROM, REPLY_TO };
