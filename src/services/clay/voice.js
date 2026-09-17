// PENNY'S VOICE.
//
// Heart, from the same engine that reads the advertisements, running on this server. The model
// never reaches the browser and neither does any key: the page sends a sentence, this sends back
// sound.
//
// WHY SENTENCE BY SENTENCE. Speaking takes about as long as the words last, so waiting for a whole
// answer before making a sound leaves a person sitting in silence wondering whether anything is
// happening. A sentence at a time means she starts talking almost immediately and keeps talking
// while the rest is still being worked out.
//
// WHAT THIS REFUSES TO DO. It never returns silence dressed as success. If the voice cannot load or
// cannot speak, the caller is told so and the page falls back to the person's own screen reader,
// which is the thing they already trust. A voice that goes quiet for an unexplained reason is worse
// than no voice at all for somebody who cannot see a spinner.

const crypto = require('crypto');

const VOICE = 'af_heart';
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const MAX_CHARS = 700;

let loading = null;
let tts = null;
let broken = null;

// The last few hundred sentences she has said, so a repeated line is instant. Sentences are short
// and the cap is small: this is a convenience, not a store.
const CACHE = new Map();
const CACHE_MAX = 300;

async function engine() {
  if (tts) return tts;
  if (broken) throw new Error(broken);
  if (!loading) {
    loading = (async () => {
      // kokoro-js ships as an ES module; this file is CommonJS like the rest of the server.
      const { KokoroTTS } = await import('kokoro-js');
      return KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'cpu' });
    })().then((t) => { tts = t; return t; }).catch((e) => {
      broken = 'Penny\u2019s voice could not be loaded on this server: ' + e.message;
      loading = null;
      throw new Error(broken);
    });
  }
  return loading;
}

function key(text) { return crypto.createHash('sha1').update(VOICE + '|' + text).digest('hex'); }

// A wav header written here so the browser can play the samples without another library.
function wav(samples, rate) {
  const pcm = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

/** Speak one sentence. Returns { ok, audio, says } and never a silent success. */
async function speak(text) {
  const said = String(text || '').trim().replace(/\s+/g, ' ');
  if (!said) return { ok: false, kind: 'unclear', says: 'There was nothing to say.' };
  if (said.length > MAX_CHARS) {
    return { ok: false, kind: 'unclear',
      says: 'That is longer than one sentence, so it was not spoken. Send it a sentence at a time.' };
  }
  const k = key(said);
  if (CACHE.has(k)) return { ok: true, audio: CACHE.get(k), cached: true };
  let out;
  try {
    const e = await engine();
    out = await e.generate(said, { voice: VOICE });
  } catch (e) {
    return { ok: false, kind: 'unavailable',
      says: 'I could not speak that just now, so nothing was played. The words are on the screen. '
        + e.message };
  }
  const audio = wav(out.audio, out.sampling_rate);
  CACHE.set(k, audio);
  if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  return { ok: true, audio };
}

/** Split a reply into things to say, in order. Kept whole: a sentence cut in half reads as a fault. */
function sentences(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, (u) => u.replace(/\./g, ' dot '))
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'\u2018\u201c])|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => (s.length <= MAX_CHARS ? [s] : s.match(new RegExp('.{1,' + MAX_CHARS + '}(\\s|$)', 'g')) || []))
    .map((s) => s.trim())
    .filter(Boolean);
}

// Warm the voice at boot so the first person to ask does not wait for a download.
function warm() { engine().catch(() => {}); }

module.exports = { speak, sentences, warm, VOICE, MAX_CHARS };
