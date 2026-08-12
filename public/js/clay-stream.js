// CLAY WRITES FOR THE EAR, AND SOMETIMES FORGETS.
//
// Every bubble is rendered with textContent, deliberately — no innerHTML anywhere near model output.
// The cost is that any markdown Clay emits arrives on screen as literal characters. Walked live and
// caught it: "the hard part won't be walking dogs. It'll be **trust and access**".
//
// A sighted reader shrugs at that. VoiceOver reads it as "asterisk asterisk trust and access
// asterisk asterisk" in the middle of a sentence, which is exactly the audience this platform is
// built for. His prompt already tells him not to use markdown; a prompt is guidance and a model
// drifts, so the render strips it too.
//
// Emphasis is removed rather than converted: the words carry the emphasis, and turning it into <b>
// would mean putting model output through innerHTML, which is not a trade worth making.
function speakable(text) {
  return String(text == null ? '' : text)
    .replace(/```+/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g, '$1$2')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:!?)]|$)/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1');
}

// WATCHING CLAY WORK — the client half of the stream.
//
// The accessibility decision here is the whole design, so it is written down rather than left to be
// rediscovered later.
//
// Every guide to streaming chat says the same thing: announcing each token to a screen reader turns
// the interface into a firehose. VoiceOver interrupts itself constantly, and the person ends up
// hearing fragments of a sentence they cannot follow instead of an answer they can. Streaming looks
// alive to a sighted user and is actively hostile to a blind one — and this platform is run by two
// blind people, so "looks alive" is not a good enough reason.
//
// So the two audiences get different things from the same events, which is the point:
//   * ON SCREEN, progress appears as it happens — every step, every tool, live.
//   * ALOUD, only meaningful milestones are announced, at most one every few seconds, politely, so
//     they never interrupt. And the completed answer is announced as one whole thing, because a
//     finished sentence is what a person can actually use.
//
// Nothing here invents progress. Each line corresponds to something that really happened, and a
// failed step is announced as failed — a progress signal that cannot say no is worth nothing.

(function () {
  const QUIET_MS = 4000;   // never announce more often than this while working

  function makeStatusRegion(host) {
    // The visible log: everything, as it happens. aria-hidden because the polite region below is
    // what speaks — otherwise every line would be announced twice, once as a firehose.
    const log = document.createElement('div');
    log.className = 'clay-progress';
    log.setAttribute('aria-hidden', 'true');

    // The spoken channel: polite, non-atomic, and deliberately sparse.
    const spoken = document.createElement('div');
    spoken.className = 'sr-only';
    spoken.setAttribute('role', 'status');
    spoken.setAttribute('aria-live', 'polite');
    spoken.setAttribute('aria-atomic', 'false');

    host.appendChild(log);
    host.appendChild(spoken);
    return { log, spoken };
  }

  // Stream a chat turn. onDone receives the same result shape the non-streaming endpoint returns,
  // so a caller can swap between them without changing anything downstream.
  async function streamChat(body, host, onDone, onFail) {
    const { log, spoken } = makeStatusRegion(host);
    let lastSpokeAt = 0;
    let sawAnything = false;
    let answerEl = null;

    const show = (text) => {
      const p = document.createElement('p');
      p.className = 'clay-progress-line';
      p.textContent = speakable(text);
      log.appendChild(p);
      sawAnything = true;
    };
    const speak = (text, force) => {
      const now = Date.now();
      if (!force && now - lastSpokeAt < QUIET_MS) return;   // stay quiet rather than interrupt
      lastSpokeAt = now;
      spoken.textContent = speakable(text);
    };

    const controller = new AbortController();

    // A stop control, available the whole time it is working. Prominent, not hidden in a menu:
    // stopping saves the person's time and our cost, and being unable to stop feels like being stuck.
    const stop = document.createElement('button');
    stop.type = 'button';
    stop.className = 'btn secondary clay-stop';
    stop.textContent = 'Stop';
    stop.addEventListener('click', () => {
      controller.abort();
      show('Stopped.');
      speak('Stopped. Clay was not finished, so there is no answer for that one.', true);
      stop.remove();
    });
    host.appendChild(stop);

    let res;
    try {
      // Uses Kiln's real interface (getTokens) rather than a convenience wrapper it does not have.
      // Kiln.api cannot be reused here because it parses a whole JSON body — a stream has to be
      // read as it arrives, so this is the one place that calls fetch directly.
      const tokens = (window.Kiln && Kiln.getTokens) ? Kiln.getTokens() : {};
      const headers = { 'Content-Type': 'application/json' };
      if (tokens.accessToken) headers.Authorization = 'Bearer ' + tokens.accessToken;
      res = await fetch('/api/clay/chat/stream', {
        method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
      });
    } catch (e) {
      stop.remove();
      if (e.name === 'AbortError') return;
      return onFail && onFail(new Error('Could not reach Clay.'));
    }

    if (!res.ok || !res.body) {
      stop.remove();
      return onFail && onFail(new Error(res.status === 401 ? 'Please sign in again.' : 'Clay could not start.'));
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Server-Sent Events arrive as blank-line-separated blocks. A partial block stays in the
        // buffer until the rest of it turns up, so a chunk that splits mid-JSON is not treated as
        // a broken message.
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop();

        for (const block of blocks) {
          const line = block.split('\n').find((l) => l.indexOf('data: ') === 0);
          if (!line) continue;
          let ev;
          try { ev = JSON.parse(line.slice(6)); } catch (_) { continue; }

          if (ev.type === 'phase') {
            // The instant first signal, before any work. Announced once so a blind person knows
            // immediately that something is happening — silence at the start is the worst moment.
            show(ev.note + '…');
            speak('Clay is reading your message.', true);
          } else if (ev.type === 'delta') {
            // The answer arriving in pieces. Shown live; NEVER announced piece by piece — that is
            // exactly the firehose. The whole answer is announced once, at the end, by the caller.
            sawAnything = true;
            if (!answerEl) {
              answerEl = document.createElement('p');
              answerEl.className = 'clay-answer-stream';
              answerEl.setAttribute('aria-hidden', 'true');
              answerEl._raw = '';
              host.appendChild(answerEl);
            }
            // Strip on the ACCUMULATED text, never per chunk.
            //
            // My first version of this called speakable() on each delta and shipped, and 18 literal
            // asterisks were still on screen when I looked at the live page. Obvious in hindsight:
            // the chunks arrive split, so "**trust" lands in one and " and access**" in the next,
            // and a regex looking for a matched pair can never see one inside a fragment.
            //
            // Keeping the raw text and re-rendering the whole thing each time is O(n^2) in theory
            // and completely irrelevant here — a reply is a few hundred characters and the deltas
            // arrive a few per second.
            answerEl._raw += ev.text;
            answerEl.textContent = speakable(answerEl._raw);
          } else if (ev.type === 'thinking') {
            show(ev.note + '…');
            // Not announced: "working out what to do next" is reassuring to see and tedious to hear
            // every few seconds. The first one is worth saying, so a blind person knows it started.
            if (ev.step === 1) speak('Clay is working on it.', true);
          } else if (ev.type === 'tool_start') {
            show(ev.note + '…');
            speak(ev.note + '.');
          } else if (ev.type === 'tool_done') {
            show(ev.ok ? ev.note : ('Did not work: ' + ev.note));
            // A failure is always worth interrupting for. Success can wait for the answer.
            if (!ev.ok) speak('That step did not work. ' + ev.note, true);
          } else if (ev.type === 'error') {
            finished = true;
            stop.remove();
            speak(ev.message, true);
            return onFail && onFail(new Error(ev.message));
          } else if (ev.type === 'done') {
            finished = true;
            stop.remove();
            log.remove();
            if (answerEl) answerEl.remove();   // the caller renders the real answer properly
            // The answer is announced as ONE whole thing. This is the moment the person has been
            // waiting for, and a complete sentence is what they can actually use.
            spoken.textContent = '';
            return onDone && onDone(ev.result);
          }
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
    } finally {
      stop.remove();
    }

    if (!finished) {
      // The connection ended without an answer. Say so plainly — silence is indistinguishable from
      // a frozen page, and pretending otherwise wastes someone's time.
      speak('Clay stopped partway through and did not finish.', true);
      if (onFail) onFail(new Error('Clay stopped partway through and did not finish.'));
    }
    if (!sawAnything) log.remove();
  }

  window.ClaySpeakable = speakable;
  window.ClayStream = { streamChat };
})();
