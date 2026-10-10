import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* ────────────────────────────────────────────────────────────────────
   The walkthrough gate (app.js: shouldRequireWalkthrough).

   app.js is a 100KB browser script that boots the whole gallery, so it
   is not loaded here. The gate is lifted out of the source and run in
   a vm against a stubbed localStorage — which is also the only honest
   way to test the branch that matters most, the one where storage
   throws: a browser with cookies blocked has to be reproducible, and
   the stub is where that condition lives.
   ──────────────────────────────────────────────────────────────────── */

const here = dirname(fileURLToPath(import.meta.url));
const appSrc = fs.readFileSync(join(here, '..', 'app.js'), 'utf8');

/* Cut the gate out verbatim, so this file cannot drift from the one
   that ships — if the function is renamed or removed, the slice is
   empty and every test below fails loudly. */
function loadGate({ stored = null, throws = false, navType = null } = {}) {
  const m = /function shouldRequireWalkthrough\(search\) \{[\s\S]*?\n\}/.exec(appSrc);
  assert.ok(m, 'app.js declares shouldRequireWalkthrough');

  const key = /const WALKTHROUGH_SEEN_KEY = '([^']+)'/.exec(appSrc);
  assert.ok(key, 'app.js declares WALKTHROUGH_SEEN_KEY');

  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    location: { search: '', protocol: 'https:', replace() {} },
    localStorage: throws ? {
      getItem() { throw new Error('SecurityError: storage is blocked'); },
      setItem() { throw new Error('SecurityError: storage is blocked'); },
    } : {
      getItem: () => stored,
      setItem() {},
    },
  };
  // Only present when a navigation type is asked for, so the default
  // sandbox stays a world with no performance object at all — which is
  // also the shape the fail-open branch has to survive.
  if (navType) {
    sandbox.performance = {
      getEntriesByType: (kind) => kind === 'navigation' ? [{ type: navType }] : [],
    };
  }
  vm.createContext(sandbox);
  vm.runInContext('const WALKTHROUGH_SEEN_KEY = ' + JSON.stringify(key[1]) + ';\n' + m[0], sandbox);
  return { require: sandbox.shouldRequireWalkthrough, KEY: key[1] };
}

describe('G — the walkthrough gate', () => {
  test('G1 — a first visit is sent to the walkthrough', () => {
    const g = loadGate({ stored: null });
    assert.equal(g.require(''), true);
  });

  test('G2 — a visitor who completed the walkthrough walks straight in', () => {
    const g = loadGate({ stored: 'completed' });
    assert.equal(g.require(''), false);
  });

  test('G3 — a visitor who skipped it walks straight in too', () => {
    // The gate asks "have they been offered this", not "did they finish".
    // Two values are stored so the distinction is not lost — the walkthrough
    // needs it — but the gate deliberately does not act on it.
    const g = loadGate({ stored: 'skipped' });
    assert.equal(g.require(''), false);
  });

  test('G4 — ?tour=1 is never swallowed by the redirect', () => {
    // tour/boot.js already arms itself with this flag, so a deep link to
    // the tour must survive a gate whose only job is to bounce first
    // visits elsewhere. Otherwise the bounce is undone a second later.
    const g = loadGate({ stored: null });
    assert.equal(g.require('?tour=1'), false);
    assert.equal(g.require('?admin=1&tour=1'), false);
  });

  test('G5 — the tour flag is matched as a parameter, not a substring', () => {
    const g = loadGate({ stored: null });
    assert.equal(g.require('?tour=10'), true, '?tour=10 is not ?tour=1');
    assert.equal(g.require('?contour=1'), true, 'contour is not tour');
    assert.equal(g.require('?tour=1&x=2'), false);
  });

  test('G6 — storage that throws fails open', () => {
    // The whole risk of a gate is locking a visitor out of the archive.
    // If we cannot read the record we assume they have been here before:
    // the cost is one extra page view, the alternative is a dead end.
    const g = loadGate({ throws: true });
    assert.equal(g.require(''), false);
    assert.equal(g.require('?tour=1'), false);
  });

  test('G7 — the record key is the one the walkthrough writes', () => {
    const g = loadGate();
    assert.equal(g.KEY, 'walkthrough.seen',
      'the gate and the walkthrough runtime must agree on the key');

    const wt = fs.readFileSync(join(here, '..', 'walkthrough', 'walkthrough.js'), 'utf8');
    assert.ok(new RegExp("SEEN_KEY\\s*=\\s*'" + g.KEY + "'").test(wt),
      'walkthrough.js writes the same key the gate reads');
  });

  // A reload hands off, so refreshing the archive lands on the opening
  // page again. Browsers report F5 and Ctrl/Cmd+Shift+R identically — both
  // are navigation type "reload" — so the gate cannot honour one and not
  // the other, and does not pretend to.
  test('G8 — a reload starts the opening page again', () => {
    const g = loadGate({ stored: 'completed', navType: 'reload' });
    assert.equal(g.require(''), true, 'reload hands off');
  });

  test('G9 — a first-time navigation after the record walks straight in', () => {
    const g = loadGate({ stored: 'completed', navType: 'navigate' });
    assert.equal(g.require(''), false, 'arriving is not reloading');
  });

  test('G10 — going back is not reloading either', () => {
    const g = loadGate({ stored: 'completed', navType: 'back_forward' });
    assert.equal(g.require(''), false);
  });

  test('G11 — ?stay=1 is the way back in after a reload', () => {
    const g = loadGate({ stored: 'completed', navType: 'reload' });
    assert.equal(g.require('?stay=1'), false);
    assert.equal(g.require('?tour=1&stay=1'), false);
    // …and it is matched as a parameter, not a substring.
    assert.equal(g.require('?stay=10'), true, '?stay=10 is not ?stay=1');
  });

  test('G12 — no performance object at all fails open', () => {
    // A browser without the Navigation Timing entry point must not be
    // locked out of their own archive.
    const g = loadGate({ stored: 'completed' });
    assert.equal(g.require(''), false);
  });
});