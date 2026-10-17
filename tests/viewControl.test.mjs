/* The search pill used to carry a scope <select> — All, Photos, Albums — and
   the search now looks through both at once, the way its placeholder always
   said. What the pill carries instead is the S10 Gallery's view and
   arrangement chooser: a panel of tiles that drops from an icon button, and
   two preferences the archive remembers per device.

   The markup is the easy half and the browser check covers it. What is
   worth guarding here is what the tiles DO, because a wrong sort ruins a
   300-photo wall quietly:

     · Order — the wall runs newest first, oldest first or A–Z, and the DAY
       groups have to run the same way. A wall whose photos are oldest-first
       inside days that are newest-first reads as two orders disagreeing at
       once, and every date heading looks wrong.
     · View — Cozy and Large have to state a count at every breakpoint the
       base ladder does, or a phone gets one tile the width of the column.
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

/* ── The panel replaces the select ─────────────────────────── */

describe('the search pill offers a panel, not a select', () => {
  test('the native scope select is gone', () => {
    assert.ok(!/<select[^>]*adminSearchFilter/.test(html), 'the select is still in index.html');
    assert.ok(!/<option value="phase">/.test(html), 'the select options are still in index.html');
    assert.ok(!/adminSearchFilter/.test(app), 'app.js still reaches for the select');
  });

  test('the button carries the tour hook, and it is an icon button now', () => {
    const btn = html.match(/<button[^>]*id="searchViewBtn"[^>]*>/);
    assert.ok(btn, 'no searchViewBtn button');
    assert.match(btn[0], /data-tour-target="admin-view-options"/);
    assert.match(btn[0], /aria-haspopup="dialog"/);
    assert.match(btn[0], /aria-expanded="false"/);
    assert.match(btn[0], /aria-label="View and arrange"/);
    assert.match(btn[0], /title="View and arrange"/);
    // With the scope gone the chip has no label to read; it is the tune
    // glyph, the same one the ⋮ menus use for "adjust this".
    assert.match(html, /class="search-view-ic"/);
    assert.ok(!/searchViewLabel/.test(html + app), 'a scope label is still being written');
  });

  test('the panel starts hidden and lives inside the pill it drops from', () => {
    const menu = html.match(/<div[^>]*id="searchMenu"[^>]*>/);
    assert.ok(menu, 'no searchMenu panel');
    assert.match(menu[0], /hidden/);
    assert.match(menu[0], /role="dialog"/);
    const pill = html.slice(html.indexOf('id="searchWrap"'), html.indexOf('</header>'));
    assert.ok(pill.includes('id="searchMenu"'), 'the panel is outside the pill, so it cannot anchor to it');
  });

  test('the panel is positioned against the pill, not the viewport', () => {
    assert.match(rule('.search-pill', '').body, /position:\s*relative/);
    const menu = rule('.search-menu', '').body;
    assert.match(menu, /position:\s*absolute/);
    assert.match(menu, /right:\s*0/);
    assert.match(menu, /top:\s*calc\(100% \+ 8px\)/);
    assert.ok(!/bottom\s*:/.test(menu), 'the panel is pinned to the viewport bottom, not the pill');
  });

  test('the tiles are a three-across grid, one check per group', () => {
    assert.equal(gridCount(rule('.search-tiles', '').body), 3);
    assert.match(rule('.search-tile.is-active', '').body, /border-color:\s*var\(--accent-text\)/);
    assert.match(rule('.search-tile.is-active .search-tile-check', '').body, /opacity:\s*1/);
    assert.match(rule('.search-tile-check', '').body, /opacity:\s*0/);
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
    const loader = app.slice(app.indexOf('function loadViewPrefs()'), app.indexOf('function renderSearchMenu()'));
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

  test('a remembered value the panel no longer offers falls back', () => {
    for (const fn of ['applyViewSize', 'applyViewOrder']) {
      const body = app.slice(app.indexOf(`function ${fn}(`));
      assert.match(body.slice(0, 400), /offersId\('(size|order)', id\)/, `${fn} trusts the stored value`);
    }
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

  test('neither size is on by default, and reduced motion stops the panel', () => {
    const rm = rules.find(r => r.cond === '@media (prefers-reduced-motion: reduce)'
      && /\.search-menu/.test(r.sel) && /\.search-tile/.test(r.sel));
    assert.ok(rm, 'the panel is not in the reduced-motion block');
  });
});

/* ── What the tiles do to the wall (through the real code) ─── */

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

describe('the Order tiles reach the wall', () => {
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

  test('an order the panel no longer offers falls back to newest', async () => {
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

describe('the View tiles set the wall density', () => {
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

describe('the Search-in tiles are gone', () => {
  test('the panel offers View and Order, and nothing else', async () => {
    const { api } = await boot();
    assert.deepEqual(api.SEARCH_MENU.map(g => g.group), ['size', 'order']);
    assert.deepEqual(api.SEARCH_MENU.map(g => g.title), ['View', 'Order']);
    assert.ok(!JSON.stringify(api.SEARCH_MENU).includes('scope'));
  });
});

describe('the panel itself', () => {
  test('two groups of three tiles, one checked per group', async () => {
    const { api, els } = await boot();
    api.renderSearchMenu();
    const markup = els.get('searchMenu').innerHTML;
    assert.equal((markup.match(/<button[^>]*class="search-tile[ "]/g) || []).length, 6);
    assert.equal((markup.match(/role="radio"/g) || []).length, 6);
    assert.equal((markup.match(/aria-checked="true"/g) || []).length, 2);
    assert.equal((markup.match(/role="radiogroup"/g) || []).length, 2);
    for (const title of ['View', 'Order']) {
      assert.ok(markup.includes(`>${title}<`), `no "${title}" group`);
    }
    assert.ok(!markup.includes('Search in'), 'the Search in group is still rendered');
  });

  test('the checked tile is always the one in force', async () => {
    const { api, els } = await boot();
    api.applyViewSize('large', false);
    api.applyViewOrder('oldest', false);
    api.renderSearchMenu();
    const markup = els.get('searchMenu').innerHTML;
    const on = [...markup.matchAll(/<button([^>]*)>/g)]
      .map(m => m[1]).filter(a => /search-tile is-active/.test(a))
      .map(a => `${/data-group="([^"]+)"/.exec(a)[1]}:${/data-value="([^"]+)"/.exec(a)[1]}`);
    assert.deepEqual(on.sort(), ['order:oldest', 'size:large']);
  });
});
