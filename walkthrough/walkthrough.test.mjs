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
import { dirname, join } from 'node:path';

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
    dataset: {},
    _textContent: '',
    hidden: false,
    src: '', alt: '', decoding: '', loading: '',
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
    addEventListener() {},
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

function setup({ depth = 2, step = 3, reduce = false, recorded = null } = {}) {
  const store = new Map();
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
    requestAnimationFrame: window.requestAnimationFrame,
    setTimeout: (fn, ms) => { const t = { fn, ms: ms || 0, at: fakeNow + (ms || 0), cancelled: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cancelled = true; },
    Date: { now: () => fakeNow },
  };
  sandbox.globalThis = sandbox;

  vm.runInContext(stepsSrc + '\n' + runtimeSrc, vm.createContext(sandbox), { filename: 'walkthrough.js' });

  return {
    page, store, navigations,
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

  test('W19 — only transform, opacity and clip-path move', () => {
    const body = rules.slice(0, rules.indexOf('Reduced motion'));
    for (const forbidden of ['box-shadow:', 'linear-gradient', 'radial-gradient', 'backdrop-filter', 'filter:']) {
      assert.ok(!body.includes(forbidden), forbidden + ' must not appear in the transition rules');
    }
    // Reduced motion's own `animation: none` for the ambient drift is
    // below this slice; the slide itself must ride `transition`.
    assert.ok(!/\banimation:(?! none)/.test(body),
      'transitions ride the transition property, not keyframes');
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