import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* ────────────────────────────────────────────────────────────────────
   Folder → journey stage (app.js: FOLDER_STAGES).

   A folder with no entry here is not broken, but it can never be
   classified: uploads into it write no metadata and its photos stay on
   "Needs review" forever. That is how 233 of 335 photos ended up unable
   to save a classification.

   app.js is a browser script that boots the whole gallery, so these
   rules are lifted out of the source and run in a vm — the same
   approach walkthroughGate.test.mjs uses. If a function is renamed the
   slice comes back empty and every test below fails loudly.
   ──────────────────────────────────────────────────────────────────── */

const here = dirname(fileURLToPath(import.meta.url));
const appSrc = fs.readFileSync(join(here, '..', 'app.js'), 'utf8');

const slice = (re) => {
  const m = re.exec(appSrc);
  assert.ok(m, `app.js matches ${re}`);
  return m[0];
};

function loadModel(order) {
  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    state: { order },
  };
  vm.createContext(sandbox);
  vm.runInContext([
    slice(/const JOURNEY = \[[\s\S]*?\n\];/),
    slice(/const JOURNEY_BY_SEQUENCE = new Map\([^\n]*\n/),
    slice(/const FOLDER_STAGES = \{[\s\S]*?\n\};/),
    slice(/function journeyFor\(folder\) \{[\s\S]*?\n\}/),
    slice(/function folderSequence\(folder\) \{[\s\S]*?\n\}/),
    slice(/function albumStageName\(folder\) \{[\s\S]*?\n\}/),
    // `const` in a vm stays a lexical global and never becomes a property
    // of the sandbox, so the tests could not read these. Function
    // declarations do, which is why the gate test only reaches for one.
    'globalThis.FOLDER_STAGES = FOLDER_STAGES; globalThis.JOURNEY = JOURNEY;',
  ].join('\n'), sandbox);
  return sandbox;
}

// The albums that actually exist in the repo, in the order the Albums
// tab shows them.
const REPO_ALBUMS = [
  'site-survey', 'site-survey-map', 'materials-and-equipments', 'cable-pull',
  'trunking-installation', 'rack-build', 'server-rack-build', 'phase-1',
  'labelling-and-identification', 'termination-testing', 'General',
];

describe('H — folder → journey stage', () => {
  test('H1 — every mapped folder points at a stage that exists', () => {
    const m = loadModel(REPO_ALBUMS);
    for (const f of Object.keys(m.FOLDER_STAGES)) {
      const j = m.journeyFor(f);
      assert.ok(j, `${f} maps to a real journey stage`);
    }
  });

  test('H2 — no two albums are shown the same name', () => {
    // Three folders shared "Rack / Cabinet Installation" and two shared
    // "Site Survey & Planning" once every album was mapped. Two
    // identically-titled albums in one grid is worse than a folder name.
    const m = loadModel(REPO_ALBUMS);
    const seen = new Map();
    for (const f of REPO_ALBUMS) {
      const label = m.albumStageName(f);
      assert.ok(!seen.has(label),
        `"${label}" is shown by both ${seen.get(label)} and ${f}`);
      seen.set(label, f);
    }
  });

  test('H3 — a stage nothing else shares is still shown', () => {
    // The collision guard must not flatten every label to a folder name —
    // that would undo the point of mapping them.
    const m = loadModel(REPO_ALBUMS);
    assert.equal(m.albumStageName('trunking-installation'), 'Cable Routing & Management');
    assert.equal(m.albumStageName('materials-and-equipments'), 'Materials & Equipment');
  });

  test('H4 — a shared stage falls back to the folder name, not the stage', () => {
    const m = loadModel(REPO_ALBUMS);
    assert.equal(m.albumStageName('server-rack-build'), 'server-rack-build');
    assert.equal(m.albumStageName('rack-build'), 'rack-build');
    assert.equal(m.albumStageName('site-survey-map'), 'site-survey-map');
  });

  test('H5 — a new album on an occupied stage cannot reintroduce a clash', () => {
    // The guard reads the live album list, so this is the case that
    // matters for future uploads and new folders: adding one more album
    // to Rack / Cabinet Installation must not produce a duplicate title.
    const m = loadModel([...REPO_ALBUMS, 'some-new-rack-folder']);
    const labels = [...REPO_ALBUMS, 'some-new-rack-folder'].map(f => m.albumStageName(f));
    assert.equal(new Set(labels).size, labels.length, `duplicate label in ${labels}`);
  });

  test('H6 — classification is unaffected by the display fallback', () => {
    // albumStageName is presentation only. journeyFor still returns the
    // shared stage, which is what classifyPhoto reads — so a photo in
    // server-rack-build is still classified as rack installation even
    // though its album is titled with the folder name.
    const m = loadModel(REPO_ALBUMS);
    assert.equal(m.journeyFor('server-rack-build').stage, 'Rack / Cabinet Installation');
    assert.equal(m.journeyFor('rack-build').stage, 'Rack / Cabinet Installation');
  });

  test('H7 — an unmapped album sorts last and keeps its own name', () => {
    // "General" is a catch-all and is deliberately unmapped: forcing a
    // stage would invent a classification for whatever lands in it.
    const m = loadModel(REPO_ALBUMS);
    assert.equal(m.albumStageName('General'), 'General');
    assert.equal(m.journeyFor('General'), null);
    assert.equal(m.folderSequence('General'), Number.MAX_SAFE_INTEGER);
  });

  test('H8 — albums sort into build order once mapped', () => {
    const m = loadModel(REPO_ALBUMS);
    const sorted = [...REPO_ALBUMS].sort((a, b) => {
      const d = m.folderSequence(a) - m.folderSequence(b);
      return d || a.localeCompare(b, 'en', { numeric: true });
    });
    assert.equal(sorted[0], 'site-survey', 'Site Survey is the first stage');
    assert.equal(sorted[sorted.length - 1], 'General', 'the catch-all sorts last');
    assert.ok(sorted.indexOf('trunking-installation') < sorted.indexOf('rack-build'),
      'cable routing precedes rack installation');
  });
});
