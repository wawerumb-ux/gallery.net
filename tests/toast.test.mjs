/* The notification is Penguin UI's stacking toast, dressed on hcg-toast,
   with a synthesised ding as the default and real recordings for named
   actions.

   Five things about it are load-bearing and none of them are visible in
   a screenshot:

   1. The sound is gated on a user gesture. An AudioContext built before
      one is born suspended, so a notification that arrives first — a
      rate-limit warning raised during boot, say — must be silent rather
      than queue a context Chrome will warn about and never resume.
   2. A sticky progress line must not sound. The batch loops raise one
      per photo; forty dings across a single upload is not a
      notification, it is a machine gun. Only a message that is actually
      going to sit on screen gets the ding.
   3. Undo goes inside the toast's body, under the message. That is
      where Penguin puts the actions on a message-style notification, and
      it is also what keeps the button from sitting between the text and
      the dismiss X at the same height as both.
   4. A sticky message with no type of its own is *pending*. Every sticky
      line in this app is a batch saying what it is doing, so the default
      has to be the orange that means "still going" — and the one batch
      that raises a sticky error must still come out red, which is why
      `type` outranks the default rather than the other way round.
   5. The progress bar reports a proportion, and only says so when it has
      one. `done` past `total` must not render a bar wider than its own
      track, and a write with no total must sweep rather than sit at a
      confident 0%.
   6. A notification has four voices. The synthesised palette is the
      default and needs nothing from the network; a *named* action may
      bring a recording instead, and that recording is licensed, gitignored,
      and allowed to be absent. What must never happen is a message
      failing to sound: a missing file, an unknown name, a codec the device
      will not decode — each falls back rather than costing the message.

   Two of the four are derived from the message rather than requested by
   the call site, because they carry information the words do not: an
   `error` type sounds like failure even if the text reads like success,
   and a message offering Undo sounds unsettled. A call site that forgets
   to ask still gets both; only a recorded voice has to be named, since
   only a recording has provenance to get wrong.

   Plus the boring ones: every type the call sites use has a glyph, the
   dismissal is the stroked cross rather than the library's `&times;`, the
   card draws no border, and reduced-motion cannot strand a card at the
   offset its entrance starts from. */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile, access, stat } from 'node:fs/promises';
import vm from 'node:vm';

const APP = new URL('../app.js', import.meta.url);
const CSS = new URL('../style.css', import.meta.url);
const ROOT = new URL('../', import.meta.url);
const app = await readFile(APP, 'utf8');
const css = await readFile(CSS, 'utf8');
/* The library is imported here, at module scope, because that is the only
   place top-level `await` is legal. Inside a describe() callback or a
   non-async test body it is a syntax error, and the whole file — 40-odd
   other tests included — fails to parse. */
const dlb = await import('../hcg-toast.js');

const sameDeep = (a, b, msg) => assert.deepStrictEqual(a, b, msg);

/* Strip comments before pattern-matching against code. Several of the
   rules these tests protect are written in the comments beside the code,
   and this file's own note about lib.show not existing would otherwise
   trip the very assertion that forbids calling it.
   Declared before its callers: `const` has no hoisting, so building `src`
   from a function defined further down throws a TDZ ReferenceError. */
const code = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

/* `src` and `cssCode` are what the assertions read: the same files with
   their comments removed, so a note in the margin can neither satisfy an
   assertion nor trip one. `app`/`css` stay raw because several slice
   markers are themselves comment text. */
const src = code(app);
const cssCode = code(css);

/* Slice app.js between two markers, comments removed.
   Markers are matched against the raw source — several of them are
   themselves comment text — and only the slice handed to an assertion has
   the prose taken out.

   The end marker is searched FROM the start marker, not from the top of
   the file. Searching from 0 finds the first `};` anywhere, which for a
   marker deep in the file sits at a much smaller index than the start —
   and slice(a, b) with b < a is empty, so the assertion below would have
   been handed '' and passed a vacuous doesNotMatch. */
const sliceCode = (from, to) => {
  const a = app.indexOf(from);
  assert.notStrictEqual(a, -1, `start marker not found in app.js: ${from}`);
  const b = to ? app.indexOf(to, a + from.length) : app.length;
  assert.notStrictEqual(b, -1, `end marker not found after the start: ${to}`);
  assert.ok(b > a, `end marker must come after the start: ${from} … ${to}`);
  return code(app.slice(a, b));
};

describe('A — the sound is only ever heard on purpose', () => {
  test('A1 — no AudioContext is built before a gesture', () => {
    // The unlock is a one-shot listener on the page, not on the toast:
    // a visitor who has scrolled, tapped or tabbed has unlocked it.
    assert.match(src, /window\.addEventListener\('pointerdown', unlock, \{ once: true, capture: true \}\)/);
    assert.match(src, /window\.addEventListener\('keydown', unlock, \{ once: true, capture: true \}\)/);
  });

  test('A2 — playToastDing returns before it touches an AudioContext', () => {
    const ding = sliceCode('function playToastDing', 'function setToastSound');
    const guard = ding.indexOf('if (!toastSoundOn || !toastUnlocked) return;');
    const build = ding.indexOf('new AudioCtx()');
    assert.notStrictEqual(guard, -1, 'playToastDing must gate on the flag and the unlock');
    assert.notStrictEqual(build, -1, 'playToastDing must build a context');
    assert.ok(guard < build,
      'the guard has to come first, or a pre-gesture notification builds a suspended context');
  });

  test('A3 — a suspended context is left alone rather than resumed', () => {
    // resume() on a context nobody has unlocked is the thing that trips
    // the autoplay warning; the honest answer is to stay quiet.
    assert.match(src, /if \(toastAudio\.state === 'suspended'\) return;/);
    assert.doesNotMatch(src, /toastAudio\.resume\(/,
      'the ding must not resume the context to get around the gate');
  });

  test('A4 — a sticky progress line is silent', () => {
    const show = sliceCode('function showToast');
    const sound = /if \(!o\.sticky\) playToastDing\(o\.sound\);/.test(show);
    assert.ok(sound,
      'the batch loops raise one sticky line per photo — only a timed message may sound');
    // And the guard sits inside showToast, after the library call, so a
    // message that never rendered never sounds.
    const call = show.indexOf('playToastDing(o.sound)');
    const shown = show.indexOf('toastId = id;');
    assert.ok(shown !== -1 && shown < call,
      'the ding must follow the message actually being shown');
  });

  test('A5 — the default voice is synthesised, never fetched', () => {
    // The palette is the primary mechanism, so this is the load-bearing
    // claim: a file would mean a network request and a licence for one
    // oscillator, and the archive has to keep working offline. A *named*
    // action may bring a recording (A6) — this is about the default.
    const ding = sliceCode('function playToastDing', 'function setToastSound');
    assert.doesNotMatch(ding, /new Audio\(|https?:\/\//,
      'the default voice must be synthesised — no audio file, no CDN');
    assert.match(ding, /createOscillator\(\)/);
    assert.match(ding, /osc\.type = 'sine'/);
  });

  test('A6 — a named action may bring its own recording, and only then', async () => {
    // The default ding stays synthesised (A5). A *named* action is allowed
    // a file, so the two mechanisms have to be distinguishable.
    assert.match(src, /const TOAST_SOUND_FILES = \{/);
    assert.match(src, /if \(sound && playToastFile\(sound\)\) return;/,
      'playToastDing must try the named recording before falling back');

    /* Every path the registry names must be a path — a bare filename or a
       URL to a CDN would break the one rule that keeps this app working
       offline. That is checked here because it is a static property of the
       source.

       Whether the file is *present* is deliberately not asserted. The
       recordings are licensed and gitignored, so a clean checkout does not
       have them and CI never will; asserting presence would mean the suite
       could only ever pass on the one machine that holds the licences. A
       missing file is a supported state, not a failure. */
    const entries = src.matchAll(/^\s*(\w+): '(audio\/[^']+)',$/gm);
    const paths = [...entries];
    assert.ok(paths.length, 'the registry should name at least one recording');
    for (const [, , p] of paths) {
      assert.doesNotMatch(p, /^https?:\/\//,
        `a sound must be served from this origin, not a CDN: ${p}`);
      assert.match(p, /^audio\/[\w.-]+\.(mp3|m4a|aac|wav|ogg|oga|webm)$/,
        `a sound must be a local audio file: ${p}`);
    }
    // …but if the folder does hold recordings, they have to be real files
    // rather than whatever Git LFS left behind as a pointer.
    for (const [, , p] of paths) {
      try { await access(new URL(p, ROOT)); } catch (_) { break; }
      const { size } = await stat(new URL(p, ROOT));
      assert.ok(size > 1024, `${p} is ${size} bytes — that is an LFS pointer, not an audio file`);
    }
    // …and the file is fetched only after the switches say to make a noise.
    const ding = sliceCode('function playToastDing', 'function setToastSound');
    assert.ok(ding.indexOf('if (!toastSoundOn || !toastUnlocked) return;')
      < ding.indexOf('playToastFile(sound)'),
      'the sound flag and the gesture gate come before the file is touched');

    // Every recorded sound is fetched once, on the first gesture, not on
    // every notification that names it.
    assert.match(src, /const unlock = \(\) => \{ toastUnlocked = true; primeToastSounds\(\); \};/,
      'the gesture unlock is the earliest legitimate moment to start the download');
  });

  test('A7 — a missing or unready file costs the noise, not the message', () => {
    const file = sliceCode('function playToastFile', 'function playToastDing');
    assert.match(file, /if \(!el \|\| el\.readyState < 2\) return false;/,
      'an absent or still-loading recording must report itself unusable');
    assert.match(file, /played\.catch\(\(\) => \{\}\);/,
      'a rejected play() must not escape into the toast that triggered it');
  });

  test('A8 — only the download confirmation names a *recording*', () => {
    // A name in `sound:` can now resolve two ways: a file, or one of the
    // synthesised voices. This test is about the files, because those are
    // the licensed ones. A name that resolves to a voice costs nothing and
    // needs no provenance, so the palette may grow freely.
    const recorded = new Set([...src.matchAll(/^\s*(\w+): 'audio\/[^']+'/gm)].map((m) => m[1]));
    const named = [...app.matchAll(/showToast\([^;]*?sound: '(\w+)'/g)].map((m) => m[1]);
    const licensed = named.filter((n) => recorded.has(n));
    assert.deepStrictEqual([...new Set(licensed)], ['download'],
      'the only licensed recording in play is the download confirmation');
    // And it must be the success branch, never the error one.
    assert.match(app, /onDownloadComplete: \(\) => showToast\(`Saved \$\{viewerDownloadName\}`, \{ type: 'success', sound: 'download' \}\)/);
    const err = app.slice(app.indexOf('onDownloadError:'), app.indexOf('onDownloadError:') + 300);
    assert.doesNotMatch(err, /sound:/,
      'a failed download must not play the recording that means "saved"');
  });

  test('A9 — the palette is four voices, and no two are the same sound', () => {
    const palette = sliceCode('const TOAST_VOICES', 'const DEFAULT_VOICE');
    const voices = [...palette.matchAll(/^  (\w+): \{/gm)].map((m) => m[1]);
    assert.deepStrictEqual(voices, ['ding', 'error', 'undo', 'success'],
      'the palette is exactly these four voices');

    // Every voice must actually differ from the default, or it is not a
    // voice — it is the default under another name, and a notification
    // that sounds identical while claiming to mean something else is
    // worse than no distinction at all.
    const partialsOf = (name) => {
      const at = palette.indexOf(`  ${name}: {`);
      assert.notStrictEqual(at, -1, `no voice named ${name}`);
      return palette.slice(at, at + 400).match(/partials: (\[\[.*\]\]),/)[1];
    };
    const ding = partialsOf('ding');
    for (const v of voices.filter((x) => x !== 'ding')) {
      assert.notStrictEqual(partialsOf(v), ding, `${v} must not be the default ding's partials`);
    }
    // And they must not be duplicates of each other either.
    const seen = new Map();
    for (const v of voices) {
      const p = partialsOf(v);
      assert.ok(!seen.has(p), `${v} is a copy of ${seen.get(p)}`);
      seen.set(p, v);
    }
  });

  test('A10 — every voice decays inside the toast it belongs to', () => {
    // A sound that outlives its own message is a notification the visitor
    // cannot switch off, arriving after the thing it announced is gone.
    // The shortest non-sticky toast is TOAST_MS, so every decay has to sit
    // well inside it.
    const palette = sliceCode('const TOAST_VOICES', 'const DEFAULT_VOICE');
    const decays = [...palette.matchAll(/^  (\w+): \{\n    decay: ([\d.]+),/gm)];
    assert.strictEqual(decays.length, 4, 'all four voices declare a decay');
    for (const [, name, decay] of decays) {
      assert.ok(Number(decay) < 1, `${name} decays over ${decay}s — too long for a toast`);
    }
    // And the envelope has to reach the bus before its oscillator stops,
    // or every voice ends on an audible step.
    const ding = sliceCode('function playToastDing', 'function setToastSound');
    assert.match(ding, /exponentialRampToValueAtTime\(0\.0001, now \+ delay \+ decay - 0\.05\)/,
      'the per-partial envelope must close before its oscillator stops');
  });

  test('A11 — failure and Undo are heard before they are read', () => {
    // The two voices worth having are the two that carry information the
    // message itself does not: a failure that reads like a success, and a
    // change that is not yet final. Both are derived rather than requested,
    // so a call site cannot forget them.
    const show = sliceCode('function showToast');
    assert.match(show, /type === 'error' \? 'error'/,
      'an error must fall to the error voice without the call site asking');
    assert.match(show, /undo \? 'undo'/,
      'a message carrying Undo must fall to the undo voice');
    assert.match(show, /if \(!o\.sound\)/,
      'a derived voice must yield to one the call site named explicitly');
    // And the copy it writes back must not escape to the caller: a shared
    // literal would come back carrying a sound it never asked for, and
    // every later call on it would inherit that.
    assert.match(show, /Object\.assign\(\{\}, opts === true/,
      'showToast must copy its options before writing a voice onto them');
  });

  test('A12 — a partial batch never gets the voice of a finished one', () => {
    // Move and rename report a warning when anything was skipped or
    // collided. The wider success voice on a half-finished batch would be
    // the loudest lie available, so the guard is written out at each site.
    assert.match(app, /sound: failed \|\| collided \? undefined : 'success'/,
      'move must withhold the success voice when anything was skipped or collided');
    assert.match(app, /\{ type: failed \? 'warning' : 'success', sound: failed \? undefined : 'success' \}/,
      'rename must withhold the success voice when anything failed');
  });

  });

describe('B — the switch is offered, remembered, and honest', () => {
  test('B1 — it defaults to on and persists under gallery.toastSound', () => {
    assert.match(src, /const TOAST_SOUND_KEY = 'gallery\.toastSound';/);
    // Anything that is not an explicit "off" is on — a half-written or
    // stale value must not mute the archive by accident.
    assert.match(src, /localStorage\.getItem\(TOAST_SOUND_KEY\) !== 'off'/);
  });

  test('B2 — a storage that throws does not take the notification with it', () => {
    const read = sliceCode('function storedToastSound', 'let toastSoundOn');
    assert.match(read, /try \{[\s\S]*\} catch \(_\) \{\s*return true;/,
      'localStorage can throw in private mode; the default must still answer');
  });

  test('B3 — the ⋮ menu offers it to everyone, not just the admin', () => {
    const menu = sliceCode('function mainMenu', 'function albumMenu');
    assert.match(menu, /label: toastSoundOn \? 'Notification sound on' : 'Notification sound off'/,
      'the row must say what tapping it will do, not what it did last time');
    assert.match(menu, /onTap: \(\) => setToastSound\(!toastSoundOn\)/);
    // It is built before the admin spread, so a visitor gets it too.
    assert.ok(menu.indexOf('setToastSound') < menu.indexOf('state.adminMode'),
      'the sound switch belongs to everyone, so it must sit above the admin branch');
  });

  test('B4 — turning it back on plays the ding, so the row confirms itself', () => {
    const set = sliceCode('function setToastSound', 'let toastId');
    assert.match(set, /if \(toastSoundOn\) playToastDing\(\);/);
    assert.match(set, /localStorage\.setItem\(TOAST_SOUND_KEY, toastSoundOn \? 'on' : 'off'\)/);
  });
});

describe('C — every message is drawn in Penguin\'s shape', () => {
  test('C1 — each type the call sites use has its own glyph', () => {
    // Every `type:` literal the app raises, by the only key that matters.
    const used = new Set([...src.matchAll(/type:\s*'([a-z]+)'/g)].map(m => m[1]));
    assert.ok(used.size > 0, 'no typed notifications found — the audit found nothing');
    const defined = new Set([...src.matchAll(/^\s{2}(\w+): TOAST_GLYPH\(/gm)].map(m => m[1]));
    for (const t of ['info', 'success', 'warning', 'error', 'pending']) {
      assert.ok(defined.has(t), `the library type '${t}' has no glyph`);
    }
    for (const t of used) {
      assert.ok(defined.has(t), `type '${t}' is raised somewhere but has no glyph`);
    }
    assert.ok(used.has('pending'), 'showPending must actually raise the type');
  });

  test('C2 — the glyphs are inline SVG, not the library\'s text characters', () => {
    assert.match(src, /<svg viewBox="0 0 20 20" fill="currentColor"/);
    // The library's own glyphs are ℹ ✓ ⚠ ✕, and a toast that renders
    // one of those is back to the old look.
    const glyphs = sliceCode('const TOAST_GLYPHS', 'const TOAST_CLOSE_GLYPH');
    for (const ch of ['\u2139', '\u2713', '\u26a0', '\u2715']) {
      assert.ok(!glyphs.includes(ch), `the Penguin set must not fall back to ${ch}`);
    }
  });

  test('C3 — the dismissal is a stroked cross, not &times;', () => {
    assert.match(src, /const TOAST_CLOSE_GLYPH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"/);
    assert.match(src, /const TOAST_CLOSE_GLYPH = '<svg[^']*M6 18L18 6M6 6l12 12/);
    const decorate = sliceCode('function decorateToast', '/* A message, optionally carrying');
    assert.match(decorate, /close\.innerHTML = TOAST_CLOSE_GLYPH/,
      'the library renders `&times;`; decorateToast has to put the real mark in');
  });

  test('C4 — Undo is placed in the body, not beside it', () => {
    const decorate = sliceCode('function decorateToast', '/* A message, optionally carrying');
    assert.match(decorate, /item\.querySelector\('\.hcg-toast-body'\) \|\| item\)\.appendChild\(btn\)/,
      'Undo belongs under the message, in the body column');
    assert.doesNotMatch(decorate, /insertBefore/,
      'the old placement parked the button between the text and the dismiss X');
  });

  test('C5 — decorateToast runs for every message, not only the undoable ones', () => {
    // The dismiss cross is swapped in there too, so guarding the call on
    // `undo` would leave every ordinary message with a `&times;`.
    const show = sliceCode('function showToast');
    assert.match(show, /^\s*decorateToast\(id, undo\);/m);
    assert.doesNotMatch(show, /if \(undo\) decorateToast/);
  });

  test('C6 — the library is still configured the same way round', () => {
    // The Penguin look is skin. The plumbing stays one toast at a time,
    // because the batch loops replace rather than stack.
    assert.match(src, /const TOAST_POSITION = 'top-center';/);
    assert.match(src, /const TOAST_MAX = 3;/);
    assert.match(src, /lib\.dismissAll\(\);/,
      'a replacing toast must remove the last one outright');
  });

  test('C6b — it calls the library bare, which is the only way `pending` exists', () => {
    // The library's global is a *callable*: `toast(message, options)`. Its
    // four typed helpers hang off it, but `.show` does not — that name only
    // exists on the instance from `toast.create()`. Calling `lib.show(...)`
    // throws on every message and nothing ever reaches the screen.
    const api = globalThis.toast;
    assert.equal(typeof api, 'function', 'the global must be callable');
    assert.equal(api.show, undefined,
      'the global does NOT expose show() — if this ever changes, call it again');
    assert.equal(typeof api.success, 'function');
    assert.equal(typeof api.create, 'function');
    assert.equal(typeof dlb, 'object');

    // ...and the wrapper must therefore invoke the global itself.
    const show = sliceCode('function showToast');
    assert.match(show, /const id = lib\(msg, \{\s*type,/);
    assert.doesNotMatch(show, /lib\.show\(/,
      'lib.show is not a function — this throws before anything is rendered');
    assert.doesNotMatch(show, /lib\[type\]\(/,
      'a fifth type cannot go through the four named helpers either');
  });

  test('C8 — a failure always produces a message the library will render', () => {
  // hcg-toast returns null on a falsy message before it builds anything,
  // so `${err.message}` on an Error with no message — a rejected fetch, a
  // thrown string, `new Error()` — yields `Could not undo: ` and the one
  // toast that exists to report a failure renders nothing at all.
  // Slice the declaration out and evaluate it. Brace-bodied, so the end is
  // the declaration's own closing `};` at column 0 — not the first `;` in
  // the file, which would land inside the function and hand vm a truncated
  // arrow.
  const start = src.indexOf('const errWhy =');
  assert.notStrictEqual(start, -1, 'errWhy is missing from app.js');
  const head = src.slice(start + 'const errWhy = '.length);
  assert.match(head, /^\(err\)\s*=>\s*\{/, 'errWhy must be an arrow function with a block body');
  /* Count braces to find the real end of the declaration. Searching for a
     textual `\n};` worked only because errWhy happens to sit at column 0;
     if it were ever indented — or if a nested object literal appeared in the
     body — that search would cut the function in half and vm would be handed
     a truncated arrow. Comments are already gone from `src`, so `{`/`}` here
     are code. */
  let depth = 0, end = -1;
  for (let i = head.indexOf('{'); i < head.length; i++) {
    if (head[i] === '{') depth++;
    else if (head[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.notStrictEqual(end, -1, 'could not find the end of errWhy');
  const expr = head.slice(0, end).trim();
  assert.equal((expr.match(/\{/g) || []).length, (expr.match(/\}/g) || []).length,
    'the slice must be brace-balanced');
  const why = vm.runInNewContext('(' + expr + ')');
  // The real message, always.
  assert.equal(why(new Error('boom')), 'boom');
  // An Error with no usable message stringifies to itself, which is at
  // least not empty: String(new Error('')) is 'Error', and a whitespace
  // message still appears inside Error.prototype.toString.
  assert.equal(why(new Error('')), 'Error');
  assert.equal(why(new Error('   ')), 'Error:    ');
  // A thrown value with its own text keeps it.
  assert.equal(why('offline'), 'offline');
  assert.equal(why(404), '404');
  // Nothing, or something that would stringify to nothing useful.
  assert.equal(why({}), 'unknown error');
  assert.equal(why({ message: 42 }), 'unknown error');
  assert.equal(why([]), 'unknown error');
  assert.equal(why(null), 'unknown error');
  assert.equal(why(undefined), 'unknown error');
  // The invariant the whole thing exists for: nothing reaches the library
  // as an empty or whitespace-only message, because it would render nothing.
  for (const v of [new Error(''), {}, { message: '  ' }, [], null, undefined, '', 'x', 0]) {
    assert.ok(why(v).trim().length > 0, `${JSON.stringify(v)} produced an empty reason`);
  }
});

test('C9 — no failure toast interpolates err.message directly', () => {
  const lines = src.split('\n');
  const offenders = lines
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /showToast\(/.test(l) && /\$\{\s*err\.message\s*\}/.test(l));
  sameDeep(offenders, [], 'these route around errWhy and can render nothing');
});

test('C10 — errWhy is exported to the vm harness, or it is unreachable', () => {
  // It is a top-level const in app.js, which runs inside an IIFE, so the
  // tests can only reach it by slicing the source — which C8 does. What
  // matters here is that it exists at all and is not shadowed.
  assert.match(src, /^const errWhy = \(err\) => /m);
  assert.equal((src.match(/^const errWhy = /gm) || []).length, 1);
  // ...and the pre-existing inline guard was replaced by it, not duplicated.
  assert.doesNotMatch(src, /const why = \(err && err\.message\)/);
  assert.match(src, /const why = errWhy\(err\);/);
});

test('C7 — the timing is Penguin\'s, and Undo buys itself more', () => {
    assert.match(src, /const TOAST_MS = 8000;/);
    assert.match(src, /const TOAST_UNDO_MS = 10000;/);
    assert.match(src, /showProgress: false/,
      'Penguin has no countdown bar on a notification');
    assert.match(src, /pauseOnHover: true/);
  });
});

describe('E — the colour follows the action', () => {
  test('E1 — success is green, a failed read or write is red, work in flight is orange', () => {
    const block = css.slice(css.indexOf('Notifications (hcg-toast, Penguin'));
    // Green.
    const success = block.slice(block.indexOf('.hcg-toast-item--success'));
    assert.match(success, /--toast-tint: var\(--hcg-toast-success-accent\);/);
    // Red.
    const error = block.slice(block.indexOf('.hcg-toast-item--error'));
    assert.match(error, /--toast-tint: var\(--danger\);/);
    // Orange — pending shares --warn, and the two are told apart by glyph.
    const pending = block.slice(block.indexOf('.hcg-toast-item--warning,'));
    assert.match(pending, /\.hcg-toast-item--pending \{[\s\S]*?--toast-tint: var\(--warn\);/);
  });

  test('E2 — a sticky line with no type of its own is pending', () => {
    // Every sticky message in this app is a batch saying what it is
    // doing, so the default has to be the colour that means "still going".
    const show = sliceCode('function showToast');
    assert.match(show, /const type = o\.type \|\| \(o\.sticky \? 'pending' : 'info'\);/);
  });

  test('E3 — an explicit type outranks the sticky default', () => {
    // The batches raise sticky *errors* mid-run — a file that 403s has to
    // come out red, not orange, or a failed read reads as still-working.
    // The whole match is the evidence: each one names `type: 'error'` on
    // the same option object as `sticky: true`, which is exactly what
    // makes the explicit type outrank the sticky default in showToast.
    const errs = [...src.matchAll(/\{[^}]*type: 'error'[^}]*sticky: true/g)];
    assert.ok(errs.length >= 3,
      'the batches raise sticky errors; none found, so the default cannot be trusted');
    for (const m of errs) {
      assert.match(m[0], /type: 'error'/,
        'a sticky error must keep naming its type rather than taking the pending default');
    }
  });

  test('E4 — the pending glyph is a clock, not a spinner', () => {
    // Nothing in the notification set animates to imply progress; the bar
    // does. A spinning glyph would also sit frozen under reduced-motion
    // while still claiming to be working.
    const glyph = sliceCode('pending: TOAST_GLYPH', '};');
    assert.doesNotMatch(glyph, /animation|@keyframes/);
    assert.match(glyph, /<path d="M10 18a8 8 0 1 0 0-16/);
  });
});

describe('F — long reads and writes report a number', () => {
  test('F1 — showPending says what the app is doing, with a bar under it', () => {
    const fn = sliceCode('function showPending', '/* A message, optionally carrying');
    assert.match(fn, /showToast\(action, \{ type: 'pending', sticky: true, progress: \{ done, total \} \}\)/);
  });

  test('F2 — the bar is built onto the live item, so it dies with it', () => {
    // No separate timer, no node of its own: the item carries it and
    // dismissAll() takes both away together.
    const fn = sliceCode('function renderToastProgress', 'function showPending');
    assert.match(fn, /item\.classList\.add\('hcg-toast-item--progress'\);/);
    assert.match(fn, /item\.appendChild\(bar\);/);
    assert.match(fn, /item\.querySelector\('\.toast-progress'\)/,
      'the second call must reuse the bar, not stack a new one per step');
  });

  test('F3 — both labels live inside the strip', () => {
    const fn = sliceCode('function renderToastProgress', 'function showPending');
    assert.match(fn, /<div class="toast-progress-fill"><\/div>/);
    assert.match(fn, /<span class="toast-progress-count"><\/span>/);
    assert.match(fn, /<span class="toast-progress-pct"><\/span>/);
    // No interpolation: the only things that go in here are numbers this
    // function formats, and nothing in it may be able to inject markup.
    assert.match(fn, /bar\.innerHTML = '<div class="toast-progress-fill"><\/div>'\s*\+\s*'<span class="toast-progress-count"><\/span>'\s*\+\s*'<span class="toast-progress-pct"><\/span>';/);
  });

  test('F4 — done is clamped to total, so the bar cannot overflow its track', () => {
    // A batch that over-counts — a skipped file still advancing the
    // counter — must not render a fill wider than 100%.
    const fn = sliceCode('function renderToastProgress', 'function showPending');
    assert.match(fn, /const n = Math\.max\(0, Math\.min\(done, total\)\);/);
    assert.match(fn, /bar\.style\.setProperty\('--toast-progress', ratio\.toFixed\(4\)\);/);
    assert.match(fn, /pct\.textContent = `\$\{Math\.round\(ratio \* 100\)\}%`;/);
  });

  test('F5 — no usable total sweeps and admits it, instead of claiming 0%', () => {
    const fn = sliceCode('function renderToastProgress', 'function showPending');
    assert.match(fn, /if \(!Number\.isFinite\(total\) \|\| total <= 0\) \{/);
    assert.match(fn, /bar\.classList\.add\('toast-progress--indeterminate'\);/);
    assert.match(fn, /pct\.textContent = 'Working…';/);
    // ...and it must not also leave a stale fraction behind on the track.
    assert.match(fn, /bar\.style\.removeProperty\('--toast-progress'\);/);
  });

  test('F6 — every long batch reports through it, with both halves', () => {
    // Each batch opens at 0 and advances inside its loop; a bar that only
    // ever opens is a decoration, not progress. `label` is passed through
    // unquoted — applyRestore is called with 'Undo' and 'Revert all'.
    for (const [action, total] of [
      ['Uploading photos', 'total'],
      ['Deleting photos', 'paths.length'],
      ['Moving photos', 'paths.length'],
      ['Renaming photos', 'affected.length'],
      ['Removing photos', 'files'],
      ['label', 'total'],
    ]) {
      const a = new RegExp(`showPending\\('?${action}'?, 0, ${total.replace('.', '\\.')}\\);`);
      assert.match(src, a, `${action} must open its bar at zero`);
      assert.match(src, new RegExp(`showPending\\('?${action}'?, (\\+\\+)?[a-z]+, ${total.replace('.', '\\.')}\\);`),
        `${action} must advance its bar inside the loop`);
    }
  });

  test('F7 — the phase-removal bar counts files, not photos', () => {
    // One asset is its canonical plus its generated variants, so counting
    // assets would sit at 100% for most of the work.
    assert.match(src, /const files = affected\.reduce\(\(n, a\) => n \+ 1 \+ a\.variants\.length, 0\);/);
  });

  test('F8 — the stylesheet gives the strip room and the labels somewhere to sit', () => {
    assert.match(cssCode, /\.hcg-toast-item--progress \{ padding-bottom: 31px; \}/,
      'a bar needs somewhere to sit that is not the message');
    const bar = cssCode.slice(cssCode.indexOf('.toast-progress {'));
    assert.match(bar, /\.toast-progress \{[\S\s]*?position: absolute;/);
    assert.match(bar, /\.toast-progress \{[\S\s]*?bottom: 0;/);
    assert.match(bar, /\.toast-progress-count \{ left: 0; \}/);
    assert.match(bar, /\.toast-progress-pct \{ right: 0; \}/);
    // The labels sit on the fill at one end of the run and the track at
    // the other, which is why --toast-fill is a darker step than the tint.
    //
    // Matched on the comment-stripped copy and anchored to the newline that
    // opens the block: warning shares one selector list with pending, so
    // `.hcg-toast-item--warning {` does not exist and indexOf returned -1,
    // slicing from -1 handed this the tail of the file.
    for (const v of ['info', 'success', 'error', 'warning', 'pending']) {
      const at = cssCode.search(new RegExp(`\\.hcg-toast-item--${v}[\\s\\S]*?\\{`));
      assert.notStrictEqual(at, -1, `no rule found for the ${v} variant`);
      const rule = cssCode.slice(at, cssCode.indexOf('}', at));
      assert.match(rule, /--toast-tint:/, `${v} must declare --toast-tint`);
      assert.match(rule, /--toast-fill: #[0-9a-f]{6};/,
        `${v} needs a deep fill for the white label to clear 4.5:1`);
    }
  });

  test('F9 — reduced-motion stops the sweep rather than freezing it', () => {
    const rm = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    assert.match(rm, /\.toast-progress-fill \{ transition: none !important; animation: none !important; \}/);
  });
});

describe('D — the stylesheet paints it', () => {
  test('D1 — each variant carries its own tint, fill and icon plate', () => {
    for (const type of ['info', 'success', 'warning', 'error', 'pending']) {
      // warning and pending share one rule, so the selector list is
      // matched up to the brace rather than assumed to be a lone class.
      const rule = new RegExp(`\\.hcg-toast-item--${type}[^{]*\\{[^}]*--toast-tint:`);
      assert.match(cssCode, rule, `${type} must declare --toast-tint`);
      assert.match(cssCode, new RegExp(`\\.hcg-toast-item--${type}[^{]*\\{[^}]*--toast-fill:`),
        `${type} must declare --toast-fill, or its bar label has nothing to sit on`);
      assert.match(cssCode, new RegExp(`\\.hcg-toast-item--${type}[^{]*\\{[^}]*background-image: linear-gradient\\(`),
        `${type} must wash itself in its own colour`);
      assert.match(cssCode, new RegExp(`\\.hcg-toast-item--${type}[^{]*\\.hcg-toast-icon \\{`),
        `${type} must plate its icon in its own colour`);
    }
  });

  test('D1b — the card draws no border, and nothing else paints one either', () => {
    // The rectangle is kept for its geometry but made invisible, so the
    // wash and the shadow are the only edge the card has.
    const block = css.slice(css.indexOf('Notifications (hcg-toast, Penguin'));
    assert.match(block, /--hcg-toast-border: transparent;/,
      'the border variable is where the library reads the card border from');
    assert.match(cssCode, /\.hcg-toast-item \{[^}]*border-color: transparent;/,
      'and the item must not re-tint it afterwards');
    // No rule may put a visible border back on the item or its parts.
    for (const sel of ['.hcg-toast-item {', '.hcg-toast-body', '.hcg-toast-icon {']) {
      const at = block.indexOf(sel);
      if (at === -1) continue;
      const rule = block.slice(at, block.indexOf('}', at));
      assert.doesNotMatch(rule, /border(-color)?:\s*(?!none|transparent|0)\S/,
        `${sel} must not draw a visible border`);
    }
  });

  test('D1c — the card is sized by its text and never wraps', () => {
    const item = css.slice(css.indexOf('.hcg-toast-item {'), css.indexOf('.hcg-toast-item--enter'));
    assert.match(item, /width: max-content;/,
      'a four-word message must not produce a full-width bar');
    assert.match(item, /max-width: 100%;/,
      '...but a long one still has to stop at the container');

    const msg = css.slice(css.indexOf('.hcg-toast-message {'), css.indexOf('.hcg-toast-icon {'));
    assert.match(msg, /white-space: nowrap;/);
    assert.match(msg, /overflow: hidden;/);
    assert.match(msg, /text-overflow: ellipsis;/);

    // The nowrap has to be the whole story: the fluid-safety list used
    // to hand .hcg-toast-message `overflow-wrap: anywhere`, which is the
    // opposite instruction and would sit behind it waiting for a browser
    // that wraps inside an overflow:hidden box.
    const fluid = css.slice(css.indexOf('Overflow & fluid safety'));
    const list = fluid.slice(0, fluid.indexOf('}'));
    assert.doesNotMatch(list, /hcg-toast-message/,
      'the notification no longer wants to break anywhere');
  });

  test('D1d — cards hug their text at both anchors', () => {
    const block = css.slice(css.indexOf('Notifications (hcg-toast, Penguin'), css.indexOf('One pair of tokens per message'));
    assert.match(block, /\.hcg-toast-container \{[\s\S]*?align-items: flex-start;/,
      'a phone card should sit against the inset edge, not stretch across it');
    assert.match(block, /@media \(min-width: 768px\)[\s\S]*?align-items: flex-end;/,
      'a desktop card should hug towards the corner it is anchored to');
  });

  test('D2 — the entrance rises 32px and the exit leaves sideways', () => {
    assert.match(cssCode, /\.hcg-toast-item \{[^}]*transform: translateY\(32px\);/);
    assert.match(cssCode, /\.hcg-toast-item--enter[^}]*transform: translateY\(0\);/);
    assert.match(cssCode, /@media \(min-width: 768px\) \{\s*\.hcg-toast-item--exit[^}]*transform: translateX\(96px\);/);
    // 300ms both ways is Penguin's transition, not the library's 250ms.
    assert.match(cssCode, /transition: opacity 300ms ease-out, transform 300ms ease-out;/);
  });

  test('D3 — the phone anchors to the top, clearing the tab bar', () => {
    const block = css.slice(css.indexOf('Notifications (hcg-toast, Penguin'), css.indexOf('One pair of tokens per message'));
    assert.match(block, /\.hcg-toast-container \{[\s\S]*?top: calc\(env\(safe-area-inset-top, 0px\) \+ 12px\);/);
    assert.doesNotMatch(block, /transform: translateX\(-50%\)/,
      "the library's top-center centring is replaced by left/right insets");
    // The desktop corner is the only place the tab bar is not.
    assert.match(block, /bottom: calc\(var\(--tabbar-h\) \+ 20px\);/);
  });

  test('D4 — reduced-motion cannot strand a card mid-entrance', () => {
    // The transitions are killed by the existing reduced-motion block,
    // which would otherwise leave every card parked at the 32px its
    // entrance starts from.
    const rm = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    assert.match(rm, /\.hcg-toast-item--enter[\s\S]*?transform: none;/,
      'the reduced-motion block has to zero the transforms it just stopped animating');
  });

  test('D5 — Undo is a text action wearing the variant colour', () => {
    const undo = css.slice(css.indexOf('.toast-undo {'), css.indexOf('Change history is deliberately'));
    assert.match(undo, /color: var\(--toast-tint\);/);
    assert.match(undo, /font-weight: 700;/);
    assert.match(undo, /border: none;/,
      "Penguin's message variant has text actions, not a plated button");
    assert.match(undo, /min-height: 44px;/,
      'the target still has to be thumb-sized even once the plate is gone');
  });

  test('D6 — the theme plate still reaches every notification', () => {
    const block = css.slice(css.indexOf('Notifications (hcg-toast, Penguin'));
    assert.match(block, /--hcg-toast-bg: var\(--toast-bg\);/);
    assert.match(block, /--hcg-toast-text: var\(--toast-ink\);/);
    // All eleven eye-comfort themes still set --toast-bg; the Penguin
    // look must not have reintroduced a second, theme-blind palette.
    const themes = [...css.matchAll(/--toast-bg: /g)].length;
    assert.ok(themes >= 11, `expected a --toast-bg per theme, found ${themes}`);
  });
});