/* An admin session belongs to the tab that started it, and dies with it.

   The token it stands for is already in sessionStorage, and the browser
   clears sessionStorage when the tab closes — so "signed in" is released by
   closing the tab, with no request and no lock for anyone else to trip over.

   It used to be shared through a reserved __admin_session__ key in
   gallery.json, released only by an explicit Sign out. An admin who closed
   the tab instead left that key behind, and every later visitor was refused
   with "An admin is already signed in" until the file was edited by hand.
   This suite pins both halves of the replacement: nothing about a session is
   read into state or written to the repo, and a value left over from that
   era is filtered out and falls off the file on the next save. */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const APP = new URL('../app.js', import.meta.url);
const code = await readFile(APP, 'utf8');
const navCode = await readFile(new URL('../nav.js', import.meta.url), 'utf8');

const stubEl = () => ({
  hidden: true, textContent: '', innerHTML: '', value: '', style: {}, dataset: {},
  addEventListener() {}, appendChild() {}, removeChild() {}, click() {}, remove() {},
  setAttribute() {}, getAttribute: () => null,
  classList: { add() {}, remove() {}, toggle() {} },
});

/* A GitHub that holds one gallery.json: raw reads return its text, contents
   reads return its sha, and a PUT whose sha matches replaces it and bumps the
   sha (a mismatched or missing sha is rejected, as the real API does). */
async function boot(galleryText = '{}') {
  let sha = 'sha-1';
  let stored = galleryText;
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    const u = String(url);
    const method = (options.method || 'GET').toUpperCase();
    if (u.includes('raw.githubusercontent')) {
      calls.push({ method, kind: 'raw', path: 'gallery.json' });
      return { ok: true, status: 200, headers: { get: () => null },
        text: async () => stored, json: async () => ({}), clone() { return this; } };
    }
    const p = decodeURIComponent(u.split('/contents/')[1].split('?')[0]);
    calls.push({ method, kind: 'contents', path: p, shaSent: (options.body ? JSON.parse(options.body).sha : null) || null });
    if (p !== 'gallery.json') { return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => '{}', clone() { return this; } }; }
    if (method === 'PUT') {
      const body = options.body ? JSON.parse(options.body) : {};
      if (!body.sha) { return { ok: false, status: 422, headers: { get: () => null }, json: async () => ({ message: '"sha" wasn\'t supplied' }), text: async () => '{}', clone() { return this; } }; }
      if (body.sha !== sha) { return { ok: false, status: 409, headers: { get: () => null }, json: async () => ({ message: 'stale sha' }), text: async () => '{}', clone() { return this; } }; }
      sha = 'sha-' + (Number((/^sha-([0-9]+)$/.exec(sha) || [])[1] || 0) + 1);
      stored = body.content; // base64 content written to the branch
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: { sha } }), text: async () => '{}', clone() { return this; } };
    }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ sha }), text: async () => '{}', clone() { return this; } };
  };

  const sandbox = {
    TextDecoder, AbortController: class { constructor() { this.signal = {}; } abort() {} },
    console: { warn() {}, error() {}, log() {} },
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    Blob, URL, URLSearchParams,
    document: { getElementById: () => stubEl(), createElement: () => stubEl(), addEventListener() {},
      querySelector: () => null, querySelectorAll: [], body: { appendChild() {} }, head: { appendChild() {} } },
    window: { addEventListener() {}, matchMedia: () => ({ matches: true, addEventListener() {} }),
      open() {}, requestAnimationFrame: (f) => f(0) },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: fetchMock, location: { search: '', href: '' },
  };
  vm.runInContext(navCode, vm.createContext(sandbox), { filename: 'nav.js' });
  sandbox.GalleryNav = sandbox.window.GalleryNav;
  vm.runInContext(code, vm.createContext(sandbox), { filename: 'app.js' });
  const api = sandbox.window.__gallery;
  api.state.token = 'test-token';
  return { api, calls, storedGetter: () => stored };
}

const legacyLock = JSON.stringify({
  'images/a/1.jpg': { phase: 'Cable Installation', activity: '' },
  __admin_session__: { since: '2026-10-22T01:07:23.021Z' },
});

describe('the admin session is the tab, not the repo', () => {
  test('a session left in gallery.json is never loaded into state', async () => {
    const { api } = await boot(legacyLock);
    await api.loadMetadata(true);
    assert.equal('adminSession' in api.state, false,
      'state carries no shared session at all — there is no lock to inherit');
  });

  test('the retired key is not treated as a photo classification', async () => {
    const { api } = await boot(legacyLock);
    await api.loadMetadata(true);
    assert.ok(!('__admin_session__' in api.state.metadata),
      'it would otherwise be rendered as a classifyable image');
    assert.deepEqual(api.state.metadata,
      { 'images/a/1.jpg': { phase: 'Cable Installation', activity: '' } },
      'the real classifications survive the filter');
  });

  test('nothing about a session is ever written back', async () => {
    const { api, storedGetter } = await boot(legacyLock);
    await api.loadMetadata(true);
    api.state._metaSha = 'sha-1'; // warm the cache so the save is one PUT
    await api.persistMetadata();
    const written = JSON.parse(Buffer.from(storedGetter(), 'base64').toString());
    assert.ok(!('__admin_session__' in written), 'persist must not carry the lock forward');
    assert.ok(!('adminSession' in written), 'nor under any other name');
  });

  test('the next save takes a legacy lock off the file for good', async () => {
    const { api, storedGetter } = await boot(legacyLock);
    await api.loadMetadata(true);
    api.state._metaSha = 'sha-1';
    await api.persistMetadata();
    const written = JSON.parse(Buffer.from(storedGetter(), 'base64').toString());
    assert.deepEqual(Object.keys(written), ['images/a/1.jpg'],
      'the stale lock is gone and the classifications are untouched');
  });

  test('signing in needs no lock to release first', async () => {
    // The refusal that used to live in trySignIn read state.adminSession.
    // With the field gone from state there is nothing for it to test, so
    // assert the branch is not merely unreachable but absent.
    assert.ok(!/state\.adminSession/.test(code),
      'app.js still reads the removed shared session somewhere');
    assert.ok(!/An admin is already signed in/.test(code),
      'the message that refused every sign-in is still reachable');
  });
});
