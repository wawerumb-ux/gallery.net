/* ── steps.js — the walkthrough arc ──────────────────────────────
   The guided tour, in seven movements: site survey → final reveal.
   Schema parity with the Step contract (slug / index / title / copy /
   hero / gallery / transition). Paths are repo-root-relative; the
   runtime prefixes them per page depth. Photos are the site's own
   images/ assets — nothing is duplicated.

   `transition` is the PowerPoint-inspired slide transition that
   ARRIVES at this step, matched to what the step is about — the plan
   sheet unrolling (wipe-up), routes laid forward (push-left), bundles
   pulled down (wipe-down), arrival on one panel (zoom-in), the quiet
   verification beat (fade), pulling back for the whole assembly
   (zoom-out), and the same rack in a new shot (morph). The outgoing
   page plays the mirror of it, so the move reads as one continuous
   transition across the static page load.

   `label` is the short phase name for the deck's eyebrow and the rail's
   tooltips — one word, so it sits beside the slide number without
   crowding it.

   `accent` is a hue (0–360) that the deck's ambient wash adopts for
   this step, so the walk reads as a colour journey rather than seven
   identical pages: survey is cool slate, pulling warms to amber, the
   reveal lands warm gold. Only the wash and the mono eyebrow take the
   hue — the call to action stays the gallery's One UI blue, so the
   walkthrough never stops feeling like part of the same site.

   Edit rules: titles 3–6 words sentence case, no period; copy one
   sentence 8–16 words, no period; slugs kebab-case, unique; labels
   one word; `transition` one of fade / morph / wipe-up / wipe-down /
   push-left / push-up / zoom-in / zoom-out. Renumber `index` on every
   step after an insert or removal. */
const STEPS = [
  {
    slug: 'site-survey',
    index: 1,
    label: 'Survey',
    accent: 212,
    title: 'Before we began',
    copy: 'Every drop, pathway and rack position was walked, measured and photographed first',
    transition: 'wipe-up',
    hero: 'images/site-survey/20260619_130900-800.webp',
    gallery: [
      'images/site-survey/20260619_142909-800.webp',
      'images/site-survey/20260621_122646-800.webp',
      'images/site-survey/20260621_122715-800.webp',
    ],
  },
  {
    slug: 'infrastructure',
    index: 2,
    label: 'Containment',
    accent: 190,
    title: 'Pathways and containment',
    copy: 'Routes for every bundle were fixed on the plan before a cable was pulled',
    transition: 'push-left',
    hero: 'images/site-survey-map/20260619_130848-800.webp',
    gallery: [
      'images/site-survey-map/20260619_130849-800.webp',
      'images/site-survey-map/20260619_130850-800.webp',
    ],
  },
  {
    slug: 'cabling',
    index: 3,
    label: 'Pulling',
    accent: 34,
    title: 'Pulling and dressing',
    copy: 'Bundles came down in sequence and were dressed into the tray',
    transition: 'wipe-down',
    hero: 'images/cable-pull/20260621_122750-800.webp',
    gallery: [
      'images/cable-pull/20260621_122823-800.webp',
      'images/cable-pull/20260621_122911-800.webp',
      'images/cable-pull/20260621_123006-800.webp',
    ],
  },
  {
    slug: 'termination',
    index: 4,
    label: 'Termination',
    accent: 262,
    title: 'Termination at the panel',
    copy: 'Each pair landed on the panel and dressed to the back bar',
    transition: 'zoom-in',
    hero: 'images/termination-testing/20260621_123503-800.webp',
    gallery: [
      'images/termination-testing/20260621_123517-800.webp',
      'images/termination-testing/20260621_123529-800.webp',
      'images/termination-testing/20260621_123558-800.webp',
    ],
  },
  {
    slug: 'testing',
    index: 5,
    label: 'Testing',
    accent: 150,
    title: 'Testing and certification',
    copy: 'Every link passed certification before the rack went live',
    transition: 'fade',
    hero: 'images/termination-testing/20260621_172314-800.webp',
    gallery: [
      'images/termination-testing/20260621_172336-800.webp',
      'images/termination-testing/20260621_172403-800.webp',
      'images/termination-testing/20260621_172424-800.webp',
    ],
  },
  {
    slug: 'rack-build',
    index: 6,
    label: 'Assembly',
    accent: 20,
    title: 'The rack build',
    copy: 'Panels, switches and management went in as one assembly',
    transition: 'zoom-out',
    hero: 'images/rack-build/20260624_161332-800.webp',
    gallery: [
      'images/rack-build/20260623_163934-800.webp',
      'images/rack-build/20260624_161339-800.webp',
      'images/phase-1/IMG-20260726-WA0001-800.webp',
    ],
  },
  {
    slug: 'final-reveal',
    index: 7,
    label: 'Handover',
    accent: 42,
    title: 'The final result',
    copy: 'A labelled and tested plant, ready for handover',
    transition: 'morph',
    hero: 'images/rack-build/20260805_163731-800.webp',
    gallery: [
      'images/rack-build/20260805_164143-800.webp',
      'images/rack-build/20260805_164146-800.webp',
      'images/rack-build/20260805_160909-800.webp',
    ],
  },
];
