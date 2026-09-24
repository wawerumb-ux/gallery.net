/* Gallery service worker — cache-first for every origin the gallery actually
 * fetches images from (the GitHub Pages host + the jsDelivr blur-up thumbs +
 * raw.githubusercontent as a legacy fallback). Repeat visits and offline walks
 * load from Cache Storage.
 * Security: never reads state.token, never attaches Authorization, never
 * caches anything but image GETs. Admin writes (githubPut/githubFetch with a
 * Bearer header) bypass this SW entirely via the Authorization guard below. */
const IMG_CACHE = "gallery-images-v2";

self.addEventListener("install", (event) => { self.skipWaiting(); });

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== IMG_CACHE).map((k) => caches.delete(k))))
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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.headers.has("Authorization")) return;   // admin writes stay untouched
  const url = new URL(req.url);
  if (!allowlist(url)) return;                     // never touch API/metadata
  if (!IMG_RE.test(url.pathname)) return;          // never cache gallery.json/tree

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