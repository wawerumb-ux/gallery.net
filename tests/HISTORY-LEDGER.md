# History-backed navigation — defect ledger

Surface: the guided tour (`tour/tour.js`) on the gallery page, consolidated
with the gallery's own overlay history (`app.js`).

Every row was fixed and then **verified by mutation**: the defect was
re-introduced into the source and the suite was required to turn red. A row
that stayed green under mutation is not fixed, it is untested — those are
called out explicitly at the bottom.

Status: **226 tests, 226 pass, 0 fail** (baseline before this work: 198).

---

## The collision that stopped the audit

`history.state` was already spoken for, in two places at once, with
incompatible shapes:

| Owner | State shape | Behaviour on an unrecognised pop |
|---|---|---|
| `app.js` `overlayPush` (12 sites) | `{ 'gallery-overlay': id }` | pops `overlayStack`, hides one overlay |
| `tour/tour.js:964` | `{ guidedTour: true }` | `exitTour()` — reads every pop as "the user left" |

They were coupled by a private handshake: `overlayClose` dispatched a
`gallery:history-pop` CustomEvent immediately before `history.go(-1)`,
hoping the tour's listener would run afterwards and ignore the pop it
caused. This is order-dependent and it was already leaking — invariant 4
(exactly one popstate listener) was violated before any of this work began.

## Resolution

One module, `nav.js`, owning the stack, the listener, and the state shape.

    { overlay: 'lightbox' }
    { tour: true, tourStep: 7, tourId: 'viewer-delete' }
    { overlay: 'confirmOverlay', tour: true, tourStep: 57, tourId: '…' }

Tour fields **ride along on** overlay entries rather than replacing them: a
dialog opened mid-step is still that step, so backing out of it returns to
the step rather than out of the tour.

---

## Defects found and fixed

| # | Defect | Class | Fix | Mutation |
|---|---|---|---|---|
| H1 | Two `popstate` listeners; each guessed what a pop meant | 4 | Single listener in `nav.js`; both features subscribe | `tests/nav.test.mjs` asserts the count is 1 site-wide |
| H2 | Tour treated every non-tour pop as departure — walks ended at step 4 of 11 | 1 | Pop classified by the entry itself (`tourId` / `overlay` / neither) | M5 → 1 fail |
| H3 | `overlayPush` wrote no URL, so entries could be collapsed by the browser | 3 | `urlFor()` always emits a URL | M3 → 2 fail |
| H4 | Tour pushed one entry for the whole tour; back could not walk steps | 1 | `pushState` per step transition | M7 → 6 fail |
| H5 | Tour seeded with `pushState`, duplicating the arrival page — first back reloaded the site | 6 | `seed()` uses `replaceState`, once | M2 → 1 fail; M6 → 1 fail |
| H6 | No step was addressable or refreshable | 5 | `#step-<id>` on every entry; `stepFromHash()` reads it on boot | M9 → 1 fail |
| H7 | Forward after back did nothing — the step was never re-rendered | 1 | `onNavPop` renders the landed step | M8 → 3 fail |
| H8 | **`nav.js` announced its own `push`** — subscribers re-rendered, doubling every confirm animation | 2 | `commit()` announces nothing; `pushState` fires no event | M4 → 10 fail |
| H9 | `app.js` popped its stack on an overlay pop even when the pop was its own close | 1 | `ours` flag from `nav.back()`; `app.js` subscribes instead of listening | M1 → 2 fail |
| H10 | Private `gallery:history-pop` handshake, order-dependent | 4 | Removed from both files; `nav.js` carries the flag internally | asserted absent by test |

---

## Test-harness defects fixed along the way

These were latent and pre-dated this work; the harness was not modelling a
browser, so it could not have caught the above.

- `tour/tour.js` harness ran a **single-entry** history stack. Backing out of
  step 0 had nowhere to land, so "the user left the tour" was untestable.
  Now two entries, because arriving *is* a navigation (`boot.js` sets
  `location.href`).
- The stub had **no `location.hash`**, so the deep-link path could never
  match. `stepFromHash()` was untested, not broken.
- `pushState`/`replaceState` did **not move `location`**, so the hash the
  reader would see next was always stale.
- Four tour tests encoded the *old* contract (one entry, back always exits).
  Rewritten to the new behaviour, not deleted.
- Three `app.js` harnesses (`metaSha`, `githubPut`, `duplicates`) did not
  load `nav.js`, so `app.js` threw `GalleryNav is not defined` on load.
  Fixed by running `nav.js` in its own pass first, as `index.html` orders
  the scripts.

## Known-unreachable guards (disclosed, not hidden)

`onNavPop`'s `ended` and `ours` checks are **unreachable today** — removing
either leaves the suite green (M10, M11). This was confirmed by reading, not
only by test:

- every step change goes through `GalleryNav.push`, so a pop landing on a
  step entry names the step already shown and the equality check returns
  regardless of `ours`;
- `exitTour` → `unbindGlobal` → `unsubscribeNav`, so nothing arrives after
  the tour ends.

They are kept deliberately: the failures they prevent (a finished tour
resurrecting itself; a dialog close dragging the visitor back a step) are
severe, and a future refactor should delete them on purpose rather than by
accident. This is stated in the source at the guard.

The `state.overlay` guard *is* load-bearing — it needs the tour to have
moved between the entry being written and the pop arriving (tests T2d1/T2d2).
My first attempt at those tests let the step-equality check short-circuit,
so the guard was never consulted and the mutation stayed green. The tests
were wrong, not the guard.

---

## Invariants, and where each is enforced

| Invariant | Enforced by |
|---|---|
| 1 every step transition is a `pushState` | T2, T2a2, M7 |
| 2 no per-step state in a closure | `stepEntry(i)` carries id + index |
| 3 URL changes on every push | T2a, M3 |
| 4 exactly one popstate listener | `tests/nav.test.mjs` counts registrations |
| 5 seed via `replaceState`, once | T2, M2, M6 |
| 6 pop read from `history.state`, not a closure | `nav.js` emits `e.state` |
| 7 back out is never a trap | T2d — falling past step 0 exits and is recorded as `escapedAt` |
