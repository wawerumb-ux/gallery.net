/* ────────────────────────────────────────────────────────────────────
   mouse-effect.js — the mouse-particle effect, living inside the gallery.

   This is the web build of the effect that also ships as native ports in
   `mouse-effect/` (Python + Rust). It is NOT a standalone page any more:
   it is a module the archive loads, so the effect trails the cursor over
   the real photo wall instead of over a demo canvas.

   One canvas, three gestures, five particle types and five cursor skins:

     Move                   particles drag behind the cursor
     Hold left + scroll     cycle the particle type
     Middle-click           cycle the cursor skin
     Type                   letters float up from the cursor

   TWO DELIBERATE DEVIATIONS from the playground build, because this one
   runs on top of a usable interface rather than owning the screen:

   1. The native cursor stays visible. The playground hid it and drew a
      skin in its place; over a grid of photos and a bar of buttons that
      would cost real precision — you could no longer see exactly what you
      were about to click. So each "skin" here is an AURA that rides around
      the system pointer: swapping it is still a visible, satisfying change,
      but the pointer you aim with never disappears.

   2. Plain scrolling still scrolls. Only a scroll performed WHILE the left
      button is held is swallowed (that is the type-cycling gesture); the
      playground preventDefault'd every wheel event because it was a
      fullscreen canvas with nothing else to scroll. Here it would have
      locked the archive the moment the effect was switched on.

   The effect is opt-in and remembered (`gallery.mouseEffect`). Turning it
   on costs a canvas and a listener set; turning it off clears both.

   TOUR INTEGRATION — every gesture that a visitor can perform here also
   dispatches `window CustomEvent('tour:action', { detail: { name } })`:

     mouse-effect-on      the effect became enabled (any way it happened)
     mouse-effect-off     it became disabled again
     mouse-effect-move    the cursor travelled far enough to draw a trail
     mouse-effect-cycle   the particle type changed
     mouse-effect-skin    the cursor skin changed
     mouse-effect-letter  a letter floated

   The guided tour gates its mouse-effect steps on exactly those names, so
   the steps advance on the REAL gesture. The engine's card always carries
   a Next button too: an experienced visitor steps past the run without
   performing any of it, and on these steps — whose whole subject is a
   gesture — Next is recorded as done rather than as a skip, because that
   is what pressing it there means. The events are inert when no tour
   listens.
   ──────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  var ENABLED_KEY = 'gallery.mouseEffect';

  /* The particle behaviours, in cycle order. `null` = the trail is off —
     the aura and the floating letters still run, so "no particles" is a
     look you can rest on rather than the effect being disabled. */
  var TYPES = ['Sparkle', 'Hearts', 'Stars', 'Rainbow', 'Embers', null];

  /* The cursor skins, in cycle order. Each is an aura drawn AROUND the
     native pointer, never a replacement for it (see deviation 1). */
  var SKINS = ['Chroma', 'Pulse', 'Sparkle', 'Comet', 'Reticle'];

  var canvas = null, ctx = null, hud = null;
  var enabled = false, running = false, rafId = 0;
  var typeIdx = 0, skinIdx = 0;
  var reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}

  var mouse = { x: -999, y: -999 };
  var lastEmit = { x: -999, y: -999 };
  var lastMove = { x: 0, y: 0 };  // where the pointer was at the last move
  var moved = 0;                  // px travelled since the last move-tour ping
  var movedOnce = false;
  var mouseDown = false;
  var particles = [], letters = [];
  var hueBase = 0;

  /* The tour listens on `window` for `tour:action`. Firing into the void
     costs nothing, so there is no coupling back into the tour from here. */
  function tourAction(name) {
    try { window.dispatchEvent(new CustomEvent('tour:action', { detail: { name: name } })); } catch (_) {}
  }

  function store(enabledNow) {
    try { localStorage.setItem(ENABLED_KEY, enabledNow ? '1' : '0'); } catch (_) { /* private mode */ }
  }
  function recall() {
    try { return localStorage.getItem(ENABLED_KEY) === '1'; } catch (_) { return false; }
  }

  /* ── DOM ───────────────────────────────────────────────────────────
     Built on first enable and torn down on disable, so a visitor who
     leaves the effect off never pays for the canvas or its listeners. */
  function ensureDom() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'meCanvas';
    canvas.setAttribute('aria-hidden', 'true');
    hud = document.createElement('div');
    hud.id = 'meHud';
    hud.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    document.body.appendChild(hud);
    ctx = canvas.getContext('2d');
    size();
    window.addEventListener('resize', size);
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('auxclick', onAux);
    window.addEventListener('keydown', onKey);
  }

  function size() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  /* ── Gestures ──────────────────────────────────────────────────── */

  function onMove(e) {
    if (!enabled) return;
    mouse.x = e.clientX; mouse.y = e.clientY;
    // Measure travel against the PREVIOUS move, not against the trail's
    // emit point: the emit point only advances when the trail type is on,
    // so leaning on it would under-count (or, with the trail off, count
    // the whole distance from where the cursor was parked at enable).
    if (!movedOnce) { movedOnce = true; lastMove.x = mouse.x; lastMove.y = mouse.y; }
    moved += Math.hypot(mouse.x - lastMove.x, mouse.y - lastMove.y);
    lastMove.x = mouse.x; lastMove.y = mouse.y;
    // A few dozen pixels of travel is unmistakably "the person moved the
    // mouse", which is what the tour step is really asking for — not a
    // single stray pixel jitter from a trackpad at rest.
    if (moved > 60) { moved = 0; tourAction('mouse-effect-move'); }
  }

  function onDown(e) {
    if (!enabled) return;
    if (e.button === 0) { mouseDown = true; return; }
    if (e.button !== 1) return;
    // The middle button is the skin control. It is handled on mousedown,
    // not auxclick, because that is the moment the browser decides to
    // start autoscroll — preventDefault there is what actually stops it
    // (and on X11, the paste). auxclick is left to swallow the rest.
    e.preventDefault();
    skinIdx = (skinIdx + 1) % SKINS.length;
    syncHud();
    tourAction('mouse-effect-skin');
  }
  function onUp(e) {
    if (e.button === 0) mouseDown = false;
  }

  function onWheel(e) {
    if (!enabled) return;
    // Only a scroll performed while the left button is held is ours. Any
    // other wheel event is the visitor scrolling the archive and must be
    // left completely alone (deviation 2).
    if (!mouseDown) return;
    e.preventDefault();
    var before = typeIdx;
    typeIdx = (typeIdx + (e.deltaY < 0 ? 1 : -1) + TYPES.length) % TYPES.length;
    if (typeIdx !== before) { syncHud(); tourAction('mouse-effect-cycle'); }
  }

  function onAux(e) {
    if (!enabled) return;
    if (e.button !== 1) return;
    // The skin already cycled on mousedown; this only cancels the click's
    // own default (middle-click opens a link in a new tab).
    e.preventDefault();
  }

  function onKey(e) {
    if (!enabled) return;
    // Typing into the search box or any dialog must keep working: the
    // letters only float when focus is not already in a text field.
    var t = e.target;
    var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (typing) return;
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    // The pointer may never have entered the window; a letter parked at
    // the sentinel would be drawn somewhere off-screen entirely.
    if (mouse.x < -900) return;
    letters.push({
      char: e.key, x: mouse.x + (Math.random() * 24 - 12), y: mouse.y,
      // Under reduced motion the letter appears where it was typed and
      // fades — it does not travel. The keypress still counts either way.
      vy: reduce ? 0 : -(Math.random() * 1.1 + 1.3),
      life: 1, decay: reduce ? 0.05 : 0.012,
      hue: (hueBase + Math.random() * 120) % 360,
    });
    tourAction('mouse-effect-letter');
  }

  /* ── Emission + update (ported from the playground) ──────────────── */

  function emit(x, y, kind) {
    var ang = Math.random() * Math.PI * 2;
    var spd = Math.random() * 1.2 + 0.25;
    var vy = Math.sin(ang) * spd * 0.5;
    if (kind === 'Hearts' || kind === 'Stars') vy -= 1.1; else vy += 0.25;
    particles.push({
      x: x, y: y, vx: Math.cos(ang) * spd * 0.5, vy: vy,
      life: 1, decay: (reduce ? 0.03 : Math.random() * 0.012 + 0.008),
      size: Math.random() * 5 + 3, spin: Math.random() * Math.PI * 2,
      vspin: (Math.random() - 0.5) * 0.18, hue: (hueBase + Math.random() * 60) % 360,
      kind: kind,
    });
  }

  function emitTrail() {
    var kind = TYPES[typeIdx];
    if (kind == null) { lastEmit.x = mouse.x; lastEmit.y = mouse.y; return; }
    var spacing = reduce ? 12 : 7;
    var dx = mouse.x - lastEmit.x, dy = mouse.y - lastEmit.y;
    var dist = Math.hypot(dx, dy);
    if (dist < spacing) return;
    var steps = Math.min(Math.floor(dist / spacing), 24);
    for (var i = 1; i <= steps; i++) {
      var t = i / steps;
      emit(lastEmit.x + dx * t, lastEmit.y + dy * t, kind);
    }
    lastEmit.x += dx; lastEmit.y += dy;
  }

  function update() {
    // The hue sweep is itself continuous motion, so reduced motion freezes
    // it: the aura keeps its colour, the rainbow keeps its spread, and
    // nothing cycles on its own.
    if (!reduce) hueBase = (hueBase + 1.2) % 360;
    var i, p, l;
    for (i = particles.length - 1; i >= 0; i--) {
      p = particles[i];
      p.x += p.vx; p.y += p.vy;
      p.vy += p.kind === 'Hearts' ? 0.004 : 0.02;
      p.vx *= 0.98; p.vy *= 0.98;
      p.spin += p.vspin; p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (i = letters.length - 1; i >= 0; i--) {
      l = letters[i];
      l.y += l.vy; l.vy *= 0.97; l.life -= l.decay;
      if (l.life <= 0) letters.splice(i, 1);
    }
  }

  /* ── Render: particles ───────────────────────────────────────────── */

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var a = Math.max(0, p.life);
      if (p.kind === 'Hearts') { drawHeart(p.x, p.y, p.size * 2.4, 'hsl(' + (340 + p.hue * 0.1) + ', 80%, 62%)', a); continue; }
      if (p.kind === 'Stars')  { drawStar(p.x, p.y, p.size * 1.6, 'hsl(' + (45 + p.hue * 0.05) + ', 95%, 65%)', a, p.spin); continue; }
      var hue = p.kind === 'Rainbow' ? (p.hue + hueBase) % 360 : p.hue;
      if (p.kind === 'Embers') hue = (20 + p.hue * 0.2) % 60;   // warm coals
      ctx.save();
      ctx.globalAlpha = a;
      if (!reduce) { ctx.shadowBlur = 10; ctx.shadowColor = 'hsl(' + hue + ', 100%, 60%)'; }
      ctx.fillStyle = 'hsl(' + hue + ', 100%, ' + (p.kind === 'Rainbow' ? 66 : 60) + '%)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawHeart(x, y, size, color, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 16, size / 16);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.bezierCurveTo(0, -6, -6, -6, -6, -1);
    ctx.bezierCurveTo(-6, 3, 0, 6, 0, 9);
    ctx.bezierCurveTo(0, 6, 6, 3, 6, -1);
    ctx.bezierCurveTo(6, -6, 0, -6, 0, -3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawStar(x, y, r, color, alpha, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var rad = i % 2 ? r * 0.45 : r;
      var ang = (Math.PI / 5) * i - Math.PI / 2;
      ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawLetters() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '700 22px system-ui, sans-serif';
    for (var i = 0; i < letters.length; i++) {
      var l = letters[i];
      ctx.globalAlpha = Math.max(0, l.life);
      ctx.fillStyle = 'hsl(' + l.hue + ', 90%, 70%)';
      ctx.fillText(l.char, l.x, l.y);
    }
    ctx.restore();
  }

  /* ── Render: cursor skins (auras around the native pointer) ───────── */

  function drawCursorAura() {
    var skin = SKINS[skinIdx];
    if (skin === 'Chroma')  return auraChroma();
    if (skin === 'Pulse')   return auraPulse();
    if (skin === 'Sparkle') return auraSparkle();
    if (skin === 'Comet')   return auraComet();
    if (skin === 'Reticle') return auraReticle();
  }

  function auraChroma() {
    ctx.save();
    ctx.translate(mouse.x, mouse.y);
    ctx.lineWidth = 3;
    if (!reduce) { ctx.shadowBlur = 14; ctx.shadowColor = 'hsl(' + hueBase + ', 100%, 60%)'; }
    ctx.strokeStyle = 'hsl(' + hueBase + ', 100%, 62%)';
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'hsl(' + ((hueBase + 180) % 360) + ', 100%, 72%)';
    ctx.beginPath(); ctx.arc(0, 0, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function auraPulse() {
    var r = 11 + Math.sin(hueBase * 0.06) * 4;
    ctx.save();
    ctx.translate(mouse.x, mouse.y);
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = 'rgba(150, 210, 255, 0.85)';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath(); ctx.arc(0, 0, r + 5, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function auraSparkle() {
    ctx.save();
    ctx.translate(mouse.x, mouse.y);
    ctx.rotate(hueBase * 0.02);
    ctx.fillStyle = 'hsl(45, 95%, 68%)';
    ctx.globalAlpha = 0.9;
    for (var i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(2.6, 9); ctx.lineTo(0, 13); ctx.lineTo(-2.6, 9);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  function auraComet() {
    var g = ctx.createRadialGradient(mouse.x - 3, mouse.y - 4, 1, mouse.x, mouse.y, 16);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    g.addColorStop(0.4, 'rgba(150, 210, 255, 0.5)');
    g.addColorStop(1, 'rgba(90, 160, 255, 0.05)');
    ctx.save();
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 16, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function auraReticle() {
    ctx.save();
    ctx.translate(mouse.x, mouse.y);
    ctx.strokeStyle = 'rgba(120, 230, 190, 0.9)';
    ctx.lineWidth = 2;
    for (var i = 0; i < 4; i++) {
      var a = (Math.PI / 2) * i;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 7, Math.sin(a) * 7);
      ctx.lineTo(Math.cos(a) * 17, Math.sin(a) * 17);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(120, 230, 190, 0.95)';
    ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /* ── HUD ─────────────────────────────────────────────────────────── */

  function syncHud() {
    if (!hud) return;
    hud.textContent = '✦ ' + (TYPES[typeIdx] || 'No particles') + ' · ' + SKINS[skinIdx];
  }

  /* ── Loop ────────────────────────────────────────────────────────── */

  function frame() {
    emitTrail();
    update();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawParticles();
    drawLetters();
    if (mouse.x > -900) drawCursorAura();
    rafId = window.requestAnimationFrame(frame);
  }

  /* ── Lifecycle ───────────────────────────────────────────────────── */

  function enable(persist) {
    if (enabled) return;
    ensureDom();
    enabled = true;
    if (hud) { syncHud(); hud.hidden = false; }
    // Nothing streaks from a stale point, and the movement tally starts
    // over so the first sweep after switching on is a real sweep.
    lastEmit.x = -999; lastEmit.y = -999;
    moved = 0; movedOnce = false;
    if (!running) { running = true; rafId = window.requestAnimationFrame(frame); }
    if (persist !== false) store(true);
    syncButton();
    tourAction('mouse-effect-on');
  }

  function disable(persist) {
    if (!enabled) return;
    enabled = false;
    particles.length = 0; letters.length = 0;
    if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; }
    running = false;
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (hud) hud.hidden = true;
    if (persist !== false) store(false);
    syncButton();
    tourAction('mouse-effect-off');
  }

  function toggle() { enabled ? disable() : enable(); }
  function isEnabled() { return enabled; }

  /* The tour arms the effect itself as it starts (tour/boot.js), so that
     the segment's first step has a known OFF to switch on from — and, when
     it resumes mid-segment, a known ON for the gestures to work against.
     Both directions are the tour's own bookkeeping rather than the
     visitor's decision, so neither may rewrite what they chose to
     remember. Only a click on the real toggle persists.
     `suppress` and `tourResume` are those two directions. */
  function suppress() { disable(false); }
  function tourResume() { enable(false); }

  /* The app bar button mirrors the state; the ⋮ menu row reads it too. */
  function syncButton() {
    var btn = document.getElementById('mouseEffectBtn');
    if (!btn) return;
    btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  }

  window.MouseEffect = {
    enable: enable,
    disable: disable,
    suppress: suppress,
    tourResume: tourResume,
    toggle: toggle,
    isEnabled: isEnabled,
    syncButton: syncButton,
  };

  /* Restore the remembered choice once the page is up. The tour steps that
     demonstrate the effect gate on `mouse-effect-on`, so a visitor who left
     it on simply finds it already running; one who never switched it on
     gets it the moment the tour's own click turns it on. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { if (recall()) enable(); else syncButton(); });
  } else if (recall()) {
    enable();
  } else {
    syncButton();
  }
})();
