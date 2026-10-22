/* wireHoverGlow carries the cursor glow across the photo wall. Its
 * pointermove handler used to throw whenever the pointer sat on the page
 * background: `card` starts null, the `next !== card` guard is skipped
 * because both are null, and the rect read underneath dereferences nothing.
 * The wall is mostly background around the tiles, so this fired on almost
 * every mouse frame after the first one that left a card.
 *
 * The suite runs the real text of the function, sliced out of app.js and
 * given the two listeners it stands on, so the guard cannot be dropped
 * again without a failure. */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');

/* Brace-count a top-level function out of app.js. This one is flat — no
   brace inside a string, a comment or a template literal — so the counter
   needs no mode tracking. confirmStack.test.mjs carries the version that
   does, for functions that are less kind. */
const body = (name) => {
  const start = source.indexOf(`function ${name}`);
  assert.notStrictEqual(start, -1, `${name} is missing from app.js`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`${name} never closed`);
};

function harness() {
  const handlers = { document: {}, window: {} };
  const writes = [];
  let rects = 0;

  // A tile: something closest('.card') resolves to, with a rect that counts
  // how often it is read.
  const tile = (rect = { left: 10, top: 20 }) => {
    const o = {
      props: {},
      style: {
        setProperty: (k, v) => { o.props[k] = v; writes.push(['set', o, k, v]); },
        removeProperty: (k) => { delete o.props[k]; writes.push(['remove', o, k]); },
      },
      closest: (sel) => (sel === '.card' ? o : null),
      getBoundingClientRect: () => { rects++; return rect; },
    };
    return o;
  };
  // The background: app bar, tab bar, gutters — anything that is not a tile.
  const bg = { closest: () => null };

  const sandbox = {
    document: { addEventListener: (t, fn) => { handlers.document[t] = fn; } },
    window: { addEventListener: (t, fn) => { handlers.window[t] = fn; } },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(body('wireHoverGlow'), ctx, { filename: 'app.js' });
  vm.runInContext('wireHoverGlow()', ctx, { filename: 'app.js' });

  return {
    tile, bg, writes,
    rectReads: () => rects,
    move(target, x = 0, y = 0, pointerType = 'mouse') {
      handlers.document.pointermove({ target, clientX: x, clientY: y, pointerType });
    },
    fire: (t) => handlers.window[t](),
    propsOf: (t) => t.props,
  };
}

describe('G — the hover glow survives leaving the wall', () => {
  test('G1 — a move onto the background never throws', () => {
    const h = harness();
    assert.doesNotThrow(() => h.move(h.bg), 'the first move off a tile');
    assert.doesNotThrow(() => h.move(h.bg), 'and the next, where card and box are both null');
  });

  test('G2 — a move onto a tile writes the glow offset', () => {
    const h = harness();
    const t = h.tile({ left: 100, top: 50 });
    h.move(t, 130, 80);
    assert.equal(h.propsOf(t)['--mx'], '30px');
    assert.equal(h.propsOf(t)['--my'], '30px');
  });

  test('G3 — leaving the tile clears the glow and stops writing', () => {
    const h = harness();
    const t = h.tile();
    h.move(t, 0, 0);
    h.move(h.bg);
    assert.equal(h.propsOf(t)['--mx'], undefined, 'the offset should be cleared on leave');
    const after = h.writes.length;
    h.move(h.bg);
    assert.equal(h.writes.length, after, 'no writes while over the background');
  });

  test('G4 — touch never hovers', () => {
    const h = harness();
    const t = h.tile();
    h.move(t, 5, 5, 'touch');
    assert.equal(h.writes.length, 0, 'Android fires pointermove per frame while scrolling');
  });

  test('G5 — the rect is cached for as long as the pointer stays put', () => {
    const h = harness();
    const t = h.tile();
    h.move(t, 1, 1);
    h.move(t, 2, 2);
    h.move(t, 3, 3);
    assert.equal(h.rectReads(), 1, 'reading per move forces a re-layout of the whole wall');
  });

  test('G6 — scroll drops the cache so a moved tile is re-read', () => {
    const h = harness();
    const t = h.tile();
    h.move(t, 1, 1);
    assert.equal(h.rectReads(), 1);
    h.fire('scroll');
    assert.doesNotThrow(() => h.move(t, 1, 1));
    assert.equal(h.rectReads(), 2, 'the wall moved under the cache');
  });

  test('G7 — resize drops the cache too', () => {
    const h = harness();
    const t = h.tile();
    h.move(t, 1, 1);
    h.fire('resize');
    h.move(t, 1, 1);
    assert.equal(h.rectReads(), 2);
  });
});
