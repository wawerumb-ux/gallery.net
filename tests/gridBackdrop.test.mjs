/* The picture grid has to paint an opaque field behind the photos — the
   column is transparent, the video backdrop runs behind it at ~45%
   brightness, and a transparent gutter turns every seam between photos into
   a moving sliver of footage that reads as a rendering fault.

   The paint must NOT live on the grid box. The box cannot tell a cell
   holding a photo from a cell grid-auto-flow left empty, so a box background
   paints a short final row as a solid slab running to the column edge — and
   the grid is rebuilt per day-group, so a short row is the normal case on
   nearly every day of the archive, not an edge case. That slab is the bug:
   the empty cells must stay transparent and keep their layout.

   So the paint lives on the TILE, as a spread shadow of half the gutter plus
   half the tile's hover lift. Two neighbours' mats meet in the middle of the
   gap: the gutter is sealed, and the fill stops exactly where the photos
   stop.

   Two of the numbers below were wrong on the first attempt and were caught by
   reading the rendered pixels, not the CSS:
     · a mat of just half the gutter re-opens a 3px slot of footage under a
       hovered tile, because the tile lifts and its mat rides with it;
     · listing the mat before the accent ring buries the ring completely
       (the first shadow in a list paints on top) and the tile lights up with
       no outline at all. */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';

const raw = await readFile(new URL('../style.css', import.meta.url), 'utf8');

/* Strip comments first, then take every LEAF block — `[^{}]` cannot cross a
   brace, so this reaches rules inside media/container/supports without ever
   matching a declaration that only exists inside a comment. */
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(m => ({ sel: m[1].trim(), body: m[2] }));

/** Every leaf block whose selector matches exactly. */
const ruleFor = (selector) => blocks.filter(b => b.sel === selector);

/** Blocks whose selector LIST contains this exact selector (grouped rules). */
const anyRuleFor = (selector) => blocks.filter(b =>
  b.sel.split(',').map(s => s.trim().replace(/\s+/g, ' ')).includes(selector));

/** Every leaf block whose selector targets `.card` itself — the tile. The
    negative lookahead keeps child elements that merely start with the same
    word (`.card-pick`, `.card-img`) out of the audit. */
const tileBlocks = () => blocks.filter(b => /(^|[\s,>+~])\.card(?![\w-])/.test(b.sel));

/** The value of the first `prop:` declaration in a block body, or ''. */
const decl = (body, prop) => {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
};

/* Split a box-shadow value into its layers. Commas inside rgba() must not
   split, so this tracks paren depth rather than calling split(','). */
function shadowLayers(value) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

describe('The grid paints only behind photos, never over empty cells', () => {
  test('the grid box itself is transparent', () => {
    const grids = ruleFor('.grid-pictures');
    assert.ok(grids.length, 'no .grid-pictures rule');
    assert.ok(grids.some(g => /background:\s*transparent/.test(g.body)),
      'a background on the grid BOX paints the empty tail of a short last '
      + 'row as a solid slab running to the column edge');
    assert.ok(!grids.some(g => /background:\s*var\(--bg\)/.test(g.body)),
      'the slab must not be re-introduced on the grid box');
  });

  test('the tile carries the paint, as half the gutter plus half the lift', () => {
    const card = ruleFor('.card');
    assert.equal(card.length, 1, 'expected exactly one .card rule');
    assert.match(card[0].body, /--lift-tile:\s*3px/,
      'the lift has to be named, so the mat can be derived from it instead of '
      + 'the two drifting apart');
    assert.match(card[0].body,
      /--tile-mat:\s*0 0 0 calc\(\(var\(--gap-tile\) \+ var\(--lift-tile\)\) \/ 2\) var\(--bg\)/,
      'the mat must be half the gutter PLUS half the lift in the page colour, '
      + 'or a hovered tile drags its mat off its neighbour and re-opens the '
      + 'gutter it exists to seal');
  });

  test('the lift the mat compensates for is the lift the tile actually moves', () => {
    // If someone retunes the hover lift to 6px and leaves the mat alone, the
    // gutter opens again. Both sides have to read the same variable.
    const hover = ruleFor('.card:hover')[0];
    assert.match(decl(hover.body, 'transform'),
      /translateY\(calc\(-1 \* var\(--lift-tile\)\)\)/,
      'the hover lift must be the --lift-tile the mat is sized against');
    const focus = ruleFor('.card:focus-visible')[0];
    assert.match(decl(focus.body, 'transform'),
      /translateY\(calc\(-1 \* var\(--lift-tile\)\)\)/);
  });

  test('the paint is a spread shadow, not a border', () => {
    const card = ruleFor('.card');
    // A border joins the box: hovering would resize the tile and reflow the
    // whole grid. A shadow paints outside the box and leaves layout alone.
    assert.doesNotMatch(card[0].body, /border:\s*\d/);
    assert.ok(shadowLayers(decl(card[0].body, 'box-shadow')).includes('var(--tile-mat)'));
  });

  test('the tile is square, so the mat has no corner to notch', () => {
    const card = ruleFor('.card');
    // Four rounded corners meet at every tile crossing and leave a hole —
    // measured at ~1.7px with this 6px gap and 4px radius, plainly visible as
    // moving footage. The rounding moves to the photo.
    assert.match(card[0].body, /border-radius:\s*0;/);
    assert.doesNotMatch(card[0].body, /border-radius:\s*var\(--radius-tile\)/);
  });

  test('the photo carries the resting rounding, and the hovered corner is painted on', () => {
    const img = ruleFor('.card img');
    assert.ok(img.length, 'no .card img rule');
    assert.match(img[0].body, /border-radius:\s*var\(--radius-tile\)/);

    /* The hovered rounding cannot be the photo's own radius: the photo is
       scaled 1.06, which pushes a border-radius outward with it, so the
       rounding is painted over the corners instead (.card::before). */
    const hoveredImg = blocks.filter(b => b.sel === '.card:hover img');
    assert.ok(hoveredImg.length, 'no .card:hover img rule');
    assert.doesNotMatch(hoveredImg[0].body, /border-radius:/,
      'a radius on the scaled photo lands outside the tile');

    const mask = ruleFor('.card::before');
    assert.ok(mask.length, 'no .card::before corner paint');
    assert.equal((mask[0].body.match(/radial-gradient/g) || []).length, 4,
      'one gradient per corner, or a corner keeps its square shape');
    assert.equal((mask[0].body.match(/\/ var\(--radius-hover\) var\(--radius-hover\)/g) || []).length, 4,
      'each corner gradient has to be sized to the radius, or the arc is '
      + 'stretched across the tile');
    assert.match(mask[0].body, /transparent calc\(var\(--radius-hover\) - 1px\), var\(--bg\)/,
      'the fill has to be the page colour, so the painted corner reads as '
      + 'the tile continuing rather than as a patch');
    assert.match(mask[0].body, /opacity:\s*0/,
      'the corner paint must be off except on hover');
    assert.match(anyRuleFor('.card:hover::before')[0].body, /opacity:\s*1/);
  });

  test('the tile is square in every state', () => {
    // One guard across all of them, so a future hover/focus/press state
    // cannot quietly re-round the tile and re-open the gutters. Only the
    // tile's own box counts — the photo and the selection overlay are
    // supposed to be rounded.
    const faces = tileBlocks().filter(b =>
      !/(^|[\s,>+~])img\b/.test(b.sel) && !/::/.test(b.sel));
    assert.ok(faces.length >= 4, `expected the tile states, found ${faces.length}`);
    for (const b of faces) {
      assert.doesNotMatch(b.body, /border-radius:\s*(?!0\s*[;}])(\S)/,
        `${b.sel} sets a border-radius on the tile; the tile carries the `
        + 'gutter paint and has to stay square');
    }
  });
});

describe('Every state that repaints the tile keeps the mat', () => {
  /* A box-shadow list cannot be extended from elsewhere — each of these
     states REPLACES the declaration wholesale. A state that forgets the mat
     lets the backdrop flash through the gutters around the tile the pointer
     is on, which is the exact fault this arrangement exists to prevent.
     Machine-checked so a future state cannot quietly omit it. */
  const paintStates = tileBlocks().filter(b => /box-shadow:/.test(b.body)
    && !/::(after|before)/.test(b.sel)
    && !/(^|[\s,>+~])img\b/.test(b.sel));

  test('the audit found the tile paint states at all', () => {
    // Without this, a rename would make every assertion below pass vacuously.
    assert.ok(paintStates.length >= 4,
      `expected the tile's paint states, found ${paintStates.length}`);
  });

  for (const state of paintStates) {
    test(`${state.sel} composes the mat`, () => {
      assert.ok(shadowLayers(decl(state.body, 'box-shadow')).includes('var(--tile-mat)'),
        `${state.sel} replaces box-shadow without keeping --tile-mat, so the `
        + 'gutter around this tile would show the backdrop');
    });
  }

  test('the accent ring is listed before the mat, so it is not buried', () => {
    /* The FIRST shadow in a list paints on top, and the mat is 1px wider than
       the ring. Mat first paints a black band clean over the ring — verified
       against the rendered pixels, where the ring's 2px read as rgb(0,0,0)
       and the tile lit up with no outline at all. */
    for (const [sel, ring] of [['.card:hover', '--accent'],
                               ['.card:focus-visible', '--accent-text']]) {
      const layers = shadowLayers(decl(ruleFor(sel)[0].body, 'box-shadow'));
      const ringAt = layers.findIndex(l => l.includes(`var(${ring})`));
      const matAt = layers.findIndex(l => l.includes('var(--tile-mat)'));
      assert.ok(ringAt !== -1, `${sel} has no ring layer`);
      assert.ok(matAt !== -1, `${sel} has no mat layer`);
      assert.ok(ringAt < matAt,
        `${sel}: the ring must come before the mat in the list or the mat `
        + 'paints over it and hovering shows no outline');
    }
  });

  test('the resting list lines up with the hover list, so the ring fades in', () => {
    /* A shadow list interpolates by position: layer 0 of the resting list
       morphs into layer 0 of the hovered one. If the mat sat at a different
       index in the two lists, hovering would visibly morph the mat into the
       ring. Same length, and the mat and the ring each in the same slot. */
    const rest = shadowLayers(decl(ruleFor('.card')[0].body, 'box-shadow'));
    const hover = shadowLayers(decl(ruleFor('.card:hover')[0].body, 'box-shadow'));
    assert.equal(rest.length, hover.length,
      'the resting and hovered shadow lists must line up position for '
      + 'position, or hovering morphs one shadow into another');
    assert.equal(rest.indexOf('var(--tile-mat)'), hover.indexOf('var(--tile-mat)'),
      'the mat must occupy the same slot in both lists');
    assert.equal(rest.findIndex(l => /rgba\(0, 114, 239, 0\)$/.test(l)), 0,
      'the ring slot (zero alpha at rest, full alpha on hover) is first');
    assert.equal(hover.findIndex(l => /var\(--accent\)$/.test(l)), 0,
      'the ring slot (zero alpha at rest, full alpha on hover) is first');
  });
});

describe('Nothing persistent moves the tile, because the mat rides on it', () => {
  test('selection shrinks the photo, not the tile', () => {
    // The mat is a shadow on the tile, so scaling the tile by 0.94 drags the
    // mat ~4.8px inward at 8 columns on a 1320px column — a measurable
    // shortfall against a 4.5px mat, and a visible sliver of video beside
    // every selected photo. Scaling the photo leaves tile, mat and ring still.
    const sel = ruleFor('.card.card-selected');
    for (const b of sel) {
      assert.doesNotMatch(b.body, /transform:/,
        'the selected state must not transform the tile, only the photo');
    }
    const img = ruleFor('.card.card-selected img');
    assert.ok(img.length, 'no .card.card-selected img rule');
    assert.match(img[0].body, /transform:\s*scale\(0\.94\)/);
  });

  test('a picked photo stays shrunk while the pointer crosses it', () => {
    // The is-selecting hover rule clears the photo's transform; the picked
    // photo's shrink has to be re-asserted after it or picking would appear
    // to un-pick under the mouse.
    const r = ruleFor('body.is-selecting .card.card-selected:hover img');
    assert.ok(r.length, 'the picked+hovered photo has no rule');
    assert.match(r[0].body, /transform:\s*scale\(0\.94\)/);
  });

  test('the selected ring follows the photo that is actually rounded', () => {
    const ring = ruleFor('.card.card-selected::after');
    assert.ok(ring.length);
    // `inherit` would take the tile's radius, which is now 0.
    assert.match(ring[0].body, /border-radius:\s*var\(--radius-tile\)/);
    assert.doesNotMatch(ring[0].body, /border-radius:\s*inherit/);
  });

  test('the needs-review warning sits where no state can clip it', () => {
    const r = ruleFor('.card-needs-review');
    assert.ok(r.length, 'no .card-needs-review rule');
    assert.match(r[0].body, /outline:/);
    // On the photo it would be scaled out past the tile's overflow clip on
    // hover, and the warning would vanish under the pointer.
    const onImg = blocks.filter(b => b.sel === '.card-needs-review img');
    assert.equal(onImg.length, 0, 'the warning must not ride on the photo');
  });
});
