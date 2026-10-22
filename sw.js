/* Gallery service worker.
 *
 * Two policies, because the two kinds of file here behave differently.
 *
 * IMAGES — cache-first. A photo's bytes never change under a given URL, so
 * there is nothing to revalidate; repeat visits and offline walks load from
 * Cache Storage. Every origin the gallery fetches images from is allowlisted
 * (the GitHub Pages host + the jsDelivr blur-up thumbs + raw.githubusercontent
 * as a legacy fallback). The cache is BOUNDED — see the ceilings below —
 * because an archive with no natural end and a laptop with a finite one are
 * not compatible.
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
const IMG_CACHE = "gallery-images-v3";   // v3: bounded (see the ceilings below)
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

/* ── Ceilings ─────────────────────────────────────────────────────
   This cache is fed by an archive with no natural end and kept by a
   machine with a finite one, so it gets two, and the two compose.

   A photo original is ~2700 KB of bytes and ~49 MB once decoded. The
   viewer asks for one per photo stepped to, and an unbounded cache
   keeps every one of them — the thing that used to fill the disk was
   also the thing the browser had to carry an index for. Anything over
   IMG_ENTRY_MAX is served but NOT kept: the wall does not display
   originals at all, it displays the -480/-800 webp tiers, and those
   are a few dozen KB each — which is to say, the files worth keeping
   are exactly the files this lets through.

   Size alone still permits 60 large files, so there is also a count.
   Past it the oldest entries are evicted; "oldest" is insertion order,
   not how often a photo was looked at, which is the honest trade —
   a photo's bytes never change under its URL, so a re-put is not a
   re-fresh, and FIFO needs no bookkeeping to keep a ceiling. */
const IMG_ENTRY_MAX = 1024 * 1024;
const IMG_CACHE_MAX = 60;

/* Unknown size is kept, known-large is not: a response with no
   content-length (chunked, or a CDN that declines to say) would
   otherwise empty the cache of everything it cannot label, while a
   response that admits to being 3 MB is exactly the one to skip. */
function sizeWithinBudget(res) {
  return !(Number(res.headers.get("content-length")) > IMG_ENTRY_MAX);
}

function trimTo(cache, max) {
  return cache.keys().then((keys) => {
    const over = keys.length - max;
    if (over <= 0) return undefined;
    return Promise.all(keys.slice(0, over).map((k) => cache.delete(k)));
  });
}

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
        /* A hit is the whole answer. A photo's bytes never change under
           its URL (see the policy at the top), so there is nothing to
           revalidate — and answering here while STILL fetching, which is
           what this did, meant every repeat view paid for a download, a
           buffered clone of the whole body and a re-put it never once
           used. Cache-first means first. */
        if (hit) return hit;
        return fetch(req)
          .then((res) => {
            if (res && res.ok && sizeWithinBudget(res)) {
              // clone() buffers the entire body, so this is only paid on
              // a response that is actually being kept.
              const copy = res.clone();
              // Fire-and-forget, the same as the asset branch above: the
              // page must not wait on a cache write. A dropped trim is
              // self-healing — it costs one extra entry until the next
              // put trims again.
              cache.put(req, copy)
                .then(() => trimTo(cache, IMG_CACHE_MAX))
                .catch(() => {});
            }
            return res;
          })
          .catch(() => Response.error());
      })
    )
  );
});