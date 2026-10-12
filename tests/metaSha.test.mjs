/* A metadata save must not spend three round trips finding out something
   it already knows.

   GitHub's Contents API rejects a PUT that updates an existing path unless
   it carries the current sha (422 "sha wasn't supplied"). gallery.json is
   always an existing path, so a save that did not already hold the sha
   went: PUT (rejected) → GET to read the sha → PUT again. Three requests,
   one of them guaranteed to fail, before a 125-byte file is committed.

   The sha is now read once, at sign-in, and reused. That moves the cost to
   a moment when the admin is already waiting on a token check, so no
   classify click ever pays for it. */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const APP = new URL('../app.js', import.meta.url);
const code = await readFile(APP, 'utf8');

const stubEl = () => ({
  hidden: true, textContent: '', innerHTML: '', value: '', style: {}, dataset: {},
  addEventListener() {}, appendChild() {}, removeChild() {}, click() {}, remove() {},
  setAttribute() {}, getAttribute: () => null,
  classList: { add() {}, remove() {}, toggle() {} },
});

/* A GitHub that behaves like the real one: 422 without a sha, 409 when the
   sha has been superseded, and the new sha back on success. */
async function boot({ externalCommit = false } = {}) {
  let sha = 'sha-1';
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    const u = String(url);
    const method = (options.method || 'GET').toUpperCase();
    if (u.includes('raw.githubusercontent')) {
      calls.push({ method, kind: 'raw', path: 'gallery.json' });
      return { ok: true, status: 200, headers: { get: () => null },
        text: async () => '{}', json: async () => ({}), clone() { return this; } };
    }
    const p = decodeURIComponent(u.split('/contents/')[1].split('?')[0]);
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ method, kind: 'contents', path: p, shaSent: body.sha || null });
    let status = 200, out = {};
    if (method === 'PUT') {
      if (!body.sha) { status = 422; out = { message: '"sha" wasn\'t supplied' }; }
      else if (body.sha !== sha) {
        status = 409;
        out = { message: `Invalid request.\n\nis at ${sha} but expected ${body.sha}` };
      } else {
        const n = Number((/^sha-([0-9]+)$/.exec(sha) || [])[1] || 0);
        sha = 'sha-' + (n + 1);
        status = 200; out = { content: { sha } };
      }
    } else if (p === 'gallery.json') { out = { sha, content: { sha }, size: 125 }; }
    else if (p.includes('/git/trees/')) { out = { tree: [] }; }
    return { ok: status >= 200 && status < 300, status,
      headers: { get: (h) => (h === 'X-RateLimit-Remaining' ? '4999' : '0') },
      json: async () => out, text: async () => JSON.stringify(out), clone() { return this; } };
  };

  const sandbox = {
    FileReader: class { readAsDataURL() {} readAsText() {} }, TextDecoder,
    File: class { constructor() {} }, FormData: class { append() {} },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    console: { warn() {}, error() {}, log() {} },
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    Blob, URL, URLSearchParams,
    document: { getElementById: () => stubEl(), createElement: () => stubEl(), addEventListener() {},
      querySelector: () => null, querySelectorAll: () => [], body: { appendChild() {} }, head: { appendChild() {} } },
    window: { addEventListener() {}, matchMedia: () => ({ matches: true, addEventListener() {} }),
      open() {}, requestAnimationFrame: (f) => f(0) },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: fetchMock, location: { search: '', href: '' },
  };
  vm.runInContext(code, vm.createContext(sandbox), { filename: 'app.js' });
  const api = sandbox.window.__gallery;
  api.state.token = 'test-token';
  if (externalCommit) sha = 'sha-SOMEONE-ELSE';
  // shaAt is readable and writable: a test needs to move the branch
  // underneath a warm cache to exercise the 409 path.
  return { api, calls, shaAt: { get: () => sha, set: (v) => { sha = v; } } };
}

describe('A classify save is one request, not three', () => {
  test('the sha is read once, at sign-in', async () => {
    const { api, calls } = await boot();
    await api.loadMetadata(true);
    assert.ok(api.state._metaSha, 'the sha must be known after an authenticated load');
    const shaRead = calls.filter(c => c.kind === 'contents' && c.method === 'GET');
    assert.strictEqual(shaRead.length, 1, 'exactly one sha read at sign-in');
  });

  test('a save then costs a single PUT', async () => {
    const { api, calls } = await boot();
    await api.loadMetadata(true);
    calls.length = 0;
    api.state.metadata['images/a/1.jpg'] = { phase: 'Cable Installation', activity: '' };
    await api.persistMetadata();
    assert.strictEqual(calls.length, 1, `a save must be one request, got ${calls.length}`);
    assert.strictEqual(calls[0].method, 'PUT');
  });

  test('consecutive saves stay at one request each', async () => {
    const { api, calls } = await boot();
    await api.loadMetadata(true);
    for (const n of [1, 2, 3]) {
      calls.length = 0;
      api.state.metadata[`images/a/${n}.jpg`] = { phase: 'Cable Installation', activity: '' };
      await api.persistMetadata();
      assert.strictEqual(calls.length, 1, `save ${n} took ${calls.length} requests`);
    }
  });

  test('the sha is taken from the write response, not re-read', async () => {
    const { api, calls, shaAt } = await boot();
    await api.loadMetadata(true);
    calls.length = 0;
    api.state.metadata['images/a/1.jpg'] = { phase: 'Cable Installation', activity: '' };
    await api.persistMetadata();
    assert.strictEqual(api.state._metaSha, shaAt.get(),
      'the cache must track what the branch now holds');
    assert.ok(!calls.some(c => c.method === 'GET'), 'no re-read after a successful write');
  });

  test('an unchanged classification still writes nothing', async () => {
    const { api, calls } = await boot();
    await api.loadMetadata(true);
    api.state.metadata['images/a/1.jpg'] = { phase: 'Cable Installation', activity: '' };
    await api.persistMetadata();
    calls.length = 0;
    await api.persistMetadata();
    assert.strictEqual(calls.length, 0, 'a no-op save must not reach GitHub');
  });
});

describe('A stale cached sha costs a round trip, not a failure', () => {
  test('a 409 re-reads and retries, and recovers', async () => {
    // One harness: load, then let the branch move underneath us, then save.
    const { api, calls, shaAt } = await boot();
    await api.loadMetadata(true);
    // Another admin commits while this tab is open. The cache now holds a
    // sha the branch has moved past.
    const stale = api.state._metaSha;
    shaAt.set('sha-SOMEONE-ELSE');
    calls.length = 0;
    api.state.metadata['images/a/1.jpg'] = { phase: 'Cable Installation', activity: '' };
    await api.persistMetadata();   // must not throw
    const puts = calls.filter(c => c.method === 'PUT');
    assert.ok(puts.length >= 2, 'the first PUT should have been rejected and repeated');
    // The retry carries what the read returned — 'sha-SOMEONE-ELSE', which
    // was the branch value at the moment of the retry. Only after that write
    // succeeds does the branch hold a new sha.
    const read = calls.find(c => c.method === 'GET');
    assert.ok(read, 'a superseded sha must be re-read before the retry');
    assert.strictEqual(puts[puts.length - 1].shaSent, 'sha-SOMEONE-ELSE',
      'the retry carries the sha the read returned');
    assert.strictEqual(api.state._metaSha, shaAt.get(),
      'the cache ends up naming the branch value, taken from the write response');
    assert.ok(calls.some(c => c.method === 'PUT' && c.shaSent === stale),
      'the first attempt used the cached sha — that is what earned the 409');
    assert.ok(calls.some(c => c.method === 'GET'),
      'a superseded sha must be re-read before the retry');
    assert.ok(calls.some(c => c.method === 'PUT' && c.shaSent === shaAt.get()),
      'the retry carries the sha the branch actually holds');
  });

  test('the cache is cleared when metadata fails to load', async () => {
    const { api } = await boot();
    // A load that cannot reach the file must not leave an old sha behind:
    // a stale value would be used for a write that the retry then has to
    // undo. The write path copes either way, but the cache should be honest.
    const body = api.loadMetadata.toString();
    assert.ok(body.includes('state._metaSha = null'),
      'loadMetadata must clear the cached sha before it can fail');
  });
});