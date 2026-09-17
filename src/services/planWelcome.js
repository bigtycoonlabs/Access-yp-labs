// THE "YOUR PLAN IS ACTIVE" EMAIL, from Penny, sent once when a Labs plan or bundle starts.
//
// Sent after the subscription row is written and marked with plan_welcomed_at, so a redelivered Stripe
// event never sends it twice. For a bundle it says plainly that YP Flow sends its own welcome, and
// that the Flow half is set up by Flow, so the person is never told about something Labs cannot see.

const { query } = require('../config/db');
const { sendEmail } = require('./email');
const { PLANS, BUNDLES } = require('../lib/money');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function compose({ name, plan, bundle, billing }) {
  const first = (name && String(name).trim().split(/\s+/)[0]) || 'there';
  const p = PLANS[plan];
  const b = bundle ? BUNDLES[bundle] : null;
  const flowName = b ? b.flow.charAt(0).toUpperCase() + b.flow.slice(1) : null;
  const subject = b ? 'Your ' + b.name + ' bundle is active' : 'Your ' + p.name + ' plan is active';
  const paras = [
    'Hi ' + first + ', it\u2019s Penny.',
    'Your ' + p.name + ' plan on Access YP Labs is active, paid ' + billing + '. It includes ' + p.includes.charAt(0).toLowerCase() + p.includes.slice(1) + '.',
    'The best first step: tell me about your business, including the city it runs from, and ask me for a full compliance review. I research it on government websites and give you every source.',
  ];
  if (b) {
    paras.push('Your bundle also includes the ' + flowName + ' plan on Access YP Flow, where Arbo looks after your money. '
      + 'YP Flow sends its own welcome email with how to get started there. If you do not see it within the hour, reply to this email and we will sort it out.');
  }
  paras.push('You can see what your plan includes at https://accessyplabs.com/plans.html, and reach me any time at https://accessyplabs.com/penny.html.');
  paras.push('Replies to this email reach the Success Team, who read every one.');
  const text = paras.join('\n\n') + '\n\n\u2014 Penny\nAccess YP Labs, a brand of Set Up Your Place LLC';
  const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>' + esc(subject) + '</title></head>'
    + '<body style="margin:0;padding:24px;background:#f7f5ff;font-family:Arial,Helvetica,sans-serif;color:#1f1a33;">'
    + '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;padding:24px;">'
    + '<h1 style="font-size:22px;margin:0 0 16px;">' + esc(subject) + '</h1>'
    + paras.map((x) => '<p style="font-size:16px;line-height:1.6;margin:0 0 14px;">'
      + esc(x).replace(/(https:\/\/accessyplabs\.com\/[a-z./]+)/g, '<a href="$1">$1</a>') + '</p>').join('')
    + '<p style="font-size:16px;margin:18px 0 0;">\u2014 Penny<br/>Access YP Labs, a brand of Set Up Your Place LLC</p>'
    + '</div></body></html>';
  return { subject, text, html };
}

// Sends once per subscription. Returns what happened in words; never throws.
async function sendOnce(stripeSubscriptionId) {
  try {
    const claim = (await query(
      `UPDATE subscriptions s SET plan_welcomed_at = now()
         FROM users u
        WHERE s.stripe_subscription_id = $1 AND s.plan_welcomed_at IS NULL AND u.id = s.user_id
          AND s.plan IN ('desk', 'office')
        RETURNING s.id, s.plan, s.bundle, s.billing, u.email, u.name`, [stripeSubscriptionId])).rows[0];
    if (!claim) return { sent: false, says: 'Already welcomed, or not a Desk or Office plan.' };
    const mail = compose({ name: claim.name, plan: claim.plan, bundle: claim.bundle, billing: claim.billing });
    try {
      // sendEmail reports failure in its result rather than throwing, so the result is what counts.
      const r = await sendEmail({ to: claim.email, subject: mail.subject, html: mail.html, text: mail.text,
        from: 'Penny <penny@accessyplabs.com>' });
      if (!r || !r.sent) throw new Error((r && r.reason) || 'the mail service did not accept it');
      return { sent: true, says: 'Welcome sent to ' + claim.email + '.', id: r.id };
    } catch (e) {
      // Not sent: release the claim so a retry can send it, and say so.
      await query('UPDATE subscriptions SET plan_welcomed_at = NULL WHERE id=$1', [claim.id]).catch(() => {});
      console.error('[plan welcome] not sent to ' + claim.email + ': ' + e.message);
      return { sent: false, says: 'The welcome could not be sent: ' + e.message };
    }
  } catch (e) {
    console.error('[plan welcome] failed: ' + e.message);
    return { sent: false, says: 'The welcome step failed: ' + e.message };
  }
}

module.exports = { compose, sendOnce };
