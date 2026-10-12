/* The notification is Penguin UI's stacking toast, dressed on hcg-toast,
   with a synthesised ding.

   Three things about it are load-bearing and none of them are visible in
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

   Plus the boring ones: every type the call sites use has a glyph, the
   dismissal is the stroked cross rather than the library's `&times;`, the
   card draws no border, and reduced-motion cannot strand a card at the
   offset its entrance starts from. */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';

const APP = new URL('../app.js', import.meta.url);
const CSS = new URL('../style.css', import.meta.url);
const app = await readFile(APP, 'utf8');
const css = await readFile(CSS, 'utf8');

const sameDeep = (a, b, msg) => assert.deepStrictEqual(a, b, msg);

describe('A — the sound is only ever heard on purpose', () => {
  test('A1 — no AudioContext is built before a gesture', () => {
    // The unlock is a one-shot listener on the page, not on the toast:
    // a visitor who has scrolled, tapped or tabbed has unlocked it.
    assert.match(app, /window\.addEventListener\('pointerdown', unlock, \{ once: true, capture: true \}\)/);
    assert.match(app, /window\.addEventListener\('keydown', unlock, \{ once: true, capture: true \}\)/);
  });

  test('A2 — playToastDing returns before it touches an AudioContext', () => {
    const ding = app.slice(app.indexOf('function playToastDing'), app.indexOf('function setToastSound'));
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
    assert.match(app, /if \(toastAudio\.state === 'suspended'\) return;/);
    assert.doesNotMatch(app, /toastAudio\.resume\(/,
      'the ding must not resume the context to get around the gate');
  });

  test('A4 — a sticky progress line is silent', () => {
    const show = app.slice(app.indexOf('function showToast'));
    const sound = /if \(!o\.sticky\) playToastDing\(\);/.test(show);
    assert.ok(sound,
      'the batch loops raise one sticky line per photo — only a timed message may sound');
    // And the guard sits inside showToast, after the library call, so a
    // message that never rendered never sounds.
    const call = show.indexOf('playToastDing()');
    const shown = show.indexOf('toastId = id;');
    assert.ok(shown !== -1 && shown < call,
      'the ding must follow the message actually being shown');
  });

  test('A5 — the sound is synthesised, not fetched', () => {
    // A file would mean a network request and a licence for one
    // oscillator, and the archive has to keep working offline.
    const ding = app.slice(app.indexOf('function playToastDing'), app.indexOf('function setToastSound'));
    assert.doesNotMatch(ding, /new Audio\(|https?:\/\//,
      'the ding must be synthesised — no audio file, no CDN');
    assert.match(ding, /createOscillator\(\)/);
    assert.match(ding, /osc\.type = 'sine'/);
  });
});

describe('B — the switch is offered, remembered, and honest', () => {
  test('B1 — it defaults to on and persists under gallery.toastSound', () => {
    assert.match(app, /const TOAST_SOUND_KEY = 'gallery\.toastSound';/);
    // Anything that is not an explicit "off" is on — a half-written or
    // stale value must not mute the archive by accident.
    assert.match(app, /localStorage\.getItem\(TOAST_SOUND_KEY\) !== 'off'/);
  });

  test('B2 — a storage that throws does not take the notification with it', () => {
    const read = app.slice(app.indexOf('function storedToastSound'), app.indexOf('let toastSoundOn'));
    assert.match(read, /try \{[\s\S]*\} catch \(_\) \{\s*return true;/,
      'localStorage can throw in private mode; the default must still answer');
  });

  test('B3 — the ⋮ menu offers it to everyone, not just the admin', () => {
    const menu = app.slice(app.indexOf('function mainMenu'), app.indexOf('function albumMenu'));
    assert.match(menu, /label: toastSoundOn \? 'Notification sound on' : 'Notification sound off'/,
      'the row must say what tapping it will do, not what it did last time');
    assert.match(menu, /onTap: \(\) => setToastSound\(!toastSoundOn\)/);
    // It is built before the admin spread, so a visitor gets it too.
    assert.ok(menu.indexOf('setToastSound') < menu.indexOf('state.adminMode'),
      'the sound switch belongs to everyone, so it must sit above the admin branch');
  });

  test('B4 — turning it back on plays the ding, so the row confirms itself', () => {
    const set = app.slice(app.indexOf('function setToastSound'), app.indexOf('let toastId'));
    assert.match(set, /if \(toastSoundOn\) playToastDing\(\);/);
    assert.match(set, /localStorage\.setItem\(TOAST_SOUND_KEY, toastSoundOn \? 'on' : 'off'\)/);
  });
});

describe('C — every message is drawn in Penguin\'s shape', () => {
  test('C1 — each type the call sites use has its own glyph', () => {
    // Every `type:` literal the app raises, by the only key that matters.
    const used = new Set([...app.matchAll(/type:\s*'([a-z]+)'/g)].map(m => m[1]));
    assert.ok(used.size > 0, 'no typed notifications found — the audit found nothing');
    const defined = new Set([...app.matchAll(/^\s{2}(\w+): TOAST_GLYPH\(/gm)].map(m => m[1]));
    for (const t of ['info', 'success', 'warning', 'error']) {
      assert.ok(defined.has(t), `the library type '${t}' has no glyph`);
    }
    for (const t of used) {
      assert.ok(defined.has(t), `type '${t}' is raised somewhere but has no glyph`);
    }
  });

  test('C2 — the glyphs are inline SVG, not the library\'s text characters', () => {
    assert.match(app, /<svg viewBox="0 0 20 20" fill="currentColor"/);
    // The library's own glyphs are ℹ ✓ ⚠ ✕, and a toast that renders
    // one of those is back to the old look.
    const glyphs = app.slice(app.indexOf('const TOAST_GLYPHS'), app.indexOf('const TOAST_CLOSE_GLYPH'));
    for (const ch of ['\u2139', '\u2713', '\u26a0', '\u2715']) {
      assert.ok(!glyphs.includes(ch), `the Penguin set must not fall back to ${ch}`);
    }
  });

  test('C3 — the dismissal is a stroked cross, not &times;', () => {
    assert.match(app, /const TOAST_CLOSE_GLYPH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"/);
    assert.match(app, /const TOAST_CLOSE_GLYPH = '<svg[^']*M6 18L18 6M6 6l12 12/);
    const decorate = app.slice(app.indexOf('function decorateToast'), app.indexOf('/* A message, optionally carrying'));
    assert.match(decorate, /close\.innerHTML = TOAST_CLOSE_GLYPH/,
      'the library renders `&times;`; decorateToast has to put the real mark in');
  });

  test('C4 — Undo is placed in the body, not beside it', () => {
    const decorate = app.slice(app.indexOf('function decorateToast'), app.indexOf('/* A message, optionally carrying'));
    assert.match(decorate, /item\.querySelector\('\.hcg-toast-body'\) \|\| item\)\.appendChild\(btn\)/,
      'Undo belongs under the message, in the body column');
    assert.doesNotMatch(decorate, /insertBefore/,
      'the old placement parked the button between the text and the dismiss X');
  });

  test('C5 — decorateToast runs for every message, not only the undoable ones', () => {
    // The dismiss cross is swapped in there too, so guarding the call on
    // `undo` would leave every ordinary message with a `&times;`.
    const show = app.slice(app.indexOf('function showToast'));
    assert.match(show, /^\s*decorateToast\(id, undo\);/m);
    assert.doesNotMatch(show, /if \(undo\) decorateToast/);
  });

  test('C6 — the library is still configured the same way round', () => {
    // The Penguin look is skin. The plumbing stays one toast at a time,
    // because the batch loops replace rather than stack.
    assert.match(app, /const TOAST_POSITION = 'top-center';/);
    assert.match(app, /const TOAST_MAX = 3;/);
    assert.match(app, /lib\.dismissAll\(\);/,
      'a replacing toast must remove the last one outright');
  });

  test('C7 — the timing is Penguin\'s, and Undo buys itself more', () => {
    assert.match(app, /const TOAST_MS = 8000;/);
    assert.match(app, /const TOAST_UNDO_MS = 10000;/);
    assert.match(app, /showProgress: false/,
      'Penguin has no countdown bar on a notification');
    assert.match(app, /pauseOnHover: true/);
  });
});

describe('D — the stylesheet paints it', () => {
  test('D1 — each variant carries its own tint, border and icon plate', () => {
    for (const type of ['info', 'success', 'warning', 'error']) {
      assert.match(css, new RegExp(`\\.hcg-toast-item--${type} \\{[^}]*--toast-tint:`),
        `${type} must declare --toast-tint`);
      assert.match(css, new RegExp(`\\.hcg-toast-item--${type} \\{[^}]*background-image: linear-gradient\\(`),
        `${type} must wash itself in its own colour`);
    }
  });

  test('D1b — the card draws no border, and nothing else paints one either', () => {
    // The rectangle is kept for its geometry but made invisible, so the
    // wash and the shadow are the only edge the card has.
    const block = css.slice(css.indexOf('Notifications (hcg-toast, Penguin'));
    assert.match(block, /--hcg-toast-border: transparent;/,
      'the border variable is where the library reads the card border from');
    assert.match(css, /\.hcg-toast-item \{[^}]*border-color: transparent;/,
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
    const block = css.slice(css.indexOf('Notifications (hcg-toast, Penguin'), css.indexOf('One variant token per message'));
    assert.match(block, /\.hcg-toast-container \{[\s\S]*?align-items: flex-start;/,
      'a phone card should sit against the inset edge, not stretch across it');
    assert.match(block, /@media \(min-width: 768px\)[\s\S]*?align-items: flex-end;/,
      'a desktop card should hug towards the corner it is anchored to');
  });

  test('D2 — the entrance rises 32px and the exit leaves sideways', () => {
    assert.match(css, /\.hcg-toast-item \{[^}]*transform: translateY\(32px\);/);
    assert.match(css, /\.hcg-toast-item--enter[^}]*transform: translateY\(0\);/);
    assert.match(css, /@media \(min-width: 768px\) \{\s*\.hcg-toast-item--exit[^}]*transform: translateX\(96px\);/);
    // 300ms both ways is Penguin's transition, not the library's 250ms.
    assert.match(css, /transition: opacity 300ms ease-out, transform 300ms ease-out;/);
  });

  test('D3 — the phone anchors to the top, clearing the tab bar', () => {
    const block = css.slice(css.indexOf('Notifications (hcg-toast, Penguin'), css.indexOf('One variant token per message'));
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