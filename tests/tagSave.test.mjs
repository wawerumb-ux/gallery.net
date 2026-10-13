/* A classification save must never be silent, and must never write twice.

   Reported as "classify either takes long or fails with no toast". Both
   were true of the same code: saveTagModal() closed its dialog and then
   awaited the write with nothing on screen. Every other admin action
   opens with a progress toast — 'Uploading 0/N…', 'Moving 0/N…' — and
   classify was the only one that did not. A GitHub Contents PUT is a tree
   read, a blob write and a commit; with githubFetch's 10s timeout and
   three attempts, a stalling one can sit there for half a minute.

   The failure half is worse: the error was an ordinary 3.2s toast, and
   showToast() dismisses whatever is on screen before showing the next
   message, so the failure could be replaced — or simply expire — before
   the visitor had read it. */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const APP = new URL('../app.js', import.meta.url);
const source = await readFile(APP, 'utf8');

/* The save path is read out of app.js rather than executed: it is a long
   function whose collaborators (overlayClose, render, loadTree, the toast
   library) are all bound to the live page, and what is under test is the
   ordering — a pending message before the first await, a sticky message
   on failure, and a guard against re-entry. */
const body = (name) => {
  const start = source.indexOf(`function ${name}`);
  assert.notStrictEqual(start, -1, `${name} is missing from app.js`);
  let depth = 0, i = source.indexOf('{', start), began = false;
  for (; i < source.length; i++) {
    if (source[i] === '{') { depth++; began = true; }
    else if (source[i] === '}') { depth--; if (began && depth === 0) break; }
  }
  return source.slice(start, i + 1);
};

const saveTagModal = body('saveTagModal');

describe('A classification save says what it is doing', () => {
  test('a pending message is shown before the first network await', () => {
    // showPending, not showToast: one photo is one write, so the bar has
    // no count to divide and sweeps instead — but the card is still
    // orange and still says what the app is doing.
    assert.match(saveTagModal, /showPending\(\s*'Saving classification'/,
      'saveTagModal must open with a pending toast');
    // The point is that it comes before any `await`, not merely that the
    // string exists: a pending toast raised after the write has already
    // happened is exactly the silence this is fixing.
    const toastAt = saveTagModal.indexOf("showPending('Saving classification'");
    const firstAwait = saveTagModal.indexOf('await ');
    assert.ok(toastAt !== -1, 'no pending toast found');
    assert.ok(firstAwait !== -1, 'saveTagModal has no await to order against');
    assert.ok(toastAt < firstAwait,
      'the pending toast must precede the first await, or it announces nothing');
  });

  test('the pending message cannot expire mid-write', () => {
    // showPending is sticky by construction — it is the call for work in
    // flight. A timed card would be gone before a slow write returns.
    assert.doesNotMatch(saveTagModal, /showToast\(\s*'Saving classification'/,
      'a plain showToast here would be timed, and would expire mid-write');
    const fn = source.slice(source.indexOf('function showPending'));
    assert.match(fn.slice(0, fn.indexOf('}')), /sticky: true/,
      'showPending must be sticky, or this whole claim is unfounded');
  });

  test('a re-entrant save is refused', () => {
    assert.match(source, /let tagSaving = false/,
      'the in-flight guard variable is missing');
    assert.match(saveTagModal, /if \(tagSaving\) return;/,
      'a second press on Save must be refused while a write is in flight');
    // The flag has to be cleared on every exit, including a throw, or the
    // next classify in the session would be permanently dead.
    assert.match(saveTagModal, /finally\s*\{[\s\S]*tagSaving = false/,
      'tagSaving must be released in a finally, or a failed save wedges the button');
  });

  test('the Save button reflects the in-flight state', () => {
    assert.match(saveTagModal, /saveBtn\.disabled = true/,
      'Save must be disabled while writing');
    assert.match(saveTagModal, /saveBtn\.disabled = false/,
      'Save must be re-enabled afterwards');
    // A save that throws must not leave the next dialog's button dead.
    assert.match(body('openTagModal'), /saveBtn\.disabled = false/,
      'openTagModal must re-arm Save — a thrown save would otherwise wedge it');
  });
});

describe('A failed classification save cannot be missed', () => {
  const report = body('reportTagSaveFailed');

  test('both failure paths go through the one reporter', () => {
    const calls = saveTagModal.match(/reportTagSaveFailed\(/g) || [];
    /* Four sites, in saveTagModal: the rename branch, the ordinary one, and
       two in album creation — the move itself and the metadata write that
       follows it. A fifth path added later without the reporter is the
       regression this pins; it would show up as a count above four.

       Both album paths are here for the same reason as the other two. If the
       put or the delete fails, the photo is still where it was and the album
       does not exist; if the album lands but its classification cannot be
       saved, the photo is in an album nothing can describe. Reporting either
       as a success would be the worst outcome available. */
    assert.strictEqual(calls.length, 4,
      'every failure path must route through reportTagSaveFailed');
    // And no bare showToast of an error can slip in beside it.
    assert.doesNotMatch(saveTagModal, /showToast\([^)]*NOT saved/,
      'the failure message must come from the reporter, not an inline toast');
  });

  test('the failure message is sticky', () => {
    assert.match(report, /sticky:\s*true/,
      'a failed write must stay until dismissed, not expire in 3.2s');
  });

  test('it says the classification was NOT saved', () => {
    assert.match(report, /NOT saved/,
      'the message must not read as success in any part of its wording');
  });

  test('it carries the underlying reason', () => {
    // errWhy(err), not err.message directly: the reason still has to reach
    // the visitor, and it has to survive a rejection that carries no
    // message — an empty one would render no toast at all.
    assert.match(report, /NOT saved: \$\{errWhy\(err\)\}/,
      'the GitHub error must reach the visitor, not just "it failed"');
  });

  test('the pending toast is replaced rather than left to expire', () => {
    assert.match(report, /dismissToast\(\)/,
      'the pending message must be cleared in place so there is no gap');
  });
});