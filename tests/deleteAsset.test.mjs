/* A deleted photo must stay deleted.

   A photo in this repo is usually three files — the original plus its
   `-480` / `-800` webp variants — and buildAssets() collapses them into
   ONE card. That collapsing is what made the single-photo delete
   dangerous: it removed the one file the visitor tapped and left the
   variants in the repo. Because the variants still share the asset's base
   name and folder, the next tree load grouped them into a *fresh* asset
   and the photo walked back onto the wall. Gone on screen, "Deleted" in
   the toast, back on refresh.

   The batch path already deleted every member; only the single-photo path
   deleted one file. Both go through assetItemsFor() now, and this suite
   is what stops that from splitting again.

   The other invariant here: applyImageDelete must prune state.assets, not
   just state.folders. state.assets is what move, rename, remove-phase and
   the viewer's variant picker all resolve an asset through, and it is
   rebuilt only by a full tree load — so a delete that skipped it left a
   dead asset behind for every one of them. */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';

const APP = new URL('../app.js', import.meta.url);
const source = await readFile(APP, 'utf8');

const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

/* Slice a top-level function out of app.js, the same way the other suites
   do. Brace counting has to skip strings, template literals and comments,
   or an object literal or a `${}` ends the slice early. */
const body = (name) => {
  const start = source.indexOf(`function ${name}`);
  assert.notStrictEqual(start, -1, `${name} is missing from app.js`);
  /* Find the signature's closing paren by counting depth, not by scanning
     for the next ')'. The obvious `indexOf(')')` is wrong twice over: a
     default argument can contain one (`opts = f(x)`), and an EMPTY
     parameter list — batchDeleteSelected() — leaves source[sigEnd-1] as the
     '(' itself, which sent the old escape-guard skipping to a ')' deep in
     the body and sliced the wrong 490 characters. */
  const paren = source.indexOf('(', start);
  let parenDepth = 0, sigEnd = -1;
  for (let i = paren; i < source.length; i++) {
    if (source[i] === '(') parenDepth++;
    else if (source[i] === ')') {
      parenDepth--;
      if (parenDepth === 0) { sigEnd = i; break; }
    }
  }
  assert.notStrictEqual(sigEnd, -1, `could not find the end of ${name}()'s signature`);
  let depth = 0, began = false, mode = 'code';
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

const assetItemsFor = body('assetItemsFor');
const applyImageDelete = body('applyImageDelete');
const deleteImageRequest = body('deleteImageRequest');

describe('A deleted photo stays deleted', () => {
  test('the delete resolves the whole asset, not the one file', () => {
    // `items` is the entire group — canonical AND variants. Returning the
    // tapped path alone is what left the webp variants behind.
    assert.match(assetItemsFor, /find\(a => a\.canonical\.path === path\)/,
      'the asset must be looked up by its canonical path');
    assert.match(assetItemsFor, /if \(asset\) return asset\.items;/,
      'every member must come back, not just the canonical');
  });

  test('it is the whole *item* list, so shas come along for the delete', () => {
    // Each member needs its own sha — the Contents API rejects a delete
    // whose sha does not match that specific file.
    assert.match(assetItemsFor, /return asset\.items;/);
    assert.doesNotMatch(assetItemsFor, /asset\.variants\.map\(v => v\.path\)/,
      'paths alone would carry no sha, and every delete would 422');
  });

  test('the single-photo request deletes every member', () => {
    const req = code(deleteImageRequest);
    assert.match(req, /assetItemsFor\(path, sha\)/,
      'deleteImageRequest must ask for the asset, not the file');
    assert.match(req, /for \(const item of items\) \{[\s\S]*?await githubDelete\(item\.path, item\.sha,/,
      'it must loop the members and pass each one its own sha');
  });

  test('a failed member does not strand the rest', () => {
    // Abandoning the loop on the first error is how variants used to be
    // orphaned: one 404 and the remaining files stay in the repo forever.
    const req = code(deleteImageRequest);
    assert.match(req, /if \(!firstError\) firstError = err;/,
      'the first reason must be kept');
    assert.match(req, /if \(firstError\) throw firstError;/,
      'and reported once every member has been attempted');
  });

  test('the batch path goes through the same helper', () => {
    // It already deleted every member. The point is that the two paths
    // cannot drift apart again.
    //
    // Uses the same brace-counting body() as every other test here. A
    // slice-to-next-`function` would stop at the first *nested* function
    // declaration in the body and quietly assert against half the code.
    const batch = code(body('batchDeleteSelected'));
    assert.match(batch, /assetItemsFor\(path\)/,
      'the batch must resolve assets the same way, not keep its own copy of the rule');
    assert.doesNotMatch(batch, /state\.assets\.find\(/,
      'the batch must not keep a private copy of the grouping rule');
  });

  test('the local state change prunes both structures', () => {
    const del = code(applyImageDelete);
    // state.folders is what the wall renders, so the card must go.
    assert.match(del, /state\.folders\[folder\] = state\.folders\[folder\]\.filter\(f => !paths\.has\(f\.path\)\)/);
    // state.assets is what move / rename / remove-phase / the viewer read.
    assert.match(del, /state\.assets = \(state\.assets \|\| \[\]\)\.filter\(a => !paths\.has\(a\.canonical\.path\)\)/,
      'state.assets must be pruned too, or every other admin flow keeps a dead asset');
  });

  test('it filters by the whole asset, not one path', () => {
    const del = code(applyImageDelete);
    assert.match(del, /const paths = new Set\(assetItemsFor\(path\)\.map\(i => i\.path\)\)/);
    assert.doesNotMatch(del, /f\.path !== path/,
      'the old single-path filter is the bug this whole suite exists for');
  });
});

describe('the grouping rule the delete depends on', () => {
  test('a variant shares its base name with the original', () => {
    // If this changed, leaving variants behind would stop producing a new
    // card — and the test above would be guarding a phantom.
    const src = code(source);
    assert.match(src, /union\(parent, 'f:' \+ f\.path, 'b:' \+ f\.folder \+ '\/' \+ assetBase\(f\.name\)\)/,
      'members are unioned in by base name and folder');
    assert.match(src, /const canonical = group\[0\];/);
  });

  test('the original outranks every variant', () => {
    const variantScore = code(body('variantScore'));
    assert.match(variantScore, /if \(!isVariantName\(name\)\) return 0;/,
      'a non-variant name scores 0, so it is always group[0]');
  });
});