// Dual-channel delivery: Clay's packages are both downloadable AND emailed.
// Uses Resend if configured; otherwise reports honestly that it did not send
// (never records a send that did not happen).
async function sendEmail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Clay at YP Labs <clay@accessyplabs.com>';
  if (!key) return { sent: false, reason: 'email_not_configured' };
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
    if (!resp.ok) return { sent: false, reason: `resend_${resp.status}` };
    const data = await resp.json();
    return { sent: true, id: data.id };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}
module.exports = { sendEmail };
