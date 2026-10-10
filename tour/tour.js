/* ────────────────────────────────────────────────────────────────────
   tour/tour.js — the action-gated guided tour engine.

   Model: the game tutorial. Each step is a state in an explicit
   machine — prompting → waiting → confirming → unlocking — and the
   ONLY way forward is the user performing the step's real action
   on the real interface. There is no Continue button anywhere.

   Design system: every timing derives from D in oneui.js
   (SPEED_MULTIPLIER × 1.25) and every color is a site token.
   One easing (ONE_UI_EASING), no bounce, no overshoot, no blur,
   no glow, no gradients. Reduced motion: all state changes are
   instant and the ring is solid.

   Testability: no browser API is touched at module load time —
   everything runs inside createGuidedTour(), so the whole engine
   executes in a vm sandbox with stubbed document/window, exactly
   like download-button.js.
   ──────────────────────────────────────────────────────────────────── */

const TOUR_STORAGE_KEY = 'walkthrough.tourState';
const TOUR_HISTORY_FLAG = 'guidedTour';   // the marker the tour pushes on its entry
const ACTION_DEBOUNCE_MS = 200;   // spec: rapid-duplicate guard window (functional, not motion)
const TARGET_WAIT_MS = 10000;     // operational grace for async-rendered targets
/* Spec holds are mapped onto D tokens (the download-button.js
   precedent: spec's ~600ms success hold = D.long), so every
   timing scales with the system multiplier:
     checkmark hold: spec 400ms ≈ D.base (375ms)
     toast hold:     spec 1200ms ≈ 2 × D.long (1250ms) */
const CHECKMARK_HOLD = D.base;
const TOAST_HOLD = D.long * 2;

/* The legal state transitions. The ONLY forward path is the
   step's action succeeding (waiting → confirming → unlocking).
   The extra → unlocking edges are the escape hatches, and they are
   not decoration: "skip this step" is offered on every waiting
   step, so a step must be able to unwind from waiting (and from
   prompting, if the user skips during the highlight settle)
   without its action ever succeeding. A step whose target never
   appears is skipped the same way. Nothing else transitions — URL
   edits, Enter, and clicks anywhere but the target are ignored. */
const TOUR_TRANSITIONS = {
  idle: ['prompting', 'unlocking'],
  prompting: ['waiting', 'unlocking'],
  waiting: ['confirming', 'unlocking'],
  confirming: ['unlocking'],
  unlocking: ['prompting', 'complete'],
  complete: [],
};

const DEFAULT_ESCAPES = [
  { kind: 'skip-action', label: 'Skip this step' },
  { kind: 'skip-tour', label: 'End tour' },
];

/* Parse persisted tour state; malformed input starts clean. */
function parseTourState(raw) {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return null;
    return {
      startedAt: typeof s.startedAt === 'string' ? s.startedAt : null,
      currentStepId: typeof s.currentStepId === 'string' ? s.currentStepId : null,
      completed: Array.isArray(s.completed) ? s.completed.filter(x => typeof x === 'string') : [],
      skipped: Array.isArray(s.skipped) ? s.skipped.filter(x => typeof x === 'string') : [],
      escapedAt: typeof s.escapedAt === 'string' ? s.escapedAt : null,
      finished: !!s.finished,
    };
  } catch (_) {
    return null;
  }
}

/* Auto-start policy (boot): a finished tour never restarts; an
   explicit ?tour=1 or an in-progress tour (currentStepId set)
   starts/resumes. */
function shouldAutoStartTour(saved, params) {
  if (saved && saved.finished) return false;
  if (params && params.get && params.get('tour') === '1') return true;
  return !!(saved && saved.currentStepId);
}

/* Audience selection (boot): the authored tour carries
   visitorOnly steps (the admin sign-in reveal) and adminOnly
   steps (the tool set). A tour that starts signed in walks
   the admin segment and never sees the sign-in reveal; a
   tour that starts signed out walks the sign-in reveal and
   never sees the tool set. The tour must never render a
   step the user cannot perform, so the filtering happens
   HERE, before the engine arms anything. Orders renumber so
   the on-screen "N / total" is right for the audience. */
function selectTourSteps(steps, adminMode) {
  const picked = steps.filter(s =>
    s.adminOnly ? !!adminMode : s.visitorOnly ? !adminMode : true);
  return picked.map((s, i) => ({ ...s, order: i + 1 }));
}

/* The engine. config: { steps, refs?, navigate? }
     steps   — TourStep[] (from tour/steps.js)
     refs    — optional { refName: element } for { kind: 'element' } targets
     navigate— optional(url) override for skip-tour routing (tests) */
function createGuidedTour(config) {
  const steps = (config && config.steps) || [];
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // dur(): every animation duration passes through here — reduced
  // motion collapses it to 0, otherwise it is a D-derived value.
  const dur = (ms) => (reduce ? 0 : ms);

  let phase = 'idle';
  let index = -1;
  let step = null;
  let target = null;
  let detachAction = null;
  let detachAnchor = null;
  let confirmPlayed = false;
  let lastSuccessAt = -Infinity;
  let targetWaitTimer = null;
  let settleTimer = null;
  let phaseTimer = null;
  let ended = false;
  // True between the gallery announcing a history pop and the
  // popstate it causes. See onPopState.
  let overlayPop = false;

  /* ── Persistence ─────────────────────────────────────────── */

  function loadState() {
    try { return parseTourState(localStorage.getItem(TOUR_STORAGE_KEY)); }
    catch (_) { return null; }
  }
  function saveState(patch) {
    try {
      const cur = loadState() || {
        startedAt: null, currentStepId: null, completed: [], skipped: [], escapedAt: null, finished: false,
      };
      const next = { ...cur, ...patch };
      // completed is append-only and monotonic: never remove or reorder.
      if (patch && Array.isArray(patch.completed)) {
        next.completed = cur.completed.slice();
        for (const id of patch.completed) if (!next.completed.includes(id)) next.completed.push(id);
      }
      if (patch && Array.isArray(patch.skipped)) {
        next.skipped = cur.skipped.slice();
        for (const id of patch.skipped) if (!next.skipped.includes(id)) next.skipped.push(id);
      }
      localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(next));
      return next;
    } catch (_) { return null; }
  }

  /* A fresh tour (not a resume) starts from a clean slate —
     a merge would keep a previous in-progress run's lists. */
  function resetState() {
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify({
        startedAt: new Date().toISOString(),
        currentStepId: null,
        completed: [],
        skipped: [],
        escapedAt: null,
        finished: false,
      }));
    } catch (_) {}
  }

  /* ── The state machine ─────────────────────────────────────── */

  function setPhase(next) {
    const allowed = TOUR_TRANSITIONS[phase] || [];
    if (allowed.indexOf(next) === -1) {
      console.warn('[tour] illegal transition ignored: ' + phase + ' → ' + next);
      return false;
    }
    phase = next;
    return true;
  }

  /* ── Overlay DOM (built once per tour, reused per step) ────── */

  let root, dim, ringSvg, ringRect, ringCheck, card, cardCount, cardTitle,
      cardPrompt, cardHint, cardEscapes, toast, escapeMenu;

  function buildOverlay() {
    root = document.createElement('div');
    root.className = 'tour-root';

    // The dim: an invisible element exactly over the target whose
    // box-shadow darkens everything else — a cutout, never a blur.
    dim = document.createElement('div');
    dim.className = 'tour-dim';

    // The ring: an SVG rect that draws in via stroke-dashoffset.
    ringSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ringSvg.setAttribute('class', 'tour-ring');
    ringRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    ringRect.setAttribute('class', 'tour-ring-rect');
    ringRect.setAttribute('fill', 'none');
    ringSvg.appendChild(ringRect);
    ringCheck = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    ringCheck.setAttribute('class', 'tour-ring-check');
    ringCheck.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'circle'));
    ringCheck.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
    ringCheck.style.opacity = '0';
    ringSvg.appendChild(ringCheck);

    // The prompt card. aria-live announces each new prompt.
    card = document.createElement('div');
    card.className = 'tour-card';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    cardCount = document.createElement('span');
    cardCount.className = 'tour-card-count';
    cardTitle = document.createElement('h2');
    cardTitle.className = 'tour-card-title';
    cardPrompt = document.createElement('p');
    cardPrompt.className = 'tour-card-prompt';
    cardHint = document.createElement('p');
    cardHint.className = 'tour-card-hint';
    cardEscapes = document.createElement('div');
    cardEscapes.className = 'tour-card-escapes';
    card.appendChild(cardCount);
    card.appendChild(cardTitle);
    card.appendChild(cardPrompt);
    card.appendChild(cardHint);
    card.appendChild(cardEscapes);
    const tail = document.createElement('span');
    tail.className = 'tour-card-tail';
    card.appendChild(tail);

    // Toast: confirm.toast text and unlockMessages.
    toast = document.createElement('div');
    toast.className = 'tour-toast';
    toast.setAttribute('role', 'status');

    // Escape menu (Escape key): the same two hatches, as text links.
    escapeMenu = document.createElement('div');
    escapeMenu.className = 'tour-escape-menu';
    escapeMenu.hidden = true;

    // Everything starts invisible; each step fades its highlight
    // in over D.base (appear()) and out over D.base (unlock()).
    card.style.opacity = '0';
    dim.style.opacity = '0';
    ringSvg.style.opacity = '0';
    toast.style.opacity = '0';

    root.appendChild(dim);
    root.appendChild(ringSvg);
    root.appendChild(card);
    root.appendChild(toast);
    root.appendChild(escapeMenu);
    document.body.appendChild(root);
  }

  function teardownOverlay() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = dim = ringSvg = ringRect = ringCheck = card = cardCount =
      cardTitle = cardPrompt = cardHint = cardEscapes = toast = escapeMenu = null;
  }

  /* ── Target resolution ─────────────────────────────────────── */

  function resolveTarget(stepDef) {
    const t = stepDef.target;
    if (!t) return null;
    if (t.kind === 'selector') return document.querySelector(t.selector);
    if (t.kind === 'element' && config.refs) return config.refs[t.ref] || null;
    // region / canvas targets need geometry/scene data this DOM-only
    // build cannot measure — the constraint is logged and the step
    // is skipped, never improvised.
    console.warn('[tour] unsupported target kind "' + t.kind + '" for step ' + stepDef.id + ' — skipping step');
    return null;
  }

  function isRendered(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /* ── Highlight placement (re-anchors on scroll/resize/shift;
        repositions, never re-animates) ─────────────────────── */

  function placeHighlight(el) {
    const r = el.getBoundingClientRect();
    // Dim cutout sits exactly on the target; its shadow is the dim.
    dim.style.left = r.left + 'px';
    dim.style.top = r.top + 'px';
    dim.style.width = r.width + 'px';
    dim.style.height = r.height + 'px';

    // Ring follows the target's own border radius — never forced.
    const radius = parseRadius(getComputedStyle(el).getPropertyValue('border-radius'), r);
    ringSvg.style.left = r.left + 'px';
    ringSvg.style.top = r.top + 'px';
    ringSvg.setAttribute('width', r.width);
    ringSvg.setAttribute('height', r.height);
    ringRect.setAttribute('x', 1);
    ringRect.setAttribute('y', 1);
    ringRect.setAttribute('width', Math.max(r.width - 2, 0));
    ringRect.setAttribute('height', Math.max(r.height - 2, 0));
    ringRect.setAttribute('rx', radius);
    ringRect.setAttribute('stroke-width', 2);
    ringRect.setAttribute('stroke', 'var(--accent-text)');
    const perimeter = 2 * (r.width + r.height);
    ringRect.setAttribute('stroke-dasharray', perimeter);
    // Draw-in: solid immediately under reduced motion.
    ringRect.style.transition = 'none';
    ringRect.setAttribute('stroke-dashoffset', reduce ? 0 : perimeter);
    if (!reduce) {
      // Force a style recalc so the offset change below transitions.
      void ringSvg.offsetWidth;
      ringRect.style.transition = 'stroke-dashoffset ' + dur(D.base) + 'ms ' + ONE_UI_EASING;
      ringRect.setAttribute('stroke-dashoffset', 0);
    }

    // Checkmark geometry (used by the checkmark confirm): an accent
    // disc sized to the target with a white check inside it.
    const cx = r.width / 2, cy = r.height / 2;
    const disc = Math.min(r.width, r.height) / 2 - 4;
    const s = Math.min(r.width, r.height) * 0.3;
    const circle = ringCheck.querySelector('circle');
    const path = ringCheck.querySelector('path');
    if (circle) {
      circle.setAttribute('cx', cx);
      circle.setAttribute('cy', cy);
      circle.setAttribute('r', Math.max(disc, 2));
      circle.setAttribute('fill', 'var(--accent-text)');
    }
    if (path) {
      path.setAttribute('d',
        'M ' + (cx - s * 0.55) + ' ' + cy +
        ' L ' + (cx - s * 0.1) + ' ' + (cy + s * 0.5) +
        ' L ' + (cx + s * 0.65) + ' ' + (cy - s * 0.55));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#ffffff');
      path.setAttribute('stroke-width', Math.max(r.width, r.height) * 0.04 + 1);
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
    }

    positionCard(r);
  }

  function parseRadius(value, r) {
    if (!value) return 0;
    const m = String(value).match(/(-?\d+\.?\d*)px/);
    if (m) return Math.min(parseFloat(m[1]), Math.min(r.width, r.height) / 2);
    if (value.indexOf('%') !== -1) return Math.min(r.width, r.height) / 2;
    return 0;
  }

  function positionCard(r) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const cw = card.offsetWidth || 0, ch = card.offsetHeight || 0;
    const gap = 8, margin = 8;
    let x, y, side;
    if (r.bottom + gap + ch + margin <= vh) { y = r.bottom + gap; side = 'bottom'; }
    else if (r.top - gap - ch - margin >= 0) { y = r.top - gap - ch; side = 'top'; }
    else if (r.right + gap + cw + margin <= vw) { x = r.right + gap; y = r.top + r.height / 2 - ch / 2; side = 'right'; }
    else { x = r.left - gap - cw; y = r.top + r.height / 2 - ch / 2; side = 'left'; }
    if (side === 'bottom' || side === 'top') {
      x = r.left + r.width / 2 - cw / 2;
    }
    x = Math.max(margin, Math.min(x, vw - cw - margin));
    y = Math.max(margin, Math.min(y, vh - ch - margin));
    card.style.left = x + 'px';
    card.style.top = y + 'px';
    card.setAttribute('data-tail', side);
    // The tail points from the card back to the target.
    const tail = card.querySelector('.tour-card-tail');
    if (tail) {
      // Clear every edge first — a stale left would win over
      // a new right on a later step anchored to another side.
      tail.style.left = '';
      tail.style.right = '';
      tail.style.top = '';
      tail.style.bottom = '';
      if (side === 'bottom') { tail.style.left = (r.left + r.width / 2 - x) + 'px'; tail.style.top = '-' + (gap / 2) + 'px'; }
      if (side === 'top') { tail.style.left = (r.left + r.width / 2 - x) + 'px'; tail.style.bottom = '-' + (gap / 2) + 'px'; }
      if (side === 'right') { tail.style.left = '-' + (gap / 2) + 'px'; tail.style.top = (r.top + r.height / 2 - y) + 'px'; }
      if (side === 'left') { tail.style.right = '-' + (gap / 2) + 'px'; tail.style.top = (r.top + r.height / 2 - y) + 'px'; }
    }
  }

  /* ── Step rendering ──────────────────────────────────────── */

  function renderStep(i) {
    if (ended || i >= steps.length) { finishTour(); return; }
    index = i;
    step = steps[i];
    confirmPlayed = false;
    saveState({ currentStepId: step.id });

    const appear = () => {
      if (ended) return;
      if (!isRendered(target)) { skipStep('target not visible'); return; }
      setPhase('prompting');
      // Card content — the next step's DOM does not exist until now.
      cardCount.textContent = step.order + ' / ' + steps.length;
      cardTitle.textContent = step.title;
      cardPrompt.textContent = step.prompt;
      cardPrompt.id = 'tour-prompt-' + step.id;
      cardHint.textContent = step.hint || '';
      cardHint.hidden = !step.hint;
      renderEscapes(cardEscapes);
      // Fade the card in over D.base; dim and ring fade with it.
      card.style.transition = 'opacity ' + dur(D.base) + 'ms ' + ONE_UI_EASING;
      dim.style.transition = 'opacity ' + dur(D.base) + 'ms ' + ONE_UI_EASING;
      ringSvg.style.transition = 'opacity ' + dur(D.base) + 'ms ' + ONE_UI_EASING;
      placeHighlight(target);
      card.style.opacity = '1';
      dim.style.opacity = '1';
      ringSvg.style.opacity = '1';
      // aria-describedby points the target at the prompt text.
      target.setAttribute('aria-describedby', cardPrompt.id);
      makeFocusable(target);
      // Prompting → waiting once the highlight settles.
      settleTimer = setTimeout(() => {
        settleTimer = null;
        if (ended) return;
        setPhase('waiting');
        bindAction();
        observeTargetResize();
      }, dur(D.base));
    };

    // A step whose target lives behind a disclosure says so here. Runs
    // before the target is resolved, otherwise the selector matches an
    // element that is not rendered and the step skips itself.
    if (step.beforeShow) { try { step.beforeShow(); } catch (_) {} }

    target = resolveTarget(step);
    if (target && isRendered(target)) { appear(); return; }
    // The target may not be rendered yet (async gallery data).
    // Wait for it; a step that never appears is skipped, not trapped.
    waitForTarget(appear);
  }

  function renderEscapes(container) {
    container.innerHTML = '';
    const defs = DEFAULT_ESCAPES.map(def => {
      const override = step.escape && step.escape.kind === def.kind ? step.escape : def;
      return override;
    });
    for (const def of defs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tour-escape-link';
      b.textContent = def.label;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (def.kind === 'skip-action') skipAction();
        else skipTour();
      });
      container.appendChild(b);
    }
  }

  function makeFocusable(el) {
    const tag = (el.tagName || '').toUpperCase();
    const native = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].indexOf(tag) !== -1;
    if (!native && !el.hasAttribute('tabindex')) {
      el.setAttribute('data-tour-tabindex', '1');
      el.setAttribute('tabindex', '0');
    }
  }
  function unfocusable(el) {
    if (el && el.hasAttribute && el.hasAttribute('data-tour-tabindex')) {
      el.removeAttribute('tabindex');
      el.removeAttribute('data-tour-tabindex');
    }
  }

  /* Wait (MutationObserver + grace timeout) for a target that is
     not in the DOM yet, or re-resolve one that got re-rendered. */
  function waitForTarget(onFound) {
    let settled = false;
    const done = () => { if (!settled) { settled = true; cleanup(); } };
    const cleanup = () => {
      if (targetWaitTimer) { clearTimeout(targetWaitTimer); targetWaitTimer = null; }
      if (observer) { observer.disconnect(); observer = null; }
    };
    let observer = null;
    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => {
        if (settled || ended) return;
        if (phase !== 'idle' && phase !== 'prompting' && phase !== 'waiting') return;
        const found = resolveTarget(step);
        if (found) { target = found; done(); onFound(); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    targetWaitTimer = setTimeout(() => {
      targetWaitTimer = null;
      if (settled || ended) return;
      done();
      console.warn('[tour] target for step ' + step.id + ' never appeared — skipping step');
      skipStep('target never appeared');
    }, TARGET_WAIT_MS);
  }

  /* A rendered step's target can be replaced by an app re-render
     (upload, delete, classify). Re-resolve instead of stranding
     the step — the tour must never trap the user. */
  let targetObserver = null;
  function watchTarget() {
    detachAnchor = null;
    if (targetObserver) { targetObserver.disconnect(); targetObserver = null; }
    if (typeof MutationObserver === 'undefined' || !target) return;
    const observer = new MutationObserver(() => {
      if (ended || !target) return;
      if (phase !== 'waiting') return;
      if (document.body.contains(target)) return;
      const found = resolveTarget(step);
      if (found && found !== target) {
        target = found;
        placeHighlight(target);
        target.setAttribute('aria-describedby', cardPrompt.id);
        makeFocusable(target);
        rebindAction();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    targetObserver = observer;
    detachAnchor = () => { observer.disconnect(); targetObserver = null; };
  }

  /* ── Action detection — exactly one listener per step, bound
        only to the highlighted target. Never a global click. ── */

  function bindAction() {
    if (!target || !step) return;
    const a = step.action;
    let cleanup = null;

    if (a.kind === 'click') {
      const onClick = (e) => {
        if (e.isTrusted === false) return; // synthetic clicks never count
        success();
      };
      // Keyboard users trigger click actions with Enter/Space on the
      // target — native on buttons/anchors, explicit on figures.
      const onKey = (e) => {
        if (e.isTrusted === false) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.key === ' ') e.preventDefault();
        success();
      };
      target.addEventListener('click', onClick);
      target.addEventListener('keydown', onKey);
      cleanup = () => {
        target.removeEventListener('click', onClick);
        target.removeEventListener('keydown', onKey);
      };
    } else if (a.kind === 'hover') {
      let timer = null;
      const start = (e) => {
        if (e.isTrusted === false) return;
        clearTimeout(timer);
        timer = setTimeout(success, a.durationMs);
      };
      const cancel = () => { clearTimeout(timer); timer = null; };
      target.addEventListener('pointerenter', start);
      target.addEventListener('pointerleave', cancel);
      cleanup = () => {
        clearTimeout(timer);
        target.removeEventListener('pointerenter', start);
        target.removeEventListener('pointerleave', cancel);
      };
    } else if (a.kind === 'input') {
      const onInput = (e) => {
        if (e.isTrusted === false) return;
        // '' is a real value (the clear-the-search step counts
        // only an empty box), so the guard is on definedness.
        if (a.valueMatches !== undefined && target.value !== a.valueMatches) return;
        success();
      };
      target.addEventListener('input', onInput);
      cleanup = () => target.removeEventListener('input', onInput);
    } else if (a.kind === 'scroll-to') {
      if (typeof IntersectionObserver !== 'undefined') {
        const io = new IntersectionObserver((entries) => {
          for (const en of entries) {
            if (en.isIntersecting && en.intersectionRatio >= 0.8) success();
          }
        }, { threshold: 0.8 });
        io.observe(target);
        cleanup = () => io.disconnect();
      }
    } else if (a.kind === 'custom' || a.kind === 'select-filter' ||
               a.kind === 'open-panel' || a.kind === 'download-start') {
      // The app dispatches window CustomEvent('tour:action', { detail })
      // with the matching name (and filter/value/panelId where relevant).
      const onCustom = (e) => {
        const d = e.detail || {};
        if (d.name !== actionEventName(a)) return;
        if (a.kind === 'select-filter' && (d.filter !== a.filter || d.value !== a.value)) return;
        if (a.kind === 'open-panel' && d.panelId !== a.panelId) return;
        success();
      };
      window.addEventListener('tour:action', onCustom);
      cleanup = () => window.removeEventListener('tour:action', onCustom);
    } else {
      console.warn('[tour] unsupported action kind "' + a.kind + '" — step ' + step.id);
      return;
    }
    detachAction = cleanup;
    watchTarget();
  }

  function actionEventName(a) {
    if (a.kind === 'custom') return a.eventName;
    if (a.kind === 'select-filter') return 'select-filter';
    if (a.kind === 'open-panel') return 'open-panel';
    if (a.kind === 'download-start') return 'download-start';
    return null;
  }

  function rebindAction() {
    if (detachAction) { detachAction(); detachAction = null; }
    bindAction();
  }

  /* ── Success → confirm → unlock ──────────────────────────── */

  function success() {
    if (ended || phase !== 'waiting') return;
    const now = Date.now();
    if (now - lastSuccessAt < ACTION_DEBOUNCE_MS) return; // rapid duplicates
    lastSuccessAt = now;
    if (detachAction) { detachAction(); detachAction = null; }
    if (detachAnchor) { detachAnchor(); detachAnchor = null; }
    if (target) {
      target.removeAttribute('aria-describedby');
      unfocusable(target);
    }
    if (!setPhase('confirming')) return;
    playConfirm(step.confirm, () => {
      if (ended) return;
      saveState({ completed: [step.id] });
      unlock(index + 1);
    });
  }

  function playConfirm(confirmDef, done) {
    if (confirmPlayed) { done(); return; } // exactly once per step
    confirmPlayed = true;
    const kind = confirmDef && confirmDef.kind ? confirmDef.kind : 'silent';

    if (kind === 'silent') {
      // Nothing plays — the next highlight simply appears. The
      // confirming phase still settles on the timer queue so the
      // machine's phases stay observable and ordered.
      setTimeout(done, 0);
      return;
    }

    if (kind === 'pulse') {
      // Ring scales 1 → 1.05 → 1 across D.base, then fades over D.short.
      ringSvg.style.transition = 'transform ' + dur(D.base / 2) + 'ms ' + ONE_UI_EASING;
      ringSvg.style.transform = 'scale(1.05)';
      setTimeout(() => {
        if (ended) return;
        ringSvg.style.transform = 'scale(1)';
      }, dur(D.base / 2));
      setTimeout(() => {
        if (ended) return;
        ringSvg.style.transition = 'opacity ' + dur(D.short) + 'ms ' + ONE_UI_EASING;
        ringSvg.style.opacity = '0';
      }, dur(D.base));
      setTimeout(done, dur(D.base) + dur(D.short));
      return;
    }

    if (kind === 'checkmark') {
      // Ring swaps to a filled accent circle with a white checkmark,
      // holds (≈ spec's 400ms, mapped to D.base), then fades.
      ringRect.style.transition = 'opacity ' + dur(D.short) + 'ms ' + ONE_UI_EASING;
      ringRect.style.opacity = '0';
      ringCheck.style.transition = 'opacity ' + dur(D.short) + 'ms ' + ONE_UI_EASING;
      ringCheck.style.opacity = '1';
      setTimeout(() => {
        if (ended) return;
        ringCheck.style.transition = 'opacity ' + dur(D.short) + 'ms ' + ONE_UI_EASING;
        ringCheck.style.opacity = '0';
      }, CHECKMARK_HOLD);
      setTimeout(done, CHECKMARK_HOLD + dur(D.short));
      return;
    }

    if (kind === 'toast') {
      showToast(confirmDef.text, done);
      return;
    }
    done();
  }

  function showToast(text, done) {
    toast.textContent = text;
    toast.style.transition = 'opacity ' + dur(D.short) + 'ms ' + ONE_UI_EASING;
    toast.style.opacity = '1';
    setTimeout(() => {
      if (ended) return;
      toast.style.transition = 'opacity ' + dur(D.short) + 'ms ' + ONE_UI_EASING;
      toast.style.opacity = '0';
    }, dur(D.short) + TOAST_HOLD);
    setTimeout(() => { if (done) done(); }, dur(D.short) + TOAST_HOLD + dur(D.short));
  }

  /* The critical moment: the outgoing card and highlight fully fade
     over D.base and are REMOVED before the next step renders —
     prompt cards are text, and text never overlaps. */
  function unlock(nextIndex) {
    if (ended) return;
    // A step that skips during the unlock hand-off (its target
    // resolved but never rendered — e.g. a control that is
    // display:none on this device) re-enters unlocking from
    // unlocking. That is a no-op re-entry, not a stall.
    if (phase !== 'unlocking' && !setPhase('unlocking')) return;
    if (step.unlockMessage) showToast(step.unlockMessage, null);
    card.style.transition = 'opacity ' + dur(D.base) + 'ms ' + ONE_UI_EASING;
    dim.style.transition = 'opacity ' + dur(D.base) + 'ms ' + ONE_UI_EASING;
    ringSvg.style.transition = 'opacity ' + dur(D.base) + 'ms ' + ONE_UI_EASING;
    card.style.opacity = '0';
    dim.style.opacity = '0';
    ringSvg.style.opacity = '0';
    phaseTimer = setTimeout(() => {
      phaseTimer = null;
      if (ended) return;
      teardownStep();
      if (nextIndex < steps.length) {
        renderStep(nextIndex);
      } else {
        setPhase('complete');
        finishTour();
      }
    }, dur(D.base));
  }

  function teardownStep() {
    // Stay faded out — the next step's appear() fades back in.
    // The card content is re-populated only there, so a future
    // step's text never exists in the DOM before it unlocks.
    card.style.opacity = '0';
    dim.style.opacity = '0';
    ringSvg.style.opacity = '0';
    ringSvg.style.transform = '';
    ringRect.style.opacity = '';
    ringCheck.style.opacity = '0';
    toast.style.opacity = '0';
    if (escapeMenu) escapeMenu.hidden = true;
    if (anchorObserver) { anchorObserver.disconnect(); anchorObserver = null; }
  }

  /* ── Escape hatches (never the primary path) ─────────────── */

  function skipStep(reason) {
    // A step the user cannot perform is skipped and logged — it is
    // never rendered into a state with no possible action.
    console.warn('[tour] skipping step ' + (step ? step.id : '?') + (reason ? ' (' + reason + ')' : ''));
    if (detachAction) { detachAction(); detachAction = null; }
    if (detachAnchor) { detachAnchor(); detachAnchor = null; }
    if (target) { target.removeAttribute('aria-describedby'); unfocusable(target); }
    saveState({ skipped: [step.id] });
    unlock(index + 1);
  }

  function skipAction() {
    if (ended) return;
    if (phase !== 'waiting' && phase !== 'prompting') return;
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    if (detachAction) { detachAction(); detachAction = null; }
    if (detachAnchor) { detachAnchor(); detachAnchor = null; }
    if (target) { target.removeAttribute('aria-describedby'); unfocusable(target); }
    // Advances as if the action succeeded — but is NOT recorded
    // as completed.
    saveState({ skipped: [step.id] });
    unlock(index + 1);
  }

  function skipTour() {
    exitTour();
    navigateToArchive();
  }

  /* Browser back, Escape → End tour: exits the tour entirely.
     The exit is recorded (escapedAt) so it is never mistaken
     for a completion.

     The gallery closes its own overlays by popping a history entry,
     which produces the very same popstate a real back-press does —
     closing the viewer with its Back button, or dismissing any
     dialog. Those are not the user leaving, and treating them as one
     ended the tour at its first "close something" step. Two guards:

       1. the gallery announces its pops (gallery:history-pop) just
          before making them — ordering-safe, since its own
          suppressPopstate flag is consumed by its own listener before
          any later listener runs;
       2. a pop that lands back on the tour's own history entry is
          unwinding an overlay the gallery pushed after the tour
          began, not carrying the user away. */
  function onGalleryHistoryPop() { overlayPop = true; }

  function onPopState() {
    if (ended) return;
    if (overlayPop) { overlayPop = false; return; }
    if (window.history && window.history.state &&
        window.history.state[TOUR_HISTORY_FLAG]) return;
    exitTour();
  }

  function exitTour() {
    if (ended) return;
    ended = true;
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    if (phaseTimer) { clearTimeout(phaseTimer); phaseTimer = null; }
    if (targetWaitTimer) { clearTimeout(targetWaitTimer); targetWaitTimer = null; }
    if (detachAction) { detachAction(); detachAction = null; }
    if (detachAnchor) { detachAnchor(); detachAnchor = null; }
    if (target) { target.removeAttribute('aria-describedby'); unfocusable(target); }
    unbindGlobal();
    teardownOverlay();
    saveState({ finished: true, currentStepId: null, escapedAt: new Date().toISOString() });
    if (phase !== 'complete') phase = 'complete';
  }

  function finishTour() {
    if (ended) return;
    ended = true;
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    if (phaseTimer) { clearTimeout(phaseTimer); phaseTimer = null; }
    if (targetWaitTimer) { clearTimeout(targetWaitTimer); targetWaitTimer = null; }
    unbindGlobal();
    teardownOverlay();
    saveState({ finished: true, currentStepId: null });
    phase = 'complete';
  }

  let anchorObserver = null;
  function observeTargetResize() {
    if (anchorObserver) { anchorObserver.disconnect(); anchorObserver = null; }
    if (typeof ResizeObserver === 'undefined' || !target) return;
    anchorObserver = new ResizeObserver(onAnchor);
    anchorObserver.observe(target);
  }

  /* ── Global listeners: Escape opens the hatch menu, back exits,
        scroll/resize re-anchor. Focus is never trapped. ────── */

  function bindGlobal() {
    // Capture phase: during a tour, Escape belongs to the escape
    // menu and must not also close gallery overlays underneath.
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('gallery:history-pop', onGalleryHistoryPop);
    window.addEventListener('resize', onAnchor, { passive: true });
    window.addEventListener('scroll', onAnchor, { passive: true, capture: true });
  }

  function unbindGlobal() {
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('gallery:history-pop', onGalleryHistoryPop);
    window.removeEventListener('resize', onAnchor);
    window.removeEventListener('scroll', onAnchor, true);
    if (anchorObserver) { anchorObserver.disconnect(); anchorObserver = null; }
    if (escapeMenu) escapeMenu.hidden = true;
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation(); // reserved for the escape menu during a tour
      toggleEscapeMenu();
    }
    // Everything else — Tab included — passes through untouched.
  }

  function toggleEscapeMenu() {
    if (!escapeMenu) return;
    if (escapeMenu.hidden) {
      escapeMenu.innerHTML = '';
      renderEscapes(escapeMenu);
      escapeMenu.hidden = false;
      positionMenu();
    } else {
      escapeMenu.hidden = true;
    }
  }

  function positionMenu() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const mw = escapeMenu.offsetWidth || 160, mh = escapeMenu.offsetHeight || 80;
    let x = vw / 2 - mw / 2, y = vh / 2 - mh / 2;
    x = Math.max(8, Math.min(x, vw - mw - 8));
    y = Math.max(8, Math.min(y, vh - mh - 8));
    escapeMenu.style.left = x + 'px';
    escapeMenu.style.top = y + 'px';
  }

  function onAnchor() {
    if (ended || !target) return;
    if (phase !== 'waiting' && phase !== 'prompting') return;
    if (!isRendered(target)) return;
    placeHighlight(target); // re-position, never re-animate
  }

  function navigateToArchive() {
    // The site IS the archive; route to its root (no query/hash).
    const url = window.location.pathname || '/';
    if (config && config.navigate) config.navigate(url);
    else if (window.location.assign) window.location.assign(url);
  }

  /* ── Public API ──────────────────────────────────────────── */

  function start(opts) {
    if (phase !== 'idle' || ended) return false;
    const saved = loadState();
    const resume = opts && opts.resume && saved && saved.currentStepId && !saved.finished;
    const startAt = resume
      ? Math.max(0, steps.findIndex(s => s.id === saved.currentStepId))
      : 0;
    if (resume) {
      saveState({ escapedAt: null });
    } else {
      resetState();
    }
    buildOverlay();
    bindGlobal();
    // A history entry makes browser-back exit the tour entirely.
    try { window.history.pushState({ [TOUR_HISTORY_FLAG]: true }, ''); } catch (_) {}
    renderStep(startAt);
    return true;
  }

  return {
    start,
    end: exitTour,
    getPhase: () => phase,
    getCurrentStepId: () => (step ? step.id : null),
    getCurrentStepOrder: () => (step ? step.order : null),
    getState: loadState,
    isStarted: () => phase !== 'idle',
  };
}
