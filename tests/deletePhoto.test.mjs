/* A delete must never be silent, and a failed one must never read as done.

   Deleting is the most destructive action in the app and the only one
   with an Undo behind it, which makes an uninterpretable wait the worst
   place to have one. The swallow animation plays while the confirm dialog
   is still up, so by the time deleteImage() reaches its await the photo has
   been eaten and the dialog has closed — and the request may not be back
   yet. Measured against a 4s mock: dialog accepted at +5557ms, nothing on
   screen until +9473ms.

   The failure half had the same shape as classify's: a bare GitHub message
   on the ordinary 3.2s timer, in a UI where showToast() dismisses whatever
   is on screen before showing the next. "Must have admin rights to
   Repository." says nothing about whether the photo was removed, and can be
   replaced or expire before it is read. */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';

const APP = new URL('../app.js', import.meta.url);
const source = await readFile(APP, 'utf8');

/* Slice a top-level function out of app.js.

   Brace counting has to skip strings, template literals and comments, or
   it stops early: deleteImage() opens with an askConfirm({ ... }) call, and
   a naive counter treats that object literal as the function body and ends
   the slice there — which is why an earlier version of this helper found
   none of the code it was looking for. */
const body = (name) => {
  const start = source.indexOf(`function ${name}`);
  assert.notStrictEqual(start, -1, `${name} is missing from app.js`);
  // Start counting at the body's opening brace, not the first `{` after the
  // name: a default argument (`opts = {}`) closes before the body opens and
  // would end the slice at 53 characters.
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
      // A ${...} inside a template can hold real braces; count them so a
      // nested object literal does not unbalance the slice.
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

const deleteImage = body('deleteImage');

describe('A delete says it is deleting', () => {
  test('a pending message is shown before the request is awaited', () => {
    // One photo is one request, not a batch, so there is no progress bar
    // and nothing to divide — showPending still raises the orange
    // work-in-flight card, which is the whole job here.
    assert.match(deleteImage, /showPending\(\s*`Deleting /,
      'deleteImage must open with a pending toast once the dialog is accepted');
    // Not "before the first await" — askConfirm's own `await onAccept()` runs
    // the swallow animation while the dialog is still up, and that is by
    // design. What must not happen is the pending toast arriving after the
    // delete request has already been awaited, because then it announces
    // an outcome the visitor has been waiting for.
    const toastAt = deleteImage.indexOf('showPending(`Deleting');
    const requestAwait = deleteImage.indexOf('await request;');
    assert.ok(toastAt !== -1, 'no pending toast found');
    assert.ok(requestAwait !== -1, 'the request await is missing');
    assert.ok(toastAt < requestAwait,
      'the pending toast must precede `await request`, or it announces nothing');
  });

  test('the pending message cannot expire mid-request', () => {
    // showPending is sticky by construction — it is the call for work in
    // flight, and a timed card would be gone before a slow delete returns.
    assert.match(deleteImage, /showPending\(\s*`Deleting /);
    assert.doesNotMatch(deleteImage, /showToast\(\s*`Deleting /,
      'a plain showToast here would be timed, and would expire');
    const fn = source.slice(source.indexOf('function showPending'));
    assert.match(fn.slice(0, fn.indexOf('}')), /sticky: true/,
      'showPending must be sticky, or this whole claim is unfounded');
  });

  test('it is raised only after the visitor confirmed', () => {
    // A cancel must leave no trace: nothing may be announced before `ok`.
    const guardAt = deleteImage.indexOf('if (!ok || !request) return;');
    const toastAt = deleteImage.indexOf('showPending(`Deleting');
    assert.ok(guardAt !== -1 && toastAt > guardAt,
      'a cancelled delete must announce nothing at all');
  });

  test('the delete still offers Undo on success', () => {
    assert.match(deleteImage, /undo:\s*DEMO_MODE \? null : undoLastChange/,
      'the success path must keep its Undo');
  });
});

describe('A failed delete cannot be misread as a success', () => {
  const report = body('reportDeleteFailed');

  test('the failure goes through one reporter', () => {
    const calls = deleteImage.match(/reportDeleteFailed\(/g) || [];
    assert.strictEqual(calls.length, 1, 'the failure path must route through the reporter');
  });

  test('it says the photo was NOT deleted', () => {
    assert.match(report, /NOT deleted/,
      'a bare GitHub error says nothing about whether the photo was removed');
  });

  test('it carries the underlying reason', () => {
    // errWhy(err), not err.message directly: the reason still has to reach
    // the visitor, and it has to survive a rejection that carries no
    // message — an empty one would render no toast at all.
    assert.match(report, /NOT deleted: \$\{errWhy\(err\)\}/,
      'the GitHub reason must reach the visitor');
  });

  test('it is sticky, so it cannot be replaced or expire unread', () => {
    assert.match(report, /sticky:\s*true/,
      'a failed destructive action must stay until dismissed');
  });

  test('the photo is restored when the delete fails', () => {
    assert.match(deleteImage, /reportDeleteFailed\([^)]*\);[\s\S]*if \(opts\.restore\) opts\.restore\(\);/,
      'a failed delete must put the photo back on screen');
  });

  test('local state is only changed after the request succeeds', () => {
    // applyImageDelete before the await would remove the card from the wall
    // even if the commit failed.
    const applyAt = deleteImage.indexOf('applyImageDelete(path)');
    const awaitAt = deleteImage.indexOf('await request;');
    assert.ok(awaitAt !== -1 && applyAt > awaitAt,
      'the photo must stay in state until the repo has confirmed the delete');
  });
});