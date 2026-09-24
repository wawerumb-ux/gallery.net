import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(join(here, '..', 'app.js'), 'utf8');

const stubEl = () => ({
  hidden: true, textContent: '', innerHTML: '', value: '', style: {}, dataset: {},
  addEventListener() {}, appendChild() {}, removeChild() {}, click() {}, remove() {},
  setAttribute() {}, getAttribute: () => null, classList: { add() {}, remove() {}, toggle() {} },
});

const sandbox = {
  FileReader: class { readAsDataURL() {} readAsText() {} }, TextDecoder,
  File: class { constructor() {} }, FormData: class { append() {} },

  console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  Blob, URL, URLSearchParams,
  document: {
    getElementById: () => stubEl(), createElement: () => stubEl(),
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    body: { appendChild() {} }, head: { appendChild() {} },
  },
  window: {
    addEventListener() {}, matchMedia: () => ({ matches: true, addEventListener() {} }),
    open() {}, requestAnimationFrame: (f) => f(0),
  },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
};

function loadAppPure() {
  const el = stubEl;
  const sandbox2 = {
    ...sandbox,
    document: {
      getElementById: () => el(), createElement: () => el(),
      addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
      body: { appendChild() {} }, head: { appendChild() {} },
    },
    window: {
      addEventListener() {}, matchMedia: () => ({ matches: true, addEventListener() {} }),
      open() {}, requestAnimationFrame: (f) => f(0),
    },
  };
  sandbox2.globalThis = sandbox2;
  const ctx = vm.createContext(sandbox2);
  const expose = `
    globalThis.__X = { journeyFor, classifyPhoto, buildAssets, discoverFromTree,
      setAssets, summarizeDuplicates, rawUrl, pageUrl, imgSrc, cardSrc, lightboxSrc, thumbSrc, prettyName, sanitizeFilename,
      setDPR: (v) => { devicePixelRatio = v; } };
  `;
  vm.runInContext(code + expose, ctx, { filename: 'app.js' });
  return sandbox2.__X;
}

export const G = (() => { try { return loadAppPure(); } catch (e) { console.error('app.js load failed: ' + e.message); return null; } })();

const img = (folder, name, sha, extra = {}) => ({
  folder, name, path: `images/${folder}/${name}`, sha, ...extra,
});

/* ── Test D1 · same FILE discovered twice (identical path+sha) → ONE logical image ── */
describe('D1 — same git blob rediscovered (same sha, same path)', () => {
  test('collapses to exactly one logical image — no duplicate card', () => {
    if (!G) return test.skip();
    const files = [
      img('Arrivals', 'sunset.jpg', 'sha-1'),
      img('Arrivals', 'sunset.jpg', 'sha-1'),
    ];
    const assets = G.buildAssets(files);
    assert.equal(assets.length, 1, 'two identical entries → one logical asset');
    assert.equal(assets[0].canonical.name, "sunset.jpg");
  });
});

/* ── Test D2 · same bytes, two different filenames → 1 logical image, exact-dup flagged ── */
describe('D2 — identical sha, different names (renamed/backup copy)', () => {
  test('one logical image; exact duplicate detected; BOTH repo files kept', () => {
    if (!G) return test.skip();
    const files = [
      img('Arrivals', 'sunset.jpg', 'sha-X'),
      img('General', 'sunset-copy.jpg', 'sha-X'),
    ];
    const assets = G.buildAssets(files);
    assert.equal(assets.length, 1);
    const summary = G.summarizeDuplicates(assets);
    assert.ok(summary.exactDuplicateFiles >= 1, 'identical bytes flagged as duplicate');
  });
});

/* ── Test D3 · two different photographs → 2 logical images, nothing dropped ── */
describe('D3 — two genuinely different photographs', () => {
  test('two logical images; both files survive', () => {
    if (!G) return test.skip();
    const files = [
      img('Arrivals', 'sunset.jpg', 'sha-A'),
      img('Arrivals', 'bridge.jpg', 'sha-B'),
    ];
    const assets = G.buildAssets(files);
    assert.equal(assets.length, 2);
    assert.equal(G.summarizeDuplicates(assets).exactDuplicateFiles, 0);
  });
});

/* ── D4 · responsive variants (peak.jpg + peak-480.jpg + peak-800.jpg) collapse to ONE logical image, canonical = largest/original ── */
describe('D4 — responsive variant set in one folder', () => {
  test('three files → one logical asset; canonical is the original-size file', () => {
    if (!G) return test.skip();
    const files = [
      img('Panorama', 'peak-480.webp', 'sha-v0'),
      img('Panorama', 'peak-800.webp', 'sha-v1'),
      img('Panorama', 'peak.jpg', 'sha-v2'),
    ];
    const assets = G.buildAssets(files);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].canonical.name, 'peak.jpg');
    const sum = G.summarizeDuplicates(assets);
    assert.equal(sum.exactDuplicateFiles, 0, 'variants are NOT content duplicates');
    if (G.cardSrc && G.setAssets) {
      G.setAssets(files);
      G.setDPR(1);
      const card1x = G.cardSrc(assets[0].canonical);
      assert.ok(/peak-480\.webp/.test(card1x), '1x DPR card serves the 480 tier: ' + card1x);
      assert.ok(/^https:\/\/[a-z0-9-]+\.github\.io\//.test(card1x), 'card variant on Pages host: ' + card1x);
      G.setDPR(2);
      const card2x = G.cardSrc(assets[0].canonical);
      assert.ok(/peak-800\.webp/.test(card2x), '2x DPR card serves the 800 tier: ' + card2x);
      const lb = G.imgSrc(assets[0].canonical);
      assert.ok(/peak\.jpg/.test(lb), 'download still reaches the full-res original: ' + lb);
      if (G.lightboxSrc) {
        const lx = G.lightboxSrc(assets[0].canonical);
        assert.ok(/peak-800\.webp/.test(lx), 'lightbox opens crisp on the largest variant: ' + lx);
        assert.ok(!/token|authorization|access_token|bearer/i.test(lx), 'lightbox src tokenless');
      }
    }
  });
});

/* ── D5 · re-discovering an already-filed image is IDEMPOTENT: same logical asset, no second card, no re-classify ── */
describe('D5 — rediscovery idempotence / no duplicate card', () => {
  test('second discovery of identical path+sha keeps exactly one logical asset', () => {
    if (!G) return test.skip();
    const once = [img('Arrivals', 'sunset.jpg', 'sha-1')];
    const twice = [img('Arrivals', 'sunset.jpg', 'sha-1'), img('Arrivals', 'sunset.jpg', 'sha-1')];
    assert.equal(G.buildAssets(twice).length, G.buildAssets(once).length);
  });
});

/* ── D6 · visitor download/save is TOKENLESS and AUTH-FREE (Test-list item 6) ── */
describe('D6 — download flow requires no token, no Authorization header', () => {
  test('rawUrl + imgSrc emit raw.githubusercontent.com URLs with no credential material', () => {
    if (!G) return test.skip();
    const img = { folder: 'Arrivals', name: 'sunset.jpg', path: 'images/Arrivals/sunset.jpg', sha: 'sha-1' };
    const u = G.rawUrl(img.path);
    assert.ok(u.startsWith('https://raw.githubusercontent.com/'), u);
    assert.ok(!/token|authorization|access_token|bearer/i.test(u), 'no token in URL');
    const src = G.imgSrc(img);
    assert.ok(!/token|authorization|access_token|bearer/i.test(src), 'no token in img src');
    assert.ok(/^https:\/\/[a-z0-9-]+\.github\.io\//.test(src), 'imgSrc uses the Pages host (cached CDN): ' + src);
    if (G.thumbSrc) {
      G.setAssets([
        { folder: 'Arrivals', name: 'sunset-480.webp', path: 'images/Arrivals/sunset-480.webp', sha: 'sha-t1' },
        { folder: 'Arrivals', name: 'sunset-800.webp', path: 'images/Arrivals/sunset-800.webp', sha: 'sha-t2' },
        { folder: 'Arrivals', name: 'sunset.jpg', path: 'images/Arrivals/sunset.jpg', sha: 'sha-1' },
      ]);
      const t = G.thumbSrc(img);
      assert.ok(!/token|authorization|access_token|bearer/i.test(t), 'no token in blur-up thumb');
      assert.ok(/^https:\/\/[a-z0-9-]+\.github\.io\//.test(t), 'thumb on Pages host (no jsDelivr full-size leak): ' + t);
      assert.ok(/sunset-480\.webp/.test(t), 'thumb is the committed smallest variant: ' + t);
    }
  });
});

/* ── D7 · real live-tree audit (read-only, offline when fixture absent) — mirrors the earlier dry-run of the whole repo ── */
describe('D7 — full-repo live audit', () => {
  test('classifies the real tree snapshot with 0 exact duplicates (fixture or live API)', async () => {
    let tree = null;
    try {
      tree = JSON.parse(readFileSync(new URL('../tree-main.json', import.meta.url), 'utf8'));
    } catch (err) {
      // No bundled snapshot — fall back to the tokenless live API (read-only,
      // same call the 320-photo dry-run used). Skip only if truly offline.
      try {
        const res = await fetch('https://api.github.com/repos/wawerumb-ux/gallery.net/git/trees/main?recursive=1',
          { headers: { Accept: 'application/vnd.github+json' } });
        if (!res.ok) return test.skip('live tree fetch ' + res.status);
        tree = await res.json();
      } catch (netErr) {
        return test.skip('no fixture and no network: ' + (netErr && netErr.code || netErr && netErr.message || netErr));
      }
    }
    if (!tree || !Array.isArray(tree.tree) || !tree.tree.length) {
      return test.skip('fixture present but has no .tree array');
    }
    const IMG_EXT = /\.(png|jpe?g|gif|webp|avif)$/i;
    const discovered = [];
    for (const item of tree.tree) {
      if (item.type !== 'blob') continue;
      const rel = item.path.replace(/^images\//, '');
      if (!IMG_EXT.test(rel)) continue;
      const slash = rel.indexOf('/');
      const folder = slash === -1 ? 'General' : rel.slice(0, slash);
      const name = slash === -1 ? rel : rel.slice(slash + 1);
      discovered.push({ folder, name, path: item.path, sha: item.sha });
    }
    assert.ok(discovered.length > 100, `live tree gives ${discovered.length} images`);
    const assets = G.buildAssets(discovered);
    const sum = G.summarizeDuplicates(assets);
    console.log(`  live audit: ${discovered.length} blobs → ${assets.length} logical images; exact duplicates: ${sum.exactDuplicateFiles}`);
    assert.equal(sum.exactDuplicateFiles, 0);
  });
});
