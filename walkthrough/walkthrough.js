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

  function addAction(label, href, primary) {
    var a = document.createElement('a');
    a.className = primary ? 'wt-cta' : 'wt-alt';
    a.href = href;
    a.textContent = label;
    elActions.appendChild(a);
  }

  function initLanding() {
    page.classList.add('wt-page-landing');
    elCounter.hidden = true;
    elTitle.textContent = 'The build, end to end';
    elCopy.textContent = 'A photographic record of a structured cabling project, from first survey to certified handover';
    elDots.hidden = true;
    addAction('Begin the walkthrough', stepUrl(STEPS[0]), true);
    addAction('Browse the gallery', galleryUrl(), false);
  }

  function initStep(index) {
    var step = STEPS[index - 1];
    elCounter.textContent = 'Step ' + index + ' of ' + N;
    elTitle.textContent = step.title;
    elCopy.textContent = step.copy;
    for (var i = 0; i < N; i++) addDot(STEPS[i], STEPS[i].index === index);
    if (index < N) {
      addAction('Next: ' + STEPS[index].title, stepUrl(STEPS[index]), true);
      addAction('Exit the walkthrough', galleryUrl(), false);
    } else {
      addAction('Browse the full gallery', galleryUrl(), true);
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
      // Under the primary CTA, above the quiet exit link.
      elActions.insertBefore(dlBtn.el, elActions.children[1] || null);
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

  /* ── Enter / exit fades ─────────────────────────────────────────
     TEXT sequential, IMAGES overlapping — enforced across static page
     loads: outgoing page fades its text first, incoming page delays
     its text 220ms behind the media reveal. */
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { page.classList.add('wt-enter'); });
  });
  sessionStorage.removeItem(NAV_KEY);

  var navigating = false;
  function exitTo(href) {
    if (navigating) return;
    navigating = true;
    sessionStorage.setItem(NAV_KEY, '1');
    if (reduce) { window.location.href = href; return; }
    page.classList.add('wt-exit');
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
