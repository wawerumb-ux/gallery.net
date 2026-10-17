/* A question asked from inside a dialog, and what the dialog does about it.

   Measured in a browser at 412 wide (headless, 726px of frame): tapping
   "Remove album" in Album settings left the settings card [24,93,364,540]
   painted exactly over the confirm [33,242,346,261] — document.elementFromPoint
   at the centre of the question returned #settingsModalOverlay. Both are
   .modal-overlay, both are z-index 120, and the settings is later in the
   document, so the later one won. The question was there the whole time:
   its Cancel held focus, so a stray Enter would have answered a dialog the
   user could not see.

   The rule now: when a question opens, the dialog that asked it steps out
   of the way. Hidden, not closed — its place in history and everything
   typed into it survive, so answering No puts it back untouched and backing
   out of the question lands on it rather than at the wall. Answering Yes
   leaves it hidden, because the caller closes it for real just past the
   await (removePhase does).

   The viewers and sheets are deliberately NOT stepped aside: the delete
   question is asked over the viewer on purpose, so the photo can be watched
   going into the bin. Only .modal-overlay dialogs step aside.

   askConfirm is not on the public surface (nothing outside the app calls
   it), so this suite runs the real text of the function — sliced out of
   app.js and given the four helpers it stands on — against stub overlays. */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const source = await read('../app.js');
const html = await read('../index.html');

/* Slice a top-level function out of app.js. Brace counting has to skip
   strings, template literals and comments, or it stops early — askConfirm
   opens with a defaulted destructured argument, and a naive counter ends
   the slice on the signature's own braces. */
const body = (name) => {
  const start = source.indexOf(`function ${name}`);
  assert.notStrictEqual(start, -1, `${name} is missing from app.js`);
  const paren = source.indexOf('(', start);
  let sigEnd = source.indexOf(')', paren);
  while (source[sigEnd - 1] === '(') sigEnd = source.indexOf(')', sigEnd + 1);
  let depth = 0, began = false;
  let mode = 'code';            // code | line-comment | block-comment | sq | dq | tpl
  for (let i = source.indexOf('{', sigEnd); i < source.length; i++) {
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

/* The overlays askConfirm needs: the stack, the two close helpers, the
   registry the close routine is kept in, and a dialog to ask from. */
const STUBS = `
  const document = { activeElement: null };
  const els = new Map();
  const mk = (id) => {
    const set = new Set();
    const node = {
      id, hidden: true, textContent: '', innerHTML: '', className: '',
      value: '', offsetWidth: 0, disabled: false,
      classList: {
        add: (c) => set.add(c), remove: (c) => set.delete(c),
        toggle: (c, on) => { if (on) set.add(c); else set.delete(c); },
        contains: (c) => set.has(c),
      },
      focus() { document.activeElement = node; },
    };
    els.set(id, node);
    return node;
  };
  const el = (id) => els.get(id) || mk(id);
  const overlayRegistry = {};
  const overlayStack = [];
  const GalleryNav = { current: null, push() {}, back() {} };
  let confirmPending = null;
  let confirmConfirm = null;
  let confirmBusy = false;
`;

function harness() {
  const ctx = vm.createContext({ console, setTimeout, clearTimeout });
  const code = STUBS
    + body('overlayPush') + '\n' + body('overlayHide') + '\n' + body('overlayClose') + '\n'
    + body('askConfirm') + '\n'
    + '({ el, overlayStack, overlayRegistry, overlayClose, askConfirm,'
    + '   pending: () => confirmConfirm });';
  const H = vm.runInContext(code, ctx);
  H.at = (expr) => vm.runInContext(expr, ctx);
  H.dialog = (id) => {
    const node = H.el(id);
    node.classList.add('modal-overlay');
    node.hidden = false;
    H.overlayStack.push(id);
    return node;
  };
  return H;
}

describe('a question asked from a dialog', () => {
  test('takes the screen: the dialog that asked it steps out of the way', async () => {
    const H = harness();
    const settings = H.dialog('settingsModalOverlay');
    const answer = H.askConfirm({ title: 'Remove "site-survey"?', body: 'scope', okLabel: 'Remove album' });
    assert.equal(settings.hidden, true, 'the settings dialog must not cover the question');
    assert.equal(H.el('confirmOverlay').hidden, false, 'the question is up');
    assert.equal(H.at('document.activeElement.id'), 'confirmCancel',
      'focus lands on the Cancel no longer painted over');
    assert.deepEqual(H.overlayStack, ['settingsModalOverlay', 'confirmOverlay'],
      'the question sits on top of the dialog, so Escape answers it first');
    assert.equal(H.el('confirmOk').textContent, 'Remove album');
  });

  test('No puts the dialog back, exactly where it was', async () => {
    const H = harness();
    const settings = H.dialog('settingsModalOverlay');
    const answer = H.askConfirm({ title: 't', body: 'b' });
    H.overlayClose('confirmOverlay');           // the Cancel button's own path
    assert.equal(await answer, false);
    assert.equal(settings.hidden, false, 'cancelling returns to the dialog that asked');
    assert.deepEqual(H.overlayStack, ['settingsModalOverlay'],
      'its place in the stack is untouched');
  });

  test('Yes leaves it hidden: the caller closes it for real', async () => {
    const H = harness();
    const settings = H.dialog('settingsModalOverlay');
    const answer = H.askConfirm({ title: 't', body: 'b' });
    await H.pending()();
    assert.equal(await answer, true);
    assert.equal(settings.hidden, true, 'accepting does not pop the dialog back into view');
  });

  test('a second question does not mistake the first for a dialog to hide', async () => {
    // The confirm overlay is itself a .modal-overlay, so "whatever is on top
    // of the stack" is no use on a second request. Without that guard the
    // second question would treat the first as its parent and, on No, set
    // hidden=false on the dialog it had just closed.
    const H = harness();
    H.dialog('settingsModalOverlay');
    H.askConfirm({ title: 'first', body: 'a' });      // cancels nothing; opens
    const second = H.askConfirm({ title: 'second', body: 'b' });
    H.overlayClose('confirmOverlay');
    assert.equal(await second, false);
    assert.equal(H.el('confirmOverlay').hidden, true, 'the question stays closed');
    assert.equal(H.el('settingsModalOverlay').hidden, false,
      'the first question had already handed the dialog back');
  });

  test('a dialog that is no longer on the stack is not resurrected', async () => {
    // Two back-presses in a row can unwind the dialog before the question's
    // own answer is read. Putting it back would leave a dialog on screen
    // that neither Escape nor back could reach.
    const H = harness();
    const settings = H.dialog('settingsModalOverlay');
    const answer = H.askConfirm({ title: 't', body: 'b' });
    H.overlayStack.length = 0;                  // the popstate path already unwound it
    H.overlayClose('confirmOverlay');
    assert.equal(await answer, false);
    assert.equal(settings.hidden, true, 'a closed dialog must stay closed');
  });

  test('the viewer is not a dialog: the photo stays visible to be eaten', async () => {
    const H = harness();
    // The viewer is z-index 95 and not a .modal-overlay; the delete question
    // is asked over it on purpose.
    const viewer = H.el('lightbox');
    viewer.classList.add('viewer');
    viewer.hidden = false;
    H.overlayStack.push('lightbox');
    const answer = H.askConfirm({ title: 'Delete this photo?', body: 'b' });
    assert.equal(viewer.hidden, false, 'the viewer must not step aside');
    H.overlayClose('confirmOverlay');
    assert.equal(await answer, false);
    assert.equal(viewer.hidden, false);
  });

  test('a hidden or unclassed overlay is never treated as a parent', async () => {
    const H = harness();
    const other = H.el('tagModalOverlay');
    other.hidden = true;                        // not on screen at all
    H.overlayStack.push('tagModalOverlay');
    const answer = H.askConfirm({ title: 't', body: 'b' });
    // Nothing to hide, so nothing is restored on the way out either.
    assert.equal(other.hidden, true);
    H.overlayClose('confirmOverlay');
    await answer;
  });
});

describe('the question itself reads as the last word', () => {
  // The confirm dialog's own markup, from its overlay to the next one.
  const dialog = html.slice(
    html.indexOf('id="confirmOverlay"'), html.indexOf('id="settingsModalOverlay"'));

  test('Cancel and the destructive verb are the card’s last block, in that order', () => {
    const copy = dialog.indexOf('id="confirmBody"');
    const buttons = [...dialog.matchAll(/<button[^>]*\bid="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(buttons, ['confirmCancel', 'confirmOk'],
      'the scope line comes first; the two answers are the only controls, in order');
    assert.ok(copy !== -1 && copy < dialog.indexOf('id="confirmCancel"'),
      'the scope is read before the verb');
    // Nothing follows the pair inside the card: they are the foot of it, so
    // "at the bottom" is where the eye already is when the question lands.
    const tail = dialog.slice(dialog.indexOf('</button>', dialog.indexOf('id="confirmOk"')));
    assert.doesNotMatch(tail, /<(button|input|select|textarea)/,
      'no control follows the two answers');
  });

  test('only Cancel carries a tour target; no step may accept', () => {
    const cancelTag = /<button[^>]*id="confirmCancel"[^>]*>/.exec(dialog)[0];
    assert.match(cancelTag, /data-tour-target="confirm-cancel"/,
      'cancelling is the step that carries the walk on');
    const okTag = /<button[^>]*id="confirmOk"[^>]*>/.exec(dialog)[0];
    assert.doesNotMatch(okTag, /data-tour-target/,
      'a step targeting the accept button would delete a photo, an album, or the gallery');
  });
});
