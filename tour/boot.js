/* ────────────────────────────────────────────────────────────────────
   tour/boot.js — starts (or resumes) the guided tour on the real
   gallery page. Loaded after app.js; does nothing unless the page
   was opened with ?tour=1 (the /tour entry page's Start button)
   or a tour is already in progress (reload resumes). A finished
   tour never restarts — that is the persistence rule.

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

  let params = null;
  try { params = new URLSearchParams(window.location.search); } catch (_) {}

  if (!shouldAutoStartTour(saved, params)) return;

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
