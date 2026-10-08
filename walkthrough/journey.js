/* ────────────────────────────────────────────────────────────────────
   walkthrough/journey.js — the landing runtime: the request journey.

   Four things, in this order: the video layer, seven cards built from
   STAGES, a Rough.js connector between each pair, and a seven-state
   machine a click walks forward through.

   It runs on the landing only, and it is a sibling of walkthrough.js
   rather than part of it: that runtime still owns every step page, the
   first-visit gate and the link handling, all of which the landing keeps.

   The video is the content, so it is the one thing here that is never
   conditional. The state machine owns which card is lit; the
   connectors are measured once and redrawn only on resize, never per
   step index — recomputing them on every state change is what made
   them re-settle behind the visitor instead of staying put.
   ──────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Three planes, and the numbers that separate them. The video is
     furthest away so it moves least; the lines are nearest, so they
     lead and the cards sit between. */
  var DEPTH = { video: 8, cards: 16, lines: 24 };
  var SMOOTH = 0.08;
  var VIDEO_SCALE = 1.04;

  /* The brief's four timings. These mirror the four duration tokens in
     journey.css — one number in each place, and only one of them needs
     to be able to see the other. */
  var HOLD_MS = 200;
  var IN_MS = 220;
  var OUT_MS = 180;
  var DRAW_MS = 600;
  // The arrow waits for the line to finish before it arrives, so the
  // line reads as drawn and then pointed rather than both at once.
  var ARROW_MS = 200;

  var ACCENT = '#22d3ee';
  var N = STAGES.length;

  var videoHost = document.getElementById('jrVideo');
  var linesHost = document.getElementById('jrLines');
  var cardsHost = document.getElementById('jrCards');
  var resetBtn = document.getElementById('jrReset');

  var state = 0;
  var cards = [];
  var lines = [];
  var busy = false;

  /* ── The video ──────────────────────────────────────────────────
     Markup carries preload="metadata" and the autoplay attributes;
     playback is only started once the browser reports it can, so a
     device that refuses autoplay never leaves a black rectangle where
     the footage belongs. Muted and playsinline are what make autoplay
     legal on a phone at all. */
  var video = document.getElementById('jrVideoEl');
  function playVideo() {
    var p = video.play();
    // A rejected play() is not an error worth surfacing: the cards and
    // the scrim still read over the poster frame.
    if (p && p.catch) p.catch(function () {});
  }
  if (video.readyState >= 2) playVideo();
  else video.addEventListener('loadeddata', playVideo);

  /* ── Cards ──────────────────────────────────────────────────────
     Built from STAGES rather than authored into the page, so a stage is
     one object and the markup cannot drift from it. Each card is its
     own live region: the stage is announced when it becomes active,
     with its note, rather than the page announcing a bare number. */
  function buildCards() {
    for (var i = 0; i < N; i++) {
      var step = STAGES[i];
      var card = document.createElement('article');
      card.className = 'jr-card';
      // Written as custom properties rather than left/top so the
      // stylesheet still owns placement — the phone breakpoint re-anchors
      // every card to the bottom of the screen, and an inline left/top
      // would outrank it.
      card.style.setProperty('--jr-x', step.anchor.left + '%');
      card.style.setProperty('--jr-y', step.anchor.top + '%');
      card.setAttribute('role', 'status');
      card.setAttribute('aria-live', 'polite');

      var num = document.createElement('span');
      num.className = 'jr-card-num';
      num.textContent = (step.index < 10 ? '0' + step.index : step.index) + ' / 07';
      card.appendChild(num);

      var title = document.createElement('h2');
      title.className = 'jr-card-title';
      title.textContent = step.title;
      card.appendChild(title);

      var copy = document.createElement('p');
      copy.className = 'jr-card-copy';
      copy.textContent = step.copy;
      card.appendChild(copy);

      cardsHost.appendChild(card);
      cards.push(card);
    }
  }

  /* ── Connectors ─────────────────────────────────────────────────
     One Rough.js group per pair, from the bottom-right of card N to
     the top-left of card N+1. The seed is 42 + the connector index, so
     the sketch is the same shape every load: a line that redraws itself
     differently each visit reads as a glitch, not a flourish.

     Coordinates come from the laid-out cards, so they are cached and
     recomputed only when the cards move. */
  var NS = 'http://www.w3.org/2000/svg';

  function corner(card, which) {
    var b = card.getBoundingClientRect();
    return which === 'br'
      ? { x: b.left + b.width, y: b.top + b.height }
      : { x: b.left, y: b.top };
  }

  function group(className) {
    var g = document.createElementNS(NS, 'g');
    g.setAttribute('class', className);
    linesHost.appendChild(g);
    return g;
  }

  function drawConnector(i) {
    var a = cards[i];
    var b = cards[i + 1];
    if (!a || !b) return null;
    var from = corner(a, 'br');
    var to = corner(b, 'tl');

    var line = group('jr-line');
    var rc = rough.svg(line);
    // rough.svg() returns the <g> it built rather than appending it, so
    // the returned node is adopted here. Ignoring the return value is
    // how six empty groups end up on the page with no lines in them.
    line.appendChild(rc.line(from.x, from.y, to.x, to.y, {
      stroke: ACCENT, strokeWidth: 2, roughness: 1.5, bowing: 1.2, seed: 42 + i,
    }));

    // The arrowhead is two short Rough strokes at the end point, so it
    // carries the same hand as the line instead of sitting on top of it.
    // It lives INSIDE the connector's group, because it is that
    // connector's arrow — which is what lets one class fade it in when
    // the line has finished drawing.
    var ang = Math.atan2(to.y - from.y, to.x - from.x);
    var head = 12;
    var spread = 0.44;
    var arrow = document.createElementNS(NS, 'g');
    arrow.setAttribute('class', 'jr-arrow');
    line.appendChild(arrow);
    var ra = rough.svg(arrow);
    for (var s = -1; s <= 1; s += 2) {
      arrow.appendChild(ra.line(to.x, to.y,
        to.x - head * Math.cos(ang + s * spread),
        to.y - head * Math.sin(ang + s * spread),
        { stroke: ACCENT, strokeWidth: 2, roughness: 1.2, bowing: 1, seed: 42 + i }));
    }

    return line;
  }

  function buildConnectors() {
    // A rebuild is a re-measure, not a reset: which connectors the
    // visitor has already walked is state, so it survives a resize.
    var walked = lines.map(function (l) {
      return !!(l && l.classList.contains('is-on'));
    });
    while (linesHost.firstChild) linesHost.removeChild(linesHost.firstChild);
    lines = [];
    // Each connector is built hidden and stays that way until the journey
    // walks it, so the opening state is the video and one card with
    // nothing drawn across them.
    for (var i = 0; i < N - 1; i++) {
      var line = drawConnector(i);
      if (walked[i] && line) {
        line.classList.add('is-on');
        // Under reduced motion the draw is a single step, so a walked
        // connector is finished — arrow included.
        if (reduce) line.classList.add('is-drawn');
      }
      lines.push(line);
    }
  }

  /* The draw-in: each path is measured once and walked in from its own
     length. Rough emits two or three passes per stroke; they reveal
     together, which is what keeps it reading as one line being drawn.
     The arrow's own strokes are skipped — it fades in when the line has
     finished, not with it. */
  function playDraw(lineGroup) {
    if (!lineGroup) return;
    // The line becomes visible as it starts drawing, and stays: the
    // connectors the visitor has already walked are the path they took.
    lineGroup.classList.add('is-on');
    if (reduce) { lineGroup.classList.add('is-drawn'); return; }
    var paths = lineGroup.querySelectorAll('path');
    for (var i = 0; i < paths.length; i++) {
      var el = paths[i];
      if (el.closest && el.closest('.jr-arrow')) continue;
      var len = typeof el.getTotalLength === 'function' ? el.getTotalLength() : 0;
      if (!len) continue;
      el.style.strokeDasharray = len + ' ' + len;
      el.style.strokeDashoffset = String(len);
      // A reflow between the two assignments, or the browser coalesces
      // them and the line is simply on screen.
      void el.getBoundingClientRect();
      el.style.transition = 'stroke-dashoffset ' + DRAW_MS + 'ms cubic-bezier(0.16, 1, 0.3, 1)';
      el.style.strokeDashoffset = '0';
    }
    setTimeout(function () { lineGroup.classList.add('is-drawn'); }, DRAW_MS + ARROW_MS);
  }

  /* ── State machine ──────────────────────────────────────────────
     Seven states, one lit card, and the ordering is the whole point.
     The outgoing card is held at full opacity while the incoming one
     is in the DOM at zero; only once both have been painted that way
     does anything move, and they move together. Because the incoming
     fade (220ms) starts at the same moment as the outgoing one
     (180ms), the two overlap for the whole of the outgoing fade — there
     is no instant at which the stage holds nothing. */
  function clearExcept(keep) {
    for (var i = 0; i < N; i++) {
      if (cards[i] === keep) continue;
      cards[i].classList.remove('is-on', 'is-out', 'is-held');
      cards[i].style.zIndex = '';
    }
  }

  function swap(prev, next, incoming) {
    var outgoing = prev === next ? null : cards[prev];
    clearExcept(outgoing);
    // Held at full, with no transition on it: the outgoing card's start
    // state is its settled state, so it cannot fade from nothing.
    if (outgoing) {
      outgoing.classList.remove('is-on', 'is-out');
      outgoing.classList.add('is-held');
      outgoing.style.zIndex = '1';
    }
    incoming.classList.remove('is-on', 'is-out', 'is-held');
    // Stacked with z-index rather than by re-appending the node: two
    // cards can share an anchor, and moving one to the end of the
    // container would reorder the document and put the stages out of
    // reading order for anyone stepping through with a screen reader.
    incoming.style.zIndex = '2';

    if (reduce) {
      if (outgoing) { outgoing.classList.remove('is-held'); outgoing.classList.add('is-out'); }
      incoming.classList.add('is-on');
      return;
    }

    setTimeout(function () {
      if (outgoing) { outgoing.classList.remove('is-held'); outgoing.classList.add('is-out'); }
      incoming.classList.add('is-on');
      playDraw(lines[prev] || lines[Math.max(0, prev - 1)]);
      setTimeout(function () {
        if (outgoing) outgoing.classList.remove('is-on', 'is-out');
        busy = false;
      }, Math.max(IN_MS, OUT_MS));
    }, HOLD_MS);
  }

  function goTo(next) {
    var prev = state;
    state = next;
    swap(prev, next, cards[next]);
  }

  function step(delta) {
    if (busy) return;
    var next = state + delta;
    if (next < 0 || next > N - 1) return;
    busy = true;
    goTo(next);
  }

  function reset() {
    if (busy) return;
    busy = true;
    goTo(0);
    setTimeout(function () { busy = false; }, reduce ? 0 : HOLD_MS + IN_MS);
  }

  /* ── Pointer parallax ───────────────────────────────────────────
     One rAF for all three planes, and the position eases toward the
     pointer rather than snapping to it, so motion trails the cursor.
     Under reduced motion the whole block is skipped: no listener, no
     frame loop, no transform. */
  var pointer = { x: 0, y: 0 };
  var eased = { x: 0, y: 0 };
  var rafId = 0;

  function tick() {
    eased.x += (pointer.x - eased.x) * SMOOTH;
    eased.y += (pointer.y - eased.y) * SMOOTH;
    var vx = (eased.x * DEPTH.video).toFixed(2);
    var vy = (eased.y * DEPTH.video).toFixed(2);
    var cx = (eased.x * DEPTH.cards).toFixed(2);
    var cy = (eased.y * DEPTH.cards).toFixed(2);
    var lx = (eased.x * DEPTH.lines).toFixed(2);
    var ly = (eased.y * DEPTH.lines).toFixed(2);
    videoHost.style.transform = 'translate(' + vx + 'px,' + vy + 'px) scale(' + VIDEO_SCALE + ')';
    cardsHost.style.transform = 'translate(' + cx + 'px,' + cy + 'px)';
    linesHost.style.transform = 'translate(' + lx + 'px,' + ly + 'px)';
    rafId = requestAnimationFrame(tick);
  }

  if (!reduce) {
    window.addEventListener('mousemove', function (e) {
      pointer.x = (e.clientX / window.innerWidth - 0.5) * 2;
      pointer.y = (e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });
    rafId = requestAnimationFrame(tick);
  }

  /* ── Input ──────────────────────────────────────────────────────
     A click anywhere advances, the context menu rewinds, and the arrow
     keys walk both ways so the sequence is reachable without a pointer.
     The control stops the advance, or the reset button would advance as
     well as reset. */
  document.addEventListener('click', function (e) {
    var t = e.target;
    // Not on the controls, and not on a link: walkthrough.js puts the
    // two ways on — into the deck and the quiet exit — in the panel, and
    // a click that means "leave" must not also mean "next stage".
    if (t && t.closest && (t.closest('.jr-controls') || t.closest('a'))) return;
    step(1);
  });
  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    reset();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'Home') reset();
    else return;
    e.preventDefault();
  });
  if (resetBtn) {
    resetBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      reset();
    });
  }
  // The deck's own link handling has to see this page's links, and it
  // listens on document too. Both handlers are registered by separate
  // scripts on one document, so neither can stop the other from
  // registering — the guard above is what keeps them from overlapping.

  /* ── Go ────────────────────────────────────────────────────────
     Cards first, then the connectors, because the connectors are
     measured off the laid-out cards. The opening state is settled
     before anything is measured, so the first frame is a card rather
     than an empty stage. */
  buildCards();
  cards[0].classList.add('is-on');
  buildConnectors();

  // Cached coordinates, so this is the only thing that invalidates them.
  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(buildConnectors, 120);
  });

  window.addEventListener('pagehide', function () {
    if (rafId) cancelAnimationFrame(rafId);
  });
})();