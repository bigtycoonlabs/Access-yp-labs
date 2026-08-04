// The weekly creator proof prompt.
//
// Clay's highest-leverage move to grow creators (from his own weekly review): give each creator one
// small win they can finish. Once a week, one concept, one customer, one proof action a real
// stranger can act on, with a go-or-kill line set in advance. Proof is behavior, not compliments.
//
// v1 is deterministic and category-aware: the proof action fits the kind of business, and it's the
// low-cost, research-backed kind (interview, landing page, preorder, deposit, paid pilot, booked
// calls). That makes it reliable and testable, and it always produces something genuinely useful.
// (Clay can tailor the wording to the specific concept later; this is the dependable floor.)

const { query } = require('../../config/db');
const { sendEmail } = require('../email');

const SITE = 'https://accessyplabs.com';

// The proof action, customer focus, and go/kill line that fit each kind of business.
const PROOF_BY_CATEGORY = {
  digital_product_saas: {
    focus: 'the specific person who hits this problem often enough to pay to make it go away',
    action: 'Put up a one-page site that says exactly what it does and who it is for, with a single "Get early access" button, and show it to 10 of those people.',
    go_kill: 'Decide first: if at least 3 of the 10 sign up without you pushing, keep building. If nobody does, the promise or the audience is off — change one and try again.',
  },
  ai_product_service: {
    focus: 'the one person whose task this would actually save time or money on this week',
    action: 'Offer to run the result for 3 real people by hand this week — you do the work, they judge the output — and ask what they would pay for it.',
    go_kill: 'Decide first: if 2 of the 3 say the output is worth paying for, keep building. If none would pay, fix the output before you automate anything.',
  },
  online_service_agency: {
    focus: 'one business or person who already spends time or money on this problem today',
    action: 'Book 3 short calls with people who have this problem and offer to do a small paid version of the work this week.',
    go_kill: 'Decide first: if 1 of the 3 agrees to pay for a first small engagement, keep going. If none will pay, find out why before building more.',
  },
  content_creator: {
    focus: 'the one kind of person who would share this with a friend',
    action: 'Publish one real piece of it and make one clear paid offer at the end — a tip, a product, or a membership.',
    go_kill: 'Decide first: if you get real engagement and at least one person takes the paid offer, keep going. If it is crickets, change the hook or the audience.',
  },
  ecommerce_pod: {
    focus: 'the person who would buy this for themselves or as a gift at full price',
    action: 'Put up a simple pre-order or "buy now" page for one product and get 20 real people to look at it this week.',
    go_kill: 'Decide first: if you get 1 to 2 pre-orders from those 20, the demand is real. If zero, test a different product or audience before ordering any stock.',
  },
  remote_hybrid_physical: {
    focus: 'someone who runs into this problem in their day right now',
    action: 'Talk to 5 potential customers in person or by phone and ask what they use today and what they would pay for something better.',
    go_kill: 'Decide first: if 3 of the 5 are frustrated with what they use now and would try yours, keep going. If they are happy, the problem may be too small.',
  },
  micro_solo: {
    focus: 'one person you already know who has this exact need',
    action: 'Offer it to 5 people you can reach this week and ask for a small payment or a deposit to reserve it.',
    go_kill: 'Decide first: if 1 to 2 pay or put down a deposit, you have a real start. If everyone says "maybe later," make the offer sharper or cheaper.',
  },
};
const UNIVERSAL = {
  focus: 'the one person who feels this problem the most',
  action: 'Talk to 5 real people who have this problem, ask if they would pay for this, and ask the most interested one to prove it with a small deposit, a pre-order, or a booked call.',
  go_kill: 'Decide first: if 3 of the 5 say yes and one backs it with money or time, keep building. If fewer than 2 care, rework who the customer is before going further.',
};
function contentFor(category) { return PROOF_BY_CATEGORY[category] || UNIVERSAL; }

// Pick the one concept to prompt on: prefer one not prompted in the last few weeks, then one on a
// serious path (build or sell), then the freshest. Never a Clay seed.
async function pickConcept(ownerId) {
  const r = await query(`
    SELECT c.id, c.title, c.category::text AS category, ci.path
      FROM concepts c
      LEFT JOIN concept_intents ci ON ci.concept_id = c.id AND ci.user_id = c.owner_id
      LEFT JOIN LATERAL (
        SELECT max(created_at) AS last_prompt FROM creator_proof_prompts p WHERE p.concept_id = c.id
      ) lp ON TRUE
     WHERE c.owner_id = $1 AND c.origin IS DISTINCT FROM 'clay_seed'
     ORDER BY (lp.last_prompt IS NULL OR lp.last_prompt < now() - interval '21 days') DESC,
              (ci.path IN ('build_myself','refine_to_sell')) DESC NULLS LAST,
              c.updated_at DESC NULLS LAST
     LIMIT 1`, [ownerId]);
  return r.rows[0] || null;
}

// The creator's prompt for the current week — generate it deterministically if none exists yet.
// Returns null only when the creator has no concept of their own to prove.
async function ensurePromptForWeek(ownerId) {
  const ex = await query(`
    SELECT p.*, c.title AS concept_title
      FROM creator_proof_prompts p JOIN concepts c ON c.id = p.concept_id
     WHERE p.owner_id = $1 AND p.week_start = date_trunc('week', now())::date
     LIMIT 1`, [ownerId]);
  if (ex.rows[0]) return ex.rows[0];

  const concept = await pickConcept(ownerId);
  if (!concept) return null;
  const c = contentFor(concept.category);
  const ins = await query(`
    INSERT INTO creator_proof_prompts (owner_id, concept_id, week_start, focus, action, go_kill, source)
    VALUES ($1, $2, date_trunc('week', now())::date, $3, $4, $5, 'template')
    ON CONFLICT (owner_id, week_start) DO NOTHING
    RETURNING *`, [ownerId, concept.id, c.focus, c.action, c.go_kill]);
  if (ins.rows[0]) return { ...ins.rows[0], concept_title: concept.title };

  // Lost a race — re-read the row someone else inserted.
  const re = await query(`
    SELECT p.*, c.title AS concept_title
      FROM creator_proof_prompts p JOIN concepts c ON c.id = p.concept_id
     WHERE p.owner_id = $1 AND p.week_start = date_trunc('week', now())::date LIMIT 1`, [ownerId]);
  return re.rows[0] || null;
}

// Shape for the API/dashboard.
async function currentPrompt(ownerId) {
  const p = await ensurePromptForWeek(ownerId);
  if (!p) return null;
  return {
    id: p.id,
    concept_id: p.concept_id,
    concept_title: p.concept_title,
    focus: p.focus,
    action: p.action,
    go_kill: p.go_kill,
    status: p.status,
    week_start: p.week_start,
  };
}

async function markDone(ownerId, promptId) {
  const r = await query(
    `UPDATE creator_proof_prompts SET status='done', acted_at=now()
      WHERE id=$1 AND owner_id=$2 AND status='active' RETURNING id`,
    [promptId, ownerId]);
  return r.rows.length > 0;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function buildEmail(p) {
  const title = p.concept_title || 'your concept';
  const subject = `Your proof step this week: ${title}`;
  const lines = [
    `This week, take one small, finishable step to prove ${title} — the kind of proof that comes from what someone does, not a compliment.`,
    `Pick one customer: ${p.focus}.`,
    `Run one proof action: ${p.action}`,
    `Go or kill — ${p.go_kill}`,
    `That's the whole job: one concept, one customer, one action. When you've run it, come tell me how it went and we'll decide the next move together.`,
  ];
  const text = lines.join('\n\n') + `\n\nOpen your dashboard: ${SITE}/dashboard.html\n\n— Clay, Access YP Labs`;
  const html = '<div style="font-family:system-ui,-apple-system,Arial,sans-serif;font-size:16px;line-height:1.6;color:#191630;max-width:560px">'
    + lines.map((l) => `<p style="margin:0 0 14px">${escapeHtml(l)}</p>`).join('')
    + `<p style="margin:18px 0 4px"><a href="${SITE}/dashboard.html" style="color:#3a2ba6;font-weight:600">Open your dashboard</a></p>`
    + '<p style="margin:14px 0 0;color:#585272">— Clay, Access YP Labs</p></div>';
  return { subject, html, text };
}

// Weekly scheduler: for each creator with a concept of their own and no prompt this week, generate
// one and email it. Atomic weekly claim, capped, best-effort — never throws, never double-sends
// (the per-week UNIQUE and the emailed flag guard that).
async function tick() {
  let claimed = false;
  try {
    const r = await query(`
      UPDATE proof_prompt_schedule SET last_run_at = now(), updated_at = now()
       WHERE id = TRUE AND enabled = TRUE
         AND (last_run_at IS NULL OR last_run_at < now() - (min_gap_minutes || ' minutes')::interval)
       RETURNING id`);
    claimed = r.rows.length > 0;
  } catch (e) {
    console.error('proof prompt claim error:', e && e.message);
    return { ok: false, reason: 'claim_error' };
  }
  if (!claimed) return { ok: false, reason: 'not_due' };

  let creators = [];
  try {
    creators = (await query(`
      SELECT DISTINCT c.owner_id, u.email
        FROM concepts c JOIN users u ON u.id = c.owner_id
       WHERE c.origin IS DISTINCT FROM 'clay_seed' AND u.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM creator_proof_prompts p
            WHERE p.owner_id = c.owner_id AND p.week_start = date_trunc('week', now())::date)
       LIMIT 200`)).rows;
  } catch (e) {
    console.error('proof prompt creators query error:', e && e.message);
    return { ok: false, reason: 'query_error' };
  }

  let made = 0; let emailed = 0;
  for (const cr of creators) {
    try {
      const p = await ensurePromptForWeek(cr.owner_id);
      if (!p) continue;
      made += 1;
      if (cr.email && !p.emailed) {
        const em = buildEmail(p);
        const res = await sendEmail({ to: cr.email, subject: em.subject, html: em.html, text: em.text });
        if (res && res.sent) {
          emailed += 1;
          await query('UPDATE creator_proof_prompts SET emailed=true WHERE id=$1', [p.id]);
        }
      }
    } catch (e) {
      console.error('proof prompt per-creator error:', e && e.message);
    }
  }
  const out = { ok: true, creators: creators.length, made, emailed };
  console.log('proof prompt tick:', JSON.stringify(out));
  return out;
}

module.exports = { currentPrompt, markDone, ensurePromptForWeek, tick };
