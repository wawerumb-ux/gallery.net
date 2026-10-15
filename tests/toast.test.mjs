/* The notification is Penguin UI's stacking toast, dressed on hcg-toast,
   with a synthesised palette of four voices.

   Five things about it are load-bearing and none of them are visible in
   a screenshot:

   1. The sound is gated on a user gesture. An AudioContext built before
      one is born suspended, so a notification that arrives first — a
      rate-limit warning raised during boot, say — must be silent rather
      than queue a context Chrome will warn about and never resume. And a
      context suspended *later* — by iOS backgrounding, or a call — must be
      replaced rather than obeyed, or the app goes quiet for the session.
   2. A progress line must not sound. The batch loops raise one per photo;
      forty dings across a single upload is not a notification, it is a
      machine gun. The gate is on `type === 'pending'`, not on stickiness
      — four sticky lines are errors that stay on screen until dismissed,
      and those are exactly the ones that must be heard.
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
   6. A notification has four voices and **no audio file anywhere**. Every
      voice is built from oscillators, so there is nothing to download,
      decode, licence or attribute, and the archive keeps working with the
      network gone. A recording was tried and removed — the sources that
      permit redistributing a file are the ones with the thinnest catalogue
      for interface use, and the rest demand a credit line — so this test
      guards the *absence* of that machinery, not just its behaviour.

   Two of the four are derived from the message rather than requested by
   the call site, because they carry information the words do not: an
   `error` type sounds like failure even if the text reads like success,
   and a message offering Undo sounds unsettled. A call site that forgets
   to ask still gets both.

   And every voice has to survive the hardware it will actually meet: a
   note below ~400Hz is a click on a phone speaker, so `error` carries an
   extra partial it does not need on a laptop.

   Plus the boring ones: every type the call sites use has a glyph, the
   dismissal is the stroked cross rather than the library's `&times;`, the
   card draws no border, and reduced-motion cannot strand a card at the
   offset its entrance starts from. */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const APP = new URL('../app.js', import.meta.url);
const CSS = new URL('../style.css', import.meta.url);
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

  test('A3 — a suspended context is never resumed', () => {
    /* resume() on a context nobody has unlocked is what trips Chrome's
       autoplay warning, and it is a lie about why the context is
       suspended. So it stays off — permanently, in every branch.

       What *has* changed is what happens instead of resuming. This test
       used to assert `if (suspended) return;` outright, which meant a
       context suspended by iOS backgrounding silenced notifications for
       the rest of the session with no recovery — the exact bug the
       discard-and-rebuild path exists to fix. The rule is not "obey a
       suspended context"; it is "never resume one". */
    assert.doesNotMatch(src, /\.resume\(/,
      'nothing may resume a context to get around a gate');
    // A context that is running when it should be dead is replaced.
    assert.match(src, /if \(toastAudio\.state === 'suspended'\) \{/,
      'a suspended context must be examined, not merely obeyed');
    assert.match(src, /dead\.close\(\)|toastAudio\.close\(\)/,
      'and the dead one must be released');
    // A context born suspended is the browser refusing, which is obeyed
    // once and remembered, so the app cannot churn a context per message.
    assert.match(src, /toastRefused = true;/,
      'a browser refusal must be remembered rather than retried forever');
  });

  test('A4 — a progress line is silent, but a sticky outcome is not', () => {
    const show = sliceCode('function showToast');
    assert.match(show, /if \(!o\.sticky \|\| type !== 'pending'\) playToastDing\(o\.sound\);/,
      'the gate must exclude work in flight, not everything that stays on screen');
    // And the guard sits inside showToast, after the library call, so a
    // message that never rendered never sounds.
    const call = show.indexOf('playToastDing(o.sound)');
    const shown = show.indexOf('toastId = id;');
    assert.ok(shown !== -1 && shown < call,
      'the ding must follow the message actually being shown');

    /* This gate used to be `if (!o.sticky)`, which silenced every sticky
       line — including four sticky *errors* that sit on screen until the
       visitor dismisses them. An unsaved classification and a file that
       could not be deleted are exactly the outcomes that must not be
       reported in silence and then simply left there. The rule is about
       frequency, not about stickiness. */
    const stickyErrors = [...app.matchAll(/showToast\(([^;]*?sticky: true[^;]*?)\)/g)]
      .filter((m) => /type: 'error'/.test(m[1]));
    assert.ok(stickyErrors.length >= 3,
      'this app really does raise sticky errors — if that ever stops, this test should be revisited');
    // Every one of them must be audible now, since none of them leaves.
    assert.doesNotMatch(show, /sticky[^\n]*type: 'error'[^\n]*return/,
      'a sticky error may not be singled out for silence');
  });

  test('A5 — every voice is synthesised, and nothing is fetched', () => {
    // The load-bearing claim, now absolute: there is no audio file in this
    // app at all. A file would mean a network request and a licence for
    // what is one oscillator, and the archive has to keep working offline.
    const ding = sliceCode('function playToastDing', 'function setToastSound');
    assert.doesNotMatch(ding, /new Audio\(|https?:\/\//,
      'the default voice must be synthesised — no audio file, no CDN');
    assert.match(ding, /createOscillator\(\)/);
    assert.match(ding, /osc\.type = 'sine'/);
  });

  test('A6 — the recording mechanism is gone, not merely unused', () => {
    // A recorded notification was tried and removed: the sources that
    // permit redistributing a file are the ones with the thinnest catalogue
    // for interface use, and the rest demand a credit line or forbid
    // shipping the file. What replaced it is the palette below.
    //
    // Asserting the *absence* of the machinery is stronger than asserting
    // that it behaves: an unused registry, a primed cache and a `sound:`
    // name that resolves to a file are all costs with no benefit, and
    // nobody would notice them by reading the code.
    for (const gone of ['TOAST_SOUND_FILES', 'playToastFile', 'primeToastSounds',
      'toastSoundEl', 'toastAudioEls']) {
      assert.doesNotMatch(src, new RegExp(gone), `${gone} should no longer exist`);
    }
    // Nothing anywhere in the app may reach for an audio file.
    assert.doesNotMatch(app, /new Audio\(/,
      'no notification may build an HTMLAudioElement');
    assert.doesNotMatch(app, /['"`]audio\//,
      'no notification may reference a file in audio/');
    // And `sound:` now names a voice and nothing else. Matched against the
    // comment-stripped source so the prose around a call site cannot be
    // mistaken for its arguments — a bare `sound: (\w+)` reads "failed"
    // out of the sentence "a batch that sounded like a triumph…".
    const names = [...code(app).matchAll(/sound: '(\w+)'/g)].map((m) => m[1]);
    const palette = sliceCode('const TOAST_VOICES', 'const DEFAULT_VOICE');
    const known = [...palette.matchAll(/^  (\w+): \{/gm)].map((m) => m[1]);
    for (const n of names) {
      assert.ok(known.includes(n), `"${n}" is not a voice in the palette`);
    }
  });

  test('A7b — each voice is the interval its comment claims', () => {
    /* Two of these comments were wrong once: `error` was described as a
       falling minor third when it is a major one, and `undo` as a falling
       fourth when it is a fifth. Nothing caught it because the comments
       were prose and the frequencies were numbers, and the two were never
       compared. This does that comparison, so the next person who retunes a
       note finds out here rather than by ear. */
    const palette = sliceCode('const TOAST_VOICES', 'const DEFAULT_VOICE');
    const voices = {};
    for (const [, name, decay, raw] of palette.matchAll(
      /^  (\w+): \{\n    decay: ([\d.]+),\n    partials: (\[\[.*\]\]),/gm)) {
      voices[name] = { decay: Number(decay), partials: JSON.parse(raw) };
    }
    assert.strictEqual(Object.keys(voices).length, 4, 'all four voices parsed');

    const cents = (a, b) => 1200 * Math.log2(b / a);
    /* Keyed by absolute semitone count: a fourth is 5, a fifth is 7. */
    const SEMITONE = {
      1: 'min 2nd', 2: 'maj 2nd', 3: 'min 3rd', 4: 'MAJ 3rd',
      5: 'PERF 4th', 6: 'tritone', 7: 'PERF 5th', 8: 'min 6th',
      9: 'maj 6th', 10: 'min 7th', 11: 'maj 7th',
    };
    // [name, first partial, second partial, semitones, direction, claimed]
    const claims = [
      ['ding', 7, 'rising', 'PERF 5th'],
      ['error', 4, 'falling', 'MAJ 3rd'],
      ['undo', 7, 'falling', 'PERF 5th'],
      ['success', 5, 'rising', 'PERF 4th'],
    ];
    for (const [name, wantSemis, wantDir, wantName] of claims) {
      const f = voices[name].partials.map((p) => p[0]);
      const iv = Math.round(cents(f[0], f[1]));
      const dir = iv > 0 ? 'rising' : 'falling';
      assert.strictEqual(dir, wantDir, `${name} should ${wantDir}`);
      assert.strictEqual(Math.abs(Math.round(iv / 100)), wantSemis,
        `${name} moves ${iv}c, not the ${wantSemis} semitones claimed`);
      assert.strictEqual(SEMITONE[wantSemis], wantName, 'the table itself is wrong');
    }

    // The mirror pair is the design, not a coincidence: ding and undo are
    // the same interval in opposite directions, so "it happened" and "it
    // was taken back" are recognisably the same gesture run backwards.
    const ding = Math.round(cents(...voices.ding.partials.slice(0, 2).map((p) => p[0])));
    const undo = Math.round(cents(...voices.undo.partials.slice(0, 2).map((p) => p[0])));
    assert.strictEqual(Math.abs(ding), Math.abs(undo),
      'ding and undo must be the same interval size, mirrored');
    assert.ok(ding > 0 && undo < 0, 'ding rises, undo falls');

    // And the error voice must be far enough below the default to be told
    // apart by register alone, before direction or timbre register.
    const octaves = Math.abs(cents(voices.error.partials[0][0], voices.ding.partials[0][0])) / 1200;
    assert.ok(octaves > 1,
      `error is only ${octaves.toFixed(2)} octaves from ding — too close to confuse`);
  });

  test('A7 — the palette is four voices, and no two are the same sound', () => {
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

  test('A8 — every voice decays inside the toast it belongs to', () => {
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

  test('A9 — failure and Undo are heard before they are read', () => {
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

  test('A10 — a partial batch never gets the voice of a finished one', () => {
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
    assert.match(set, /localStorage\.setItem\(TOAST_SOUND_KEY, toastSoundOn \? 'on' : 'off'\)/);
    /* Written as `if (on) play(); else close();` rather than the earlier
       `if (on) play();` on its own, because muting now has work to do too.
       The property being protected is the same either way: turning sound
       ON is audible. */
    assert.match(set, /playToastDing\(\);/,
      'enabling the sound must play it, so the row confirms itself by being heard');
    assert.match(set, /ctx\.close\(\)/,
      'disabling it must release the output device, not merely stop the next sound');
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
    // 'pending' is no longer raised by a literal call site: nothing announces
    // work in flight any more. It is still the type a sticky message falls
    // back to, so the glyph and the tint have to stay.
    assert.match(src, /o\.sticky \? 'pending' : 'info'/,
      'a sticky message with no type of its own must still fall back to pending');
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