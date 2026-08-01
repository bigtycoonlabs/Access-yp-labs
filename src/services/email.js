// Dual-channel delivery: Clay's packages are both downloadable AND emailed.
// Uses Resend if configured; otherwise reports honestly that it did not send
// (never records a send that did not happen).
async function sendEmail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Clay at Access YP Labs <clay@accessyplabs.com>';
  if (!key) return { sent: false, reason: 'email_not_configured' };
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
    if (!resp.ok) {
      // Keep Resend's own explanation (e.g. "The from address is not verified", "domain
      // not found") instead of just the status — so a failure is self-diagnosing forever.
      let detail = '';
      try { const b = await resp.json(); detail = b.message || b.error || (b.name ? String(b.name) : ''); }
      catch (_) { try { detail = (await resp.text()).slice(0, 200); } catch (_2) {} }
      return { sent: false, reason: `resend_${resp.status}${detail ? ': ' + String(detail).slice(0, 300) : ''}` };
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
  const from = process.env.EMAIL_FROM || 'Clay at Access YP Labs <clay@accessyplabs.com>';
  const batch = (emails || []).slice(0, 100);
  if (!key) return { sent: 0, failed: batch.length, reason: 'email_not_configured', results: [] };
  if (!batch.length) return { sent: 0, failed: 0, results: [] };
  const payload = batch.map((e) => ({ from, to: e.to, subject: e.subject, html: e.html, text: e.text, headers: e.headers }));
  try {
    const resp = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      let detail = '';
      try { const b = await resp.json(); detail = b.message || b.error || (b.name ? String(b.name) : ''); }
      catch (_) { try { detail = (await resp.text()).slice(0, 200); } catch (_2) {} }
      return { sent: 0, failed: payload.length, reason: `resend_${resp.status}${detail ? ': ' + String(detail).slice(0, 300) : ''}`, results: [] };
    }
    const data = await resp.json();
    const results = data.data || [];
    return { sent: results.length, failed: payload.length - results.length, results };
  } catch (err) {
    return { sent: 0, failed: payload.length, reason: err.message, results: [] };
  }
}

module.exports = { sendEmail, sendBatch };
