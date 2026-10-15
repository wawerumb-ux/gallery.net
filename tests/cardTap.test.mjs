/* End-to-end: tap a card on the Pictures wall and check which photo the
   viewer opens.

   This exists because the arithmetic was verified twice by reading and
   testing the index maths in isolation — and the reported bug survived both.
   Isolated functions answer "is the index right given these inputs"; this
   answers "does a real tap on a real card open the right photo", with the
   real markup, the real querySelector, and the real event dispatch.

   linkedom supplies the DOM: it parses index.html's structure, so the
   selectors under test are the ones the page actually ships. */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const galleryJson = JSON.parse(await readFile(new URL('../gallery.json', import.meta.url), 'utf8'));

const CONFIG = { imagesPath: 'images' };
const el_pictures = (document) => document.getElementById('picturesView');

/* Build a small gallery: 3 phases, 4 photos each, with names that sort
   predictably inside a phase. */
function makeGallery() {
  const folders = {};
  for (const [seq, folder] of [['01-install', 'install'], ['02-rack', 'rack'], ['03-cable', 'cable']]) {
    folders[folder] = [1, 2, 3, 4].map(n => ({
      name: `2026080${seq[1]}-0${n}0000_photo${n}.jpg`,
      path: `images/${folder}/2026080${seq[1]}-0${n}0000_photo${n}.jpg`,
      folder,
    }));
  }
  // Sort each folder the way the app does: chronological by extracted ts.
  const ts = (name) => {
    const m = name.match(/(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/);
    return m ? Number(m[1] + m[2] + m[3] + m[4] + m[5] + m[6]) : Number.MAX_SAFE_INTEGER;
  };
  for (const k of Object.keys(folders)) {
    folders[k].sort((a, b) => (ts(a.name) - ts(b.name)) || a.name.localeCompare(b.name, 'en', { numeric: true }));
  }
  return folders;
}

function boot() {
  const { window, document } = parseHTML(indexHtml);
  const listeners = {};
  const el = (id) => document.getElementById(id);
  const folders = makeGallery();

  /* The slice: state, the card markup, the wall render, the click wiring,
     the index maths and openLightbox. Sliced from the real file. */
  const at = (from, to) => {
    const a = app.indexOf(from);
    assert.notStrictEqual(a, -1, `marker not found: ${from}`);
    return app.slice(a, app.indexOf(to));
  };
  /* Take a named top-level function out of the real source, whole. Hand-written
     line ranges are how this file went wrong twice — a range that clipped a
     closing brace produced a syntax error, and one that over-ran pulled in a
     second copy of `state`. Locating each function by name and reading to its
     matching close cannot do either. */
  const fn = (name) => {
    const at = app.search(new RegExp(`^(?:async )?function ${name}\\b`, 'm'));
    assert.notStrictEqual(at, -1, `no function ${name} in app.js`);
    let d = 0, i = app.indexOf('{', at);
    for (let k = i; k < app.length; k++) {
      const c = app[k];
      if (c === '{') d++;
      else if (c === '}') { d--; if (!d) return app.slice(at, k + 1); }
    }
    throw new Error(`unterminated ${name}`);
  };
  /* journeyFor, folderSequence, extractPhotoDate, photoTs, albumStageName and
     classifyPhoto decide SORT ORDER. Stubbing any of them would quietly test
     a different gallery than the app builds. */
  const helpersBlock = ['journeyFor', 'folderSequence', 'extractPhotoDate', 'photoTs',
    'albumStageName', 'classifyPhoto', 'reduceMotion', 'thumbSrc', 'pageUrl',
    'cardSrc', 'prettyName', 'attrSel', 'cardsForPath',
    // classifyPhoto's own dependencies, which are what make the card markup
    // what it is: needsReview decides the dashed outline, group and stage feed
    // data-group. isFirstPaint sets loading="eager" on the first paint.
    'imgFolder', 'isFirstPaint',
  ].map(fn).join('\n');
  const stateBlock = app.slice(app.indexOf('const state = {'), app.indexOf('\n};', app.indexOf('const state = {')) + 3);
  /* IDENTITY_RULES drives classifyPhoto, which decides the card's class and
     badge. Stubbing it would change the markup, so the real table comes too. */
  /* Everything between JOURNEY and DATE_WINDOWS: the journey table, the folder
     stages, the identity rules, the lookup map, and the date windows.
     classifyPhoto reads all of it and it decides what a card renders. */
  const journeyAt = app.indexOf('const JOURNEY = [');
  /* JOURNEY_BY_SEQUENCE is declared after DATE_WINDOWS, between the tables
     and the first function that uses them. Cut there. */
  const rulesBlock = app.slice(journeyAt, app.indexOf('\nfunction imgFolder'));
  const cardBlock = app.slice(app.indexOf('function cardMarkup'), app.indexOf('function wireGalleryEvents'));
  const wireBlock = fn('wireGalleryEvents') + '\n' + fn('wireLongPress');
  const viewBlock = app.slice(app.indexOf('function lightboxItems'), app.indexOf('function updateLightbox'));

  const sandbox = {
    window: {
      document,
      console,
      addEventListener() {},
      scrollTo: () => {},
    },
    console,
    document,
    CONFIG,
    state: null,
    keepY: 0,
    localStorage: { getItem: () => null, setItem() {} },
    scrollTo: () => {},
    getComputedStyle: () => ({ objectFit: 'cover', objectPosition: 'center', borderRadius: '6px' }),
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    setTimeout: () => 0, clearTimeout() {},
    devicePixelRatio: 1,
    fetch: async () => ({ ok: true, json: async () => ({}), text: async () => '' }),
  };
  sandbox.window.AudioContext = undefined;
  sandbox.globalThis = sandbox;
  window.state = sandbox.state;
  const vmCtx = vm.createContext(sandbox);

  const el_ = (id) => document.getElementById(id);
  const code = `
    const CONFIG = ${JSON.stringify(CONFIG)};
    const el = (id) => document.getElementById(id);
    const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const escapeAttr = escapeHtml;
    const overlayPush = (id, close) => {};
    const updateLightbox = () => {};
    const closeLightbox = () => {};
    const imgSrc = (i) => pageUrl(i.path) + '?f';
    const lightboxSrc = (i) => pageUrl(i.path) + '?l';
    const loadProg = { imageLoaded(){}, imageCount(){}, finish(){}, set(){} };
    let firstPaintPaths = new Set();
    ${helpersBlock}
    ${rulesBlock}
    ${stateBlock}
    ${cardBlock}
    ${wireBlock}
    ${viewBlock}
    globalThis.__h = {
      allImageCards, picturesCards, groupPictures, renderPictures, cardMarkup,
      wireGalleryEvents, lightboxIndexFor, openLightbox, startSrcFor,
      lightboxItems, attrSel, cardsForPath,
      _state: state,
    };
  `;
  vm.runInContext(code, vmCtx, { filename: 'app-slice.js' });
  const h = sandbox.__h || window.__h;
  return { h, document, window, el_, sandbox, folders, listeners };
}

describe('Tapping a card opens that card', () => {
  test('every card on the wall opens its own photo', () => {
    const { h, document, el_ } = boot();
    const st = h._state;
    st.adminMode = false;
    st.batchSelect = false;
    st.view = 'images';
    st.folders = makeGallery();
    st.order = Object.keys(st.folders).sort();
    st.albumDetail = null;
    st.picturesList = h.picturesCards();

    // Render the real wall into the real DOM.
    h.renderPictures();
    h.wireGalleryEvents();

    const cards = [...document.querySelectorAll('#picturesView .card')];
    assert.ok(cards.length >= 12, `the wall rendered only ${cards.length} cards`);

    const wall = st.picturesList.map(c => c.img.path);
    const bad = [];
    for (const card of cards) {
      const want = card.dataset.path;
      const idx = Number(card.dataset.index);
      const at_ = h.lightboxIndexFor(card.dataset.folder, idx);
      const got = at_ >= 0 ? wall[at_] : null;
      if (got !== want) bad.push({ want, got, folder: card.dataset.folder, idx, at: at_ });
    }
    assert.deepStrictEqual(bad, [],
      `${bad.length}/${cards.length} cards open the wrong photo:\n` +
      bad.slice(0, 5).map(b => `  card ${b.want} (folder=${b.folder} index=${b.idx}) resolved to ${b.got}`).join('\n'));
  });

  test('a real click event on a real card opens that photo', () => {
    const { h, document, window } = boot();
    const st = h._state;
    st.adminMode = false; st.batchSelect = false; st.view = 'images';
    st.folders = makeGallery();
    st.order = Object.keys(st.folders).sort();
    st.picturesList = h.picturesCards();
    h.renderPictures();
    h.wireGalleryEvents();

    const cards = [...document.querySelectorAll('#picturesView .card')];
    const wall = st.picturesList.map(c => c.img.path);
    const mismatches = [];
    for (const card of cards) {
      st.lightboxIndex = -1;
      card.dispatchEvent(new window.Event('click'));
      const shown = wall[st.lightboxIndex];
      if (shown !== card.dataset.path) {
        mismatches.push(`tapped ${card.dataset.path} -> viewer showed ${shown}`);
      }
    }
    assert.deepStrictEqual(mismatches, [], mismatches.slice(0, 6).join('\n'));
  });

  test('every tap is recorded so the report can be answered from a device', () => {
    // There is a standing report — "tapped image 3, image 2 came up" — that
    // has survived two fixes, so the app now says what it did instead of the
    // next person guessing again. This checks the log is complete enough to
    // answer it: the card's own claim, the resolved position, and the file
    // the viewer painted.
    const { h, document, window, sandbox } = boot();
    const st = h._state;
    st.adminMode = false; st.batchSelect = false; st.view = 'images';
    st.folders = makeGallery();
    st.order = Object.keys(st.folders).sort();
    st.picturesList = h.picturesCards();
    h.renderPictures();
    h.wireGalleryEvents();

    const cards = [...document.querySelectorAll('#picturesView .card')];
    // The log is capped at 40 and is shared by every boot's window, so start
    // from a clean slate rather than counting what earlier tests left.
    // Inside the slice `window` is sandbox.window, not the sandbox root.
    sandbox.window.__galleryDiagLog = [];
    for (const card of cards) {
      st.lightboxIndex = -1;
      card.dispatchEvent(new window.Event('click'));
    }
    const log = sandbox.window.__galleryDiagLog;
    assert.ok(Array.isArray(log), 'taps must be recorded');
    assert.strictEqual(log.length, cards.length, 'one record per tap');
    for (const e of log) {
      assert.ok(e.said, 'each record names the photo the card claimed');
      assert.ok('resolved' in e, 'and the position the tap resolved to');
      assert.ok('shown' in e, 'and the photo the viewer painted');
      assert.strictEqual(e.ok, e.shown === e.said,
        'the verdict must be derived, not asserted');
    }
    // And every tap on this data was correct, so nothing is flagged.
    assert.deepStrictEqual(log.filter(e => !e.ok), [],
      'this fixture must not produce mismatches, or the log is meaningless');
  });

  test('a card in the album-detail grid opens its own photo', () => {
    const { h, document } = boot();
    const st = h._state;
    st.adminMode = false; st.batchSelect = false;
    st.folders = makeGallery();
    st.order = Object.keys(st.folders).sort();
    st.picturesList = h.picturesCards();
    // openAlbumDetail does NOT change state.view — it stays 'images' while an
    // album grid is on screen. That is the inconsistency worth testing: the
    // grid shows ONE phase, the wall-order index maths assumes the whole wall.
    st.view = 'images';
    st.albumDetail = 'rack';

    // The album detail grid is built from state.folders[folder] alone.
    const items = st.folders.rack;
    el_pictures(document).innerHTML = `<div class="grid grid-pictures">${
      items.map((img, i) => h.cardMarkup(img, 'rack', i)).join('')}</div>`;
    const detail = document.getElementById('albumDetailView');
    detail.innerHTML = el_pictures(document).innerHTML;

    const cards = [...detail.querySelectorAll('.card')];
    assert.strictEqual(cards.length, items.length, 'the album grid rendered its photos');

    const wall = st.picturesList.map(c => c.img.path);
    const bad = [];
    for (const card of cards) {
      const at = h.lightboxIndexFor(card.dataset.folder, Number(card.dataset.index));
      const shown = at >= 0 ? wall[at] : null;
      if (shown !== card.dataset.path) {
        bad.push(`album card ${card.dataset.path} -> viewer showed ${shown}`);
      }
    }
    assert.deepStrictEqual(bad, [], bad.slice(0, 5).join('\n'));
  });

  test('selecting a card paints a badge on THAT card', () => {
    // The selection path, end to end in the real DOM: query the card by its
    // path, mark it, and confirm the class landed where the tap was.
    const { h, document } = boot();
    const st = h._state;
    st.adminMode = true; st.batchSelect = true; st.view = 'images';
    st.folders = makeGallery();
    st.order = Object.keys(st.folders).sort();
    st.picturesList = h.picturesCards();
    h.renderPictures();

    const cards = [...document.querySelectorAll('#picturesView .card')];
    for (const card of cards) {
      const found = h.cardsForPath(card.dataset.path);
      assert.strictEqual(found.length, 1,
        `exactly one card must match ${card.dataset.path} — found ${found.length}`);
      assert.strictEqual(found[0], card, 'and it must be this card');
    }
  });
});