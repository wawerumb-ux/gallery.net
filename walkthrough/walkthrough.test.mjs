/* walkthrough/walkthrough.test.mjs — the walkthrough's test suite.

   Same approach as tour/tour.test.mjs and tests/: the real sources
   (walkthrough/steps.js, walkthrough/walkthrough.js) run inside a
   node:vm sandbox with a small DOM stub, a requestAnimationFrame
   queue, a timer queue driven by advance(ms), and an in-memory
   sessionStorage. Nothing is exported from the runtime on purpose —
   these tests drive it the way a browser does and observe the page's
   classes, which is what the user actually sees.

   Run with: node --test walkthrough/     (or plain `node --test`)

   The suite exists because the slide transitions shipped with the
   arrival silently dead: wt-t-arrive was left out of the CSS rule
   that reads the --wt-t-* custom properties, so the start state was
   never painted and the -in class was never dropped. Every check on
   the arrival order below is a guard against exactly that. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path, { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const stepsSrc = fs.readFileSync(join(here, 'steps.js'), 'utf8');
const runtimeSrc = fs.readFileSync(join(here, 'walkthrough.js'), 'utf8');
const cssSrc = fs.readFileSync(join(here, 'walkthrough.css'), 'utf8');

/* ── Element stub (only what walkthrough.js touches) ──────────── */

function makeEl(tag) {
  const classes = new Set();
  const el = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    children: [],
    parentNode: null,
    attrs: {},
    dataset: {},
    _textContent: '',
    hidden: false,
    src: '', alt: '', decoding: '', loading: '',
    style: {
      props: {},
      setProperty(k, v) { this.props[k] = v; },
      getPropertyValue(k) { return this.props[k] || ''; },
    },
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, on) => { const want = on ?? !classes.has(c); want ? classes.add(c) : classes.delete(c); return want; },
    },
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
    hasAttribute(k) { return k in el.attrs; },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    insertBefore(node, ref) {
      node.parentNode = el;
      const i = ref ? el.children.indexOf(ref) : -1;
      if (i === -1) el.children.push(node); else el.children.splice(i, 0, node);
      return node;
    },
    get firstChild() { return el.children[0] || null; },
    addEventListener() {},
  };
  Object.defineProperty(el, 'className', {
    get: () => [...classes].join(' '),
    set: (v) => { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
  });
  Object.defineProperty(el, 'textContent', {
    get: () => el._textContent,
    set: (v) => { el._textContent = String(v); },
  });
  Object.defineProperty(el, 'innerHTML', {
    get: () => '',
    set: (v) => { if (v === '') el.children = []; },
  });
  el.classes = () => [...classes].sort();
  return el;
}

/* ── Sandbox ──────────────────────────────────────────────────── */

function setup({ depth = 2, step = 3, reduce = false, recorded = null } = {}) {
  const store = new Map();
  const rafs = [];
  const timers = [];
  const navigations = [];
  const docListeners = {};
  let fakeNow = 1000;
  if (recorded) store.set('wt-transition', recorded);

  const byId = {};
  const mk = (id, tag) => { const e = makeEl(tag); if (id) { e.id = id; byId[id] = e; } return e; };

  const body = makeEl('body');
  body.dataset.depth = String(depth);
  if (step != null) body.dataset.step = String(step);

  const ambient = mk('wtAmbient', 'div');
  const page = makeEl('main'); page.className = 'wt-page';
  const media = mk('wtMedia', 'div');
  const counter = mk('wtCounter', 'span');
  const title = mk('wtTitle', 'h1');
  const copy = mk('wtCopy', 'p');
  const dots = mk('wtDots', 'nav');
  const actions = mk('wtActions', 'div');
  body.appendChild(ambient); body.appendChild(page);
  page.appendChild(media);
  for (const el of [counter, title, copy, dots, actions]) page.appendChild(el);

  const byClass = { 'wt-page': page };
  const document = {
    body,
    readyState: 'complete',
    createElement: (t) => makeEl(t),
    getElementById: (id) => byId[id] || null,
    querySelector(sel) {
      if (sel.startsWith('#')) return byId[sel.slice(1)] || null;
      if (sel.startsWith('.')) return byClass[sel.slice(1)] || null;
      return null;
    },
    querySelectorAll(sel) { const e = this.querySelector(sel); return e ? [e] : []; },
    addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); },
  };

  // The runtime navigates by assigning location.href, so that
  // assignment is the observable event — not a method call.
  const location = { assign: (u) => navigations.push(u) };
  Object.defineProperty(location, 'href', {
    get: () => 'https://example.test/walkthrough/cabling/',
    set: (v) => navigations.push(v),
  });
  const window = {
    innerWidth: 1280,
    matchMedia: () => ({ matches: reduce, addEventListener() {} }),
    location,
    requestAnimationFrame: (fn) => { rafs.push(fn); return rafs.length; },
  };

  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    document, window,
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
    requestAnimationFrame: window.requestAnimationFrame,
    setTimeout: (fn, ms) => { const t = { fn, ms: ms || 0, at: fakeNow + (ms || 0), cancelled: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cancelled = true; },
    Date: { now: () => fakeNow },
  };
  sandbox.globalThis = sandbox;

  vm.runInContext(stepsSrc + '\n' + runtimeSrc, vm.createContext(sandbox), { filename: 'walkthrough.js' });

  return {
    page, store, navigations,
    // Tour classes only: the page keeps its structural 'wt-page' class
    // for the whole test, so comparing it in every assertion is noise.
    classes: () => page.classes().filter(c => c !== 'wt-page'),
    // Two frames, as the runtime itself uses two rAFs.
    flushRaf() { let n = 0; while (rafs.length) { const fn = rafs.shift(); fn(); n++; if (n > 50) throw new Error('rAF loop'); } return n; },
    advance(ms) {
      const until = fakeNow + ms;
      let ran = 0;
      for (;;) {
        let next = null;
        for (const t of timers) {
          if (t.cancelled || t.at > until) continue;
          if (!next || t.at < next.at) next = t;
        }
        if (!next) break;
        fakeNow = next.at;
        timers.splice(timers.indexOf(next), 1);
        next.fn();
        ran++;
        if (ran > 10000) throw new Error('timer drain loop');
      }
      fakeNow = until;
      return ran;
    },
    // A real user click on a link inside the page.
    clickLink(href, extra = {}) {
      const a = makeEl('a');
      a.href = href;
      a.setAttribute('href', href);
      const e = {
        target: { closest: (sel) => (sel === 'a' ? a : null) },
        preventDefault() { e.defaultPrevented = true; },
        defaultPrevented: false,
        metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
        ...extra,
      };
      (docListeners.click || []).forEach(fn => fn(e));
      return e;
    },
  };
}

/* ── The authored steps ────────────────────────────────────────── */

// The step list is read straight out of the real steps.js in its own
// realm, so these tests audit the file that actually ships.
const authored = (() => {
  const sandbox = {};
  vm.runInNewContext(stepsSrc + '\n;globalThis.__S = STEPS;', sandbox);
  return JSON.parse(JSON.stringify(sandbox.__S));
})();

describe('W — authored steps', () => {
  test('W1 — every step declares a transition the runtime knows', () => {
    const runtime = fs.readFileSync(join(here, 'walkthrough.js'), 'utf8');
    const vocab = /var TRANSITIONS = \[([\s\S]*?)\];/.exec(runtime)[1]
      .match(/'([^']+)'/).slice(1);
    const known = [...runtime.matchAll(/'([a-z-]+)'/g)]
      .map(m => m[1]);
    assert.ok(/var TRANSITIONS = \[/.test(runtime), 'runtime declares TRANSITIONS');
    for (const s of authored) {
      assert.ok(s.transition, s.slug + ' has no transition');
      assert.ok(known.includes(s.transition),
        s.slug + ' uses "' + s.transition + '" which the runtime vocabulary does not list');
    }
  });

  test('W2 — the arc uses a different transition per step', () => {
    const kinds = authored.map(s => s.transition);
    assert.ok(new Set(kinds).size >= 6, 'expected a varied vocabulary, got ' + JSON.stringify(kinds));
  });

  test('W3 — the same transition arrives and departs (one continuous move)', () => {
    // The outgoing page plays the mirror of the DESTINATION's kind, so
    // a step is left with the same family it will be entered by.
    const h = setup({ step: 1, recorded: null });
    const nextKind = authored[1].transition;
    h.clickLink('https://example.test/walkthrough/infrastructure/');
    assert.ok(h.classes().includes('wt-t-' + nextKind + '-out'),
      'step 1 departs with ' + nextKind + "-out, got " + JSON.stringify(h.classes()));
  });
});

describe('W — the arrival timeline (the regression that shipped broken)', () => {
  test('W4 — the start state lands first, then the class is dropped to travel home', () => {
    const kind = authored[2].transition; // the page under test
    const h = setup({ step: 3, recorded: kind });
    // Synchronously, before any frame: arrive + the kind's start state.
    assert.deepEqual(h.classes(), ['wt-t-arrive', 'wt-t-' + kind + '-in'].sort());
    // After the frames: the start class is GONE (so the variables fall
    // back to the settled slide) and the carrier is on. wt-t-arrive
    // stays until the slide lands — it owns will-change.
    h.flushRaf();
    assert.deepEqual(h.classes(), ['wt-t-arrive', 'wt-t-go'],
      'start class must be removed as -go is added');
  });

  test('W5 — the carriers release once the slide has landed', () => {
    const kind = authored[2].transition;
    const h = setup({ step: 3, recorded: kind });
    h.flushRaf();
    h.advance(600); // past ARRIVE_MS
    assert.deepEqual(h.classes(), [], 'the page goes back to a plain box');
  });

  test('W6 — an unrecorded visit (direct load, reload) still gets a fade', () => {
    const h = setup({ step: 4, recorded: null });
    assert.ok(h.classes().includes('wt-t-fade-in'), JSON.stringify(h.classes()));
    h.flushRaf();
    assert.deepEqual(h.classes(), ['wt-t-arrive', 'wt-t-go']);
  });

  test('W7 — the record is read once and cleared, so a reload never replays it', () => {
    const h = setup({ step: 3, recorded: 'push-left' });
    assert.ok(h.classes().includes('wt-t-push-left-in'));
    assert.ok(!h.store.has('wt-transition'), 'the transition record is consumed, so a reload cannot replay it');
  });

  test('W8 — reduced motion applies no classes at all', () => {
    const h = setup({ step: 3, recorded: 'zoom-in', reduce: true });
    h.flushRaf();
    assert.deepEqual(h.classes(), [], 'reduced motion is simply there');
  });
});

describe('W — departure', () => {
  test('W9 — leaving plays the mirror and records the destination kind', () => {
    const h = setup({ step: 2, recorded: null });
    const dest = authored[2].transition;
    h.clickLink('https://example.test/walkthrough/cabling/');
    assert.ok(h.classes().includes('wt-t-leave'), 'the leave carrier is on');
    assert.ok(h.classes().includes('wt-t-' + dest + '-out'), JSON.stringify(h.classes()));
    assert.equal(h.store.get('wt-transition'), dest, 'the destination kind is recorded');
  });

  test('W10 — navigation waits for the departure to finish', () => {
    const h = setup({ step: 2 });
    h.clickLink('https://example.test/walkthrough/cabling/');
    assert.deepEqual(h.navigations, [], 'not before the transition runs');
    h.advance(320);
    assert.deepEqual(h.navigations, ['https://example.test/walkthrough/cabling/']);
  });

  test('W11 — stepping backwards through the dots mirrors a push', () => {
    const h = setup({ step: 3 });
    assert.equal(authored[1].transition, 'push-left', 'step 2 is the push');
    h.clickLink('https://example.test/walkthrough/infrastructure/'); // backwards
    assert.ok(h.classes().includes('wt-t-push-right-out'),
      'a backwards jump pushes the other way, got ' + JSON.stringify(h.classes()));
  });

  test('W12 — leaving to the gallery (not a step) is a plain fade', () => {
    const h = setup({ step: 3 });
    h.clickLink('https://example.test/index.html');
    assert.ok(h.classes().includes('wt-t-fade-out'), JSON.stringify(h.classes()));
  });

  test('W13 — reduced motion navigates immediately, with no leave', () => {
    const h = setup({ step: 3, reduce: true });
    h.clickLink('https://example.test/index.html');
    assert.deepEqual(h.navigations, ['https://example.test/index.html']);
    assert.deepEqual(h.classes(), []);
  });
});

describe('W — the deck layout', () => {
  // The desktop deck is a grid of rail | slide | panel. These assert
  // the grid actually resolves — a silent CSS mistake here would just
  // look like a plainer page, never an error.
  const desk = cssSrc.slice(cssSrc.indexOf('@media (pointer: fine) and (min-width: 1000px)'));

  test('W22 — the desktop grid reserves a rail, a flexible slide and a bounded panel', () => {
    assert.match(desk, /grid-template-columns:\s*92px/, 'a rail column is reserved');
    assert.match(desk, /grid-template-columns:[^;]*minmax\(0, 1fr\)[^;]*minmax\(\d+px/,
      'the slide flexes and the panel is bounded');
    assert.match(desk, /\.wt-rail\s*\{[^}]*display:\s*flex/, 'the rail shows on a fine pointer');
    assert.match(desk, /\.wt-dots\s*\{\s*display:\s*none/, 'the dots step aside where the rail shows');
  });

  test('W23 — the slide is a real canvas: radius, hairline, elevation', () => {
    const media = /\.wt-media\s*\{([\s\S]*?)\n\}/.exec(desk);
    assert.ok(media, 'the slide is styled in the desktop block');
    assert.match(media[1], /border-radius/, 'the slide has a radius');
    assert.match(media[1], /border:\s*1px solid var\(--wt-edge\)/, 'the slide has a hairline stroke');
    assert.match(media[1], /box-shadow/, 'the slide carries elevation');
  });

  test('W24 — touch keeps the dots; the rail is a pointer-device affordance', () => {
    // Slice only the mobile block itself, up to the next @media.
    const start = cssSrc.indexOf('@media (max-width: 999px)');
    const mob = cssSrc.slice(start, cssSrc.indexOf('@media', start + 10));
    assert.match(mob, /\.wt-rail\s*\{\s*display:\s*none !important/);
    assert.doesNotMatch(mob, /\.wt-dots\s*\{\s*display:\s*none/,
      'the dots must remain the progress indicator on touch');
  });

  test('W25 — the backdrop is lit, not flat black', () => {
    assert.match(cssSrc, /body\.wt::before[\s\S]*?radial-gradient/, 'a light source behind the deck');
    assert.match(cssSrc, /body\.wt::after[\s\S]*?radial-gradient/, 'a vignette to seat the deck');
    // The canvas itself is a deep near-black, not the gallery's #000.
    const bg = /--wt-bg:\s*([^;]+);/.exec(cssSrc);
    assert.ok(bg, 'the deck declares its own backdrop token');
    assert.notEqual(bg[1].trim().toLowerCase(), '#000000',
      'the backdrop is lifted off pure black so the deck sits in a space');
  });

  test('W26 — surfaces resolve from tokens, not ad-hoc literals', () => {
    // Colours are declared once in :root and referenced everywhere else.
    const root = cssSrc.slice(0, cssSrc.indexOf('}', cssSrc.indexOf(':root')));
    const body = cssSrc.slice(cssSrc.indexOf('}', cssSrc.indexOf(':root')) + 1,
                               cssSrc.indexOf('Slide transitions'));
    const literal = [...body.matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
      .map(m => m[0].toLowerCase())
      // white ink on the accent button, and the toast scrim, are exact
      // by design; everything else must be a var().
      .filter(v => v !== '#ffffff');
    assert.deepEqual(literal, [],
      'raw hex outside :root — use a token: ' + JSON.stringify(literal));
    assert.ok(/--wt-r-/.test(root), 'radii are tokenised');
    assert.match(body, /border-radius:\s*var\(--wt-r-/, 'corners reference the radius tokens');
  });
});

describe('W — page assets', () => {
  // Every walkthrough page is a static shell at its own depth, so each
  // relative reference has to climb the right number of levels. When
  // they didn't, oneui.js and download-button.js 404'd on every step
  // page and the download button silently never rendered.
  const pages = fs.readdirSync(here)
    .filter(d => fs.existsSync(join(here, d, 'index.html')))
    .map(d => ({ dir: d, file: join(here, d, 'index.html') }))
    .concat([{ dir: '.', file: join(here, 'index.html') }]);

  test('W27 — every local asset a page references resolves to a real file', () => {
    const broken = [];
    for (const { dir, file } of pages) {
      const html = fs.readFileSync(file, 'utf8');
      const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1])
        .filter(u => !/^(https?:)?\/\//.test(u) && !u.startsWith('data:') && !u.startsWith('#'));
      for (const ref of refs) {
        // Resolve the reference against the page's own directory, the
        // way a browser would.
        const target = path.resolve(path.dirname(file), ref);
        if (!fs.existsSync(target)) broken.push(dir + ' → ' + ref);
      }
    }
    assert.deepEqual(broken, [], 'unresolved local references:\n  ' + broken.join('\n  '));
  });

  test('W28 — every step page loads the motion tokens and the download button', () => {
    for (const { dir } of pages) {
      if (dir === '.') continue; // the landing has no photo, so no download
      const html = fs.readFileSync(join(here, dir, 'index.html'), 'utf8');
      assert.match(html, /src="\.\.\/\.\.\/oneui\.js"/, dir + ' must load oneui.js from the repo root');
      assert.match(html, /src="\.\.\/\.\.\/download-button\.js"/, dir + ' must load the download button');
    }
  });

  test('W29 — the deck is 16:9', () => {
    const deskBlock = cssSrc.slice(cssSrc.indexOf('@media (pointer: fine) and (min-width: 1000px)'));
    assert.match(deskBlock, /aspect-ratio:\s*16\s*\/\s*9/, 'the slide keeps a slide ratio');
  });

  test('W29b — the landing copy is a grid cell, not a full-height overlay', () => {
    // Regression: the landing panel used to carry min-height:100dvh from
    // the shared rule. As the poster's absolutely-positioned copy block
    // that anchored it ABOVE the top of the frame — a 900px-tall slab
    // sitting on -34, covering the hero photo.
    const base = /\.wt-page-landing \.wt-panel\s*\{([\s\S]*?)\n\}/.exec(cssSrc);
    assert.ok(base, 'the shared landing panel rule exists');
    assert.ok(!/min-height/.test(base[1]),
      'the shared panel rule sets no min-height — the poster sizes it by content');
    const deskPanel = /\.wt-page-landing \.wt-panel\s*\{([\s\S]*?)\n  \}/.exec(
      cssSrc.slice(cssSrc.indexOf('@media (pointer: fine) and (min-width: 1000px)'))
    );
    assert.ok(deskPanel && /position:\s*absolute/.test(deskPanel[1]),
      'on desktop the copy block is placed on the collage');
  });

  test('W30 — every step carries an accent hue, and the deck applies it', () => {
    for (const s of authored) {
      assert.ok(Number.isInteger(s.accent) && s.accent >= 0 && s.accent < 360,
        s.slug + ' has an accent hue in range');
    }
    // The runtime writes the hue onto the page as --wt-h...
    assert.match(runtimeSrc, /setProperty\('--wt-h',\s*String\(step\.accent\)\)/,
      'the step page sets --wt-h from its accent');
    // ...and the wash, eyebrow and tile all derive their colour from it,
    // so a step's colour is one value rather than three hard-coded ones.
    assert.match(cssSrc, /--wt-wash:\s*hsl\(var\(--wt-h\)/, 'the wash reads the hue');
    assert.match(cssSrc, /--wt-tint:\s*hsl\(var\(--wt-h\)/, 'the tint reads the hue');
    const eyebrow = /\.wt-counter\s*\{([\s\S]*?)\n\}/.exec(cssSrc);
    assert.ok(eyebrow && /var\(--wt-tint\)/.test(eyebrow[1]),
      'the eyebrow takes the step hue');
    // The call to action must NOT: the walkthrough stays One UI blue.
    const cta = /\.wt-cta\s*\{([\s\S]*?)\n\}/.exec(cssSrc);
    assert.ok(cta && !/var\(--wt-h\)|var\(--wt-tint\)/.test(cta[1]),
      'the primary action keeps the site accent, not the step hue');
  });

  test('W31 — the landing leads with the photography, and it links', () => {
    assert.match(runtimeSrc, /function buildMontage/, 'the montage is built');
    assert.match(runtimeSrc, /a\.href\s*=\s*stepUrl\(step\)/,
      'each tile is a link into its own step');
    assert.match(runtimeSrc, /wrap\.className\s*=\s*'wt-montage'/);
    assert.match(runtimeSrc, /buildMontage\(\);\s*\n?\s*addAction\('Begin the walkthrough'/,
      'the collage is built before the call to action');
    // One tile per step, and every cover resolves to a real file.
    assert.equal(authored.length, 7);
    const repo = join(here, '..');
    for (const s of authored) {
      assert.ok(fs.existsSync(join(repo, s.hero)), s.slug + ' hero exists on disk');
    }
  });

  test('W29c — the collage leaves the copy cell empty', () => {
    // The poster is 4×3. The hero takes a 2×2 block and tiles 6 and 7
    // are pinned to the right of the last row, so the two lower-left
    // cells stay empty for the title. Without the pinning, auto-placement
    // fills those cells and the copy ends up on top of two photographs.
    assert.match(cssSrc, /\.wt-tile:nth-child\(6\)\s*\{\s*grid-column:\s*3;\s*grid-row:\s*3;/,
      'tile 6 is pinned right of the last row');
    assert.match(cssSrc, /\.wt-tile:nth-child\(7\)\s*\{\s*grid-column:\s*4;\s*grid-row:\s*3;/,
      'tile 7 is pinned right of the last row');
    // And the phone resets the pinning, since it has no copy cell.
    const phone = cssSrc.slice(cssSrc.indexOf('@media (max-width: 999px)'));
    assert.match(phone, /\.wt-tile:nth-child\(6\),\s*\.wt-tile:nth-child\(7\)\s*\{\s*grid-column:\s*auto/,
      'the phone unpins tiles 6 and 7');
  });
});

describe('W — the CSS contract', () => {
  const block = cssSrc.slice(cssSrc.indexOf('Slide transitions'));
  // Comments are prose — they say "no blur, glow, gradient"; only the
  // declarations themselves are audited.
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, '');

  test('W14 — wt-t-arrive consumes the custom properties (the shipped bug)', () => {
    // The start state only exists if the arrive carrier actually reads
    // the --wt-t-* values. Leaving it out is what killed the arrivals.
    const shared = /\.wt-page\.wt-t-arrive,\s*\.wt-page\.wt-t-go,\s*\.wt-page\.wt-t-leave\s*\{([^}]*)\}/.exec(cssSrc);
    assert.ok(shared, 'a shared carrier rule consumes the variables');
    for (const prop of ['var(--wt-t-x)', 'var(--wt-t-s)', 'var(--wt-t-c)', 'var(--wt-t-o)']) {
      assert.ok(shared[1].includes(prop), 'the carrier rule must apply ' + prop);
    }
  });

  test('W15 — the settled slide is the CSS default', () => {
    const pageRule = /\.wt-page\s*\{([^}]*)\}/.exec(cssSrc)[1];
    for (const v of ['--wt-t-x: 0px', '--wt-t-y: 0px', '--wt-t-s: 1', '--wt-t-c: inset(0)', '--wt-t-o: 1']) {
      assert.ok(pageRule.includes(v), '.wt-page must default ' + v);
    }
  });

  test('W16 — every vocabulary kind has both an arrival and a departure state', () => {
    const runtime = fs.readFileSync(join(here, 'walkthrough.js'), 'utf8');
    const kinds = [.../\[[\s\S]*?\];/.exec(runtime.match(/var TRANSITIONS = \[[\s\S]*?\];/)[0])[0].matchAll(/'([a-z-]+)'/g)].map(m => m[1]);
    assert.ok(kinds.length >= 8, 'expected the full vocabulary, got ' + kinds.length);
    for (const k of kinds) {
      assert.ok(cssSrc.includes('.wt-t-' + k + '-in'), k + ' has no arrival state');
      assert.ok(cssSrc.includes('.wt-t-' + k + '-out'), k + ' has no departure state');
    }
  });

  test('W17 — arrivals and departures are continuous (inverses of each other)', () => {
    // The declarations are written as `.wt-t-wipe-down-in  { … }` with
    // padding before the brace, so match on the selector alone.
    const state = (kind, phase) => {
      const m = new RegExp('\\.wt-t-' + kind + '-' + phase + '\\s*\\{([^}]*)\\}').exec(cssSrc);
      return m ? m[1] : '';
    };
    const dir = (body) => {
      // The direction a slide TRAVELS, not the edge that happens to be
      // clipped first. Clipping the top edge hides the slide's top
      // progressively, so it travels up; the bottom, down.
      const c = /--wt-t-c:\s*inset\(([^)]*)\)/.exec(body);
      if (c) {
        const [top, right, bottom, left] = c[1].trim().split(/\s+/).map(parseFloat);
        if (top > 0 && !bottom && !left && !right) return 'up';
        if (bottom > 0 && !top && !left && !right) return 'down';
        if (left > 0 && !top && !bottom && !right) return 'left';
        if (right > 0 && !top && !bottom && !left) return 'right';
        return 'mixed';
      }
      // A positive offset means the slide STARTS to the right (or
      // below) and therefore travels left (or up) as it settles.
      const x = /--wt-t-x:\s*(-?\d+)%/.exec(body);
      if (x) return parseInt(x[1], 10) > 0 ? 'left' : 'right';
      const y = /--wt-t-y:\s*(-?\d+)%/.exec(body);
      if (y) return parseInt(y[1], 10) > 0 ? 'up' : 'down';
      return 'none';
    };
    // A wipe is ONE clip edge on both halves, so the slide travels
    // the same way in and out (that is what makes it read as a wipe).
    for (const k of ['wipe-up', 'wipe-down']) {
      assert.equal(dir(state(k, 'in')), dir(state(k, 'out')),
        k + ' must clip the same edge on both halves');
    }
    // A push is a two-sided gesture: the old slide leaves one way while
    // the new one arrives from the opposite, exactly as a deck does it.
    // What must hold is that the halves are OPPOSITE, never parallel.
    for (const k of ['push-left', 'push-right', 'push-up']) {
      const a = dir(state(k, 'in'));
      const b = dir(state(k, 'out'));
      assert.notEqual(a, 'none', k + ' arrival must actually move');
      assert.notEqual(b, 'none', k + ' departure must actually move');
      const opposite = (p, q) => (p === 'left' && q === 'right') || (p === 'right' && q === 'left') ||
                                 (p === 'up' && q === 'down') || (p === 'down' && q === 'up');
      assert.ok(opposite(a, b),
        k + ' arrives and departs on opposite sides (' + a + ' vs ' + b + ')');
    }
  });

  test('W18 — no hardcoded durations; only the three tokens', () => {
    const ms = [...block.matchAll(/(\d+)ms/g)].map(m => m[1]);
    const allowed = new Set(['100', '300', '500']); // --wt-short/base/long
    for (const v of ms) assert.ok(allowed.has(v), 'hardcoded duration ' + v + 'ms in the transition block');
  });

  test('W19 — the slide transition moves only transform, opacity and clip-path', () => {
    // The deck has deliberate elevation and a lit backdrop (that is the
    // PowerPoint-inspired part); what must not happen is the SLIDE
    // smearing its own shadow while it travels. So the audit is scoped
    // to the carrier rules only, not the whole stylesheet.
    const carriers = /\.wt-page\.wt-t-arrive,\s*[\s\S]*?\n\}/.exec(rules);
    assert.ok(carriers, 'the shared carrier rule exists');
    for (const prop of ['transform', 'clip-path', 'opacity']) {
      assert.ok(carriers[0].includes(prop), 'the carrier applies ' + prop);
    }
    // Reduced motion's own `animation: none` for the ambient drift is
    // outside this rule; the slide itself must ride `transition`.
    assert.ok(!/\banimation:(?! none)/.test(rules),
      'transitions ride the transition property, not keyframes');
  });

  test('W21 — elevation is layered and directional, never a heavy drop shadow', () => {
    // Fluent's system: a sharp key shadow that defines the edge plus a
    // soft ambient shadow that implies distance, light from above.
    // The SLIDE must be layered (it is the deck's hero surface); the
    // smaller controls take a single key shadow, which is correct.
    const lifts = [...cssSrc.matchAll(/--wt-lift-([a-z]+):\s*([^;]+);/g)];
    assert.ok(lifts.length >= 2, 'at least a slide and a control elevation');
    const byName = Object.fromEntries(lifts.map(m => [m[1], m[2]]));
    const slide = byName.slide;
    assert.ok(slide, 'the slide has its own elevation token');
    assert.equal((slide.match(/rgba\(/g) || []).length, 2,
      'the slide layers a key and an ambient shadow: ' + slide);
    for (const l of lifts.map(m => m[2])) {
      // Each layer is "offsetX offsetY blur rgba(...)" — parse it as a
      // function, not by splitting on commas (the offset contains one).
      const layers = l.match(/[^,]+rgba\([^)]*\)/g) || [];
      assert.ok(layers.length >= 1, 'a shadow token declares at least one layer: ' + l);
      for (const layer of layers) {
        const m = /^(\S+)\s+(\S+)\s+(?:(\S+)\s+)?rgba\(/.exec(layer.trim());
        assert.ok(m, 'a shadow layer parses: ' + layer);
        assert.equal(m[1], '0', 'the light source is directly above: ' + layer);
        assert.ok(parseFloat(m[2]) >= 0, 'no upward offset: ' + layer);
      }
    }
  });

  test('W20 — one easing, and reduced motion switches the lot off', () => {
    const easings = [...block.matchAll(/cubic-bezier\([^)]*\)/g)].map(m => m[0]);
    assert.deepEqual(easings, [], 'the block must inherit --wt-ease, not name a curve');
    assert.ok(/--wt-ease/.test(block), 'durations ride the one easing');
    const reduce = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\}/.exec(block)[1];
    assert.ok(/\.wt-page/.test(reduce), 'reduced motion must switch the slide off');
    assert.ok(/transition: none !important/.test(reduce));
  });
});