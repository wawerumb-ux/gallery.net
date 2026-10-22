/* Only one admin can be signed in at a time, shared through gallery.json.

   The active admin session is stored under the reserved __admin_session__ key
   so every visitor sees the same lock: while an admin is signed in the sign-in
   option disappears, and it reappears when they sign out and release the lock.
*/

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

describe('the shared one-admin session lock', () => {
  test('loadMetadata reads the session out of gallery.json and keeps it out of metadata', async () => {
    const gallery = JSON.stringify({
      'images/a/1.jpg': { phase: 'Cable Installation', activity: '' },
      __admin_session__: { since: '2026-10-21T10:00:00.000Z' },
    });
    const { api } = await boot(gallery);
    await api.loadMetadata(true);
    assert.deepEqual(api.state.adminSession, { since: '2026-10-21T10:00:00.000Z' },
      'the shared admin session is loaded');
    assert.ok(!('__admin_session__' in api.state.metadata),
      'the session key is not treated as a photo classification');
    assert.deepEqual(api.state.metadata, { 'images/a/1.jpg': { phase: 'Cable Installation', activity: '' } });
  });

  test('loadMetadata starts with no session when gallery.json holds none', async () => {
    const { api } = await boot('{}');
    await api.loadMetadata(true);
    assert.equal(api.state.adminSession, null, 'no admin session by default');
  });

  test('persistMetadata writes the session into gallery.json and removes it on release', async () => {
    const { api, storedGetter } = await boot('{}');
    await api.loadMetadata(true);
    api.state._metaSha = 'sha-1'; // warm the cache so the save is one PUT
    // Acquire the lock.
    api.state.adminSession = { since: '2026-10-21T10:00:00.000Z' };
    await api.persistMetadata();
    const written = JSON.parse(Buffer.from(storedGetter(), 'base64').toString());
    assert.deepEqual(written.__admin_session__, { since: '2026-10-21T10:00:00.000Z' },
      'persisting writes the admin session to gallery.json');
    // Release the lock.
    api.state.adminSession = null;
    await api.persistMetadata();
    const released = JSON.parse(Buffer.from(storedGetter(), 'base64').toString());
    assert.ok(!('__admin_session__' in released), 'signing out removes the session lock');
  });
});
