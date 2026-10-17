/* The selection gesture has two front doors — a long-press on touch and a
   right-click with a mouse — and they have to agree on what happens when one
   device fires BOTH for a single gesture.

   Android does exactly that. A long-press on a tile arms the touchstart timer
   AND, because nothing suppresses the default, the browser then fires
   contextmenu for the same press. Both handlers run. The first opens
   selection with the photo picked; the second sees selection is already on
   and toggles that same photo back off.

   The result on an Android phone is the worst kind of wrong: selection mode
   opens, the Move/Delete bar appears, and the photo the admin held their
   finger on is not in it. Nothing errors, and the gesture looks like it did
   nothing at all. Desktop is unaffected — a mouse has no long-press, so only
   the contextmenu door runs — which is exactly why this survives a
   desktop-only test run.

   The wiring is sliced out of app.js whole, because the bug is in the
   ordering of two listeners and a paraphrase of that ordering would not be
   the thing under test. Everything the wiring reaches is either sliced too
   (state, enterSelectMode, toggleBatchSelect, cardsForPath, attrSel) or
   stubbed at a seam that cannot affect the outcome (render, diagTap, the
   chrome sync, the vibrate). */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

/* Take a named top-level function out of the real source, whole. */
const fn = (name) => {
  const at = app.search(new RegExp(`^(?:async )?function ${name}\\b`, 'm'));
  assert.notStrictEqual(at, -1, `no function ${name} in app.js`);
  let d = 0;
  for (let k = app.indexOf('{', at); k < app.length; k++) {
    if (app[k] === '{') d++;
    else if (app[k] === '}') { d--; if (!d) return app.slice(at, k + 1); }
  }
  throw new Error(`unterminated ${name}`);
};

const constBlock = (name) => {
  const at = app.search(new RegExp(`^const ${name}\\b`, 'm'));
  assert.notStrictEqual(at, -1, `no const ${name}`);
  return app.slice(at, app.indexOf('\n', app.indexOf(';', at)));
};

function boot({ adminMode = true } = {}) {
  /* Timers under test control: a long-press is a timeout, and a real one
     would have to be waited for. */
  const timers = [];
  let nextTimer = 0;
  let now = 1000;
  const advance = (ms) => {
    now += ms;
    for (let i = timers.length - 1; i >= 0; i--) {
      if (timers[i].at <= now) { const t = timers[i].timer; timers.splice(i, 1); t(); }
    }
  };

  /* The card is a real listener bag, not a DOM. The wiring only ever calls
     addEventListener on it and reads dataset.path off it. */
  const fig = {
    dataset: { path: 'images/cable-pull/20260714_170024.jpg' },
    handlers: {},
    addEventListener(type, fn_, opts) { (this.handlers[type] ||= []).push(fn_); },
    fire(type, props = {}) {
      const e = { type, preventDefault() { e.defaultPrevented = true; },
        defaultPrevented: false, ...props };
      (this.handlers[type] || []).forEach(h => h(e));
      return e;
    },
  };

  const stubEl = () => ({ hidden: false, textContent: '', disabled: false,
    classList: { toggle() {}, add() {}, remove() {} } });
  const doc = {
    getElementById: stubEl,
    querySelectorAll: () => [],
    body: { classList: { toggle() {} } },
  };

  const sandbox = {
    console,
    document: doc,
    navigator: { vibrate() { sandbox.vibrated = true; } },
    Date: { now: () => now },
    setTimeout: (fn_, ms) => { const id = ++nextTimer; timers.push({ id, at: now + ms, timer: fn_ }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    // Seams the wiring reaches but that cannot change what got selected.
    setView() {},
    render() {},
    diagTap() {},
    syncChromeH() {},
  };
  sandbox.fig = fig;
  sandbox.el = stubEl;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);

  const stateAt = app.indexOf('const state = {');
  const stateBlock = app.slice(stateAt, app.indexOf('\n};', stateAt) + 3);

  vm.runInContext([
    constBlock('LONG_PRESS_MS'),
    constBlock('CLICK_SUPPRESS_MS'),
    constBlock('HAPTIC_MS'),
    stateBlock,
    fn('attrSel'),
    fn('cardsForPath'),
    fn('enterSelectMode'),
    fn('toggleBatchSelect'),
    fn('updateSelectBar'),
    fn('wireLongPress'),
    'wireLongPress(fig);',
    'globalThis.__state = state;',
  ].join('\n'), ctx, { filename: 'app-selection-slice.js' });

  const st = sandbox.__state;
  st.adminMode = adminMode;
  st.batchSelect = false;
  st.batchSelected = new Set();

  /* The touch payload a real long-press produces: one finger, still. */
  const hold = () => fig.fire('touchstart',
    { touches: [{ clientX: 40, clientY: 40 }] });
  const release = () => { fig.fire('touchend', {}); };
  const rightClick = () => fig.fire('contextmenu', {});

  return { fig, st, advance, hold, release, rightClick, sandbox };
}

describe('The selection gesture, whichever door it arrives through', () => {
  test('a mouse right-click picks the photo under the cursor', () => {
    const { st, rightClick } = boot();
    rightClick();
    assert.equal(st.batchSelect, true, 'right-click opens selection');
    assert.equal(st.batchSelected.size, 1, 'with the photo that was clicked');
  });

  test('a touch long-press picks the photo that was held', () => {
    const { st, hold, advance } = boot();
    hold();
    advance(600);
    assert.equal(st.batchSelect, true, 'the hold opens selection');
    assert.equal(st.batchSelected.size, 1, 'with the photo that was held');
  });

  test('releasing before the hold matures selects nothing', () => {
    const { st, hold, advance, release } = boot();
    hold();
    advance(200);
    release();
    advance(600);
    assert.equal(st.batchSelect, false, 'a tap is not a long-press');
    assert.equal(st.batchSelected.size, 0);
  });

  test('a long-press that ALSO fires contextmenu still ends up picked', () => {
    // Android fires both for one press. The timer runs first (480ms here,
    // the platform's own menu later), so the contextmenu lands on a photo
    // that is already selected and would toggle it back off.
    const { st, hold, advance, rightClick } = boot();
    hold();
    advance(600);
    rightClick();

    assert.equal(st.batchSelect, true, 'selection is open');
    assert.equal(st.batchSelected.size, 1,
      'and the photo the admin actually held is still in it — the contextmenu '
      + 'from that same press must not toggle it back off');
  });

  test('the long-press still vibrates on Android, where contextmenu follows', () => {
    const { sandbox, hold, advance, rightClick } = boot();
    hold();
    advance(600);
    rightClick();
    assert.equal(sandbox.vibrated, true,
      'the haptic that confirms the selection must not be lost to the fix');
  });

  test('a right-click after the touch is over is still a right-click', () => {
    // Hybrid laptops and tablets with a trackpad: the suppression must be
    // scoped to the press that caused it, not blanket the gesture for ever.
    // The long-press left this card picked, so the later right-click must
    // un-pick it — that it changed anything at all is the assertion.
    const { st, hold, advance, release, rightClick } = boot();
    hold();
    advance(600);
    release();
    assert.equal(st.batchSelected.size, 1, 'the hold picked it');
    advance(2000);   // well past the long-press window
    rightClick();
    assert.equal(st.batchSelected.size, 0,
      'a deliberate right-click later must toggle, not be swallowed');
  });

  test('a visitor gets nothing from either door', () => {
    for (const door of ['touch', 'click']) {
      const { st, hold, advance, rightClick } = boot({ adminMode: false });
      if (door === 'touch') { hold(); advance(600); } else { rightClick(); }
      assert.equal(st.batchSelect, false, `${door} must not open selection for a visitor`);
      assert.equal(st.batchSelected.size, 0);
    }
  });
});
