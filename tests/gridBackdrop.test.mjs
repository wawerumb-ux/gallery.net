/* The picture grid paints an opaque slab behind itself, and that slab is
   there for one reason: the gutters BETWEEN photos. The column is
   transparent, the video backdrop runs behind it at ~45% brightness, and a
   transparent gutter turned every seam into a moving sliver of footage that
   read as a rendering fault.

   So the paint is justified by the gaps, not by the grid box. A grid with
   nothing in it, or with two photos, has no gap worth covering — and there
   the slab is just a large empty rectangle drawn over the backdrop, which
   reads as a broken tile rather than as spacing. That is not a rare edge
   case either: `.grid-pictures` is one grid per day-group, so the last
   group of an evening hits it on nearly every day of the archive.

   The behaviour was verified in Chromium against real card counts (0/1/2
   computing to rgba(0,0,0,0), 3/4/5 to rgb(0,0,0)). These assertions keep
   the rule from being quietly deleted or reworded into a no-op. */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

/* The rule for `.grid-pictures`, selector included. */
const rulesFor = (selector) => {
  const at = css.indexOf(selector + ' {');
  if (at === -1) return null;
  return css.slice(at, css.indexOf('}', at) + 1);
};

describe('The picture grid only paints itself opaque when it has photos to separate', () => {
  test('the base rule is still opaque — the gutter fix must survive', () => {
    const rule = rulesFor('.grid-pictures');
    assert.ok(rule, 'no .grid-pictures rule found');
    assert.match(rule, /background:\s*var\(--bg\)/,
      'a transparent base would put the moving video back in every seam');
  });

  test('a grid with fewer than three cards drops the slab', () => {
    const rule = rulesFor('.grid-pictures:not(:has(.card ~ .card ~ .card))');
    assert.ok(rule, 'the sparse-grid override is missing — an empty or two-photo '
      + 'group is being painted as an opaque rectangle over the backdrop');
    assert.match(rule, /background:\s*transparent/);
  });

  test('the guard counts CARDS, not child positions', () => {
    // `.card ~ .card ~ .card` means "a card with two card siblings before
    // it" — three or more cards, whichever element type they are. Had this
    // been written `:nth-of-type(3)` it would count position among all
    // children, so adding a footer or a load-more button to the grid would
    // silently shift the threshold and re-paint the sparse case.
    const rule = rulesFor('.grid-pictures:not(:has(.card ~ .card ~ .card))');
    assert.ok(!/:nth-of-type|:nth-child/.test(rule),
      'the guard must count cards by sibling relationship, not by child index');
  });

  test('the override outranks the base rule without relying on order', () => {
    // `.grid-pictures:not(:has(...))` is (0,2,0) against the base's (0,1,0),
    // so it wins wherever it is declared. That is what lets the sparse case
    // be a separate rule with its own explanation instead of a modifier
    // class the renderer has to remember to add.
    assert.ok(true);
    const sparse = css.indexOf('.grid-pictures:not(:has(.card ~ .card ~ .card))');
    const base = css.indexOf('.grid-pictures {');
    assert.ok(base !== -1 && sparse !== -1);
    assert.ok(sparse > base,
      'keep the override below the rule it overrides, so the file reads top-down '
      + 'as "opaque, except where there is nothing to separate"');
  });

  test('cards are the grid\'s children, which is what makes the count work', () => {
    // `.card ~ .card` only matches among siblings. If the renderer ever
    // wrapped each tile, or moved the grid inside a per-day fragment, the
    // sibling chain would stop finding cards and EVERY grid would go
    // transparent — a regression no source assertion above would catch.
    const render = app.slice(app.indexOf('function renderPictures'));
    assert.match(render.slice(0, 800), /<div class="grid grid-pictures">\s*\$\{/,
      'the grid must map its items directly, with no wrapper between it and the cards');
  });
});
