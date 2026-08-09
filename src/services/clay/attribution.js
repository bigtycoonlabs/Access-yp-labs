// KNOWING WHETHER A POST ACTUALLY BROUGHT ANYONE.
//
// Clay Weekly already does this: every share link carries where it came from, and the newsroom shows
// subscribers broken down by source. Listings had nothing, so promoting one across four channels for
// a month produced no way to tell which channel worked — or whether any did. That makes the
// marketing half of the operations role unmanageable, and it means the person doing it gets judged
// on their own opinion of their work.
//
// Two halves, and both are needed for either to be worth anything:
//   PROMOTIONS  what we posted, where, and when. Without it, "which listings have never been
//               promoted" is guesswork and the rotation quietly favours the easy ones.
//   VISITS      who arrived and which link they followed. Without it, promotions are a diary.
//
// What this deliberately does NOT record: which named person looked at which listing. A listing view
// is browsing. Recording that a specific creator opened a specific listing would be surveillance
// wearing an analytics badge, and the number it would produce — how many people looked — is
// available without it.

const { query } = require('../../config/db');

// The channels a share link can be minted for. A fixed list rather than free text, because
// "instagram", "Instagram" and "ig" in the same report is how a source breakdown becomes useless.
const CHANNELS = ['instagram', 'facebook', 'linkedin', 'x', 'tiktok', 'youtube', 'reddit',
  'email', 'newsletter', 'forum', 'direct', 'card'];

const SITE = () => (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/+$/, '');

function shareLinks(listingId) {
  return CHANNELS.map((c) => ({
    channel: c,
    url: `${SITE()}/listing.html?id=${encodeURIComponent(listingId)}&from=${c}`,
  }));
}

// Record an arrival. Best-effort in the strongest sense: a visitor must never see an error, or wait,
// because we could not write an analytics row. The page they came for matters; the counting does not.
async function recordVisit({ listingId, source, visitor, signedIn = false }) {
  if (!listingId) return { ok: false, reason: 'no_listing' };
  // Unknown sources are kept as 'other' rather than discarded — a visit we cannot attribute is still
  // a visit, and dropping it would quietly understate how many people arrived.
  const clean = CHANNELS.includes(String(source || '').toLowerCase())
    ? String(source).toLowerCase()
    : (source ? 'other' : null);
  try {
    await query(
      `INSERT INTO listing_visits (listing_id, source, visitor, signed_in) VALUES ($1,$2,$3,$4)`,
      [listingId, clean, visitor ? String(visitor).slice(0, 120) : null, !!signedIn]);
    return { ok: true, source: clean };
  } catch (e) {
    console.error('could not record a listing visit:', e && e.message);
    return { ok: false, reason: 'write_failed' };
  }
}

// Record that we promoted something. Written by a person after they post, because nothing here can
// see a post going out — and a log that guesses is worse than one somebody keeps.
async function recordPromotion({ listingId, channel, note, staffId }) {
  const c = String(channel || '').toLowerCase();
  if (!CHANNELS.includes(c)) {
    return { ok: false, reason: 'unknown_channel',
      message: 'Pick one of: ' + CHANNELS.join(', ') + '.' };
  }
  const r = await query(
    `INSERT INTO listing_promotions (listing_id, channel, note, staff_id)
     VALUES ($1,$2,$3,$4) RETURNING id, created_at`,
    [listingId, c, note ? String(note).slice(0, 500) : null, staffId || null]);
  return { ok: true, promotion: r.rows[0] };
}

// What happened for ONE listing: what we posted, and what arrived.
async function listingReport(listingId) {
  const promos = await query(
    `SELECT channel, note, created_at FROM listing_promotions
      WHERE listing_id=$1 ORDER BY created_at DESC LIMIT 25`, [listingId]);
  const visits = await query(
    `SELECT COALESCE(source,'unattributed') AS source,
            count(*)::int AS visits,
            count(DISTINCT visitor)::int AS people
       FROM listing_visits WHERE listing_id=$1
      GROUP BY 1 ORDER BY visits DESC`, [listingId]);
  const totals = await query(
    `SELECT count(*)::int AS visits, count(DISTINCT visitor)::int AS people,
            max(created_at) AS last_visit
       FROM listing_visits WHERE listing_id=$1`, [listingId]);
  return {
    promotions: promos.rows,
    by_source: visits.rows,
    totals: totals.rows[0],
    share_links: shareLinks(listingId),
  };
}

// Across the whole market: which channels are actually doing anything.
//
// Reported as promotions AND visits side by side, because a channel with 20 posts and 2 visits and a
// channel with 1 post and 2 visits are telling you opposite things, and a visit count alone hides
// which one you are looking at.
async function channelReport({ days = 30 } = {}) {
  const r = await query(
    `SELECT c.channel,
            COALESCE(p.posts, 0)::int AS posts,
            COALESCE(v.visits, 0)::int AS visits,
            COALESCE(v.people, 0)::int AS people
       FROM (SELECT unnest($2::text[]) AS channel) c
       LEFT JOIN (
         SELECT channel, count(*)::int AS posts FROM listing_promotions
          WHERE created_at > now() - ($1 || ' days')::interval GROUP BY channel
       ) p ON p.channel = c.channel
       LEFT JOIN (
         SELECT source AS channel, count(*)::int AS visits, count(DISTINCT visitor)::int AS people
           FROM listing_visits
          WHERE created_at > now() - ($1 || ' days')::interval AND source IS NOT NULL
          GROUP BY source
       ) v ON v.channel = c.channel
      ORDER BY visits DESC, posts DESC`,
    [String(days), CHANNELS]);

  const unattributed = await query(
    `SELECT count(*)::int AS n FROM listing_visits
      WHERE created_at > now() - ($1 || ' days')::interval AND source IS NULL`, [String(days)]);

  return {
    window_days: days,
    channels: r.rows.filter((c) => c.posts > 0 || c.visits > 0),
    // Stated rather than hidden. Most early traffic arrives with no source, and a report that only
    // showed attributed visits would make the platform look quieter than it is.
    unattributed_visits: unattributed.rows[0].n,
  };
}

// The rotation: every live listing with when it was last promoted, oldest first. This is the
// marketing worklist, and it exists so a creator's project cannot quietly go untouched while the
// easy ones get posted about repeatedly.
async function rotation({ limit = 25 } = {}) {
  const r = await query(
    `SELECT l.id, c.title,
            (SELECT max(created_at) FROM listing_promotions p WHERE p.listing_id = l.id) AS last_promoted,
            (SELECT count(*)::int FROM listing_promotions p WHERE p.listing_id = l.id) AS times_promoted,
            (SELECT count(*)::int FROM listing_visits v WHERE v.listing_id = l.id) AS visits
       FROM listings l JOIN concepts c ON c.id = l.concept_id
      WHERE l.status = 'live'
      ORDER BY last_promoted ASC NULLS FIRST, l.created_at ASC
      LIMIT $1`, [Math.min(Math.max(Number(limit) || 25, 1), 100)]);
  return r.rows.map((x) => ({
    ...x,
    never_promoted: !x.last_promoted,
    days_since: x.last_promoted
      ? Math.floor((Date.now() - new Date(x.last_promoted).getTime()) / 86400000)
      : null,
  }));
}

module.exports = { CHANNELS, shareLinks, recordVisit, recordPromotion, listingReport, channelReport, rotation };
