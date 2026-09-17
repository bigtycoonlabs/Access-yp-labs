// The known-good sender. A live 422 ("Invalid `from` field") showed the deployed EMAIL_FROM
// had been set to a malformed value; every send failed on it even though this default is valid
// (a real test send from this exact address succeeds). resolveFrom() makes that impossible to
// hit again: if EMAIL_FROM isn't a shape Resend accepts — a bare address or "Name <address>" —
// we fall back to this default rather than let one bad env var break all email.
// Penny is the voice of the platform (owner, 16 Sept 2026). Clay is retired and sends nothing.
const DEFAULT_FROM = 'Penny at Access YP Labs <penny@accessyplabs.com>';

// WHERE EVERY REPLY GOES. Receiving is disabled on every domain on the Resend account, so a reply to
// any from-address here vanishes silently. Every email this platform sends carries this reply-to, set
// by the owner on 16 Sept 2026: the Success Team mailbox, which a person actually reads. One constant,
// used by every sender, so no email can be added later that quietly drops replies.
const REPLY_TO = 'success@accessyourplace.com';
function resolveFrom() {
  const raw = String(process.env.EMAIL_FROM || '').trim();
  if (!raw) return DEFAULT_FROM;
  if (/<\s*[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+\s*>/.test(raw)) return raw; // Name <email@domain.tld>
  if (/^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/.test(raw)) return raw;       // bare email@domain.tld
  return DEFAULT_FROM;
}

// Read an error response body ONCE and return the most human-readable explanation available.
// Reading raw text FIRST (not resp.json()) is deliberate: if the body isn't the JSON shape we
// expected, resp.json() would consume it and leave nothing to fall back to, so the real reason
// gets silently dropped — which is exactly how two live 422s reached the log as a bare
// "resend_422" with no explanation. Capturing raw text keeps a failure self-diagnosing whatever
// shape the provider returns.
async function resendErrorDetail(resp) {
  let raw = '';
  try { raw = await resp.text(); } catch (_) { return ''; }
  if (!raw) return '';
  try { const b = JSON.parse(raw); return String(b.message || b.error || b.name || raw).slice(0, 300); }
  catch (_) { return String(raw).slice(0, 300); }
}

// Dual-channel delivery: Clay's packages are both downloadable AND emailed.
// Uses Resend if configured; otherwise reports honestly that it did not send
// (never records a send that did not happen).
async function sendEmail({ to, subject, html, text, from: fromOverride }) {
  const key = process.env.RESEND_API_KEY;
  // A caller may name the sender (a portal email comes from the business), but only on our domain.
  const from = fromOverride && /@accessyplabs\.com>?$/.test(fromOverride) ? fromOverride : resolveFrom();
  if (!key) return { sent: false, reason: 'email_not_configured' };
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html, text, reply_to: REPLY_TO }),
    });
    if (!resp.ok) {
      // Keep Resend's own explanation (e.g. "The from address is not verified", "domain
      // not found") instead of just the status — so a failure is self-diagnosing forever.
      const detail = await resendErrorDetail(resp);
      return { sent: false, reason: `resend_${resp.status}${detail ? ': ' + detail : ''}` };
    }
    const data = await resp.json();
    return { sent: true, id: data.id };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}
// Batch send (Resend /emails/batch, up to 100 per call). Each entry is a fully
// distinct email, so per-recipient personalization (name, unsubscribe link) works.
// Honest: never claims a send it didn't make.
async function sendBatch(emails) {
  const key = process.env.RESEND_API_KEY;
  const from = resolveFrom();
  const batch = (emails || []).slice(0, 100);
  if (!key) return { sent: 0, failed: batch.length, reason: 'email_not_configured', results: [] };
  if (!batch.length) return { sent: 0, failed: 0, results: [] };
  const payload = batch.map((e) => ({ from, to: e.to, subject: e.subject, html: e.html, text: e.text, headers: e.headers,
    reply_to: REPLY_TO }));
  try {
    const resp = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const detail = await resendErrorDetail(resp);
      return { sent: 0, failed: payload.length, reason: `resend_${resp.status}${detail ? ': ' + detail : ''}`, results: [] };
    }
    const data = await resp.json();
    const results = data.data || [];
    return { sent: results.length, failed: payload.length - results.length, results };
  } catch (err) {
    return { sent: 0, failed: payload.length, reason: err.message, results: [] };
  }
}

module.exports = { sendEmail, sendBatch, resendErrorDetail, resolveFrom, DEFAULT_FROM, REPLY_TO };
