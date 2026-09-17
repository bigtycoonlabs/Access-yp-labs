// TALKING WITH PENNY.
//
// Two halves, and each one works without the other: she can speak her replies, and you can speak
// to her. Both are off until switched on, both are announced in words, and neither one takes
// anything away from the page. Everything spoken aloud is also written in the thread, because a
// voice that carries something the text does not would put a screen-reader client back where they
// started.
//
// WHAT THIS REFUSES TO DO. It never goes quiet without saying why. A voice that cannot load, a
// microphone that is refused, a recording nobody could make out: each one is said, in words, and
// the page carries on exactly as it did before.
(function () {
  var speaking = false;      // is voice mode switched on
  var queue = [];            // sentences waiting to be spoken, in order
  var playing = false;
  var audio = new Audio();
  var recorder = null;
  var chunks = [];
  var announce = function () {};

  function say(el, text) { if (el) el.textContent = text; }

  // ONE AT A TIME, IN ORDER. Sentences overlapping each other is unlistenable, and skipping one
  // because the next arrived is worse: a person would never know a sentence had gone missing.
  async function pump() {
    if (playing || !queue.length) return;
    playing = true;
    var line = queue.shift();
    try {
      var r = await fetch('/api/penny/speak', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: line }),
      });
      if (!r.ok) {
        var d = {}; try { d = await r.json(); } catch (e) {}
        // Said once, then her voice stays off rather than failing on every sentence.
        speaking = false;
        var btn = document.getElementById('voice');
        if (btn) { btn.textContent = 'Penny speaks her replies: off'; btn.setAttribute('aria-pressed', 'false'); }
        announce([(d.error || 'Her voice stopped working.') + ' Her words are still on the screen.']);
        queue = [];
        playing = false;
        return;
      }
      var blob = await r.blob();
      await new Promise(function (done) {
        audio.src = URL.createObjectURL(blob);
        audio.onended = done;
        audio.onerror = done;
        audio.play().catch(done);
      });
    } catch (e) {
      queue = [];
      announce(['Her voice stopped working. Her words are still on the screen.']);
    }
    playing = false;
    pump();
  }

  function speak(line) {
    if (!speaking || !line) return;
    queue.push(String(line));
    pump();
  }

  function stop() { queue = []; try { audio.pause(); } catch (e) {} playing = false; }

  // THE LIVE TURN. Same agent, same tools, same allowance as the written turn; the difference is
  // that it reports while it works. Returns handled false if the channel could not be used at all,
  // so the caller falls back to the ordinary turn rather than leaving somebody with nothing.
  async function liveTurn(messages, waiting, hooks) {
    var body = waiting.querySelector('.body');
    var reply = '';
    var res;
    try {
      res = await fetch('/api/penny/chat/live', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messages }),
      });
    } catch (e) { return { handled: false }; }
    if (!res.ok || !res.body) return { handled: false };

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buf = '';
    var done = null;
    say(body, '');
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      var parts = buf.split('\n\n');
      buf = parts.pop();
      for (var i = 0; i < parts.length; i += 1) {
        var line = parts[i].replace(/^data: /, '').trim();
        if (!line) continue;
        var ev = {};
        try { ev = JSON.parse(line); } catch (e) { continue; }
        if (ev.type === 'working' && ev.say) {
          // What she is doing, while she does it, written and spoken.
          body.textContent = ev.say;
          speak(ev.say);
          hooks.announce([ev.say]);
        } else if (ev.type === 'worked' && ev.say) {
          speak(ev.say);
          hooks.announce([ev.say]);
        } else if (ev.type === 'note' && ev.say) {
          hooks.announce([ev.say]);
        } else if (ev.type === 'say' && ev.say) {
          reply += (reply ? ' ' : '') + ev.say;
          body.textContent = reply;
          speak(ev.say);
        } else if (ev.type === 'reply' && ev.say) {
          reply = ev.say;
          body.textContent = reply;
          speak(ev.say);
        } else if (ev.type === 'done') {
          done = ev;
        }
      }
    }
    if (!done) {
      // The channel stopped mid-turn. Never left as a half answer that reads finished.
      body.textContent = (reply ? reply + ' ' : '')
        + '(She stopped partway and the connection closed, so this answer is not complete.)';
      hooks.announce(['The connection closed before she finished. This answer is not complete.']);
      return { handled: true, reply: reply };
    }
    reply = done.reply || reply;
    body.textContent = reply;
    var spoken = [];
    if (done.status === 'incomplete') spoken.push('She stopped partway and did not finish.');
    if (done.status === 'unavailable') spoken.push('She could not run. Nothing was changed.');
    spoken.push(hooks.renderDid(waiting, done.tools_used || []));
    spoken.push(hooks.renderConfirm(waiting, done.awaiting_confirmation));
    hooks.announce(spoken.filter(Boolean));
    return { handled: true, reply: reply };
  }

  // HER EARS. Hold the button, speak, let go. What was heard is put in the box for you to read
  // before it is sent, because a misheard sentence sent as though you said it is the worst failure
  // this can have.
  async function startRecording(btn) {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      announce(['This browser cannot record, so talking to her is not available here. Typing still works.']);
      return;
    }
    var stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) {
      announce(['The microphone was not allowed, so nothing was recorded. Typing still works.']);
      return;
    }
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = async function () {
      stream.getTracks().forEach(function (t) { t.stop(); });
      btn.textContent = 'Hold to talk to Penny';
      var blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (!blob.size) { announce(['Nothing was recorded.']); return; }
      announce(['Working out what you said.']);
      try {
        var r = await fetch('/api/penny/listen', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': blob.type }, body: blob,
        });
        var d = {}; try { d = await r.json(); } catch (e) {}
        if (!r.ok || !d.text) {
          announce([(d.error || 'I could not make that out.') + ' Nothing was sent. Type it instead.']);
          return;
        }
        var box = document.getElementById('msg');
        box.value = d.text;
        box.focus();
        announce(['You said: ' + d.text + '. It is in the box. Press send, or edit it first.']);
      } catch (e) {
        announce(['That recording did not reach us, so nothing was sent. Type it instead.']);
      }
    };
    recorder.start();
    btn.textContent = 'Listening. Let go to send';
    announce(['Listening.']);
  }

  function stopRecording() {
    if (recorder && recorder.state === 'recording') recorder.stop();
    recorder = null;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var live = document.getElementById('live');
    announce = function (lines) {
      if (!live) return;
      live.textContent = (Array.isArray(lines) ? lines.filter(Boolean).join(' ') : String(lines || ''));
    };
    var voiceBtn = document.getElementById('voice');
    if (voiceBtn) {
      voiceBtn.addEventListener('click', function () {
        speaking = !speaking;
        voiceBtn.textContent = 'Penny speaks her replies: ' + (speaking ? 'on' : 'off');
        voiceBtn.setAttribute('aria-pressed', speaking ? 'true' : 'false');
        if (!speaking) stop();
        announce([speaking
          ? 'Penny will read her replies aloud, and say what she is doing while she works. Her words stay on the screen either way.'
          : 'Penny will not read anything aloud. Her words stay on the screen.']);
      });
    }
    var talk = document.getElementById('talk');
    if (talk) {
      var down = function (e) { e.preventDefault(); startRecording(talk); };
      var up = function (e) { e.preventDefault(); stopRecording(); };
      talk.addEventListener('mousedown', down);
      talk.addEventListener('touchstart', down, { passive: false });
      ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(function (n) { talk.addEventListener(n, up); });
      // Keyboard: space or enter holds while pressed, so it is not a mouse-only control.
      talk.addEventListener('keydown', function (e) {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); startRecording(talk); }
      });
      talk.addEventListener('keyup', function (e) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); stopRecording(); }
      });
    }
  });

  window.PennyVoice = { on: function () { return speaking; }, speak: speak, stop: stop, liveTurn: liveTurn };
})();
