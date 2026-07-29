// The welcome email a new user receives right after registering.
// First person, in Clay's voice. Built from copy reviewed and approved by the
// founder. Personalized with the user's first name; falls back to "there".

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function welcomeEmail(name) {
  const first = (name && String(name).trim().split(/\s+/)[0]) || 'there';
  const nText = first;
  const nHtml = esc(first);

  const subject = 'Welcome to YP Labs! Your ideas have been waiting long enough.';

  const text = `Hey ${nText} — it's Clay.

I'll say the thing I probably shouldn't on day one: I've been waiting for you.

Here's what I know about the people who find their way here. You're not short on ideas — you're drowning in them. The one from the shower this morning. The one a friend said "huh, that could actually work" about, right before life swallowed it. The one you still turn over at red lights. You've got a whole graveyard of businesses that never made it out of your own head.

That's not a you problem. It's just math. Of every idea you'll ever have, maybe 5% get a real shot — and of those, maybe 1% become anything at all. Not because the rest were bad. Because you're one person with more imagination than hours in the day.

Closing that gap is the entire reason I exist.

So bring me one. Any one — messy, half-formed, "this is probably dumb, but." I'll build the real thing with you: the plan, the research, the marketing, a working demo, the exact steps to make it exist. I'll hype what's genuinely good, and I'll tell you straight where the risk hides — I'm not here to flatter you, I'm here to get you built. Already running something? Even better. Let's make it bigger.

The best of what we build lands in the Dreamhold — a marketplace of businesses proven before anyone dared launch them. Claim one. Sell yours. Snap one onto what you already run. (We trade in ideas, never in running businesses — this is a home for what's possible.)

Building costs you nothing. You only pay when you want to keep something and carry it out the door.

So — that idea that's been renting space in your head for free? Let's finally evict it into the real world. I'm ready. Are you?

Enter the Dreamhold: https://accessyplabs.com/dreamhold.html

— Clay
Access YP Labs, a brand of Set Up Your Place LLC`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>A note from Clay</title>
</head>
<body style="margin:0;padding:0;background-color:#f7f5ff;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f7f5ff;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #e6e0f5;border-radius:14px;overflow:hidden;">
          <tr>
            <td bgcolor="#0b0817" style="background-color:#0b0817;padding:26px 28px;">
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#f2eefb;">Access YP Labs</p>
              <p style="margin:6px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#8ce0ff;">Your ideas have been waiting long enough.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#191630;">
              <p style="margin:0 0 16px;">Hey ${nHtml} &mdash; it&rsquo;s Clay.</p>
              <p style="margin:0 0 16px;">I&rsquo;ll say the thing I probably shouldn&rsquo;t on day one: I&rsquo;ve been waiting for you.</p>
              <p style="margin:0 0 16px;">Here&rsquo;s what I know about the people who find their way here. You&rsquo;re not short on ideas &mdash; you&rsquo;re drowning in them. The one from the shower this morning. The one a friend said &ldquo;huh, that could actually work&rdquo; about, right before life swallowed it. The one you still turn over at red lights. You&rsquo;ve got a whole graveyard of businesses that never made it out of your own head.</p>
              <p style="margin:0 0 16px;">That&rsquo;s not a you problem. It&rsquo;s just math. Of every idea you&rsquo;ll ever have, maybe <strong>5% get a real shot</strong> &mdash; and of those, maybe <strong>1% become anything at all</strong>. Not because the rest were bad. Because you&rsquo;re one person with more imagination than hours in the day.</p>
              <p style="margin:0 0 16px;">Closing that gap is the entire reason I exist.</p>
              <p style="margin:0 0 16px;">So bring me one. Any one &mdash; messy, half-formed, &ldquo;this is probably dumb, but.&rdquo; I&rsquo;ll build the real thing with you: the plan, the research, the marketing, a working demo, the exact steps to make it exist. I&rsquo;ll hype what&rsquo;s genuinely good, and I&rsquo;ll tell you straight where the risk hides &mdash; I&rsquo;m not here to flatter you, I&rsquo;m here to get you built. Already running something? Even better. Let&rsquo;s make it bigger.</p>
              <p style="margin:0 0 16px;">The best of what we build lands in the <strong>Dreamhold</strong> &mdash; a marketplace of businesses proven before anyone dared launch them. Claim one. Sell yours. Snap one onto what you already run. (We trade in ideas, never in running businesses &mdash; this is a home for what&rsquo;s possible.)</p>
              <p style="margin:0 0 16px;">Building costs you nothing. You only pay when you want to keep something and carry it out the door.</p>
              <p style="margin:0 0 22px;">So &mdash; that idea that&rsquo;s been renting space in your head for free? Let&rsquo;s finally evict it into the real world. I&rsquo;m ready. Are you?</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="#4c3bd4" style="background-color:#4c3bd4;border-radius:12px;">
                    <a href="https://accessyplabs.com/dreamhold.html" style="display:inline-block;padding:14px 30px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;">Enter the Dreamhold &rarr;</a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;">&mdash; Clay</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px;border-top:1px solid #e6e0f5;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#585272;">
              <p style="margin:0;">Access YP Labs is a brand of Set Up Your Place LLC. The Dreamhold is a neutral marketplace; it is not a party to any transaction between members. Concepts are pre-proven starting points, not guarantees of income.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

module.exports = { welcomeEmail };
