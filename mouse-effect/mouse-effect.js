/* ────────────────────────────────────────────────────────────────────
   mouse-effect/mouse-effect.js — the playground engine + its guide.

   One canvas, three inputs (pointer, wheel, keys), five cursor skins and
   four particle behaviours. The effect runs whether or not the guide is
   open, so a visitor can try each control while the guide explains it.

   Controls (identical across the JS / Python / Rust builds):
     Move                 particles drag behind the cursor
     Hold left + scroll   cycle the particle type (None → Particles →
                          Hearts → Stars → Rainbow → None). The first
                          two clicks+scrolls stay on None by design —
                          particles begin on the 3rd scroll up.
     Middle-click         cycle the cursor skin
     Type                 letters float up from the cursor
     Esc                  quit (Python / Rust only — the web version
                          just closes the guide)
   ──────────────────────────────────────────────────────────────────── */
"use strict";

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const hud = document.getElementById("hud");

let W, H;
function resize() { W = canvas.width = innerWidth; H = canvas.height = innerHeight; }
addEventListener("resize", resize); resize();

// "None" ×3: the first two click+scrolls stay None, particles begin on the 3rd.
const TYPES = ["None", "None", "None", "Particles", "Hearts", "Stars", "Rainbow"];
const SKINS = ["Chroma", "Roblox", "NextGen", "macOS", "Aero"];

// Damp the whole effect for anyone who asked the OS for less motion. The
// controls still work; there is just less (and calmer) stuff on screen.
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = { typeIdx: 0, skinIdx: 0, mouseDown: false };
const mouse = { x: W / 2, y: H / 2 };
const particles = [];
const letters = [];
let lastEmit = { x: mouse.x, y: mouse.y };
let hueBase = 0;

/* ── Guide ──────────────────────────────────────────────────────────
   A small step list, advanced by hand (Next / Back / Skip). Steps that map
   to a real control light up once the visitor has actually done it — but
   Next always works, so nobody is ever trapped waiting for an action. */
const guide = { step: 0, open: true, moves: 0 };
const GUIDE_STEPS = [
  {
    title: "Mouse Effect Playground",
    body: "Particles trail your cursor, the cursor itself is a swappable skin, and typing floats letters into the air. A quick tour of the controls — the effect is live behind this card, so try things as you go.",
    cta: "Show me",
  },
  {
    title: "Move to trail",
    body: "Just move your mouse. Particles drag behind the cursor like a comet tail.",
    try: "move",
  },
  {
    title: "Cycle the particle type",
    body: "Hold the <kbd>left</kbd> mouse button and <b>scroll up</b> to change the effect: Particles → Hearts → Stars → Rainbow. <b>Scroll down</b> to step back. The first couple of scrolls stay on “None” — the particles begin on the third.",
    try: "type",
  },
  {
    title: "Change the cursor skin",
    body: "Click the mouse wheel — a <b>middle-click</b> — to swap the cursor: Chroma, Roblox, NextGen, macOS, Aero.",
    try: "skin",
  },
  {
    title: "Type to float letters",
    body: "Press any letter key. It floats up from the cursor and fades away.",
    try: "letter",
  },
  {
    title: "That's the whole thing",
    body: "In the Python and Rust versions, <kbd>Esc</kbd> quits. Here, close the guide and play — reopen it anytime with the <b>?</b> button, top right.",
    cta: "Start playing",
  },
];

const guideEl = document.getElementById("meGuide");
const guideTitle = document.getElementById("meGuideTitle");
const guideBody = document.getElementById("meGuideBody");
const guideDots = document.getElementById("meGuideDots");
const guideTry = document.getElementById("meGuideTry");
const guidePrev = document.getElementById("meGuidePrev");
const guideNext = document.getElementById("meGuideNext");
const guideSkip = document.getElementById("meGuideSkip");
const guideOpenBtn = document.getElementById("meGuideOpen");

function renderGuide() {
  const s = GUIDE_STEPS[guide.step];
  const last = guide.step === GUIDE_STEPS.length - 1;
  guideTitle.textContent = s.title;
  guideBody.innerHTML = s.body;

  // Progress dots.
  guideDots.innerHTML = "";
  GUIDE_STEPS.forEach((_, i) => {
    const d = document.createElement("span");
    d.className = "me-guide-dot" + (i < guide.step ? " is-done" : i === guide.step ? " is-current" : "");
    guideDots.appendChild(d);
  });

  // The "try it" line only on steps tied to a control; it starts empty and
  // is filled in by markTried() the moment the visitor does the thing.
  if (s.try) {
    guideTry.hidden = false;
    guideTry.textContent = "Try it — waiting for you to do it…";
    guideTry.classList.remove("is-tried");
  } else {
    guideTry.hidden = true;
  }

  guidePrev.hidden = guide.step === 0;
  guideSkip.hidden = last;
  guideNext.textContent = s.cta || (last ? "Start playing" : "Next");
  guideNext.focus();
}

function openGuide() {
  guide.open = true;
  guide.step = 0;
  guideEl.hidden = false;
  document.body.classList.add("guide-open");
  renderGuide();
}
function closeGuide() {
  guide.open = false;
  guideEl.hidden = true;
  document.body.classList.remove("guide-open");
  canvas.focus();
}

/* Called from the input handlers: lights the current step's "try it" line
   once the visitor has actually performed that control. */
function markTried(kind) {
  if (!guide.open) return;
  const s = GUIDE_STEPS[guide.step];
  if (s.try !== kind) return;
  guideTry.classList.add("is-tried");
  guideTry.textContent = "Nice — that's it. Keep going, or press Next.";
}

guideNext.addEventListener("click", () => {
  if (guide.step >= GUIDE_STEPS.length - 1) { closeGuide(); return; }
  guide.step++;
  renderGuide();
});
guidePrev.addEventListener("click", () => {
  if (guide.step > 0) { guide.step--; renderGuide(); }
});
guideSkip.addEventListener("click", closeGuide);
guideOpenBtn.addEventListener("click", openGuide);

/* ── Input ────────────────────────────────────────────────────────── */

addEventListener("mousemove", e => {
  mouse.x = e.clientX; mouse.y = e.clientY;
  if (guide.open && ++guide.moves > 6) markTried("move");
});

addEventListener("mousedown", e => {
  if (e.button === 0) { state.mouseDown = true; }
  if (e.button === 1) {
    e.preventDefault();
    state.skinIdx = (state.skinIdx + 1) % SKINS.length; // scroll-button click: cursor skin
    markTried("skin");
  }
});
addEventListener("mouseup", e => {
  if (e.button === 0) { state.mouseDown = false; }
});

addEventListener("wheel", e => {
  // While the guide card is showing, a scroll aimed at the card itself
  // should not be swallowed by the effect (it may need to scroll on a
  // small screen). Everything else is the playground's.
  if (guide.open && e.target.closest && e.target.closest(".me-guide-card")) return;
  e.preventDefault();
  const d = Math.sign(e.deltaY);
  if (state.mouseDown) {          // Click + Scroll: cycle particle type
    const before = state.typeIdx;
    state.typeIdx = (state.typeIdx - d + TYPES.length) % TYPES.length;
    if (state.typeIdx !== before && TYPES[state.typeIdx] !== "None") markTried("type");
  }
}, { passive: false });

addEventListener("keydown", e => {  // Type: letters float from the cursor
  if (e.key === "Escape") {        // web version: close the guide, nothing to quit
    if (guide.open) closeGuide();
    return;
  }
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    letters.push({ char: e.key, x: mouse.x + (Math.random() * 24 - 12), y: mouse.y,
                   vy: -(Math.random() * 1.1 + 1.3), life: 1, decay: 0.012,
                   hue: (hueBase + Math.random() * 120) % 360 });
    markTried("letter");
  }
});

/* ── Emission ─────────────────────────────────────────────────────── */

function emit(x, y, kind) {
  const ang = Math.random() * Math.PI * 2;
  const spd = Math.random() * 1.2 + 0.25;
  // Hearts and the generic trail drift outward + a touch down; hearts and
  // stars get a lift so they read as floating rather than falling.
  let vy = Math.sin(ang) * spd * 0.5;
  if (kind === "Hearts" || kind === "Stars") vy -= 1.1;
  else vy += 0.25;
  particles.push({
    x, y,
    vx: Math.cos(ang) * spd * 0.5,
    vy,
    life: 1,
    decay: (REDUCED ? 0.03 : Math.random() * 0.012 + 0.008),
    size: Math.random() * 5 + 3,
    spin: Math.random() * Math.PI * 2,
    vspin: (Math.random() - 0.5) * 0.18,
    hue: (hueBase + Math.random() * 60) % 360,
    kind,
  });
}

// Spawn along the path between the last emit point and the cursor, so a
// fast flick still leaves an unbroken trail instead of one lonely dot.
function emitTrail() {
  const kind = TYPES[state.typeIdx];
  if (kind === "None") { lastEmit.x = mouse.x; lastEmit.y = mouse.y; return; }
  const spacing = REDUCED ? 12 : 7;
  const dx = mouse.x - lastEmit.x, dy = mouse.y - lastEmit.y;
  const dist = Math.hypot(dx, dy);
  if (dist < spacing) return;
  const steps = Math.min(Math.floor(dist / spacing), 24);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    emit(lastEmit.x + dx * t, lastEmit.y + dy * t, kind);
  }
  lastEmit.x += dx; lastEmit.y += dy;
}

/* ── Update ───────────────────────────────────────────────────────── */

function update() {
  hueBase = (hueBase + (REDUCED ? 0.4 : 1.2)) % 360;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy;
    p.vy += p.kind === "Hearts" ? 0.004 : 0.02;   // hearts barely fall
    p.vx *= 0.98; p.vy *= 0.98;
    p.spin += p.vspin;
    p.life -= p.decay;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = letters.length - 1; i >= 0; i--) {
    const l = letters[i];
    l.y += l.vy; l.vy *= 0.97; l.life -= l.decay;
    if (l.life <= 0) letters.splice(i, 1);
  }
}

/* ── Render: particles ────────────────────────────────────────────── */

function drawParticles() {
  for (const p of particles) {
    const a = Math.max(0, p.life);
    if (p.kind === "Hearts") { drawHeart(p.x, p.y, p.size * 2.4, `hsl(${340 + p.hue * 0.1}, 80%, 62%)`, a); continue; }
    if (p.kind === "Stars")  { drawStar(p.x, p.y, p.size * 1.6, `hsl(${45 + p.hue * 0.05}, 95%, 65%)`, a, p.spin); continue; }
    // Particles and Rainbow are the same glowing dot; Rainbow just cycles
    // its hue faster off the shared hueBase.
    const hue = p.kind === "Rainbow" ? (p.hue + hueBase) % 360 : p.hue;
    ctx.save();
    ctx.globalAlpha = a;
    if (!REDUCED) { ctx.shadowBlur = 10; ctx.shadowColor = `hsl(${hue}, 100%, 60%)`; }
    ctx.fillStyle = `hsl(${hue}, 100%, ${p.kind === "Rainbow" ? 66 : 60}%)`;
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
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? r * 0.45 : r;
    const ang = (Math.PI / 5) * i - Math.PI / 2;
    ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ── Render: letters ──────────────────────────────────────────────── */

function drawLetters() {
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "700 22px system-ui, sans-serif";
  for (const l of letters) {
    ctx.globalAlpha = Math.max(0, l.life);
    ctx.fillStyle = `hsl(${l.hue}, 90%, 70%)`;
    ctx.fillText(l.char, l.x, l.y);
  }
  ctx.restore();
}

/* ── Render: cursor skins ─────────────────────────────────────────── */

function drawCursor() {
  if (guide.open) return;   // native pointer is visible while the guide shows
  const skin = SKINS[state.skinIdx];
  if (skin === "Chroma")  return cursorChroma();
  if (skin === "Roblox")  return cursorArrow("#ffffff", "#14181f", 1.7, true);
  if (skin === "macOS")   return cursorArrow("#14181f", "#ffffff", 1.7, false);
  if (skin === "NextGen") return cursorNextGen();
  if (skin === "Aero")    return cursorAero();
}

function cursorChroma() {
  const r = 14;
  ctx.save();
  ctx.translate(mouse.x, mouse.y);
  ctx.lineWidth = 3;
  if (!REDUCED) { ctx.shadowBlur = 14; ctx.shadowColor = `hsl(${hueBase}, 100%, 60%)`; }
  ctx.strokeStyle = `hsl(${hueBase}, 100%, 62%)`;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = `hsl(${(hueBase + 180) % 360}, 100%, 72%)`;
  ctx.beginPath(); ctx.arc(0, 0, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function cursorArrow(fill, stroke, scale, blocky) {
  ctx.save();
  ctx.translate(mouse.x, mouse.y);
  ctx.lineWidth = blocky ? 2.4 : 1.4;
  ctx.lineJoin = "miter";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 18 * scale);
  ctx.lineTo(4.4 * scale, 14 * scale);
  ctx.lineTo(8 * scale, 21 * scale);
  ctx.lineTo(11 * scale, 19 * scale);
  ctx.lineTo(7.6 * scale, 12.6 * scale);
  ctx.lineTo(13 * scale, 12 * scale);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.stroke();
  ctx.restore();
}

function cursorNextGen() {
  ctx.save();
  ctx.translate(mouse.x, mouse.y);
  const rot = hueBase * 0.02;
  ctx.rotate(rot);
  ctx.strokeStyle = `hsl(${(hueBase + 140) % 360}, 100%, 65%)`;
  ctx.lineWidth = 2;
  if (!REDUCED) { ctx.shadowBlur = 10; ctx.shadowColor = ctx.strokeStyle; }
  ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.stroke();
  // Four reticle ticks.
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 2) * i;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 6, Math.sin(a) * 6);
    ctx.lineTo(Math.cos(a) * 18, Math.sin(a) * 18);
    ctx.stroke();
  }
  ctx.fillStyle = `hsl(${(hueBase + 140) % 360}, 100%, 72%)`;
  ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function cursorAero() {
  ctx.save();
  ctx.translate(mouse.x, mouse.y);
  const g = ctx.createRadialGradient(-4, -5, 1, 0, 0, 16);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.4, "rgba(150,210,255,0.55)");
  g.addColorStop(1, "rgba(90,160,255,0.18)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath(); ctx.arc(-4, -5, 2.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/* ── HUD ──────────────────────────────────────────────────────────── */

let hudKey = "";
function updateHud() {
  const kind = TYPES[state.typeIdx];
  const skin = SKINS[state.skinIdx];
  const key = kind + "|" + skin;
  if (key === hudKey) return;
  hudKey = key;
  hud.innerHTML =
    "Particle: <span class=\"me-hud-kind\">" + kind + "</span> · " +
    "Cursor: <span class=\"me-hud-kind\">" + skin + "</span>" +
    "<span class=\"me-hud-hint\">Hold left + scroll to change · middle-click for skin · type to spell</span>";
}

/* ── Main loop ────────────────────────────────────────────────────── */

function frame() {
  emitTrail();
  update();
  ctx.clearRect(0, 0, W, H);
  drawParticles();
  drawLetters();
  drawCursor();
  updateHud();
  requestAnimationFrame(frame);
}

// Kick off with the guide up, so nobody lands on a bare canvas wondering
// what to do with it.
openGuide();
requestAnimationFrame(frame);
