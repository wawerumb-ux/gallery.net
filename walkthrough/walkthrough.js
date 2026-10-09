/* ────────────────────────────────────────────────────────────────────
   Landing runtime (vanilla, no dependencies).

   The site used to carry a seven-step slide deck here — one static page
   per step, a thumbnail rail, and a mirrored transition across each
   page load. That layer is gone. What remains is the landing: the
   request journey that journey.js plays over the footage, plus this
   file's two jobs, neither of which belongs to the journey.

     1. the ambient node-and-link field behind everything
     2. the way into the archive — and the first-visit record that lets
        the gallery's gate (app.js, shouldRequireWalkthrough) stop
        sending visitors back here

   The journey itself — the cards, the Rough.js connectors, the
   three-depth parallax — is journey.js, reading STAGES. It owns the
   landing end to end; this file only surrounds it.
   ──────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var body = document.body;

  /* ── First-visit record ────────────────────────────────────────
     The landing is the site's front door: the gallery sends
     first-time visitors here and only stops once one of these
     values exists (app.js, shouldRequireWalkthrough). Two values,
     because they answer different questions — 'completed' is the
     whole journey watched to the end, 'skipped' is the visitor
     taking the exit, which is offered on the landing for exactly
     that reason so the gate can never trap anyone. Storage that
     throws (private mode, blocked cookies) fails open: the gallery
     sends you back here once, which is a smaller cost than locking
     the archive. */
  var SEEN_KEY = 'walkthrough.seen';
  function markSeen(value) {
    try {
      if (!localStorage.getItem(SEEN_KEY)) localStorage.setItem(SEEN_KEY, value);
    } catch (e) {}
  }

  /* ── Ambient layer ──────────────────────────────────────────────
     A deterministic field of translucent nodes and hairline links —
     identical on every load, so it costs nothing to keep and reads as
     the same space the deck used to stand in. */
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

  buildAmbient();

  /* ── The way in ──────────────────────────────────────────────────
     The landing plays the footage full-bleed with seven cards naming
     each stop, so the journey is the content and there is no title
     card to write. What it still owes the visitor is the way out,
     because the gate that sends people here cannot be allowed to trap
     them. One link, in the panel's corner, out of the footage's way. */
  function galleryUrl() { return '../index.html'; }

  function addAction(label, href, primary) {
    var host = document.getElementById('wtActions');
    if (!host) return null;
    var a = document.createElement('a');
    a.className = primary ? 'wt-cta' : 'wt-alt';
    a.href = href;
    a.textContent = label;
    host.appendChild(a);
    return a;
  }

  /* The actions host moves rather than being copied: the slot is already
     inside the landing's own control stack, where journey.css places it
     in the corner (and lays it out in flow on a phone) so the link sits
     out of the footage's way. Copying would leave the original behind
     and put the way in twice. */
  (function mountLandingBar() {
    var slot = document.getElementById('jrBarSlot');
    var actions = document.getElementById('wtActions');
    if (!slot || !actions || !actions.parentNode) return;
    var bar = document.createElement('div');
    bar.className = 'wt-landing-bar';
    bar.appendChild(actions);
    slot.appendChild(bar);
  })();

  addAction('Browse the gallery', galleryUrl(), true);

  /* Watching the journey to its last card is a finish; the link is a
     skip. Either opens the gate — the record is what the gallery reads,
     not the route taken to earn it. journey.js announces the last card
     (every path that moves the journey goes through its stepTo). */
  document.addEventListener('walkthrough:journey-end', function () { markSeen('completed'); });

  var navigating = false;
  function exitTo(href) {
    if (navigating) return;
    navigating = true;
    markSeen('skipped');
    window.location.href = href;
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a') : null;
    if (!a || !a.href) return;
    if (a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    exitTo(a.href);
  });
})();