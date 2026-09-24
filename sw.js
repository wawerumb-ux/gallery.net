/* Gallery service worker — cache-first for raw.githubusercontent.com images.
 * Why: GitHub raw sends Cache-Control: no-cache, so every visit revalidates
 * every image. This SW stores GET responses in Cache Storage so repeat visits
 * and offline walks load from disk.
 * Security: never reads state.token, never attaches Authorization, never
 * caches anything but image GETs. Admin writes (githubPut/githubFetch with a
 * Bearer header) bypass this SW entirely via the Authorization guard below. */
const IMG_CACHE = "gallery-images-v1";

self.addEventListener("install", (event) => { self.skipWaiting(); });

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== IMG_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const RAW = "https://raw.githubusercontent.com";
const IMG_RE = /\.(png|jpe?g|gif|webp|avif)$/i;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.headers.has("Authorization")) return;   // admin writes stay untouched
  const url = new URL(req.url);
  if (url.origin !== RAW) return;                 // only cache raw image GETs
  if (!IMG_RE.test(url.pathname)) return;         // never cache gallery.json/tree

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
