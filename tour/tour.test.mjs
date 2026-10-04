/* tour/tour.test.mjs — the guided tour's mandatory test suite.

   Same harness as tests/downloadButton.test.mjs: the real
   source files (oneui.js, tour/tour.js, tour/steps.js) run
   inside a node:vm sandbox with a just-rich-enough DOM stub,
   a virtual clock (fake Date.now + timer queue advanced by
   advance(ms)), and an in-memory localStorage.

   Run with: node --test tour/   (Node 18+)

   Covers the spec checklist: gating, detection, confirm +
   unlock, escape, persistence, motion + a11y, and the speed
   multiplier. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const oneuiSrc = fs.readFileSync(join(here, '..', 'oneui.js'), 'utf8');
const tourSrc = fs.readFileSync(join(here, 'tour.js'), 'utf8');
const stepsSrc = fs.readFileSync(join(here, 'steps.js'), 'utf8');

/* ── Selector matching (the tiny subset the engine uses:
      #id, .class, tag, [attr], [attr="v"], descendants) ── */

function parseCompound(part) {
  const out = { tag: null, id: null, classes: [], attrs: [] };
  const re = /#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|([\w-]+)/g;
  let m;
  while ((m = re.exec(part))) {
    if (m[1]) out.id = m[1];
    else if (m[2]) out.classes.push(m[2]);
    else if (m[3]) out.attrs.push({ name: m[3], value: m[4] });
    else if (m[5]) out.tag = m[5].toUpperCase();
  }
  return out;
}

function matchesCompound(el, part) {
  const c = typeof part === 'string' ? parseCompound(part) : part;
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  for (const cls of c.classes) if (!el.classSet.has(cls)) return false;
  for (const a of c.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    if (a.value !== undefined && el.getAttribute(a.name) !== a.value) return false;
  }
  return true;
}

function matchesSelector(el, parts) {
  if (!matchesCompound(el, parts[parts.length - 1])) return false;
  let idx = parts.length - 2;
  let anc = el.parentNode;
  while (anc && anc.nodeType === 1 && idx >= 0) {
    if (matchesCompound(anc, parts[idx])) idx--;
    anc = anc.parentNode;
  }
  return idx < 0;
}

function* walk(el) {
  for (const c of el.children) {
    yield c;
    yield* walk(c);
  }
}

function queryTree(root, sel) {
  const parts = sel.trim().split(/\s+/);
  for (const el of walk(root)) if (matchesSelector(el, parts)) return el;
  return null;
}

function queryTreeAll(root, sel) {
  const parts = sel.trim().split(/\s+/);
  const out = [];
  for (const el of walk(root)) if (matchesSelector(el, parts)) out.push(el);
  return out;
}

/* An element's full text: its own plus every descendant's
   (the stub stores text per-element, like the real DOM). */
function textTree(el) {
  let out = el._textContent || '';
  for (const c of walk(el)) out += c._textContent || '';
  return out;
}

/* ── Element stub ─────────────────────────────────────────── */

function makeEl(tag, opts = {}) {
  const el = {
    nodeType: 1,
    tagName: (tag || 'div').toUpperCase(),
    children: [],
    parentNode: null,
    attrs: {},
    listeners: {},
    styleSets: [],
    classSet: new Set(),
    _textContent: '',
    _innerHTML: '',
    hidden: false,
    id: '',
    value: opts.value || '',
    rect: opts.rect || { top: 100, left: 100, right: 142, bottom: 142, width: 42, height: 42 },
    offsetWidth: opts.offsetWidth != null ? opts.offsetWidth : 260,
    offsetHeight: opts.offsetHeight != null ? opts.offsetHeight : 120,
  };
  let _className = '';
  Object.defineProperty(el, 'className', {
    get: () => _className,
    set: (v) => { _className = v; el.classSet = new Set(String(v).split(/\s+/).filter(Boolean)); },
  });
  Object.defineProperty(el, 'textContent', {
    get: () => el._textContent,
    set: (v) => { el._textContent = String(v); },
  });
  Object.defineProperty(el, 'innerHTML', {
    get: () => el._innerHTML,
    set: (v) => { el._innerHTML = String(v); if (v === '') el.children = []; },
  });
  // Style is a Proxy: every property set is logged so tests can
  // assert that no duration is ever hardcoded (all derive from D).
  el.style = new Proxy({}, {
    set: (t, prop, value) => { t[prop] = value; el.styleSets.push(prop + '=' + value); return true; },
    get: (t, prop) => t[prop],
  });
  el.classList = {
    add: (...cs) => cs.forEach(c => el.classSet.add(c)),
    remove: (...cs) => cs.forEach(c => el.classSet.delete(c)),
    contains: c => el.classSet.has(c),
    toggle: (c, on) => { const want = on ?? !el.classSet.has(c); if (want) el.classSet.add(c); else el.classSet.delete(c); return want; },
  };
  el.setAttribute = (k, v) => {
    el.attrs[k] = String(v);
    if (k === 'id') el.id = String(v);
    if (k === 'class') el.className = String(v);
  };
  el.getAttribute = (k) => {
    if (k === 'id' && el.id) return el.id;
    return k in el.attrs ? el.attrs[k] : null;
  };
  el.hasAttribute = (k) => (k === 'id' ? !!el.id : k in el.attrs);
  el.removeAttribute = (k) => { delete el.attrs[k]; if (k === 'id') el.id = ''; };
  el.addEventListener = (type, fn) => { (el.listeners[type] = el.listeners[type] || []).push(fn); };
  el.removeEventListener = (type, fn) => {
    el.listeners[type] = (el.listeners[type] || []).filter(f => f !== fn);
  };
  el.dispatch = (type, event = {}) => {
    const ev = { preventDefault: () => { ev.defaultPrevented = true; }, stopPropagation: () => {}, isTrusted: true, ...event };
    (el.listeners[type] || []).slice().forEach(fn => fn(ev));
    return ev;
  };
  el.getBoundingClientRect = () => el.rect;
  el.appendChild = (c) => { c.parentNode = el; el.children.push(c); return c; };
  el.removeChild = (c) => {
    const i = el.children.indexOf(c);
    if (i !== -1) el.children.splice(i, 1);
    c.parentNode = null;
    return c;
  };
  el.contains = (node) => {
    if (node === el) return true;
    for (const c of el.children) if (c.contains && c.contains(node)) return true;
    return false;
  };
  el.querySelector = (sel) => queryTree(el, sel);
  el.querySelectorAll = (sel) => queryTreeAll(el, sel);
  return el;
}

/* ── Sandbox harness ──────────────────────────────────────── */

function setup({ reducedMotion = false, multiplierPatch = null, seedState = null } = {}) {
  const RealDate = Date;
  let fakeNow = 1000; // starts above ACTION_DEBOUNCE_MS so the first success is never debounced
  const timers = [];
  const warns = [];
  const navigations = [];
  const pushStates = [];
  const winListeners = {};
  const ioInstances = [];
  const roInstances = [];
  const moInstances = [];
  const store = new Map();
  const created = []; // every element the sandbox ever builds —
                      // styleSets survive teardown for audits
  const reg = (e) => { created.push(e); return e; };

  // The gallery the tour runs on: the real controls, with the
  // data-tour-target attributes index.html/app.js add.
  const body = reg(makeEl('body'));
  const tabPictures = reg(makeEl('button', { rect: { top: 700, left: 100, right: 180, bottom: 742, width: 80, height: 42 } }));
  tabPictures.id = 'tabPictures';
  const tabAlbums = reg(makeEl('button', { rect: { top: 700, left: 190, right: 270, bottom: 742, width: 80, height: 42 } }));
  tabAlbums.id = 'tabAlbums';
  tabAlbums.setAttribute('data-tour-target', 'tab-albums');
  const albumsView = reg(makeEl('section'));
  albumsView.id = 'albumsView';
  const albumCover = reg(makeEl('figure', { rect: { top: 200, left: 200, right: 400, bottom: 400, width: 200, height: 200 } }));
  albumCover.setAttribute('data-tour-target', 'album-cover');
  albumCover.__radius = '16px';
  albumsView.appendChild(albumCover);
  const albumDetailView = reg(makeEl('section'));
  albumDetailView.id = 'albumDetailView';
  const photoCard = reg(makeEl('figure', { rect: { top: 300, left: 300, right: 400, bottom: 400, width: 100, height: 100 } }));
  photoCard.setAttribute('data-tour-target', 'photo-card');
  albumDetailView.appendChild(photoCard);
  const lightbox = reg(makeEl('div'));
  lightbox.id = 'lightbox';
  const viewerNext = reg(makeEl('button', { rect: { top: 400, left: 1000, right: 1044, bottom: 444, width: 44, height: 44 } }));
  viewerNext.id = 'lightboxNext';
  viewerNext.setAttribute('data-tour-target', 'viewer-next');
  const viewerClose = reg(makeEl('button', { rect: { top: 20, left: 20, right: 62, bottom: 62, width: 42, height: 42 } }));
  viewerClose.id = 'lightboxClose';
  viewerClose.setAttribute('data-tour-target', 'viewer-close');
  lightbox.appendChild(viewerNext);
  lightbox.appendChild(viewerClose);
  body.appendChild(tabPictures);
  body.appendChild(tabAlbums);
  body.appendChild(albumsView);
  body.appendChild(albumDetailView);
  body.appendChild(lightbox);

  class FakeDate {
    static now() { return fakeNow; }
    constructor() { const t = fakeNow; return { toISOString: () => new RealDate(t).toISOString() }; }
  }

  class IntersectionObserver {
    constructor(cb, opts) { this.cb = cb; this.opts = opts; this.targets = []; this.disconnected = false; ioInstances.push(this); }
    observe(t) { this.targets.push(t); }
    unobserve() {}
    disconnect() { this.disconnected = true; }
    trigger(entries) { this.cb(entries, this); }
  }
  class ResizeObserver {
    constructor(cb) { this.cb = cb; this.targets = []; this.disconnected = false; roInstances.push(this); }
    observe(t) { this.targets.push(t); }
    unobserve() {}
    disconnect() { this.disconnected = true; }
    trigger() { this.cb([], this); }
  }
  class MutationObserver {
    constructor(cb) { this.cb = cb; this.disconnected = false; moInstances.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
    trigger() { if (!this.disconnected) this.cb([], this); }
  }

  const document = {
    body,
    readyState: 'complete',
    createElement: (t) => reg(makeEl(t)),
    createElementNS: (ns, t) => reg(makeEl(t)),
    querySelector: (sel) => queryTree(body, sel),
    querySelectorAll: (sel) => queryTreeAll(body, sel),
    addEventListener: () => {},
  };

  const window = {
    innerWidth: 1280,
    innerHeight: 800,
    matchMedia: () => ({ matches: reducedMotion, addEventListener() {} }),
    addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); },
    removeEventListener: (t, fn) => {
      winListeners[t] = (winListeners[t] || []).filter(f => f !== fn);
    },
    dispatchEvent: (t, ev = {}) => {
      const e = { preventDefault: () => { e.defaultPrevented = true; }, stopPropagation: () => {}, isTrusted: true, ...ev };
      (winListeners[t] || []).slice().forEach(fn => fn(e));
      return e;
    },
    history: { pushState: (s) => pushStates.push(s) },
    location: { pathname: '/', search: '?tour=1', assign: (url) => navigations.push(url) },
  };

  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };

  const getComputedStyle = (el) => ({
    getPropertyValue: (prop) => (prop === 'border-radius' ? (el.__radius || '4px') : ''),
  });

  const sandbox = {
    console: { warn: (msg) => warns.push(String(msg)), log: () => {}, error: () => {} },
    document,
    window,
    localStorage,
    getComputedStyle,
    IntersectionObserver,
    ResizeObserver,
    MutationObserver,
    setTimeout: (fn, ms) => { const t = { fn, ms: ms || 0, at: fakeNow + (ms || 0), cancelled: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cancelled = true; },
    Date: FakeDate,
  };
  sandbox.globalThis = sandbox;

  if (seedState) store.set('walkthrough.tourState', JSON.stringify(seedState));

  const src = (multiplierPatch
    ? oneuiSrc.replace('SPEED_MULTIPLIER = 1.25', `SPEED_MULTIPLIER = ${multiplierPatch}`)
    : oneuiSrc) + '\n' + tourSrc + '\n' + stepsSrc
    + '\n;globalThis.__T = { createGuidedTour, TOUR_STEPS, parseTourState, shouldAutoStartTour, TOUR_STORAGE_KEY, TOUR_TRANSITIONS, D, SPEED_MULTIPLIER, ONE_UI_EASING, TOAST_HOLD, CHECKMARK_HOLD };';
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tour.js' });

  return {
    X: sandbox.__T,
    body,
    warns,
    navigations,
    pushStates,
    store,
    window,
    document,
    tabAlbums,
    albumCover,
    photoCard,
    viewerNext,
    viewerClose,
    // Drain the timer queue: run everything due now, including
    // zero-delay chains scheduled by timers that just ran
    // (matches how a browser drains the macrotask queue).
    advance: (ms) => {
      fakeNow += ms;
      let ran = 0;
      for (;;) {
        const due = timers.filter(t => !t.cancelled && t.at <= fakeNow).sort((a, b) => a.at - b.at);
        if (!due.length) break;
        due.forEach(t => { timers.splice(timers.indexOf(t), 1); t.fn(); });
        ran += due.length;
        if (ran > 100000) throw new Error('timer drain loop');
      }
      return ran;
    },
    pending: () => timers.filter(t => !t.cancelled),
    allText: () => [...walk(body)].map(e => e._textContent).join('|'),
    allStyleSets: () => created.flatMap(e => e.styleSets),
  };
}

/* Synthetic step sets — the engine is driven with small
   deterministic scenarios; the real TOUR_STEPS get one
   integration run at the end. */

const clickStep = (id, order, targetAttr, confirm = { kind: 'pulse' }) => ({
  id, order, title: 'Step ' + id, prompt: 'Do the ' + id + ' thing.',
  target: { kind: 'selector', selector: `[data-tour-target="${targetAttr}"]`, label: id },
  action: { kind: 'click' }, confirm,
});

const tourOf = (...steps) => steps;

/* Drive one click step to completion and return the tour. */
function completeClickStep(h, tour, targetEl) {
  tour.start();
  h.advance(h.X.D.base);                 // prompting → waiting
  targetEl.dispatch('click');            // the action
  h.advance(h.X.D.base + h.X.D.short); // pulse confirm
  h.advance(h.X.D.base);               // unlock fade
  return tour;
}

/* ── Gating ─────────────────────────────────────────────────── */

describe('G — gating: the action is the only way forward', () => {
  test('G1 — step 2 is NOT in the DOM while step 1 is in waiting', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start();
    h.advance(h.X.D.base); // settle → waiting
    assert.equal(tour.getPhase(), 'waiting');
    // Only one prompt card exists, and it carries step 1's text only.
    const cards = h.document.querySelectorAll('.tour-card');
    assert.equal(cards.length, 1);
    assert.ok(h.allText().includes('Step s1'));
    assert.ok(!h.allText().includes('Step s2'));
    assert.ok(!h.allText().includes('Do the s2 thing'));
  });

  test('G2 — Continue / Next buttons do not exist during a tour', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'tab-albums')) });
    tour.start();
    h.advance(h.X.D.base);
    for (const el of walk(h.body)) {
      assert.ok(!el.classSet.has('tour-continue') && !el.classSet.has('tour-next'),
        'no continue/next class may exist');
      if (el.tagName === 'BUTTON') {
        assert.ok(!/^(continue|next)$/i.test(el._textContent.trim()),
          'no Continue/Next button may exist');
      }
    }
  });

  test('G3 — clicking elsewhere does not advance', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start();
    h.advance(h.X.D.base);
    h.tabAlbums.parentNode; // sanity: target present
    // A click on a different real control (the Pictures tab) is not the action.
    h.body.children[0].dispatch('click');
    assert.equal(tour.getPhase(), 'waiting');
    assert.equal(tour.getCurrentStepId(), 's1');
  });

  test('G4 — pressing Enter outside the target does not advance', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'tab-albums')) });
    tour.start();
    h.advance(h.X.D.base);
    // Enter on a non-target element…
    h.body.children[0].dispatch('keydown', { key: 'Enter' });
    // …and Enter with no element at all (window-level).
    h.window.dispatchEvent('keydown', { key: 'Enter' });
    assert.equal(tour.getPhase(), 'waiting');
  });

  test('G5 — editing the URL does not advance', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'tab-albums')) });
    tour.start();
    h.advance(h.X.D.base);
    h.window.location.search = '?tour=1&step=2'; // URL tampering
    h.window.location.pathname = '/tour/step-2';
    assert.equal(tour.getPhase(), 'waiting');
    assert.equal(tour.getCurrentStepId(), 's1');
  });

  test('G6 — browser back exits the tour entirely', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'tab-albums')) });
    tour.start();
    h.advance(h.X.D.base);
    h.window.dispatchEvent('popstate');
    assert.equal(tour.getPhase(), 'complete');
    const saved = h.X.parseTourState(h.store.get('walkthrough.tourState'));
    assert.equal(saved.finished, true);
    assert.ok(saved.escapedAt, 'escape is recorded');
    // The overlay is gone from the DOM.
    assert.equal(h.document.querySelectorAll('.tour-root').length, 0);
  });
});

/* ── Detection ──────────────────────────────────────────────── */

describe('D — action detection', () => {
  test('D1 — the correct click advances to the next step', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start();
    h.advance(h.X.D.base);
    assert.equal(tour.getPhase(), 'waiting');
    h.tabAlbums.dispatch('click');
    assert.equal(tour.getPhase(), 'confirming');
    h.advance(h.X.D.base + h.X.D.short); // pulse
    h.advance(h.X.D.base); // unlock
    assert.equal(tour.getPhase(), 'prompting');
    assert.equal(tour.getCurrentStepId(), 's2');
    assert.equal(h.document.querySelectorAll('.tour-card .tour-card-title')[0]._textContent, 'Step s2');
  });

  test('D2 — a wrong click does not advance', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'album-cover')) });
    tour.start();
    h.advance(h.X.D.base);
    h.tabAlbums.dispatch('click'); // not the highlighted target
    assert.equal(tour.getPhase(), 'waiting');
  });

  test('D3 — hover fires only after durationMs of continuous hover', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf({
      id: 'h1', order: 1, title: 'Hover step', prompt: 'Hover it.',
      target: { kind: 'selector', selector: '[data-tour-target="album-cover"]', label: 'cover' },
      action: { kind: 'hover', durationMs: 500 }, confirm: { kind: 'silent' },
    }) });
    tour.start();
    h.advance(h.X.D.base);
    h.albumCover.dispatch('pointerenter');
    h.advance(499);
    assert.equal(tour.getPhase(), 'waiting'); // not yet
    h.advance(1);
    // The silent confirm settles instantly (nothing plays), so
    // the machine has already advanced through confirming.
    assert.equal(tour.getPhase(), 'unlocking'); // exactly at 500ms
  });

  test('D4 — leaving the target resets the hover timer', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf({
      id: 'h1', order: 1, title: 'Hover step', prompt: 'Hover it.',
      target: { kind: 'selector', selector: '[data-tour-target="album-cover"]', label: 'cover' },
      action: { kind: 'hover', durationMs: 500 }, confirm: { kind: 'silent' },
    }) });
    tour.start();
    h.advance(h.X.D.base);
    h.albumCover.dispatch('pointerenter');
    h.advance(250);
    h.albumCover.dispatch('pointerleave');
    h.advance(1000); // far past durationMs, but the hover was interrupted
    assert.equal(tour.getPhase(), 'waiting');
  });

  test('D5 — input fires only when the value matches', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf({
      id: 'i1', order: 1, title: 'Type step', prompt: 'Type it.',
      target: { kind: 'selector', selector: '[data-tour-target="album-cover"]', label: 'cover' },
      action: { kind: 'input', valueMatches: 'archive' }, confirm: { kind: 'silent' },
    }) });
    tour.start();
    h.advance(h.X.D.base);
    h.albumCover.value = 'nope';
    h.albumCover.dispatch('input');
    assert.equal(tour.getPhase(), 'waiting');
    h.albumCover.value = 'archive';
    h.albumCover.dispatch('input');
    // Silent confirm: the machine advances past confirming
    // within the same drain.
    assert.equal(tour.getPhase(), 'unlocking');
  });

  test('D6 — synthetic events (isTrusted === false) are ignored for click', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'tab-albums')) });
    tour.start();
    h.advance(h.X.D.base);
    h.tabAlbums.dispatch('click', { isTrusted: false });
    assert.equal(tour.getPhase(), 'waiting');
  });

  test('D7 — synthetic events are ignored for hover and input', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf({
      id: 'x1', order: 1, title: 'Synthetic', prompt: 'Try.',
      target: { kind: 'selector', selector: '[data-tour-target="album-cover"]', label: 'cover' },
      action: { kind: 'hover', durationMs: 300 }, confirm: { kind: 'silent' },
    }, {
      id: 'x2', order: 2, title: 'Synthetic2', prompt: 'Try.',
      target: { kind: 'selector', selector: '[data-tour-target="album-cover"]', label: 'cover' },
      action: { kind: 'input' }, confirm: { kind: 'silent' },
    }) });
    tour.start();
    h.advance(h.X.D.base);
    h.albumCover.dispatch('pointerenter', { isTrusted: false });
    h.advance(1000);
    assert.equal(tour.getPhase(), 'waiting');
    h.albumCover.value = 'anything';
    h.albumCover.dispatch('input', { isTrusted: false });
    assert.equal(tour.getPhase(), 'waiting');
  });

  test('D8 — custom events are honored only via tour:action with the expected detail', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf({
      id: 'c1', order: 1, title: 'Custom', prompt: 'Dispatch.',
      target: { kind: 'selector', selector: '[data-tour-target="album-cover"]', label: 'cover' },
      action: { kind: 'custom', eventName: 'panel-open' }, confirm: { kind: 'silent' },
    }) });
    tour.start();
    h.advance(h.X.D.base);
    // Wrong event name on the right channel.
    h.window.dispatchEvent('tour:action', { detail: { name: 'panel-close' } });
    assert.equal(tour.getPhase(), 'waiting');
    // Right detail on the wrong channel.
    h.window.dispatchEvent('some-other-event', { detail: { name: 'panel-open' } });
    assert.equal(tour.getPhase(), 'waiting');
    // The real thing.
    h.window.dispatchEvent('tour:action', { detail: { name: 'panel-open' } });
    // Silent confirm: honored, and the machine has advanced
    // through confirming into the unlock hand-off.
    assert.equal(tour.getPhase(), 'unlocking');
  });
});

/* ── Confirm + unlock ─────────────────────────────────────── */

describe('C — confirmation and the unlock hand-off', () => {
  test('C1 — the confirm animation plays exactly once per step', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums', { kind: 'pulse' }),
      clickStep('s2', 2, 'album-cover', { kind: 'pulse' }),
    ) });
    completeClickStep(h, tour, h.tabAlbums);
    // s1's confirm timers (pulse: D.base/2 scale, D.base fade,
    // D.base + D.short done) have all fired and been removed;
    // only s2's settle timer (D.base) remains pending.
    assert.equal(h.pending().filter(t => t.ms === h.X.D.base).length, 1);
    assert.equal(h.pending().filter(t => t.ms === h.X.D.base / 2).length, 0);
    const saved = h.X.parseTourState(h.store.get('walkthrough.tourState'));
    assert.deepEqual(saved.completed, ['s1']); // recorded once, never twice
  });

  test('C2 — the current highlight fully fades before the next appears', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start();
    h.advance(h.X.D.base);
    const card = h.document.querySelector('.tour-card');
    h.tabAlbums.dispatch('click');
    h.advance(h.X.D.base + h.X.D.short); // confirm done → unlocking starts (fade over D.base)
    assert.equal(tour.getPhase(), 'unlocking');
    assert.equal(card.style.opacity, '0');      // fully faded…
    assert.equal(textTree(card), '1 / 2Step s1Do the s1 thing.Skip this stepEnd tour'); // …and still step 1's text
    h.advance(h.X.D.base - 1);
    assert.equal(textTree(card), '1 / 2Step s1Do the s1 thing.Skip this stepEnd tour'); // not yet re-populated
    h.advance(1);                                // unlock fires
    assert.equal(textTree(card), '1 / 2Step s2Do the s2 thing.Skip this stepEnd tour'); // next step's text exists now
  });

  test('C3 — no overlap between outgoing and incoming prompt cards', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
      clickStep('s3', 3, 'photo-card'),
    ) });
    tour.start();
    h.advance(h.X.D.base); // step 1 arms
    // Each chain runs confirm + unlock + the next step's
    // settle, so every click lands on an armed step.
    const arm = h.X.D.base + h.X.D.short + h.X.D.base + h.X.D.base;
    for (let i = 0; i < 2; i++) {
      const targets = [h.tabAlbums, h.albumCover];
      targets[i].dispatch('click');
      h.advance(arm);
      assert.equal(h.document.querySelectorAll('.tour-card').length, 1,
        'exactly one prompt card may exist at any moment');
    }
  });

  test('C4 — the toast holds for its full duration before unlock', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums', { kind: 'toast', text: 'Done.' }),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start();
    h.advance(h.X.D.base);
    h.tabAlbums.dispatch('click');
    assert.equal(tour.getPhase(), 'confirming');
    // D.short + TOAST_HOLD (2 × D.long) + D.short − 1: still confirming.
    h.advance(h.X.D.short + h.X.TOAST_HOLD + h.X.D.short - 1);
    assert.equal(tour.getPhase(), 'confirming');
    h.advance(1); // toast done → unlock
    assert.equal(tour.getPhase(), 'unlocking');
    h.advance(h.X.D.base);
    assert.equal(tour.getCurrentStepId(), 's2');
  });
});

/* ── Escape ───────────────────────────────────────────────── */

describe('E — escape hatches', () => {
  test('E1 — skip-action advances without adding to completed', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start();
    h.advance(h.X.D.base);
    const skipLinks = h.document.querySelectorAll('.tour-card-escapes .tour-escape-link');
    assert.equal(skipLinks.length, 2);
    skipLinks[0].dispatch('click'); // "Skip this step"
    h.advance(h.X.D.base); // unlock
    assert.equal(tour.getPhase(), 'prompting');
    assert.equal(tour.getCurrentStepId(), 's2');
    const saved = h.X.parseTourState(h.store.get('walkthrough.tourState'));
    assert.deepEqual(saved.completed, []);      // NOT completed
    assert.deepEqual(saved.skipped, ['s1']);    // recorded as skipped
  });

  test('E2 — skip-tour ends the tour and routes to the archive root', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'tab-albums')) });
    tour.start();
    h.advance(h.X.D.base);
    const skipLinks = h.document.querySelectorAll('.tour-card-escapes .tour-escape-link');
    skipLinks[1].dispatch('click'); // "End tour"
    assert.equal(tour.getPhase(), 'complete');
    assert.deepEqual(h.navigations, ['/'], 'routes to the archive root');
    const saved = h.X.parseTourState(h.store.get('walkthrough.tourState'));
    assert.equal(saved.finished, true);
    assert.ok(saved.escapedAt);
    assert.equal(h.document.querySelectorAll('.tour-root').length, 0);
  });

  test('E3 — the Escape key opens the hatch menu', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'tab-albums')) });
    tour.start();
    h.advance(h.X.D.base);
    const menu = h.document.querySelector('.tour-escape-menu');
    assert.equal(menu.hidden, true);
    h.window.dispatchEvent('keydown', { key: 'Escape' });
    assert.equal(menu.hidden, false);
    assert.equal(menu.querySelectorAll('.tour-escape-link').length, 2);
    h.window.dispatchEvent('keydown', { key: 'Escape' }); // toggles closed
    assert.equal(menu.hidden, true);
  });

  test('E4 — a step whose target is missing is skipped, not rendered', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      { id: 's2', order: 2, title: 'Ghost step', prompt: 'Never rendered.',
        target: { kind: 'selector', selector: '[data-tour-target="does-not-exist"]', label: 'ghost' },
        action: { kind: 'click' }, confirm: { kind: 'pulse' } },
      clickStep('s3', 3, 'album-cover'),
    ) });
    tour.start();
    h.advance(h.X.D.base);
    h.tabAlbums.dispatch('click');
    h.advance(h.X.D.base + h.X.D.short); // confirm
    h.advance(h.X.D.base); // unlock → renderStep(s2): target missing → wait
    assert.equal(tour.getCurrentStepId(), 's2');
    // The ghost step never renders its card; the wait expires and it is skipped.
    h.advance(10000); // TARGET_WAIT_MS
    h.advance(h.X.D.base);   // unlock skip → s3
    assert.equal(tour.getPhase(), 'prompting');
    assert.equal(tour.getCurrentStepId(), 's3');
    assert.ok(!h.allText().includes('Ghost step'));
    assert.ok(!h.allText().includes('Never rendered.'));
    const saved = h.X.parseTourState(h.store.get('walkthrough.tourState'));
    assert.deepEqual(saved.skipped, ['s2']);
    assert.ok(h.warns.some(w => w.includes('s2')), 'the skip is logged');
  });
});

/* ── Persistence ──────────────────────────────────────────── */

describe('P — persistence', () => {
  test('P1 — reloading resumes at currentStepId with the same highlight', () => {
    const h = setup({ seedState: {
      startedAt: '2026-01-01T00:00:00.000Z',
      currentStepId: 's2',
      completed: ['s1'],
      skipped: [],
      escapedAt: null,
      finished: false,
    } });
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start({ resume: true });
    assert.equal(tour.getCurrentStepId(), 's2');
    assert.equal(h.document.querySelector('.tour-card .tour-card-title')._textContent, 'Step s2');
    assert.equal(h.document.querySelector('.tour-card .tour-card-count')._textContent, '2 / 2');
  });

  test('P2 — completed is append-only and monotonic across sessions', () => {
    const h = setup();
    const tour1 = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    completeClickStep(h, tour1, h.tabAlbums);
    // "Reload": a fresh engine over the same persisted storage.
    const tour2 = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour2.start({ resume: true });
    assert.equal(tour2.getCurrentStepId(), 's2');
    h.advance(h.X.D.base);
    h.albumCover.dispatch('click');
    h.advance(h.X.D.base + h.X.D.short);
    h.advance(h.X.D.base);
    const saved = h.X.parseTourState(h.store.get('walkthrough.tourState'));
    assert.deepEqual(saved.completed, ['s1', 's2']); // in order, no duplicates
  });

  test('P3 — finished: true prevents re-starting on the next visit', () => {
    const h = setup();
    const params = (v) => ({ get: (k) => (k === 'tour' ? v : null) });
    assert.equal(h.X.shouldAutoStartTour({ finished: true }, params('1')), false);
    assert.equal(h.X.shouldAutoStartTour({ finished: true, currentStepId: 's1' }, params(null)), false);
    assert.equal(h.X.shouldAutoStartTour(null, params('1')), true);
    assert.equal(h.X.shouldAutoStartTour({ finished: false, currentStepId: 's2' }, params(null)), true);
    assert.equal(h.X.shouldAutoStartTour(null, params(null)), false);
  });

  test('P4 — a fresh start resets the persisted lists', () => {
    const h = setup({ seedState: {
      startedAt: '2026-01-01T00:00:00.000Z', currentStepId: 's1',
      completed: ['old-1'], skipped: ['old-2'], escapedAt: null, finished: false,
    } });
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'tab-albums')) });
    tour.start(); // no resume → fresh start
    const saved = h.X.parseTourState(h.store.get('walkthrough.tourState'));
    assert.deepEqual(saved.completed, []);
    assert.deepEqual(saved.skipped, []);
  });
});

/* ── Motion + a11y ────────────────────────────────────────── */

describe('M — reduced motion and accessibility', () => {
  test('M1 — reduced motion: no animation, every state change is instant', () => {
    const h = setup({ reducedMotion: true });
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start();
    h.advance(0); // settle timer is 0ms
    assert.equal(tour.getPhase(), 'waiting');
    h.tabAlbums.dispatch('click');
    h.advance(0); // confirm + unlock + next settle: all 0ms, chained
    // The whole machine drained instantly — step 2 is armed.
    assert.equal(tour.getPhase(), 'waiting');
    assert.equal(tour.getCurrentStepId(), 's2');
    // The ring is solid, not drawn in: dashoffset is 0 from the start.
    const ringRect = h.document.querySelector('.tour-ring-rect');
    assert.equal(ringRect.getAttribute('stroke-dashoffset'), '0');
    // Every transition duration that was set is 0ms.
    const durations = [];
    for (const s of h.allStyleSets()) {
      const m = s.match(/(\d+(?:\.\d+)?)ms/);
      if (m) durations.push(parseFloat(m[1]));
    }
    assert.ok(durations.length > 0);
    for (const d of durations) assert.equal(d, 0);
  });

  test('M2 — aria-live announces each prompt', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start();
    const card = h.document.querySelector('.tour-card');
    assert.equal(card.getAttribute('aria-live'), 'polite');
    const prompt = h.document.querySelector('.tour-card-prompt');
    assert.equal(prompt._textContent, 'Do the s1 thing.');
    completeClickStep(h, tour, h.tabAlbums);
    assert.equal(h.document.querySelector('.tour-card-prompt')._textContent, 'Do the s2 thing.');
  });

  test('M3 — aria-describedby is on the target during the step, removed after', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start();
    h.advance(h.X.D.base);
    const describedBy = h.tabAlbums.getAttribute('aria-describedby');
    assert.ok(describedBy, 'target is described while the step is active');
    assert.equal(describedBy, h.document.querySelector('.tour-card-prompt').id);
    completeClickStep(h, tour, h.tabAlbums);
    assert.equal(h.tabAlbums.getAttribute('aria-describedby'), null);
  });

  test('M4 — focus can always leave the tour via Tab', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'tab-albums')) });
    tour.start();
    h.advance(h.X.D.base);
    // Tab is never intercepted…
    const ev = h.window.dispatchEvent('keydown', { key: 'Tab' });
    assert.equal(ev.defaultPrevented, false);
    // …and the prompt card is not made focusable (no tabindex on it).
    const card = h.document.querySelector('.tour-card');
    assert.equal(card.hasAttribute('tabindex'), false);
  });

  test('M5 — non-native targets get tabindex for the step, then lose it', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'album-cover'), // a <figure>, not natively focusable
      clickStep('s2', 2, 'tab-albums'),  // a <button>, natively focusable
    ) });
    tour.start();
    h.advance(h.X.D.base);
    assert.equal(h.albumCover.getAttribute('tabindex'), '0');
    completeClickStep(h, tour, h.albumCover);
    assert.equal(h.albumCover.getAttribute('tabindex'), null);
    h.advance(h.X.D.base); // s2 settle
    // The button keeps its own focusability; the engine adds nothing.
    assert.equal(h.tabAlbums.getAttribute('data-tour-tabindex'), null);
    assert.equal(h.tabAlbums.hasAttribute('tabindex'), false);
  });
});

/* ── Speed multiplier ─────────────────────────────────────── */

describe('S — the speed multiplier is the single timing source', () => {
  test('S1 — SPEED_MULTIPLIER = 2.0 scales every tour timing', () => {
    const h = setup({ multiplierPatch: 2.0 });
    assert.equal(h.X.D.short, 200);
    assert.equal(h.X.D.base, 600);
    assert.equal(h.X.D.long, 1000);
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start();
    // The settle timer (prompting → waiting) is D.base = 600ms at ×2.0.
    assert.ok(h.pending().some(t => t.ms === 600), 'settle timer scaled');
    h.advance(600);
    h.tabAlbums.dispatch('click');
    // The unlock fade is D.base = 600ms at ×2.0.
    h.advance(600);  // pulse: D.base + D.short = 800… advance in steps
    h.advance(200);
    h.advance(600);  // unlock fade
    assert.equal(tour.getCurrentStepId(), 's2');
  });

  test('S2 — at ×1.25 no hardcoded durations remain; all derive from D', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums', { kind: 'toast', text: 'Done.' }),
      clickStep('s2', 2, 'album-cover', { kind: 'checkmark' }),
      clickStep('s3', 3, 'photo-card', { kind: 'silent' }),
    ) });
    // Run the whole tour — every confirm kind, plus unlocks.
    // Each chain includes the next step's settle, so every
    // step is armed (waiting) before its click lands.
    const arm = h.X.D.short + h.X.TOAST_HOLD + h.X.D.short + h.X.D.base + h.X.D.base;
    tour.start();
    h.advance(h.X.D.base);
    for (const target of [h.tabAlbums, h.albumCover, h.photoCard]) {
      target.dispatch('click');
      h.advance(arm);
    }
    assert.equal(tour.getPhase(), 'complete');
    const allowed = new Set([0, h.X.D.short, h.X.D.base, h.X.D.long, h.X.D.base / 2]);
    const seen = new Set();
    // The overlay is torn down on completion, so audit every
    // element the sandbox ever built, not just the live tree.
    for (const s of h.allStyleSets()) {
      if (!s.startsWith('transition=')) continue;
      for (const m of s.matchAll(/(\d+(?:\.\d+)?)ms/g)) {
        const d = parseFloat(m[1]);
        seen.add(d);
        assert.ok(allowed.has(d), `duration ${d}ms is not derived from D: ${s}`);
      }
    }
    assert.ok(seen.size > 0, 'transitions were exercised');
  });
});

/* ── Integration: the real authored tour ──────────────────── */

describe('T — the real TOUR_STEPS integration', () => {
  test('T1 — the authored five-step tour runs end to end on the real targets', () => {
    const h = setup();
    assert.equal(h.X.TOUR_STEPS.length, 5);
    const tour = h.X.createGuidedTour({ steps: h.X.TOUR_STEPS });
    tour.start();
    // A step's action listener is bound when it reaches
    // waiting — so every advance chain below runs
    // confirm + unlock + the NEXT step's settle, leaving
    // each step armed (waiting) before its click.
    const arm = h.X.D.base + h.X.D.short + h.X.D.base + h.X.D.base;
    h.advance(h.X.D.base); // step 1 arms
    // Step 1: Albums tab.
    assert.equal(tour.getCurrentStepId(), 'open-albums');
    h.tabAlbums.dispatch('click');
    h.advance(arm);
    // Step 2: album cover.
    assert.equal(tour.getCurrentStepId(), 'open-album');
    h.albumCover.dispatch('click');
    h.advance(arm);
    // Step 3: photo card inside the album detail.
    assert.equal(tour.getCurrentStepId(), 'open-photo');
    h.photoCard.dispatch('click');
    h.advance(arm);
    // Step 4: viewer Next arrow (checkmark confirm: D.base + D.short).
    assert.equal(tour.getCurrentStepId(), 'next-photo');
    h.viewerNext.dispatch('click');
    h.advance(arm);
    // Step 5: viewer Back arrow (toast confirm: D.short + TOAST_HOLD + D.short, then unlock).
    assert.equal(tour.getCurrentStepId(), 'close-viewer');
    h.viewerClose.dispatch('click');
    h.advance(h.X.D.short + h.X.TOAST_HOLD + h.X.D.short + h.X.D.base);
    assert.equal(tour.getPhase(), 'complete');
    const saved = h.X.parseTourState(h.store.get('walkthrough.tourState'));
    assert.deepEqual(saved.completed, ['open-albums', 'open-album', 'open-photo', 'next-photo', 'close-viewer']);
    assert.equal(saved.finished, true);
    assert.equal(saved.currentStepId, null);
  });

  test('T2 — the tour pushes a history entry so back exits it', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: h.X.TOUR_STEPS });
    tour.start();
    assert.deepEqual(h.pushStates, [{ guidedTour: true }]);
  });
});
