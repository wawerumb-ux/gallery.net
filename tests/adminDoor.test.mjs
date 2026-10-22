/* The admin sign-in has no visible door.
 *
 * A visitor's ⋮ menu carries no row for it, nothing on the page links to
 * it, and the guided tour does not point at it. The only way to the box is
 * three clicks on the title in the app bar — wireTitleDoor. This suite runs
 * the real text of both functions, sliced out of app.js and given the few
 * names they stand on, so the door cannot be quietly re-hung on a menu row
 * or widened to two clicks without something failing.
 *
 * It also pins the other half of the bargain: a visitor's menu still offers
 * everything it did and an admin's still offers all five of its rows.
 * Hiding the door must not have hidden the building. */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

/* Brace-count a top-level function out of app.js. Both functions here are
   flat — no brace inside a string, a comment or a template literal — so the
   counter needs no mode tracking. confirmStack.test.mjs carries the version
   that does, for functions that are less kind. */
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

/* The door's own constants, read from the source rather than repeated, so a
   change to either lands in this suite instead of passing silently. */
const TAP_COUNT = Number(/const TITLE_TAP_COUNT = (\d+);/.exec(source)[1]);
const TAP_MS = Number(/const TITLE_TAP_MS = (\d+);/.exec(source)[1]);

/* One pending timer is all this door ever holds, so the clock holds one. */
function door(state) {
  let now = 0, pending = null, opened = 0;
  const title = {
    listener: null,
    addEventListener(type, fn) { if (type === 'click') this.listener = fn; },
  };
  const sandbox = {
    state,
    el: () => title,
    openAdminModal: () => { opened++; },
    setTimeout: (fn, ms) => { pending = { at: now + ms, fn }; return 1; },
    clearTimeout: () => { pending = null; },
    TITLE_TAP_COUNT: TAP_COUNT,
    TITLE_TAP_MS: TAP_MS,
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(body('wireTitleDoor'), ctx, { filename: 'app.js' });
  vm.runInContext('wireTitleDoor()', ctx, { filename: 'app.js' });
  assert.ok(title.listener, 'the door bound no click on the title');
  return {
    tap() { title.listener(); },
    tick(ms) { now += ms; if (pending && pending.at <= now) { const f = pending.fn; pending = null; f(); } },
    get opened() { return opened; },
  };
}

describe('D — three clicks on the title open the sign-in box', () => {
  test('D1 — two clicks open nothing', () => {
    const d = door({ adminMode: false, adminSession: false });
    d.tap();
    d.tap();
    d.tick(TAP_MS * 4);
    assert.equal(d.opened, 0, 'two clicks must not open the box');
  });

  test('D2 — three continuous clicks open it', () => {
    const d = door({ adminMode: false, adminSession: false });
    d.tap(); d.tick(50);
    d.tap(); d.tick(50);
    d.tap();
    assert.equal(d.opened, 1, 'three clicks in a row must open the box');
  });

  test('D3 — a pause past the window drops the count back to zero', () => {
    const d = door({ adminMode: false, adminSession: false });
    d.tap(); d.tick(50);
    d.tap();
    d.tick(TAP_MS + 1);          // the window elapses before the third
    d.tap(); d.tick(50);
    d.tap();
    assert.equal(d.opened, 0, 'the third click after a pause must not count');
  });

  test('D4 — a click inside the window keeps the run alive', () => {
    const d = door({ adminMode: false, adminSession: false });
    // Long after the first click — but still inside its window, which is
    // what makes the third click a third click and not a new first.
    d.tap(); d.tick(TAP_MS - 1);
    d.tap(); d.tick(TAP_MS - 1);
    d.tap();
    assert.equal(d.opened, 1, 'clicks inside the window must still add up');
  });

  test('D5 — the count resets after a successful open', () => {
    const d = door({ adminMode: false, adminSession: false });
    d.tap(); d.tap(); d.tap();
    assert.equal(d.opened, 1);
    d.tap();
    assert.equal(d.opened, 1, 'a fourth click must not reopen the box');
  });

  test('D6 — a stale session cannot strand the door', () => {
    // gallery.json carries __admin_session__ when an admin closed the tab
    // without signing out. That makes adminSession truthy for everyone,
    // and a guard here once silenced the door for good while the box — the
    // one place that explains why — stayed out of reach.
    const d = door({ adminMode: false, adminSession: { since: '2026-10-22T01:07:23.021Z' } });
    d.tap(); d.tap(); d.tap();
    assert.equal(d.opened, 1, 'a held session must not lock the door');
  });

  test('D7 — an admin already signed in can still open it', () => {
    const d = door({ adminMode: true, adminSession: null });
    d.tap(); d.tap(); d.tap();
    assert.equal(d.opened, 1, 'the box is what explains itself — do not pre-filter');
  });

  test('D8 — the door is three clicks, not two or four', () => {
    assert.equal(TAP_COUNT, 3, 'TITLE_TAP_COUNT is the published gesture');
    assert.ok(TAP_MS > 0 && TAP_MS <= 1000, 'the window is short enough to mean "continuously"');
  });
});

/* ── The menu must not carry the other door ─────────────────────── */

function menu(state) {
  let sheet = null;
  const sandbox = {
    state,
    toastSoundOn: true,
    DEMO_MODE: false,
    ICONS: new Proxy({}, { get: () => 'icon' }),
    window: { MouseEffect: { isEnabled: () => false }, location: {} },
    openSheet: (cfg) => { sheet = cfg; },
    setToastSound: () => {},
    // The admin rows name these directly rather than behind an arrow, so
    // building the list needs them to exist — stubs, never called here.
    pickFiles: () => {},
    openNewAlbumModal: () => {},
    enterSelectMode: () => {},
    openSettingsModal: () => {},
    signOut: () => {},
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(body('mainMenu'), ctx, { filename: 'app.js' });
  vm.runInContext('mainMenu()', ctx, { filename: 'app.js' });
  return sheet.items.map(i => i.label);
}

describe('M — the ⋮ menu offers no way in', () => {
  test('M1 — a visitor sees no sign-in row', () => {
    const labels = menu({ adminMode: false, adminSession: false });
    assert.ok(!labels.some(l => /sign in/i.test(l)),
      'the visitor menu still offers: ' + labels.join(' | '));
  });

  test('M2 — a visitor keeps everything else the menu offers', () => {
    const labels = menu({ adminMode: false, adminSession: false });
    for (const want of ['Guided tour', 'Mouse effect off']) {
      assert.ok(labels.includes(want), `visitor menu lost "${want}"`);
    }
  });

  test('M3 — an admin keeps all five of their rows', () => {
    const labels = menu({ adminMode: true, adminSession: false });
    for (const want of ['Add photos', 'New album…', 'Select photos',
                        'Album settings', 'Sign out']) {
      assert.ok(labels.includes(want), `admin menu lost "${want}"`);
    }
  });
});

/* ── And the page must not advertise it either ──────────────────── */

describe('H — nothing static points at the box', () => {
  test('H1 — index.html carries no target into the sign-in dialog', () => {
    assert.ok(!/data-tour-target="admin-modal-cancel"/.test(html),
      'the Cancel button still invites the tour');
  });

  test('H2 — app.js no longer hooks the old menu row', () => {
    assert.ok(!/menu-admin-signin/.test(source),
      'the removed row is still described somewhere');
  });
});
