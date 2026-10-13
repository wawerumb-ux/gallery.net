/* Creating an album from the classify dialog.

   The feature looks like one dropdown entry. It is actually four things that
   have to agree, and three of them fail silently if they do not:

     1. the name the visitor typed must not quietly become a second album
        next to an existing one
     2. the folder has to come into existence at all — git stores no empty
        directories, so "create" means put-then-delete
     3. the photo's classification has to be re-keyed onto the new path, or
        the photo moves into its album and falls straight back to "Needs
        review", which is the state the whole dialog exists to end
     4. a failure must be reported rather than reported as a save

   These run the real functions against the real app.js in a vm. */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

/* Take a named top-level function out of the real source, whole. */
const fn = (name) => {
  const at = app.search(new RegExp(`^(?:async )?function ${name}\\b`, 'm'));
  assert.notStrictEqual(at, -1, `no function ${name} in app.js`);
  let d = 0;
  for (let k = app.indexOf('{', at); k < app.length; k++) {
    if (app[k] === '{') d++;
    else if (app[k] === '}') { d--; if (!d) return app.slice(at, k + 1); }
  }
  throw new Error(`unterminated ${name}`);
};

/* Calls recorded in order, so the write sequence itself can be asserted:
   a delete must never precede its put, or the photo is lost. */
function harness({ folders, order, taggingPath, assets = [], token = 'tok', failPut = false }) {
  const calls = [];
  const state = {
    folders, order, taggingPath, assets, metadata: {}, token,
    batchSelected: new Set(),
  };
  const nodes = {
    tagStage: { value: '' },
    tagActivity: { value: '' },
    tagRename: { value: '' },
    tagNewAlbumName: { value: '' },
    tagSave: { disabled: false, textContent: 'Save' },
  };
  const el = (id) => nodes[id] || null;
  const sandbox = {
    console, state, el,
    DEMO_MODE: false,
    document: { addEventListener() {}, getElementById: () => null },
    window: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    CONFIG: { owner: 'o', repo: 'r', imagesPath: 'images' },
    availableCategories: () => Object.keys(folders),
    normalizeCategory: (n) => String(n).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''),
    folderSequence: (f) => Object.keys(folders).indexOf(f),
    render: () => {},
    persistMetadata: async () => {},
    loadTree: async () => {},
    showToast: () => {},
    showPending: () => 1,
    reportTagSaveFailed: () => {},
    githubFetch: async (url) => {
      calls.push({ op: 'GET', url });
      return { ok: true, json: async () => ({ content: 'Y29udGVudA==' }) };
    },
    githubPut: async (path) => {
      calls.push({ op: 'PUT', path });
      /* failPut === 'second' throws on the second put, so the first copy has
         landed and the rollback has something to undo. failPut === 'first'
         throws immediately, so nothing was written at all. */
      const putsSoFar = calls.filter(c => c.op === 'PUT').length;
      if (failPut === 'second' && putsSoFar === 2) throw new Error('boom');
      if (failPut === 'first' && putsSoFar === 1) throw new Error('boom');
    },
    githubDelete: async (path) => { calls.push({ op: 'DELETE', path }); },
    errWhy: (e) => (e && e.message) || String(e),
  };
  sandbox.window.__galleryDiagLog = [];
  const ctx = vm.createContext(sandbox);
  const code = [
    'const NEW_ALBUM = "__new_album__";',
    fn('newAlbumCheck'),
    fn('moveIntoNewAlbum'),
    fn('createAlbumFromTag'),
  ].join('\n') + `
;globalThis.__h = { NEW_ALBUM, newAlbumCheck, moveIntoNewAlbum, createAlbumFromTag };`;
  vm.runInContext(code, ctx, { filename: 'newalbum.js' });
  return { ...sandbox.__h, state, calls, nodes };
}

const photo = (name, folder) => ({ name, path: `images/${folder}/${name}`, folder });

describe('Naming the new album', () => {
  test('a typed name is accepted and normalised', () => {
    const h = harness({ folders: { 'rack-build': [] }, order: ['rack-build'], taggingPath: 'images/rack-build/a.jpg' });
    const r = h.newAlbumCheck('Cable Routing');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.name, 'cable-routing', 'spaces become dashes, matching the existing folders');
    assert.match(r.why, /cable-routing/, 'the hint shows the name that will actually be used');
  });

  test('an existing album is refused, not silently duplicated', () => {
    const h = harness({ folders: { 'rack-build': [], 'cable-pull': [] }, order: ['rack-build', 'cable-pull'], taggingPath: 'images/rack-build/a.jpg' });
    const r = h.newAlbumCheck('Cable Pull');
    assert.strictEqual(r.ok, false, 'a second album with the same name is the surprise to prevent');
    assert.match(r.why, /already exists/);
  });

  test('the album the photo is already in is refused', () => {
    const h = harness({ folders: { 'rack-build': [] }, order: ['rack-build'], taggingPath: 'images/rack-build/a.jpg' });
    const r = h.newAlbumCheck('rack build');
    assert.strictEqual(r.ok, false);
    assert.match(r.why, /already in/);
  });

  test('an empty or unusable name is refused with a reason', () => {
    const h = harness({ folders: { 'rack-build': [] }, order: ['rack-build'], taggingPath: 'images/rack-build/a.jpg' });
    assert.match(h.newAlbumCheck('').why, /Type a name/);
    assert.match(h.newAlbumCheck('   ').why, /Type a name/);
    assert.strictEqual(h.newAlbumCheck('!!!').ok, false, 'punctuation alone leaves no folder name');
  });
});

describe('Creating the folder', () => {
  const setup = () => {
    const p = photo('shot.jpg', 'rack-build');
    return harness({
      folders: { 'rack-build': [p] },
      order: ['rack-build'],
      taggingPath: p.path,
      assets: [{
        canonical: { ...p, sha: 'sha1' },
        items: [p], variants: [],
      }],
    });
  };

  test('the copy is written before the source is deleted', () => {
    const h = setup();
    return h.moveIntoNewAlbum(h.state.taggingPath, 'cable-routing').then((r) => {
      assert.strictEqual(r.ok, true, r.error);
      const put = h.calls.findIndex(c => c.op === 'PUT');
      const del = h.calls.findIndex(c => c.op === 'DELETE');
      assert.ok(put >= 0, 'the new copy must be written');
      assert.ok(del >= 0, 'the old copy must be removed');
      assert.ok(put < del,
        'delete-before-put loses the photo if the put fails — the order is the whole safety property');
      assert.match(h.calls[put].path, /^images\/cable-routing\/shot\.jpg$/);
    });
  });

  test('every variant travels, so one photo is not split across two albums', () => {
    const p = photo('shot.jpg', 'rack-build');
    const v480 = { name: 'shot-480.webp', path: 'images/rack-build/shot-480.webp', folder: 'rack-build', sha: 'sha2' };
    const v800 = { name: 'shot-800.webp', path: 'images/rack-build/shot-800.webp', folder: 'rack-build', sha: 'sha3' };
    const h = harness({
      folders: { 'rack-build': [p] },
      order: ['rack-build'],
      taggingPath: p.path,
      assets: [{ canonical: { ...p, sha: 'sha1' }, items: [p, v480, v800], variants: [v480, v800] }],
    });
    return h.moveIntoNewAlbum(p.path, 'cable-routing').then(() => {
      const puts = h.calls.filter(c => c.op === 'PUT');
      assert.strictEqual(puts.length, 3, 'the canonical and both variants');
      for (const put of puts) assert.match(put.path, /^images\/cable-routing\//);
    });
  });

  test('a failed write rolls the copies that did land back out', async () => {
    const p = photo('shot.jpg', 'rack-build');
    const v = { name: 'shot-800.webp', path: 'images/rack-build/shot-800.webp', folder: 'rack-build', sha: 'sha2' };
    const h = harness({
      folders: { 'rack-build': [p] },
      order: ['rack-build'],
      taggingPath: p.path,
      assets: [{ canonical: { ...p, sha: 'sha1' }, items: [p, v], variants: [v] }],
      failPut: 'second',                   // the second put throws
    });
    const r = await h.moveIntoNewAlbum(p.path, 'cable-routing');
    assert.strictEqual(r.ok, false, 'a half-written album is a failure, not a success');
    assert.match(r.error, /boom/);
    // The first copy landed; the rollback must remove it, or the album now
    // holds a duplicate of a photo that is still in the old one.
    assert.ok(h.calls.some(c => c.op === 'PUT'), 'the first put did land');
    assert.ok(h.calls.some(c => c.op === 'DELETE' && /cable-routing/.test(c.path)),
      'the landed copy must be rolled back out of the new album');
  });

  test('a photo that is not in the tree is refused, not written', () => {
    const h = harness({ folders: { 'rack-build': [] }, order: ['rack-build'], taggingPath: 'images/nope/x.jpg', assets: [] });
    return h.moveIntoNewAlbum('images/nope/x.jpg', 'cable-routing').then((r) => {
      assert.strictEqual(r.ok, false);
      assert.match(r.error, /not in the loaded tree/);
      assert.strictEqual(h.calls.filter(c => c.op === 'PUT').length, 0, 'nothing may be written');
    });
  });
});

describe('The classification follows the photo', () => {
  test('the metadata is re-keyed onto the new path', async () => {
    const p = photo('shot.jpg', 'rack-build');
    const h = harness({
      folders: { 'rack-build': [p] },
      order: ['rack-build'],
      taggingPath: p.path,
      assets: [{ canonical: { ...p, sha: 'sha1' }, items: [p], variants: [] }],
    });
    h.state.metadata[p.path] = { phase: 'Cable Installation', activity: 'Pulling' };
    const r = await h.createAlbumFromTag(p.path, 'cable-routing');
    assert.strictEqual(r.ok, true, r.error);
    // The whole point: gallery.json is keyed by path, so a photo that moves
    // without its key lands back on "Needs review".
    assert.ok(!h.state.metadata[p.path], 'the old key must be removed, not left pointing at a file that is gone');
    assert.deepStrictEqual(h.state.metadata['images/cable-routing/shot.jpg'],
      { phase: 'Cable Installation', activity: 'Pulling' },
      'the classification must survive the move');
  });

  test('a failed move leaves the metadata exactly where it was', async () => {
    const p = photo('shot.jpg', 'rack-build');
    const h = harness({
      folders: { 'rack-build': [p] },
      order: ['rack-build'],
      taggingPath: p.path,
      assets: [{ canonical: { ...p, sha: 'sha1' }, items: [p], variants: [] }],
      failPut: 'first',
    });
    h.state.metadata[p.path] = { phase: 'Cable Installation', activity: '' };
    const r = await h.createAlbumFromTag(p.path, 'cable-routing');
    assert.strictEqual(r.ok, false);
    assert.ok(h.state.metadata[p.path], 'the classification must stay on the photo that did not move');
    assert.ok(!h.state.metadata['images/cable-routing/shot.jpg'],
      'and must not appear at a path that was never written');
  });
});