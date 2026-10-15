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

describe('A delete says nothing until it has actually happened', () => {
  test('no toast is raised before the request resolves', () => {
    // The rule the app now holds to: a toast is a report, and a report
    // cannot be made about something that has not happened yet. A message
    // shown before the write lands looks exactly like one shown after it,
    // and the two mean opposite things — which is how an admin ends up
    // believing a photo was deleted when it was not.
    assert.doesNotMatch(deleteImage, /showPending\(/,
      'nothing may announce the delete before it has happened');
    const toastAt = deleteImage.indexOf('showToast(');
    const requestAwait = deleteImage.indexOf('await request;');
    assert.ok(requestAwait !== -1, 'the request await is missing');
    assert.ok(toastAt !== -1, 'no toast found on the delete path');
    assert.ok(requestAwait < toastAt,
      'the toast must follow `await request`, or it reports a future');
  });

  test('the success toast carries Undo, so success is still distinguishable', () => {
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