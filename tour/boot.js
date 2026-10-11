/* ────────────────────────────────────────────────────────────────────
   tour/boot.js — starts (or resumes) the guided tour on the real
   gallery page. Loaded after app.js.

   The tour is a must, not an offer: it starts on every visit, and a
   finished one starts again on the next. The only state that survives
   is the step a walk stopped on, so an abandoned tour resumes where it
   left off rather than sending the visitor back to the wall.

   ON TIMING — "as soon as the page is up" means DOMContentLoaded, and
   that is deliberately not the moment the wall appears. The archive
   reads its tree from the GitHub API, so the first cards land roughly
   two seconds later (measured: DCL 673–1128ms, wall 2507–3717ms).
   Starting any earlier would aim the first step at a wall that is not
   there. Starting here is safe anyway, because the engine waits for a
   target that has no box yet rather than skipping the step — verified
   cold and warm, zero steps skipped.

   The tour has two audiences: visitors walk the shared path plus
   the admin sign-in reveal; a user who is already signed in as
   admin when the tour starts walks the admin tool set instead.
   app.js exposes the live sign-in state as window.__gallery
   (read once, at tour start — signing in or out mid-tour does
   not re-route a running tour).
   ──────────────────────────────────────────────────────────────────── */
(function () {
  if (typeof createGuidedTour !== 'function' || typeof TOUR_STEPS === 'undefined') return;

  let saved = null;
  try { saved = parseTourState(localStorage.getItem(TOUR_STORAGE_KEY)); } catch (_) {}

  if (!shouldAutoStartTour(saved)) return;

  const begin = () => {
    const gallery = (typeof window !== 'undefined' && window.__gallery) || null;
    const adminMode = !!(gallery && gallery.adminMode);
    const steps = selectTourSteps(TOUR_STEPS, adminMode);
    const tour = createGuidedTour({ steps });
    tour.start({ resume: !!(saved && saved.currentStepId && !saved.finished) });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', begin);
  } else {
    begin();
  }
})();
