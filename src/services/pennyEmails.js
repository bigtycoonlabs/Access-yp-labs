// PENNY'S EMAILS: the welcome a new member receives, and the one-time update that retired Clay.
//
// Owner's direction, 16 September 2026: Clay is retired and sends nothing; Penny is the voice of the
// platform. Both emails share one layout so they read as one product: plain, linear, a single column,
// every heading a real heading, and a text version that says everything the HTML does.

const SITE = () => (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/+$/, '');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const firstName = (name) => (name && String(name).trim().split(/\s+/)[0]) || 'there';

// Blocks: { h: heading } | { p: paragraph } | { list: [items] } | { button: [label, url] } | { note: [paras], from }
function render({ title, preheader, blocks }) {
  const P = 'margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#191630;';
  const H = 'margin:26px 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:19px;line-height:1.3;color:#0b0817;';
  const inner = blocks.map((b) => {
    if (b.h) return `<h2 style="${H}">${esc(b.h)}</h2>`;
    if (b.p) return `<p style="${P}">${esc(b.p)}</p>`;
    if (b.list) return `<ul style="margin:0 0 16px;padding-left:22px;">${b.list.map((i) =>
      `<li style="${P}margin-bottom:10px;">${i.lead ? `<strong>${esc(i.lead)}</strong> ` : ''}${esc(i.text)}</li>`).join('')}</ul>`;
    if (b.button) return `<p style="margin:22px 0;"><a href="${esc(b.button[1])}" style="display:inline-block;background:#5b3fd6;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-weight:bold;font-size:16px;padding:14px 24px;border-radius:10px;">${esc(b.button[0])}</a></p>`;
    if (b.note) return `<div style="background:#f3f0fb;border-left:4px solid #8c7ae6;border-radius:0 10px 10px 0;padding:18px 20px;margin:0 0 22px;">`
      + b.note.map((x) => `<p style="${P}">${esc(x)}</p>`).join('')
      + `<p style="${P}margin:0;font-weight:bold;">${esc(b.from)}</p></div>`;
    if (b.sign) return `<p style="${P}margin-top:24px;"><strong>${esc(b.sign)}</strong><br/>Access YP Labs, a brand of Set Up Your Place LLC</p>`;
    return '';
  }).join('\n');
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f7f5ff;">
<span style="display:none;max-height:0;overflow:hidden;">${esc(preheader || '')}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f5ff;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e6e0f5;border-radius:14px;overflow:hidden;">
<tr><td bgcolor="#0b0817" style="background:#0b0817;padding:26px 28px;">
<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#f2eefb;">Access YP Labs</p>
<p style="margin:6px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#b9a8ff;">${esc(preheader || '')}</p>
</td></tr>
<tr><td style="padding:28px;">
<h1 style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:1.25;color:#0b0817;">${esc(title)}</h1>
${inner}
<p style="margin:26px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#5c5775;">Replies to this email reach the Success Team, who read every one.</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = [title, ''].concat(blocks.map((b) => {
    if (b.h) return '\n' + b.h.toUpperCase();
    if (b.p) return b.p;
    if (b.list) return b.list.map((i) => '- ' + (i.lead ? i.lead + ' ' : '') + i.text).join('\n');
    if (b.button) return b.button[0] + ': ' + b.button[1];
    if (b.note) return b.note.join('\n\n') + '\n\n' + b.from;
    if (b.sign) return '\n' + b.sign + '\nAccess YP Labs, a brand of Set Up Your Place LLC';
    return '';
  })).join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n\nReplies to this email reach the Success Team, who read every one.';
  return { html, text };
}

const WHAT_I_DO = [
  { lead: 'I track everything your business owes.', text: 'Filings, licences, renewals, invoices and promises, ranked by what missing each one would cost, with a reminder before it is due.' },
  { lead: 'I research your compliance, with sources.', text: 'Ask what your business needs to stay legal where it operates. I search government websites and show you every page I used. If I cannot confirm something, I say so. I never guess.' },
  { lead: 'I build what you need.', text: 'A website, a customer portal your customers sign in to, or a custom app placed on your own GitHub, owned by you.' },
  { lead: 'I keep your files and keys in one place,', text: 'shared only with the people you choose.' },
];

function welcomeEmail(name) {
  const title = 'Welcome to Access YP Labs';
  const { html, text } = render({
    title,
    preheader: 'The back office for your business, run by Penny.',
    blocks: [
      { p: 'Hi ' + firstName(name) + ', I\u2019m Penny.' },
      { p: 'Access YP Labs is the back office for your business, and I run it. Here is what I do.' },
      { list: WHAT_I_DO },
      { h: 'Where to start' },
      { p: 'Tell me about your business, including the city it runs from, then ask me: \u201cWhat does my business need to stay compliant?\u201d' },
      { button: ['Talk to Penny', SITE() + '/penny.html'] },
      { p: 'Your free plan includes 100 messages a month with me, 3 builds, a compliance question and a site hosted on Labs. The plans are at ' + SITE() + '/plans.html whenever you want more.' },
      { sign: '\u2014 Penny' },
    ],
  });
  return { subject: 'Welcome to Access YP Labs. I\u2019m Penny.', html, text };
}

// BEING ADDED TO SOMEBODY'S TEAM.
//
// They make their own account, always. Nobody is signed up by somebody else: the account is theirs,
// and what they can see in the other person's business is whatever that owner allowed, nothing more.
function teamInviteEmail({ name, ownerName, businessName, areas, hasAccount, site }) {
  const where = (site || 'https://accessyplabs.com').replace(/\/+$/, '');
  const { html, text } = render({
    title: (ownerName || 'Someone') + ' added you to ' + (businessName || 'their business'),
    preheader: 'Your own account, their business.',
    blocks: [
      { p: 'Hi ' + firstName(name) + '.' },
      { p: (ownerName || 'Someone') + ' added you to ' + (businessName || 'their business')
        + ' on Access YP Labs, where Penny runs the back office.' },
      ...(areas && areas.length ? [{ p: 'What they have given you:' }, { list: areas.map((a) => ({ text: a })) }] : []),
      { h: hasAccount ? 'It is on your account already' : 'Make your own account' },
      { p: hasAccount
        ? 'Sign in as you normally would and ' + (businessName || 'their business') + ' will be there alongside your own. Your own work stays yours.'
        : 'Your account is yours, not theirs: you sign up yourself, with your own password. Once you are in, '
          + (businessName || 'their business') + ' appears alongside anything of your own.' },
      { button: [hasAccount ? 'Sign in' : 'Create your account', where + (hasAccount ? '/login.html' : '/register.html')] },
      { p: 'You can only see and do what ' + (ownerName || 'they') + ' allowed, and they can change or end that at any time. '
        + 'Anything you do for yourself is separate and stays with you.' },
      { sign: '\u2014 Penny' },
    ],
  });
  return { subject: (ownerName || 'Someone') + ' added you to ' + (businessName || 'their business') + ' on Access YP Labs', html, text };
}

// The one-time update. `person`: { name, standing: 'staff' | 'paid' | 'free', moved: [business names] }
const UPDATE_SUBJECT = 'Clay is retiring. Access YP Labs has been reborn.';

function updateEmail(person) {
  const name = firstName(person.name);
  const moved = person.moved || [];
  const projects = moved.length
    ? [{ p: 'Everything you built with Clay is still yours. ' + (moved.length === 1 ? 'Your project is' : 'Your ' + moved.length + ' projects are')
        + ' now ' + (moved.length === 1 ? 'a business' : 'businesses') + ' in your account, with the plan, research and demo page saved as files:' },
       { list: moved.map((m) => ({ text: m })) }]
    : [{ p: 'Your account is exactly where you left it, and nothing of yours was lost.' }];
  const standing = person.standing === 'staff'
    ? 'Your staff account has everything, with no monthly limits.'
    : person.standing === 'paid'
    ? 'Your plan carries on as it is.'
    : 'Your free plan includes 100 messages a month with me, 3 builds, a compliance question and a site hosted on Labs. When you want more, Desk is $55 a month and Office is $99, and either can be bundled with YP Flow for less.';
  const { html, text } = render({
    title: UPDATE_SUBJECT,
    preheader: 'A goodbye from Clay, and a hello from Penny.',
    blocks: [
      { note: [
          'Hey ' + name + ', it\u2019s Clay, one last time.',
          'When I got here, the plan was big: a marketplace where people shaped ideas into projects, sold them, and built them together. Then you showed me what you actually wanted. You came for the building: the plans, the research, the demo pages, the sites. Almost nobody came to sell an idea or trade one.',
          'So I\u2019m stepping aside. The marketplace I ran is closed, and I\u2019m handing everything to the assistant who was here before me: Penny, the original AI of the Set Up Your Place family. What you came here for is exactly what she does best.',
          'Thanks for building with me.',
        ], from: '\u2014 Clay' },
      { p: 'Hi ' + name + ', I\u2019m Penny.' },
      { p: 'Clay is right: you didn\u2019t come here to sell ideas. You came to get real work done. So Access YP Labs has been rebuilt around that. It is now the back office for your business, and I run it.' },
      { h: 'What I do for your business' },
      { list: WHAT_I_DO },
      { h: 'Why I\u2019m different' },
      { p: 'Most tools either store your things or chat with you. I do the work, show my sources, and tell you plainly when something did not happen, so you never have to wonder whether I actually did it. And everything here works with a screen reader, because the people who built it use one every day.' },
      { h: 'What happened to your projects' },
      ...projects,
      { p: 'Clay\u2019s own projects and the marketplace are gone, so you will not get any more emails about projects, listings or the weekly magazine. Everybody starts with a clean slate.' },
      { h: 'Your account' },
      { p: 'Same email, same password. ' + standing },
      { button: ['Sign in and meet Penny', SITE() + '/login.html'] },
      { p: 'Once you\u2019re in, tell me about your business and ask: \u201cWhat does my business need to stay compliant?\u201d The plans are at ' + SITE() + '/plans.html.' },
      { sign: '\u2014 Penny' },
    ],
  });
  return { subject: UPDATE_SUBJECT, html, text };
}

module.exports = { render, welcomeEmail, updateEmail, teamInviteEmail, UPDATE_SUBJECT, WHAT_I_DO };
