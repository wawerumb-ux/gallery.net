/* The album a file is filed under, in the Confirm upload dialog.

   Each row used to end in a native <select> listing every album flat, in the
   order the repo's folders happened to be in — the one the classifier could
   not place showing "General", the catch-all, while General sat last in the
   open list. Measured at 412 wide: the row carrying a suggestion ("suggested:
   phase-1 · Rack / Cabinet Installation") pushed its select left to
   [72, 261] while every other row sat at [162, 350], and the hint ran out to
   x = 585 — 221px past the card's right edge, clipped mid-word by
   #uploadPickList (clientWidth 316, scrollWidth 537).

   The row now ends in a dropdown: one box, small when closed, and its list
   opens *inside that box* — not as a second surface parked under the row.
   Two labelled groups, the album in force carrying the tick. What is worth
   guarding here is what the options DECIDE, because filing 40 photos into
   the wrong album is a commit, and a commit is history:

     · The grouping — the albums the journey maps run in journey order, and
       the ones it does not (General among them) follow. Nothing may be
       offered twice and nothing may fall out.
     · The label — an album goes by its stage name, or by its folder where
       two offered albums share that stage; two options reading the same
       words is a choice nobody can make.
     · The choice — the option writes the row's choice in state, and the
       upload reads it back from there. A dialog that reads its answer out
       of the DOM loses it the moment the list closes over it.
*/

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const rawCss = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

/* Every leaf rule, with the @media condition it sits under ('' at top
   level). Brace-matched, so @keyframes bodies are consumed whole. */
function leafRules(sheet, cond = '', out = []) {
  let i = 0;
  while (i < sheet.length) {
    const open = sheet.indexOf('{', i);
    if (open < 0) break;
    const prelude = sheet.slice(i, open).replace(/\s+/g, ' ').trim();
    let depth = 1, j = open + 1;
    while (j < sheet.length && depth > 0) {
      if (sheet[j] === '{') depth++;
      else if (sheet[j] === '}') depth--;
      j++;
    }
    const body = sheet.slice(open + 1, j - 1);
    if (/^@(media|supports|container)/.test(prelude)) {
      leafRules(body, (cond ? cond + ' ' : '') + prelude, out);
    } else if (!prelude.startsWith('@')) {
      out.push({ cond, sel: prelude, body });
    }
    i = j;
  }
  return out;
}

const rules = leafRules(css);

/** The one rule with this exact selector under this exact condition. */
function rule(sel, cond) {
  const found = rules.filter(r => r.sel === sel && r.cond === cond);
  assert.equal(found.length, 1, `expected exactly one "${sel}" ${cond ? `in ${cond}` : 'at top level'}, got ${found.length}`);
  return found[0];
}

/* ── The dropdown replaces the select ─────────────────────────── */

describe('the upload rows offer a dropdown, not a select', () => {
  test('the native select is gone from the rows and from the stylesheet', () => {
    assert.ok(!/pick-select/.test(app), 'app.js still builds a pick-select');
    assert.ok(!/\.pick-select/.test(rawCss), 'style.css still carries the select rules');
    assert.ok(!/<select/.test(html.slice(html.indexOf('uploadPickList'), html.indexOf('uploadPickList') + 40)),
      'the pick list is still a static select');
  });

  test('the row is ONE box: a small chip, and the list inside it', () => {
    assert.match(app, /class="pick-drop"/);
    assert.match(app, /class="pick-chip" id="pickChip-\$\{i\}"/);
    assert.match(app, /aria-haspopup="listbox"/);
    assert.match(app, /class="pick-menu" id="pickMenu-\$\{i\}" role="listbox"/);
    assert.ok(!/role="dialog"/.test(app), 'the list is still a dialog — a second surface');
    // The list is built inside the dropdown box, after its own chip, not
    // parked somewhere else in the row.
    const box = app.slice(app.indexOf('class="pick-drop"'), app.indexOf('${hint}'));
    assert.match(box, /class="pick-chip"[\s\S]*class="pick-menu"/,
      'the list is not inside the dropdown it belongs to');
  });

  test('the open box stays in flow, and its list stays small', () => {
    const drop = rule('.pick-drop', '').body;
    assert.ok(!/position\s*:\s*absolute/.test(drop), 'the box floats, so the dialog clips it');
    assert.match(drop, /border-radius:\s*var\(--radius-pill\)/, 'closed, it is just a chip');
    assert.match(rule('.pick-drop.is-open', '').body, /border-radius:\s*14px/);
    // A dropdown is as wide as what is in it, up to the row.
    assert.match(drop, /max-width:\s*100%/);
    // Capped and scrolled, so 13 albums never make it a wall.
    const menu = rule('.pick-menu', '').body;
    assert.match(menu, /max-height:\s*40vh/, 'the list is uncapped');
    assert.match(menu, /max-height:\s*40dvh/, 'the list ignores the phone URL bar');
    assert.match(menu, /overflow-y:\s*auto/, 'the list cannot scroll inside the box');
    assert.match(rule('.pick-list.is-open', '').body, /max-height:\s*none/);
    // Wide, the list is far taller than its row: the name goes to the top of
    // the row instead of being centred against the list.
    assert.match(rule('.pick-row.is-open .pick-head', '').body, /align-items:\s*flex-start/);
  });

  test('the list is one line an album, and the chip stays small', () => {
    // The chip is 118px of label at the most: sizing itself to "Cable
    // Routing & Management" left the file name 77px ("20260101_…").
    assert.match(rule('.pick-chip-label', '').body, /max-width:\s*118px/);
    assert.match(rule('.pick-chip-label', '').body, /text-overflow:\s*ellipsis/);
    assert.match(rule('.pick-tile-label', '').body, /white-space:\s*nowrap/);
    assert.match(rule('.pick-tile.is-active .pick-tile-check', '').body, /opacity:\s*1/);
    assert.match(rule('.pick-tile-check', '').body, /opacity:\s*0/);
    assert.match(rule('.pick-menu-title', '').body, /text-transform:\s*uppercase/);
    // The two-across wall of tiles is gone with the panel.
    assert.ok(!rules.some(r => r.sel === '.pick-tiles'), 'the tile grid is still there');
  });

  test('the suggestion is its own line, not a clipped one', () => {
    // It used to share the row with the control and overflow the card by
    // 221px at 412 wide.
    assert.match(rule('.pick-hint', '').body, /display:\s*block/);
    assert.ok(!/nowrap/.test(rule('.pick-hint', '').body));
  });

  test('reduced motion stops the chip and the tiles', () => {
    const rm = rules.find(r => r.cond === '@media (prefers-reduced-motion: reduce)'
      && /\.pick-tile/.test(r.sel) && /\.pick-chip/.test(r.sel));
    assert.ok(rm, 'the dropdown is not in the reduced-motion block');
  });

  test('the choice is written to state, and the upload reads it back', () => {
    assert.ok(!/select\[data-idx=/.test(app), 'something still reads the select out of the DOM');
    const fn = app.slice(app.indexOf('async function performUploads'), app.indexOf('function reportUploadFailed'));
    assert.ok(fn.length > 0, 'performUploads moved \u2014 this slice needs updating');
    assert.match(fn, /phaseChoice\(i\)/, 'performUploads does not read the row\u2019s choice');
  });

  test('Escape and the back gesture put the panel away before the dialog', () => {
    assert.match(app, /overlayPush\(PICK_MENU_ID, closePhaseMenu\)/);
    assert.match(app, /overlayClose\(PICK_MENU_ID\)/);
    // The outside tap knows which row is open, and swallows its own click so
    // the same tap cannot cancel the upload behind it.
    assert.match(app, /closest\('\.pick-row\.is-open'\)/);
    assert.match(app, /state\._suppressClickUntil = Date\.now\(\) \+ CLICK_SUPPRESS_MS/);
    // Upload is the control the flag guards most: a tap that only put a panel
    // away must not file the batch. Cancel and the backdrop read it too —
    // measured, the press that collapses a panel is delivered to a different
    // element (see the comment in initUpload).
    const wiring = app.slice(app.indexOf('// Upload confirm modal'), app.indexOf('// The rows'));
    assert.equal((wiring.match(/_suppressClickUntil/g) || []).length, 3,
      'not every way out of the dialog reads the dismissal flag');
  });
});

/* ── The grouping (through the real code, in a vm) ─────────────── */

const stubEl = () => {
  const set = new Set();
  return {
    hidden: true, textContent: '', innerHTML: '', value: '', dataset: {},
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    addEventListener() {}, appendChild() {}, removeChild() {}, click() {}, remove() {},
    setAttribute() {}, getAttribute: () => null,
    querySelector: () => null, querySelectorAll: () => [], matches: () => false,
    contains: () => false, insertAdjacentHTML() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    classList: {
      add: (c) => set.add(c), remove: (c) => set.delete(c),
      toggle: (c, on) => { if (on) set.add(c); else set.delete(c); },
      contains: (c) => set.has(c),
    },
    _classes: set,
  };
};

/* app.js in a vm, with a DOM just real enough to hold the panel. */
async function boot() {
  const els = new Map();
  const get = (id) => {
    if (!els.has(id)) els.set(id, stubEl());
    return els.get(id);
  };
  const bodyEl = stubEl();
  const store = new Map();
  const sandbox = {
    TextDecoder,
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    console: { warn() {}, error() {}, log() {} },
    performance: { now: () => Date.now() },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    Blob, URL, URLSearchParams,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      getElementById: get,
      createElement: () => stubEl(),
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      body: bodyEl,
      head: { appendChild() {} },
      documentElement: { setAttribute() {}, removeAttribute() {}, style: { setProperty() {}, removeProperty() {} } },
    },
    window: {
      addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
      requestAnimationFrame: (f) => f(0), open() {}, scrollTo() {}, scrollY: 0,
    },
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => null },
      json: async () => ({}), text: async () => '{}', clone() { return this; } }),
    location: { search: '', href: '' },
  };
  vm.runInContext(await readFile(new URL('../nav.js', import.meta.url), 'utf8'),
    vm.createContext(sandbox), { filename: 'nav.js' });
  sandbox.GalleryNav = sandbox.window.GalleryNav;
  vm.runInContext(app, vm.createContext(sandbox), { filename: 'app.js' });
  const api = sandbox.window.__gallery;
  // The album set the picker is judged against: one album on its own stage,
  // two sharing a stage, and one the journey does not map at all.
  api.state.order = ['rack-build', 'site-survey', 'trunking-installation', 'really'];
  return { api, els: { get } };
}

const flat = (groups) => groups.flatMap(g => g.folders);

describe('the dropdown groups the albums by the journey', () => {
  test('Phase runs in journey order, and what the journey does not map is not offered', async () => {
    const { api } = await boot();
    const groups = api.phaseGroups();
    assert.deepEqual(groups.map(g => g.id), ['phase']);
    assert.equal(groups.length, 1);
    const [phase] = groups;
    assert.ok(phase.folders.length, 'nothing is mapped, so the panel has no phases');

    for (const f of phase.folders) assert.ok(api.journeyFor(f), `${f} is in Phase but maps to no stage`);

    const seqs = phase.folders.map(api.folderSequence);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'Phase is not in journey order');

    assert.ok(!phase.folders.includes('General'), 'General is offered — it is not a phase');
    assert.ok(!phase.folders.includes('really'), 'the unmapped album is offered — it is not a phase');
  });

  test('every album appears once, and the journey leaves its unmapped albums out', async () => {
    const { api } = await boot();
    const offered = flat(api.phaseGroups()).slice().sort();
    assert.deepEqual(offered, [...new Set(offered)].sort(), 'an album is offered twice');
    // General is a catch-all, not a phase, and 'really' maps to no stage:
    // neither is offered. The mapped albums are exactly what is on offer.
    const mapped = api.allPhaseOptions().filter(f => api.journeyFor(f)).slice().sort();
    assert.deepEqual(offered, mapped, 'an unmapped album slipped in, or a mapped one fell out');
  });

  test('the album the files were added to is on offer, unmapped or not', async () => {
    const { api } = await boot();
    const groups = api.phaseGroups('brand-new');
    assert.ok(flat(groups).includes('brand-new'), 'the context album is not on offer');
    assert.ok(groups.find(g => g.id === 'phase').folders.includes('brand-new'),
      'the unmapped context album is not in the phase group');
    const mapped = api.phaseGroups('cable-pull');
    assert.ok(mapped.find(g => g.id === 'phase').folders.includes('cable-pull'));
    // A mapped context is already in the list, so it is never offered twice.
    assert.equal(flat(mapped).filter(f => f === 'cable-pull').length, 1, 'cable-pull is offered twice');
  });

  test('an album goes by its stage, and by its folder where two share that stage', async () => {
    const { api } = await boot();
    api.state.order = ['site-survey', 'site-survey-map'];
    const offered = api.allPhaseOptions();
    const labels = flat(api.phaseGroups()).map(f => api.phaseLabel(f, offered));
    assert.equal(new Set(labels).size, labels.length, 'two options read the same words');

    // Alone on its stage it shows the stage name; sharing it, the folder.
    assert.equal(api.phaseLabel('cable-pull', ['cable-pull']), api.journeyFor('cable-pull').stage);
    assert.equal(api.phaseLabel('site-survey', ['site-survey', 'site-survey-map']), 'site-survey');
    // An album the journey does not map is simply its folder name.
    assert.equal(api.phaseLabel('General', offered), 'General');
    assert.equal(api.phaseLabel('really', offered), 'really');
  });
});

/* ── The options on the list (rendered into stub elements) ─────── */

describe('an option writes the row\u2019s choice', () => {
  test('the dropdown renders one labelled group of options', async () => {
    const { api, els } = await boot();
    api.state.pendingUploads = { files: [{ name: 'a.jpg' }], context: null, choice: ['rack-build'] };
    api.togglePhaseMenu(0);
    const markup = els.get('pickMenu-0').innerHTML;
    assert.match(markup, /class="pick-menu-group" role="group" aria-labelledby="pickMenuTitle-0-phase"/);
    assert.match(markup, /id="pickMenuTitle-0-phase">Phase</);
    assert.ok(!/id="pickMenuTitle-0-other">Other</.test(markup), 'there is no Other group');
    // 'really' maps to no stage, so it is not offered. General is not a phase either.
    assert.ok(!/data-value="really"/.test(markup), 'the unmapped album is offered');
    assert.ok(!/data-value="General"/.test(markup), 'General is offered');
    assert.match(markup, /class="pick-tile is-active" role="option" aria-selected="true" data-idx="0" data-value="rack-build"/,
      'the album in force is not marked');
    // The journey step rides on the option.
    assert.match(markup, /data-value="cable-pull"[\s\S]*?<span class="pick-tile-art">4<\/span>/);
  });

  test('picking writes the choice and repaints the chip', async () => {
    const { api, els } = await boot();
    api.state.pendingUploads = { files: [{ name: 'a.jpg' }], context: null, choice: ['General'] };
    api.pickPhase(0, 'cable-pull');
    assert.equal(api.state.pendingUploads.choice[0], 'cable-pull');
    assert.equal(els.get('pickChipLabel-0').textContent,
      api.phaseLabel('cable-pull', api.allPhaseOptions()));
    // An unmapped album keeps its own name on the chip.
    api.pickPhase(0, 'really');
    assert.equal(els.get('pickChipLabel-0').textContent, 'really');
  });

  test('the row\u2019s choice survives the panel closing', async () => {
    const { api } = await boot();
    api.state.pendingUploads = { files: [{ name: 'a.jpg' }], context: null, choice: ['General'] };
    api.togglePhaseMenu(0);
    api.pickPhase(0, 'rack-build');
    api.closePhaseMenu();
    assert.equal(api.state.pendingUploads.choice[0], 'rack-build');
  });
});
