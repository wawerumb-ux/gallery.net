/* walkthrough/shader-integrity.test.mjs — guards the ported ThreeUI source.

   The GenerativeTree component, its canonical HTML source and the shared
   threeui.css are vendored byte-for-byte from ThreeUI revision 7a6871fe99fa.
   They are never hand-edited: every prop the walkthrough passes (size,
   particleAmount, speed, hue…) works by the component doing string
   .replace() against that HTML, so a reformat, a prettier pass or a
   renamed anchor in the source would silently disable the tree with every
   test still green.

   This suite fails if any of the three files drifts by a single byte, and
   also pins the host boundary around them. Run with plain `node --test`. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path, { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const shaders = join(repo, 'src', 'shaders');

const PINNED = [
  ['elements/GenerativeTree.tsx', 6354, 'bb6bf95154f38e7a9772eef6fe2aa89ff72284a13345d56e66fba234894c2127'],
  ['elements/sources/generative-tree.html', 20247, '8ea51733bddf5cc44df338ef9af3a21633d62daa92c17fde5faa2fcab90fa0ef'],
  ['threeui.css', 40715, 'efe4447139f1358dd8e9be68edf6fa46cbefbd1de423a4d6c439ca61d2c8eccf'],
];

const read = (rel) => fs.readFileSync(join(shaders, rel), 'utf8');
const sha = (rel) => crypto.createHash('sha256').update(fs.readFileSync(join(shaders, rel))).digest('hex');

describe('S — the ported ThreeUI source is byte-identical', () => {
  for (const [rel, bytes, hash] of PINNED) {
    test(`S — ${rel} matches SHA-256 7a6871fe99fa`, () => {
      const abs = join(shaders, rel);
      assert.ok(fs.existsSync(abs), `${rel} is missing`);
      const buf = fs.readFileSync(abs);
      assert.equal(buf.length, bytes, `${rel} is ${buf.length} bytes, expected ${bytes}`);
      assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), hash,
        `${rel} has been modified — the authored source must never be edited`);
    });
  }

  test('S — the component never imports the @designcodeio runtime package', () => {
    // The point of vendoring is to build from the local copy.
    const src = read('elements/GenerativeTree.tsx');
    assert.ok(!/@designcodeio/.test(src), 'the component must not import the runtime package');
    const pkg = join(repo, 'package.json');
    if (fs.existsSync(pkg)) {
      const json = JSON.parse(fs.readFileSync(pkg, 'utf8'));
      const deps = { ...(json.dependencies || {}), ...(json.devDependencies || {}) };
      assert.ok(!Object.keys(deps).some((d) => d.includes('designcodeio')),
        'the runtime package must not be a dependency');
    }
  });
});

describe('S — the prop pipeline actually applies', () => {
  test('S — every .replace() anchor exists verbatim in the canonical source', () => {
    // These are the strings buildFocusedDocument patches into the HTML. If one
    // drifts, size / particleAmount / speed stop taking effect in silence.
    const html = read('elements/sources/generative-tree.html');
    const anchors = [
      'const PARTICLE_COUNT = 50;',
      "const _pad = parseFloat(new URLSearchParams(location.search).get('p')) || 1;",
      '  createTree();\n  requestAnimationFrame(frame);',
      'b.growthProgress = Math.min(1, b.growthProgress + b.growthSpeed);',
      'function frame(time) {\n    // Decay shake',
      'holdTimer++;',
      'fadeTimer++;',
      'waitTimer++;',
      '</head>',
    ];
    for (const a of anchors) {
      assert.ok(html.includes(a),
        `anchor missing from the canonical source, so its patch would silently no-op: ${JSON.stringify(a)}`);
    }
  });

  test('S — the host passes the specified props, unaltered', () => {
    const scene = fs.readFileSync(join(repo, 'src', 'Scene.tsx'), 'utf8');
    const specified = {
      speed: '2.41', size: '1.12', particleAmount: '2.00', hue: '108',
      saturation: '2.00', brightness: '1.39', opacity: '0.79',
    };
    for (const [prop, value] of Object.entries(specified)) {
      assert.ok(new RegExp(`${prop}=\\{${value.replace('.', '\\.')}\\}`).test(scene),
        `Scene.tsx must pass ${prop}={${value}} exactly — not rounded or retuned`);
    }
    // The import specifiers are the authored ones.
    assert.match(scene, /from "\.\/shaders\/elements\/GenerativeTree"/);
    assert.match(scene, /import "\.\/shaders\/threeui\.css"/);
  });
});

describe('S — the host boundary gives the tree a real box', () => {
  test('S — shader-frame is sized by the host, since the authored css omits it', () => {
    // Regression: the authored threeui.css defines .threeui-background as
    // width/height 100% but never .shader-frame, the wrapper TARGET
    // CONFIGURATION specifies. With no sized parent the whole chain measured
    // 1440x0 and the tree drew into nothing.
    assert.ok(!/\.shader-frame\s*[{,]/.test(read('threeui.css')),
      'the authored css is not expected to define .shader-frame');
    const host = read('host-boundary.css');
    assert.match(host, /\.shader-frame\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/s,
      'the host must give .shader-frame a box');
    assert.match(host, /\.shader-frame[^}]*pointer-events:\s*none/s,
      'a decorative background must not swallow clicks meant for the collage');
  });

  test('S — the tree is confined to the poster copy cell, not full-bleed', () => {
    // A full-bleed canvas left the tree visible only in 26px of gutter while
    // its trunk still crossed the call to action and put a hard black bar on a
    // collage tile. The host pins it to the grid's empty cell instead.
    //
    // There are several #wt-shader-root blocks (the base position, the cell
    // override, and the phone media query), so this checks the CASCADE: the
    // last unconditional block must be the one that constrains it.
    const host = read('host-boundary.css');
    const blocks = [...host.matchAll(/#wt-shader-root\s*\{([^}]*)\}/g)]
      .map((m) => m[1])
      .filter((body) => !/display:\s*none/.test(body));
    assert.ok(blocks.length >= 2, 'expected a base rule and a constraining override');
    const last = blocks[blocks.length - 1];
    assert.match(last, /right:\s*auto/,
      'the tree must not span the full viewport width');
    assert.match(last, /width:\s*calc\(/,
      'the tree is sized to the copy cell, not the page');
    assert.match(last, /height:\s*calc\(/,
      'the tree is sized to one grid row, not the page');
  });

  test('S — the landing links the build, and no step page does', () => {
    const landing = fs.readFileSync(join(repo, 'walkthrough', 'index.html'), 'utf8');
    assert.match(landing, /shader-build\/assets\/shader\.js/,
      'the landing mounts the tree');
    assert.match(landing, /shader-build\/assets\/shader\.css/,
      'the landing links the built stylesheet — Vite emits it but does not inject it in a prod build');
    assert.match(landing, /id="wt-shader-root"/, 'the landing has the mount point');
    // The seven step pages stay static, untouched and tree-free.
    const pages = fs.readdirSync(join(repo, 'walkthrough'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(repo, 'walkthrough', d.name, 'index.html'))
      .filter((p) => fs.existsSync(p));
    assert.equal(pages.length, 7, 'all seven step pages exist');
    for (const page of pages) {
      const html = fs.readFileSync(page, 'utf8');
      assert.ok(!/shader/.test(html),
        `${path.relative(repo, page)} must stay a static page with no shader reference`);
      assert.ok(!/type="module"/.test(html),
        `${path.relative(repo, page)} must stay a classic script page`);
    }
  });

  test('S — the tree is hidden where it would cost more than it gives', () => {
    // A full-bleed rAF canvas behind a dense phone collage is pure cost, and
    // reduced motion must not run it either.
    const host = read('host-boundary.css');
    assert.match(host, /@media[^{]*max-width:\s*999px[^{]*\{[^@]*?#wt-shader-root\s*\{\s*display:\s*none/s,
      'the tree is off on phones');
    assert.match(host, /prefers-reduced-motion:\s*reduce/,
      'the tree is off under reduced motion');
  });
});
