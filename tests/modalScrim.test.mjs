/* A click outside a dialog does not close it.

   The dialogs became draggable: grab a box's own title and it moves aside so
   the archive behind it can be read. That changes what a click outside MEANS.
   Before, clicking the gap around a box was a miss — nothing was under the
   pointer but the box you were already working in, or just off its edge. Now
   the natural next move after dragging a box aside is to click what the box
   was covering: a photo to open, a name to select. Closing the box on that
   click throws away the work the drag just did, and takes the typed field
   with it.

   Six of the seven .modal-overlay dialogs had a scrim handler shaped like

       el('X').addEventListener('click', e => { if (e.target.id === 'X') overlayClose('X'); });

   The seventh — the destructive-action confirm — never had one, so the
   behaviour was inconsistent before this too. All seven now agree: only a
   control INSIDE the box, Escape, or the back button closes it.

   The two overlays that still dismiss on a press outside are the ⋮ sheet and
   the eye-comfort popover. Neither is a .modal-overlay and neither holds typed
   input — they are transient pickers over the wall the user is pointing at,
   and pressing away from one IS the gesture. They are pinned below so a sweep
   that removes every backdrop handler fails here rather than in the browser.

   Everything except Escape can be read straight off the source, so there is no
   DOM to build: the rule is about which listeners exist and what they branch
   on, in all three shapes the rule could be broken with — a listener on the
   box itself, a branch on e.target.id, and a delegated listener at document
   level. Escape is the one part that has to actually run, so that handler is
   sliced out of app.js and exercised in a vm. */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

/** The ids of every .modal-overlay in the markup, in document order. */
const dialogs = [...html.matchAll(/<div class="modal-overlay" id="([^"]+)"/g)].map(m => m[1]);

/** The body of the arrow function registered by this call, as source text.
    Flat brace counting: no handler counted on puts a brace inside a string,
    a comment or a template literal (hoverGlow.test.mjs makes the same call
    about wireHoverGlow). */
const handlerBody = (call) => {
  const at = source.indexOf(call);
  assert.notStrictEqual(at, -1, `app.js no longer registers ${call}`);
  const arrow = at + call.lastIndexOf('e => {');   // the slice must begin at the arrow
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(arrow, i + 1);
    }
  }
  throw new Error(`unterminated handler for ${call}`);
};

/** The body of every listener registered on `document` for a press or a
    click — the delegated shape, where the handler decides from the target. */
const documentPressBodies = () => [...source.matchAll(
  /document\.addEventListener\('(click|pointerdown|pointerup|mousedown|mouseup|touchstart|touchend)'/g
)].map(m => {
  const open = source.indexOf('{', m.index);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(m.index, i + 1);
    }
  }
  throw new Error(`unterminated document listener for ${m[1]}`);
});

describe('a click outside a dialog', () => {
  test('lands on the seven dialogs the markup declares', () => {
    assert.deepEqual(dialogs, [
      'adminModalOverlay', 'newAlbumOverlay', 'uploadModalOverlay',
      'sortModalOverlay', 'confirmOverlay', 'settingsModalOverlay',
      'tagModalOverlay',
    ], 'a dialog was added, removed or renamed — bring this list with it');
  });

  test('closes none of them: the box itself carries no click listener', () => {
    for (const id of dialogs) {
      assert.ok(!source.includes(`el('${id}').addEventListener('click'`),
        `${id} listens for clicks on its own backdrop`);
    }
  });

  test('closes none of them: no branch asks whether the press landed on it', () => {
    for (const id of dialogs) {
      for (const cmp of [`target.id === '${id}'`, `target.id !== '${id}'`,
                         `target === el('${id}')`, `target === document.getElementById('${id}')`]) {
        assert.ok(!source.includes(cmp), `app.js still branches on ${cmp}`);
      }
    }
  });

  test('closes none of them: no delegated press listener touches a dialog', () => {
    const bodies = documentPressBodies();
    assert.ok(bodies.length >= 2,
      'the row-panel and search-panel outside-taps are expected here too');
    for (const body of bodies) {
      for (const id of dialogs) {
        assert.ok(!body.includes(id),
          `a document-level press handler names ${id} — a backdrop press must not reach a dialog`);
      }
    }
  });

  test('leaves every dialog a way out that is not the backdrop', () => {
    for (const id of dialogs) {
      assert.ok(source.includes(`overlayClose('${id}')`),
        `${id} can no longer be closed at all`);
    }
    // The button, not just the call: Escape is keyboard-only, so a pointer
    // user needs a control inside the box. One per dialog, wired to close.
    const cancels = ['tokenCancel', 'newAlbumCancel', 'uploadCancel', 'sortCancel',
                     'confirmCancel', 'settingsCancel', 'tagCancel'];
    assert.equal(cancels.length, dialogs.length, 'one cancel per dialog');
    for (const b of cancels) {
      assert.ok(new RegExp(`el\\('${b}'\\)\\.addEventListener\\('click'`).test(source),
        `${b} does not listen for a click`);
    }
    assert.ok(source.includes("el('tokenCancel').addEventListener('click', () => overlayClose('adminModalOverlay'))"));
    assert.ok(source.includes("el('tagCancel').addEventListener('click', () => overlayClose('tagModalOverlay'))"));
  });
});

/* ── The escape hatch, run for real ─────────────────────────────────────── */

/** The keydown handler as a callable function, with the four helpers it
    stands on supplied by the vm. */
const keydown = ({ stack = [], lightboxHidden = true } = {}) => {
  const closed = [];
  const ctx = vm.createContext({
    overlayStack: stack,
    overlayClose: (id) => closed.push(id),
    el: (id) => ({ hidden: id === 'lightbox' ? lightboxHidden : true }),
    closeLightbox: () => closed.push('lightbox'),
    lightboxStep: () => {},
    viewerDownload: null,
  });
  const fn = vm.runInContext('(' + handlerBody("document.addEventListener('keydown', e => {") + ')', ctx);
  return { fn, closed };
};

describe('Escape still closes whatever is on top', () => {
  test('pops the dialog off the stack', () => {
    const { fn, closed } = keydown({ stack: ['settingsModalOverlay'] });
    fn({ key: 'Escape' });
    assert.deepEqual(closed, ['settingsModalOverlay'],
      'removing the backdrop click took the keyboard hatch with it');
  });

  test('takes the top one, not the one underneath', () => {
    const { fn, closed } = keydown({ stack: ['settingsModalOverlay', 'confirmOverlay'] });
    fn({ key: 'Escape' });
    assert.deepEqual(closed, ['confirmOverlay']);
  });

  test('with nothing open, reaches the viewer instead', () => {
    const a = keydown({ stack: [], lightboxHidden: true });
    a.fn({ key: 'Escape' });
    assert.deepEqual(a.closed, [], 'nothing is open, so nothing closes');

    const b = keydown({ stack: [], lightboxHidden: false });
    b.fn({ key: 'Escape' });
    assert.deepEqual(b.closed, ['lightbox'], 'Escape with no dialog still leaves the viewer');
  });

  test('is Escape specifically — another key leaves the dialog open', () => {
    const { fn, closed } = keydown({ stack: ['settingsModalOverlay'], lightboxHidden: false });
    fn({ key: 'x' });
    fn({ key: 'Enter' });
    assert.deepEqual(closed, [], 'the dialog was closed by a key that is not Escape');
  });
});

/* ── The two overlays that are meant to keep dismissing ─────────────────── */

describe('the transient pickers keep their backdrop', () => {
  test('the ⋮ sheet and the eye-comfort popover still close on a press outside', () => {
    for (const id of ['sheetOverlay', 'comfortOverlay']) {
      assert.ok(source.includes(`if (e.target.id === '${id}') overlayClose('${id}')`),
        `the ${id} handler was swept up in the modal change — it is not a dialog`);
    }
  });

  test('neither of them is a .modal-overlay', () => {
    for (const id of ['sheetOverlay', 'comfortOverlay']) {
      assert.ok(!html.includes(`class="modal-overlay" id="${id}"`),
        `${id} became a dialog — move it into the rules above`);
    }
  });
});
