// THE ENTRY TO THE MARKET, PLAYED WHERE YOU CLICK.
//
// It used to be its own page. Clicking "The Exchange" landed on marketplace.html, which
// redirected to enter.html, which asked you to press "Drift into the Exchange" before showing
// you anything — a door in front of a door. Removing that button killed the sound, because a browser
// will not start audio without a user gesture IN THE SAME DOCUMENT, and after the redirect there was
// no gesture left.
//
// So the entry moves to where the gesture is. Clicking the Exchange link plays it right there,
// on the page you are already on, and then takes you in. One click, sound intact, no extra screen.
//
// No skip and no mute, deliberately: it lasts under three seconds. A control to escape a three
// second thing is more friction than the thing.
//
// Accessibility is not skipped along with the button:
//   prefers-reduced-motion goes straight through with no overlay and no wait — a stated preference
//     answered with yes rather than a shorter no.
//   the overlay is aria-hidden and the words are spoken once through a live region, so a screen
//     reader hears one clean sentence instead of narrating an animation.
//   the destination is a normal href, so anything that ignores this script still arrives.
(function () {
  var MARKET = '/marketplace.html';
  var DEST = MARKET + '?entered=1';

  function playDream(){
    var actx; try{ actx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return; }
    var now=actx.currentTime, master=actx.createGain(); master.gain.value=0.8; master.connect(actx.destination);
    [174,220,262].forEach(function(f,i){
      var o=actx.createOscillator(); o.type='sine'; o.frequency.value=f; o.detune.value=(i-1)*6;
      var g=actx.createGain(); g.gain.setValueAtTime(0.0001,now);
      g.gain.linearRampToValueAtTime(0.05,now+0.9); g.gain.linearRampToValueAtTime(0.0001,now+3.2);
      o.connect(g); g.connect(master); o.start(now); o.stop(now+3.3);
    });
    [523,659,784,988,1175].forEach(function(base,i){
      var t=[0.2,0.7,1.2,1.9,2.5][i];
      var o=actx.createOscillator(); o.type='sine'; o.frequency.value=base;
      var g=actx.createGain(); g.gain.setValueAtTime(0.0001,now+t);
      g.gain.exponentialRampToValueAtTime(0.06,now+t+0.02); g.gain.exponentialRampToValueAtTime(0.0001,now+t+0.9);
      o.connect(g); g.connect(master); o.start(now+t); o.stop(now+t+1.0);
    });
    var nb=actx.createBuffer(1,Math.floor(actx.sampleRate*3),actx.sampleRate), nd=nb.getChannelData(0);
    for(var i=0;i<nd.length;i++){ nd[i]=(Math.random()*2-1); }
    var n=actx.createBufferSource(); n.buffer=nb;
    var nf=actx.createBiquadFilter(); nf.type='lowpass'; nf.frequency.value=520;
    var ng=actx.createGain(); ng.gain.setValueAtTime(0.0001,now); ng.gain.linearRampToValueAtTime(0.03,now+1.0); ng.gain.linearRampToValueAtTime(0.0001,now+3.0);
    n.connect(nf); nf.connect(ng); ng.connect(master); n.start(now); n.stop(now+3.0);
    var o2=actx.createOscillator(); o2.type='sine'; o2.frequency.value=131;
    var g2=actx.createGain(); g2.gain.setValueAtTime(0.0001,now+2.2); g2.gain.linearRampToValueAtTime(0.08,now+2.7); g2.gain.linearRampToValueAtTime(0.0001,now+3.5);
    o2.connect(g2); g2.connect(master); o2.start(now+2.2); o2.stop(now+3.6);
    setTimeout(function(){ try{actx.close();}catch(e){} },3800);
  }

  function overlay() {
    var wrap = document.createElement('div');
    wrap.id = 'dreamentry';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:radial-gradient(circle at 50% 45%,'
      + '#241a44 0%,#140f28 55%,#0b0817 100%);display:flex;align-items:center;justify-content:center;'
      + 'padding:28px;text-align:center;opacity:0;transition:opacity .45s ease;';
    var p = document.createElement('p');
    p.style.cssText = 'color:#e7e1f7;font:600 1.35rem/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;'
      + 'max-width:20ch;margin:0;opacity:0;transition:opacity .5s ease;';
    // The line the owner rewrote this for. No thousand ideas turning toward anybody, and no promise
    // that one of them is meant for you — we cannot know that, and most listed projects never sell.
    p.textContent = 'Every one of these is a business somebody never got around to starting.';
    wrap.appendChild(p);
    document.body.appendChild(wrap);
    requestAnimationFrame(function () { wrap.style.opacity = '1'; p.style.opacity = '1'; });
    setTimeout(function () { p.style.opacity = '0'; }, 1500);
    setTimeout(function () {
      p.textContent = 'They are all still here.';
      p.style.opacity = '1';
    }, 1900);
    return wrap;
  }

  function enter(e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;   // let people open a new tab
    e.preventDefault();
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { location.href = DEST; return; }
    try { sessionStorage.setItem('descended', '1'); } catch (_) { }
    // Created inside the click handler, which is the whole point: this is the gesture the browser
    // requires, and it is why the sound plays now and did not before.
    try { playDream(); } catch (_) { }
    overlay();
    if (window.announce) announce('Every one of these is a business somebody never got around to starting. They are all still here.');
    setTimeout(function () { location.href = DEST; }, 2900);
  }

  function bind() {
    var links = document.querySelectorAll('a[href="' + MARKET + '"]');
    Array.prototype.forEach.call(links, function (a) {
      if (a.dataset.dreamBound) return;
      a.dataset.dreamBound = '1';
      a.addEventListener('click', enter);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
  // The menu is built by nav.js after load, so its link may not exist yet when this first runs.
  setTimeout(bind, 300);
  setTimeout(bind, 1200);
})();
