/* ────────────────────────────────────────────────────────────────────
   walkthrough/stages.js — the seven stages of the request journey.

   This is the LANDING, not the deck. steps.js carries the photographic
   arc (seven static pages, one per step); stages.js carries the seven
   moments of the video the landing now plays. Both are seven long and
   they are not the same seven, which is why they are two files.

   Schema: index / title / copy / at / cell / anchor — the same shape as
   steps.js plus the two fields a video page needs that a slide does not.

   `at` is the equal division of the video's real 10.027s — 0, .14, .28,
   .43, .57, .71, .86 — so 0.000 / 1.404 / 2.808 / 4.312 / 5.715 / 7.119 /
   8.623. Measured, the video is a FIVE-shot cut sequence with cuts at
   2.500, 4.958, 6.250 and 8.708, so four of those seven land between
   cuts rather than on them. They are recorded because the brief asks for
   them and are inert: the journey is click-driven, nothing scrubs.

   `anchor` is measured, not eyeballed. Each stage's frame was sampled
   into a 4x3 grid and scored lum + 2 x cyan, so a card lands in a dark
   cell holding little of the video's own cyan light in it. `cell`
   records which, and it is always one of that frame's three safest —
   picked from those three so no two stages share a cell, because two
   cards on one anchor make the connector between them double back.
   ──────────────────────────────────────────────────────────────────── */
const STAGES = [
  {
    index: 1,
    at: 0.000,
    title: 'CLIENT',
    cell: 'c2r2',
    anchor: { left: 50, top: 67 },
    copy: 'You type a web address and press Enter. Your browser creates a request — a small message asking a server for a webpage. The journey starts right here, at your computer.',
  },
  {
    index: 2,
    at: 1.404,
    title: 'CAT6A',
    cell: 'c1r2',
    anchor: { left: 25, top: 67 },
    copy: 'The request travels down a Cat6A cable. Cat6A is copper wire made to carry data quickly and reliably. Electrical signals move through the cable’s twisted pairs.',
  },
  {
    index: 3,
    at: 2.808,
    title: 'PATCH PANEL',
    cell: 'c3r2',
    anchor: { left: 75, top: 67 },
    copy: 'In a server room, cables connect into a patch panel. It’s like a switchboard — every cable has a labeled port, so technicians know exactly where each connection goes.',
  },
  {
    index: 4,
    at: 4.312,
    title: 'SWITCH',
    cell: 'c2r1',
    anchor: { left: 50, top: 33 },
    copy: 'The switch reads the request’s address and decides where to send it next. It’s the traffic controller of the local network.',
  },
  {
    index: 5,
    at: 5.715,
    title: 'CEILING TRAY',
    cell: 'c0r2',
    anchor: { left: 2, top: 67 },
    copy: 'Cables run above the ceiling in metal trays. This is the backbone of the building’s network — hundreds of cables, organized and out of sight.',
  },
  {
    index: 6,
    at: 7.119,
    title: 'DATA CENTER',
    cell: 'c0r0',
    anchor: { left: 2, top: 4 },
    copy: 'The request reaches a remote data center — a building full of servers. A server finds the webpage you asked for and prepares to send it back.',
  },
  {
    index: 7,
    at: 8.623,
    title: 'CONNECTED',
    cell: 'c1r0',
    anchor: { left: 25, top: 4 },
    copy: 'The server sends the webpage back the same way it came. Your browser receives it, and the page appears. Round trip complete.',
  },
];