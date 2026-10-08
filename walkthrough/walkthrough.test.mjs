/* walkthrough/walkthrough.test.mjs — the walkthrough's test suite.

   Same approach as tour/tour.test.mjs and tests/: the real sources
   (walkthrough/steps.js, walkthrough/walkthrough.js) run inside a
   node:vm sandbox with a small DOM stub, a requestAnimationFrame
   queue, a timer queue driven by advance(ms), and an in-memory
   sessionStorage. Nothing is exported from the runtime on purpose —
   these tests drive it the way a browser does and observe the page's
   classes, which is what the user actually sees.

   Run with: node --test walkthrough/     (or plain `node --test`)

   The suite exists because the slide transitions shipped with the
   arrival silently dead: wt-t-arrive was left out of the CSS rule
   that reads the --wt-t-* custom properties, so the start state was
   never painted and the -in class was never dropped. Every check on
   the arrival order below is a guard against exactly that. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path, { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const stepsSrc = fs.readFileSync(join(here, 'steps.js'), 'utf8');
const runtimeSrc = fs.readFileSync(join(here, 'walkthrough.js'), 'utf8');
const cssSrc = fs.readFileSync(join(here, 'walkthrough.css'), 'utf8');

/* ── Element stub (only what walkthrough.js touches) ──────────── */

function makeEl(tag) {
  const classes = new Set();
  const el = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    children: [],
    parentNode: null,
    attrs: {},
    listeners: {},
    dataset: {},
    _textContent: '',
    hidden: false,
    src: '', alt: '', decoding: '', loading: '', fetchPriority: '',
    /* decode() is the guarantee that a tapped photo is already a bitmap.
     * The stub records the call so the tests can prove it is made. */
    decodeCalls: 0,
    decode() { this.decodeCalls++; return Promise.resolve(); },
    style: {
      props: {},
      setProperty(k, v) { this.props[k] = v; },
      getPropertyValue(k) { return this.props[k] || ''; },
    },
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, on) => { const want = on ?? !classes.has(c); want ? classes.add(c) : classes.delete(c); return want; },
    },
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
    hasAttribute(k) { return k in el.attrs; },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    insertBefore(node, ref) {
      node.parentNode = el;
      const i = ref ? el.children.indexOf(ref) : -1;
      if (i === -1) el.children.push(node); else el.children.splice(i, 0, node);
      return node;
    },
    get firstChild() { return el.children[0] || null; },
    addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
    /* Drive a handler the way a real event would, so a test can exercise
     * behaviour that only exists on an event (the photo advance). */
    fire(type, event = {}) {
      const e = { target: { closest: () => null }, preventDefault() {}, ...event };
      for (const fn of el.listeners[type] || []) fn(e);
      return e;
    },
  };
  Object.defineProperty(el, 'className', {
    get: () => [...classes].join(' '),
    set: (v) => { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
  });
  Object.defineProperty(el, 'textContent', {
    get: () => el._textContent,
    set: (v) => { el._textContent = String(v); },
  });
  Object.defineProperty(el, 'innerHTML', {
    get: () => '',
    set: (v) => { if (v === '') el.children = []; },
  });
  el.classes = () => [...classes].sort();
  return el;
}

/* ── Sandbox ──────────────────────────────────────────────────── */

function setup({ depth = 2, step = 3, reduce = false, recorded = null, seen = null, storageThrows = false } = {}) {
  const store = new Map();
  if (seen) store.set('walkthrough.seen', seen);
  const rafs = [];
  const timers = [];
  const navigations = [];
  const docListeners = {};
  let fakeNow = 1000;
  if (recorded) store.set('wt-transition', recorded);

  const byId = {};
  const mk = (id, tag) => { const e = makeEl(tag); if (id) { e.id = id; byId[id] = e; } return e; };

  const body = makeEl('body');
  body.dataset.depth = String(depth);
  if (step != null) body.dataset.step = String(step);

  const ambient = mk('wtAmbient', 'div');
  const page = makeEl('main'); page.className = 'wt-page';
  const media = mk('wtMedia', 'div');
  const counter = mk('wtCounter', 'span');
  const title = mk('wtTitle', 'h1');
  const copy = mk('wtCopy', 'p');
  const dots = mk('wtDots', 'nav');
  const actions = mk('wtActions', 'div');
  body.appendChild(ambient); body.appendChild(page);
  page.appendChild(media);
  for (const el of [counter, title, copy, dots, actions]) page.appendChild(el);

  const byClass = { 'wt-page': page };
  const document = {
    body,
    readyState: 'complete',
    createElement: (t) => makeEl(t),
    getElementById: (id) => byId[id] || null,
    querySelector(sel) {
      if (sel.startsWith('#')) return byId[sel.slice(1)] || null;
      if (sel.startsWith('.')) return byClass[sel.slice(1)] || null;
      return null;
    },
    querySelectorAll(sel) { const e = this.querySelector(sel); return e ? [e] : []; },
    addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); },
  };

  // The runtime navigates by assigning location.href, so that
  // assignment is the observable event — not a method call.
  const location = { assign: (u) => navigations.push(u) };
  Object.defineProperty(location, 'href', {
    get: () => 'https://example.test/walkthrough/cabling/',
    set: (v) => navigations.push(v),
  });
  const window = {
    innerWidth: 1280,
    matchMedia: () => ({ matches: reduce, addEventListener() {} }),
    location,
    requestAnimationFrame: (fn) => { rafs.push(fn); return rafs.length; },
  };

  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    document, window,
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
    // localStorage is a separate, durable store — the first-visit record
    // must survive the page loads the deck is made of, which is the whole
    // reason it is not sessionStorage.
    localStorage: storageThrows ? {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
    } : {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
    requestAnimationFrame: window.requestAnimationFrame,
    setTimeout: (fn, ms) => { const t = { fn, ms: ms || 0, at: fakeNow + (ms || 0), cancelled: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cancelled = true; },
    Date: { now: () => fakeNow },
  };
  sandbox.globalThis = sandbox;

  vm.runInContext(stepsSrc + '\n' + runtimeSrc, vm.createContext(sandbox), { filename: 'walkthrough.js' });

  return {
    page, store, navigations, byId,
    // Tour classes only: the page keeps its structural 'wt-page' class
    // for the whole test, so comparing it in every assertion is noise.
    classes: () => page.classes().filter(c => c !== 'wt-page'),
    // Two frames, as the runtime itself uses two rAFs.
    flushRaf() { let n = 0; while (rafs.length) { const fn = rafs.shift(); fn(); n++; if (n > 50) throw new Error('rAF loop'); } return n; },
    advance(ms) {
      const until = fakeNow + ms;
      let ran = 0;
      for (;;) {
        let next = null;
        for (const t of timers) {
          if (t.cancelled || t.at > until) continue;
          if (!next || t.at < next.at) next = t;
        }
        if (!next) break;
        fakeNow = next.at;
        timers.splice(timers.indexOf(next), 1);
        next.fn();
        ran++;
        if (ran > 10000) throw new Error('timer drain loop');
      }
      fakeNow = until;
      return ran;
    },
    // A real user click on a link inside the page.
    clickLink(href, extra = {}) {
      const a = makeEl('a');
      a.href = href;
      a.setAttribute('href', href);
      const e = {
        target: { closest: (sel) => (sel === 'a' ? a : null) },
        preventDefault() { e.defaultPrevented = true; },
        defaultPrevented: false,
        metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
        ...extra,
      };
      (docListeners.click || []).forEach(fn => fn(e));
      return e;
    },
  };
}

/* ── The authored steps ────────────────────────────────────────── */

// The step list is read straight out of the real steps.js in its own
// realm, so these tests audit the file that actually ships.
const authored = (() => {
  const sandbox = {};
  vm.runInNewContext(stepsSrc + '\n;globalThis.__S = STEPS;', sandbox);
  return JSON.parse(JSON.stringify(sandbox.__S));
})();

describe('W — authored steps', () => {
  test('W1 — every step declares a transition the runtime knows', () => {
    const runtime = fs.readFileSync(join(here, 'walkthrough.js'), 'utf8');
    const vocab = /var TRANSITIONS = \[([\s\S]*?)\];/.exec(runtime)[1]
      .match(/'([^']+)'/).slice(1);
    const known = [...runtime.matchAll(/'([a-z-]+)'/g)]
      .map(m => m[1]);
    assert.ok(/var TRANSITIONS = \[/.test(runtime), 'runtime declares TRANSITIONS');
    for (const s of authored) {
      assert.ok(s.transition, s.slug + ' has no transition');
      assert.ok(known.includes(s.transition),
        s.slug + ' uses "' + s.transition + '" which the runtime vocabulary does not list');
    }
  });

  test('W2 — the arc uses a different transition per step', () => {
    const kinds = authored.map(s => s.transition);
    assert.ok(new Set(kinds).size >= 6, 'expected a varied vocabulary, got ' + JSON.stringify(kinds));
  });

  test('W3 — the same transition arrives and departs (one continuous move)', () => {
    // The outgoing page plays the mirror of the DESTINATION's kind, so
    // a step is left with the same family it will be entered by.
    const h = setup({ step: 1, recorded: null });
    const nextKind = authored[1].transition;
    h.clickLink('https://example.test/walkthrough/infrastructure/');
    assert.ok(h.classes().includes('wt-t-' + nextKind + '-out'),
      'step 1 departs with ' + nextKind + "-out, got " + JSON.stringify(h.classes()));
  });
});

describe('W — the arrival timeline (the regression that shipped broken)', () => {
  test('W4 — the start state lands first, then the class is dropped to travel home', () => {
    const kind = authored[2].transition; // the page under test
    const h = setup({ step: 3, recorded: kind });
    // Synchronously, before any frame: arrive + the kind's start state.
    assert.deepEqual(h.classes(), ['wt-t-arrive', 'wt-t-' + kind + '-in'].sort());
    // After the frames: the start class is GONE (so the variables fall
    // back to the settled slide) and the carrier is on. wt-t-arrive
    // stays until the slide lands — it owns will-change.
    h.flushRaf();
    assert.deepEqual(h.classes(), ['wt-t-arrive', 'wt-t-go'],
      'start class must be removed as -go is added');
  });

  test('W5 — the carriers release once the slide has landed', () => {
    const kind = authored[2].transition;
    const h = setup({ step: 3, recorded: kind });
    h.flushRaf();
    h.advance(600); // past ARRIVE_MS
    assert.deepEqual(h.classes(), [], 'the page goes back to a plain box');
  });

  test('W6 — an unrecorded visit (direct load, reload) still gets a fade', () => {
    const h = setup({ step: 4, recorded: null });
    assert.ok(h.classes().includes('wt-t-fade-in'), JSON.stringify(h.classes()));
    h.flushRaf();
    assert.deepEqual(h.classes(), ['wt-t-arrive', 'wt-t-go']);
  });

  test('W7 — the record is read once and cleared, so a reload never replays it', () => {
    const h = setup({ step: 3, recorded: 'push-left' });
    assert.ok(h.classes().includes('wt-t-push-left-in'));
    assert.ok(!h.store.has('wt-transition'), 'the transition record is consumed, so a reload cannot replay it');
  });

  test('W8 — reduced motion applies no classes at all', () => {
    const h = setup({ step: 3, recorded: 'zoom-in', reduce: true });
    h.flushRaf();
    assert.deepEqual(h.classes(), [], 'reduced motion is simply there');
  });
});

describe('W — departure', () => {
  test('W9 — leaving plays the mirror and records the destination kind', () => {
    const h = setup({ step: 2, recorded: null });
    const dest = authored[2].transition;
    h.clickLink('https://example.test/walkthrough/cabling/');
    assert.ok(h.classes().includes('wt-t-leave'), 'the leave carrier is on');
    assert.ok(h.classes().includes('wt-t-' + dest + '-out'), JSON.stringify(h.classes()));
    assert.equal(h.store.get('wt-transition'), dest, 'the destination kind is recorded');
  });

  test('W10 — navigation waits for the departure to finish', () => {
    const h = setup({ step: 2 });
    h.clickLink('https://example.test/walkthrough/cabling/');
    assert.deepEqual(h.navigations, [], 'not before the transition runs');
    h.advance(320);
    assert.deepEqual(h.navigations, ['https://example.test/walkthrough/cabling/']);
  });

  test('W11 — stepping backwards through the dots mirrors a push', () => {
    const h = setup({ step: 3 });
    assert.equal(authored[1].transition, 'push-left', 'step 2 is the push');
    h.clickLink('https://example.test/walkthrough/infrastructure/'); // backwards
    assert.ok(h.classes().includes('wt-t-push-right-out'),
      'a backwards jump pushes the other way, got ' + JSON.stringify(h.classes()));
  });

  test('W12 — leaving to the gallery (not a step) is a plain fade', () => {
    const h = setup({ step: 3 });
    h.clickLink('https://example.test/index.html');
    assert.ok(h.classes().includes('wt-t-fade-out'), JSON.stringify(h.classes()));
  });

  test('W13 — reduced motion navigates immediately, with no leave', () => {
    const h = setup({ step: 3, reduce: true });
    h.clickLink('https://example.test/index.html');
    assert.deepEqual(h.navigations, ['https://example.test/index.html']);
    assert.deepEqual(h.classes(), []);
  });
});

describe('W — the front-door gate', () => {
  const N = authored.length;

  test('W14 — arriving at the final step records the walkthrough as completed', () => {
    // On arrival, not on the CTA click: a visitor who closes the tab on
    // the last slide has still been through all seven.
    const h = setup({ step: N });
    assert.equal(h.store.get('walkthrough.seen'), 'completed');
  });

  test('W15 — an earlier step records nothing at all', () => {
    const h = setup({ step: 2 });
    assert.equal(h.store.get('walkthrough.seen'), undefined,
      'being mid-walkthrough is not having seen it');
  });

  test('W16 — the final step hands off to the guided tour', () => {
    const h = setup({ step: N });
    const cta = h.byId.wtActions.children
      .find(a => a.classes().includes('wt-cta'));
    assert.match(cta.textContent, /guided tour/i,
      'the primary action is the tour, got: ' + cta.textContent);
    assert.match(cta.href, /tour\/\?tour=1$/,
      'the tour is armed on arrival, got: ' + cta.href);
  });

  test('W17 — the gallery stays reachable from the final step', () => {
    // The handoff must not become a one-way door.
    const h = setup({ step: N });
    const alt = h.byId.wtActions.children
      .find(a => a.classes().includes('wt-alt'));
    assert.match(alt.href, /index\.html$/, 'the quiet action is still the archive');
  });

  test('W18 — leaving for the gallery records a skip, and the gate opens on it', () => {
    // 'skipped' is a distinct value precisely so this is not a lie about
    // having finished — but the gate treats both the same, because its
    // question is "have they been offered this", not "did they finish".
    const h = setup({ step: 3 });
    h.clickLink('https://example.test/index.html');
    assert.equal(h.store.get('walkthrough.seen'), 'skipped');
  });

  test('W19 — completion is not downgraded to a skip by leaving afterwards', () => {
    const h = setup({ step: N });
    h.clickLink('https://example.test/index.html');
    assert.equal(h.store.get('walkthrough.seen'), 'completed',
      'markSeen is first-write-wins; walking all seven is not un-done');
  });

  test('W20 — stepping to another step never records a skip', () => {
    // Stepping backwards through the deck links to another step page, not
    // the gallery. If that recorded, bouncing around would count as done.
    const h = setup({ step: 3 });
    h.clickLink('https://example.test/walkthrough/infrastructure/');
    assert.equal(h.store.get('walkthrough.seen'), undefined);
  });

  test('W21 — a browser that refuses storage still renders every page', () => {
    // The record is best-effort by design. If it could throw, a private
    // window would lose the walkthrough entirely.
    const h = setup({ step: N, storageThrows: true });
    h.advance(1000);
    assert.ok(h.byId.wtTitle, 'the final step still built itself');
    assert.match(h.byId.wtTitle.textContent, /\S/, 'and still has its title');
    assert.deepEqual(h.navigations, []);
  });
});

describe('W — the deck layout', () => {
  // The desktop deck is a grid of rail | slide | panel. These assert
  // the grid actually resolves — a silent CSS mistake here would just
  // look like a plainer page, never an error.
  const desk = cssSrc.slice(cssSrc.indexOf('@media (pointer: fine) and (min-width: 1000px)'));

  test('W22 — the desktop grid reserves a rail, a flexible slide and a bounded panel', () => {
    assert.match(desk, /grid-template-columns:\s*92px/, 'a rail column is reserved');
    assert.match(desk, /grid-template-columns:[^;]*minmax\(0, 1fr\)[^;]*minmax\(\d+px/,
      'the slide flexes and the panel is bounded');
    assert.match(desk, /\.wt-rail\s*\{[^}]*display:\s*flex/, 'the rail shows on a fine pointer');
    assert.match(desk, /\.wt-dots\s*\{\s*display:\s*none/, 'the dots step aside where the rail shows');
  });

  test('W23 — the slide is a real canvas: radius, hairline, elevation', () => {
    const media = /\.wt-media\s*\{([\s\S]*?)\n\}/.exec(desk);
    assert.ok(media, 'the slide is styled in the desktop block');
    assert.match(media[1], /border-radius/, 'the slide has a radius');
    assert.match(media[1], /border:\s*1px solid var\(--wt-edge\)/, 'the slide has a hairline stroke');
    assert.match(media[1], /box-shadow/, 'the slide carries elevation');
  });

  test('W24 — touch keeps the dots; the rail is a pointer-device affordance', () => {
    // Slice only the mobile block itself, up to the next @media.
    const start = cssSrc.indexOf('@media (max-width: 999px)');
    const mob = cssSrc.slice(start, cssSrc.indexOf('@media', start + 10));
    assert.match(mob, /\.wt-rail\s*\{\s*display:\s*none !important/);
    assert.doesNotMatch(mob, /\.wt-dots\s*\{\s*display:\s*none/,
      'the dots must remain the progress indicator on touch');
  });

  test('W25 — the backdrop is lit, not flat black', () => {
    assert.match(cssSrc, /body\.wt::before[\s\S]*?radial-gradient/, 'a light source behind the deck');
    assert.match(cssSrc, /body\.wt::after[\s\S]*?radial-gradient/, 'a vignette to seat the deck');
    // The canvas itself is a deep near-black, not the gallery's #000.
    const bg = /--wt-bg:\s*([^;]+);/.exec(cssSrc);
    assert.ok(bg, 'the deck declares its own backdrop token');
    assert.notEqual(bg[1].trim().toLowerCase(), '#000000',
      'the backdrop is lifted off pure black so the deck sits in a space');
  });

  test('W26 — surfaces resolve from tokens, not ad-hoc literals', () => {
    // Colours are declared once in :root and referenced everywhere else.
    const root = cssSrc.slice(0, cssSrc.indexOf('}', cssSrc.indexOf(':root')));
    const body = cssSrc.slice(cssSrc.indexOf('}', cssSrc.indexOf(':root')) + 1,
                               cssSrc.indexOf('Slide transitions'));
    const literal = [...body.matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
      .map(m => m[0].toLowerCase())
      // white ink on the accent button, and the toast scrim, are exact
      // by design; everything else must be a var().
      .filter(v => v !== '#ffffff');
    assert.deepEqual(literal, [],
      'raw hex outside :root — use a token: ' + JSON.stringify(literal));
    assert.ok(/--wt-r-/.test(root), 'radii are tokenised');
    assert.match(body, /border-radius:\s*var\(--wt-r-/, 'corners reference the radius tokens');
  });
});

describe('W — page assets', () => {
  // Every walkthrough page is a static shell at its own depth, so each
  // relative reference has to climb the right number of levels. When
  // they didn't, oneui.js and download-button.js 404'd on every step
  // page and the download button silently never rendered.
  const pages = fs.readdirSync(here)
    .filter(d => fs.existsSync(join(here, d, 'index.html')))
    .map(d => ({ dir: d, file: join(here, d, 'index.html') }))
    .concat([{ dir: '.', file: join(here, 'index.html') }]);

  test('W27 — every local asset a page references resolves to a real file', () => {
    const broken = [];
    for (const { dir, file } of pages) {
      const html = fs.readFileSync(file, 'utf8');
      const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1])
        .filter(u => !/^(https?:)?\/\//.test(u) && !u.startsWith('data:') && !u.startsWith('#'));
      for (const ref of refs) {
        // Resolve the reference against the page's own directory, the
        // way a browser would.
        const target = path.resolve(path.dirname(file), ref);
        if (!fs.existsSync(target)) broken.push(dir + ' → ' + ref);
      }
    }
    assert.deepEqual(broken, [], 'unresolved local references:\n  ' + broken.join('\n  '));
  });

  test('W28 — every step page loads the motion tokens and the download button', () => {
    for (const { dir } of pages) {
      if (dir === '.') continue; // the landing has no photo, so no download
      const html = fs.readFileSync(join(here, dir, 'index.html'), 'utf8');
      assert.match(html, /src="\.\.\/\.\.\/oneui\.js"/, dir + ' must load oneui.js from the repo root');
      assert.match(html, /src="\.\.\/\.\.\/download-button\.js"/, dir + ' must load the download button');
    }
  });

  test('W29 — the deck is 16:9', () => {
    const deskBlock = cssSrc.slice(cssSrc.indexOf('@media (pointer: fine) and (min-width: 1000px)'));
    assert.match(deskBlock, /aspect-ratio:\s*16\s*\/\s*9/, 'the slide keeps a slide ratio');
  });

  test('W29b — the landing <main> carries the transition, not a copy block', () => {
    // The landing used to absolutely position a copy panel over the
    // collage, and before that it anchored above the top of the frame.
    // There is no copy panel on the landing now: the journey's cards
    // carry the copy, and the panel is display:contents so the <main> is
    // only the box the arrival/departure classes ride on.
    const base = /\.wt-page-landing \.wt-panel\s*\{([^}]*)\}/.exec(cssSrc);
    assert.ok(base, 'the shared landing panel rule exists');
    assert.match(base[1], /display:\s*contents/,
      'the retired panel must not hold a box of its own');
    const desk = /\.wt-page-landing\s*\{([^}]*)\}/.exec(
      cssSrc.slice(cssSrc.indexOf('@media (pointer: fine) and (min-width: 1000px)'))
    );
    assert.ok(desk && !/position:\s*absolute/.test(desk[1]),
      'nothing is anchored into a corner of the landing any more');
  });

  test('W30 — every step carries an accent hue, and the deck applies it', () => {
    for (const s of authored) {
      assert.ok(Number.isInteger(s.accent) && s.accent >= 0 && s.accent < 360,
        s.slug + ' has an accent hue in range');
    }
    // The runtime writes the hue onto the page as --wt-h...
    assert.match(runtimeSrc, /setProperty\('--wt-h',\s*String\(step\.accent\)\)/,
      'the step page sets --wt-h from its accent');
    // ...and the wash, eyebrow and tile all derive their colour from it,
    // so a step's colour is one value rather than three hard-coded ones.
    assert.match(cssSrc, /--wt-wash:\s*hsl\(var\(--wt-h\)/, 'the wash reads the hue');
    assert.match(cssSrc, /--wt-tint:\s*hsl\(var\(--wt-h\)/, 'the tint reads the hue');
    const eyebrow = /\.wt-counter\s*\{([\s\S]*?)\n\}/.exec(cssSrc);
    assert.ok(eyebrow && /var\(--wt-tint\)/.test(eyebrow[1]),
      'the eyebrow takes the step hue');
    // The call to action must NOT: the walkthrough stays One UI blue.
    const cta = /\.wt-cta\s*\{([\s\S]*?)\n\}/.exec(cssSrc);
    assert.ok(cta && !/var\(--wt-h\)|var\(--wt-tint\)/.test(cta[1]),
      'the primary action keeps the site accent, not the step hue');
  });

  test('W31 — the landing leads with the video, then a start button', () => {
    // The tree and its React island are gone; the landing is the request
    // journey over the footage. What the runtime still owes is both ways
    // on — into the deck and the quiet exit — because the gate sends
    // first-time visitors here and must never be able to trap them.
    assert.doesNotMatch(runtimeSrc, /buildMontage|wt-montage|wt-tile/,
      'the collage is gone from the runtime');
    assert.match(runtimeSrc, /addAction\('Start the walkthrough', stepUrl\(STEPS\[0\]\), true\)/,
      'the landing opens on one action, and it starts the walk');
    assert.match(runtimeSrc, /addAction\('Browse the gallery', galleryUrl\(\), false\)/,
      'and the quiet exit to the archive is still offered');
    // Every cover still resolves to a real file: the step rail renders
    // them, so a bad path would break the walk rather than the landing.
    assert.equal(authored.length, 7);
    const repo = join(here, '..');
    for (const s of authored) {
      assert.ok(fs.existsSync(join(repo, s.hero)), s.slug + ' hero exists on disk');
    }
  });

  test('W29c — no collage rules survive in the stylesheet', () => {
    // Dead CSS is not free: .wt-tile was the target of the nth-child
    // pinning that kept the copy off two photographs, and leaving the
    // rules behind would make the next reader believe the grid is live.
    assert.doesNotMatch(cssSrc, /\.wt-montage|\.wt-tile/,
      'the collage has no styles left');
  });

  test('W32 — every step offers a way back', () => {
    // Step 1 goes back to the landing rather than nowhere: the deck is
    // re-enterable, and the landing is the only place the exit to the
    // archive is offered.
    for (const idx of [2, 5]) {
      const h = setup({ step: idx });
      const prev = h.byId.wtActions.children.find(a => a.classes().includes('wt-prev'));
      assert.ok(prev, 'step ' + idx + ' has a back control');
      assert.equal(prev.getAttribute('rel'), 'prev');
      assert.match(prev.href, new RegExp('/' + authored[idx - 2].slug + '/$'),
        'step ' + idx + ' points at step ' + (idx - 1));
    }
    const first = setup({ step: 1 });
    const back = first.byId.wtActions.children.find(a => a.classes().includes('wt-prev'));
    assert.ok(back, 'step 1 has a back control');
    assert.match(back.href, /\/walkthrough\/$/,
      'step 1 goes back to the landing, not nowhere');
    assert.ok(!/walkthrough\/[a-z-]+\/$/.test(back.href), 'and not to a step');
  });

  test('W33 — back sits above the primary action, and labels itself', () => {
    const h = setup({ step: 3 });
    const kids = h.byId.wtActions.children;
    const prevIdx = kids.findIndex(a => a.classes().includes('wt-prev'));
    const ctaIdx = kids.findIndex(a => a.classes().includes('wt-cta'));
    assert.ok(prevIdx !== -1 && ctaIdx !== -1);
    assert.ok(prevIdx < ctaIdx, 'back is reachable before the way forward');
    // The label is the destination's own title, so the control says where
    // it goes — the dots and the rail do not have to be decoded first.
    const label = kids[prevIdx].children.find(c => c.classes().includes('wt-prev-label'));
    assert.ok(label, 'the back control has a label span');
    assert.equal(label.textContent, authored[1].title,
      'it names the step it goes back to');
    assert.equal(kids[prevIdx].children.find(c => c.classes().includes('wt-prev-mark'))
      .getAttribute('aria-hidden'), 'true',
      'the arrow is decorative, so the label is what a screen reader reads');
  });
});

describe('W — the landing is the request journey', () => {
  // The tree and its React island are gone. What replaced them is
  // journey.js driving stages.js over the footage, and these pin the
  // three ways that could silently regress: the video not resolving, the
  // cards not being built from the data, and the connectors drawing
  // nothing while reporting no error at all.
  const landing = fs.readFileSync(join(here, 'index.html'), 'utf8');
  const journeySrc = fs.readFileSync(join(here, 'journey.js'), 'utf8');
  const stagesSrc = fs.readFileSync(join(here, 'stages.js'), 'utf8');
  const journeyCss = fs.readFileSync(join(here, 'journey.css'), 'utf8');

  const stages = (() => {
    const sandbox = {};
    vm.runInNewContext(stagesSrc + '\n;globalThis.__T = STAGES;', sandbox);
    return JSON.parse(JSON.stringify(sandbox.__T));
  })();

  test('J1 — the landing plays the video full-bleed, and nothing else does', () => {
    assert.doesNotMatch(landing, /wt-shader-root|shader-build|shader\.js|type="module"/,
      'the tree, its mount and its build output are gone from the landing');
    for (const attr of ['autoplay', 'muted', 'loop', 'playsinline']) {
      assert.match(landing, new RegExp('\\s' + attr + '(\\s|>)'),
        'the video carries ' + attr + ' — without muted and playsinline autoplay never starts');
    }
    assert.match(landing, /preload="metadata"/, 'the video preloads metadata, not the whole file');
    assert.match(landing, /class="jr-video" id="jrVideo" aria-hidden="true"/,
      'the video is decorative and hidden from assistive tech');
    assert.match(journeyCss, /\.jr-video-el\s*\{[^}]*object-fit:\s*cover/,
      'the video covers the viewport');
    assert.match(journeyCss, /\.jr-video\s*\{[^}]*will-change:\s*transform/,
      'the video plane is promoted, so parallax is a compositor translate');
  });

  test('J2 — the video sits behind everything and takes no clicks', () => {
    const order = ['jrVideo', 'jrLines', 'jrCards'].map(id => {
      const m = new RegExp('id="' + id + '"').exec(landing);
      assert.ok(m, id + ' is in the landing markup');
      return m.index;
    });
    assert.ok(order[0] < order[1] && order[1] < order[2],
      'video, then lines, then cards — the depth order is the document order');
    for (const sel of ['.jr-video', '.jr-lines', '.jr-cards']) {
      assert.match(journeyCss, new RegExp(sel.replace('.', '\\.') + '\\s*\\{[^}]*z-index:\\s*(\\d)'),
        sel + ' declares its own z-index');
    }
    assert.match(journeyCss, /\.jr-video-el\s*\{[^}]*pointer-events:\s*none/,
      'the video never swallows a click meant for a card');
  });

  test('J3 — seven stages, one per storyboard moment', () => {
    assert.equal(stages.length, 7, 'the journey is seven stages');
    assert.deepEqual(stages.map(s => s.index), [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(stages.map(s => s.title),
      ['CLIENT', 'CAT6A', 'PATCH PANEL', 'SWITCH', 'CEILING TRAY', 'DATA CENTER', 'CONNECTED']);
    for (const s of stages) {
      assert.ok(s.copy && s.copy.length > 60,
        s.title + ' has a beginner note, not a label');
      assert.ok(Number.isFinite(s.at) && s.at >= 0 && s.at <= 10.03,
        s.title + ' has a timestamp inside the video');
      assert.ok(s.cell && /^c[0-3]r[0-2]$/.test(s.cell),
        s.title + ' records the measured cell it was placed from: ' + s.cell);
      assert.ok(Number.isFinite(s.anchor.left) && Number.isFinite(s.anchor.top),
        s.title + ' has an anchor');
    }
  });

  test('J4 — no two stages share an anchor cell', () => {
    // Two cards on one cell make the connector between them double back
    // on itself, which reads as a bug rather than a flourish.
    const cells = stages.map(s => s.cell);
    assert.equal(new Set(cells).size, cells.length,
      'two stages share a cell: ' + JSON.stringify(cells));
  });

  test('J5 — the cards are built from the data, and are live regions', () => {
    assert.match(journeySrc, /var N = STAGES\.length/,
      'the runtime sizes itself from the data');
    assert.match(journeySrc, /for \(var i = 0; i < N; i\+\+\) \{\s*var step = STAGES\[i\]/,
      'each card is built from a stage, so markup cannot drift from the data');
    assert.match(journeySrc, /setAttribute\('role', 'status'\)/,
      'each card is a live region');
    assert.match(journeySrc, /setAttribute\('aria-live', 'polite'\)/,
      'announced politely on activation');
  });

  test('J6 — the connectors are drawn, and Rough returns its node', () => {
    // rough.svg(el).line() RETURNS the <g> it built; it does not append
    // it. Ignoring the return value leaves six empty groups, no lines on
    // the page, and nothing in the console — which is exactly what
    // happened the first time.
    assert.match(journeySrc, /line\.appendChild\(rc\.line\(/,
      'the node Rough returns is adopted into the connector group');
    assert.match(journeyCss, /\.jr-lines\s*\{[^}]*overflow:\s*visible/,
      'the line layer may overflow — an <svg> is a replaced element and clips at its box');
    assert.match(journeyCss, /\.jr-lines\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/s,
      'and is sized explicitly, because inset:0 alone leaves an <svg> at 300x150');
    // One connector per pair, from card N's bottom-right to N+1's top-left.
    assert.match(journeySrc, /for \(var i = 0; i < N - 1; i\+\+\)/,
      'six connectors for seven cards');
    assert.match(journeySrc, /roughness:\s*1\.5/, 'and at the specified roughness');
    assert.match(journeySrc, /bowing:\s*1\.2/, 'and bowing');
    assert.match(journeySrc, /seed:\s*42 \+ i/,
      'seeded per connector, so the sketch is identical on every load');
  });

  test('J7 — the opening state has no lines and one card', () => {
    // "Initial state: card 1 visible, no lines drawn." A connector built
    // visible at load scribbles over the footage before the walk begins.
    assert.match(journeyCss, /\.jr-lines \.jr-line\s*\{\s*opacity:\s*0/,
      'connectors are built hidden');
    // The lit card is whichever stage the footage is at, which is card 1
    // only if the video is still at t=0 (see J16).
    assert.match(journeySrc, /cards\[state\]\.classList\.add\('is-on'\)/,
      'and exactly one card is lit on load');
  });

  test('J8 — the swap overlaps, so no frame is blank', () => {
    // The outgoing card is held at full opacity while the incoming one
    // sits in the DOM at zero; both only move once that is painted. If
    // the outgoing fade starts at t=0 and runs 180ms while the incoming
    // starts at t=200ms, there is a 20ms hole in the stage.
    assert.match(journeySrc, /outgoing\.classList\.add\('is-held'\)/,
      'the outgoing card is held at full opacity');
    assert.equal(/var HOLD_MS = (\d+);/.exec(journeySrc)[1],
      /--jr-hold:\s*(\d+)ms/.exec(journeyCss)[1],
      'HOLD_MS mirrors --jr-hold — drift is invisible until one is tuned');
    assert.equal(/var IN_MS = (\d+);/.exec(journeySrc)[1],
      /--jr-in:\s*(\d+)ms/.exec(journeyCss)[1],
      'IN_MS mirrors --jr-in');
    assert.equal(/var OUT_MS = (\d+);/.exec(journeySrc)[1],
      /--jr-out:\s*(\d+)ms/.exec(journeyCss)[1],
      'OUT_MS mirrors --jr-out');
    assert.equal(/var DRAW_MS = (\d+);/.exec(journeySrc)[1],
      /--jr-draw:\s*(\d+)ms/.exec(journeyCss)[1],
      'DRAW_MS mirrors --jr-draw');
    // Both transitions are handed over in the same task, which is what
    // makes them start on the same frame. Matched as the ordered
    // sequence of three statements rather than one literal line, so
    // reformatting the block cannot silently stop this guarding.
    const handoff = journeySrc.indexOf('setTimeout(function () {',
      journeySrc.indexOf('function swap'));
    assert.ok(handoff !== -1, 'the swap hands over on a timer');
    const window = journeySrc.slice(handoff, handoff + 400);
    const order = ['remove(\'is-held\')', 'add(\'is-out\')', 'add(\'is-on\')']
      .map(s => window.indexOf(s));
    assert.ok(order.every(i => i !== -1), 'all three handover calls are present: ' + window.trim());
    assert.deepEqual(order.slice().sort((a, b) => a - b), order,
      'the outgoing card is released and the incoming one raised in one task — ' +
      'if the incoming came first the two would still overlap, but the ' +
      'frame where the outgoing one loses is-held is the one that matters');
  });

  test('J9 — cards stack with z-index, never by re-appending', () => {
    // Re-appending the incoming node puts the stages out of document
    // order for anyone stepping through with a screen reader.
    assert.doesNotMatch(journeySrc, /cardsHost\.appendChild\(incoming\)/,
      'the incoming card is not moved in the document');
    assert.match(journeySrc, /incoming\.style\.zIndex = '2'/,
      'it is stacked with z-index instead');
  });

  test('J10 — coordinates are cached and recomputed only on resize', () => {
    // Recomputing per step index is what made the lines re-settle behind
    // the visitor on every transition.
    assert.match(journeySrc, /addEventListener\('resize'/,
      'resize is the only thing that invalidates the measurements');
    assert.match(journeySrc, /drawConnector/,
      'and the connectors are drawn by one named function');
    const inSwap = /function swap\([\s\S]*?\n  \}/.exec(journeySrc)[0];
    assert.doesNotMatch(inSwap, /drawConnector|buildConnectors/,
      'a card swap never re-measures the lines');
  });

  test('J11 — three parallax planes at three depths', () => {
    const depths = /var DEPTH = \{([^}]*)\}/.exec(journeySrc)[1];
    assert.match(depths, /video:\s*8/, 'the video moves least');
    assert.match(depths, /cards:\s*16/, 'the cards are moderate');
    assert.match(depths, /lines:\s*24/, 'the lines move most');
    assert.match(journeySrc, /var SMOOTH = 0\.08/, 'and the motion eases toward the cursor');
    assert.match(journeySrc, /requestAnimationFrame\(tick\)/, 'on one frame loop');
  });

  test('J12 — reduced motion switches off parallax and the draw', () => {
    assert.match(journeyCss, /@media \(prefers-reduced-motion: reduce\)/,
      'reduced motion is honoured');
    const reduce = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(journeyCss)[1];
    assert.match(reduce, /\.jr-card[\s\S]*transition:\s*none !important/,
      'cards switch instantly');
    assert.match(reduce, /\.jr-video[\s\S]*transform:\s*none !important/,
      'and the parallax is off');
    // The video is the content, not an effect: it keeps playing.
    const guard = /if \(!reduce\) \{([\s\S]*?)\n  \}/.exec(journeySrc)[1];
    assert.match(guard, /addEventListener\('mousemove'/, 'no listener is even attached under reduce');
  });

  test('J15 — the wheel scrubs the footage, and the card follows it', () => {
    // The rule the landing is built on now: `at` is where a stage lives in
    // the video, and the lit stage is decided by video.currentTime. Before
    // this the footage free-ran on its own clock with card 1 lit whatever
    // was on screen, which is what made the measured anchors pointless.
    assert.match(journeySrc, /addEventListener\('wheel', onWheel, \{ passive: false \}\)/,
      'the wheel is captured and NOT passive — without preventDefault the page scrolls behind it');
    assert.match(journeySrc, /function stageAtTime\(t\)/,
      'a moment in the video maps to a stage');
    assert.match(journeySrc, /function scrubTo\(t, fromWheel\)/,
      'scrubbing takes the video to a moment');
    // Paused and un-looped the moment the wheel is touched, or the loop
    // fights the scrub and the direction of travel is unreadable.
    assert.match(journeySrc, /function takeControl\(\)[\s\S]*?video\.pause\(\);[\s\S]*?video\.loop = false;/,
      'the wheel takes the transport: paused, and no longer looping');
    assert.match(journeySrc, /video\.removeEventListener\('timeupdate', followFootage\)/,
      'and the footage stops driving the card');
    // deltaMode: 1 is lines, 2 is pages. Unnormalised, a notched wheel and
    // a trackpad scrub by wildly different amounts.
    assert.match(journeySrc, /e\.deltaMode === 1 \? 16 : \(e\.deltaMode === 2 \? window\.innerHeight : 1\)/,
      'deltaMode is normalised so both input kinds agree on scale');
    // Every stage boundary is honoured, and both directions work.
    assert.match(journeySrc, /dy > 0 \? 1 : -1/, 'the wheel scrubs forward and in reverse');
    // A seek asked for before the metadata lands is held, not dropped —
    // applying it to t=0 would make the visitor's first notch vanish.
    assert.match(journeySrc, /pendingSeek = t; return;/,
      'a seek before the duration is known is deferred, not lost');
    assert.match(journeySrc, /addEventListener\('loadedmetadata'/, 'and replayed once it is known');
  });

  test('J16 — the opening state is read from the footage, not assumed', () => {
    // The video starts on autoplay, so by the time the runtime runs it may
    // already be past t=0. Lighting card 1 regardless put the CLIENT card
    // over the rack.
    assert.match(journeySrc, /state = stageAtTime\(video\.currentTime \|\| 0\);/,
      'the initial stage is derived from currentTime');
    assert.match(journeySrc, /cards\[state\]\.classList\.add\('is-on'\)/,
      'and the lit card is that one, not card 1');
    assert.match(journeySrc, /video\.addEventListener\('timeupdate', followFootage\);/,
      'and the card keeps following while the footage free-runs');
    // A second lap must not start with six stale connectors drawn.
    assert.match(journeySrc, /if \(t < lastSeen - 0\.5\) resetLines\(\);/,
      'a loop wrapping backwards clears the path taken');
    assert.match(journeySrc, /function resetLines\(\)/, 'and resetLines exists');
    // Only a walk draws a connector: a card changing because the video
    // played past it is not something the visitor did.
    assert.match(journeySrc, /function followFootage\(\)[\s\S]*?stepTo\(want, \{ draw: false \}\)/,
      'free-running playback draws no line');
    assert.match(journeySrc, /if \(draw\) playDraw\(/,
      'only an input draws one');
  });

  test('J17 — the page itself cannot scroll under the journey', () => {
    // The wheel is the transport now, so the document has nowhere to go.
    assert.match(journeyCss, /body\.jr\s*\{[^}]*overflow:\s*hidden/, 'the page does not scroll');
    assert.match(journeyCss, /overscroll-behavior:\s*none/,
      'and no scroll chaining out of it');
  });

  test('J13 — the journey is reachable by keyboard, and reset does not advance', () => {
    assert.match(journeySrc, /e\.key === 'ArrowRight'/, 'forward');
    assert.match(journeySrc, /e\.key === 'ArrowLeft'/, 'back');
    assert.match(journeySrc, /e\.key === 'Home'/, 'and a way to the first stage');
    assert.match(journeySrc, /t\.closest\('a'\)/,
      'a click on a link means leave, not next stage');
    assert.match(journeySrc, /t\.closest\('\.jr-controls'\)/,
      'and neither does one on the controls');
  });

  test('J14 — the landing still offers both ways on', () => {
    // The gate sends first-time visitors here, so a landing with no way
    // into the deck and no exit is a trap.
    assert.match(landing, /id="wtActions"/,
      'the landing keeps the actions host');
    assert.match(landing, /data-journey/,
      'and declares that it is the journey landing');
    assert.match(runtimeSrc, /initJourneyLanding/,
      'the runtime has a landing path for it');
  });
});

describe('W — the snap: tapping a photo is instant', () => {
  // The shipped bug, and the reason this suite exists: photos 2-4 were
  // loading="lazy", so a tap fired a network fetch and then faded in an
  // image the browser had not decoded. The fade ran on a blank frame and
  // the photograph arrived late — which reads as sluggish however short
  // the transition is. Shortening the CSS alone would not have fixed it.
  const mediaLayers = (h) => h.byId.wtMedia.children.filter(el => el.tagName === 'IMG');

  test('W34 — no photo in a step is lazily loaded', () => {
    const step = authored.find(s => (s.gallery || []).length > 0);
    assert.ok(step, 'a step with a gallery exists to test');
    const h = setup({ step: step.index });
    const layers = mediaLayers(h);
    assert.equal(layers.length, 1 + step.gallery.length, 'every photo is in the DOM');
    for (const img of layers) {
      assert.equal(img.loading, 'eager',
        'lazy loading means a blank frame on tap: ' + img.src);
    }
  });

  test('W35 — every photo is decoded up front, not hinted', () => {
    // decoding="async" is only a hint; the explicit decode() is what
    // actually resolves, and the tap depends on it having resolved.
    const step = authored.find(s => (s.gallery || []).length > 0);
    const h = setup({ step: step.index });
    for (const img of mediaLayers(h)) {
      assert.equal(img.decodeCalls, 1, 'decode() is called on ' + img.src);
      assert.equal(img.decoding, 'async', 'the hint is still set alongside it');
    }
  });

  test('W36 — the hero is the priority image', () => {
    const h = setup({ step: 2 });
    const [hero, ...rest] = mediaLayers(h);
    assert.equal(hero.fetchPriority, 'high', 'the first photo is the LCP element');
    for (const img of rest) {
      assert.notEqual(img.fetchPriority, 'high',
        'and the photos after it do not compete with it');
    }
  });

  test('W37 — the crossfade is a snap, not a dissolve', () => {
    // 160ms is under where a crossfade reads as a transition at all.
    const block = /\.wt-media img\s*\{([\s\S]*?)\n\}/.exec(cssSrc);
    assert.ok(block, 'the slide images declare a transition');
    assert.match(block[1], /transition:\s*opacity var\(--wt-snap\)/,
      'incoming rides --wt-snap: ' + block[1].trim());
    const snap = /--wt-snap:\s*(\d+)ms/.exec(cssSrc);
    const out = /--wt-snap-out:\s*(\d+)ms/.exec(cssSrc);
    assert.ok(snap && out, 'both snap tokens exist');
    assert.ok(Number(snap[1]) <= 200, '--wt-snap is a snap, got ' + snap[1] + 'ms');
    assert.ok(Number(out[1]) < Number(snap[1]),
      'the outgoing layer clears before the incoming settles, so they never both sit at half opacity');
  });

  test('W38 — a tap is accepted the instant the previous one settles', () => {
    // The lockout is a real guard, not a bug: it stops two crossfades
    // overlapping and leaving a frame at half opacity. The contract is
    // that it lasts exactly as long as the animation — a second tap
    // inside it is dropped, a tap the moment after is not. A lockout
    // left at the old 500ms would have dropped taps for a third of a
    // second after the photo had visibly settled, which is precisely
    // the "why isn't this responding" feeling.
    const step = authored.find(s => (s.gallery || []).length >= 2);
    const h = setup({ step: step.index });
    const media = h.byId.wtMedia;
    const hint = () => media.children.find(c => c.classList.contains('wt-media-hint')).textContent;

    assert.equal(hint(), '1 / ' + (1 + step.gallery.length));
    media.fire('click');
    assert.equal(hint(), '2 / ' + (1 + step.gallery.length), 'the first tap advances');

    // Inside the crossfade: dropped on purpose.
    media.fire('click');
    assert.equal(hint(), '2 / ' + (1 + step.gallery.length),
      'a tap during the crossfade is ignored, so the fade cannot overlap itself');

    // The moment it settles: accepted.
    h.advance(160);
    media.fire('click');
    assert.equal(hint(), '3 / ' + (1 + step.gallery.length),
      'the tap right after the settle is honoured');
  });

  test('W39 — the JS lockout and the CSS snap agree', () => {
    // One number in two places, so it is pinned: SNAP_MS mirrors
    // --wt-snap. Drift here is invisible until someone tunes one.
    const js = /var SNAP_MS = (\d+);/.exec(runtimeSrc);
    assert.ok(js, 'walkthrough.js declares SNAP_MS');
    const css = /--wt-snap:\s*(\d+)ms/.exec(cssSrc);
    assert.ok(css, 'walkthrough.css declares --wt-snap');
    assert.equal(Number(js[1]), Number(css[1]),
      'SNAP_MS (' + js[1] + ') must mirror --wt-snap (' + css[1] + ')');
  });
});

describe('W — the CSS contract', () => {
  const block = cssSrc.slice(cssSrc.indexOf('Slide transitions'));
  // Comments are prose — they say "no blur, glow, gradient"; only the
  // declarations themselves are audited.
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, '');

  test('W14 — wt-t-arrive consumes the custom properties (the shipped bug)', () => {
    // The start state only exists if the arrive carrier actually reads
    // the --wt-t-* values. Leaving it out is what killed the arrivals.
    const shared = /\.wt-page\.wt-t-arrive,\s*\.wt-page\.wt-t-go,\s*\.wt-page\.wt-t-leave\s*\{([^}]*)\}/.exec(cssSrc);
    assert.ok(shared, 'a shared carrier rule consumes the variables');
    for (const prop of ['var(--wt-t-x)', 'var(--wt-t-s)', 'var(--wt-t-c)', 'var(--wt-t-o)']) {
      assert.ok(shared[1].includes(prop), 'the carrier rule must apply ' + prop);
    }
  });

  test('W15 — the settled slide is the CSS default', () => {
    const pageRule = /\.wt-page\s*\{([^}]*)\}/.exec(cssSrc)[1];
    for (const v of ['--wt-t-x: 0px', '--wt-t-y: 0px', '--wt-t-s: 1', '--wt-t-c: inset(0)', '--wt-t-o: 1']) {
      assert.ok(pageRule.includes(v), '.wt-page must default ' + v);
    }
  });

  test('W16 — every vocabulary kind has both an arrival and a departure state', () => {
    const runtime = fs.readFileSync(join(here, 'walkthrough.js'), 'utf8');
    const kinds = [.../\[[\s\S]*?\];/.exec(runtime.match(/var TRANSITIONS = \[[\s\S]*?\];/)[0])[0].matchAll(/'([a-z-]+)'/g)].map(m => m[1]);
    assert.ok(kinds.length >= 8, 'expected the full vocabulary, got ' + kinds.length);
    for (const k of kinds) {
      assert.ok(cssSrc.includes('.wt-t-' + k + '-in'), k + ' has no arrival state');
      assert.ok(cssSrc.includes('.wt-t-' + k + '-out'), k + ' has no departure state');
    }
  });

  test('W17 — arrivals and departures are continuous (inverses of each other)', () => {
    // The declarations are written as `.wt-t-wipe-down-in  { … }` with
    // padding before the brace, so match on the selector alone.
    const state = (kind, phase) => {
      const m = new RegExp('\\.wt-t-' + kind + '-' + phase + '\\s*\\{([^}]*)\\}').exec(cssSrc);
      return m ? m[1] : '';
    };
    const dir = (body) => {
      // The direction a slide TRAVELS, not the edge that happens to be
      // clipped first. Clipping the top edge hides the slide's top
      // progressively, so it travels up; the bottom, down.
      const c = /--wt-t-c:\s*inset\(([^)]*)\)/.exec(body);
      if (c) {
        const [top, right, bottom, left] = c[1].trim().split(/\s+/).map(parseFloat);
        if (top > 0 && !bottom && !left && !right) return 'up';
        if (bottom > 0 && !top && !left && !right) return 'down';
        if (left > 0 && !top && !bottom && !right) return 'left';
        if (right > 0 && !top && !bottom && !left) return 'right';
        return 'mixed';
      }
      // A positive offset means the slide STARTS to the right (or
      // below) and therefore travels left (or up) as it settles.
      const x = /--wt-t-x:\s*(-?\d+)%/.exec(body);
      if (x) return parseInt(x[1], 10) > 0 ? 'left' : 'right';
      const y = /--wt-t-y:\s*(-?\d+)%/.exec(body);
      if (y) return parseInt(y[1], 10) > 0 ? 'up' : 'down';
      return 'none';
    };
    // A wipe is ONE clip edge on both halves, so the slide travels
    // the same way in and out (that is what makes it read as a wipe).
    for (const k of ['wipe-up', 'wipe-down']) {
      assert.equal(dir(state(k, 'in')), dir(state(k, 'out')),
        k + ' must clip the same edge on both halves');
    }
    // A push is a two-sided gesture: the old slide leaves one way while
    // the new one arrives from the opposite, exactly as a deck does it.
    // What must hold is that the halves are OPPOSITE, never parallel.
    for (const k of ['push-left', 'push-right', 'push-up']) {
      const a = dir(state(k, 'in'));
      const b = dir(state(k, 'out'));
      assert.notEqual(a, 'none', k + ' arrival must actually move');
      assert.notEqual(b, 'none', k + ' departure must actually move');
      const opposite = (p, q) => (p === 'left' && q === 'right') || (p === 'right' && q === 'left') ||
                                 (p === 'up' && q === 'down') || (p === 'down' && q === 'up');
      assert.ok(opposite(a, b),
        k + ' arrives and departs on opposite sides (' + a + ' vs ' + b + ')');
    }
  });

  test('W18 — no hardcoded durations; only the three tokens', () => {
    const ms = [...block.matchAll(/(\d+)ms/g)].map(m => m[1]);
    const allowed = new Set(['100', '300', '500']); // --wt-short/base/long
    for (const v of ms) assert.ok(allowed.has(v), 'hardcoded duration ' + v + 'ms in the transition block');
  });

  test('W19 — the slide transition moves only transform, opacity and clip-path', () => {
    // The deck has deliberate elevation and a lit backdrop (that is the
    // PowerPoint-inspired part); what must not happen is the SLIDE
    // smearing its own shadow while it travels. So the audit is scoped
    // to the carrier rules only, not the whole stylesheet.
    const carriers = /\.wt-page\.wt-t-arrive,\s*[\s\S]*?\n\}/.exec(rules);
    assert.ok(carriers, 'the shared carrier rule exists');
    for (const prop of ['transform', 'clip-path', 'opacity']) {
      assert.ok(carriers[0].includes(prop), 'the carrier applies ' + prop);
    }
    // Reduced motion's own `animation: none` for the ambient drift is
    // outside this rule; the slide itself must ride `transition`.
    assert.ok(!/\banimation:(?! none)/.test(rules),
      'transitions ride the transition property, not keyframes');
  });

  test('W21 — elevation is layered and directional, never a heavy drop shadow', () => {
    // Fluent's system: a sharp key shadow that defines the edge plus a
    // soft ambient shadow that implies distance, light from above.
    // The SLIDE must be layered (it is the deck's hero surface); the
    // smaller controls take a single key shadow, which is correct.
    const lifts = [...cssSrc.matchAll(/--wt-lift-([a-z]+):\s*([^;]+);/g)];
    assert.ok(lifts.length >= 2, 'at least a slide and a control elevation');
    const byName = Object.fromEntries(lifts.map(m => [m[1], m[2]]));
    const slide = byName.slide;
    assert.ok(slide, 'the slide has its own elevation token');
    assert.equal((slide.match(/rgba\(/g) || []).length, 2,
      'the slide layers a key and an ambient shadow: ' + slide);
    for (const l of lifts.map(m => m[2])) {
      // Each layer is "offsetX offsetY blur rgba(...)" — parse it as a
      // function, not by splitting on commas (the offset contains one).
      const layers = l.match(/[^,]+rgba\([^)]*\)/g) || [];
      assert.ok(layers.length >= 1, 'a shadow token declares at least one layer: ' + l);
      for (const layer of layers) {
        const m = /^(\S+)\s+(\S+)\s+(?:(\S+)\s+)?rgba\(/.exec(layer.trim());
        assert.ok(m, 'a shadow layer parses: ' + layer);
        assert.equal(m[1], '0', 'the light source is directly above: ' + layer);
        assert.ok(parseFloat(m[2]) >= 0, 'no upward offset: ' + layer);
      }
    }
  });

  test('W20 — one easing, and reduced motion switches the lot off', () => {
    const easings = [...block.matchAll(/cubic-bezier\([^)]*\)/g)].map(m => m[0]);
    assert.deepEqual(easings, [], 'the block must inherit --wt-ease, not name a curve');
    assert.ok(/--wt-ease/.test(block), 'durations ride the one easing');
    const reduce = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\}/.exec(block)[1];
    assert.ok(/\.wt-page/.test(reduce), 'reduced motion must switch the slide off');
    assert.ok(/transition: none !important/.test(reduce));
  });
});