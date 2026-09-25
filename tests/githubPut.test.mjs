import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(join(here, '..', 'app.js'), 'utf8');

/* Stateful mock of api.github.com Contents API:
   - repo already contains gallery.json (sha known)
   - a NEW file is NOT present → plain PUT creates it
   - PUT to an existing path WITHOUT sha → 422 "sha wasn't supplied"
   Resolve/reject via the returned Response-like objects. */
const EXISTING = {
  'gallery.json': 'sha-galleryjson',
};

const stubEl = () => ({
  hidden: true, textContent: '', innerHTML: '', value: '', style: {}, dataset: {},
  addEventListener() {}, appendChild() {}, removeChild() {}, click() {}, remove() {},
  setAttribute() {}, getAttribute: () => null, classList: { add() {}, remove() {}, toggle() {} },
});

async function setup() {
  let pending = null; // { status, json }

  const fetchMock = async (url, options = {}) => {
    const path = decodeURIComponent(url.split('/contents/')[1] || '');
    const body = options.body ? JSON.parse(options.body) : {};
    if (options.method === 'PUT') {
      if (path in EXISTING && !body.sha) {
        pending = { status: 422, json: { message: '"sha" wasn\'t supplied' } };
      } else {
        pending = { status: path in EXISTING ? 200 : 201, json: { ok: true } };
      }
    } else {
      // GET — used by githubPut to resolve the existing sha for the retry.
      pending = { status: path in EXISTING ? 200 : 404, json: { sha: EXISTING[path], ok: true } };
    }
    return null; // resolved below through _last
  };

  const sandbox = {
    FileReader: class { readAsDataURL() {} readAsText() {} }, TextDecoder,
    File: class { constructor() {} }, FormData: class { append() {} },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    fetch: fetchMock,
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
    __pending: null,
  };

  const expose = `
    globalThis.__X = { githubPut, setToken: (v) => { state.token = v; }, getLast: () => globalThis.__last };
  `;
  sandbox.__last = null;
  sandbox.fetch = async (url, options) => {
    await fetchMock(url, options);
    if (pending === null) throw new Error('mock never answered');
    const r = pending;
    pending = null;
    sandbox.__last = { url, options };
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (h) => (h === 'X-RateLimit-Remaining' ? '5000' : h === 'X-RateLimit-Reset' ? '0' : null) },
      json: async () => r.json,
    };
  };
  vm.runInContext(code + expose, vm.createContext(sandbox), { filename: 'app.js' });
  sandbox.__X.setToken('test-token');
  return sandbox.__X;
}

describe('P1 — updating an existing file includes the current sha', () => {
  test('PUT to gallery.json without sha → API 422 → githubPut resolves sha and retries OK', async () => {
    const X = await setup();
    await X.githubPut('gallery.json', 'Y29udGVudA==', 'update meta');
    const last = X.getLast();
    assert.ok(last, 'a fetch was recorded');
    assert.ok(last.url.includes('/contents/gallery.json'), 'last call targeted gallery.json');
    const body = JSON.parse(last.options.body);
    assert.equal(body.sha, 'sha-galleryjson', 'retried PUT carries the existing file sha');
  });
});

describe('P2 — create-only writes refuse to clobber', () => {
  test('overwrite:false on an existing path throws (no silent overwrite)', async () => {
    const X = await setup();
    await assert.rejects(
      () => X.githubPut('gallery.json', 'Y29udGVudA==', 'add photo', { overwrite: false }),
      /sha|supplied/i
    );
  });
});

describe('P3 — brand-new file creates without needing a sha', () => {
  test('PUT to a nonexistent path succeeds on first attempt', async () => {
    const X = await setup();
    await assert.doesNotReject(
      () => X.githubPut('images/site-survey/new.jpg', 'eA==', 'add photo', { overwrite: false })
    );
  });
});