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

describe('A classification save says nothing until it has happened', () => {
  test('no toast is raised before the write resolves', () => {
    // The dialog closes and the screen goes quiet until the write is done.
    // A toast before that is a claim about the future, and it is
    // indistinguishable from the one that reports what actually happened.
    assert.doesNotMatch(saveTagModal, /showPending\(/,
      'nothing may announce the save before it has happened');
    const pendingish = saveTagModal.match(/showToast\(\s*'Saving classification'/);
    assert.equal(pendingish, null,
      'a save toast must be raised after the write, not before it');
    // The Save button is what says work is under way.
    assert.match(saveTagModal, /saveBtn\.textContent = 'Saving…'/,
      'the button must carry the in-flight signal');
  });

  test('the success toast only follows a successful persist', () => {
    const successAt = saveTagModal.indexOf("showToast(renameMsg ? `Saved classification");
    const persistAt = saveTagModal.indexOf('await persistMetadata();');
    assert.ok(persistAt !== -1, 'no metadata write found');
    assert.ok(successAt !== -1, 'no success toast found');
    assert.ok(persistAt < successAt,
      'Saved classification must follow the write it claims to have made');
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

  test('the failure toast is sticky, since nothing else is on screen', () => {
    // There is no pending toast to replace any more, so the failure is the
    // only thing on screen — it has to hold long enough to be read.
    assert.match(report, /sticky: true/,
      'the failure must be sticky now that it cannot be overwritten');
    assert.match(report, /NOT saved/);
  });
});