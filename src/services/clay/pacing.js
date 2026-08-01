// HOW MANY MESSAGES, AND WHY — ported from Arbo's pacing, for a VoiceOver-first product.
//
// A blind builder hears Clay's reply through a screen reader, which speaks one long bubble
// as a single unbroken utterance. A reply that always arrives as one block reads as a wall.
// So a long, multi-part reply is split on the writer's OWN paragraph breaks into clean,
// VoiceOver-sized pieces — each announced separately by the conversation log, with a natural
// pause between them.
//
// The one rule that matters: SERIOUS content is never fragmented. A refusal, bad news, or a
// number/price the builder will act on needs all of it in one place, in order — making a
// reader hunt across bubbles for the part that mattered is cruel in exactly the wrong moment.
// Everything else is conservative: when unsure, send ONE message. An unnecessary split is
// more annoying than an unnecessary paragraph.

const SPLIT_ABOVE_WORDS = 110;

function wordCount(t) {
  return String(t || '').trim().split(/\s+/).filter(Boolean).length;
}

// Decide the shape: 'single' or 'sequence'. Conservative by design, but blind-first: the
// writer's OWN paragraph structure is the strongest signal — several distinct paragraphs read
// better to the ear as separate, individually-announced pieces than as one block, even below
// the raw word cap. Serious content still overrides everything and stays whole.
function shapeFor({ text, serious = false, isExplanatory = false } = {}) {
  if (serious) return 'single';            // never fragment a refusal, bad news, or a number
  const words = wordCount(text);
  const paragraphs = String(text || '').trim().split(/\n\n+/).filter((s) => s.trim()).length;
  if (paragraphs >= 3 && words > 45) return 'sequence';  // distinct ideas the writer separated
  if (isExplanatory && words > 60) return 'sequence';
  return words > SPLIT_ABOVE_WORDS ? 'sequence' : 'single';
}

// Split into messages on the natural paragraph breaks the writer already put in — never
// mid-idea. A very short fragment merges into the message before it (a two-word bubble is
// noise). A long sequence folds its tail into the last message so it never becomes a
// slideshow. A paragraph that is long on its own is left whole rather than cut clumsily.
function intoMessages(text, shape) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  if (shape === 'single') return [trimmed];

  const paragraphs = trimmed.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length <= 1) return [trimmed];

  const out = [];
  for (const p of paragraphs) {
    if (out.length && wordCount(p) < 12) out[out.length - 1] = out[out.length - 1] + ' ' + p;
    else out.push(p);
  }

  const MAX = 4;
  if (out.length > MAX) {
    const head = out.slice(0, MAX - 1);
    head.push(out.slice(MAX - 1).join(' '));
    return head;
  }
  return out;
}

// From a final reply plus a seriousness hint, produce the bubbles to send to the client.
function bubblesFor(text, opts = {}) {
  return intoMessages(text, shapeFor({ text, serious: !!opts.serious, isExplanatory: !!opts.isExplanatory }));
}

module.exports = { SPLIT_ABOVE_WORDS, shapeFor, intoMessages, bubblesFor };
