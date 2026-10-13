/* The notification layer, executed.

   Every other test in this directory reads app.js as TEXT and asserts on
   what the source says. That is the wrong instrument for a bug that is
   only observable at runtime — and this file exists because a mutation
   proved it: deleting the `renderToastProgress(id, …)` call from showToast
   entirely left the whole suite green. A pattern test cannot see whether a
   function was called.

   So here the real library runs against a minimal DOM, the real showToast
   is called, and the resulting elements are inspected. Every assertion is
   about observable state — a node that exists, a label that says 18%, a
   bar whose width is set — never about how the source spells it.

   The DOM is a hand-rolled stub rather than jsdom: the site has no
   dependencies and the test suite is expected to keep that property. It
   needs classList, dataset, appendChild, querySelector and innerHTML,
   which is what the library and the wrapper actually touch. */

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const APP = new URL('../app.js', import.meta.url);
const LIB = new URL('../hcg-toast.js', import.meta.url);
const app = await readFile(APP, 'utf8');
const lib = await readFile(LIB, 'utf8');

/* ── A DOM just large enough ─────────────────────────────────────── */

function makeEl(tag = 'div') {
  const el = {
    tag,
    children: [],
    attrs: {},
    style: { props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; } },
    classSet: new Set(),
    dataset: {},
    _text: '',
    get className() { return [...el.classSet].join(' '); },
    set className(v) { el.classSet = new Set(String(v).split(/\s+/).filter(Boolean)); },
    set innerHTML(v) {
      el._html = v;
      // The library builds the item imperatively and only ever assigns
      // innerHTML for the icon and the close glyph, both static markup.
      // A flat text model plus class extraction is enough — but children
      // must reset, or a second render would see the first one's nodes.
      el.children = [];
      const re = /<(\w+)([^>]*)>([\s\S]*?)<\/\1>|<(\w+)([^>]*)\/?>/g;
      let m;
      while ((m = re.exec(v))) {
        const tag = m[1] || m[4];
        const attrs = m[2] || m[5] || '';
        const inner = m[3] || '';
        const child = makeEl(tag);
        for (const a of attrs.matchAll(/class="([^"]+)"/g)) {
          for (const c of a[1].split(/\s+/)) child.classSet.add(c);
        }
        child._text = inner.replace(/<[^>]*>/g, '');
        el.children.push(child);
      }
    },
    get innerHTML() { return el._html || ''; },
    set textContent(v) { el._text = v; },
    get textContent() { return el._text; },
    classList: {
      add: (...cs) => cs.forEach(c => el.classSet.add(c)),
      remove: (...cs) => cs.forEach(c => el.classSet.delete(c)),
      contains: (c) => el.classSet.has(c),
      toggle: (c, on) => { (on ?? !el.classSet.has(c)) ? el.classSet.add(c) : el.classSet.delete(c); },
    },
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
    removeAttribute(k) { delete el.attrs[k]; },
    appendChild(c) { el.children.push(c); c.parentNode = el; return c; },
    insertBefore(c) { el.children.push(c); c.parentNode = el; return c; },
    removeChild(c) { el.children = el.children.filter(x => x !== c); return c; },
    addEventListener() {},
    removeEventListener() {},
    get firstChild() { return el.children[0] || null; },
    contains(n) {
      if (n === el) return true;
      return el.children.some(c => c.contains && c.contains(n));
    },
    closest() { return null; },
    querySelector(sel) { return find(el, sel); },
    querySelectorAll() { return []; },
  };
  el.parentNode = null;
  return el;
}

/* Selector support for the forms the library and the wrapper actually
   use, which is a compound one:
     .hcg-toast-item                              (class)
     [data-toast-id="3"]                          (attribute)
     .hcg-toast-item[data-toast-id="3"]           (both — the wrapper's)
   Anything else returns null, and every test that depends on a lookup
   asserts the element was found — so a selector this cannot parse shows up
   as a failure, never as a vacuous pass. */
function match(el, sel) {
  const m = sel.match(/^([.#]?[\w-]*)(?:\[data-toast-id="([^"]*)"\])?$/);
  if (!m) return false;
  // The capture keeps the leading dot for a class selector; classSet holds
  // bare names, so strip it before the lookup.
  const cls = m[1] && m[1].startsWith('.') ? m[1].slice(1) : m[1];
  const dataId = m[2];
  if (cls && !el.classSet.has(cls)) return false;
  if (dataId != null && String(el.dataset.toastId) !== dataId) return false;
  return true;
}

function find(root, sel) {
  const out = findAll(root, sel);
  return out.length ? out[0] : null;
}

function findAll(root, sel) {
  const out = [];
  (function walk(n) {
    for (const c of n.children) {
      if (match(c, sel)) out.push(c);
      walk(c);
    }
  })(root);
  return out;
}

/* ── Run the real notification block against the real library ───── */

/* Only the notification half of app.js is needed, and it has to be real
   code rather than a copy — a copy would be the very thing under test. It
   is sliced out of app.js at load and evaluated as written. */
const NOTIF_START = '/* ── Notifications ──';
const NOTIF_END = '/* ── Public surface ──';

function harness(opts = {}) {
  const body = app.slice(app.indexOf(NOTIF_START), app.indexOf(NOTIF_END));
  assert.notStrictEqual(body.length > 0, false, 'the notification block moved');

  // The library creates its own container inside document.body, so the
  // root the tests inspect is that container, not document.body itself.
  const root = makeEl();
  /* The unlock listeners the real page installs on `window`, and the
   recovery listeners it installs on `document`. Collected rather than
   fired, so a test can decide when the page counts as touched and when it
   comes back to the foreground — which is the whole point of both gates.
   Declared before `doc`, which writes into it. */
  const listeners = [];
  const doc = {
    body: root,
    createElement: (tag) => makeEl(tag),
    // The wrapper looks its own live item up by [data-toast-id], and
    // decorateToast looks the body and the close button up by class. Both
    // have to resolve against the tree the library actually built.
    querySelector: (sel) => find(root, sel),
    querySelectorAll: (sel) => findAll(root, sel),
    addEventListener(type, fn) { listeners.push({ type, fn }); },
  };
  const raf = [];
  /* Every oscillator the notification layer built, in order, with the
     frequency and envelope it was given. This is what makes the palette
     assertable: two voices are different if the numbers are different,
     and a stub that records them says so without a human listening. */
  const played = [];
  /* Contexts built, and contexts closed. A muted gallery must leave the
     output device alone, and that is only observable by counting them. */
  let made = 0;
  let closed = 0;
  /* Node lifecycle: how many disconnects a finished voice issued, and
     whether a teardown has run. `finish()` fires the onended of whichever
     oscillator the app left holding it — the last partial. */
  const live = { disconnects: 0, ended: 0, stops: 0 };
  const lastOsc = { current: null };
  /* The contexts this page is holding, newest last, so a test can suspend
     one the way a phone would. */
  const contexts = [];
  let bornSuspended = false;
  const sandbox = {
    console,
    document: doc,
    addEventListener(type, fn) { listeners.push({ type, fn }); },
    requestAnimationFrame: (fn) => { raf.push(fn); return raf.length; },
    cancelAnimationFrame() {},
    setTimeout: (fn, ms) => { setTimeout(fn, 0); return 0; },
    clearTimeout() {},
    localStorage: {
      _v: {},
      getItem(k) { return k in this._v ? this._v[k] : null; },
      setItem(k, v) { this._v[k] = String(v); },
    },
    /* No AudioContext and no Audio: the real code must not need either a
       file or a decoder, and the tests below install a context only to
       watch which oscillators get built. */
    Audio: undefined,
    AudioContext: undefined,
  };
  if (opts.audio) {
    sandbox.AudioContext = class {
      constructor() {
        this.state = bornSuspended ? 'suspended' : 'running';
        this.currentTime = 0;
        this.destination = {};
        made++;
        contexts.push(this);
      }
      close() {
        this.state = 'closed';
        closed++;
        return Promise.resolve();
      }
      createGain() {
        const g = {
          gain: rampable(),
          connect() {},
          disconnect() { live.disconnects++; },
        };
        return g;
      }
      createOscillator() {
        // frequency.setValueAtTime is the only setter the real code uses,
        // and it is where the note is chosen — so that is what gets
        // recorded, rather than a guess made after the fact.
        const freq = rampable();
        const o = {
          type: '',
          frequency: freq,
          connect() {},
          disconnect() { live.disconnects++; },
          start(t) {
            played.push({ freq: o._freq, type: o.type, at: t });
            lastOsc.current = o;
          },
          stop() { live.stops++; },
          onended: null,
          _freq: 0,
        };
        freq.setValueAtTime = (v) => { o._freq = v; };
        return o;
      }
    };
  }
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(lib + '\n;globalThis.__toast = toast;', ctx, { filename: 'hcg-toast.js' });
  vm.runInContext(body
    + '\n;globalThis.__n = { showToast, showPending, dismissToast, setToastSound,'
    + ' playToastDing, TOAST_VOICES };',
    ctx, { filename: 'app-notifications.js' });
  const flushFrames = () => { const q = raf.splice(0); q.forEach(f => f()); };
  /* The library appends its container lazily, on first use, so until
     something is shown there is nothing to search. `container` resolves
     through the document each time rather than being captured once. */
  const container = () => {
    const c = find(root, '.hcg-toast-container');
    return c || root;
  };
  /* Fire the gesture the page is waiting for. Before this, every sound is
     correctly silent — which the sound tests below rely on. */
  const gesture = () => { fire('pointerdown'); };
  const fire = (type) => { for (const l of listeners) if (l.type === type) l.fn(); };
  return {
    api: sandbox.__n, doc, container, flushFrames, storage: sandbox.localStorage,
    played, gesture,
    // Frequencies the palette actually built, for comparison between voices.
    freqs: () => played.map((p) => p.freq),
    reset: () => { played.length = 0; live.disconnects = 0; live.ended = 0; live.stops = 0; },
    get made() { return made; },
    get closed() { return closed; },
    live,
    /* Run the teardown the browser would run once the last partial's
       scheduled stop time has passed. */
    finish: () => {
      const o = lastOsc.current;
      if (o && typeof o.onended === 'function') { live.ended++; o.onended(); }
    },
    /* What a phone does when the visitor switches away. */
    suspend: () => { for (const c of contexts) if (c.state === 'running') c.state = 'suspended'; },
    /* Contexts still alive and unclosed — the ones the page is holding. */
    held: () => contexts.filter((c) => c.state !== 'closed').length,
    /* …and the events that bring them back. */
    foreground: () => { fire('visibilitychange'); },
    pageshow: () => { fire('pageshow'); },
    get bornSuspended() { return bornSuspended; },
    set bornSuspended(v) { bornSuspended = v; },
  };
}

/* A stand-in for AudioParam. The real one interpolates a timeline; nothing
   here needs the shape, only that the code can call setters on it. */
function rampable() {
  return {
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    cancelScheduledValues() {},
  };
}

describe('The notification layer, executed', () => {
  let h;
  beforeEach(() => { h = harness(); });

  /* All text under a node. The library and the wrapper both write text
     with textContent, never innerHTML, so this is what the DOM would
     render. */
  const textOf = (node) => {
    let out = node.textContent || '';
    for (const c of node.children) out += ' ' + textOf(c);
    return out;
  };
  const items = () => find(h.container(), '.hcg-toast-item');
  const allItems = (node) => {
    const out = [];
    (function walk(n) {
      for (const c of n.children) { if (c.classSet.has('hcg-toast-item')) out.push(c); walk(c); }
    })(node);
    return out;
  };
  const bar = (item) => item.children.find(c => c.classSet.has('toast-progress'));

  test('a plain message produces a live item carrying its text', () => {
    h.api.showToast('Saved classification.', { type: 'success' });
    h.flushFrames();
    const item = items();
    assert.ok(item, 'showToast must build an element');
    assert.ok(item.classSet.has('hcg-toast-item--success'),
      'the type must reach the variant class, or the colour is a lie');
    // The library builds the item imperatively and puts the message in a
    // child via textContent, so read the text of the subtree — not innerHTML,
    // which is only ever assigned for the icon and the close glyph.
    assert.match(textOf(item), /Saved classification/);
  });

  test('the variant class follows the type the caller passed', () => {
    for (const [type, cls] of [
      ['success', 'hcg-toast-item--success'],
      ['error', 'hcg-toast-item--error'],
      ['warning', 'hcg-toast-item--warning'],
      ['pending', 'hcg-toast-item--pending'],
      ['info', 'hcg-toast-item--info'],
    ]) {
      const t = harness();
      t.api.showToast('x', { type });
      t.flushFrames();
      const item = find(t.container(), '.hcg-toast-item');
      assert.ok(item.classSet.has(cls), `${type} must produce ${cls}`);
    }
  });

  test('a sticky message with no type is pending — work in flight', () => {
    h.api.showToast('Uploading photos', { sticky: true });
    h.flushFrames();
    assert.ok(items().classSet.has('hcg-toast-item--pending'));
  });

  test('an explicit type outranks the sticky default', () => {
    h.api.showToast('Failed: x', { type: 'error', sticky: true });
    h.flushFrames();
    const item = items();
    assert.ok(item.classSet.has('hcg-toast-item--error'), 'must not fall back to pending/orange');
    assert.ok(!item.classSet.has('hcg-toast-item--pending'));
  });

  test('showPending renders a bar, and the bar is not a decoration', () => {
    // This is the assertion that failed to exist: removing the
    // renderToastProgress call from showToast leaves a text-only suite
    // green, because nothing was watching whether the function ran.
    h.api.showPending('Uploading photos', 7, 40);
    h.flushFrames();
    const item = items();
    assert.ok(item.classSet.has('hcg-toast-item--progress'),
      'the card must be marked as carrying a bar');
    const b = bar(item);
    assert.ok(b, 'the bar element must actually be in the DOM');
  });

  test('the bar reports the real fraction, count and percentage', () => {
    h.api.showPending('Deleting photos', 9, 40);
    h.flushFrames();
    const b = bar(items());
    assert.ok(b, 'no bar');
    const count = b.children.find(c => c.classSet.has('toast-progress-count'));
    const pct = b.children.find(c => c.classSet.has('toast-progress-pct'));
    assert.equal(count.textContent, '9 / 40', 'the count must be inside the bar');
    assert.equal(pct.textContent, '23%', 'the percentage must be inside the bar');
    // 9/40 = 0.225, and the fill is width: calc(var(--toast-progress) * 100%).
    assert.equal(b.style.props['--toast-progress'], '0.2250',
      'the fill must be driven by the real ratio');
  });

  test('the bar advances as the batch advances', () => {
    for (const [done, want] of [[0, '0.0000'], [1, '0.0250'], [20, '0.5000'], [40, '1.0000']]) {
      h.api.showPending('Moving photos', done, 40);
      h.flushFrames();
      const b = bar(items());
      assert.equal(b.style.props['--toast-progress'], want, `at ${done}/40`);
    }
  });

  test('done past total cannot render a bar wider than its track', () => {
    h.api.showPending('Renaming photos', 55, 40);
    h.flushFrames();
    const b = bar(items());
    assert.equal(b.style.props['--toast-progress'], '1.0000', 'must clamp to 100%');
    const pct = b.children.find(c => c.classSet.has('toast-progress-pct'));
    assert.equal(pct.textContent, '100%');
  });

  test('no usable total sweeps and admits it, rather than claiming 0%', () => {
    h.api.showPending('Saving classification');
    h.flushFrames();
    const b = bar(items());
    assert.ok(b.classSet.has('toast-progress--indeterminate'));
    const pct = b.children.find(c => c.classSet.has('toast-progress-pct'));
    assert.equal(pct.textContent, 'Working…');
    assert.ok(!('--toast-progress' in b.style.props), 'no stale fraction left behind');
  });

  test('Undo lands inside the body, not beside it', () => {
    let undone = false;
    h.api.showToast('Deleted 1 photo.', { type: 'success', undo: () => { undone = true; } });
    h.flushFrames();
    const item = items();
    const body = item.children.find(c => c.classSet.has('hcg-toast-body'));
    assert.ok(body, 'the library renders a body');
    const btn = body.children.find(c => c.classSet.has('toast-undo'));
    assert.ok(btn, 'Undo must be inside the body, under the message');
    assert.equal(btn.textContent, 'Undo');
  });

  test('a message with no undo carries no Undo', () => {
    h.api.showToast('Just a message.');
    h.flushFrames();
    const item = items();
    const body = item.children.find(c => c.classSet.has('hcg-toast-body'));
    assert.ok(!body.children.some(c => c.classSet.has('toast-undo')));
  });

  test('the dismiss glyph is swapped for the stroked cross', () => {
    h.api.showToast('x');
    h.flushFrames();
    const item = items();
    const close = item.children.find(c => c.classSet.has('hcg-toast-close'));
    assert.ok(close, 'the library renders a close button');
    assert.match(close.innerHTML, /<svg/, 'the × must be replaced by the real mark');
    assert.doesNotMatch(close.innerHTML, /&times;/);
  });

  test('a second message replaces the first — one at a time', () => {
    h.api.showToast('first');
    h.flushFrames();
    h.api.showToast('second');
    h.flushFrames();
    const all = allItems(h.container());
    assert.equal(all.length, 1, 'dismissAll must remove the previous item outright');
    assert.match(textOf(all[0]), /second/);
  });

  test('a falsy message renders nothing rather than an empty card', () => {
    h.api.showToast('');
    h.flushFrames();
    assert.equal(items(), null);
  });

  test('the sound switch persists under gallery.toastSound', () => {
    h.api.setToastSound(false);
    assert.equal(h.storage.getItem('gallery.toastSound'), 'off');
    h.api.setToastSound(true);
    assert.equal(h.storage.getItem('gallery.toastSound'), 'on');
  });
});

/* ── The palette, executed ──────────────────────────────────────────
   The static audit in toast.test.mjs reads the source; this runs it.
   The stub records the oscillators the real code builds, so "these two
   voices are different" is a claim about numbers rather than a claim
   about how it probably sounds. */
describe('The voices, executed', () => {
  let h;
  beforeEach(() => { h = harness({ audio: true }); });

  const voiceOf = (name) => {
    h.reset();
    h.api.playToastDing(name);
    return h.freqs();
  };

  test('nothing sounds before a gesture', () => {
    h.api.playToastDing();
    assert.deepStrictEqual(h.freqs(), [],
      'the gesture gate has to hold even when a context is available');
  });

  test('every voice builds its own oscillators, and the default is the ding', () => {
    h.gesture();
    const ding = voiceOf(undefined);
    assert.deepStrictEqual(ding, [1318.51, 1975.53],
      'no name must resolve to the original two partials, unchanged');
    assert.deepStrictEqual(voiceOf('ding'), ding);

    for (const [name, expected] of Object.entries({
      error: [392.0, 311.13, 784.0],
      undo: [880.0, 587.33],
      success: [659.25, 880.0, 1318.51],
    })) {
      assert.deepStrictEqual(voiceOf(name), expected, `${name} must build its own partials`);
    }
  });

  test('four voices means four distinct sounds, and no two collapse together', () => {
    h.gesture();
    const all = ['ding', 'error', 'undo', 'success'].map(voiceOf);
    const joined = all.map((f) => f.join(','));
    assert.strictEqual(new Set(joined).size, 4,
      `two voices built the same oscillators: ${joined.join(' | ')}`);
    // And every one is audible: no voice may be silent, or a message
    // would be waiting on a sound that does not exist.
    for (const [i, v] of all.entries()) assert.ok(v.length > 0, `voice ${i} built no oscillators`);
  });

  test('an unknown name is a miss, not a mute', () => {
    h.gesture();
    assert.deepStrictEqual(voiceOf('nope'), voiceOf(undefined),
      'a name nobody defined must fall back to the default, not to silence');
  });

  test('muting the sound stops every voice', () => {
    h.gesture();
    h.api.setToastSound(false);
    for (const name of ['ding', 'error', 'undo', 'success', 'nope']) {
      h.reset();
      h.api.playToastDing(name);
      assert.deepStrictEqual(h.freqs(), [], `${name} sounded while muted`);
    }
  });

  test('a suspended context is replaced, not obeyed', () => {
    h.gesture();
    h.api.playToastDing();                 // builds and runs a context
    assert.strictEqual(h.made, 1);
    // iOS suspends on backgrounding and often does not resume on return.
    h.suspend();                           // the context the page holds goes suspended
    h.reset();
    h.api.playToastDing('success');
    assert.strictEqual(h.made, 2,
      'a suspended context must be discarded and rebuilt — obeying it means silence for the rest of the session');
    assert.ok(h.freqs().length > 0, 'and the notification must still be heard');
    // The abandoned context is not closed here — it is simply dropped, and
    // a closed one would have cost a promise for no benefit. The
    // visibilitychange handler is what closes contexts it finds suspended,
    // and it is covered separately below.
    assert.strictEqual(h.held(), 1, 'the page must hold exactly one live context');
  });

  test('returning to the tab drops a suspended context', () => {
    h.gesture();
    h.api.playToastDing();
    h.suspend();
    h.foreground();
    assert.strictEqual(h.closed, 1,
      'visibilitychange must release a suspended context on the way back');
    h.reset();
    h.api.playToastDing('error');
    assert.ok(h.freqs().length > 0, 'so the next notification is audible again');
  });

  test('a page restored from the back/forward cache recovers too', () => {
    h.gesture();
    h.api.playToastDing();
    h.suspend();
    h.pageshow();
    assert.strictEqual(h.closed, 1,
      'bfcache restore fires pageshow and no visibilitychange — that path needs its own listener');
  });

  test('a running context is left alone when the tab is hidden', () => {
    h.gesture();
    h.api.playToastDing();
    h.foreground();
    h.pageshow();
    assert.strictEqual(h.closed, 0,
      'a context that is merely fine must not be thrown away on every tab switch');
  });

  test('a context born suspended is obeyed, not rebuilt in a loop', () => {
    h.gesture();
    h.bornSuspended = true;                // the browser decided this was not a real gesture
    h.reset();
    h.api.playToastDing();
    assert.strictEqual(h.made, 1, 'a context born suspended is obeyed, not replaced');
    h.reset();
    h.api.playToastDing();
    assert.strictEqual(h.made, 1, 'and it must not spawn a new one per notification');
    assert.deepStrictEqual(h.freqs(), [], 'silence is correct here; a rebuild loop is not');
  });

  test('every voice has energy a phone speaker can reproduce', () => {
    /* A handset rolls off steeply below ~400Hz and has no sub-bass at all,
       so a voice whose notes all live down there arrives as a click. Each
       voice must put *some* of its energy above that, at a peak worth
       hearing — not merely contain one high partial at a whisper. */
    h.gesture();
    for (const name of ['ding', 'error', 'undo', 'success']) {
      const freqs = voiceOf(name);
      const voice = h.api.TOAST_VOICES[name];
      const peaks = voice.partials.map((p) => p[2]);
      const above = freqs.filter((f) => f >= 450);
      assert.ok(above.length > 0,
        `${name} has nothing above 450Hz (${freqs.join(', ')}) — a phone would render it as a click`);
      // And the part a phone *can* hear must not be buried under the rest.
      const loudestAbove = voice.partials
        .filter((p) => p[0] >= 450)
        .reduce((a, p) => Math.max(a, p[2]), 0);
      const loudestOverall = Math.max(...peaks);
      assert.ok(loudestAbove >= loudestOverall * 0.25,
        `${name} keeps its audible-for-phones partial too quiet: ${loudestAbove} vs ${loudestOverall}`);
    }
  });

  test('no voice is short enough to read as a click', () => {
    h.gesture();
    for (const name of ['ding', 'error', 'undo', 'success']) {
      const { decay, partials } = h.api.TOAST_VOICES[name];
      // Every partial has to sound for long enough to be heard as a pitch.
      // 150ms is roughly where a tone starts reading as a tick.
      const shortest = Math.min(...partials.map((p) => decay - p[1]));
      assert.ok(shortest > 0.15,
        `${name}'s first partial sounds for only ${(shortest * 1000) | 0}ms — that is a click`);
      // And none may ring past the toast it belongs to.
      const longest = Math.max(...partials.map((p) => decay + p[1]));
      assert.ok(longest < 1, `${name} rings for ${longest}s, longer than the message lasts`);
    }
  });

  test('no stale voice handle survives a context teardown', () => {
    /* Every path that releases the context must release the voice too. A
       handle left behind would be stopped and disconnected again on every
       later notification, against nodes that no longer exist — invisible
       until it starts throwing, and harmless-looking either way. */
    h.gesture();
    h.api.playToastDing('success');           // a voice now holds the context
    h.suspend();
    h.foreground();                            // discards the suspended context
    const before = h.live.stops;
    h.api.playToastDing('error');              // must not touch the dead voice
    // error's own three oscillators are scheduled to stop. The discarded
    // voice's three are NOT stopped again — they went with their context,
    // so this is 3 and not 6. The handle was cleared by the teardown, which
    // is the thing being protected: a stale handle would stop them a second
    // time, against nodes that no longer exist.
    assert.strictEqual(h.live.stops - before, 3,
      `a discarded context's voice must not be stopped again (got ${h.live.stops - before} extra stops, expected 3)`);
  });

  test('cutting a tone off releases it exactly once', () => {
    h.gesture();
    h.api.playToastDing('success');
    h.reset();
    h.api.showToast('Something else entirely.', { type: 'info' });
    const afterFirst = h.live.disconnects;
    // The replaced voice is already stopped, so a second dismissal must
    // find nothing to do.
    h.api.dismissToast();
    assert.strictEqual(h.live.disconnects, afterFirst,
      'the torn-down voice must not be disconnected again on a later dismissal');
  });

  test('every message the app can raise maps to the voice it should', () => {
    /* The whole point of the palette: what the visitor hears has to match
       what happened. This walks the shapes app.js actually raises — the
       five types, sticky and not, with and without an Undo — and checks the
       oscillator frequencies against the intended voice. A regression that
       turned an error into a ding would pass every other test here. */
    h.gesture();
    const voice = () => h.freqs();
    const cases = [
      // [options, expected frequencies, why]
      [{ type: 'info' }, [1318.51, 1975.53], 'an info is unremarkable — the default ding'],
      [{ type: 'warning' }, [1318.51, 1975.53], 'a warning is not an error; it gets the default'],
      [{ type: 'success' }, [1318.51, 1975.53], 'a single success is not a batch; default ding'],
      [{ type: 'error' }, [392.0, 311.13, 784.0], 'a failure must sound like one'],
      [{ type: 'error', sticky: true }, [392.0, 311.13, 784.0],
        'a sticky error does not leave on screen, so it must be heard'],
      [{ type: 'warning', sticky: true }, [1318.51, 1975.53],
        'a sticky warning also stays, but is not a failure'],
      [{ type: 'success', undo: () => {} }, [880.0, 587.33],
        'done but reversible is a third state, not a plain success'],
      [{ type: 'success', sound: 'success' }, [659.25, 880.0, 1318.51],
        'a clean batch gets the wider voice'],
      [{ type: 'warning', sound: undefined }, [1318.51, 1975.53],
        'a partial batch must not claim it finished'],
      [{ type: 'error', sound: 'undo' }, [880.0, 587.33],
        'an explicit voice beats the derived one'],
      [{ sound: 'nonsense' }, [1318.51, 1975.53],
        'an unknown name falls back rather than muting'],
    ];
    for (const [opts, expected, why] of cases) {
      h.reset();
      h.api.showToast('message', opts);
      assert.deepStrictEqual(voice(), expected, `${why} — ${JSON.stringify(opts)}`);
    }
    // And the one shape that must never sound.
    h.reset();
    h.api.showPending('Uploading photos', 1, 40);
    assert.deepStrictEqual(voice(), [], 'work in flight must stay silent');
  });

  test('a voice tears its own gain graph down when it finishes', () => {
    h.gesture();
    h.api.playToastDing('success');
    // Three partials means four nodes to reclaim once the last one ends.
    assert.strictEqual(h.live.disconnects, 0, 'nothing may be torn down before the sound has finished');
    assert.strictEqual(h.live.ended, 0, 'onended cannot have fired yet');
    h.finish();
    // osc + gain per partial, then the bus.
    assert.strictEqual(h.live.disconnects, 3 * 2 + 1,
      'every node this voice built must be disconnected when it ends');
    assert.strictEqual(h.live.ended, 1, 'teardown runs once, on the last partial');
  });

  test('one voice tearing down does not silence the next', () => {
    h.gesture();
    h.api.playToastDing('error');
    h.finish();
    // `error` has three partials: three oscillators, three gains and a bus.
    assert.strictEqual(h.live.disconnects, 3 * 2 + 1, 'the first voice released its own seven nodes');
    // Cleared counters only — `played` is what freqs() reads, and reset()
    // zeroes both, so re-record the baseline afterwards.
    h.reset();
    h.api.playToastDing('success');
    h.finish();
    // `success` has three partials: seven more disconnects, and no more.
    // A shared bus or a stale closure reaching into the second voice would
    // show up here as a number that is not exactly seven.
    assert.strictEqual(h.live.disconnects, 3 * 2 + 1,
      'each voice owns and releases only its own nodes');
    assert.ok(h.freqs().length > 0, 'and it still sounded');
  });

  test('muting closes the context rather than leaving it open', () => {
    h.gesture();
    h.api.playToastDing();
    const made = h.made;
    assert.ok(made > 0, 'playing a voice must build a context');
    h.api.setToastSound(false);
    assert.strictEqual(h.closed, made,
      'every context built while unmuted must be closed on mute — a live context holds the output device open');
  });

  test('unmuting builds a fresh context and sounds again', () => {
    h.gesture();
    h.api.playToastDing();
    const first = h.made;
    h.api.setToastSound(false);
    assert.strictEqual(h.closed, first);
    h.reset();
    h.api.setToastSound(true);           // plays the ding
    assert.ok(h.made > first, 'unmuting must build a new context, not reuse the closed one');
    assert.ok(h.freqs().length > 0, 'unmuting must confirm itself by being heard');
    // And it still works afterwards, so the close did not wedge the flag.
    h.reset();
    h.api.playToastDing('error');
    assert.deepStrictEqual(h.freqs(), [392.0, 311.13, 784.0], 'sound must survive a mute/unmute cycle');
  });

  test('muting before anything has played is harmless', () => {
    h.gesture();
    h.api.setToastSound(false);           // no context exists yet
    assert.strictEqual(h.made, 0, 'muting must not build a context just to close it');
    assert.deepStrictEqual(h.freqs(), [], 'and must not make a sound');
  });

  test('muting twice does not throw on an already-closed context', () => {
    h.gesture();
    h.api.playToastDing();
    h.api.setToastSound(false);
    h.api.setToastSound(false);
    assert.strictEqual(h.made, 1, 'the second mute must not build or close anything');
  });

  test('a failed message sounds like failure, without asking', () => {
    h.gesture();
    h.api.showToast('Could not save.', { type: 'error' });
    assert.deepStrictEqual(h.freqs(), [392.0, 311.13, 784.0],
      'the error voice must be derived from the type, not requested per call site');
  });

  test('a message offering Undo sounds unsettled, without asking', () => {
    h.gesture();
    h.api.showToast('Deleted 3 photos.', { type: 'success', undo: () => {} });
    assert.deepStrictEqual(h.freqs(), [880.0, 587.33],
      'the undo voice must be derived from the Undo, not requested per call site');
  });

  test('an explicit sound beats the derived one', () => {
    h.gesture();
    h.api.showToast('Saved photo.jpg', { type: 'error', sound: 'undo' });
    assert.deepStrictEqual(h.freqs(), [880.0, 587.33],
      'a call site that names a voice must win over the derived default');
  });

  test('a progress line is still silent', () => {
    h.gesture();
    h.api.showPending('Uploading photos', 1, 3);
    assert.deepStrictEqual(h.freqs(), [], 'a batch progress line must not sound');
    // …including the progress lines that update repeatedly. Forty dings
    // across one upload is a machine gun, not a notification.
    for (let i = 2; i <= 40; i++) h.api.showPending('Uploading photos', i, 40);
    assert.deepStrictEqual(h.freqs(), [], 'no line of a running batch may sound');
  });

  test('a sticky error sounds, because it stays on screen', () => {
    h.gesture();
    // Duration 0: this message does not leave on its own. It is the
    // visitor's worst outcome reported so far and it stays there.
    h.api.showToast('NOT deleted: rate limited.', { type: 'error', sticky: true });
    assert.deepStrictEqual(h.freqs(), [392.0, 311.13, 784.0],
      'an error that does not dismiss itself must not be delivered silently');
  });

  test('a sticky warning sounds too — it also stays', () => {
    h.gesture();
    h.api.showToast('Skipped a.jpg — name already there.', { type: 'warning', sticky: true });
    assert.deepStrictEqual(h.freqs(), [1318.51, 1975.53],
      'a sticky warning is work that stopped, so it is not "in flight"');
  });

  test('a new notification cuts off the one still sounding', () => {
    h.gesture();
    h.api.playToastDing('success');
    // Every voice stops its own oscillators once to schedule them, so the
    // count includes the scheduling stops as well as the cut-offs.
    h.reset();
    h.api.playToastDing('error');
    // error's three oscillators are scheduled (3 stops) plus the previous
    // voice's three being cut short.
    assert.strictEqual(h.live.stops, 3 + 3,
      'replacing a message must replace its sound, or the old tone announces something the visitor can no longer see');
  });

  test('muting cuts off a tone that is mid-flight', () => {
    h.gesture();
    h.api.playToastDing('success');
    h.reset();
    h.api.setToastSound(false);
    assert.ok(h.live.stops >= 3,
      `muting during a tone must silence it now, not when it finishes on its own (got ${h.live.stops} stops)`);
  });

  test('writing a derived voice does not leak back to the caller', () => {
    h.gesture();
    const opts = { type: 'error' };
    h.api.showToast('Could not save.', opts);
    // The voice was derived, not asked for — so the caller's object must
    // come back exactly as it went in. An object carrying a sound it
    // never set would be a lie about its own contents, and any later
    // call reusing it would inherit a voice nobody chose for it.
    assert.ok(!('sound' in opts), `showToast wrote a voice onto the caller's options: ${opts.sound}`);
    assert.deepStrictEqual(opts, { type: 'error' }, 'the options must come back unmodified');

    // And that holds when the same object is reused for a different kind
    // of message: it must resolve from its new type, not from residue.
    h.reset();
    h.api.showToast('Saved.', Object.assign(opts, { type: 'success' }));
    assert.deepStrictEqual(h.freqs(), [1318.51, 1975.53],
      'the reused options must resolve from their new type, not inherit the error voice');
  });
});
