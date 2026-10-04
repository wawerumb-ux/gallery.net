/* ────────────────────────────────────────────────────────────────────
   tour/boot.js — starts (or resumes) the guided tour on the real
   gallery page. Loaded after app.js; does nothing unless the page
   was opened with ?tour=1 (the /tour entry page's Start button)
   or a tour is already in progress (reload resumes). A finished
   tour never restarts — that is the persistence rule.
   ──────────────────────────────────────────────────────────────────── */
(function () {
  if (typeof createGuidedTour !== 'function' || typeof TOUR_STEPS === 'undefined') return;

  let saved = null;
  try { saved = parseTourState(localStorage.getItem(TOUR_STORAGE_KEY)); } catch (_) {}

  let params = null;
  try { params = new URLSearchParams(window.location.search); } catch (_) {}

  if (!shouldAutoStartTour(saved, params)) return;

  const begin = () => {
    const tour = createGuidedTour({ steps: TOUR_STEPS });
    tour.start({ resume: !!(saved && saved.currentStepId && !saved.finished) });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', begin);
  } else {
    begin();
  }
})();
