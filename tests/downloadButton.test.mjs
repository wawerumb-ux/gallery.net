import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const oneuiSrc = fs.readFileSync(join(here, '..', 'oneui.js'), 'utf8');
const dlbSrc = fs.readFileSync(join(here, '..', 'download-button.js'), 'utf8');

/* Rich-enough element stub for the component's DOM surface:
   attributes, classList, style custom properties, listeners, children. */
function makeEl(tag) {
  const el = {
    tag,
    children: [],
    attrs: {},
    listeners: {},
    styleProps: {},
    classSet: new Set(),
    textContent: '',
    rel: '',
    _className: '',
    set className(v) {
      el._className = v;
      el.classSet = new Set(v.split(/\s+/).filter(Boolean));
    },
    get className() { return el._className; },
    set innerHTML(v) { el._innerHTML = v; },
    get innerHTML() { return el._innerHTML || ''; },
    classList: {
      add: (...cs) => cs.forEach(c => el.classSet.add(c)),
      remove: (...cs) => cs.forEach(c => el.classSet.delete(c)),
      contains: (c) => el.classSet.has(c),
      toggle: (c, on) => { (on ?? !el.classSet.has(c)) ? el.classSet.add(c) : el.classSet.delete(c); },
    },
    style: { setProperty: (k, v) => { el.styleProps[k] = v; } },
    setAttribute: (k, v) => { el.attrs[k] = String(v); },
    getAttribute: (k) => (k in el.attrs ? el.attrs[k] : null),
    hasAttribute: (k) => k in el.attrs,
    addEventListener: (type, fn) => { (el.listeners[type] = el.listeners[type] || []).push(fn); },
    appendChild: (c) => { el.children.push(c); return c; },
    remove: () => { el.removed = true; },
    click: () => { el.clicked = true; },
    querySelector: () => makeEl('span'), // the label span
    dispatch: (type, event = {}) => {
      (el.listeners[type] || []).forEach(fn => fn({
        preventDefault: () => { event.defaultPrevented = true; },
        ...event,
      }));
    },
  };
  return el;
}

function setup({ reducedMotion = false, multiplierPatch = null } = {}) {
  const timers = [];
  const fetchCalls = [];
  const clicks = [];
  let fetchImpl = async () => ({ ok: true, status: 200, blob: async () => ({}) });

  const sandbox = {
    console,
    window: {
      matchMedia: () => ({ matches: reducedMotion, addEventListener() {} }),
    },
    document: {
      createElement: (tag) => makeEl(tag),
      body: { appendChild: (c) => { clicks.push(c); return c; } },
    },
    fetch: async (...args) => { fetchCalls.push(args[0]); return fetchImpl(...args); },
    URL: {
      createObjectURL: () => 'blob:mock',
      revokeObjectURL: () => {},
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
  };
  sandbox.globalThis = sandbox;
  const src = multiplierPatch
    ? oneuiSrc.replace('SPEED_MULTIPLIER = 1.25', `SPEED_MULTIPLIER = ${multiplierPatch}`) + '\n' + dlbSrc
    : oneuiSrc + '\n' + dlbSrc;
  const expose = '\n;globalThis.__X = { createDownloadButton, D, SPEED_MULTIPLIER };';
  vm.runInContext(src + expose, vm.createContext(sandbox), { filename: 'download-button.js' });

  return {
    X: sandbox.__X,
    timers,
    fetchCalls,
    clicks,
    setFetch: (fn) => { fetchImpl = fn; },
    /* Run every timer scheduled at or below `ms`, oldest first. */
    advance: (ms) => {
      const due = timers.filter(t => t.ms <= ms).sort((a, b) => a.ms - b.ms);
      due.forEach(t => { timers.splice(timers.indexOf(t), 1); t.fn(); });
      return due.length;
    },
    flush: () => new Promise(r => setImmediate(r)),
  };
}

const baseProps = () => ({
  href: 'https://example.com/images/photo.jpg',
  filename: 'photo.jpg',
  label: 'Download',
});

describe('B1 — the speed multiplier is exactly 1.25 and every duration derives from it', () => {
  test('constant value and derived D', () => {
    const { X } = setup();
    assert.equal(X.SPEED_MULTIPLIER, 1.25);
    assert.equal(X.D.short, 125);
    assert.equal(X.D.base, 375);
    assert.equal(X.D.long, 625);
  });
  test('durations ride the element as custom properties derived from D', () => {
    const { X } = setup();
    const btn = X.createDownloadButton(baseProps());
    assert.equal(btn.el.styleProps['--dlb-short'], '125ms');
    assert.equal(btn.el.styleProps['--dlb-base'], '375ms');
    assert.equal(btn.el.styleProps['--dlb-long'], '625ms');
    assert.equal(btn.el.styleProps['--dlb-ease'], 'cubic-bezier(0.22, 0.25, 0.00, 1.00)');
  });
  test('patching the multiplier to 2.0 slows every scheduled timing proportionally', () => {
    const { X, timers } = setup({ multiplierPatch: 2.0 });
    assert.equal(X.D.short, 200);
    assert.equal(X.D.base, 600);
    assert.equal(X.D.long, 1000);
    const btn = X.createDownloadButton(baseProps());
    btn.el.dispatch('click');
    const delays = timers.map(t => t.ms).sort((a, b) => a - b);
    assert.deepEqual(delays, [400, 1000]); // D.long-D.base, D.long at ×2.0
  });
});

describe('B2 — rendering contract', () => {
  test('renders an anchor with href, download attribute, label, variant', () => {
    const { X } = setup();
    const btn = X.createDownloadButton(baseProps());
    assert.equal(btn.el.tag, 'a');
    assert.equal(btn.el.attrs.href, undefined); // href is a property, not an attribute
    assert.equal(btn.el.href, 'https://example.com/images/photo.jpg');
    assert.equal(btn.el.getAttribute('download'), 'photo.jpg');
    assert.equal(btn.el.classList.contains('dlb'), true);
    assert.equal(btn.el.classList.contains('dlb-primary'), true);
    assert.equal(btn.el._innerHTML.includes('dlb-tray'), true);
    assert.equal(btn.el._innerHTML.includes('dlb-arrow-wrap'), true);
    assert.equal(btn.el._innerHTML.includes('dlb-check'), true);
  });
  test('ghost variant and className are applied', () => {
    const { X } = setup();
    const btn = X.createDownloadButton({ ...baseProps(), variant: 'ghost', className: 'dlb-viewer' });
    assert.equal(btn.el.classList.contains('dlb-ghost'), true);
    assert.equal(btn.el.classList.contains('dlb-viewer'), true);
  });
  test('missing filename yields an empty download attribute', () => {
    const { X } = setup();
    const props = baseProps(); delete props.filename;
    const btn = X.createDownloadButton(props);
    assert.equal(btn.el.getAttribute('download'), '');
  });
});

describe('B3 — activation sequence with D-derived timings', () => {
  test('click: preventDefault, onDownloadStart, dip now, return at D.long-D.base, fetch at D.long', async () => {
    const { X, timers, fetchCalls, advance, flush } = setup();
    let started = 0;
    const btn = X.createDownloadButton({ ...baseProps(), onDownloadStart: () => started++ });
    btn.el.dispatch('click');
    assert.equal(started, 1);
    assert.equal(btn.el.classList.contains('is-active'), true);
    assert.deepEqual(timers.map(t => t.ms).sort((a, b) => a - b), [250, 625]);
    advance(250);
    assert.equal(btn.el.classList.contains('is-active'), false);
    assert.equal(fetchCalls.length, 0);
    advance(625);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0], 'https://example.com/images/photo.jpg');
    await flush();
  });

  test('success on complete: objectURL saved via a download anchor, is-success holds D.long, then resets', async () => {
    const { X, clicks, advance, flush } = setup();
    let completed = 0;
    const btn = X.createDownloadButton({ ...baseProps(), onDownloadComplete: () => completed++ });
    btn.el.dispatch('click');
    advance(625);
    await flush(); await flush();
    assert.equal(completed, 1);
    assert.equal(btn.el.classList.contains('is-success'), true);
    // the save anchor: appended to body, clicked, removed, carries download name
    assert.equal(clicks.length, 1);
    assert.equal(clicks[0].clicked, true);
    assert.equal(clicks[0].removed, true);
    assert.equal(clicks[0].getAttribute('download'), 'photo.jpg');
    assert.equal(clicks[0].href, 'blob:mock');
    advance(625);
    assert.equal(btn.el.classList.contains('is-success'), false);
    // busy released: a second activation runs a second fetch
    btn.el.dispatch('click');
    advance(625);
    await flush();
  });

  test('rapid double-click while busy never downloads twice', async () => {
    const { X, fetchCalls, advance, flush } = setup();
    const btn = X.createDownloadButton(baseProps());
    btn.el.dispatch('click');
    btn.el.dispatch('click');
    btn.el.dispatch('click');
    advance(625);
    await flush(); await flush();
    assert.equal(fetchCalls.length, 1);
  });

  test('error: muted error state, success is never played, onDownloadComplete not called', async () => {
    const { X, setFetch, advance, flush } = setup();
    let completed = 0;
    setFetch(async () => { throw new Error('offline'); });
    const btn = X.createDownloadButton({ ...baseProps(), onDownloadComplete: () => completed++ });
    btn.el.dispatch('click');
    advance(625);
    await flush(); await flush();
    assert.equal(btn.el.classList.contains('is-error'), true);
    assert.equal(btn.el.classList.contains('is-success'), false);
    assert.equal(completed, 0);
    advance(625);
    assert.equal(btn.el.classList.contains('is-error'), false);
  });

  test('HTTP error status is an error, not a success', async () => {
    const { X, setFetch, advance, flush } = setup();
    setFetch(async () => ({ ok: false, status: 404, blob: async () => ({}) }));
    const btn = X.createDownloadButton(baseProps());
    btn.el.dispatch('click');
    advance(625);
    await flush(); await flush();
    assert.equal(btn.el.classList.contains('is-error'), true);
    assert.equal(btn.el.classList.contains('is-success'), false);
  });
});

describe('B4 — reduced motion: zero animation, instant success', () => {
  test('no phase timers, no is-active, fetch starts immediately', async () => {
    const { X, timers, fetchCalls, flush } = setup({ reducedMotion: true });
    const btn = X.createDownloadButton(baseProps());
    btn.el.dispatch('click');
    assert.equal(btn.el.classList.contains('is-active'), false);
    assert.equal(timers.length, 0); // nothing scheduled before the fetch resolves
    assert.equal(fetchCalls.length, 1);
    await flush(); await flush();
    assert.equal(btn.el.classList.contains('is-success'), true);
  });
});

describe('B5 — keyboard and programmatic activation', () => {
  test('Space activates', () => {
    const { X, timers } = setup();
    const btn = X.createDownloadButton(baseProps());
    btn.el.dispatch('keydown', { key: ' ' });
    assert.equal(btn.el.classList.contains('is-active'), true);
    assert.deepEqual(timers.map(t => t.ms).sort((a, b) => a - b), [250, 625]);
  });
  test('Enter relies on native anchor behavior: the element is a real link', () => {
    const { X } = setup();
    const btn = X.createDownloadButton(baseProps());
    assert.equal(btn.el.tag, 'a');
    assert.equal(typeof btn.el.href, 'string');
  });
  test('programmatic activate() (file ready / keyboard shortcut)', () => {
    const { X, fetchCalls, advance, flush } = setup();
    const btn = X.createDownloadButton(baseProps());
    btn.activate();
    advance(625);
    assert.equal(fetchCalls.length, 1);
    return flush();
  });
});

describe('B6 — setFile update handle', () => {
  test('updates href and download attribute for the next file', () => {
    const { X } = setup();
    const btn = X.createDownloadButton(baseProps());
    btn.setFile({ href: 'https://example.com/images/next.jpg', filename: 'next.jpg' });
    assert.equal(btn.el.href, 'https://example.com/images/next.jpg');
    assert.equal(btn.el.getAttribute('download'), 'next.jpg');
  });
  test('the next activation downloads the updated file', async () => {
    const { X, fetchCalls, advance, flush } = setup();
    const btn = X.createDownloadButton(baseProps());
    btn.setFile({ href: 'https://example.com/images/next.jpg', filename: 'next.jpg' });
    btn.el.dispatch('click');
    advance(625);
    await flush();
    assert.equal(fetchCalls[0], 'https://example.com/images/next.jpg');
  });
});
