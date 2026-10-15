/* The viewer slider's resting position.
   ──────────────────────────────────────────────────────────────────
   "If user clicks img card 2, img 1 displays." Not an index fault: the maths
   resolved correctly every time, and two rounds of fixing it changed nothing.
   The viewer is three slots — prev, current, next — on one flex track, each
   slot exactly one track wide, inside an overflow:hidden stage.

   So the track's transform IS what photo you are looking at:
     translateX(0)   -> slot 0 is under the stage -> the PREVIOUS photo
     translateX(-100%) -> slot 1 is under it -> the CURRENT photo

   The current slot is index 1, so the track must rest at -100%. It did not:
   commitSlide and closeLightbox both cleared the inline transform to '' and
   no rule supplied a resting value, so the stage showed slot 0 — and slot 0
   is deliberately filled with windowItem(items, index - 1). Every tap opened
   the photo immediately before the tapped one. Card 2 showed image 1.

   These assertions pin the arithmetic on both sides of that: the resting
   offset, and the step offset measured from it. */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

/* The block that declares the track, so these assertions are about the real
   declaration and not about a copy that can drift from it. */
function ruleBody(selector) {
  const at = css.indexOf(selector);
  if (at === -1) return null;
  const open = css.indexOf('{', at);
  const close = css.indexOf('\n}', open);
  return css.slice(open + 1, close);
}

describe('The viewer track rests on the current slot', () => {
  test('the track declares a resting offset, not just an empty transform', () => {
    const body = ruleBody('.viewer-track {');
    assert.ok(body, '.viewer-track must still exist');
    assert.match(body, /transform:\s*translateX\(-100%\)/,
      'the track must rest one slot left; with no transform the stage shows ' +
      'slot 0, which is filled with the PREVIOUS photo');
  });

  test('the slots are one track wide each, so slot 1 is a whole track offset', () => {
    const body = ruleBody('.viewer-slide {');
    assert.ok(body, '.viewer-slide must still exist');
    assert.match(body, /flex:\s*0 0 100%/, 'each slot must be exactly one track wide');
  });

  test('the stage clips, so only one slot is ever visible', () => {
    const body = ruleBody('.viewer-stage {');
    assert.ok(body, '.viewer-stage must still exist');
    assert.match(body, /overflow:\s*hidden/);
  });
});

describe('The slide offset is measured from that resting position', () => {
  test('a step is rebased onto -100%, not measured from 0', () => {
    assert.match(app, /translateX\(\$\{-100 - delta \* 100\}%\)/,
      'the step offset must include the resting -100%');
    assert.doesNotMatch(app, /translateX\(\$\{-delta \* 100\}%\)/,
      'an offset measured from 0 slides one slot short of its target');
  });

  test('committing and closing clear the inline transform so CSS rest applies', () => {
    // Both must clear rather than hard-set a value, or the resting invariant
    // gets overridden by an inline style and the same off-by-one returns.
    const clears = app.match(/track\.style\.transform = '';/g) || [];
    assert.ok(clears.length >= 2,
      'closeLightbox and commitSlide must both clear the inline transform');
  });
});