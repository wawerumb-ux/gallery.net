/* ────────────────────────────────────────────────────────────────────
   nav.js — the site's single owner of the browser history stack.

   Two features want history entries on this page. The gallery pushes one
   per open overlay (viewer, dialog, sheet) so the back button closes what
   is on screen instead of leaving the site; the guided tour pushes one per
   step so back walks the tour backwards. Before this module each
   registered its own popstate listener and they fought: the tour read
   every pop that was not its own entry as "the user left", so the gallery
   had to announce its own pops over a CustomEvent to be ignored.

   One listener, one state shape. Every entry says what it is:

     { overlay: 'lightbox' }
     { tour: true, tourStep: 7, tourId: 'viewer-delete' }
     { overlay: 'confirmOverlay', tour: true, tourStep: 57, tourId: '…' }

   The tour fields ride along on overlay entries rather than replacing
   them: a modal opened during a step is still that step, so going back
   from the modal returns to the step rather than out of the tour.

   Subscribers are told whether the pop was ours (an explicit close, whose
   DOM work is already done) or the user's. Both cases emit the resolved
   state — read from history.state, never from a closure, which is stale by
   definition at this point (invariant 7).
   ──────────────────────────────────────────────────────────────────── */

(function (root) {
  'use strict';

  /* pushState/replaceState are unreliable on file:// in some engines, and
     every caller already has a direct path for closing an overlay. */
  const supported = root.location && root.location.protocol !== 'file:';

  const subscribers = new Set();

  /* Set while WE pop. Consumed by this module's own listener before any
     subscriber runs, which is why it cannot be read from app.js or the
     tour — they run later and would see it already cleared. */
  let suppress = false;

  /* A deep link names its step: #step-<id>. */
  function stepFromHash() {
    const m = /^#step-(.+)$/.exec(root.location.hash || '');
    return m ? m[1] : null;
  }

  /* The URL for an entry. The hash carries the step, so a tour link is
     shareable and survives a refresh (invariants 3 and 5). Everything else
     is left exactly as it was — an overlay entry must not rewrite a step
     the tour owns, nor drop one it does not. */
  function urlFor(state) {
    const base = root.location.pathname + root.location.search;
    return state && state.tourId ? base + '#step-' + state.tourId : base;
  }

  function emit(state, ours) {
    for (const fn of Array.from(subscribers)) {
      try { fn(state, ours); } catch (e) { /* one bad subscriber must not stop the rest */ }
    }
  }

  /* A commit changes the entry but deliberately announces nothing:
     pushState fires no event, and a subscriber that re-renders on its own
     push renders twice — once here, once in the caller's own transition.
     Every caller already does its DOM work in the transition that calls
     this; subscribers exist to report moves the browser made, nothing
     else. */
  function commit(state, method) {
    const full = Object.assign({}, state, { galleryNav: true });
    if (supported) {
      try { root.history[method](full, '', urlFor(full)); }
      catch (_) { /* unsupported engines simply get no history */ }
    }
    return full;
  }

  /* Seed the current entry once, before anything is pushed. replaceState
     and never pushState, or the page the user arrived from is duplicated
     (invariant 6, trap 6). */
  function seed(state) {
    const cur = root.history && root.history.state;
    if (cur && cur.galleryNav) return cur;
    return commit(state, 'replaceState');
  }

  /* A step the user can back out of. */
  function push(state) {
    return commit(state, 'pushState');
  }

  /* A mutation of the current entry that is not a navigation — scroll
     position, a filter. Never a step change: the forward button has
     nothing to return to if you replace instead of push (invariant 7,
     trap 2). */
  function replace(state) {
    return commit(state, 'replaceState');
  }

  /* Unwind one entry. Explicit closes call this so the DOM and the stack
     cannot disagree: the popstate below is what actually unwinds, and the
     `ours` flag stops each consumer redoing work it just did. */
  function back() {
    if (!supported) return false;
    suppress = true;
    try { root.history.go(-1); return true; }
    catch (_) { suppress = false; return false; }
  }

  root.addEventListener('popstate', (e) => {
    const ours = suppress;
    suppress = false;
    emit(e.state || {}, ours);
  });

  root.GalleryNav = {
    seed, push, replace, back,
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    stepFromHash,
    get current() { return (root.history && root.history.state) || {}; },
    get supported() { return supported; },
  };
})(typeof window !== 'undefined' ? window : globalThis);