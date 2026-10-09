/* ────────────────────────────────────────────────────────────────────
   walkthrough/stages.js — the seven stages of the request journey.

   This is the LANDING. stages.js carries the seven moments of the video
   it plays, and the seven stages are also the seven stages of the
   journey a request actually makes — client to cable to patch panel to
   switch to server and back.

   Schema: index / title / copy / at / cell / anchor / figure — the
   first six describe the moment; `figure` draws it.

   `figure` is line art, not an illustration: one-weight strokes in a
   100×100 box, no fills, no colour of its own (the stylesheet owns
   that). Each path is written in the order it should appear — the
   browser window's outline before its toolbar, the tray's rails before
   the cable that hangs in it — because the drawing is animated by
   walking those paths, and the order they are written in is the order
   they are drawn in. The idiom is stroke-based: a figure writes itself
   on through its own dash offset rather than fading up as a picture.

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
    figure: ['M10 22 H90 V80 H10 Z', 'M10 38 H90', 'M22 30 h5', 'M34 30 H72'],
    copy: 'You type a web address and press Enter. Your browser creates a request — a small message asking a server for a webpage. The journey starts right here, at your computer.',
  },
  {
    index: 2,
    at: 1.404,
    title: 'CAT6A',
    cell: 'c1r2',
    anchor: { left: 25, top: 67 },
    figure: ['M8 70 C 28 70, 28 34, 48 34', 'M48 24 H78 V46 H48 Z', 'M58 46 V58', 'M68 46 V58'],
    copy: 'The request travels down a Cat6A cable. Cat6A is copper wire made to carry data quickly and reliably. Electrical signals move through the cable’s twisted pairs.',
  },
  {
    index: 3,
    at: 2.808,
    title: 'PATCH PANEL',
    cell: 'c3r2',
    anchor: { left: 75, top: 67 },
    figure: ['M8 28 H92 V76 H8 Z', 'M8 42 H92', 'M18 54 h13 v12 h-13 z', 'M40 54 h13 v12 h-13 z', 'M62 54 h13 v12 h-13 z'],
    copy: 'In a server room, cables connect into a patch panel. It’s like a switchboard — every cable has a labeled port, so technicians know exactly where each connection goes.',
  },
  {
    index: 4,
    at: 4.312,
    title: 'SWITCH',
    cell: 'c2r1',
    anchor: { left: 50, top: 33 },
    figure: ['M8 32 H92 V68 H8 Z', 'M22 50 H44', 'M38 43 L44 50 L38 57', 'M78 50 H56', 'M62 43 L56 50 L62 57'],
    copy: 'The switch reads the request’s address and decides where to send it next. It’s the traffic controller of the local network.',
  },
  {
    index: 5,
    at: 5.715,
    title: 'CEILING TRAY',
    cell: 'c0r2',
    anchor: { left: 2, top: 67 },
    figure: ['M8 38 H92 V62 H8 Z', 'M28 38 V20 H44', 'M68 38 V20 H56', 'M20 50 C 34 34, 52 66, 80 50'],
    copy: 'Cables run above the ceiling in metal trays. This is the backbone of the building’s network — hundreds of cables, organized and out of sight.',
  },
  {
    index: 6,
    at: 7.119,
    title: 'DATA CENTER',
    cell: 'c0r0',
    anchor: { left: 2, top: 4 },
    figure: ['M22 10 H78 V90 H22 Z', 'M22 32 H78', 'M22 54 H78', 'M22 76 H78', 'M14 10 V90', 'M86 10 V90'],
    copy: 'The request reaches a remote data center — a building full of servers. A server finds the webpage you asked for and prepares to send it back.',
  },
  {
    index: 7,
    at: 8.623,
    title: 'CONNECTED',
    cell: 'c1r0',
    anchor: { left: 25, top: 4 },
    figure: ['M40 32 H28 A18 18 0 0 0 28 68 H40', 'M60 32 H72 A18 18 0 0 1 72 68 H60', 'M40 50 H60'],
    copy: 'The server sends the webpage back the same way it came. Your browser receives it, and the page appears. Round trip complete.',
  },
];