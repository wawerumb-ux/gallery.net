/* ────────────────────────────────────────────────────────────────────
   Walkthrough runtime (vanilla, no dependencies).

   One file drives every page: landing and all step pages are dumb
   shells carrying only <body data-depth data-step>. The runtime
   builds the ambient layer, applies the progress ramp, fills content
   from STEPS, and runs the One UI enter/exit fades across static
   page loads (continuity via sessionStorage, never via unmount).
   ──────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var body = document.body;
  var depth = Number(body.dataset.depth || 1);
  var prefix = '';
  for (var i = 0; i < depth; i++) prefix += '../';

  var N = STEPS.length;
  var stepAttr = body.dataset.step;
  var stepIndex = stepAttr ? Number(stepAttr) : null; // 1-based; null = landing
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var NAV_KEY = 'wt-nav';
  var PROGRESS_KEY = 'wt-progress';
  var TRANS_KEY = 'wt-transition';

  /* ── First-visit record ────────────────────────────────────────
     The walkthrough is the site's front door: the gallery sends
     first-time visitors here and only stops once one of these
     values exists (app.js, shouldRequireWalkthrough). Two values,
     because they answer different questions — 'completed' is the
     whole seven steps walked, 'skipped' is the visitor taking the
     quiet exit link, which is offered on every page precisely so
     the gate can never trap anyone. Storage that throws (private
     mode, blocked cookies) fails open: the gallery sends you back
     here once, which is a smaller cost than locking the archive. */
  var SEEN_KEY = 'walkthrough.seen';
  function markSeen(value) {
    try {
      if (!localStorage.getItem(SEEN_KEY)) localStorage.setItem(SEEN_KEY, value);
    } catch (e) {}
  }

  /* Progress model: landing 0.0 (ambient sharp); step 1 → 0.5;
     final step → 1.0 (ambient receded). The ramp maps the step's
     0-based position onto [0.5, 1] — with STEPS.length-1 gaps. */
  function targetFor(index) {
    if (!index) return 0;
    return 0.5 + ((index - 1) / (N - 1)) * 0.5;
  }
  var target = targetFor(stepIndex);

  /* ── Ambient layer ──────────────────────────────────────────────
     A deterministic field of translucent nodes and hairline links —
     identical on every page, so navigation only re-dims and re-blurs
     it (Depth Triad: blur + dim, never 3D perspective). */
  function rand(i) {
    var x = Math.sin(i * 127.1) * 43758.5453;
    return x - Math.floor(x);
  }
  var NODES = 14;
  var ACCENT_NODE = 5; // exactly one highlighted node — accent is spent here
  var LINKS = [
    [0, 3], [1, 4], [2, 5], [3, 6], [4, 7], [5, 8], [6, 9],
    [7, 10], [8, 11], [9, 12], [10, 13], [2, 9], [0, 5], [4, 11],
    [1, 12], [3, 10],
  ];

  function buildAmbient() {
    var host = document.getElementById('wtAmbient');
    if (!host) return null;
    var inner = document.createElement('div');
    inner.className = 'wt-ambient-inner';
    var pts = [];
    for (var i = 0; i < NODES; i++) {
      var x = 6 + rand(i) * 88;
      var y = 4 + rand(i + 40) * 92;
      pts.push([x, y]);
      var node = document.createElement('span');
      node.className = 'wt-node' + (i === ACCENT_NODE ? ' wt-node-accent' : '');
      var s = 5 + Math.round(rand(i + 80) * 5);
      node.style.width = s + 'px';
      node.style.height = s + 'px';
      node.style.left = 'calc(' + x + '% - ' + (s / 2) + 'px)';
      node.style.top = 'calc(' + y + '% - ' + (s / 2) + 'px)';
      inner.appendChild(node);
    }
    for (var j = 0; j < LINKS.length; j++) {
      var a = pts[LINKS[j][0]], b = pts[LINKS[j][1]];
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var len = Math.sqrt(dx * dx + dy * dy);
      var link = document.createElement('span');
      link.className = 'wt-link';
      link.style.left = a[0] + '%';
      link.style.top = a[1] + '%';
      link.style.width = len + '%';
      link.style.transform = 'rotate(' + Math.atan2(dy, dx) + 'rad)';
      inner.appendChild(link);
    }
    host.appendChild(inner);
    return host;
  }

  var ambient = buildAmbient();

  /* Re-dim / re-blur from the previous page's progress to this page's
     target — the ambient never unmounts, it only recedes or returns. */
  function setProgress(p) {
    if (ambient) ambient.style.setProperty('--wt-progress', String(p));
  }
  var prev = parseFloat(sessionStorage.getItem(PROGRESS_KEY));
  setProgress(isNaN(prev) ? target : prev);
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { setProgress(target); });
  });
  sessionStorage.setItem(PROGRESS_KEY, String(target));

  /* ── Content ──────────────────────────────────────────────────── */
  function stepUrl(step) { return prefix + 'walkthrough/' + step.slug + '/'; }
  function galleryUrl() { return prefix + 'index.html'; }
  function landingUrl() { return prefix + 'walkthrough/'; }
  /* The handoff. ?tour=1 is what /tour's own Start button uses to
     arm the engine on the gallery page (tour/boot.js), so the final
     step chains straight into the guided tour rather than parking the
     visitor on the archive with a second thing to find. */
  function tourUrl() { return prefix + 'tour/?tour=1'; }

  var page = document.querySelector('.wt-page');
  var elCounter = document.getElementById('wtCounter');
  var elTitle = document.getElementById('wtTitle');
  var elCopy = document.getElementById('wtCopy');
  var elDots = document.getElementById('wtDots');
  var elActions = document.getElementById('wtActions');
  var elMedia = document.getElementById('wtMedia');

  function addDot(step, current) {
    var a = document.createElement('a');
    a.className = 'wt-dot';
    a.href = stepUrl(step);
    a.setAttribute('aria-label', 'Step ' + step.index + ': ' + step.title);
    if (current) a.setAttribute('aria-current', 'step');
    elDots.appendChild(a);
  }

  /* The deck's slide rail — PowerPoint's signature, and this deck's
     progress indicator: every step's cover as a numbered thumbnail,
     the current one ringed in the accent. It is a pointer-device
     affordance, so the CSS hides it (and the dots take over) wherever
     touch is primary. Built here rather than in seven static pages so
     a new step needs no markup. */
  function buildRail(index) {
    var nav = document.createElement('nav');
    nav.className = 'wt-rail';
    nav.setAttribute('aria-label', 'Walkthrough slides');
    for (var i = 0; i < N; i++) {
      var step = STEPS[i];
      var a = document.createElement('a');
      a.className = 'wt-slide';
      a.href = stepUrl(step);
      a.setAttribute('aria-label', 'Step ' + step.index + ': ' + step.title);
      if (step.index === index) a.setAttribute('aria-current', 'step');
      var img = document.createElement('img');
      img.src = prefix + step.hero;
      img.alt = '';
      img.loading = i < 3 ? 'eager' : 'lazy';
      img.decoding = 'async';
      var num = document.createElement('span');
      num.className = 'wt-slide-num';
      num.textContent = step.index < 10 ? '0' + step.index : String(step.index);
      a.appendChild(img);
      a.appendChild(num);
      nav.appendChild(a);
    }
    if (page.firstChild) page.insertBefore(nav, page.firstChild);
    else page.appendChild(nav);
    return nav;
  }

  function addAction(label, href, primary) {
    var a = document.createElement('a');
    a.className = primary ? 'wt-cta' : 'wt-alt';
    a.href = href;
    a.textContent = label;
    elActions.appendChild(a);
    return a;
  }

  /* Back. Paired with Next, so stepping back is a control rather than
     a gesture — the deck already mirrors a push for a backwards move
     (transitionFor), so a back link plays the same motion as the dot
     it duplicates. Not an <a> with a back arrow: the label is the
     previous step's own title, so it says where it goes. */
  function addPrev(step) {
    var a = document.createElement('a');
    a.className = 'wt-prev';
    a.href = stepUrl(step);
    a.setAttribute('rel', 'prev');
    a.innerHTML = '';
    var mark = document.createElement('span');
    mark.className = 'wt-prev-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '←';
    var label = document.createElement('span');
    label.className = 'wt-prev-label';
    label.textContent = step.title;
    a.appendChild(mark);
    a.appendChild(label);
    elActions.appendChild(a);
    return a;
  }

  function initLanding() {
    page.classList.add('wt-page-landing');
    elCounter.hidden = true;
    elTitle.textContent = 'The build, end to end';
    elCopy.textContent = 'A photographic record of a structured cabling project, from first survey to certified handover';
    elDots.hidden = true;
    addAction('Start the walkthrough', stepUrl(STEPS[0]), true);
    addAction('Browse the gallery', galleryUrl(), false);
  }

  /* The tree comes first. The landing is now the cover of a growing
     generative tree with the call to action over it, so the walk
     literally starts where the tree does.

     What replaced the collage of seven covers is not a loss of
     navigability: every step page already carries a rail of numbered
     step covers, which is the same index in a better place — present
     for the whole walk rather than only before it. The landing keeps
     one thing the rail does not: the exit to the archive, which is
     still offered because the gate that sends visitors here has to be
     escapable.

     The tree is decorative and lives behind everything (see
     src/shaders/host-boundary.css, which gives it a box and opts it out
     of hit-testing), so nothing is built for it here. Deliberate: there
     is no markup on this page to go stale if the tree is ever turned
     off on phones or under reduced motion. */

  function initStep(index) {
    var step = STEPS[index - 1];
    // Eyebrow: the phase label and the slide number, mono and
    // letterspaced — the deck's architectural register.
    elCounter.innerHTML = '';
    var lab = document.createElement('span');
    lab.className = 'wt-count-label';
    lab.textContent = step.label || ('Step ' + step.index);
    var of = document.createElement('span');
    of.className = 'wt-count-of';
    of.textContent = step.index < 10 ? '0' + step.index + ' / 0' + N : step.index + ' / ' + N;
    elCounter.appendChild(lab);
    elCounter.appendChild(of);
    elTitle.textContent = step.title;
    elCopy.textContent = step.copy;
    // The step's hue drives the ambient wash and the mono eyebrow, so
    // the walk reads as a colour journey. The CTA keeps the site blue.
    if (step.accent != null) page.style.setProperty('--wt-h', String(step.accent));
    for (var i = 0; i < N; i++) addDot(STEPS[i], STEPS[i].index === index);
    buildRail(index);
    // Back goes above Next, and on step 1 it points at the landing
    // rather than at nothing — the deck is a loop the visitor can
    // re-enter, not a corridor with a dead end at the front.
    if (index > 1) addPrev(STEPS[index - 2]);
    else {
      var back = document.createElement('a');
      back.className = 'wt-prev';
      back.href = landingUrl();
      back.setAttribute('rel', 'prev');
      back.innerHTML = '';
      var bmark = document.createElement('span');
      bmark.className = 'wt-prev-mark';
      bmark.setAttribute('aria-hidden', 'true');
      bmark.textContent = '←';
      var blabel = document.createElement('span');
      blabel.className = 'wt-prev-label';
      blabel.textContent = 'The build, end to end';
      back.appendChild(bmark);
      back.appendChild(blabel);
      elActions.insertBefore(back, elActions.firstChild);
    }
    if (index < N) {
      addAction('Next: ' + STEPS[index].title, stepUrl(STEPS[index]), true);
      addAction('Exit the walkthrough', galleryUrl(), false);
    } else {
      // The handoff. The walkthrough's job was the story of the build;
      // the tour's job is the archive you can now use, and it is only
      // worth offering once the story has been told. The gallery stays
      // reachable as the quiet alternative — the gate records completion
      // either way, so nothing here is a one-way door.
      markSeen('completed');
      addAction('Start the guided tour', tourUrl(), true);
      addAction('Browse the full gallery', galleryUrl(), false);
    }
    var dlBtn = null;
    var media = initMedia(step, function onPhotoAdvance(i) {
      // The download always points at the photo on screen, full-res.
      if (dlBtn) dlBtn.setFile({ href: prefix + fullRes(media[i]), filename: fileName(media[i]) });
    });
    if (typeof createDownloadButton === 'function') {
      dlBtn = createDownloadButton({
        href: prefix + fullRes(media[0]),
        filename: fileName(media[0]),
        label: 'Download photo',
        variant: 'ghost',
        className: 'dlb-walkthrough',
      });
      // Under the primary CTA, above the quiet exit link. Positional,
      // because the back link added a row above the CTA: the CTA's own
      // index is found rather than assumed, or the download button
      // lands above Next.
      var cta = elActions.querySelector ? elActions.querySelector('.wt-cta') : null;
      elActions.insertBefore(dlBtn.el, cta ? cta.nextSibling : elActions.children[1] || null);
    }
  }

  /* steps.js stores the -800.webp tier; the full-res canonical file is
     the same name without the tier suffix. */
  function fullRes(src) { return src.replace(/-800\.webp$/, '.jpg'); }
  function fileName(src) { return fullRes(src).split('/').pop(); }

  /* Photography: hero plus the step's gallery, advanced by tap with
     the overlapping crossfade (outgoing 300ms, incoming 500ms). */
  function initMedia(step, onAdvance) {
    var photos = [step.hero].concat(step.gallery);
    var layers = photos.map(function (src, i) {
      var img = document.createElement('img');
      img.src = prefix + src;
      img.alt = step.title + ' — photo ' + (i + 1) + ' of ' + photos.length;
      img.decoding = 'async';
      if (i > 0) img.loading = 'lazy';
      elMedia.appendChild(img);
      return img;
    });
    var hint = document.createElement('span');
    hint.className = 'wt-media-hint';
    hint.textContent = '1 / ' + photos.length;
    elMedia.appendChild(hint);

    var cur = 0, busy = false;
    function show(next) {
      if (busy || next === cur) return;
      var out = layers[cur], inn = layers[next];
      inn.classList.add('is-on');            // incoming: 500ms
      out.classList.add('wt-img-out');       // outgoing: 300ms, overlap
      hint.textContent = (next + 1) + ' / ' + layers.length;
      if (onAdvance) onAdvance(next);
      busy = true;
      setTimeout(function () {
        out.classList.remove('is-on', 'wt-img-out');
        cur = next;
        busy = false;
      }, reduce ? 0 : 500);
    }
    elMedia.addEventListener('click', function () {
      show((cur + 1) % layers.length);
    });

    // First paint: incoming fade (500ms) once the shell has laid out.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { layers[0].classList.add('is-on'); });
    });
    return photos;
  }

  if (stepIndex) initStep(stepIndex); else initLanding();

  /* ── Slide transitions ────────────────────────────────────────────
     PowerPoint-inspired, across a static page load: every step is its
     own document, so the outgoing page plays the MIRROR of the move
     the destination declares and records its kind in sessionStorage;
     the incoming page reads it back and plays the arrival. One move,
     split either side of the load — which is why it reads as one
     continuous transition rather than a cut.

     The kind is authored per step (steps.js `transition`) and matched
     to what that step is about. A jump backwards mirrors a push, the
     way stepping back through a deck does. Unknown kinds, a direct
     visit, or a reload fall back to fade — never to no motion. */
  var TRANSITIONS = ['fade', 'morph', 'wipe-up', 'wipe-down',
                     'push-left', 'push-right', 'push-up',
                     'zoom-in', 'zoom-out'];
  /* Mirrors --wt-long in walkthrough.css: how long a slide takes to
     arrive, so the runtime can release the carrier classes after it. */
  var ARRIVE_MS = 500;

  function stepForHref(href) {
    for (var i = 0; i < N; i++) {
      if (href.indexOf('/' + STEPS[i].slug + '/') !== -1) return STEPS[i];
    }
    return null;
  }

  /* The kind to play, given where we are going. Backwards through a
     push flips its direction; everything else keeps its own kind. */
  function transitionFor(step) {
    if (!step || !step.transition) return 'fade';
    var kind = TRANSITIONS.indexOf(step.transition) !== -1 ? step.transition : 'fade';
    if (stepIndex && kind === 'push-left' && step.index < stepIndex) return 'push-right';
    return kind;
  }

  /* Arrival: the kind's start state lands with no transition on it, so
     it is always painted before anything moves. Then the start class
     comes OFF — the four variables fall back to the settled slide — and
     -go adds the single transition that carries it home. Both halves
     matter: without the start state the arrival is a cut, and without
     removing it the target is the start state and nothing moves. */
  function playArrive(kind) {
    var start = 'wt-t-' + kind + '-in';
    page.classList.add('wt-t-arrive', start);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        page.classList.remove(start);
        page.classList.add('wt-t-go');
        setTimeout(function () {
          // Landed: drop the carriers, so the page is a plain box again
          // rather than one that keeps a transform and will-change on.
          page.classList.remove('wt-t-arrive', 'wt-t-go');
        }, ARRIVE_MS);
      });
    });
  }

  /* Departure: the click is the user gesture, so the end state and its
     transition can go on together. */
  function playLeave(kind) {
    page.classList.add('wt-t-leave', 'wt-t-' + kind + '-out');
  }

  var arriving = 'fade';
  try {
    var recorded = sessionStorage.getItem(TRANS_KEY);
    sessionStorage.removeItem(TRANS_KEY);
    if (recorded && TRANSITIONS.indexOf(recorded) !== -1) arriving = recorded;
  } catch (e) {}
  // Reduced motion: the step is simply there — no start state, no
  // transition. The settled slide is the CSS default, so there is
  // nothing to add.
  if (!reduce) playArrive(arriving);

  sessionStorage.removeItem(NAV_KEY);

  var navigating = false;
  function exitTo(href) {
    if (navigating) return;
    navigating = true;
    // Leaving for the archive by any of the quiet links is a skip, not
    // a finish: mark it here so the gallery's gate lets the visitor back
    // in. Stepping to another step must NOT record anything, or bouncing
    // backwards through the deck would count as having been through it.
    if (href.indexOf('index.html') !== -1) markSeen('skipped');
    var kind = transitionFor(stepForHref(href));
    try { sessionStorage.setItem(TRANS_KEY, kind); } catch (e) {}
    sessionStorage.setItem(NAV_KEY, '1');
    if (reduce) { window.location.href = href; return; }
    playLeave(kind);
    setTimeout(function () { window.location.href = href; }, 320);
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a') : null;
    if (!a || !a.href) return;
    if (a.hasAttribute('download')) return; // DownloadButton handles its own activation
    if (a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    exitTo(a.href);
  });
})();
