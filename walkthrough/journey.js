/* ────────────────────────────────────────────────────────────────────
   walkthrough/journey.js — the landing runtime: the request journey.

   Four things, in this order: the video layer, seven cards built from
   STAGES, the line work — one drawn connector between each pair and a
   line-art figure in each card — and a seven-state machine a click
   walks forward through.

   It runs on the landing only, and it is a sibling of walkthrough.js
   rather than part of it: that runtime owns the ambient layer, the
   first-visit gate and the link handling, all of which the landing
   keeps. Reaching the last card announces itself — one event, so the
   sibling runtime can record the visit without reaching in here.

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
  // A stage's own figure writes on faster than a connector draws: it is
  // a few strokes of the same hand, not a run between two cards.
  var FIGURE_MS = 420;

  // No accent literal here — every stroke in the layer takes its colour
  // from journey.css, which is the only place a hex is written.
  var N = STAGES.length;

  var videoHost = document.getElementById('jrVideo');
  var linesHost = document.getElementById('jrLines');
  // The signature's HTML host. Separate from the line layer because an
  // <svg> cannot contain the HTML wrapper the signature needs in order to
  // be positioned — see the note in index.html.
  var sigHost = document.getElementById('jrSigHost');
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
  // A scrub before the metadata is in is a seek the browser cannot honour
  // yet, so it is deferred rather than dropped: the visitor's first
  // notch should land, not vanish.
  if (video.readyState < 1) {
    video.addEventListener('loadedmetadata', function () {
      if (pendingSeek != null) { var t = pendingSeek; pendingSeek = null; scrubTo(t); }
    });
  }

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
      /* `row`, not `anchor.top`. The measured anchors put seven stages on
         three heights, and with the cards alternating sides that makes
         consecutive strokes land on the same segment — a seven-stage trail
         that reads as a fan of three. `row` gives every stage its own
         point. See the note in stages.js. */
      card.style.setProperty('--jr-y', step.row + '%');
      /* Corner comes from the stage data, which cycles the four corners
         anticlockwise. The measured anchor is no longer read — see the
         note in stages.js for why a seven-stage trail cannot use seven
         measured points that are really only three. */
      card.classList.add('is-' + (step.corner || 'bl'));
      card.setAttribute('role', 'status');
      card.setAttribute('aria-live', 'polite');

      var num = document.createElement('span');
      num.className = 'jr-card-num';
      num.textContent = (step.index < 10 ? '0' + step.index : step.index) + ' / 07';
      card.appendChild(num);

      // The stage's own line drawing, above the number. First in the
      // card because it is the first thing read: what this stop IS,
      // before what it is called.
      card.insertBefore(buildFigure(step), num);

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
     One leader line per card, drawn as a single clean stroke that the
     journey then walks in. This replaced a Rough.js sketch running
     between one card and the next: the sketch wobbled, which suited a
     hand-drawn deck and did not suit a diagram sitting on live footage.
     One weight, one curve, and the weight is the stylesheet's.

     Coordinates come from the laid-out cards, so they are re-measured
     only when the cards move. */
  var NS = 'http://www.w3.org/2000/svg';

  function svgEl(name, className) {
    var el = document.createElementNS(NS, name);
    if (className) el.setAttribute('class', className);
    return el;
  }

  function pathEl(className, d) {
    var p = svgEl('path', className);
    p.setAttribute('d', d);
    return p;
  }

  function group(className) {
    var g = svgEl('g', className);
    linesHost.appendChild(g);
    return g;
  }

  /* The stage's own drawing, into the card. Line art rather than an
     icon set: the figures share one weight and one square so seven of
     them read as a set, and each writes itself on when its card lights
     (see playFigure). */
  function buildFigure(step) {
    var fig = svgEl('svg', 'jr-figure');
    fig.setAttribute('viewBox', '0 0 100 100');
    fig.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < step.figure.length; i++) {
      fig.appendChild(pathEl('jr-figure-path', step.figure[i]));
    }
    return fig;
  }

/* ── The signature ───────────────────────────────────────────────
     The line animation, and it is one fixed flourish rather than a
     stroke derived from wherever the cards happen to be.

     That is the change from the trail it replaces. The trail measured
     the laid-out cards on every build and drew a wave between them, so
     its geometry was a function of the viewport and the cards moved. A
     signature is the opposite: one authored path, the same shape every
     time, which is the whole point of a signature — it is how someone
     writes their own name, not how the page computes a route.

     It redraws on every forward step rather than accumulating. Six
     copies of the same scribble stacked on each other would not read as
     a signature at all, so each advance is a fresh draw and the
     previous one is simply replaced.

     THREE PASSES, NOT ONE. The stroke is black, as specified, and the
     footage is not: measured against the darkest rack shot this path
     sits on, black is 1.07:1 — invisible — and against the lightest
     office shot it is 18:1. One stroke cannot serve a backdrop that
     swings that far. So the path is drawn three times, all from the
     same `d`: two translucent white haloes beneath, widest first, and
     the black stroke on top. The black is the signature; the white is
     what makes it legible on the dark half of the footage without
     changing the colour that was asked for.

     The haloes are strokes, not a blur filter. A blur on an SVG element
     costs a filter pass on every frame the line animates, and three
     concentric strokes give the same separation for the price of three
     cheap paint operations. */
  var SIG_PATH =
    'M3 94.6748C27.4641 99.4874 46.3246 102.55 65.0444 83.8304' +
    'C73.9796 74.8953 76.1503 62.8261 69.8444 51.4748' +
    'C58.3692 30.8185 36.6188 61.9308 52.6 71.9193' +
    'C81.897 90.2303 107.995 53.7887 112.155 28.3637' +
    'C113.368 20.9544 114.609 12.5035 115 5.07481' +
    'C115.339 -1.36878 117.032 6.28246 117.844 8.63037' +
    'C119.35 12.9801 121.884 16.4674 123.356 20.7192' +
    'C125.931 28.1593 122.746 21.3428 121.755 17.8748' +
    'C118.913 7.92667 118.724 -1.31665 108.6 8.27481' +
    'C106.563 10.205 95.3631 19.2352 97.3999 19.4748' +
    'C103.175 20.1542 109.598 23.9571 115 24.2748' +
    'C122.394 24.7098 126.464 27.2512 116.6 22.3192' +
    'C113.382 20.71 110.214 19.6588 107 18.2304' +
    'C101.703 15.8763 109.23 17.7389 109.844 18.2304' +
    'C111.629 19.6579 116.523 20.3297 111.8 18.2304' +
    'C110.584 17.6899 105.386 16.2748 107 16.2748' +
    'C112.097 16.2748 118.803 21.3653 116.956 17.8748' +
    'C115.403 14.9415 113.389 14.4872 110.2 14.6748' +
    'C109.114 14.7386 105.166 17.8748 107 17.8748';

  var SIG_MS = 1500;  // animationDuration
  var BOUNCE = 0.3;   // animationBounce, as a fraction of the path

  function buildSignature() {
    var host = sigHost || linesHost;
    while (host.firstChild) host.removeChild(host.firstChild);
    lines = [];
    // A real SVG document, not a <g> in the page's line layer: the
    // signature needs its own viewBox to scale independently of the
    // page, and the existing layer is a fixed 100%x100% overlay.
    /* The HTML wrapper is not decoration. CSS `position` does not apply
       to an <svg> nested inside another <svg>: the rule matches, the
       computed value comes back as static, and the element is laid out
       in flow — which is how this signature ended up 961px wide in the
       corner instead of 460px and centred. An HTML <div> inside the
       line layer positions normally, so the wrapper carries the
       placement and the svg carries only the drawing. */
    var box = document.createElement('div');
    box.className = 'jr-sig-box';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 127 101');
    svg.setAttribute('class', 'jr-sig');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    // pathLength="1" normalises the dash maths to proportions of the
    // path, so the bounce is 0.3 of the signature rather than 0.3
    // whatever the render size happens to be.
    for (var i = 0; i < 3; i++) {
      var p = svgEl('path', 'jr-sig-pass jr-sig-pass--' + i);
      p.setAttribute('d', SIG_PATH);
      p.setAttribute('pathLength', '1');
      svg.appendChild(p);
    }
    box.appendChild(svg);
    host.appendChild(box);
    lines = [box];

    /* hoverAnimationType="redraw": entering replays the draw and takes
       the hover colour; leaving does NOT redraw, because re-running the
       animation on the way out makes the pointer feel like it is
       rubbing the line off. */
    /* The hover target is the svg, not the wrapper: the wrapper is
       larger than the drawing and an empty box should not feel like a
       target. */
    svg.addEventListener('mouseenter', function () {
      box.classList.add('is-hover');
      playDraw(box, true);
    });
    svg.addEventListener('mouseleave', function () {
      box.classList.remove('is-hover');
    });
    return box;
  }

  /* One draw. `force` re-runs it even mid-animation, which is what the
     hover does; otherwise a draw already in flight is left alone, so a
     visitor stepping quickly does not restart it every time. */
  function playDraw(lineGroup, force) {
    if (!lineGroup) return;
    if (!force && lineGroup.classList.contains('is-drawn')) return;
    lineGroup.classList.add('is-on');
    var paths = lineGroup.querySelectorAll('path');
    for (var i = 0; i < paths.length; i++) {
      var el = paths[i];
      if (reduce) {
        el.style.strokeDasharray = '';
        el.style.strokeDashoffset = '';
        el.style.transition = '';
        continue;
      }
      // Normalised by pathLength, so 1 is the whole signature whatever
      // it is scaled to on screen.
      el.style.transition = 'none';
      el.style.strokeDasharray = '1 1';
      el.style.strokeDashoffset = '1';
    }
    if (reduce) { lineGroup.classList.add('is-drawn'); return; }
    /* The start state has to be painted before anything moves, and a
       forced reflow is not always enough on an SVG element — this is the
       same two-frame pattern the per-card figures use, and for the same
       reason: a transition whose start state was never rendered does not
       run at all, and the signature is simply there, undrawn. */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        for (var j = 0; j < paths.length; j++) {
          /* An ANIMATION, not a transition. The transition was here
             first and it cannot express animationBounce at all: a
             transition only knows the two values it is between, so the
             overshoot is unreachable and the line eased 1 to 0 with
             nothing in between. The bounce needs a third stop, placed
             at 70% of the way — so the keyframes supply the shape and
             the animation supplies the clock. */
          paths[j].style.animation =
            'jr-sig-bounce ' + SIG_MS + 'ms cubic-bezier(0.68, -0.55, 0.27, 1.55) 0s 1 both';
        }
        setTimeout(function () {
          lineGroup.classList.add('is-drawn');
          for (var k = 0; k < paths.length; k++) {
            paths[k].style.animation = '';
            paths[k].style.strokeDashoffset = '0';
          }
        }, SIG_MS + 40);
      });
    });
  }

  function resetLines() {
    for (var i = 0; i < lines.length; i++) {
      lines[i].classList.remove('is-on', 'is-drawn', 'is-hover');
      var ps = lines[i].querySelectorAll('path');
      for (var j = 0; j < ps.length; j++) {
        ps[j].style.strokeDasharray = '';
        ps[j].style.strokeDashoffset = '';
        ps[j].style.transition = '';
      }
    }
  }

  /* The same write-on, for the stage's own figure. It sits in the card
     rather than the line layer, so it is visible on a phone where the
     connectors are not — and on a phone it is the only line work the
     landing has. */
  function playFigure(card) {
    if (!card) return;
    var fig = card.querySelector('.jr-figure');
    if (!fig) return;
    var paths = fig.querySelectorAll('path');
    for (var i = 0; i < paths.length; i++) {
      var el = paths[i];
      var len = typeof el.getTotalLength === 'function' ? el.getTotalLength() : 0;
      // A browser without getTotalLength gets the finished drawing
      // rather than a figure stuck at dash offset — a still image beats
      // an invisible one.
      if (!len) continue;
      if (reduce) {
        el.style.strokeDasharray = '';
        el.style.strokeDashoffset = '';
        continue;
      }
      el.style.transition = 'none';
      el.style.strokeDasharray = len + ' ' + len;
      el.style.strokeDashoffset = String(len);
    }
    if (reduce) return;
    /* The start state has to be PAINTED before anything moves, and a
       forced reflow is not enough: this is called as the card arrives,
       and a transition whose start state was never rendered does not
       run at all — the figure is simply on screen, un-drawn, which is
       what a phone showed. Two frames is what the old arrivals used. */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        for (var j = 0; j < paths.length; j++) {
          paths[j].style.transition = 'stroke-dashoffset ' + FIGURE_MS + 'ms cubic-bezier(0.16, 1, 0.3, 1)';
          paths[j].style.strokeDashoffset = '0';
        }
      });
    });
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
      // The stage's own figure writes itself on with the card, on every
      // arrival — walked or merely followed by the footage. It draws the
      // stage, not a path between two stages, so it is not gated on
      // `draw` the way the line is.
      playFigure(incoming);
      // Reduced motion: the trail is simply there, all the way to the
      // card that is lit. The write-on is off (journey.css), but a
      // stroke that never appears is a different design, not the same
      // one made still.
      /* Forward draws, backward does not. The trail this replaced grew
         on every advance and shrank on every retreat, because it was a
         record of how far the journey had come. A signature is not a
         record of anything — it is the same flourish every time — so
         stepping back does not need to take it away, and stepping
         forward does not need it to accumulate. */
      if (next > prev) playDraw(lines[0]);
      /* Reduced motion releases `busy` here, synchronously, because this
         branch has already applied every class it is going to apply —
         there is no transition to wait out and no timer above to do it
         for us. Without this line `busy` is set true by stepTo and never
         cleared, so step() drops every later press and the journey
         freezes on its first card for the whole visit.

         That was not merely a cosmetic fault while the landing still
         carried a permanent "Browse the gallery" link: a visitor with
         reduce-motion set simply could not walk the journey, but they
         could still leave. With that link gone the same bug leaves them
         no route into the archive at all. */
      busy = false;
      return;
    }

    setTimeout(function () {
      if (outgoing) { outgoing.classList.remove('is-held'); outgoing.classList.add('is-out'); }
      incoming.classList.add('is-on');
      playFigure(incoming);
      /* One line, and it is the lit card's. Every other leader goes with
         the card it pointed at — a line pointing at a card nobody is
         reading is a line to nothing — so the layer holds at most one
         stroke no matter how far the journey has been walked.

         Only a walk draws it. A card changing because the footage
         free-ran past it does not, so an unwalked journey never puts a
         line on the video. */
      /* The trail the visitor has already walked is the path they took,
         so it stays. Only the strokes beyond the card just reached are
         taken back, which is what makes stepping backwards feel like
         un-walking rather than like the drawing being wrong. */
      /* Forward draws, backward does not. The trail this replaced grew
         on every advance and shrank on every retreat, because it was a
         record of how far the journey had come. A signature is not a
         record of anything — it is the same flourish every time — so
         stepping back does not need to take it away, and stepping
         forward does not need it to accumulate. */
      if (next > prev) playDraw(lines[0]);
      setTimeout(function () {
        if (outgoing) outgoing.classList.remove('is-on', 'is-out');
        busy = false;
      }, Math.max(IN_MS, OUT_MS));
    }, HOLD_MS);
  }

  /* ── The card follows the footage ───────────────────────────────
     One rule, three inputs. `at` on a stage is where in the video it
     lives, and the stage that is lit is decided by the video's own
     currentTime — so the wheel, a click and the arrow keys all arrive at
     the same place by seeking, and the card can never disagree with the
     frame behind it. Before this the video free-ran on its own clock and
     the card drifted off it, which was the one thing I could not justify
     about measuring the anchors in the first place. */
  function stepTo(next) {
    var prev = state;
    if (next === prev) return;
    busy = true;
    state = next;
    // Every path that moves the journey — click, arrow, wheel, the
    // footage free-running — lands here, so this is the one place that
    // knows the journey has been walked through: the last card lit.
    // Announced rather than recorded, because the first-visit record
    // belongs to the sibling runtime, not to the journey.
    if (next === N - 1) {
      try {
        document.dispatchEvent(new CustomEvent('walkthrough:journey-end'));
      } catch (e) {}
    }
    // Which card is lit, announced every step. journey-end says the walk
    // is over but nothing about stepping back off the last card, and the
    // landing needs that to put its centred way-in away again on a replay.
    try {
      document.dispatchEvent(new CustomEvent('walkthrough:journey-step', {
        detail: { index: next, last: N - 1 },
      }));
    } catch (e) {}
    swap(prev, next, cards[next]);
    // The outgoing card's cleanup timer inside swap() releases busy.
  }

  function step(delta) {
    if (busy) return;
    var next = state + delta;
    if (next < 0 || next > N - 1) return;
    // The stage and the footage move together, so the card can never
    // disagree with the frame behind it — including on the first click,
    // when the video is still at t=0 and stage 2 lives at 1.4s. A click
    // takes control first: otherwise the video's own clock would fight
    // the seek and the card would be overwritten a frame later.
    takeControl();
    scrubTo(STAGES[next].at, true);
  }

  function reset() {
    // Takes control too: without it the footage would keep its own clock
    // and carry the card straight back out of the first stage.
    takeControl();
    scrubTo(0, true);
    // The lines are the path taken, so a replay takes them off: a second
    // lap that starts with all six already drawn is not a walk.
    resetLines();
    if (state === 0) return;
    // The wheel interrupts a transition freely; a reset does not have to
    // wait for one, and a "Replay from the start" that took 400ms to read
    // a click would feel broken.
    busy = false;
    stepTo(0);
  }

  /* ── The wheel drives the footage ────────────────────────────────
     Scrolling scrubs the video, and the stage follows wherever it lands.
     That makes `at` live for the first time: until now the timestamps in
     STAGES were recorded and unread, because clicks could not address a
     moment in a looping video. A wheel can.

     Two decisions worth stating. The video stops looping once it is
     scrubbed — a loop that fought the wheel made the direction of travel
     unreadable — and it resumes if the visitor reloads, not on its own.
     And the wheel is coarse on purpose: one notch is ~120ms of footage,
     so a trackpad flick crosses a stage rather than skipping it, which
     would drop cards on the floor mid-transition. */
  var SCRUB_S_PER_NOTCH = 0.12;
  var scrubbing = false;
  var scrubRaf = 0;
  // A seek asked for before the duration is known, replayed once it is.
  var pendingSeek = null;
  // The previous timeupdate, to spot a loop wrapping backwards.
  var lastSeen = 0;

  // Where a given moment belongs. The stages are not evenly spaced (the
  // brief's equal division lands four of the seven between cuts), so this
  // is a lookup against the real `at` values, not a division.
  function stageAtTime(t) {
    var found = 0;
    for (var i = 0; i < N; i++) {
      if (STAGES[i].at <= t + 0.001) found = i;
    }
    return found;
  }

  function takeControl() {
    if (scrubbing) return;
    scrubbing = true;
    // Held, not paused-and-left: the wheel is the transport now, and a
    // video that kept playing under the scrub would desync from the card
    // the moment it looped.
    video.pause();
    video.loop = false;
    // The footage is no longer driving the card; the wheel is.
    video.removeEventListener('timeupdate', followFootage);
  }

  /* While the footage free-runs, the card follows it. This is the drift
     the measured anchors were for: the video used to loop on its own
     clock with card 1 lit regardless of what was actually on screen, so
     six seconds in the CLIENT card was sitting over the rack. Once the
     wheel takes over the listener comes off and the visitor decides. */
  function followFootage() {
    if (scrubbing) return;
    var t = video.currentTime;
    // A loop wrapped backwards. The trail is a record of how far the
    // journey has come, so on a second lap it is stale — strokes drawn to
    // cards that are about to be revisited. They clear, and the journey
    // starts over.
    if (t < lastSeen - 0.5) resetLines();
    lastSeen = t;
    var want = stageAtTime(t);
    // The card follows the footage even when nothing was asked of it,
    // and the stroke into it is drawn on that change too. See swap() for
    // why the old "only a walk draws a line" gate had to go.
    if (want !== state) { busy = false; stepTo(want); }
  }

  function scrubTo(t) {
    var d = video.duration;
    // Unknown duration means the metadata has not landed; the seek is
    // held rather than applied to t=0, which would look like the wheel
    // did nothing.
    if (typeof d !== 'number' || !isFinite(d) || d <= 0) { pendingSeek = t; return; }
    var next = Math.max(0, Math.min(d - 0.02, t));
    video.currentTime = next;
    // A stage boundary is where the visitor is going, not where they
    // have arrived: a card should not swap while the footage is still
    // 300ms short of it.
    var want = stageAtTime(next);
    if (want !== state) {
      // The wheel interrupts a running transition freely. A click does
      // not (step() checks busy), because two overlapping crossfades are
      // what the lockout exists to prevent.
      busy = false;
      // A wheel scrub draws: the visitor is walking the journey. The
      // card lands under their hand, so the connector belongs.
      stepTo(want);
    }
  }

  function onWheel(e) {
    // deltaMode 1 is lines, 2 is pages; both are normalised to something
    // like pixels so a notched wheel and a trackpad agree on the scale.
    var unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? window.innerHeight : 1);
    var dy = e.deltaY * unit;
    // A horizontal flick is a gesture for something else on this page.
    if (Math.abs(dy) < 1) return;
    e.preventDefault();
    takeControl();
    scrubTo(video.currentTime + (dy > 0 ? 1 : -1) * SCRUB_S_PER_NOTCH, true);
    // Coalesced: a trackpad fires many events per frame, and seeking the
    // video on each one is what makes a scrub stutter.
    if (scrubRaf) return;
    scrubRaf = requestAnimationFrame(function () { scrubRaf = 0; });
  }

  if (window.addEventListener) {
    // Not passive: preventDefault is the whole point — without it the
    // page scrolls behind the journey on a device that has room to.
    window.addEventListener('wheel', onWheel, { passive: false });
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
     Four ways in, all landing on the same rule (the card follows the
     footage): the wheel scrubs it either way, a click advances, the
     context menu rewinds, and the arrow keys walk both directions so the
     sequence is reachable without a pointer. The control stops the
     advance, or the reset button would advance as well as reset. */
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
  buildSignature();
  // Lit from the footage rather than assumed: the video may already be
  // past t=0 by the time this runs (it starts on autoplay), and card 1 is
  // only correct if the footage is actually at the start.
  state = stageAtTime(video.currentTime || 0);
  cards[state].classList.add('is-on');
  playFigure(cards[state]);
  // The opening state: one card, one figure, and the single line
  // pointing at it. playDraw is called without the state machine, so
  // under reduced motion it lands already drawn rather than waiting for
  // a walk that has not happened.
  /* Opening state: stage 0 has nothing behind it, so there is no trail
     yet. `lines[-1]` is undefined and playDraw returns early on it,
     which is exactly the behaviour wanted — one card, no line. */
  playDraw(lines[state - 1]);
  video.addEventListener('timeupdate', followFootage);

  // Cached coordinates, so this is the only thing that invalidates them.
  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    /* Nothing to rebuild on resize: the signature is an authored
       path in its own viewBox, not a measurement of the cards.
       The timer is kept because the cards themselves do move. */
    resizeTimer = setTimeout(function () {}, 120);
  });

  window.addEventListener('pagehide', function () {
    if (rafId) cancelAnimationFrame(rafId);
  });
})();