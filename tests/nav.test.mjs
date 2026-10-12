/* nav.js — the site's single owner of the history stack.

   These run the real module in a vm against a history stub with a moving
   cursor, because the defects this module can have are all about *sequence*
   — who pushed, who popped, in what order — and a source-pattern test
   cannot see a sequence. */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const navSrc = readFileSync(new URL('../nav.js', import.meta.url), 'utf8');

/* A history stub that behaves like a browser's: a real cursor over a
   stack, pushState appending and truncating anything ahead of it,
   replaceState overwriting in place without growing the stack, and
   back()/forward() firing popstate with the entry landed on. A push that
   appends at the same URL twice is fine here but collapses in some
   engines — hence the separate URL assertions. */
function setup({ search = '?tour=1', hash = '', protocol = 'http:' } = {}) {
  const stack = [null];
  let cursor = 0;
  const urls = [];
  const pushes = [];
  const replaces = [];
  const pops = [];

  const location = { protocol, pathname: '/', search, hash };
  const listeners = [];

  function applyUrl(url) {
    if (url == null) return;
    urls.push(url);
    const h = String(url).indexOf('#');
    location.hash = h === -1 ? '' : String(url).slice(h);
  }

  const history = {
    get state() { return stack[cursor] || null; },
    pushState(s, _t, url) {
      pushes.push(s);
      stack.length = cursor + 1;
      stack.push(s);
      cursor = stack.length - 1;
      applyUrl(url);
    },
    replaceState(s, _t, url) {
      replaces.push(s);
      stack[cursor] = s;
      applyUrl(url);
    },
    back() { if (cursor > 0) { cursor--; fire(false); } },
    forward() { if (cursor < stack.length - 1) { cursor++; fire(false); } },
    go(n) { if (n < 0) this.back(); else if (n > 0) this.forward(); },
    get length() { return stack.length; },
    get cursor() { return cursor; },
  };

  function fire(oursFromModule) {
    pops.push(stack[cursor] || null);
    // The module's own listener is the only one registered here.
    for (const fn of listeners.slice()) fn({ state: stack[cursor] || null });
  }

  const sandbox = {
    location, history,
    addEventListener(type, fn) { if (type === 'popstate') listeners.push(fn); },
    dispatchEvent() { return true; },
    CustomEvent: class { constructor(t) { this.type = t; } },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.runInContext(navSrc, vm.createContext(sandbox), { filename: 'nav.js' });

  return { nav: sandbox.GalleryNav, sandbox, history, location, urls, pushes, replaces, pops,
           listenerCount: listeners.length };
}

const setupFile = () => setup({ protocol: 'file:' });

describe('nav — seeding', () => {
  test('seed overwrites the arrival entry rather than adding one', () => {
    // The invariant that matters: a push here would duplicate the page the
    // visitor arrived on, so their first back-press would reload the site
    // instead of leaving it.
    const h = setup();
    h.nav.seed({ tour: true, tourStep: 0, tourId: 's1' });
    assert.equal(h.pushes.length, 0, 'seeding never pushes');
    assert.equal(h.replaces.length, 1, 'seeding replaces');
    assert.equal(h.history.length, 1, 'the stack did not grow');
    assert.equal(h.history.state.tourId, 's1');
  });

  test('seed is idempotent — a second call cannot clobber the current entry', () => {
    const h = setup();
    h.nav.seed({ tour: true, tourId: 's1' });
    h.nav.push({ overlay: 'viewer' });
    h.nav.seed({ tour: true, tourId: 's1' }); // e.g. a second feature booting
    assert.equal(h.history.state.overlay, 'viewer', 'the live entry survived');
    assert.equal(h.replaces.length, 1, 'and was not rewritten');
  });
});

describe('nav — pushing', () => {
  test('push appends exactly one entry and moves the cursor onto it', () => {
    const h = setup();
    h.nav.seed({ tour: true, tourId: 's1' });
    h.nav.push({ tour: true, tourStep: 1, tourId: 's2' });
    assert.equal(h.history.length, 2);
    assert.equal(h.history.cursor, 1);
    assert.equal(h.history.state.tourId, 's2');
  });

  test('every push sets a URL, and the step one is addressable', () => {
    // A pushState with an unchanged URL can be collapsed by some engines,
    // silently merging two steps into one entry.
    const h = setup();
    h.nav.seed({ tour: true, tourId: 's1' });
    h.nav.push({ tour: true, tourStep: 1, tourId: 's2' });
    assert.equal(h.urls.length, 2, 'both the seed and the push set a URL');
    for (const u of h.urls) assert.notEqual(u, undefined);
    assert.match(h.urls[0], /#step-s1$/);
    assert.match(h.urls[1], /#step-s2$/);
  });

  test('an entry with no step leaves the URL free of a step hash', () => {
    const h = setup();
    h.nav.seed({ overlay: 'viewer' });
    assert.ok(!/#step-/.test(h.urls[0]), 'an overlay entry claims no step');
  });

  test('a push announces nothing — pushState fires no event', () => {
    // A subscriber that re-renders on its own push renders twice: once
    // from the announcement, once from the caller's own transition. This
    // is a real bug that shipped and showed up as a doubled confirm
    // animation, so it is pinned here.
    const h = setup();
    const seen = [];
    h.nav.subscribe((s) => seen.push(s));
    h.nav.push({ tour: true, tourId: 's1' });
    h.nav.replace({ tour: true, tourId: 's1' });
    assert.deepEqual(seen, [], 'only real navigations are reported');
  });
});

describe('nav — popping', () => {
  test('exactly one popstate listener, and subscribers see the landed entry', () => {
    const h = setup();
    const seen = [];
    h.nav.subscribe((s) => seen.push(s));
    h.nav.seed({ tour: true, tourId: 's1' });
    h.nav.push({ tour: true, tourStep: 1, tourId: 's2' });
    h.history.back();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].tourId, 's1', 'the entry the browser moved to, not the one left');
    assert.equal(h.listenerCount, 1);
  });

  test('forward returns to the entry left behind', () => {
    const h = setup();
    const seen = [];
    h.nav.subscribe((s) => seen.push(s));
    h.nav.seed({ tour: true, tourId: 's1' });
    h.nav.push({ tour: true, tourStep: 1, tourId: 's2' });
    h.history.back();
    h.history.forward();
    assert.equal(seen.length, 2);
    assert.equal(seen[1].tourId, 's2');
  });

  test('back() marks its own pop so an explicit close is not redone', () => {
    // overlayClose has already hidden the dialog by the time it pops; a
    // subscriber that hid it again would be operating on a dead node.
    const h = setup();
    const ours = [];
    h.nav.subscribe((s, isOurs) => ours.push(isOurs));
    h.nav.seed({ overlay: 'viewer' });
    h.nav.push({ tour: true, tourId: 's1' });
    h.nav.back();
    h.history.back();
    assert.deepEqual(ours, [true], 'our own unwind is flagged');
  });

  test("back()'s flag is consumed, so the next real pop is not swallowed", () => {
    // The flag is module state. If a user pop ever inherited it, the tour
    // would silently ignore a genuine back-press. Three entries, so there
    // is a real pop left after the flagged one has been consumed.
    const h = setup();
    const ours = [];
    h.nav.subscribe((s, isOurs) => ours.push(isOurs));
    h.nav.seed({ tour: true, tourId: 's1' });
    h.nav.push({ tour: true, tourStep: 1, tourId: 's2' });
    h.nav.push({ tour: true, tourStep: 2, tourId: 's3' });
    h.nav.back();               // our own unwind: flagged
    h.history.back();           // the user's: must not be
    assert.deepEqual(ours, [true, false]);
  });

  test('a pop that cannot move fires nothing and leaves no stale flag', () => {
    // At the arrival entry the cursor cannot go lower. If back() left its
    // flag set there, the next genuine user pop would be mislabelled as an
    // explicit close and silently ignored — the tour would stop honouring
    // the back button entirely.
    const h = setup();
    const ours = [];
    h.nav.subscribe((s, isOurs) => ours.push(isOurs));
    h.nav.seed({ tour: true, tourId: 's1' });
    h.history.back();           // no entry below: nothing fires
    h.nav.push({ tour: true, tourStep: 1, tourId: 's2' });
    h.history.back();           // a real user pop
    assert.deepEqual(ours, [false], 'the user pop is not flagged as ours');
  });
});

describe('nav — deep links', () => {
  test('a step hash is read back as a step id', () => {
    const h = setup({ hash: '#step-viewer-close' });
    assert.equal(h.nav.stepFromHash(), 'viewer-close');
  });

  test('a hash that is not a step reads as none', () => {
    assert.equal(setup({ hash: '#section' }).nav.stepFromHash(), null);
    assert.equal(setup({ hash: '' }).nav.stepFromHash(), null);
  });

  test('a push updates the hash the reader would see next', () => {
    const h = setup();
    h.nav.seed({ tour: true, tourId: 's1' });
    assert.equal(h.location.hash, '#step-s1');
    h.nav.push({ tour: true, tourStep: 1, tourId: 's2' });
    assert.equal(h.location.hash, '#step-s2');
    assert.equal(h.nav.stepFromHash(), 's2');
  });
});

describe('nav — robustness', () => {
  test('one throwing subscriber does not stop the rest', () => {
    const h = setup();
    const seen = [];
    h.nav.subscribe(() => { throw new Error('boom'); });
    h.nav.subscribe((s) => seen.push(s));
    h.nav.seed({ tour: true, tourId: 's1' });
    h.nav.push({ tour: true, tourId: 's2' });
    h.history.back();
    assert.equal(seen.length, 1, 'the subscriber after the throw still ran');
  });

  test('unsubscribe stops delivery', () => {
    const h = setup();
    const seen = [];
    const off = h.nav.subscribe((s) => seen.push(s));
    h.nav.seed({ tour: true, tourId: 's1' });
    h.nav.push({ tour: true, tourId: 's2' });
    off();
    h.history.back();
    assert.deepEqual(seen, []);
  });

  test('on file:// it degrades to no history rather than throwing', () => {
    // Every caller has a direct DOM path for closing, so the fallback is
    // "no history", not a crash. Loaded with a file:// location from the
    // start, since the check is made once at module load as in a browser.
    const h = setupFile();
    assert.equal(h.nav.supported, false, 'history is declared unsupported');
    h.nav.seed({ tour: true, tourId: 's1' });
    h.nav.push({ tour: true, tourStep: 1, tourId: 's2' });
    assert.equal(h.history.state, null, 'nothing was written to history');
    assert.equal(h.nav.back(), false, 'back() reports it could not run');
    // And the caller's own DOM work still happened, which is the point.
  });

  test('current reflects the live entry', () => {
    const h = setup();
    h.nav.seed({ tour: true, tourId: 's1' });
    assert.equal(h.nav.current.tourId, 's1');
    h.nav.push({ overlay: 'viewer', tour: true, tourId: 's1' });
    assert.equal(h.nav.current.overlay, 'viewer');
    assert.equal(h.nav.current.tourId, 's1', 'the step rides along on the overlay entry');
  });
});

describe('nav — the site uses exactly one of these', () => {
  const files = ['nav.js', 'app.js', 'tour/tour.js', 'walkthrough/journey.js', 'oneui.js'];
  test('no file registers a second popstate listener', () => {
    // The whole point of the module. Two listeners meant the gallery and
    // the tour each guessed what a pop meant, and the tour's guess was
    // wrong often enough to end walks at step 4 of 11.
    for (const f of files) {
      let src;
      try { src = readFileSync(new URL('../' + f, import.meta.url), 'utf8'); }
      catch { continue; }
      const hits = src.match(/addEventListener\(\s*['"]popstate['"]/g) || [];
      const allowed = f === 'nav.js' ? 1 : 0;
      assert.equal(hits.length, allowed,
        `${f} registers ${hits.length} popstate listener(s); nav.js owns the one`);
    }
  });

  test('the old private handshake is gone', () => {
    for (const f of ['app.js', 'tour/tour.js']) {
      const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
      assert.ok(!src.includes('gallery:history-pop'),
        `${f} still dispatches or listens for the removed handshake`);
    }
  });
});
