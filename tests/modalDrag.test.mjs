/* Dialogs can be dragged aside so the archive behind the scrim stays
 * readable while a box is open. The handle is the title the dialog already
 * names with aria-labelledby — the one part nobody needs to click, select
 * or type into — so no handle is bolted onto the markup.
 *
 * Three properties are load-bearing, and each one has a test that fails
 * without it:
 *   1. The title resolves by aria-labelledby, falling back to the first
 *      heading, so all seven dialogs are covered without a per-box edit.
 *   2. The offset is clamped to the viewport. Without the clamp a drag can
 *      push a box off the edge with no way to get it back, since the only
 *      other way out is Cancel — which is on the box.
 *   3. The offset is dropped when the box hides, whichever way it hides.
 *      It has to be, because the pop-in animation owns transform while it
 *      runs, and a box that reopened where it was last dropped would fight
 *      that animation.
 *
 * The suite runs the real text of wireModalDrag, sliced out of app.js and
 * given the DOM and pointer events it stands on. */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

/* Slice a top-level function out of app.js, skipping strings, template
   literals and comments so the slice does not stop early. */
const body = (name) => {
  // Match the declaration, not this test's own calls of it.
  const start = source.indexOf(`function ${name}(`);
  assert.notStrictEqual(start, -1, `${name} is missing from app.js`);
  const paren = source.indexOf('(', start);
  /* Find the end of the signature by balancing parens. The first `)` sits
     inside a call in the parameter list — read() reads
     Number.parseFloat(dialog.dataset.dragX) — so a plain indexOf stops in
     the wrong place, and the body's `{` follows the `)` that closes the
     parameter list. */
  let sigEnd = paren, pDepth = 0;
  for (; sigEnd < source.length; sigEnd++) {
    if (source[sigEnd] === '(') pDepth++;
    else if (source[sigEnd] === ')') {
      pDepth--;
      if (pDepth === 0) break;
    }
  }
  /* The body opens at the `)` of the parameter list, never at the `}` of
     read()'s return literal. */
  const open = source.indexOf('{', sigEnd);
  assert.notStrictEqual(open, -1, `${name} has no body`);
  let depth = 0, began = false;
  let mode = 'code';
  for (let i = open; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (mode === 'line-comment') { if (c === '\n') mode = 'code'; continue; }
    if (mode === 'block-comment') { if (c === '*' && next === '/') { mode = 'code'; i++; } continue; }
    if (mode === 'sq' || mode === 'dq') {
      if (c === '\\') { i++; continue; }
      if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"')) mode = 'code';
      continue;
    }
    if (mode === 'tpl') {
      if (c === '\\') { i++; continue; }
      if (c === '`') { mode = 'code'; continue; }
      if (c === '{') { depth++; began = true; }
      else if (c === '}') { depth--; if (began && depth === 0) return source.slice(start, i + 1); }
      continue;
    }
    if (c === '/' && next === '/') { mode = 'line-comment'; i++; continue; }
    if (c === '/' && next === '*') { mode = 'block-comment'; i++; continue; }
    if (c === "'") { mode = 'sq'; continue; }
    if (c === '"') { mode = 'dq'; continue; }
    if (c === '`') { mode = 'tpl'; continue; }
    if (c === '{') { depth++; began = true; }
    else if (c === '}') { depth--; if (began && depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`could not find the end of ${name}()`);
};

/* A dialog and the title it names. The rect is fixed so the drag maths can
   be checked against known numbers: a box at left 400, top 300. */
function makeDialog({ id, width = 400, height = 200, byTitleId = true, hasHeading = true }) {
  const classes = new Set();
  /* Pointer capture is what keeps a drag alive when the pointer leaves the
     title mid-sweep. The app wraps it in try/catch, so a capture that
     never happens would still pass every other test here — it is recorded
     so the suite can assert it was asked for. */
  const capture = [];
  const title = {
    id,
    listeners: {},
    capture,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      has: (c) => classes.has(c),
    },
    addEventListener: (type, fn) => { (title.listeners[type] = title.listeners[type] || []).push(fn); },
    setPointerCapture: (id) => { capture.push(id); },
    releasePointerCapture: (id) => { capture.push(id); },
  };
  /* The heading fallback is a separate node with its own listeners and its
     own class set — a copy of title's classList closure would put the drag
     marker on both. */
  const headingClasses = new Set();
  const heading = hasHeading
    ? {
        ...title,
        listeners: {},
        classList: {
          add: (c) => headingClasses.add(c),
          remove: (c) => headingClasses.delete(c),
          has: (c) => headingClasses.has(c),
        },
        addEventListener: (type, fn) => { (heading.listeners[type] = heading.listeners[type] || []).push(fn); },
      }
    : null;
  const dialogClasses = new Set();
  const dialog = {
    dataset: {},
    style: {},
    classList: {
      add: (c) => dialogClasses.add(c),
      remove: (c) => dialogClasses.delete(c),
      has: (c) => dialogClasses.has(c),
    },
    getAttribute: (n) => (n === 'aria-labelledby' && byTitleId ? id : null),
    querySelector: (sel) => (sel === 'h2, h3' ? heading : null),
    getBoundingClientRect: () => ({ left: 400, top: 300, width, height }),
  };
  return { dialog, dialogClasses, title, heading, classes, capture };
}

function harness(overlayCount = 1, box = {}) {
  const created = [];
  const observers = [];
  const MutationObserver = class {
    constructor(fn) { this.fn = fn; this.watch = []; observers.push(this); }
    observe(el, opts) { this.watch.push({ el, opts }); }
  };

  // document.getElementById resolves the aria-labelledby reference.
  const byId = new Map();
  const document = {
    getElementById: (id) => byId.get(id) || null,
    querySelectorAll: (sel) => (sel === '.modal-overlay' ? created.map((c) => c.overlay) : []),
  };

  const overlays = [];
  for (let i = 0; i < overlayCount; i++) {
    const made = makeDialog({ id: `dlg${i}`, ...box });
    byId.set(`dlg${i}`, made.title);
    const overlay = {
      hidden: true,
      querySelector: (sel) => (sel === '.modal' ? made.dialog : null),
    };
    created.push({ overlay, ...made });
    overlays.push({ overlay, ...made });
  }

  const window = { innerWidth: 1280, innerHeight: 800 };
  const ctx = { document, window, MutationObserver, Number, Math, String, Map, Array };
  vm.createContext(ctx);
  vm.runInContext(body('wireModalDrag'), ctx);
  vm.runInContext('wireModalDrag()', ctx);

  // A pointerdown/move/up as the browser would deliver it.
  const fire = (target, type, x, y, extra = {}) => {
    const ev = {
      type, clientX: x, clientY: y, button: 0, pointerType: 'mouse',
      pointerId: 1, preventDefault: () => { ev.defaultPrevented = true; },
      // Spread last: a caller-supplied pointerId or button must win over
      // these defaults, or the button/id tests silently assert nothing.
      ...extra,
    };
    for (const fn of target.listeners[type] || []) fn(ev);
    return ev;
  };
  return { overlays, fire, observers, byId };
}

describe('wireModalDrag', () => {
  test('is exported from app.js and wired into wireStaticEvents', () => {
    assert.match(source, /function wireModalDrag\(\)/);
    assert.match(source, /wireModalDrag\(\);/, 'wireStaticEvents never calls it');
  });

  test('resolves the handle by aria-labelledby, not by bolted-on markup', () => {
    const h = harness(1);
    // The drag class lands on the titled element the dialog names.
    assert.ok(h.overlays[0].title.classList.has('modal-drag-handle'));
  });

  test('falls back to the first heading when there is no aria-labelledby', () => {
    const h = harness(1, { byTitleId: false });
    const { heading, title } = h.overlays[0];
    assert.ok(heading, 'the fallback heading should have been wired');
    // The heading is the handle, and the named-by-id path was not used.
    assert.ok(heading.classList.has('modal-drag-handle'));
    assert.ok(!title.classList.has('modal-drag-handle'));
  });

  test('moves the box by the pointer delta', () => {
    const h = harness(1);
    const { title, dialog } = h.overlays[0];
    h.fire(title, 'pointerdown', 600, 350);
    h.fire(title, 'pointermove', 700, 400);
    // Start at 600,350; move to 700,400 → +100,+50 from no prior offset.
    assert.strictEqual(dialog.style.transform, 'translate(100px, 50px)');
  });

  test('clamps to the viewport so a box cannot be pushed off screen', () => {
    const h = harness(1);
    const { title, dialog } = h.overlays[0];
    h.fire(title, 'pointerdown', 600, 350);
    h.fire(title, 'pointermove', 4000, 4000);
    /* Far past the bottom-right corner, so the clamp does the work. The
       bound is vw - w - MARGIN less where the box started, which is 1280
       - 400 - 24 - 400 = 456. That the press sat 200 inside the box's
       edge is already in nx, and the clamp cancelling it back out is why
       the box ends up flush with the margin rather than where the pointer
       left it. Without the clamp the box would be gone, and the only way
       back is Cancel — on the box. */
    assert.strictEqual(dialog.style.transform, 'translate(456px, 276px)');
  });

  test('clamps to the top-left too, not just the far edge', () => {
    const h = harness(1);
    const { title, dialog } = h.overlays[0];
    h.fire(title, 'pointerdown', 600, 350);
    h.fire(title, 'pointermove', -4000, -4000);
    /* Same clamp against the near edge: MARGIN less where the box
       started, so 24 - 400 = -376. Both bounds are ordered before they are
       applied, because a box taller than the frame would cross them. */
    assert.strictEqual(dialog.style.transform, 'translate(-376px, -276px)');
  });

  test('keeps an offset across a second drag from where it was left', () => {
    const h = harness(1);
    const { title, dialog } = h.overlays[0];
    h.fire(title, 'pointerdown', 600, 350);
    h.fire(title, 'pointermove', 700, 400);
    h.fire(title, 'pointerup', 700, 400);
    // A second drag starts from the stored offset, not from zero, and has
    // to cross the same threshold again before the box will move.
    h.fire(title, 'pointerdown', 700, 400);
    h.fire(title, 'pointermove', 760, 400);
    assert.strictEqual(dialog.style.transform, 'translate(160px, 50px)');
  });

  test('takes pointer capture only once the drag is armed', () => {
    const h = harness(1);
    const { title, capture } = h.overlays[0];
    h.fire(title, 'pointerdown', 600, 350);
    // A press is not yet a drag, so nothing is captured — and nothing is
    // prevented either, which is what keeps the click listeners on the
    // title alive. Without capture the box would stop moving the moment
    // the pointer crossed the title's edge, which is most of a drag.
    assert.deepStrictEqual(capture, [], 'capture taken before the pointer moved');
    h.fire(title, 'pointermove', 700, 400);
    assert.deepStrictEqual(capture, [1]);
    h.fire(title, 'pointerup', 700, 400);
    assert.deepStrictEqual(capture, [1, 1], 'capture was never released');
  });

  test('a press that never moves is a click, not a drag', () => {
    const h = harness(1);
    const { title, dialog } = h.overlays[0];
    // The guided tour registers a click listener on whatever a step is
    // pointing at, and a visitor's first run points it at a dialog title.
    // Swallowing that click would stall the tour on its very first step,
    // so a press and release in the same place must not be prevented.
    const down = h.fire(title, 'pointerdown', 600, 350);
    const up = h.fire(title, 'pointerup', 600, 350);
    assert.ok(!down.defaultPrevented, 'pointerdown was prevented');
    assert.ok(!up.defaultPrevented, 'pointerup was prevented');
    assert.strictEqual(dialog.style.transform, undefined);
  });

  test('the first move arms the drag and cancels the click', () => {
    const h = harness(1);
    const { title } = h.overlays[0];
    h.fire(title, 'pointerdown', 600, 350);
    // Once the pointer has travelled, the release is no longer a click, so
    // cancelling it stops the tour stepping on a release that was a drag.
    const move = h.fire(title, 'pointermove', 706, 350);
    assert.ok(move.defaultPrevented, 'the arming move did not cancel the click');
    // A smaller nudge than the threshold is still a click.
    const h2 = harness(1);
    h2.fire(h2.overlays[0].title, 'pointerdown', 600, 350);
    const nudge = h2.fire(h2.overlays[0].title, 'pointermove', 602, 350);
    assert.ok(!nudge.defaultPrevented, 'a 2px wobble armed the drag');
  });

  test('ignores every button but the left one', () => {
    const h = harness(1);
    const { title, dialog } = h.overlays[0];
    h.fire(title, 'pointerdown', 600, 350, { button: 2 });
    h.fire(title, 'pointermove', 700, 400);
    assert.strictEqual(dialog.style.transform, undefined, 'right-drag moved the box');
  });

  test('ignores a pointer whose id the drag did not start on', () => {
    const h = harness(1);
    const { title, dialog } = h.overlays[0];
    h.fire(title, 'pointerdown', 600, 350, { pointerId: 1 });
    h.fire(title, 'pointermove', 700, 400, { pointerId: 9 });
    assert.strictEqual(dialog.style.transform, undefined);
  });

  test('drops the offset when the box hides', () => {
    const h = harness(1);
    const { title, dialog, overlay } = h.overlays[0];
    h.fire(title, 'pointerdown', 600, 350);
    h.fire(title, 'pointermove', 700, 400);
    assert.strictEqual(dialog.style.transform, 'translate(100px, 50px)');
    // Closing flips hidden, and the one observer over all overlays fires.
    overlay.hidden = true;
    for (const o of h.observers) o.fn(o.watch.map((w) => ({ target: w.el })));
    assert.strictEqual(dialog.style.transform, '', 'a closed box kept its offset');
    assert.strictEqual(dialog.dataset.dragX, undefined);
  });

  test('does not touch a box whose overlay merely becomes visible', () => {
    const h = harness(1);
    const { title, dialog, overlay } = h.overlays[0];
    h.fire(title, 'pointerdown', 600, 350);
    h.fire(title, 'pointermove', 700, 400);
    overlay.hidden = false;   // shown, not hidden
    for (const o of h.observers) o.fn(o.watch.map((w) => ({ target: w.el })));
    assert.strictEqual(dialog.style.transform, 'translate(100px, 50px)');
  });

  test('each dialog drags independently of its neighbours', () => {
    const h = harness(2);
    const [a, b] = h.overlays;
    h.fire(a.title, 'pointerdown', 600, 350);
    h.fire(a.title, 'pointermove', 650, 350);
    h.fire(a.title, 'pointerup', 650, 350);
    h.fire(b.title, 'pointerdown', 600, 350, { pointerId: 2 });
    h.fire(b.title, 'pointermove', 600, 500, { pointerId: 2 });
    assert.strictEqual(a.dialog.style.transform, 'translate(50px, 0px)');
    assert.strictEqual(b.dialog.style.transform, 'translate(0px, 150px)');
  });
});

describe('the dialogs it covers', () => {
  test('every .modal-overlay holds a .modal with a heading to drag by', () => {
    const overlays = [...html.matchAll(/<div class="modal-overlay"[^>]*id="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(overlays.length >= 7, `found ${overlays.length} modal overlays`);
    for (const id of overlays) {
      const at = html.indexOf(`id="${id}"`);
      const chunk = html.slice(at, html.indexOf('</div>\n', at));
      const labelled = /aria-labelledby="([^"]+)"/.exec(chunk);
      assert.ok(labelled, `${id} names no title`);
      // The named title must exist in the markup, or the drag has no handle.
      assert.ok(
        html.includes(`id="${labelled[1]}"`),
        `${id} points aria-labelledby at #${labelled[1]}, which does not exist`,
      );
    }
  });
});
