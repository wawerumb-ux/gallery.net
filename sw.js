/* Gallery service worker.
 *
 * Two policies, because the two kinds of file here behave differently.
 *
 * IMAGES — cache-first. A photo's bytes never change under a given URL, so
 * there is nothing to revalidate; repeat visits and offline walks load from
 * Cache Storage. Every origin the gallery fetches images from is allowlisted
 * (the GitHub Pages host + the jsDelivr blur-up thumbs + raw.githubusercontent
 * as a legacy fallback).
 *
 * TEXT (html/css/js) — NETWORK-FIRST. This site has no build step and no
 * version query on its assets, so a stylesheet or script at a fixed URL is
 * rewritten in place on every deploy while the URL stays identical. Left to
 * the browser's own cache — which is what this file used to do by simply not
 * handling them — a push is invisible: the served bytes are new, the visitor
 * keeps running the old ones, and a change looks like it did nothing.
 * Network-first means the first load after a push is the new one; the cache
 * is only the offline fallback.
 *
 * Security: never reads state.token, never attaches Authorization, never
 * caches anything but GETs. Admin writes (githubPut/githubFetch with a
 * Bearer header) bypass this SW entirely via the Authorization guard below. */
const IMG_CACHE = "gallery-images-v2";
const ASSET_CACHE = "gallery-assets-v1";

self.addEventListener("install", (event) => { self.skipWaiting(); });

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== IMG_CACHE && k !== ASSET_CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Every origin the gallery loads images from. Pages host (Fastly CDN) is the
// main one now; jsDelivr serves the tiny blur-up thumbs; raw is legacy.
const RAW = "https://raw.githubusercontent.com";
const JSDELIVR = "https://cdn.jsdelivr.net";
const IMG_RE = /\.(png|jpe?g|gif|webp|avif)$/i;

function allowlist(url) {
  if (url.hostname === "cdn.jsdelivr.net") return true;
  if (url.hostname === "raw.githubusercontent.com") return true;
  // GitHub Pages project site or custom domain: same-origin image fetch.
  if (url.origin === self.location.origin) return true;
  return /\.github\.io$/.test(url.hostname);
}

const ASSET_RE = /\.(?:css|js)$/i;
const DOC_RE = /\.html?$/i;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.headers.has("Authorization")) return;   // admin writes stay untouched
  const url = new URL(req.url);

  // Our own html/css/js only — never a cross-origin script, and never the
  // GitHub API or gallery.json, which must always come from the network.
  if (url.origin === self.location.origin) {
    if (ASSET_RE.test(url.pathname) || DOC_RE.test(url.pathname)) {
      event.respondWith(
        fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(ASSET_CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => caches.match(req).then((hit) => hit || Response.error()))
      );
      return;
    }
    return;   // same-origin non-text: gallery.json, the API — leave it alone
  }

  if (!allowlist(url)) return;                     // never touch API/metadata
  if (!IMG_RE.test(url.pathname)) return;          // never cache gallery.json

  event.respondWith(
    caches.open(IMG_CACHE).then((cache) =>
      cache.match(req).then((hit) => {
        const network = fetch(req).then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        });
        return hit || network.catch(() => hit);
      })
    )
  );
});