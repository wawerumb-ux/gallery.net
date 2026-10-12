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

function harness() {
  const body = app.slice(app.indexOf(NOTIF_START), app.indexOf(NOTIF_END));
  assert.notStrictEqual(body.length > 0, false, 'the notification block moved');

  // The library creates its own container inside document.body, so the
  // root the tests inspect is that container, not document.body itself.
  const root = makeEl();
  const doc = {
    body: root,
    createElement: (tag) => makeEl(tag),
    // The wrapper looks its own live item up by [data-toast-id], and
    // decorateToast looks the body and the close button up by class. Both
    // have to resolve against the tree the library actually built.
    querySelector: (sel) => find(root, sel),
    querySelectorAll: (sel) => findAll(root, sel),
    addEventListener() {},
  };
  const raf = [];
  const sandbox = {
    console,
    document: doc,
    requestAnimationFrame: (fn) => { raf.push(fn); return raf.length; },
    cancelAnimationFrame() {},
    setTimeout: (fn, ms) => { setTimeout(fn, 0); return 0; },
    clearTimeout() {},
    localStorage: {
      _v: {},
      getItem(k) { return k in this._v ? this._v[k] : null; },
      setItem(k, v) { this._v[k] = String(v); },
    },
    /* Audio is decoration; the tests assert on what was attempted. */
    AudioContext: undefined,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(lib + '\n;globalThis.__toast = toast;', ctx, { filename: 'hcg-toast.js' });
  vm.runInContext(body + '\n;globalThis.__n = { showToast, showPending, dismissToast, setToastSound };',
    ctx, { filename: 'app-notifications.js' });
  const flushFrames = () => { const q = raf.splice(0); q.forEach(f => f()); };
  /* The library appends its container lazily, on first use, so until
     something is shown there is nothing to search. `container` resolves
     through the document each time rather than being captured once. */
  const container = () => {
    const c = find(root, '.hcg-toast-container');
    return c || root;
  };
  return { api: sandbox.__n, doc, container, flushFrames, storage: sandbox.localStorage };
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
