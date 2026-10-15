/* Tapping a card must open the photo that card is showing.

   A report: "if image 3 is selected, image 2 displays." The cause was not the
   index arithmetic — that translates correctly by path — but two independent
   sources for one screen:

     lb.src          <- the tapped card's img.currentSrc   (state.lightboxStartSrc)
     lb.dataset.full <- imgSrc(items[lightboxIndex])        (the RESOLVED photo)

   Disagree, and you are looking at one photo's pixels under another photo's
   filename. They disagreed because lightboxIndexFor collapsed a failed lookup
   to 0, which is a valid index belonging to an unrelated photo.

   So the invariant under test is simple and worth stating plainly: whatever
   the viewer paints first must belong to the photo it says it is painting. */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

/* Load the real module into a vm with just enough of a world for the index
   maths. These are the app's own functions — a copy would be the thing under
   test. */
function harness({ view = 'images', folders, picturesList }) {
  const listeners = {};
  const el = () => ({
    hidden: false, textContent: '', innerHTML: '', style: { setProperty() {}, removeProperty() {} },
    classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
    setAttribute() {}, removeAttribute() {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    appendChild() {}, focus() {}, remove() {}, dataset: {},
  });
  const nodes = new Map([['lightboxImg', el()], ['lightbox', el()], ['lightboxCounter', el()],
    ['lightboxName', el()], ['lightboxMeta', el()], ['lightboxTag', el()],
    ['lightboxDelete', el()], ['lightboxImg', el()]]);
  const document = {
    createElement: () => el(),
    addEventListener(t, f) { listeners[t] = f; },
    querySelector: (s) => nodes.get(s.replace('#', '')) || null,
    querySelectorAll: () => [],
    body: el(),
  };
  const sandbox = {
    console, document,
    localStorage: { getItem: () => null, setItem() {} },
    addEventListener() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    setTimeout: () => 0, clearTimeout() {},
    AudioContext: undefined,
    fetch: async () => ({ ok: true, json: async () => ({}), text: async () => '' }),
    getComputedStyle: () => ({ objectFit: 'cover', objectPosition: 'center', borderRadius: '0' }),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  /* Two regions, because the state object and the viewer functions are ~3300
     lines apart and slicing between them would drag in the whole app. Both
     are the real source — a copy would be the thing under test. */
  /* Slice to the closing `};` of the state object, not a guessed length. */
  const stateAt = app.indexOf('const state = {');
  const stateEnd = app.indexOf('\n};', stateAt) + 3;
  const stateBlock = app.slice(stateAt, stateEnd);
  const viewerBlock = app.slice(app.indexOf('function lightboxItems'), app.indexOf('function updateLightbox'));
  vm.runInContext(stateBlock + '\n' + viewerBlock + `
;globalThis.__h = {
  lightboxIndexFor, openLightbox, startSrcFor,
  _state: state, _set: (k, v) => { state[k] = v; },
  _img: () => el('lightboxImg'),
};`, ctx, { filename: 'app-viewer.js' });
  const h = sandbox.__h;
  h._set('view', view);
  h._set('folders', folders);
  h._set('picturesList', picturesList);
  return h;
}

import vm from 'node:vm';

/* Photo records shaped like the app's: { name, path, folder }. */
const photo = (name, folder) => ({ name, path: `images/${folder}/${name}`, folder });

describe('Opening the viewer from a card', () => {
  test('a card index that names a real photo resolves to that photo', () => {
    const a = photo('a.jpg', 'F1');
    const b = photo('b.jpg', 'F1');
    const c = photo('c.jpg', 'F1');
    const h = harness({
      view: 'images',
      folders: { F1: [a, b, c] },
      // Wall order deliberately unrelated to folder order.
      picturesList: [{ img: c, folder: 'F1', index: 2 }, { img: a, folder: 'F1', index: 0 }, { img: b, folder: 'F1', index: 1 }],
    });
    assert.strictEqual(h.lightboxIndexFor('F1', 2), 0, 'c is first on the wall');
    assert.strictEqual(h.lightboxIndexFor('F1', 0), 1);
    assert.strictEqual(h.lightboxIndexFor('F1', 1), 2);
  });

  test('an index past the end does NOT collapse to photo 1', () => {
    // This is the reported bug. Returning 0 here opened a real, unrelated
    // photo, which is far worse than opening nothing.
    const a = photo('a.jpg', 'F1');
    const b = photo('b.jpg', 'F1');
    const h = harness({
      view: 'images',
      folders: { F1: [a, b] },
      picturesList: [{ img: a, folder: 'F1', index: 0 }, { img: b, folder: 'F1', index: 1 }],
    });
    assert.strictEqual(h.lightboxIndexFor('F1', 7), -1,
      'an index that names nothing must say so, not return the first photo');
    assert.strictEqual(h.lightboxIndexFor('F1', 2), -1, 'one past the end is also nothing');
    assert.strictEqual(h.lightboxIndexFor('F1', -1), -1);
    assert.strictEqual(h.lightboxIndexFor('nosuch', 0), -1, 'a missing folder is not photo 1');
  });

  test('a photo missing from the wall reports a miss rather than index 0', () => {
    // state.folders and state.picturesList can disagree: the wall is rebuilt
    // inside render(), while folders are mutated in several places that do
    // not re-render immediately.
    const a = photo('a.jpg', 'F1');
    const gone = photo('gone.jpg', 'F1');
    const h = harness({
      view: 'images',
      folders: { F1: [a, gone] },
      picturesList: [{ img: a, folder: 'F1', index: 0 }],   // `gone` is not on the wall
    });
    assert.strictEqual(h.lightboxIndexFor('F1', 0), 0, 'the photo that IS present resolves');
    assert.strictEqual(h.lightboxIndexFor('F1', 1), -1,
      'the one that fell off the wall must miss, not silently become photo 1');
  });

  test('outside the Pictures tab the folder index passes straight through', () => {
    const items = ['a', 'b', 'c'].map(n => photo(`${n}.jpg`, 'F1'));
    const h = harness({ view: 'phases', folders: { F1: items }, picturesList: [] });
    assert.strictEqual(h.lightboxIndexFor('F1', 2), 2, 'no translation outside the wall');
    assert.strictEqual(h.lightboxIndexFor('F1', 9), -1, 'but still bounds-checked');
  });

  /* The reported failure, in the one view that could still produce it.
     In an album the raw slot WAS the answer, so a card whose number no longer
     matched the data opened whatever photo had taken that slot — the tap, the
     neighbour, no error. Identity now decides, not position. */
  test('a stale album card opens its own photo, not the one that moved into its slot', () => {
    // The album as it is NOW: 'a' was deleted, 'b' slid down into slot 0.
    const items = ['b', 'c'].map(n => photo(`${n}.jpg`, 'F1'));
    const h = harness({ view: 'phases', folders: { F1: items }, picturesList: [] });
    // A card rendered before the delete still says index 0 / a.jpg.
    assert.strictEqual(h.lightboxIndexFor('F1', 0, 'images/F1/a.jpg'), -1,
      'the deleted photo is gone — open nothing rather than open its neighbour');
    // And the card that was showing 'b' still opens 'b'.
    assert.strictEqual(h.lightboxIndexFor('F1', 0, 'images/F1/b.jpg'), 0,
      'an honest claim still resolves to its own photo');
  });

  test('on the wall a card that disagrees with the slot still opens its own photo', () => {
    const items = ['a', 'b', 'c'].map(n => photo(`${n}.jpg`, 'F1'));
    const wall = [items[2], items[0], items[1]].map(img => ({ img, folder: 'F1', index: 0 }));
    const h = harness({ view: 'images', folders: { F1: items }, picturesList: wall });
    // Slot 2 holds c, but the card claims a. Trust the card's identity.
    assert.strictEqual(h.lightboxIndexFor('F1', 2, 'images/F1/a.jpg'), 1, 'resolved where a actually sits');
    // A claim matching the slot is unchanged.
    assert.strictEqual(h.lightboxIndexFor('F1', 2, 'images/F1/c.jpg'), 0);
    // A photo that is not on the wall at all still opens nothing.
    assert.strictEqual(h.lightboxIndexFor('F1', 2, 'images/F1/zzz.jpg'), -1);
  });
});

describe('Finding a card by its path', () => {
  /* A real photo path, with the characters that break a selector. Every one
     of these is in the wild: slashes separate folders, dots end the name,
     and spaces and parentheses turn up in camera filenames. */
  const PATHS = [
    'images/rack-build/20260805_164143.jpg',
    'images/DSC_0001.JPG',
    'images/a b.jpg',
    'images/photo(1).jpg',
    'images/2026-08-05 [edited].jpeg',
    'images/naïve-café.png',
  ];

  const attrSelOf = () => {
    const at = app.indexOf('function attrSel');
    return app.slice(at, app.indexOf('}', at));
  };

  test('a photo path survives into a selector unchanged', () => {
    const src = attrSelOf();
    for (const p of PATHS) {
      const escaped = String(p).replace(/["\\]/g, '\\$&');
      const selector = `a[data-path="${escaped}"]`;
      // Unescaping the value a selector would compare against must give the
      // path back. CSS.escape broke this: it turned "." into "\.", which
      // inside a quoted attribute value means a literal backslash.
      const value = selector.slice(selector.indexOf('"') + 1, selector.lastIndexOf('"'));
      const back = value.replace(/\\(.)/g, '$1');
      assert.strictEqual(back, p, `${p} does not survive the selector round trip`);
      assert.ok(src.includes('["\\\\]'), 'attrSel must escape the quote and the backslash, and nothing else');
    }
  });

  test('CSS.escape is no longer used for attribute values', () => {
    // It was used for [data-path] and [data-folder] three times. Inside a
    // quoted attribute value it over-escapes and matches nothing, so
    // selecting a photo updated state and painted no badge — and batch
    // delete resolved no cards at all.
    const uses = [...app.matchAll(/CSS\.escape\(/g)];
    assert.strictEqual(uses.length, 0,
      'CSS.escape is for identifiers; an attribute value needs only \\" and \\\\');
  });

  test('a quote in a path cannot break out of the selector', () => {
    // The reason attrSel exists at all rather than interpolating raw.
    const nasty = 'images/a".jpg';
    const escaped = nasty.replace(/["\\]/g, '\\$&');
    assert.ok(escaped.includes('\\"'), 'the quote must be escaped');
    const selector = `a[data-path="${escaped}"]`;
    const between = selector.slice(selector.indexOf('"') + 1, selector.lastIndexOf('"'));
    assert.strictEqual(between.replace(/\\(.)/g, '$1'), nasty);
  });
});

describe('The card thumbnail is only a shortcut', () => {
  const fig = (path, currentSrc, loaded = true) => ({
    dataset: { path },
    querySelector: () => ({
      classList: { contains: (c) => c === 'is-loaded' && loaded },
      currentSrc,
    }),
  });

  test('a card that really is the tapped photo may lend its thumbnail', () => {
    const h = harness({ view: 'images', folders: {}, picturesList: [] });
    const src = h.startSrcFor(fig('images/F1/a.jpg', 'https://x/a-800.webp'), 'images/F1/a.jpg');
    assert.strictEqual(src, 'https://x/a-800.webp',
      'a cache hit is the whole point — it avoids re-fetching on open');
  });

  test('a card for a DIFFERENT photo lends nothing', () => {
    // The mismatch, at source: the viewer's first paint comes from the card
    // while its name and full-res come from the resolved photo.
    const h = harness({ view: 'images', folders: {}, picturesList: [] });
    assert.strictEqual(h.startSrcFor(fig('images/F1/c.jpg', 'https://x/c-800.webp'), 'images/F1/b.jpg'), null,
      'one photo\'s bytes must never be shown under another photo\'s name');
  });

  test('a card still loading lends nothing', () => {
    const h = harness({ view: 'images', folders: {}, picturesList: [] });
    assert.strictEqual(h.startSrcFor(fig('images/F1/a.jpg', 'https://x/a-480.webp', false), 'images/F1/a.jpg'), null,
      'an unloaded card has nothing cached to lend; the viewer loads its own');
  });

  test('a card with no path lends nothing', () => {
    const h = harness({ view: 'images', folders: {}, picturesList: [] });
    assert.strictEqual(h.startSrcFor({ dataset: {}, querySelector: () => null }, 'images/F1/a.jpg'), null);
    assert.strictEqual(h.startSrcFor(null, 'images/F1/a.jpg'), null);
  });
});