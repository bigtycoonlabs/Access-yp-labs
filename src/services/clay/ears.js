// PENNY LISTENING.
//
// The page records what somebody says and sends it here; this turns it into words and hands them
// back. The recording is never kept: it is held in memory for the length of one request and then it
// is gone. Nothing about a voice belongs in a database that was built to hold what a business owes.
//
// It never invents words. An empty or unintelligible recording comes back as nothing heard, said in
// those words, because a guess put into the chat as though the person said it is the worst possible
// failure here: they would be answering a question they never asked.

const MAX_BYTES = 8 * 1024 * 1024;
const MODEL = process.env.SPEECH_TO_TEXT_MODEL || 'gpt-4o-mini-transcribe';

async function hear(buffer, mime) {
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, kind: 'unavailable',
      says: 'Listening is not switched on for this server, so nothing was heard. Type it instead.' };
  }
  if (!buffer || !buffer.length) {
    return { ok: false, kind: 'unclear', says: 'The recording arrived empty, so there was nothing to hear.' };
  }
  if (buffer.length > MAX_BYTES) {
    return { ok: false, kind: 'unclear',
      says: 'That recording is too long for me to take in one piece. Try again in a shorter go.' };
  }
  const type = String(mime || 'audio/webm').split(';')[0];
  const ext = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav',
    'audio/x-wav': 'wav', 'audio/ogg': 'ogg' }[type] || 'webm';
  const form = new FormData();
  form.append('file', new Blob([buffer], { type }), 'speech.' + ext);
  form.append('model', MODEL);
  let r;
  try {
    r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY }, body: form,
    });
  } catch (e) {
    return { ok: false, kind: 'unavailable',
      says: 'I could not make out what was said, and I will not guess. Try again, or type it. ' + e.message };
  }
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    return { ok: false, kind: 'unavailable',
      says: 'I could not make out what was said, and I will not guess. Try again, or type it.',
      detail: detail.slice(0, 200) };
  }
  const d = await r.json().catch(() => ({}));
  const said = String(d.text || '').trim();
  if (!said) {
    return { ok: false, kind: 'empty',
      says: 'I did not hear anything in that. Say it again, or type it.' };
  }
  return { ok: true, text: said };
}

module.exports = { hear, MAX_BYTES };
