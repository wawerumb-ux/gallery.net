/* The pill's two view preferences — how many photos a row holds, and which
   end of the archive the wall starts at — are native <select>s wearing
   .pick-select, the same dropdown the confirm-upload dialog uses for a
   phase. One dropdown in the app rather than two ideas of one, and nothing
   of ours drops over the wall: the list that opens is the platform's.

   The markup is the easy half and the browser check covers it. What is
   worth guarding here is what the lists DO, because a wrong sort ruins a
   300-photo wall quietly:

     · Order — the wall runs newest first, oldest first or A–Z, and the DAY
       groups have to run the same way. A wall whose photos are oldest-first
       inside days that are newest-first reads as two orders disagreeing at
       once, and every date heading looks wrong.
     · View — Cozy and Large have to state a count at every breakpoint the
       base ladder does, or a phone gets one tile the width of the column.
     · The value — the select has to SHOW what is in force, and a value
       remembered by an older build must not leave it blank.
     · No scope — the filter must judge photos and albums by the query alone.
       A filter still branching on a scope no panel offers any more silently
       hides half the archive.
*/

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const rawCss = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

/* Every leaf rule, with the @media/@supports condition it sits under ('' at
   top level). Brace-matched, so @keyframes and @font-face bodies — which
   carry braces of their own — are consumed whole rather than desyncing
   everything after them. */
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

const gridCount = (body) => {
  const m = /grid-template-columns:\s*repeat\((\d+),/.exec(body);
  assert.ok(m, `no repeat(<n>, …) in "${body}"`);
  return Number(m[1]);
};

/* ── The pill's dropdown is the upload dialog's dropdown ───── */

describe('the pill carries the same dropdown the upload dialog does', () => {
  test('the native scope select is still gone', () => {
    assert.ok(!/adminSearchFilter/.test(html), 'the scope select is back in index.html');
    assert.ok(!/adminSearchFilter/.test(app), 'app.js still reaches for the scope select');
  });

  test('both preferences are native selects wearing .pick-select', () => {
    const size = html.match(/<select[^>]*id="viewSizeSelect"[^>]*>/);
    const order = html.match(/<select[^>]*id="viewOrderSelect"[^>]*>/);
    assert.ok(size, 'no viewSizeSelect');
    assert.ok(order, 'no viewOrderSelect');
    // The class is the whole point: this is the confirmation dialog's
    // control, so its dress lives in the one rule it wears there.
    assert.match(size[0], /class="pick-select search-select"/, 'the view select does not wear .pick-select');
    assert.match(order[0], /class="pick-select search-select"/, 'the order select does not wear .pick-select');
    assert.match(size[0], /data-tour-target="admin-view-options"/, 'the tour has nothing to point at');
    const pill = html.slice(html.indexOf('id="searchWrap"'), html.indexOf('</header>'));
    assert.ok(pill.includes('id="viewSizeSelect"') && pill.includes('id="viewOrderSelect"'),
      'a select sits outside the pill');
  });

  test('no custom panel survives — nothing of ours drops over the wall', () => {
    assert.ok(!/searchMenu|search-menu|search-tile|search-view/.test(html + css + app),
      'the tile panel is still somewhere in the app');
  });

  test('the pill adds room-keeping, not a second dress', () => {
    const sel = rule('.search-select', '').body;
    // Every visual property has to come from .pick-select. If one is
    // restated here the two controls can drift apart, which is the thing
    // "match the other dropdown" was asking for.
    for (const prop of ['background', 'border', 'border-radius', 'color', 'font-size', 'font-family', 'padding']) {
      assert.ok(!new RegExp(`(^|;)\\s*${prop}\\s*:`).test(sel), `.search-select restates ${prop}`);
    }
    assert.match(sel, /flex-shrink:\s*0/);
    // And the dress really is the dialog's one rule.
    assert.match(rule('.pick-select', '').body, /border-radius:\s*var\(--radius-pill\)/);
    assert.ok(/class="pick-select"/.test(app), 'the dialog no longer builds a .pick-select to match');
  });
});

describe('the search has no scope to pick, so it searches both', () => {
  test('applyAdminFilter filters every kind of result by the query alone', () => {
    const fn = app.slice(app.indexOf('function applyAdminFilter()'), app.indexOf('function cardMarkup('));
    assert.ok(!/scope/.test(fn), 'the filter still branches on a scope');
    // Both kinds of result are judged by the same rule: the query, or all.
    assert.equal((fn.match(/const show = !q \|\| \(/g) || []).length, 3);
    assert.ok(!/scope !== /.test(fn));
    // And the scope preference is gone from the app entirely.
    assert.ok(!/SEARCH_SCOPE|searchScope|applySearchScope/.test(app), 'a scope preference is still living in app.js');
  });

  test('the two view preferences have a home in state', () => {
    assert.match(app, /viewSize: 'comfy'/);
    assert.match(app, /viewOrder: 'newest'/);
  });

  test('both are read back before the first render, and persisted on a pick', () => {
    const loader = app.slice(app.indexOf('function loadViewPrefs()'), app.indexOf('function applyAdminFilter('));
    for (const key of ['VIEW_SIZE_KEY', 'VIEW_ORDER_KEY']) {
      assert.ok(loader.includes(key), `loadViewPrefs never reads ${key}`);
    }
    for (const fn of ['applyViewSize', 'applyViewOrder']) {
      const body = app.slice(app.indexOf(`function ${fn}(`));
      assert.ok(body.slice(0, 600).includes('rememberPref('), `${fn} never persists`);
    }
    // init(), ahead of the tree load — there is no frame of the default.
    const init = app.slice(app.indexOf('async function init()'));
    assert.ok(init.indexOf('loadViewPrefs()') < init.indexOf('loadTree('), 'the preferences are read after the tree');
  });

  test('a remembered value the select no longer offers falls back', () => {
    for (const [fn, selId, fallback] of [
      ['applyViewSize', 'viewSizeSelect', 'comfy'],
      ['applyViewOrder', 'viewOrderSelect', 'newest'],
    ]) {
      const body = app.slice(app.indexOf(`function ${fn}(`)).slice(0, 420);
      assert.ok(body.includes(`el('${selId}')`), `${fn} does not read the ${selId} select`);
      assert.match(body, /offeredBy\(sel, id\)/, `${fn} trusts the stored value`);
      assert.ok(body.includes(`: '${fallback}'`), `${fn} has no default to fall back to`);
    }
    // offeredBy asks the select itself. A list kept beside the options can
    // drift from what the control really offers, and then a remembered value
    // that IS offered falls back for no reason — or worse, one that is not
    // is written in and blanks the control.
    const by = app.slice(app.indexOf('function offeredBy(')).slice(0, 300);
    assert.ok(by.includes('.options'), 'offeredBy does not ask the select what it offers');
  });
});

/* ── Cozy and Large cover every breakpoint the ladder does ── */

describe('the view sizes state a count everywhere the ladder does', () => {
  const ladder = rules.filter(r => r.sel === '.grid-pictures' && /grid-template-columns/.test(r.body));
  const ladderConds = ladder.map(r => r.cond);

  test('the base ladder still has its five steps', () => {
    assert.deepEqual(ladderConds.slice().sort(), [
      '',
      '@media (max-width: 380px)',
      '@media (pointer: coarse) and (orientation: landscape) and (min-width: 600px)',
      '@media (pointer: fine) and (min-width: 1500px)',
      '@media (pointer: fine) and (min-width: 600px)',
    ].sort());
  });

  test('the wall is denser at Cozy and looser at Large, at every step', () => {
    for (const cond of ladderConds) {
      const base = gridCount(rule('.grid-pictures', cond).body);
      const cozy = gridCount(rule('body.view-cozy .grid-pictures', cond).body);
      const large = gridCount(rule('body.view-large .grid-pictures', cond).body);
      assert.ok(cozy > base, `Cozy is not denser than the default at "${cond || 'base'}"`);
      assert.ok(large < base, `Large is not looser than the default at "${cond || 'base'}"`);
      // One tile across the column is not a view, it is a column.
      assert.ok(large >= 2, `Large leaves ${large} across at "${cond || 'base'}"`);
    }
  });

  test('the album grid steps with the wall, except where it cannot', () => {
    for (const cond of ladderConds) {
      const base = gridCount(rule('.grid-albums', cond).body);
      const large = gridCount(rule('body.view-large .grid-albums', cond).body);
      assert.ok(large < base, `Large does not loosen the covers at "${cond || 'base'}"`);
      // Cozy covers: four across a 380px column, with two lines of name
      // beneath each, will not fit — so that one step is deliberately absent.
      if (cond === '@media (max-width: 380px)') {
        assert.equal(rules.filter(r => r.sel === 'body.view-cozy .grid-albums' && r.cond === cond).length, 0);
      } else {
        assert.ok(gridCount(rule('body.view-cozy .grid-albums', cond).body) > base,
          `Cozy does not densify the covers at "${cond || 'base'}"`);
      }
    }
  });

  test('the sizes are opt-in — no view class is baked into the markup', () => {
    const bodyTag = html.match(/<body[^>]*>/);
    assert.ok(bodyTag, 'no <body> tag');
    assert.ok(!/view-cozy|view-large/.test(bodyTag[0]),
      'a view size is painted into the markup, so the untouched archive is not untouched');
  });
});

/* ── What the lists do to the wall (through the real code) ─── */

/* The two selects in the pill, and the options their markup carries — read
   out of index.html, so the stub below cannot disagree with the markup. */
const VIEW_SELECTS = ['viewSizeSelect', 'viewOrderSelect'];

function optionsOf(selectId) {
  const from = html.indexOf(`id="${selectId}"`);
  assert.ok(from > 0, `no ${selectId} in index.html`);
  const block = html.slice(from, html.indexOf('</select>', from));
  return [...block.matchAll(/<option value="([^"]+)"/g)].map(m => ({ value: m[1] }));
}

const stubEl = () => {
  const set = new Set();
  return {
    hidden: true, textContent: '', innerHTML: '', value: '', dataset: {},
    options: [],
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

/* app.js in a vm, with a DOM just real enough to hold the pill. */
async function boot() {
  const els = new Map();
  const get = (id) => {
    if (!els.has(id)) {
      const el = stubEl();
      // The two selects answer with the options their markup really carries
      // (read below), so the stub cannot disagree with index.html about what
      // is offered — which is the thing offeredBy() checks.
      if (VIEW_SELECTS.includes(id)) el.options = optionsOf(id);
      els.set(id, el);
    }
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
  api.state.order = ['A', 'B'];
  api.state.folders = {
    A: [{ name: '20260101_090000.jpg', path: 'A/early.jpg' },
        { name: 'IMG-20260305-WA0001.jpg', path: 'A/whatsapp.jpg' }],
    B: [{ name: '20260110_120000.jpg', path: 'B/middle.jpg' },
        { name: 'holiday.jpg', path: 'B/named.jpg' }],
  };
  return { api, els: { get }, store, bodyClasses: bodyEl._classes };
}

const names = (api) => api.picturesCards().map(c => c.img.name);
const dayKeys = (api) => api.groupPictures(api.picturesCards()).map(g => g.iso || 'undated');

describe('the Order list reaches the wall', () => {
  test('newest first is the default, and it is what the wall always did', async () => {
    const { api } = await boot();
    assert.deepEqual(names(api), [
      'IMG-20260305-WA0001.jpg', '20260110_120000.jpg', '20260101_090000.jpg', 'holiday.jpg',
    ]);
    assert.deepEqual(dayKeys(api), ['2026-03-05', '2026-01-10', '2026-01-01', 'undated']);
  });

  test('Oldest reverses the photos AND the day headings', async () => {
    const { api } = await boot();
    api.applyViewOrder('oldest', false);
    // The undated photo has no timestamp at all, so it leads the flat list —
    // but the wall still files it under "Undated" at the foot (below).
    assert.deepEqual(names(api), [
      'holiday.jpg', '20260101_090000.jpg', '20260110_120000.jpg', 'IMG-20260305-WA0001.jpg',
    ]);
    assert.deepEqual(dayKeys(api), ['2026-01-01', '2026-01-10', '2026-03-05', 'undated']);
  });

  test('A–Z sorts by name inside the days and keeps them newest-first', async () => {
    const { api } = await boot();
    api.applyViewOrder('name', false);
    // Collated, so the case does not split the run: holiday sorts before
    // IMG-…, and both sort after the numeric names.
    assert.deepEqual(names(api), [
      '20260101_090000.jpg', '20260110_120000.jpg', 'holiday.jpg', 'IMG-20260305-WA0001.jpg',
    ]);
    // The date still orders the sections: A–Z has nothing to say about which
    // evening should be read first, and the reader expects the latest on top.
    assert.deepEqual(dayKeys(api), ['2026-03-05', '2026-01-10', '2026-01-01', 'undated']);
  });

  test('Undated is last whichever way the wall runs', async () => {
    const { api } = await boot();
    for (const order of ['newest', 'oldest', 'name']) {
      api.applyViewOrder(order, false);
      assert.equal(dayKeys(api).pop(), 'undated', `Undated is not last under ${order}`);
    }
  });

  test('an order the select does not offer falls back to newest', async () => {
    const { api } = await boot();
    api.applyViewOrder('sideways', false);
    assert.equal(api.state.viewOrder, 'newest');
  });

  test('a pick remembers the order on the device', async () => {
    const { api, store } = await boot();
    api.applyViewOrder('oldest', true);
    assert.equal(store.get('gallery.viewOrder'), 'oldest');
  });
});

describe('the View list sets the wall density', () => {
  test('Cozy and Large put a class on the body, Comfy takes both off', async () => {
    const { api, bodyClasses } = await boot();
    api.applyViewSize('cozy', true);
    assert.ok(bodyClasses.has('view-cozy') && !bodyClasses.has('view-large'));
    api.applyViewSize('large', true);
    assert.ok(bodyClasses.has('view-large') && !bodyClasses.has('view-cozy'));
    api.applyViewSize('comfy', true);
    assert.ok(!bodyClasses.has('view-cozy') && !bodyClasses.has('view-large'));
  });

  test('the default view carries no class at all', async () => {
    const { api, bodyClasses } = await boot();
    api.applyViewSize('what', false);
    assert.equal(api.state.viewSize, 'comfy');
    assert.ok(!bodyClasses.has('view-cozy') && !bodyClasses.has('view-large'),
      'the default view is painting a class, so the untouched archive is not untouched');
  });

  test('a pick remembers the view on the device', async () => {
    const { api, store } = await boot();
    api.applyViewSize('large', true);
    assert.equal(store.get('gallery.viewSize'), 'large');
  });
});

describe('the pill lists offer exactly what the wall understands', () => {
  test('three sizes, three orders, and no scope anywhere', () => {
    assert.deepEqual(optionsOf('viewSizeSelect'), [{ value: 'cozy' }, { value: 'comfy' }, { value: 'large' }]);
    assert.deepEqual(optionsOf('viewOrderSelect'), [{ value: 'newest' }, { value: 'oldest' }, { value: 'name' }]);
    // The scope is gone from the control as well as from the code that
    // judged it: one query, both kinds of result.
    const pill = html.slice(html.indexOf('id="searchWrap"'), html.indexOf('</header>'));
    assert.ok(!/Search in|scope/.test(pill), 'a scope control is back in the pill');
  });

  test('the control shows what is in force', async () => {
    const { api, els } = await boot();
    api.applyViewSize('large', false);
    api.applyViewOrder('oldest', false);
    assert.equal(els.get('viewSizeSelect').value, 'large', 'the size select does not show the size in force');
    assert.equal(els.get('viewOrderSelect').value, 'oldest', 'the order select does not show the order in force');
  });

  test('a value no build offers leaves the control on the default, never blank', async () => {
    const { api, els } = await boot();
    api.applyViewSize('enormous', false);
    api.applyViewOrder('sideways', false);
    assert.equal(els.get('viewSizeSelect').value, 'comfy');
    assert.equal(els.get('viewOrderSelect').value, 'newest');
  });

  test('a pick is a change event, and it is persisted', () => {
    const wire = app.slice(app.indexOf("el('viewSizeSelect')"), app.indexOf("el('fabAdd')"));
    for (const id of ['viewSizeSelect', 'viewOrderSelect']) {
      assert.ok(wire.includes(`el('${id}').addEventListener('change'`), `${id} has no change listener`);
    }
    assert.ok(wire.includes('applyViewSize(e.target.value, true)'), 'a size pick is not persisted');
    assert.ok(wire.includes('applyViewOrder(e.target.value, true)'), 'an order pick is not persisted');
  });

  test('nothing opens a panel or swallows a tap any more', () => {
    // The old panel needed an outside-tap listener and a click-suppress flag
    // so that dismissing it against the wall did not open the viewer as
    // well. A native dropdown needs neither, and a leftover document-wide
    // pointerdown would be a tap-eater on every card.
    assert.ok(!/toggleSearchMenu|closeSearchMenu|setSearchMenuOpen|renderSearchMenu|pickSearchOption/.test(app));
    assert.ok(!/closest\('#searchMenu'\)|closest\('#searchViewBtn'\)/.test(app));
  });
});

/* ── On a phone the pill takes a second row for the lists ──
   Two lists and a usable search box do not fit in one 44px row on a phone:
   at 320 wide the box would be left ~49px, which is not a search box. There
   the pill is two rows — the search and its count on top, the two lists
   under it, right-aligned where the thumb already is. Nothing floats and
   nothing overlays; it is the same two controls, given a row of their own.

   These guard what makes that true: the phone pill is a GRID with the search
   row still exactly 44px, so nothing under the thumb moves when the second
   row arrives, and the count reserves its width because it is the one thing
   in the row that changes while you type — the lists hang off the same
   track, and without that they would slide sideways under the thumb. */

describe('a phone gets a second row of the pill, not a sheet over the wall', () => {
  const phone = '@media (max-width: 480px)';

  test('the pill is a grid on a phone, and a plain row everywhere else', () => {
    const pill = rule('.search-pill', phone).body;
    assert.match(pill, /display:\s*grid/);
    assert.match(pill, /grid-template-rows:\s*44px auto/);
    assert.match(pill, /height:\s*auto/);
    assert.match(pill, /grid-template-areas:[\s\S]*'\. view order'/);
    const wide = rule('.search-pill', '').body;
    assert.match(wide, /display:\s*flex/);
    assert.ok(!/grid/.test(wide), 'the one-row pill is a grid too');
  });

  test('the search row keeps its 44px and its count reserves its space', () => {
    const count = rule('.search-pill .search-count', phone).body;
    assert.match(count, /grid-area:\s*count/);
    assert.match(count, /min-width:\s*52px/);
    assert.match(rule('.search-pill .search-ic', phone).body, /grid-area:\s*ic/);
    assert.match(rule('.search-pill input', phone).body, /grid-area:\s*input/);
  });

  test('both lists sit at the right-hand edge of the second row', () => {
    assert.match(rule('#viewSizeSelect', phone).body, /grid-area:\s*view/);
    assert.match(rule('#viewOrderSelect', phone).body, /grid-area:\s*order/);
    assert.match(rule('#viewSizeSelect', phone).body, /justify-self:\s*end/);
    assert.match(rule('#viewOrderSelect', phone).body, /justify-self:\s*end/);
  });

  test('no floating panel survives anywhere to cover the wall', () => {
    assert.ok(!/position:\s*absolute/.test(rule('.search-pill', '').body));
    assert.ok(!rules.some(r => /\.search-(menu|tile)/.test(r.sel)), 'a panel rule survives');
  });
});
