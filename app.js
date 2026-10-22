/* ── Fill these in once your repo exists ─────────────────────────
   owner: your GitHub username or org, e.g. 'jdoe'
   repo:  the repo name, e.g. 'networking-project-archive'
   branch: the branch GitHub Pages serves, usually 'main'
   imagesPath: the folder in the repo that holds one subfolder per phase
──────────────────────────────────────────────────────────────── */
const CONFIG = {
  owner: 'wawerumb-ux',
  repo: 'gallery.net',
  branch: 'main',
  imagesPath: 'images',
};
/* ──────────────────────────────────────────────────────────────── */

// While owner/repo are blank, the site runs on local sample data so you can
// test every feature before a real repo exists. Fill in CONFIG above and
// this switches off automatically.

/* ── The gallery ──────────────────────────────────────────────────────
   One closure, one private scope — the shape the vendored toast library
   uses. Everything below (the journey model, the repo client, the
   renderers, the admin tools) is private to it; nothing reaches `window`
   except the deliberate surface returned at the foot. The guided tour
   reads that surface, and so does the test suite, which is why it lists
   what it needs rather than reaching into the module.

   The body is wrapped, not reindented, and that is deliberate: the
   renderers build markup in template literals whose bytes are the
   markup, and the closing `];` of each top-level table has to stay on
   column 0 for the tests that slice this file to find it. */
const gallery = (() => {

const DEMO_MODE = !CONFIG.owner || !CONFIG.repo;

/* ── Classify vs sort ────────────────────────────────────────────
   Two separate problems with two separate chains, so human intent is
   never silently overridden.

   CLASSIFY (what a photo documents → stage + activity):
     1. gallery.json override         — what an admin assigned (explicit)
     2. IDENTITY_RULES filename       — strong: identity, wins over folder
     3. the folder it lives in        — strong: files document that stage
        (FOLDER_STAGES)                site-survey → 01, cable-pull → 04,
                                       rack-build & phase-1 → 06,
                                       termination-testing → 10
     4. DATE_WINDOWS                  — weak: NEVER moves/overrides an
                                       existing folder, only places strays
     5. nothing left                  — Needs Review (virtual flag, no move)

   SORT (which folder a file physically lives in):
     Only strays are ever moved (by identity or date), plus identity
     re-files. Date windows never move a filed photo; manual overrides
     never move files — they only change classification.
─────────────────────────────────────────────────────────────────── */

// The structured-cabling lifecycle the gallery tells, in journey order.
const JOURNEY = [
  { sequence: 1,  stage: 'Site Survey & Planning',          group: 'PLAN' },
  { sequence: 2,  stage: 'Materials & Equipment',           group: 'PREPARE' },
  { sequence: 3,  stage: 'Pathways & Containment',          group: 'BUILD' },
  { sequence: 4,  stage: 'Cable Installation',              group: 'BUILD' },
  { sequence: 5,  stage: 'Cable Routing & Management',      group: 'ORGANIZE' },
  { sequence: 6,  stage: 'Rack / Cabinet Installation',     group: 'TERMINATE' },
  { sequence: 7,  stage: 'Patch Panels & Termination',      group: 'TERMINATE' },
  { sequence: 8,  stage: 'Outlet / Faceplate Installation', group: 'TERMINATE' },
  { sequence: 9,  stage: 'Labelling & Identification',      group: 'IDENTIFY' },
  { sequence: 10, stage: 'Testing & Certification',         group: 'TEST' },
  { sequence: 11, stage: 'Network Integration',             group: 'CONNECT' },
  { sequence: 12, stage: 'Final Inspection & Handover',     group: 'COMPLETE' },
];

// Physical folders the gallery manages → their place in the journey.
// Every real album needs a row here. A folder with no row is not an error
// — the photo still shows — but it can never be classified: uploads into
// it write no metadata, and existing photos in it stay on "Needs review"
// forever. Six of the ten albums in the repo were missing, which left 233
// of 335 photos unable to save a classification.
//
// "General" is deliberately absent and should stay that way. It is a
// catch-all for photos that belong to no particular stage, so giving it
// one would invent a classification for whatever lands in it.
const FOLDER_STAGES = {
  'site-survey':                  1,  // Site Survey & Planning
  'materials-and-equipments':     2,  // Materials & Equipment — same name
  'cable-pull':                   4,  // Cable Installation
  'trunking-installation':        5,  // Cable Routing & Management
  'rack-build':                   6,  // Rack / Cabinet Installation
  'phase-1':                      6,  // WhatsApp batch — rack installation work (user-confirmed)
  'server-rack-build':            6,  // rack work, same stage as rack-build
  'labelling-and-identification': 9,  // Labelling & Identification — same name
  'termination-testing':         10,  // Testing & Certification
  'site-survey-map':              1,  // the map that came out of the survey
};

// Optional activity hints from the file name. First match wins.
//   { id, pattern, folder, activity }
// e.g. { id: 'patch-panel', pattern: /patch[- ]?panel/i, folder: 'rack-build', activity: 'Rack Assembly' }
const IDENTITY_RULES = [
  { id: 'whatsapp-batch', pattern: /^IMG-\d{8}-WA/i, folder: 'phase-1', activity: 'WhatsApp photo' },
];

// Weak date windows — stray filing and upload prefill only.
const DATE_WINDOWS = [
  { folder: 'site-survey',          from: '2026-06-19', to: '2026-06-20' },
  { folder: 'cable-pull',           from: '2026-06-21', to: '2026-06-21' },
  { folder: 'termination-testing',  from: '2026-06-22', to: '2026-06-24' },
  { folder: 'rack-build',           from: '2026-06-25', to: '2026-08-05' },
  { folder: 'phase-1',              from: '2026-07-26', to: '2026-07-26' },
];

const JOURNEY_BY_SEQUENCE = new Map(JOURNEY.map(j => [j.sequence, j]));

/* A physical folder → its journey stage, or null if unknown. */
function journeyFor(folder) {
  const seq = FOLDER_STAGES[folder];
  return seq ? JOURNEY_BY_SEQUENCE.get(seq) : null;
}

/* Physical folder → journey position; unknown folders trail everything. */
function folderSequence(folder) {
  return FOLDER_STAGES[folder] ?? Number.MAX_SAFE_INTEGER;
}

/* YYYYMMDD (phone camera) or IMG-YYYYMMDD- (WhatsApp) → 'YYYY-MM-DD' */
function extractPhotoDate(name) {
  const m = name.match(/^(\d{4})(\d{2})(\d{2})/) || name.match(/^IMG-(\d{4})(\d{2})(\d{2})/i);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/* '20260621_122750' or 'IMG-20260621-WA0001' → numeric timestamp (for photo
   order). Both branches normalize to 14 digits (YYYYMMDD + 6-digit tail): the
   WhatsApp sequence counter is start-of-day-ish, so it's padded right —
   otherwise a 12-digit value sorts below every camera photo ever taken. */
function photoTs(name) {
  const m = name.match(/^(\d{8})_(\d{6})/) || name.match(/^IMG-(\d{8})-WA(\d{4})/i);
  if (m) return parseInt(m[1] + (m[2] || '000000').padEnd(6, '0'), 10);
  return 0;
}

/* Best-guess physical folder for a bare file name (identity → date window).
   Identity rules are identity signals, so they always win; date windows
   are weaker and resolve by ordered priority when ranges overlap. */
function suggestPhase(name) {
  const identity = IDENTITY_RULES.find(rule => rule.pattern.test(name));
  if (identity) return identity.folder;
  const date = extractPhotoDate(name);
  for (const rule of DATE_WINDOWS) {
    if (date && rule.from && date >= rule.from && date <= rule.to) return rule.folder;
  }
  return null;
}

function isConfigPhase(folder) {
  return folder in FOLDER_STAGES;
}

/* The label an album presents to a person.

   A journey stage only names an album when it identifies one. Three
   folders share "Rack / Cabinet Installation" and two share "Site Survey
   & Planning"; two identically-titled albums in one grid is worse than
   showing the folder name. Where a stage is shared, the folder name
   wins — it is unique, and it is what rename, move and delete address
   anyway, so the two never disagree.

   The test runs against the live album set rather than a hand-kept list,
   so a new album landing on an occupied stage cannot quietly reintroduce
   the collision. Classification is unaffected either way: that reads
   journeyFor() directly and keeps the shared stage name. */
function albumStageName(folder) {
  const j = journeyFor(folder);
  if (!j) return folder;
  for (const other of state.order) {
    if (other === folder) continue;
    const o = journeyFor(other);
    if (o && o.stage === j.stage) return folder;
  }
  return j.stage;
}

/* A gallery item carries {path, sha, name} — the folder is derivable. */
function imgFolder(img) {
  return img.folder || (img.path ? img.path.split('/').slice(-2, -1)[0] : null);
}

/* Classify a photo: what stage of the journey it documents, plus the
   evidence behind that call. Needs Review is a virtual flag — this never
   moves anything and never invents an activity. */
function classifyPhoto(img) {
  const md = state.metadata[img.path];
  if (md && md.phase) {
    const j = JOURNEY.find(s => s.stage === md.phase);
    // Only a real journey stage counts as an explicit classification. A
    // legacy/non-journey label (e.g. an old "General" entry) falls through so
    // the photo can still surface as Needs Review rather than being locked
    // into a label that isn't a project stage.
    if (j) {
      return {
        stage: md.phase,
        group: j.group,
        sequence: j.sequence,
        activity: md.activity || null,
        reason: 'manual assignment',
        rule: 'gallery.json override',
        confidence: 'explicit',
        needsReview: false,
      };
    }
  }
  const identity = IDENTITY_RULES.find(rule => rule.pattern.test(img.name));
  if (identity) {
    const j = journeyFor(identity.folder);
    return {
      stage: j ? j.stage : null,
      group: j ? j.group : null,
      sequence: j ? j.sequence : null,
      activity: identity.activity || null,
      reason: 'filename identity',
      rule: identity.id,
      confidence: 'strong',
      needsReview: !j,
    };
  }
  const folderJ = journeyFor(imgFolder(img));
  if (folderJ) {
    return {
      stage: folderJ.stage,
      group: folderJ.group,
      sequence: folderJ.sequence,
      activity: null,
      reason: 'file lives in the stage folder',
      rule: 'folder ' + imgFolder(img),
      confidence: 'strong',
      needsReview: false,
    };
  }
  const dateMatch = DATE_WINDOWS.find(rule => {
    const d = extractPhotoDate(img.name);
    return d && rule.from && d >= rule.from && d <= rule.to;
  });
  if (dateMatch) {
    const j = journeyFor(dateMatch.folder);
    return {
      stage: j ? j.stage : null,
      group: j ? j.group : null,
      sequence: j ? j.sequence : null,
      activity: null,
      reason: 'date window (stray only)',
      rule: 'date → ' + dateMatch.folder,
      confidence: 'weak',
      needsReview: true,
      suggestedFolder: dateMatch.folder,
    };
  }
  return {
    stage: null, group: null, sequence: null, activity: null,
    reason: 'no evidence', rule: null, confidence: 'none', needsReview: true,
  };
}

/* One-line summary of a classification, for the sort preview. */
function clsLabel(c) {
  const bits = [c.stage || 'Unclassified'];
  if (c.group) bits.push(c.group);
  if (c.activity) bits.push(c.activity);
  bits.push(c.confidence + ' · ' + c.reason);
  return bits.join(' · ');
}

/* Every folder the upload dropdown should offer. */
function allPhaseOptions(extra) {
  const opts = new Set(state.order);
  Object.keys(FOLDER_STAGES).forEach(folder => opts.add(folder));
  opts.add('General');
  if (extra) opts.add(extra);
  return [...opts];
}

const IMG_EXT = /\.(png|jpe?g|gif|webp|avif)$/i;
const TOKEN_KEY = 'sn_gallery_token';
// Reserved key in gallery.json that holds the one active admin session, so
// only one admin can be signed in at a time across every visitor. It never
// collides with a real image path (those live under images/).
const ADMIN_SESSION_KEY = '__admin_session__';

const state = {
  folders: {},   // folderName -> [{ path, name, sha }] (one canonical item per logical asset)
  order: [],
  assets: [],    // [{ id, folder, items, canonical, variants, exactDuplicate, sha256 }]
  duplicateSummary: { totalFiles: 0, uniqueAssets: 0, exactDuplicateFiles: 0, visualDuplicateCandidates: 0 },
  adminMode: false,
  token: null,
  adminSession: null, // { since } — the one active admin session, shared lock
  view: 'images', // 'images' = Pictures tab (day-grouped wall), 'phases' = Albums tab
  viewSize: 'comfy',    // the search pill's panel: how many tiles a row holds, and
  viewOrder: 'newest',  // ...which way the wall runs
  picturesList: [],   // flat [{img, folder, index}] in view order — the Pictures tab order
  _tabScroll: {},     // per-tab scroll positions, restored on tab switch
  albumDetail: null,  // phase folder opened inline (Albums tab → photo grid)
  _albumScroll: 0,    // Albums-grid scroll, restored when the detail closes
  _suppressClickUntil: 0, // a long-press that opened selection swallows its trailing click
  batchSelect: false, // gallery card-selection mode (sort flow)
  batchSelected: new Set(), // paths of the photos the admin picked

  lightboxFolder: null,
  lightboxIndex: 0,
  pendingUploads: null, // { files: File[], context: folderName|null }
  metadata: {},  // fullRepoPath -> { phase, activity, visual? } (manual overrides)
  _metaHash: null, // last persisted metadata JSON, to avoid no-op writes
  // The sha of gallery.json as last seen. GitHub's Contents API needs the
  // current sha to update an existing path, and without one it rejects the
  // PUT with 422 — so an uncached save was three round trips (PUT rejected,
  // GET to read the sha, PUT again). Holding it makes the happy path one.
  // A stale value answers 409, and githubPut already re-reads and retries,
  // so a cache that has gone out of date costs a round trip, not a failure.
  _metaSha: null,
  taggingPath: null,
};

const el = (id) => document.getElementById(id);

/* The guided tour reads the live admin sign-in state through
   this getter (tour/boot.js): a tour that starts signed in
   walks the admin tool set; one that starts signed out never
   sees those steps. Read once, at tour start. */

// Loading status: "loading images..." + Arch-style ASCII progress bar.
const LOAD_PROG_WIDTH = 24;
/* How long the loading card takes to fade once every image is in. Long
   enough to read as a fade rather than a cut. */
const GATE_FADE_MS = 320;
/* The eager images are already decoded by then, so the card is not worth
   keeping around. A slow first paint gets this grace before it goes. */
const GATE_HOLD_MS = 6000;
const loadProg = {
  _pct: 0,
  _images: 0,
  _loaded: 0,
  _scheduled: false,
  set(pct) {
    this._pct = Math.max(0, Math.min(100, Math.round(pct)));
    this._draw();
  },
  imageCount(n) { this._images = n; },
  imageLoaded() {
    this._loaded++;
    const pct = this._images ? 74 + Math.min(24, Math.round((this._loaded / this._images) * 24)) : 98;
    if (pct >= 98) this.finish();
    else this.set(pct);
  },
  _draw() {
    const bar = el('loadingBar');
    const gate = el('loadingState');
    if (!bar || !gate || gate.hidden) return;
    const fill = Math.round((LOAD_PROG_WIDTH * this._pct) / 100);
    const chars = (this._pct >= 100 ? '=' : '#').repeat(fill) + '-'.repeat(LOAD_PROG_WIDTH - fill);
    bar.textContent = `[${chars}] ${String(this._pct).padStart(3, ' ')}%`;
  },
  finish(delay = 0) {
    if (this._scheduled) return;
    this.set(100);
    this._scheduled = true;
    setTimeout(() => {
      const gate = el('loadingState');
      if (!gate || gate.hidden) return;
      gate.style.opacity = '0';
      setTimeout(() => { gate.hidden = true; gate.style.opacity = ''; }, GATE_FADE_MS);
    }, delay);
  },
};

// Fetch timeout in milliseconds
const FETCH_TIMEOUT = 10000;
// Backoff between retries of a transient GitHub failure (ms,
// scaled by attempt number)
const FETCH_RETRY_BACKOFF = 700;

// Rate limit warning threshold
const RATE_LIMIT_WARNING = 20;

// GitHub API rate limit state
let rateLimitReset = 0;

// Abort controller for in-flight requests
let abortController = null;

// Cleanup function for aborting requests
function cancelRequests() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
}

// Helper: fetch with timeout, rate limit tracking and a short
// retry on transient GitHub failures. Only unauthenticated
// requests are throttled — a PAT rides a separate quota,
// so a stalling public rate limit must never block signing in
// or uploads.
async function githubFetch(url, options = {}) {
  const authHeader = options.headers && (options.headers.Authorization || options.headers.authorization);
  const authed = !!authHeader;

  // Check if we should throttle due to rate limits
  if (!authed && rateLimitReset > Date.now() / 1000) {
    const waitMs = (rateLimitReset - Date.now() / 1000) * 1000 + 1000;
    showToast(`GitHub rate limit reached — waiting ${Math.round(waitMs / 1000)}s...`, { type: 'warning', sticky: true });
    await new Promise(r => setTimeout(r, waitMs));
    dismissToast();
  }

  // GitHub's API occasionally hiccups (5xx, network blips).
  // Two retries with a short backoff ride those out — a single
  // 500 must not dead-end the whole gallery. 4xx (bad
  // owner/repo/branch, bad token) and aborts fail fast.
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    abortController = controller;

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      abortController = null;

      // Track rate limits. Only arm the auto-wait when an unauthenticated call
      // is actually exhausted; a healthy response's reset time is the *quota*
      // reset (up to an hour away) and must not stall the next request.
      const remaining = res.headers.get('X-RateLimit-Remaining');
      const reset = res.headers.get('X-RateLimit-Reset');
      if (remaining !== null) {
        const remainingNum = parseInt(remaining);
        const resetNum = parseInt(reset) || 0;
        const exhausted = resetNum > 0 && (remainingNum === 0 || res.status === 403 || res.status === 429);
        if (exhausted && !authed) {
          rateLimitReset = resetNum;
        } else {
          rateLimitReset = 0;
          if (remainingNum < RATE_LIMIT_WARNING && remainingNum > 0) {
            const resetDate = new Date(resetNum * 1000);
            console.warn(`GitHub rate limit: ${remainingNum} requests remaining, resets at ${resetDate}`);
          }
        }
      }

      if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, FETCH_RETRY_BACKOFF * attempt));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      abortController = null;
      // Network blips are worth another try; aborts (timeouts,
      // page-unload cancels) are not.
      if (err.name !== 'AbortError' && attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, FETCH_RETRY_BACKOFF * attempt));
        continue;
      }
      if (err.name === 'AbortError') {
        throw new Error('Request timed out after ' + FETCH_TIMEOUT / 1000 + 's');
      }
      throw err;
    }
  }
}

/* ── The walkthrough gate ──────────────────────────────────────
   First visit goes to /walkthrough/, which is the site's front
   door; every later visit goes straight to the archive. The record
   is written by the walkthrough runtime (walkthrough.seen), which
   distinguishes 'completed' from 'skipped' — both open the gate,
   because the gate's only job is "has this visitor been offered the
   walkthrough", not "did they finish it".

   Two deliberate escapes. `?tour=1` is not optional: tour/boot.js
   already uses it to arm the engine, and a deep link there must not
   be swallowed by a redirect that only exists to be undone a second
   later. And storage that throws means we cannot know, so we assume
   the visitor has been here before and let them through — a gate
   that locks the archive shut when the browser refuses to remember
   anything is a worse bug than a gate that opens once too often. */
const WALKTHROUGH_SEEN_KEY = 'walkthrough.seen';

/* ── Welcome back ─────────────────────────────────────────────────
   The walkthrough records 'completed' when the journey reaches its
   last card and 'skipped' when the visitor takes the exit link. Only a
   completion earns this panel — someone who skipped the journey has not
   seen the thing the panel is congratulating them on, and showing it
   anyway would make the archive feel like it is talking to a stranger.

   It shows once. Dismissal is remembered under its own key rather than
   by rewriting walkthrough.seen, because that record is the gate's and
   is read as 'did they finish it', not as 'what have they been shown'. */
const WELCOME_KEY = 'gallery.welcome.dismissed';

function walkthroughCompleted() {
  try { return localStorage.getItem(WALKTHROUGH_SEEN_KEY) === 'completed'; }
  catch (_) { return false; }            // cannot know — stay quiet
}
function welcomeDismissed() {
  try { return localStorage.getItem(WELCOME_KEY) === '1'; }
  catch (_) { return true; }             // cannot remember — do not pester
}
function closeWelcome() {
  const panel = el('welcomePanel');
  if (panel) panel.hidden = true;
  try { localStorage.setItem(WELCOME_KEY, '1'); } catch (_) {}
}
function maybeShowWelcome() {
  const panel = el('welcomePanel');
  if (!panel || !walkthroughCompleted() || welcomeDismissed()) return;
  const total = Object.values(state.folders || {}).reduce((a, f) => a + f.length, 0);
  const count = el('welcomeCount');
  if (count) {
    count.textContent = total
      ? `${total.toLocaleString()} photo${total === 1 ? '' : 's'}`
      : 'every photo';
  }
  panel.hidden = false;
}
function wireWelcome() {
  const panel = el('welcomePanel');
  const card = el('welcomeCard');
  if (!panel || !card) return;
  // Click turns the card. It is a button, so Enter and Space do the same
  // thing without any key handling of our own.
  card.addEventListener('click', () => card.classList.toggle('is-flipped'));
  el('welcomeDismiss').addEventListener('click', closeWelcome);
}

function shouldRequireWalkthrough(search) {
  const query = search !== undefined ? search
    : (typeof location !== 'undefined' ? location.search : '');
  if (/[?&]tour=1(&|$)/.test(query)) return false;
  // ?stay=1 is the way back into the archive without being handed off —
  // a deep link, or a reload that interrupted real work in the middle.
  if (/[?&]stay=1(&|$)/.test(query)) return false;
  let seen = true;
  try {
    seen = !!localStorage.getItem(WALKTHROUGH_SEEN_KEY);
  } catch (_) {
    return false; // cannot know — fail open
  }
  if (!seen) return true;
  // A reload is a request to start again rather than to resume, so it
  // hands off. Browsers do not tell the page which kind of reload it was:
  // F5 and Ctrl/Cmd+Shift+R both arrive as navigation type "reload", so
  // this catches hard refreshes and ordinary ones alike — there is no way
  // to tell them apart from here.
  try {
    if (typeof performance === 'undefined' || !performance.getEntriesByType) return false;
    const nav = performance.getEntriesByType('navigation')[0];
    return !!(nav && nav.type === 'reload');
  } catch (_) {
    return false;
  }
}

/* ── Eye-comfort backgrounds ──────────────────────────────────────
   Eleven canvases, each carrying its whole palette. Seven are dark —
   pure black is the default and the rest trade OLED contrast for lower
   luminance and a different cast: warms (sepia, amber, clay), earths
   (olive), greens (sage, fern) and a violet (plum). Three are light
   (bone, linen, mint) for bright rooms, where a black page is itself
   the glare.

   A theme is not a background colour. style.css keeps every value a
   theme can touch in a token — canvas, surfaces, ink, hairlines, and
   the chrome (hover plates, scrims, shadows, scrollbar, FAB halo) —
   so picking one repaints the whole interface. The chrome that sits on
   a photograph is a separate family the themes leave alone; the viewer
   and the album badges stay dark because the surface under them is an
   image, not the page.

   Each canvas comes from one of the ten most recent Color Hunt
   submissions; the chip and chrome values below are the same colours
   the stylesheet ramps down to, so the swatch in the picker and the
   page it sets agree. A stored id that is no longer in this list (the
   five themes this set replaced) falls back to pure black.

   The choice lives on <html data-theme>, which is how style.css
   re-points the whole token set. Storage that throws (private mode,
   blocked cookies) must not break the archive, so reads and writes
   are guarded and fall back to pure black — the same fail-open shape
   the walkthrough gate uses at shouldRequireWalkthrough(). */
const COMFORT_KEY = 'gallery.comfort';
const COMFORT_THEMES = [
  { id: 'oled',     label: 'Pure black', hint: 'OLED dark',     chip: '#000000', chrome: '#000000' },
  { id: 'sepia',    label: 'Sepia',         hint: 'Warm reading',        chip: '#392d1e', chrome: '#1c140b' },
  { id: 'amber',    label: 'Amber',         hint: 'No blue light',       chip: '#2f2415', chrome: '#140d04' },
  { id: 'clay',     label: 'Clay',          hint: 'Warm red',            chip: '#2a1913', chrome: '#0f0503' },
  { id: 'olive',    label: 'Olive',         hint: 'Muted earth',         chip: '#191b0a', chrome: '#040500' },
  { id: 'sage',     label: 'Sage',          hint: 'Green cast',          chip: '#2c382a', chrome: '#151d14' },
  { id: 'fern',     label: 'Fern',          hint: 'Deep green',          chip: '#1e3027', chrome: '#091610' },
  { id: 'plum',     label: 'Plum',          hint: 'Soft violet',         chip: '#372835', chrome: '#1b111a' },
  { id: 'bone',     label: 'Bone',          hint: 'Warm light',          chip: '#eaddd3', chrome: '#fbf1ea' },
  { id: 'linen',    label: 'Linen',         hint: 'Parchment',           chip: '#e5dfd1', chrome: '#ece8de' },
  { id: 'mint',     label: 'Mint',          hint: 'Pale light',          chip: '#dce2d4', chrome: '#f9fef4' },
];
const COMFORT_DEFAULT = 'oled';
const COMFORT_BY_ID = new Map(COMFORT_THEMES.map(t => [t.id, t]));
let comfortTheme = COMFORT_DEFAULT;

function storedComfortTheme() {
  try {
    const id = localStorage.getItem(COMFORT_KEY);
    return COMFORT_BY_ID.has(id) ? id : COMFORT_DEFAULT;
  } catch (_) {
    return COMFORT_DEFAULT; // cannot remember — ship the default
  }
}

function applyComfortTheme(id, persist) {
  const theme = COMFORT_BY_ID.get(id) || COMFORT_BY_ID.get(COMFORT_DEFAULT);
  comfortTheme = theme.id;
  // Pure black is the stylesheet's own default, so it carries no
  // attribute — that keeps the untouched archive byte-identical.
  // The root element is optional: the headless test harnesses load
  // this file against a partial document, and a display preference
  // must never be the reason one of them throws.
  const root = document.documentElement;
  if (root) {
    if (theme.id === COMFORT_DEFAULT) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme.id);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme.chrome);
  const btn = el('comfortBtn');
  if (btn) {
    const on = theme.id !== COMFORT_DEFAULT;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', on ? `Eye-comfort background — ${theme.label}` : 'Eye-comfort background');
    btn.setAttribute('title', btn.getAttribute('aria-label'));
  }
  if (persist) {
    try { localStorage.setItem(COMFORT_KEY, theme.id); } catch (_) {}
  }
  if (el('comfortGrid')) renderComfortGrid();
  return theme;
}

function renderComfortGrid() {
  const grid = el('comfortGrid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const theme of COMFORT_THEMES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'comfort-swatch' + (theme.id === comfortTheme ? ' is-active' : '');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', theme.id === comfortTheme ? 'true' : 'false');
    b.dataset.comfort = theme.id;
    // The guided tour points at the swatches, not the button that opens the
    // picker — picking a background is the real action, and the step that
    // opens the picker has already been taken by then.
    b.setAttribute('data-tour-target', 'comfort-pick');
    b.innerHTML =
      `<span class="comfort-chip" style="background:${theme.chip}"></span>` +
      `<span class="comfort-label">${theme.label}</span>` +
      `<span class="comfort-hint">${theme.hint}</span>`;
    b.addEventListener('click', () => {
      // Same order as the typeface picker: dismiss, then confirm, so a
      // missing toast host cannot strand the sheet open.
      applyComfortTheme(theme.id, true);
      closeComfortPicker();
      showToast(`Background — ${theme.label}`, { type: 'info' });
    });
    grid.appendChild(b);
  }
}

function openComfortPicker() {
  renderComfortGrid();
  overlayPush('comfortOverlay', closeComfortPicker);
  el('comfortOverlay').hidden = false;
}

const closeComfortPicker = () => { el('comfortOverlay').hidden = true; };
/* Same dismissal contract as the typeface popover: a tap on the modal
   screen closes, a tap on the panel does not. Escape and the back button
   already route through overlayStack. */
function wireComfortPopover() {
  const overlay = el('comfortOverlay');
  if (!overlay) return;
  overlay.addEventListener('pointerdown', e => {
    if (e.target === overlay) overlayClose('comfortOverlay');
  });
}

/* ── Typeface ──────────────────────────────────────────────────────
   Samsung's S10 runs One UI on SamsungOne, which cannot be shipped — it
   is a system font licensed to the handset — so the way to get the
   Galaxy's own typography is to ask the device for the one it already
   has: system-ui resolves to SamsungOne on a Galaxy and to Segoe or San
   Francisco everywhere else, at no download cost. That is the option the
   picker leads with, and it is the reason it is worth offering at all.

   The style names come from LingoJam's text-style generator, which is
   where the vocabulary was sourced — bold, italic, bold italic, cursive,
   monospace, small caps, gothic/fraktur, old English, double-struck,
   circled. The faces behind those names do not: LingoJam publishes no
   font files at all. Its "fonts" are Unicode symbol mappings (the
   Mathematical Bold Italic and neighbouring blocks), which only render
   as styled text on a device that happens to cover those ranges and
   show as tofu squares where it does not. So every name here is backed
   by a real, properly-licensed face from Google Fonts, which is where
   this archive already gets Roboto and IBM Plex Mono from.

   Only --font-sans is touched. The mono stack is not offered — the
   filenames, counts and load bars in this interface read as code in any
   of them, and a script set over them would be unreadable.

   Nothing loads up front. The archive ships a render-blocking Google
   Fonts stylesheet for Roboto and IBM Plex Mono; every face below is
   appended at the moment it is first wanted, so a visitor who never
   opens the picker pays nothing for any of it.
   font files at all. Its "fonts" are Unicode symbol mappings (the
   Mathematical Bold Italic and neighbouring blocks), which only render
   as styled text on a device that happens to cover those ranges and
   show as tofu squares where it does not. So every name here is backed
   by a real, properly-licensed face from Google Fonts, which is where
   this archive already gets Roboto and IBM Plex Mono from.

   Only --font-sans is touched. The mono stack is not offered — the
   filenames, counts and load bars in this interface read as code in any
   of them, and a script set over them would be unreadable.

   Nothing loads up front. The archive ships a render-blocking Google
   Fonts stylesheet for Roboto and IBM Plex Mono; every face below is
   appended at the moment it is first wanted, so a visitor who never
   opens the picker pays nothing for any of it. */
const FONT_KEY = 'gallery.font';

/* `spec` is the Google Fonts css2 axis/weight query for the family.
   Without it the browser is told to synthesise the weights this
   interface uses at 500 and 700, which is how a webfont ends up looking
   smeared. The two blackletter faces ship a single weight, so they get
   no spec and are labelled display: the bold on those is the browser
   faking it, and pretending otherwise would be a lie. */
const FONTS = [
  { id: 'roboto', label: 'Roboto', note: 'the default', style: 'regular',
    stack: "'Roboto', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif" },
  { id: 'oneui', label: 'One UI Sans', note: 'SamsungOne on Galaxy', style: 'regular',
    stack: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  { id: 'archivo', label: 'Archivo', note: 'bold', style: 'bold',
    stack: "'Archivo', system-ui, sans-serif", webfont: 'Archivo', spec: 'wght@400;500;700' },
  { id: 'lora', label: 'Lora', note: 'italic', style: 'italic',
    stack: "'Lora', Georgia, serif", webfont: 'Lora', spec: 'ital,wght@0,400;0,500;0,700;1,400;1,500;1,700' },
  { id: 'playfair', label: 'Playfair Display', note: 'bold italic', style: 'bold italic',
    stack: "'Playfair Display', Georgia, serif", webfont: 'Playfair Display', spec: 'ital,wght@0,500;0,700;1,500;1,700' },
  { id: 'dancing', label: 'Dancing Script', note: 'cursive', style: 'cursive',
    stack: "'Dancing Script', cursive", webfont: 'Dancing Script', spec: 'wght@400;500;700' },
  { id: 'spacemono', label: 'Space Mono', note: 'monospace', style: 'monospace',
    stack: "'Space Mono', ui-monospace, Menlo, monospace", webfont: 'Space Mono', spec: 'wght@400;700' },
  { id: 'alegreyasc', label: 'Alegreya Sans SC', note: 'small caps', style: 'small caps',
    stack: "'Alegreya Sans SC', system-ui, sans-serif", webfont: 'Alegreya Sans SC', spec: 'wght@400;500;700' },
  { id: 'unifraktur', label: 'UnifrakturMaguntia', note: 'gothic · display', style: 'gothic / fraktur',
    stack: "'UnifrakturMaguntia', 'Old English Text MT', serif", webfont: 'UnifrakturMaguntia' },
  { id: 'pirata', label: 'Pirata One', note: 'old English · display', style: 'old English',
    stack: "'Pirata One', 'Old English Text MT', serif", webfont: 'Pirata One' },
  { id: 'josefin', label: 'Josefin Sans', note: 'double-struck', style: 'double-struck',
    stack: "'Josefin Sans', system-ui, sans-serif", webfont: 'Josefin Sans', spec: 'wght@400;500;700' },
  { id: 'outfit', label: 'Outfit', note: 'circled', style: 'circled',
    stack: "'Outfit', system-ui, sans-serif", webfont: 'Outfit', spec: 'wght@400;500;700' },
];
const FONT_DEFAULT = 'roboto';
const FONT_BY_ID = new Map(FONTS.map(f => [f.id, f]));
let fontChoice = FONT_DEFAULT;

const GOOGLE_CSS = 'https://fonts.googleapis.com/css2?';
const webfontsInjected = new Set();

/* One family, once. A visitor who tries Archivo and then Outfit needs
   both, and a single flag would leave the second face falling back to
   the system stack forever — which is exactly the kind of quiet failure
   a display preference should not have. */
function ensureWebfont(font) {
  if (!font.webfont || webfontsInjected.has(font.id)) return;
  webfontsInjected.add(font.id);
  const family = font.webfont.replace(/ /g, '+');
  const href = GOOGLE_CSS + 'family=' + family + (font.spec ? ':' + font.spec : '') + '&display=swap';
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.font = font.id;
  document.head.appendChild(link);
}

/* Opening the picker is the one moment every swatch has to be legible,
   so that is when the whole set is asked for — in a single request, at
   regular weight, because a preview is a preview. Choosing a face then
   loads that face's real weight range on its own. */
let previewsInjected = false;
function ensureFontPreviews() {
  if (previewsInjected) return;
  previewsInjected = true;
  const families = FONTS.filter(f => f.webfont)
    .map(f => 'family=' + f.webfont.replace(/ /g, '+'))
    .join('&');
  if (!families) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = GOOGLE_CSS + families + '&display=swap';
  link.dataset.font = 'previews';
  document.head.appendChild(link);
}

function storedFont() {
  try {
    const id = localStorage.getItem(FONT_KEY);
    return FONT_BY_ID.has(id) ? id : FONT_DEFAULT;
  } catch (_) {
    return FONT_DEFAULT; // cannot remember — ship the default
  }
}
function applyFont(id, persist) {
  const font = FONT_BY_ID.get(id) || FONT_BY_ID.get(FONT_DEFAULT);
  fontChoice = font.id;
  if (font.webfont) ensureWebfont(font);
  // Roboto is the stylesheet's own default, so it carries no attribute —
  // the same trick the background uses to stay byte-identical at rest.
  const root = document.documentElement;
  if (root) {
    if (font.id === FONT_DEFAULT) root.removeAttribute('data-font');
    else root.setAttribute('data-font', font.id);
  }
  const btn = el('fontBtn');
  if (btn) {
    const on = font.id !== FONT_DEFAULT;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', on ? `Typeface — ${font.label}` : 'Typeface');
    btn.setAttribute('title', btn.getAttribute('aria-label'));
  }
  if (persist) {
    try { localStorage.setItem(FONT_KEY, font.id); } catch (_) {}
  }
  if (el('fontGrid')) renderFontGrid();
  return font;
}

function renderFontGrid() {
  const grid = el('fontGrid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const font of FONTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'font-swatch' + (font.id === fontChoice ? ' is-active' : '');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', font.id === fontChoice ? 'true' : 'false');
    b.dataset.font = font.id;
    // The guided tour points at the swatches, not the button that opens the
    // picker — picking a typeface is the real action, and the step that opens
    // the picker has already been taken by then.
    b.setAttribute('data-tour-target', 'font-pick');
    // The sample is set in the face itself, so the choice is visible
    // before it is made — the swatch is a preview, not a label. The
    // LingoJam style it answers is named underneath, because that is
    // where the vocabulary was sourced.
    b.innerHTML =
      `<span class="font-sample" style="font-family:${font.stack}">Structured Cabling</span>` +
      `<span class="font-style">${font.style}</span>` +
      `<span class="font-meta">${font.note}</span>`;
    b.addEventListener('click', () => {
      // Dismiss first, confirm second. The toast is a nicety and it
      // reaches for the toast host, so letting it run before the close
      // would leave the popover stuck open if that element were missing.
      applyFont(font.id, true);
      closeFontPicker();
      showToast(`Typeface — ${font.label}`, { type: 'info' });
    });
    grid.appendChild(b);
  }
}

function openFontPicker() {
  ensureFontPreviews();   // every swatch has to be legible to be chosen
  renderFontGrid();
  overlayPush('fontOverlay', closeFontPicker);
  el('fontOverlay').hidden = false;
}
const closeFontPicker = () => { el('fontOverlay').hidden = true; };
/* The video backdrop. Three jobs the attribute set alone cannot do:

   autoplay refused — iOS Low Power Mode and every desktop browser's
   autoplay policy reject an unmuted video, and a rejected autoplay leaves a
   black frame. play() is retried on the first real gesture, which is the
   only user-initiated moment the policy will accept.

   paused behind dialogs — the layer is position:fixed, so it never leaves
   the viewport and an IntersectionObserver on it would never fire. What
   actually covers it is the viewer and the seven modals, each opaque and
   full-screen. While any is open the backdrop is paused: it is invisible and
   30fps of decode behind an opaque dialog is pure battery.

   suspended on tab hide — iOS suspends the decoder in the background and does
   not reliably resume it, so returning to the tab has to re-issue play().
   play() on an already-playing video is a no-op, which is why this can run
   unconditionally. */
function wireVideoBg() {
  const video = el('videoBgEl');
  if (!video) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  // The reduced-motion stylesheet hides the element; pausing keeps the
  // decoder from running against display:none.
  function syncMotion() {
    if (reduce.matches) video.pause();
    else safePlay();
  }
  function safePlay() {
    // Rejected promises are the normal path here, not an error: autoplay
    // policy refuses unmuted and low-power playback alike.
    const p = video.play();
    if (p && p.catch) p.catch(() => {});
  }

  // Every overlay that covers the viewport with an opaque surface.
  const OVERLAYS = ['lightbox', 'adminModalOverlay', 'newAlbumOverlay',
    'uploadModalOverlay', 'sortModalOverlay', 'settingsModalOverlay',
    'tagModalOverlay'];
  const anyOverlayOpen = () => OVERLAYS.some(id => {
    const node = el(id);
    return node && !node.hidden;
  });

  function syncPlayback() {
    if (reduce.matches || document.hidden || anyOverlayOpen()) video.pause();
    else safePlay();
  }

  reduce.addEventListener('change', syncMotion);
  document.addEventListener('visibilitychange', syncPlayback);
  OVERLAYS.forEach(id => {
    const node = el(id);
    if (!node) return;
    // Observers rather than a call inside every open/close handler: seven
    // overlays each already own their `hidden` writes, and the ones added
    // later would not be covered.
    new MutationObserver(syncPlayback).observe(node,
      { attributes: true, attributeFilter: ['hidden'] });
  });

  // The gestures that unlock a refused autoplay. passive — nothing here
  // touches the page's own handlers.
  ['pointerdown', 'touchend', 'keydown'].forEach(evt => {
    document.addEventListener(evt, syncPlayback, { passive: true });
  });

  syncMotion();
}

/* A popover has to go away when you tap the thing behind it — a sheet
   dims the page and owns the gesture, so it never needed this. Escape
   and the back button already route through overlayStack. */
function wireFontPopover() {
  const overlay = el('fontOverlay');
  if (!overlay) return;
  overlay.addEventListener('pointerdown', e => {
    if (e.target === overlay) overlayClose('fontOverlay');
  });
}

// Runs at parse time, beside the background's, so a remembered typeface
// is already in place for the first paint rather than swapping under it.
applyFont(storedFont(), false);

// Runs at parse time, before the first paint of the archive, so a
// remembered background never flashes pure black on the way in.
applyComfortTheme(storedComfortTheme(), false);

document.addEventListener('DOMContentLoaded', init);

async function init() {
  // The walkthrough gate runs before anything else paints: a first-time
  // visitor should land on the build's story, not on the archive with a
  // tour banner they have to notice. Hand off and stop — the walkthrough
  // writes the record, and the next load walks straight in. A reload
  // counts as starting again, so it hands off too; ?stay=1 opts out.
  if (shouldRequireWalkthrough()) {
    location.replace('walkthrough/');
    return;
  }

  el('demoBadge').hidden = !DEMO_MODE;
  LOADING_MARKUP = el('loadingState').innerHTML;
  // Remembered reading preferences, before anything renders.
  loadViewPrefs();
  state.token = sessionStorage.getItem(TOKEN_KEY);
  state.adminMode = DEMO_MODE ? false : !!state.token;
  updateAdminUI();
  wireStaticEvents();
  wireHoverGlow();
  syncAppbar();
  wireWelcome();
  wireVideoBg();

  // Add unload handler to cancel requests
  window.addEventListener('beforeunload', cancelRequests);

  // Warn about PAT in console
  if (state.token && !DEMO_MODE) {
    console.warn('GitHub PAT present in sessionStorage — do not share screenshots of this console.');
  }

  // Cache-first service worker: makes repeat visits/offline instant.
  // Fails silently on file:// or older browsers — gallery still works.
  if (location.protocol !== "file:" && navigator.serviceWorker) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  loadProg.set(4);
  await loadMetadata(false);
  loadProg.set(10);
  await loadTree(state.adminMode);
  // After the tree, not before: the panel counts the photos, and a
  // gallery with nothing loaded yet would greet the visitor with "every
  // photo" and then correct itself.
  maybeShowWelcome();

  /* Initial history entry: push so back goes to previous tab, not the page before gallery.
     If there's already a galleryNav state, restore it. Otherwise push initial view. */
  if (GalleryNav.supported) {
    const stateObj = GalleryNav.current || {};
    if (stateObj.galleryView && (stateObj.galleryView === 'images' || stateObj.galleryView === 'phases')) {
      setView(stateObj.galleryView, { pushHistory: false });
    } else {
      GalleryNav.push({ galleryView: 'images' });
    }
  }
}

/* ── Reading the repo ─────────────────────────────────────────── */

/* gallery.json maps a full repo path to { phase, activity } — manually
   assigned classifications. Read as raw so it also works without a token.
   Missing or malformed file simply starts empty. */
async function loadMetadata(auth = false) {
  state.metadata = {};
  // The sha belongs to the file on the branch, not to what we just read,
  // so a failed load must not leave a stale one behind to poison the next
  // write. githubPut recovers from a bad sha (409 or 422 both re-read), but
  // the cache is only an optimisation when it is honest.
  state._metaSha = null;
  // A failed load must not leave a stale shared admin session behind either.
  state.adminSession = null;
  if (DEMO_MODE) return;
  const headers = {};
  if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;
  try {
    const res = await githubFetch(rawUrl('gallery.json'), { headers });
    if (!res.ok) return;
    const data = JSON.parse(await res.text());
    // Split the shared admin session out of the photo classifications so it
    // is never treated as a classifyable image.
    state.adminSession = data && typeof data === 'object' && data[ADMIN_SESSION_KEY] ? data[ADMIN_SESSION_KEY] : null;
    state.metadata = {};
    if (data && typeof data === 'object') {
      for (const [path, value] of Object.entries(data)) {
        if (path !== ADMIN_SESSION_KEY) state.metadata[path] = value;
      }
    }
  } catch (err) {
    console.warn('No gallery.json metadata yet — starting clean.', err && err.message);
    return;
  }
  /* A raw.githubusercontent read carries no sha — that host serves bytes, not
     git objects — so learning it costs one more request, and it is only
     worth spending for an admin who is about to write. Asking now means
     every classify after this one is a single PUT instead of three
     round trips; asking lazily on first save would put the same request
     in front of the visitor's first click instead, where a stall is
     felt rather than absorbed during sign-in. */
  if (auth && state.token) await refreshMetaSha();
}

/* Read just the sha of gallery.json. Failure is not an error worth
   surfacing: the write path works without it, only slower, and this is an
   optimisation. */
async function refreshMetaSha() {
  if (DEMO_MODE || !state.token) return null;
  try {
    const res = await githubFetch(contentsUrl('gallery.json'), {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (data && data.sha) state._metaSha = data.sha;
    return state._metaSha;
  } catch (err) {
    console.warn('Could not read the gallery.json sha — writes will re-read it.', err && err.message);
    return null;
  }
}

/* Persist manual classifications to gallery.json (one commit) unless the
   content is unchanged. Demo mode never touches GitHub. */
async function persistMetadata() {
  if (DEMO_MODE) return;
  // The admin session rides in the same file so the one-active-admin lock is
  // shared with every visitor through the repo, not just this tab.
  const payload = { ...state.metadata, ...(state.adminSession ? { [ADMIN_SESSION_KEY]: state.adminSession } : {}) };
  const json = JSON.stringify(payload, null, 2);
  if (state._metaHash === json) return;
  const encoded = btoa(unescape(encodeURIComponent(json)));
  const sha = state._metaSha || undefined;
  const written = await githubPut('gallery.json', encoded,
    'Update photo classification metadata via gallery admin', sha ? { sha } : {});
  // Keep the cache pointed at what is now on the branch: GitHub returns the
  // new blob sha on a successful PUT, so the next save is again one request.
  if (written && written.sha) state._metaSha = written.sha;
  state._metaHash = json;
}

/* ── Asset identity & duplicate model ────────────────────────────

   Files → logical assets. One logical asset is one photograph and one
   gallery card. Two files belong to the same asset when they share either:
     • content     — identical bytes ⇒ identical git blob SHA (cryptographic,
                     exact duplicate), regardless of filename or folder.
     • identity    — same folder + same base name after stripping a known
                     derivative suffix (photo / photo-480 / photo@2x …):
                     responsive / optimisation variants of one photo.
   Matching is a union-find over those two keys, so an asset can never be
   split across cards. Discovery also de-dups by full repo path, so a file
   listed twice by the API cannot render twice.

   Exactly one gallery item per asset is the "canonical" one: the original
   (no variant suffix), else the largest endpoint variant. Every other file
   stays in the repo and is listed for review — nothing is ever moved or
   deleted automatically.
─────────────────────────────────────────────────────────────────── */

// Conservative derivative-suffix matcher. Camera/WhatsApp names
// (20260621_122750.jpg, IMG-20260726-WA0005.jpg) never match, so real
// photos can't be collapsed by accident. Extend at your own risk.
const VARIANT_REGEX = /(@\d+x|-(\d{3,4}|thumb|thumbnail|sm|md|lg|xl|orig|original|full))$/i;

const basenameStem = (name) => name.replace(/\.[^.]+$/, '');
const isVariantName = (name) => VARIANT_REGEX.test(basenameStem(name));
const assetBase = (name) => basenameStem(name).replace(VARIANT_REGEX, '').toLowerCase();

/* Lower = better canonical. Original always wins; among variants the
   largest endpoint wins; bare thumbs trail everything. */
function variantScore(name) {
  if (!isVariantName(name)) return 0;
  const base = basenameStem(name);
  const w = base.match(/-(\d{3,4})$/) || base.match(/@(\d+)x$/);
  if (w) return 1000 - parseInt(w[1], 10);
  return 5000 + base.length;
}

function findRoot(parent, t) {
  let root = t;
  while (parent.get(root) !== root) root = parent.get(root);
  while (parent.get(t) !== t) { const next = parent.get(t); parent.set(t, root); t = next; }
  return root;
}
function union(parent, a, b) {
  const ra = findRoot(parent, a), rb = findRoot(parent, b);
  if (ra !== rb) parent.set(ra, rb);
}

/* discovered: [{ folder, path, name, sha, demoSrc? }] */
function buildAssets(discovered) {
  // Guard A — duplicate API / recursive results: one canonical entry per path.
  const byPath = new Map();
  for (const d of discovered) if (!byPath.has(d.path)) byPath.set(d.path, d);
  const files = [...byPath.values()];

  const parent = new Map(); // token -> token (union-find)
  for (const f of files) {
    parent.set('f:' + f.path, 'f:' + f.path);
    if (!parent.has('s:' + f.sha)) parent.set('s:' + f.sha, 's:' + f.sha);
    if (!parent.has('b:' + f.folder + '/' + assetBase(f.name))) parent.set('b:' + f.folder + '/' + assetBase(f.name), 'b:' + f.folder + '/' + assetBase(f.name));
    union(parent, 'f:' + f.path, 's:' + f.sha);
    union(parent, 'f:' + f.path, 'b:' + f.folder + '/' + assetBase(f.name));
  }

  const groups = new Map();
  for (const f of files) {
    const root = findRoot(parent, 'f:' + f.path);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(f);
  }

  const assets = [...groups.values()].map(group => {
    group.sort((a, b) => (variantScore(a.name) - variantScore(b.name)) || a.path.localeCompare(b.path));
    const canonical = group[0];
    const shas = new Set(group.map(g => g.sha));
    return {
      id: canonical.path,
      folder: canonical.folder,
      items: group,
      canonical,
      // Every member byte-identical ⇒ exact duplicate set (variants stay
      // distinct content but still one logical asset).
      exactDuplicate: group.length > 1 && shas.size === 1,
      variants: group.filter(g => g !== canonical),
      sha256: null, // filled lazily by the admin duplicate audit
    };
  });
  assets.sort((a, b) => (a.canonical.path || a.id).localeCompare(b.canonical.path || b.id));
  return assets;
}

function summarizeDuplicates(assets) {
  let totalFiles = 0, exactDupFiles = 0;
  for (const a of assets) {
    totalFiles += a.items.length;
    if (a.exactDuplicate) exactDupFiles += a.items.length - 1;
  }
  return {
    totalFiles,
    uniqueAssets: assets.length,
    exactDuplicateFiles: exactDupFiles,
    visualDuplicateCandidates: Object.values(state.metadata || {}).filter(m => m && m.visual).length,
  };
}

/* The images-subtree tree lists paths relative to itself (no "images/"
   prefix) — rebuild full paths here. De-dups by path. */
function discoverFromTree(treeItems) {
  const seen = new Set();
  const out = [];
  for (const item of treeItems) {
    if (item.type !== 'blob' || !IMG_EXT.test(item.path)) continue;
    const slash = item.path.indexOf('/');
    const folder = slash === -1 ? 'General' : item.path.slice(0, slash);
    const name = slash === -1 ? item.path : item.path.slice(slash + 1);
    const full = `${CONFIG.imagesPath}/${item.path}`;
    if (seen.has(full)) continue;
    seen.add(full);
    out.push({ folder, path: full, name, sha: item.sha });
  }
  return out;
}

/* Rebuild everything from a flat discovered list. */
function setAssets(discovered) {
  const assets = buildAssets(discovered);
  state.assets = assets;
  state.duplicateSummary = summarizeDuplicates(assets);
  const folders = {};
  for (const a of assets) (folders[a.folder] = folders[a.folder] || []).push(a.canonical);
  for (const folder of Object.keys(folders)) {
    // Chronological within a phase: dated photos first (by camera/WhatsApp
    // timestamp), untimestamped photos after, sorted by name. An untimed file
    // must never jump ahead of dated evidence.
    folders[folder].sort((x, y) => {
      const tx = photoTs(x.name), ty = photoTs(y.name);
      if (tx === ty) return x.name.localeCompare(y.name, 'en', { numeric: true });
      return (tx || Number.MAX_SAFE_INTEGER) - (ty || Number.MAX_SAFE_INTEGER);
    });
  }
  state.folders = folders;
  state.order = Object.keys(folders).sort((a, b) =>
    (folderSequence(a) - folderSequence(b)) || a.localeCompare(b, 'en', { numeric: true })
  );
}

async function loadTree(auth = false) {
  if (DEMO_MODE) { loadProg.set(74); loadDemoData(); return; }
  try {
    const headers = {};
    if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;

    // Get the root tree (non-recursive)
    loadProg.set(14);
    const rootRes = await githubFetch(
      `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/git/trees/${CONFIG.branch}?recursive=0`,
      { headers }
    );
    if (!rootRes.ok) {
      const errData = await rootRes.json().catch(() => ({}));
      const err = new Error(errData.message || `GitHub API error (${rootRes.status})`);
      err.status = rootRes.status;
      throw err;
    }
    const rootData = await rootRes.json();
    loadProg.set(32);

    // Find the images folder in the root tree
    const imagesPath = CONFIG.imagesPath;
    const imagesNode = rootData.tree.find(t => t.path === imagesPath && t.type === 'tree');

    if (!imagesNode) {
      // No images folder yet - check if it might exist deeper
      const prefix = `${imagesPath}/`;
      const folders = {};
      state.folders = folders;
      state.order = [];
      loadProg.set(74);
      render();
      return;
    }

    // Fetch the images folder tree (recursive to get all subfolders)
    const imagesRes = await githubFetch(
      `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/git/trees/${imagesNode.sha}?recursive=1`,
      { headers }
    );
    if (!imagesRes.ok) {
      const errData = await imagesRes.json().catch(() => ({}));
      const err = new Error(errData.message || `GitHub API error (${imagesRes.status})`);
      err.status = imagesRes.status;
      throw err;
    }
    loadProg.set(58);
    const data = await imagesRes.json();
    loadProg.set(64);

    // Files → logical assets → canonical card per asset. Exact duplicates
    // and responsive variants all collapse into ONE representation.
    setAssets(discoverFromTree(data.tree));
    loadProg.set(74);
    render();
  } catch (err) {
    loadError(err);
  }
}

/* The loading gate becomes an error card with a Retry — a
   transient GitHub failure shouldn't cost a full page reload,
   and the message should say what actually went wrong (the old
   blanket "check owner/repo/branch" showed for every failure,
   even GitHub-side 500s). */
function loadError(err) {
  const status = err.status || 0;
  const text = err.message || '';
  let msg;
  if (status === 404) {
    msg = 'Repository not found — check owner/repo/branch in app.js.';
  } else if (status >= 500) {
    msg = `GitHub's API is having trouble (HTTP ${status}). Tap Retry.`;
  } else if (/timed out/i.test(text)) {
    msg = 'The request timed out — GitHub is slow. Tap Retry.';
  } else if (/failed|network|fetch|aborted/i.test(text)) {
    msg = 'Network trouble reaching GitHub. Tap Retry.';
  } else {
    msg = text || 'Could not read repository.';
  }
  const gate = el('loadingState');
  gate.classList.add('is-error');
  const caption = gate.querySelector('.loading-caption');
  if (caption) caption.textContent = msg;
  const wrap = gate.querySelector('.load-bar-wrap');
  if (wrap) {
    wrap.innerHTML = `<button class="load-retry" id="loadRetry" type="button">Retry</button>`;
    el('loadRetry').addEventListener('click', () => {
      // Put the loading UI back and run the tree load again.
      gate.classList.remove('is-error');
      gate.innerHTML = LOADING_MARKUP;
      loadProg._pct = 0;
      loadProg._images = 0;
      loadProg._loaded = 0;
      loadTree(state.adminMode);
    });
  }
  showToast(msg, { type: 'error' });
}

function loadDemoData() {
  if (!state.order.length) {
    state.folders = buildDemoFolders();
    state.order = Object.keys(state.folders).sort((a, b) =>
      (folderSequence(a) - folderSequence(b)) || a.localeCompare(b, 'en', { numeric: true })
    );
  }
  render();
}

function buildDemoFolders() {
  // Camera-style timestamped names so the Pictures tab's day groups demo properly.
  const phases = [
    ['site-survey', '20260619'],
    ['cable-pull', '20260621'],
    ['termination-testing', '20260623'],
    ['rack-build', '20260626'],
  ];
  const folders = {};
  phases.forEach(([phase, day], pIdx) => {
    folders[phase] = Array.from({ length: 4 }, (_, i) => {
      const name = `${day}_0${9 + i}1500.jpg`;
      return {
        path: `${CONFIG.imagesPath || 'images'}/${phase}/${name}`,
        sha: `demo-${pIdx}-${i}`,
        name,
        folder: phase,
        demoSrc: demoImage(phase, i + 1),
      };
    });
  });
  return folders;
}

function demoImage(label, n) {
  const hue = (label.length * 37 + n * 53) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" role="img" aria-label="${escapeAttr(label)} #${n}">
    <rect width="100%" height="100%" fill="hsl(${hue},35%,18%)"/>
    <text x="50%" y="50%" fill="hsl(${hue},60%,72%)" font-family="monospace" font-size="18" text-anchor="middle" dy=".3em">${escapeHtml(label)} #${n}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/* ── Rendering ─────────────────────────────────────────────────── */

function render() {
  const totalPhotos = Object.values(state.folders).reduce((a, f) => a + f.length, 0);
  el('emptyState').hidden = totalPhotos !== 0;
  el('emptyPath').textContent = CONFIG.imagesPath + '/';
  state.picturesList = picturesCards();
  computeFirstPaintPaths();
  renderPictures();
  renderAlbums();
  wireGalleryEvents();
  // An open album detail re-renders too (rename/delete/classify flow
  // through here) — after wireGalleryEvents so its own wiring wins.
  if (state.albumDetail) renderAlbumDetail();
  // First paint: raw.githubusercontent sends Cache-Control: no-cache, so
  // every visit pays DNS + TLS + a full GET unless we preload the images the
  // user actually sees first (the top of the Pictures tab).
  if (!state._preloadedFirstPaint) {
    state._preloadedFirstPaint = true;
    firstPaintImages().forEach(img => {
      const pre = document.createElement('link');
      pre.rel = 'preload'; pre.as = 'image'; pre.href = thumbSrc(img); pre.fetchPriority = 'high';
      document.head.appendChild(pre);
    });
  }
  animateIntro(totalPhotos, state.order.length);
  applyAdminFilter();
  updateSelectBar();
  const gate = el('loadingState');
  if (gate && !gate.hidden) {
    const eager = document.querySelectorAll('#gallery .card img[loading="eager"]').length;
    loadProg.imageCount(eager);
    if (!eager) loadProg.finish();
    else setTimeout(() => loadProg.finish(), GATE_HOLD_MS);
  }
  // A re-render can stale the open viewer (rename/delete/classify) — refresh it.
  if (!el('lightbox').hidden) updateLightbox();
}

/* ── Bottom tabs (Pictures / Albums) ───────────────────────────────
   Both views are always rendered; a tab switch just reveals one and
   restores its scroll position, so flipping tabs never loses place. */
function setView(view, { pushHistory = true } = {}) {
  if (view !== 'images' && view !== 'phases') return;
  if (state.view === view) return;
  // The album detail lives inside the Albums tab — switching tabs leaves it.
  state.albumDetail = null;
  el('albumDetailView').hidden = true;
  state._tabScroll[state.view] = window.scrollY;
  state.view = view;
  const pictures = view === 'images';
  el('tabPictures').classList.toggle('is-active', pictures);
  el('tabPictures').setAttribute('aria-selected', String(pictures));
  el('tabAlbums').classList.toggle('is-active', !pictures);
  el('tabAlbums').setAttribute('aria-selected', String(!pictures));
  el('picturesView').hidden = !pictures;
  el('albumsView').hidden = pictures;
  if (!el('lightbox').hidden) overlayClose('lightbox');
  window.scrollTo(0, state._tabScroll[view] || 0);
  syncAppbar();

  if (pushHistory && GalleryNav.supported) {
    const stateObj = Object.assign({}, GalleryNav.current, { galleryView: view });
    GalleryNav.push(stateObj);
  }
}

/* The title the app bar last painted. The scroll listener calls
   syncAppbar once per animation frame, but the name only changes
   on a tab switch, an album open or a data event — scrolling the
   wall never touches it. Rewriting both text nodes every frame
   with the same string is a per-frame DOM write for nothing, so
   the value is held and the nodes are written only when it moves. */
let lastAppbarName = null;

/* One UI hero header: the big "Gallery" title folds away on scroll and the
   compact title takes its place in the app bar. Inside an album both carry
   the album name instead. */
function syncAppbar() {
  const bar = el('appbar');
  const collapsed = window.scrollY > 36;
  if (bar) {
    const was = bar.classList.contains('is-collapsed');
    bar.classList.toggle('is-collapsed', collapsed);
    if (was !== collapsed) syncChromeH();
  }
  const folder = state.albumDetail;
  const name = folder ? albumStageName(folder) : 'Gallery';
  if (name === lastAppbarName) return;
  lastAppbarName = name;
  const title = el('appbarTitle');
  if (title) title.textContent = name;
  el('appbarMini').textContent = name;
}

/* Height of the top chrome (app bar, or the selection bar while selecting) —
   the album-detail header sticks right below it. The height changes in
   discrete steps (hero collapse, search pill, selection bar), so the sticky
   offset is re-measured only at those transitions. */
function syncChromeH() {
  const selBar = el('selectBar');
  const h = (selBar && !selBar.hidden) ? 56
    : (el('appbar') ? el('appbar').offsetHeight : 54);
  document.documentElement.style.setProperty('--chrome-h', h + 'px');
}

/* --chrome-h is what the album-detail header sticks below, so it has to
   track the app bar through every change — including an orientation change,
   which syncAppbar alone did not cover: it only calls syncChromeH when the
   collapsed state flips, so a rotate that kept the same state left the
   offset at the old height (measured 77px carried over into a 142px bar).

   Measuring is not enough on its own. The bar's height is animated, not
   stepped: the hero folds on a grid-template-rows transition, and the
   ≤520px media query folds it on the same one. A measurement taken in the
   same tick as the class change or the rotate reads a height mid-flight —
   124px for a bar that lands on 59px — which pins the album-detail header
   below where the bar actually is. So re-measure when the transition
   finishes rather than guessing its duration: one listener, on the element
   that animates. */
let chromeHTransitionHooked = false;
function watchChromeH() {
  if (chromeHTransitionHooked) return;
  const bar = el('appbar');
  if (!bar) return;
  chromeHTransitionHooked = true;
  bar.addEventListener('transitionend', (e) => {
    if (e.target === bar || e.propertyName === 'grid-template-rows') syncChromeH();
  });
}

/* ── The search pill's view panel ───────────────────────────────────
   The pill used to carry a scope <select> — All, Photos, Albums — and
   the search now looks through both photos and albums at once, the way
   its placeholder always said. What is left in the panel is how the wall
   is READ: View (how many tiles a row holds) and Order (which end of the
   archive it starts at), the S10 Gallery's view/arrangement chooser, in
   the same tile idiom as the Eye-comfort picker. Both are remembered per
   device, like the typeface and the background: they are preferences
   about how you read the archive, not something to re-pick on every
   visit.

   The panel drops from the button into the column rather than covering
   it, because the wall behind it is the thing the tiles rearrange. It
   closes on a pick (the wall is the receipt), on a tap anywhere else, on
   Escape, and on browser back — the last two through the shared overlay
   registry, like every other popover here. */
const VIEW_SIZE_KEY = 'gallery.viewSize';
const VIEW_ORDER_KEY = 'gallery.viewOrder';

/* View art: the tile's own promise drawn at 24px. A density is a wall of
   squares — cozier means more of them, smaller, in the same box. */
function densityArt(cols, rows) {
  const box = 20, gap = 1.8;
  const w = (box - gap * (cols - 1)) / cols;
  const h = (box - gap * (rows - 1)) / rows;
  let rects = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      rects += `<rect x="${(2 + c * (w + gap)).toFixed(2)}" y="${(2 + r * (h + gap)).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="1.2"/>`;
    }
  }
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">${rects}</svg>`;
}

/* Order art: bars that shrink toward the newest end, with the arrow that
   points at it — or an A over a Z for alphabetical. */
function orderArt(kind) {
  const bars = '<path d="M3 6.5h8M3 12h5.5M3 17.5h3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>';
  const arrow = (d) => `<path d="${d}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`;
  const body = kind === 'newest'
    ? bars + arrow('M18 5v13.4m0 0 3.3-3.3M18 18.4l-3.3-3.3')
    : kind === 'oldest'
      ? bars + arrow('M18 19V5.6m0 0 3.3 3.3M18 5.6l-3.3 3.3')
      : '<text x="2.5" y="11" font-size="11" font-weight="700" fill="currentColor">A</text>'
        + '<text x="11.5" y="22" font-size="11" font-weight="700" fill="currentColor">Z</text>';
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true">${body}</svg>`;
}

/* The tick both panels put on the tile in force — the pill's View / Order
   tiles and the upload rows' album tiles. */
const TILE_CHECK_PATH = '<path d="M9.6 16.2 5.4 12 4 13.4l5.6 5.6 12-12L20.2 5.7z"/>';

const SEARCH_MENU = [
  {
    group: 'size', title: 'View',
    options: [
      { id: 'cozy', label: 'Cozy', art: densityArt(5, 3) },
      { id: 'comfy', label: 'Comfortable', art: densityArt(3, 3) },
      { id: 'large', label: 'Large', art: densityArt(2, 2) },
    ],
  },
  {
    group: 'order', title: 'Order',
    options: [
      { id: 'newest', label: 'Newest', art: orderArt('newest') },
      { id: 'oldest', label: 'Oldest', art: orderArt('oldest') },
      { id: 'name', label: 'A–Z', art: orderArt('name') },
    ],
  },
];

/* Is this id one the panel actually offers for that group? The stored value
   is device-local and can be anything, and a preference that no longer
   exists must fall back to the default rather than paint a view nobody
   asked for. */
function offersId(group, id) {
  const g = SEARCH_MENU.find(x => x.group === group);
  return !!g && g.options.some(o => o.id === id);
}

function rememberPref(key, value) {
  try { localStorage.setItem(key, value); } catch (_) { /* nothing to remember it in */ }
}

/* The two writers. Each takes the id as it may be remembered, not as it was
   meant, and persist=false is the read-back at startup. */
function applyViewSize(id, persist) {
  state.viewSize = offersId('size', id) ? id : 'comfy';
  const b = document.body;
  if (b && b.classList) {
    b.classList.toggle('view-cozy', state.viewSize === 'cozy');
    b.classList.toggle('view-large', state.viewSize === 'large');
  }
  if (persist) rememberPref(VIEW_SIZE_KEY, state.viewSize);
}

function applyViewOrder(id, persist) {
  state.viewOrder = offersId('order', id) ? id : 'newest';
  if (persist) rememberPref(VIEW_ORDER_KEY, state.viewOrder);
  // The wall is BUILT from the order, so a change means a rebuild. Nothing
  // to do on the read-back — the first render happens after this anyway.
  if (persist) render();
}

/* Read back the two remembered choices. Runs first thing in init, ahead of
   the tree load, so the wall's first paint is already at the remembered
   density and in the remembered order — there is no frame of the default to
   correct. */
function loadViewPrefs() {
  let size = null, order = null;
  try {
    size = localStorage.getItem(VIEW_SIZE_KEY);
    order = localStorage.getItem(VIEW_ORDER_KEY);
  } catch (_) { /* nothing remembered — ship the defaults */ }
  applyViewSize(size, false);
  state.viewOrder = offersId('order', order) ? order : 'newest';
}

function renderSearchMenu() {
  const menu = el('searchMenu');
  if (!menu) return;
  menu.innerHTML = SEARCH_MENU.map(g => `
    <div class="search-menu-group">
      <div class="search-menu-title" id="searchMenu-${g.group}">${g.title}</div>
      <div class="search-tiles" role="radiogroup" aria-labelledby="searchMenu-${g.group}">
        ${g.options.map(o => {
          const current = g.group === 'size' ? state.viewSize : state.viewOrder;
          const on = current === o.id;
          return `<button type="button" class="search-tile${on ? ' is-active' : ''}" role="radio" aria-checked="${on ? 'true' : 'false'}" data-group="${g.group}" data-value="${o.id}">
            <span class="search-tile-art">${o.art}</span>
            <span class="search-tile-label">${escapeHtml(o.label)}</span>
            <svg class="search-tile-check" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">${TILE_CHECK_PATH}</svg>
          </button>`;
        }).join('')}
      </div>
    </div>`).join('');
}

/* The pill carries the open state too. On a phone the panel does not float
   over the wall — it DOCKS inside the pill, as a second row (see the
   stylesheet), so the wall is pushed down instead of covered. That makes
   the app bar taller while it is open, and --chrome-h is what the
   album-detail header sticks below, so both edges re-measure it. On a
   wider frame the class is set but nothing is docked, and the measurement
   lands on the height the bar already had. */
function setSearchMenuOpen(open) {
  const wrap = el('searchWrap');
  if (wrap && wrap.classList) wrap.classList.toggle('is-open', open);
  syncChromeH();
}

function closeSearchMenu() {
  const menu = el('searchMenu');
  if (menu) menu.hidden = true;
  setSearchMenuOpen(false);
  const btn = el('searchViewBtn');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function toggleSearchMenu() {
  const menu = el('searchMenu');
  if (!menu) return;
  if (!menu.hidden) { overlayClose('searchMenu'); return; }
  renderSearchMenu();
  menu.hidden = false;
  setSearchMenuOpen(true);
  const btn = el('searchViewBtn');
  if (btn) btn.setAttribute('aria-expanded', 'true');
  overlayPush('searchMenu', closeSearchMenu);
}

/* One tile picked: write that preference and put the panel away. */
function pickSearchOption(group, value) {
  if (group === 'size') applyViewSize(value, true);
  else if (group === 'order') applyViewOrder(value, true);
  overlayClose('searchMenu');
}

/* Admin quick-find: hide cards/albums that don't match the query, and fold
   away day groups left empty by the filter. One query, both kinds of
   result — the placeholder has always said "photos or albums". */
function applyAdminFilter() {
  const input = el('adminSearch');
  const wrap = el('searchWrap');
  if (!input || !wrap || wrap.hidden) return;
  const q = input.value.trim().toLowerCase();
  let visible = 0, total = 0;
  document.querySelectorAll('#picturesView .card[data-path]').forEach(card => {
    total++;
    const show = !q || (card.dataset.path || '').toLowerCase().includes(q);
    card.hidden = !show;
    if (show) visible++;
  });
  document.querySelectorAll('#picturesView .day').forEach(day => {
    day.hidden = !!q && ![...day.querySelectorAll('.card')].some(c => !c.hidden);
  });
  document.querySelectorAll('#albumsView .album').forEach(alb => {
    total++;
    const show = !q || (alb.dataset.folder || '').toLowerCase().includes(q);
    alb.hidden = !show;
    if (show) visible++;
  });
  // An open album detail holds photo cards too — same rules as the wall.
  document.querySelectorAll('#albumDetailView .card[data-path]').forEach(card => {
    total++;
    const show = !q || (card.dataset.path || '').toLowerCase().includes(q);
    card.hidden = !show;
    if (show) visible++;
  });
  el('adminSearchCount').textContent = q ? `${visible}/${total}` : '';
}

/* One tile in the Pictures wall — S10 style: just the photo, no caption.
   Every card carries its folder and folder-local index so the viewer, the
   admin search and the upload flows all address it the same way. Selection
   mode adds the circular badge (top-left, blue when picked). */
function cardMarkup(img, folder, i) {
  const pretty = prettyName(img.name);
  const c = classifyPhoto(img);
  const sel = state.adminMode && state.batchSelect;
  const picked = sel && state.batchSelected.has(img.path);
  return `<figure class="card${c.needsReview ? ' card-needs-review' : ''}${sel ? ' card-selectable' : ''}${picked ? ' card-selected' : ''}" data-tour-target="photo-card" data-group="${escapeAttr(c.group || '')}" data-folder="${escapeAttr(folder)}" data-index="${i}" data-path="${escapeAttr(img.path)}">
    <img class="card-img" src="${thumbSrc(img)}" data-full="${cardSrc(img)}" alt="${escapeAttr(pretty)}" loading="${isFirstPaint(img) ? 'eager' : 'lazy'}" fetchpriority="${isFirstPaint(img) ? 'high' : 'auto'}" decoding="async">
    ${sel ? `<span class="card-pick" aria-hidden="true">${picked ? '✓' : ''}</span>` : ''}
  </figure>`;
}

/* One album per phase: the most recent photo is the cover, name + count sit
   beneath it (One UI Albums tab). Clicking the cover opens the viewer scoped
   to that album at the cover photo; the ⋮ chip (admin) opens its sheet. */
function albumCardMarkup(folder) {
  const items = state.folders[folder] || [];
  if (!items.length) return '';
  const j = journeyFor(folder);
  const stageName = albumStageName(folder);
  const needsReview = items.some(img => classifyPhoto(img).needsReview);
  const coverIdx = items.length - 1;
  const cover = items[coverIdx];
  return `<figure class="album" data-tour-target="album-cover" data-folder="${escapeAttr(folder)}" data-index="${coverIdx}" data-group="${escapeAttr(j ? j.group : '')}">
    <div class="album-cover">
      <img src="${thumbSrc(cover)}" data-full="${cardSrc(cover)}" alt="${escapeAttr(stageName)}" loading="lazy" decoding="async">
      ${needsReview ? `<span class="album-badge" title="Some photos here have no journey stage assigned">Needs review</span>` : ''}
      ${state.adminMode ? `<button class="album-more" data-folder="${escapeAttr(folder)}" aria-label="Options for ${escapeAttr(stageName)}" data-tour-target="album-menu">${ICONS.ellipsis}</button>` : ''}
    </div>
    <figcaption class="album-meta">
      <span class="album-name">${escapeHtml(stageName)}</span>
      <span class="album-count">${items.length}</span>
    </figcaption>
  </figure>`;
}

/* Every photo, in phase order, each paired with the folder-local index its
   card needs — the Pictures wall renders from this, never from a positional
   index into a different folder. */
function allImageCards() {
  return state.order.flatMap(folder =>
    (state.folders[folder] || []).map((img, i) => ({ img, folder, index: i })));
}

/* Pictures tab: every photo on one wall, grouped by day taken, exactly like
   the S10 Gallery. Day order comes from the camera/WhatsApp timestamp in the
   filename; unparseable names land in "Undated" at the end. The wall order is
   the one the View panel asks for, so this is where that choice lands. */
function picturesCards() {
  const cards = allImageCards();
  const byName = (a, b) => a.img.name.localeCompare(b.img.name, 'en', { numeric: true });
  if (state.viewOrder === 'oldest') {
    return cards.sort((a, b) => (photoTs(a.img.name) - photoTs(b.img.name)) || byName(a, b));
  }
  if (state.viewOrder === 'name') return cards.sort(byName);
  return cards.sort((a, b) => {
    const ta = photoTs(a.img.name), tb = photoTs(b.img.name);
    if (ta !== tb) return tb - ta; // newest first
    return byName(a, b);
  });
}

/* 'YYYY-MM-DD' → 'Fri, 17 Jul' (year added when it isn't the current one). */
function fmtDay(iso, alwaysYear) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (alwaysYear || y !== new Date().getFullYear()) opts.year = 'numeric';
  return dt.toLocaleDateString('en-GB', opts);
}

function groupPictures(cards) {
  const groups = [];
  const byKey = new Map();
  for (const c of cards) {
    const iso = extractPhotoDate(c.img.name);
    const key = iso || '__undated__';
    let g = byKey.get(key);
    if (!g) { g = { iso, items: [] }; byKey.set(key, g); groups.push(g); }
    g.items.push(c);
  }
  // The pictures arrive already in view order, which settles a day's own
  // running order. The DAYS are settled here, in the same direction — newest
  // first for Newest, oldest first for Oldest, and newest first for A–Z,
  // where the date carries no meaning to reverse and the reader still
  // expects the latest evening at the top. 'Undated' is always last.
  const dir = state.viewOrder === 'oldest' ? 1 : -1;
  groups.sort((a, b) => {
    if (!a.iso) return 1;
    if (!b.iso) return -1;
    if (a.iso === b.iso) return 0;
    return (a.iso < b.iso ? -1 : 1) * dir;
  });
  return groups;
}

function renderPictures() {
  const groups = groupPictures(state.picturesList);
  el('picturesView').innerHTML = groups.map(g => `
    <section class="day">
      <h2 class="day-head">${g.iso ? escapeHtml(fmtDay(g.iso)) : 'Undated'}<span class="day-count">${g.items.length}</span></h2>
      <div class="grid grid-pictures">
        ${g.items.map(c => cardMarkup(c.img, c.folder, c.index)).join('')}
      </div>
    </section>`).join('');
}

function renderAlbums() {
  el('albumsView').innerHTML = `<div class="grid-albums">${state.order.map(albumCardMarkup).join('')}</div>`;
}

/* Album detail: one tap on a cover reveals that phase's photos in
   an inline grid (Samsung Gallery) — the cover no longer jumps
   straight into the viewer; tapping a photo inside the grid does. */
function openAlbumDetail(folder) {
  const items = state.folders[folder] || [];
  if (!items.length) return;
  state._albumScroll = window.scrollY;   // where the Albums grid was
  state.albumDetail = folder;
  // A stale search query would hide the grid behind it — reset it.
  if (el('adminSearch').value) {
    el('adminSearch').value = '';
    el('adminSearchCount').textContent = '';
  }
  applyAdminFilter();
  renderAlbumDetail();
  el('albumsView').hidden = true;
  el('albumDetailView').hidden = false;
  syncAppbar();
  syncChromeH();
  window.scrollTo(0, 0);
}

function closeAlbumDetail() {
  if (!state.albumDetail) return;
  state.albumDetail = null;
  el('albumDetailView').hidden = true;
  el('albumsView').hidden = state.view !== 'phases';
  syncAppbar();
  syncChromeH();
  window.scrollTo(0, state._albumScroll || 0);
}

function renderAlbumDetail() {
  const folder = state.albumDetail;
  if (!folder) return;
  const items = state.folders[folder] || [];
  if (!items.length) { closeAlbumDetail(); return; }
  const j = journeyFor(folder);
  const stageName = albumStageName(folder);
  const keepY = window.scrollY;   // re-renders (rename/delete) keep place
  el('albumDetailView').innerHTML = `
    <div class="album-detail-head">
      <button class="album-back" id="albumBack" type="button" aria-label="Back to albums">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
      </button>
      <div class="album-detail-titles">
        <h2 class="album-detail-name">${escapeHtml(stageName)}</h2>
        <span class="album-detail-count">${items.length} photo${items.length === 1 ? '' : 's'}</span>
      </div>
    </div>
    <div class="grid grid-pictures">
      ${items.map((img, i) => cardMarkup(img, folder, i)).join('')}
    </div>`;
  el('albumBack').addEventListener('click', closeAlbumDetail);
  // Same wiring as the Pictures wall: tap = viewer, long-press = select.
  el('albumDetailView').querySelectorAll('.card').forEach(fig => {
    fig.addEventListener('click', () => {
      if (Date.now() < (state._suppressClickUntil || 0)) return;
      if (state.adminMode && state.batchSelect) { toggleBatchSelect(fig.dataset.path); return; }
      const said = fig.dataset.path;
      const folder = fig.dataset.folder;
      const index = Number(fig.dataset.index);
      // openLightbox records the tap (claim, resolved slot, painted file) and
      // is the only place that knows what it actually painted — so it does not
      // duplicate the verdict here, where nothing has been painted yet.
      openLightbox(folder, index, startSrcFor(fig, said), said);
    });
    wireLongPress(fig);
  });
  el('albumDetailView').querySelectorAll('img[data-full]').forEach(img => {
    img.addEventListener('load', () => {
      if (!img.classList.contains('is-loaded')) img.classList.add('is-loaded');
      if (img.src !== img.dataset.full && img.dataset.full) img.src = img.dataset.full;
      loadProg.imageLoaded();
    });
    img.addEventListener('error', () => {
      if (img.src !== img.dataset.full && img.dataset.full) img.src = img.dataset.full;
    });
  });
  window.scrollTo(0, keepY);
}

function wireGalleryEvents() {
  const gallery = el('gallery');
  gallery.querySelectorAll('img[data-full]').forEach(img => {
    img.addEventListener('load', () => {
      if (!img.classList.contains('is-loaded')) img.classList.add('is-loaded');
      if (img.src !== img.dataset.full && img.dataset.full) img.src = img.dataset.full;
      loadProg.imageLoaded();
    });
    img.addEventListener('error', () => {
      if (img.src !== img.dataset.full && img.dataset.full) img.src = img.dataset.full;
    });
  });
  // Pictures tiles: tap opens the viewer; in selection mode tap toggles.
  gallery.querySelectorAll('#picturesView .card').forEach(fig => {
    fig.addEventListener('click', () => {
      if (Date.now() < (state._suppressClickUntil || 0)) return;
      if (state.adminMode && state.batchSelect) { toggleBatchSelect(fig.dataset.path); return; }
      // Hand the lightbox the exact image the card already loaded (a cache
      // hit = instant, no re-download, no blur flash) — but only once that
      // card has been confirmed to be the photo the tap resolves to.
      const said = fig.dataset.path;
      const folder = fig.dataset.folder;
      const index = Number(fig.dataset.index);
      // The tap record is written by openLightbox, which is the only place
      // that knows which file the viewer actually painted.
      openLightbox(folder, index, startSrcFor(fig, said), said);
    });
    wireLongPress(fig);
  });
  // Album covers open the phase's photos in an inline grid.
  gallery.querySelectorAll('#albumsView .album').forEach(fig => {
    fig.addEventListener('click', (e) => {
      if (e.target.closest('.album-more')) return;
      openAlbumDetail(fig.dataset.folder);
    });
  });
  gallery.querySelectorAll('.album-more').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      albumMenu(btn.dataset.folder);
    });
  });
}

/* The hover glow follows the pointer across the tile under it (the radial
   gradient in .card::before reads --mx/--my). Wired once, from the document,
   rather than per card: both grids are rebuilt wholesale through innerHTML on
   every render, so a per-card listener would have to be re-attached each time
   against a wall of ~270 tiles.

   The tile's rect is cached for as long as the pointer stays on it, because
   the style writes below dirty the layout — reading the rect per move would
   force a synchronous re-layout of the whole wall on every mouse frame. Scroll
   and resize move the tile under the cache, so both drop it. */
function wireHoverGlow() {
  let card = null, box = null;
  const release = () => {
    if (card) {
      card.style.removeProperty('--mx');
      card.style.removeProperty('--my');
    }
    card = null; box = null;
  };
  document.addEventListener('pointermove', e => {
    // Touch never hovers; Android also fires this per frame while scrolling.
    if (e.pointerType === 'touch') return;
    const next = e.target && e.target.closest ? e.target.closest('.card') : null;
    if (next !== card) {
      release();
      if (!next) return;
      card = next;
    }
    if (!box) box = card.getBoundingClientRect();
    // Written straight through: a pointermove is already delivered about once
    // per frame, and these two properties only invalidate paint. Coalescing
    // them behind requestAnimationFrame would buy nothing and cost the glow
    // wherever frames are throttled.
    card.style.setProperty('--mx', (e.clientX - box.left) + 'px');
    card.style.setProperty('--my', (e.clientY - box.top) + 'px');
  }, { passive: true });
  window.addEventListener('scroll', () => { box = null; }, { passive: true, capture: true });
  window.addEventListener('resize', () => { box = null; }, { passive: true });
}

/* mobile selection gesture: long-press a photo (touch) or right-click it
   (desktop) to enter selection mode with that photo picked. */
/* Long-press opens selection. The timings are one gesture: a tap must not
   reach this at all (browsers fire touchstart on tap, so the press has to
   outlast a real tap), a hold has to feel held rather than instant, and the
   window after the hold is how long a stray click from the same finger is
   swallowed so it does not also open the viewer. */
const LONG_PRESS_MS = 480;
const CLICK_SUPPRESS_MS = 700;
const HAPTIC_MS = 15;

function wireLongPress(fig) {
  let timer = null, sx = 0, sy = 0, touchedAt = 0;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  fig.addEventListener('touchstart', e => {
    /* Stamped before any guard. A touch on a tile is the origin of a
       possible contextmenu whether or not the gesture goes on to select
       anything, and the contextmenu door below has to know. */
    touchedAt = Date.now();
    if (!state.adminMode || state.batchSelect) return;
    if (!e.touches || e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    timer = setTimeout(() => {
      timer = null;
      state._suppressClickUntil = Date.now() + CLICK_SUPPRESS_MS;
      enterSelectMode(fig.dataset.path);
      if (navigator.vibrate) navigator.vibrate(HAPTIC_MS);
    }, LONG_PRESS_MS);
  }, { passive: true });
  fig.addEventListener('touchend', cancel, { passive: true });
  fig.addEventListener('touchcancel', cancel, { passive: true });
  fig.addEventListener('touchmove', e => {
    if (!timer || !e.touches[0]) return;
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (dx * dx + dy * dy > 100) cancel();
  }, { passive: true });
  fig.addEventListener('contextmenu', e => {
    if (!state.adminMode) return;
    e.preventDefault();
    /* On a touch screen a context menu has exactly one cause, and it is the
       long-press this element already handled. Nothing above suppresses the
       default, so Android fires contextmenu for the same finger that armed
       the timer: the timer opens selection with the photo picked, then this
       handler sees selection is already on and toggles that same photo
       straight back off. The admin is left with selection mode open, the
       Move/Delete bar showing, and nothing in it — a gesture that appears to
       do nothing at all, and which never happens on desktop because a mouse
       has no long-press to double-fire.

       So a contextmenu arriving within one long-press window of a touch is
       the echo of that touch, not a second, separate gesture. A real
       right-click on a hybrid device — trackpad, mouse, stylus — happens
       with no touch anywhere near it, and is unaffected. */
    if (touchedAt && Date.now() - touchedAt < CLICK_SUPPRESS_MS) return;
    if (!state.batchSelect) enterSelectMode();
    toggleBatchSelect(fig.dataset.path);
  });
}

/* One deliberate load moment: the header counters tick up. */
function animateIntro(totalPhotos, totalFolders) {
  // Tab switches re-render nothing (both views stay mounted), so the count-up
  // only ever plays on a real data change.
  const sig = `${totalPhotos}/${totalFolders}`;
  if (state._introSig === sig) return;
  state._introSig = sig;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    el('statPhotos').textContent = totalPhotos;
    el('statFolders').textContent = totalFolders;
    return;
  }
  animateCount(el('statPhotos'), totalPhotos);
  animateCount(el('statFolders'), totalFolders);
}
function animateCount(node, target) {
  if (target === 0) { node.textContent = '0'; return; }
  const duration = 700, start = performance.now();
  (function tick(now) {
    // Clamp so a timer that lags its own start (e.g. a paused/hibernated tab
    // where rAF timestamps can precede `start`) never shows a negative count.
    const p = Math.max(Math.min((now - start) / duration, 1), 0);
    const eased = 1 - Math.pow(1 - p, 3); // Ease-out cubic
    node.textContent = Math.round(eased * target);
    if (p < 1) requestAnimationFrame(tick);
  })(start);
}

/* ── Browser back: overlays ──────────────────────────────────────
   Opening the lightbox or a modal pushes a history entry, so the back
   button (and the mobile back gesture / edge swipe) returns to what was
   visible before instead of leaving the site.

   The stack belongs to nav.js, which also carries the guided tour's
   per-step entries — one stack, so one listener and one state shape. A
   tour step already in progress rides along on the overlay entry
   (`tourStep`/`tourId`), because a dialog opened mid-step is still that
   step: backing out of it returns to the step, not out of the tour.

   Explicit closes unwind their own entry and the popstate does the
   actual hiding, so the DOM and the history stack never disagree. Direct
   closing is the file:// fallback, where pushState is unreliable. */
const overlayRegistry = {};
const overlayStack = [];

function overlayPush(id, closeFn) {
  overlayRegistry[id] = closeFn;
  overlayStack.push(id);
  const cur = GalleryNav.current || {};
  GalleryNav.push(Object.assign(
    { overlay: id },
    cur.tour ? { tour: true, tourStep: cur.tourStep, tourId: cur.tourId } : null));
}

function overlayHide(id) {
  const fn = overlayRegistry[id];
  if (fn) fn();
}

function overlayClose(id) {
  overlayHide(id);
  const i = overlayStack.lastIndexOf(id);
  if (i !== -1) {
    overlayStack.splice(i, 1);
    GalleryNav.back();
  }
}

/* One subscription, not a popstate listener of our own: nav.js owns the
   event so the tour and the gallery cannot disagree about what a pop
   meant. `ours` is true when the pop unwinds an explicit close, whose DOM
   work overlayClose has already done. */
GalleryNav.subscribe((state, ours) => {
  if (ours) return;
  const id = overlayStack.pop();
  if (id) overlayHide(id);
  // Restore gallery view from history state (both tabs are valid views)
  if (state.galleryView && (state.galleryView === 'images' || state.galleryView === 'phases')) {
    setView(state.galleryView, { pushHistory: false });
  }
});

/* ── Confirming a destructive action ────────────────────────────────
   One dialog for all of them. The native confirm() it replaces cannot
   carry the scope of what is about to happen, styles itself to match
   nothing, labels its own buttons "OK", and blocks the main thread while
   it is up. This one states the scope, puts the destructive verb on the
   button, and hands focus to Cancel so a stray Enter does the safe thing.

   `body` is HTML on purpose: the scope line needs <strong> for the album
   name and a count that can stand out. Every caller passes text it has
   already escaped.

   `onAccept` is the swallow. It runs while the dialog is still up, so the
   photo is eaten by the bin sitting right there in front of you rather
   than somewhere off at the edge of the screen, and the dialog closes
   only once it has finished. Cancelling never runs it. */
let confirmPending = null;   // the settle function of the open dialog
let confirmConfirm = null;   // what the Confirm button does right now
let confirmBusy = false;     // guards a second press while onAccept runs

function askConfirm({ title, body, okLabel = 'Delete', danger = true, onAccept = null }) {
  const overlay = el('confirmOverlay');
  if (!overlay) return Promise.resolve(window.confirm(`${title}\n\n${body}`));
  // One at a time. A second request cancels the first rather than
  // stacking two dialogs the user then has to answer twice.
  if (confirmPending) confirmPending(false);

  // A question asked from inside a dialog: that dialog steps out of the
  // way. Both are modal overlays and the one later in the document wins the
  // same z-index, so asking from Album settings painted the question UNDER
  // it — measured at 412 wide, the settings card covered the confirm
  // completely and focus went to a Cancel nobody could see. Hidden rather
  // than closed: it keeps its place in the history stack and everything
  // typed into it, so a No puts it back exactly as it was, and backing out
  // of the question lands on it instead of at the wall.
  const under = overlayStack[overlayStack.length - 1];
  const parent = under && under !== 'confirmOverlay' ? el(under) : null;
  const parentStepsOut = !!(parent && !parent.hidden && parent.classList
    && parent.classList.contains('modal-overlay'));
  if (parentStepsOut) parent.hidden = true;

  el('confirmTitle').textContent = title;
  el('confirmBody').innerHTML = body;
  const ok = el('confirmOk');
  ok.textContent = okLabel;
  ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-ghost');

  // The bin's arrival has to play on every open, not only the first, so
  // the class is dropped and re-added around a forced reflow.
  const bin = el('confirmBin');
  if (bin) {
    bin.classList.remove('is-in');
    void bin.offsetWidth;
    bin.classList.add('is-in');
  }

  return new Promise(resolve => {
    const settle = (value) => {
      if (confirmPending !== settle) return;
      confirmPending = null;
      confirmConfirm = null;
      confirmBusy = false;
      // No: the dialog the question came from comes back into view. Only
      // while it is still on the stack — a back-press that unwound it
      // already closed it, and putting it back would leave a dialog on
      // screen that neither Escape nor back could reach.
      if (!value && parentStepsOut && overlayStack.indexOf(under) !== -1) parent.hidden = false;
      resolve(value);
    };
    confirmPending = settle;
    confirmConfirm = async () => {
      if (confirmBusy) return;
      confirmBusy = true;
      ok.disabled = true;
      try {
        if (onAccept) await onAccept();
      } catch (err) {
        console.warn('Confirmation animation failed; continuing anyway.', err);
      }
      ok.disabled = false;
      settle(true);
      overlayClose('confirmOverlay');
    };
    // The close routine is what actually hides the dialog — overlayClose
    // runs it before it pops the stack. Confirming therefore settles true
    // FIRST and then closes, so that close routine's settle(false) finds
    // nothing left to settle and leaves the answer alone.
    overlayPush('confirmOverlay', () => {
      overlay.hidden = true;
      settle(false);
    });
    overlay.hidden = false;
    el('confirmCancel').focus();
  });
}

/* Wired once: askConfirm re-registers these on every call otherwise. */
function initConfirm() {
  el('confirmOk').addEventListener('click', () => confirmConfirm && confirmConfirm());
  el('confirmCancel').addEventListener('click', () => overlayClose('confirmOverlay'));
}

/* Overlay close routines (shared by the X/Esc/outside handlers and the
   back-button popstate path, so both run identical cleanup). */
const closeUploadModal = () => {
  // A row's panel belongs to this dialog, so if one is somehow still open it
  // goes with it. In practice the guards in initUpload and the overlay stack
  // (Escape and the back gesture both reach the panel first) put it away
  // before this runs, so this is the defensive path — and the panel's entry
  // is the one on top, so it is unwound first.
  if (phaseMenuIndex !== null) overlayClose(PICK_MENU_ID);
  el('uploadModalOverlay').hidden = true;
  // Revoke the photo preview object URLs so we do not leak blob memory.
  const p = state.pendingUploads;
  if (p && p.previews) for (const url of p.previews) URL.revokeObjectURL(url);
  state.pendingUploads = null;
};
const closeSortModal = () => { el('sortModalOverlay').hidden = true; };
const closeSettingsModal = () => { el('settingsModalOverlay').hidden = true; };
const closeTagModal = () => { el('tagModalOverlay').hidden = true; state.taggingPath = null; };

/* ── Admin: sign in / out ─────────────────────────────────────── */

function wireStaticEvents() {
  // Bottom tabs
  el('tabPictures').addEventListener('click', () => setView('images'));
  el('tabAlbums').addEventListener('click', () => setView('phases'));

  // ⋮ overflow → bottom sheet
  el('menuBtn').addEventListener('click', mainMenu);
  el('sheetOverlay').addEventListener('click', e => { if (e.target.id === 'sheetOverlay') overlayClose('sheetOverlay'); });

  // Eye-comfort background picker (app bar toggle → bottom sheet)
  el('comfortBtn').addEventListener('click', openComfortPicker);
  el('fontBtn').addEventListener('click', openFontPicker);
  wireFontPopover();
  wireComfortPopover();
  el('comfortOverlay').addEventListener('click', e => { if (e.target.id === 'comfortOverlay') overlayClose('comfortOverlay'); });

  // Admin search (header pill)
  el('adminSearch').addEventListener('input', applyAdminFilter);
  el('adminSearch').addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); e.target.value = ''; applyAdminFilter(); }
  });
  // The scope control is a button now: it opens the view panel, and the
  // panel's tiles write the three preferences and put it away again.
  el('searchViewBtn').addEventListener('click', toggleSearchMenu);
  el('searchMenu').addEventListener('click', e => {
    const tile = e.target && e.target.closest && e.target.closest('.search-tile');
    if (tile) pickSearchOption(tile.dataset.group, tile.dataset.value);
  });
  // A tap anywhere else puts the panel away. The pointerdown also swallows
  // the click it belongs to on a photo card, so dismissing the panel against
  // the wall never opens the viewer as well. The app bar's own buttons do
  // not read that flag, so a tap on ⋮ still lands on ⋮ — the guided tour
  // walks straight through it without a dead first tap.
  document.addEventListener('pointerdown', e => {
    const menu = el('searchMenu');
    if (!menu || menu.hidden) return;
    const t = e.target;
    if (t && t.closest && (t.closest('#searchMenu') || t.closest('#searchViewBtn'))) return;
    state._suppressClickUntil = Date.now() + CLICK_SUPPRESS_MS;
    overlayClose('searchMenu');
  }, { passive: true });

  // Demo FAB + new-album dialog
  el('fabAdd').addEventListener('click', () => pickFiles(null));
  el('newFolderBtn').addEventListener('click', () => {
    const name = sanitizeFilename(el('newFolderName').value).toLowerCase();
    if (!name) return showToast('Enter an album name first.', { type: 'warning' });
    el('newFolderFiles').onchange = (e) => {
      if (e.target.files.length) {
        overlayClose('newAlbumOverlay');
        openUploadConfirm(e.target.files, name);
      }
      el('newFolderName').value = '';
    };
    el('newFolderFiles').click();
  });
  el('newFolderName').addEventListener('keydown', e => { if (e.key === 'Enter') el('newFolderBtn').click(); });
  el('newAlbumCancel').addEventListener('click', () => overlayClose('newAlbumOverlay'));
  el('newAlbumOverlay').addEventListener('click', e => { if (e.target.id === 'newAlbumOverlay') overlayClose('newAlbumOverlay'); });

  // Selection action bar
  el('selectClose').addEventListener('click', () => { exitBatchSelect(); render(); });
  el('selectMove').addEventListener('click', openCategoryModal);
  el('selectDelete').addEventListener('click', batchDeleteSelected);

  // Sign-in modal
  el('tokenCancel').addEventListener('click', () => overlayClose('adminModalOverlay'));
  el('tokenSubmit').addEventListener('click', trySignIn);
  el('tokenInput').addEventListener('keydown', e => { if (e.key === 'Enter') trySignIn(); });
  el('adminModalOverlay').addEventListener('click', e => { if (e.target.id === 'adminModalOverlay') overlayClose('adminModalOverlay'); });

  // Move (sort) modal
  el('sortCancel').addEventListener('click', () => overlayClose('sortModalOverlay'));
  el('sortConfirm').addEventListener('click', performBatchMove);
  el('sortModalOverlay').addEventListener('click', e => { if (e.target.id === 'sortModalOverlay') overlayClose('sortModalOverlay'); });
  el('categoryInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); performBatchMove(); } });

  // Album settings modal
  el('settingsCancel').addEventListener('click', () => overlayClose('settingsModalOverlay'));
  el('settingsModalOverlay').addEventListener('click', e => { if (e.target.id === 'settingsModalOverlay') overlayClose('settingsModalOverlay'); });
  el('settingsPhase').addEventListener('change', () => { el('settingsPhaseRename').value = el('settingsPhase').value; });
  el('settingsRenameBtn').addEventListener('click', renamePhase);
  el('settingsRemoveBtn').addEventListener('click', removePhase);
  el('settingsUndoBtn').addEventListener('click', undoLastChange);
  el('settingsRevertBtn').addEventListener('click', revertAllChanges);
  initConfirm();

  // Upload confirm modal. All three ways out read the dismissal flag, and
  // measured, that is not optional: a panel open in a row makes the dialog
  // taller, the centered card puts its top a little higher, and the press
  // that collapses the panel lands on a *different* element by the time the
  // click is delivered — the copy line's own press was delivered to
  // #uploadModalOverlay in a browser at 412 wide. So the tap that puts a
  // panel away must not also cancel the batch, and must not file it either.
  el('uploadCancel').addEventListener('click', () => {
    if (Date.now() < (state._suppressClickUntil || 0)) return;
    overlayClose('uploadModalOverlay');
  });
  el('uploadConfirm').addEventListener('click', () => {
    if (Date.now() < (state._suppressClickUntil || 0)) return;
    performUploads();
  });
  el('uploadModalOverlay').addEventListener('click', e => {
    if (e.target.id !== 'uploadModalOverlay') return;
    if (Date.now() < (state._suppressClickUntil || 0)) return;
    overlayClose('uploadModalOverlay');
  });
  // The rows' own controls: the chip opens the panel, a tile picks.
  el('uploadPickList').addEventListener('click', e => {
    const t = e.target;
    if (!t || !t.closest) return;
    const chip = t.closest('.pick-chip');
    if (chip) { togglePhaseMenu(Number(chip.dataset.idx)); return; }
    const tile = t.closest('.pick-tile');
    if (tile) pickPhase(Number(tile.dataset.idx), tile.dataset.value);
  });
  // A tap anywhere outside the open row puts its panel away. It raises the
  // dismissal flag too, so the one control that commits — Upload — cannot be
  // reached by a tap that was meant for a panel.
  document.addEventListener('pointerdown', e => {
    if (phaseMenuIndex === null) return;
    const t = e.target;
    if (t && t.closest && t.closest('.pick-row.is-open')) return;
    state._suppressClickUntil = Date.now() + CLICK_SUPPRESS_MS;
    overlayClose(PICK_MENU_ID);
  }, { passive: true });

  // Classify modal
  el('tagCancel').addEventListener('click', () => overlayClose('tagModalOverlay'));
  el('tagSave').addEventListener('click', saveTagModal);
  el('tagModalOverlay').addEventListener('click', e => {
    if (e.target.id === 'tagModalOverlay') overlayClose('tagModalOverlay');
  });

  // Viewer
  el('lightboxClose').addEventListener('click', () => overlayClose('lightbox'));
  el('lightboxPrev').addEventListener('click', () => lightboxStep(-1));
  el('lightboxNext').addEventListener('click', () => lightboxStep(1));
  // The viewer's Download action is the site's single DownloadButton.
  viewerDownload = createDownloadButton({
    href: '',
    label: 'Download',
    variant: 'ghost',
    className: 'dlb-viewer',
    // A confirmed save is a single action, not a batch, so it keeps the
    // default ding. The failed fetch below is an `error` and is heard as
    // one: the two were once the same sound, which is the one distinction
    // here that genuinely needed making.
    onDownloadComplete: () => showToast(`Saved ${viewerDownloadName}`, { type: 'success' }),
    // A failed fetch used to be the muted is-error state alone: 0.55
    // opacity for half a second, then reset. Nothing said the photo had
    // not saved, and a visitor who had just watched it fail could not
    // tell that from the button simply finishing its animation.
    onDownloadError: (err) => showToast(`Could not download ${viewerDownloadName}: ${errWhy(err)}`,
      { type: 'error', sticky: true }),
  });
  el('lightboxDownloadSlot').appendChild(viewerDownload.el);
  el('lightboxTag').addEventListener('click', viewerTag);
  el('lightboxDelete').addEventListener('click', viewerDelete);
  // Tap anywhere on the photo toggles the S10 immersive chrome.
  el('lightboxViewport').addEventListener('click', () => {
    el('lightbox').classList.toggle('chrome-off');
  });

  // Touch swipe gestures for mobile gallery navigation
  const lbElem = el('lightbox');
  let touchStartX = 0;
  let touchStartY = 0;
  lbElem.addEventListener('touchstart', e => {
    if (e.touches && e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }
  }, { passive: true });
  lbElem.addEventListener('touchend', e => {
    if (e.changedTouches && e.changedTouches.length === 1) {
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        if (dx < 0) lightboxStep(1);
        else lightboxStep(-1);
      } else if (dy > 80 && Math.abs(dy) > Math.abs(dx) * 1.4) {
        overlayClose('lightbox');
      }
    }
  }, { passive: true });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const top = overlayStack[overlayStack.length - 1];
      if (top) { overlayClose(top); return; }
      if (!el('lightbox').hidden) closeLightbox(); // file:// has no history entries
      return;
    }
    if (el('lightbox').hidden) return;
    if (e.target && e.target.matches && e.target.matches('input, select, textarea')) return;
    const top = overlayStack[overlayStack.length - 1];
    if (top && top !== 'lightbox') return; // a dialog sits above the viewer
    if (e.key === 'ArrowLeft') lightboxStep(-1);
    if (e.key === 'ArrowRight') lightboxStep(1);
    if ((e.key === 'd' || e.key === 'D') && viewerDownload) viewerDownload.activate();
  });

  // Hero header folds away as the wall scrolls
  let appbarQueued = false;
  window.addEventListener('scroll', () => {
    if (appbarQueued) return;
    appbarQueued = true;
    requestAnimationFrame(() => { appbarQueued = false; syncAppbar(); });
  }, { passive: true });
  // syncAppbar first, so the collapsed class has already moved before
  // anything measures. watchChromeH then re-measures once the fold this
  // triggers has finished animating.
  watchChromeH();
  window.addEventListener('resize', () => { syncAppbar(); syncChromeH(); });
}

async function trySignIn() {
  const token = el('tokenInput').value.trim();
  if (!token) return;
  if (DEMO_MODE) {
    state.token = 'demo';
    state.adminMode = true;
    overlayClose('adminModalOverlay');
    updateAdminUI();
    render();
    showToast('Demo admin session — nothing leaves this browser tab.', { type: 'info' });
    return;
  }
  const submit = el('tokenSubmit');
  submit.disabled = true; submit.textContent = 'Checking…';
  // Only one admin session at a time, shared through the repo: if another
  // admin is already signed in, this token cannot take over.
  if (state.adminSession) {
    el('tokenError').hidden = false;
    el('tokenError').textContent = 'An admin is already signed in — the sign-in option returns when they sign out.';
    submit.disabled = false; submit.textContent = 'Sign in';
    return;
  }
  try {
    const res = await githubFetch(`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error('Token was rejected by GitHub.');
    if (!data.permissions || !data.permissions.push) throw new Error('This token does not have write access to the repo.');
    state.token = token;
    state.adminMode = true;
    state.adminSession = { since: new Date().toISOString() };
    sessionStorage.setItem(TOKEN_KEY, token);
    console.warn('GitHub PAT stored in sessionStorage — do not share screenshots of this console.');
    overlayClose('adminModalOverlay');
    updateAdminUI();
    await refreshMetaSha();
    await persistMetadata();   // publish the shared lock to the repo
    await loadMetadata(true);
    await loadTree(true);
    showToast('Signed in — you can add and remove photos now.', { type: 'success' });
  } catch (err) {
    el('tokenError').hidden = false;
    el('tokenError').textContent = err.message;
  } finally {
    submit.disabled = false; submit.textContent = 'Sign in';
  }
}

async function signOut() {
  state.token = null;
  state.adminMode = false;
  state.adminSession = null;
  exitBatchSelect();
  sessionStorage.removeItem(TOKEN_KEY);
  updateAdminUI();          // the sign-in option reappears immediately
  render();
  if (!DEMO_MODE) await persistMetadata();  // release the shared lock
  showToast('Signed out.', { type: 'info' });
}

function updateAdminUI() {
  // The floating + is the demo-only shortcut. A real session adds through
  // the header ⋮ and the album ⋮ menus, so the button stays out of the
  // way of the wall on the live gallery.
  el('fabAdd').hidden = !(state.adminMode && DEMO_MODE);
  el('searchWrap').hidden = !state.adminMode;
  syncChromeH(); // the search pill changes the app bar height
  if (!state.adminMode) {
    state.batchSelect = false;
    state.batchSelected.clear();
    if (el('adminSearch').value) {
      el('adminSearch').value = '';
      el('adminSearchCount').textContent = '';
    }
  }
  updateSelectBar();
  applyAdminFilter();
}

function closeModal() {
  el('adminModalOverlay').hidden = true;
  el('tokenInput').value = '';
  el('tokenError').hidden = true;
}

function openAdminModal() {
  overlayPush('adminModalOverlay', closeModal);
  el('adminModalOverlay').hidden = false;
  el('tokenInput').focus();
}

/* ── One UI bottom sheet ─────────────────────────────────────────
   The ⋮ menus (header, album covers) are one dynamic sheet: a list of
   icon + label rows built on open. Browser back and tapping the dim
   both close it through the shared overlay registry. */
const ICONS = {
  ellipsis: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
  photoAdd: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M19 7v2.99s-1.99.01-2 0V7h-3s.01-1.99 0-2h3V2h2v3h3v2h-3zm-3 4V8h-3V5H5C3.9 5 3 5.9 3 7v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-8h-3zM5 19l3-4 2 3 3-4 4 5H5z"/></svg>',
  folderAdd: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M20 6h-8l-2-2H4C2.9 4 2 4.9 2 6v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-1 9h-3v3h-2v-3h-3v-2h3V10h2v3h3v2z"/></svg>',
  checkCircle: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
  signOut: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4C2.9 3 2 3.9 2 5v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>',
  signIn: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M11 7 9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5-5-5zm9 12h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z"/></svg>',
  route: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M19 15.18V5c0-1.1-.9-2-2-2H7C5.9 3 5 3.9 5 5v10.18c-1.16.41-2 1.51-2 2.82 0 1.66 1.34 3 3 3s3-1.34 3-3c0-1.3-.84-2.4-2-2.82V7h8v8.18c-1.16.41-2 1.51-2 2.82 0 1.66 1.34 3 3 3s3-1.34 3-3c0-1.31-.84-2.41-2-2.82z"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.47 4.47 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.42.05-.63zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12a9 9 0 0 0-7-8.77v2.06A7 7 0 0 1 19 12zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73L16.73 17.27A6.9 6.9 0 0 1 14 18.73v2.06a9 9 0 0 0 3.69-1.53L19.73 21 21 19.73 4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>',
};

function openSheet(cfg) {
  const list = el('sheetList');
  el('sheetTitle').hidden = !cfg.title;
  if (cfg.title) el('sheetTitle').textContent = cfg.title;
  list.innerHTML = '';
  for (const item of cfg.items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sheet-item' + (item.danger ? ' sheet-item-danger' : '');
    b.setAttribute('role', 'menuitem');
    // Sheet items the guided tour highlights carry the same
    // data-tour-target hook as every other real control.
    if (item.tourTarget) b.setAttribute('data-tour-target', item.tourTarget);
    b.innerHTML = `<span class="sheet-ic">${item.icon || ''}</span><span>${escapeHtml(item.label)}</span>`;
    b.addEventListener('click', () => {
      overlayClose('sheetOverlay');
      if (item.onTap) item.onTap();
    });
    list.appendChild(b);
  }
  overlayPush('sheetOverlay', closeSheet);
  el('sheetOverlay').hidden = false;
}

const closeSheet = () => { el('sheetOverlay').hidden = true; };

/* Header ⋮: everyone gets the notification-sound switch and the
   walkthrough; a visitor also gets sign-in, the admin gets the full
   tool set. The sound row is built from the live flag, so it always
   says what tapping it will do rather than what it did last time. */
function mainMenu() {
  const items = [
    {
      icon: toastSoundOn ? ICONS.soundOn : ICONS.soundOff,
      label: toastSoundOn ? 'Notification sound on' : 'Notification sound off',
      onTap: () => setToastSound(!toastSoundOn),
    },
    { icon: ICONS.play, label: 'Guided tour', onTap: () => { window.location.href = 'tour/'; } },
    ...(state.adminMode ? [
      { icon: ICONS.photoAdd, label: 'Add photos', tourTarget: 'menu-add-photos', onTap: () => pickFiles(null) },
      { icon: ICONS.folderAdd, label: 'New album…', tourTarget: 'menu-new-album', onTap: openNewAlbumModal },
      { icon: ICONS.checkCircle, label: 'Select photos', tourTarget: 'menu-select-photos', onTap: () => enterSelectMode() },
      { icon: ICONS.gear, label: 'Album settings', tourTarget: 'menu-album-settings', onTap: () => openSettingsModal() },
      { icon: ICONS.signOut, label: 'Sign out', tourTarget: 'menu-sign-out', onTap: signOut },
    ] : state.adminSession ? [] : [
      // While another admin holds the shared session there is nothing to offer
      // — the sign-in option returns when they sign out.
      { icon: ICONS.signIn, label: 'Admin sign in', tourTarget: 'menu-admin-signin', onTap: openAdminModal },
    ]),
  ];
  openSheet({ title: DEMO_MODE ? 'Demo data — nothing leaves this tab' : undefined, items });
}

/* Album cover ⋮: quick actions scoped to that one album. */
function albumMenu(folder) {
  openSheet({
    title: albumStageName(folder),
    items: [
      { icon: ICONS.photoAdd, label: 'Add photos', tourTarget: 'album-menu-add-photos', onTap: () => pickFiles(folder) },
      { icon: ICONS.gear, label: 'Album settings', tourTarget: 'album-menu-album-settings', onTap: () => openSettingsModal(folder) },
    ],
  });
}

/* Shared file-picking entry point (FAB, sheet items, album menus). */
function pickFiles(contextFolder) {
  const input = document.createElement('input');
  input.type = 'file'; input.multiple = true; input.accept = 'image/*';
  input.onchange = () => { if (input.files.length) openUploadConfirm(input.files, contextFolder); };
  input.click();
}

function openNewAlbumModal() {
  overlayPush('newAlbumOverlay', closeNewAlbumModal);
  el('newAlbumOverlay').hidden = false;
  el('newFolderName').focus();
}
function closeNewAlbumModal() {
  el('newAlbumOverlay').hidden = true;
  el('newFolderName').value = '';
}

/* ── Admin: upload / delete via the GitHub Contents API ─────────── */

/* ── The upload rows' album picker ──────────────────────────────────
   Each row opens the panel the search pill opens — groups of tiles, the one
   in force marked, closing on a pick, an outside tap, Escape and browser
   back — rather than a native <select>. The native control could not be
   grouped, could not say which stage of the journey an album belongs to,
   and on a phone it opened the platform's own list over the dialog the
   visitor was still reading.

   It opens IN FLOW inside its own row. The dialog already scrolls, so a
   panel that floated would be clipped by that overflow and would cover the
   rows below it — the two things the pill's panel is arranged to avoid.

   ONE category: the albums the journey maps, in journey order. A row is
   asking which phase a file belongs to, and the catch-all is not a phase, so
   there is no "Other" list to scroll past — the journey is the whole of what
   the control decides. The one album that is still offered from outside the
   journey is the album the files were added to (see phaseGroups). */
const PICK_MENU_ID = 'pickMenu';

/* The tiles' labels: the stage name, or the folder name where two offered
   albums share that stage. The rule the Albums tab already uses
   (albumStageName), read against the albums on offer rather than the albums
   on the wall — the survey and its map share Site Survey & Planning, and
   two tiles reading the same words would be a choice nobody can make. */
function phaseLabel(folder, offered = allPhaseOptions()) {
  const j = journeyFor(folder);
  if (!j) return folder;
  for (const other of offered) {
    if (other === folder) continue;
    const o = journeyFor(other);
    if (o && o.stage === j.stage) return folder;
  }
  return j.stage;
}

/* The dropdown's one category: the albums the journey maps, in journey
   order. The journey is what a row is asking about — a file's phase — and
   the General catch-all is not a phase, so it and the albums the journey does
   not map (ppp, really) are not offered.

   The one album that survives from outside the journey is the album the
   files were added to: Add photos on an unmapped album has to leave that
   album selectable, or a mis-tap could not be put back. A mapped context is
   already in the list, so it is never offered twice. */
function phaseGroups(extra) {
  const offered = allPhaseOptions(extra);
  const alpha = (a, b) => a.localeCompare(b, 'en', { numeric: true });
  const journey = (a, b) => (folderSequence(a) - folderSequence(b)) || alpha(a, b);
  const mapped = offered.filter(f => journeyFor(f)).sort(journey);
  const context = extra && !journeyFor(extra) ? [extra] : [];
  return [{ id: 'phase', title: 'Phase', folders: mapped.concat(context) }].filter(g => g.folders.length);
}

let phaseMenuIndex = null;      // the row whose panel is open, or null

const phaseChoice = (i) => {
  const p = state.pendingUploads;
  if (!p || !p.choice) return 'General';
  return p.choice[i] || p.context || 'General';
};

function renderPhaseMenu(i) {
  const p = state.pendingUploads;
  const menu = el('pickMenu-' + i);
  if (!p || !menu) return;
  const offered = allPhaseOptions(p.context);
  const choice = phaseChoice(i);
  menu.innerHTML = phaseGroups(p.context).map(g => `
    <div class="pick-menu-group" role="group" aria-labelledby="pickMenuTitle-${i}-${g.id}">
      <div class="pick-menu-title" id="pickMenuTitle-${i}-${g.id}">${g.title}</div>
      ${g.folders.map(folder => {
        const on = folder === choice;
        const j = journeyFor(folder);
        const title = j ? `${j.stage} · ${folder}` : folder;
        return `<button type="button" class="pick-tile${on ? ' is-active' : ''}" role="option" aria-selected="${on ? 'true' : 'false'}" data-idx="${i}" data-value="${escapeAttr(folder)}" title="${escapeAttr(title)}">
          <span class="pick-tile-art">${j ? j.sequence : ''}</span>
          <span class="pick-tile-label">${escapeHtml(phaseLabel(folder, offered))}</span>
          <svg class="pick-tile-check" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">${TILE_CHECK_PATH}</svg>
        </button>`;
      }).join('')}
    </div>`).join('');
}

/* One writer for the open state, like the pill's: the row, its dropdown box,
   its chip and the list's own hidden flag all follow from the index, so a
   close can never leave a chip claiming to be expanded. */
function setPhaseMenuOpen(i) {
  phaseMenuIndex = i;
  const list = el('uploadPickList');
  if (list && list.classList) list.classList.toggle('is-open', i !== null);
  const rows = list && list.querySelectorAll ? list.querySelectorAll('.pick-row') : [];
  for (const row of rows) {
    const on = i !== null && Number(row.dataset.idx) === i;
    row.classList.toggle('is-open', on);
    const drop = row.querySelector('.pick-drop');
    if (drop) drop.classList.toggle('is-open', on);
    const chip = row.querySelector('.pick-chip');
    if (chip) chip.setAttribute('aria-expanded', on ? 'true' : 'false');
    const menu = row.querySelector('.pick-menu');
    if (menu) menu.hidden = !on;
  }
}

function closePhaseMenu() {
  if (phaseMenuIndex === null) return;
  setPhaseMenuOpen(null);
}

/* One dropdown at a time, on the shared overlay stack so Escape and the back
   gesture put it away before the dialog under it (and the tour's own entries
   keep their order). */
function togglePhaseMenu(i) {
  const menu = el('pickMenu-' + i);
  if (!menu) return;
  if (phaseMenuIndex === i) { overlayClose(PICK_MENU_ID); return; }
  if (phaseMenuIndex !== null) overlayClose(PICK_MENU_ID);
  renderPhaseMenu(i);
  setPhaseMenuOpen(i);
  // The list is capped, so open with the album in force in view: it is the
  // one being changed, and it is not always one of the first few.
  const on = menu.querySelector ? menu.querySelector('.pick-tile.is-active') : null;
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  overlayPush(PICK_MENU_ID, closePhaseMenu);
}

/* One tile picked: the row's choice, the chip that shows it, and the panel
   away. Nothing is uploaded here — performUploads reads the choice back and
   files the file under it. */
function pickPhase(i, folder) {
  const p = state.pendingUploads;
  if (!p || !p.choice) return;
  p.choice[i] = folder;
  const label = phaseLabel(folder, allPhaseOptions(p.context));
  const span = el('pickChipLabel-' + i);
  if (span) span.textContent = label;
  // The chip ellipsizes a long name, so the whole of it stays on the title.
  const chip = el('pickChip-' + i);
  if (chip) chip.setAttribute('title', label);
  overlayClose(PICK_MENU_ID);
}

/* Classify-and-confirm upload flow: every file row gets a phase picker
   prefilled with the algorithm's best guess so you can override per file. */
function openUploadConfirm(fileList, contextFolder) {
  const files = Array.from(fileList);
  const offered = allPhaseOptions(contextFolder);
  // The same prefill the rows have always had, held in state now rather than
  // in a <select>: the classifier's guess, else the album the files were
  // added to, else the General catch-all. A guess that is not on offer would
  // leave the row with nothing to show, so it falls back to General too.
  const choice = files.map(file => {
    const prefill = contextFolder || suggestPhase(file.name) || 'General';
    return offered.includes(prefill) ? prefill : 'General';
  });
  state.pendingUploads = { files, context: contextFolder, choice };
  // A thumbnail of each photo, so the album you pick is the album for *this*
  // picture. The object URLs are revoked when the dialog closes.
  const previews = files.map(file => URL.createObjectURL(file));
  state.pendingUploads.previews = previews;
  el('uploadPickList').innerHTML = files.map((file, i) => {
    const guess = suggestPhase(file.name);
    const j = guess ? journeyFor(guess) : null;
    const hint = guess && guess !== contextFolder
      ? `<span class="pick-hint">suggested: ${escapeHtml(guess)}${j ? ' · ' + escapeHtml(j.stage) : ''}</span>` : '';
    return `<div class="pick-row" data-idx="${i}">
      <img class="pick-preview" src="${previews[i]}" alt="${escapeAttr(file.name)}" loading="lazy">
      <div class="pick-stack">
        <div class="pick-head">
          <span class="pick-name" title="${escapeAttr(file.name)}">${escapeHtml(file.name)}</span>
          <span class="pick-control">
            <div class="pick-drop" data-idx="${i}">
              <button type="button" class="pick-chip" id="pickChip-${i}" data-idx="${i}" aria-haspopup="listbox" aria-expanded="false" aria-label="Album for ${escapeAttr(file.name)}" title="${escapeAttr(phaseLabel(choice[i], offered))}">
                <span class="pick-chip-label" id="pickChipLabel-${i}">${escapeHtml(phaseLabel(choice[i], offered))}</span>
                <svg class="pick-chip-caret" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
              </button>
              <div class="pick-menu" id="pickMenu-${i}" role="listbox" aria-labelledby="pickChip-${i}" hidden></div>
            </div>
          </span>
        </div>
        ${hint}
      </div>
    </div>`;
  }).join('');
  el('uploadConfirm').textContent = `Upload ${files.length}`;
  setPhaseMenuOpen(null);
  overlayPush('uploadModalOverlay', closeUploadModal);
  el('uploadModalOverlay').hidden = false;
}

async function performUploads() {
  const groups = {};
  state.pendingUploads.files.forEach((file, i) => {
    // The row's own choice, written by pickPhase as the tiles are tapped.
    // Nothing reads the DOM: a panel that is open (or was never opened) has
    // no bearing on which album the file is filed under.
    const folder = phaseChoice(i);
    (groups[folder] = groups[folder] || []).push(file);
  });
  overlayClose('uploadModalOverlay');
  // The dialog is closed — the preview object URLs are no longer needed.
  const p = state.pendingUploads;
  if (p && p.previews) for (const url of p.previews) URL.revokeObjectURL(url);
  state.pendingUploads = null;

  let total = Object.values(groups).reduce((a, g) => a + g.length, 0);
  let skipped = 0, failed = 0;
  const failedNames = [];
  // Why each failure happened, first occurrence per distinct reason. The
  // names alone never said anything useful: a file that 422s, 409s or 403s
  // all reported identically as "3 failed: a.jpg, b.jpg", so there was no
  // way to tell a metadata problem from a permission one from a collision.
  const failedReasons = [];

  // Paths already in the gallery → same-name uploads are skipped (a blind PUT
  // would 422 "sha wasn't supplied" and stall the whole batch). Cheap, no API
  // calls; the tree was just fetched.
  const existing = new Set();
  for (const folder of state.order) for (const f of state.folders[folder]) existing.add(f.path);

  for (const [folder, files] of Object.entries(groups)) {
    if (DEMO_MODE) {
      if (!state.folders[folder]) {
        state.folders[folder] = [];
        state.order = Object.keys(state.folders).sort((a, b) =>
          (folderSequence(a) - folderSequence(b)) || a.localeCompare(b, 'en', { numeric: true })
        );
      }
      for (const file of files) {
        const path = `${CONFIG.imagesPath || 'images'}/${folder}/${file.name}`;
        if (existing.has(path)) { skipped++; continue; }
        const src = await fileToDataUrl(file);
        state.folders[folder].push({
          path,
          sha: `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          demoSrc: src,
        });
        existing.add(path);
      }
      continue;
    }
    for (const file of files) {
      try {
        const base64 = await fileToBase64(file);
        const safeName = sanitizeFilename(file.name);
        const path = `${CONFIG.imagesPath}/${folder}/${safeName}`;
        if (existing.has(path)) { skipped++; continue; }
        await githubPut(path, base64, `Add ${safeName} via gallery admin`, { overwrite: false });
        existing.add(path);
        const j = journeyFor(folder);
        // Only an upload into a real journey stage is an explicit
        // classification. Uploads into unmapped folders (General, or a
        // brand-new phase folder) stay unclassified on purpose so the photo
        // surfaces as "Needs Review" until an admin sorts or tags it.
        if (j) state.metadata[path] = { phase: j.stage, activity: '' };
      } catch (err) {
        failed++;
        failedNames.push(file.name);
        const why = errWhy(err);
        if (!failedReasons.includes(why)) failedReasons.push(why);
      }
    }
  }
  const added = total - skipped - failed;
  showToast(skipped || failed
    ? `Added ${added} photo${added === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped — already in the gallery)` : ''}${failureSuffix(failedNames)}.`
    : `Added ${total} photo${total === 1 ? '' : 's'}.`,
    { type: skipped || failed ? 'warning' : 'success' });
  // The names said which files; this says why, which is the half that was
  // missing. One line, first distinct reason — a toast is not a log.
  if (failedReasons.length) {
    showToast(failedReasons.length === 1
      ? `Upload failed: ${failedReasons[0]}`
      : `Upload failed (${failedReasons.length} different reasons) — first: ${failedReasons[0]}`,
      { type: 'error' });
  }
  if (DEMO_MODE) { render(); return; }
  try {
    await persistMetadata();
  } catch (err) {
    showToast(`Photos added, but classification metadata not saved: ${errWhy(err)}`, { type: 'error' });
  }
  await loadTree(true);
}

/* ── Admin: classify a photo (activity metadata) ─────────────────
   Assigning an explicit stage (and optional activity) overrides auto
   classification. The setting is stored in gallery.json, never moves the
   file. "— auto —" removes the override and falls back to the rules. */
function openTagModal(path, pretty) {
  const md = state.metadata[path];
  const img = { path, name: path.split('/').pop(), folder: path.split('/').slice(-2, -1)[0] };
  const c = classifyPhoto(img);
  state.taggingPath = path;
  el('tagName').textContent = pretty;
  el('tagAuto').textContent = `${c.stage || 'Unclassified'} · ${c.confidence} · ${c.reason}${c.activity ? ' · ' + c.activity : ''}`;
  el('tagStage').innerHTML = ['', ...JOURNEY.map(j => j.stage)].map(s =>
    `<option value="${escapeAttr(s)}" ${s === ((md && md.phase) || '') ? 'selected' : ''}>${escapeHtml(s || '— auto —')}</option>`
  ).join('');
  el('tagActivity').value = (md && md.activity) || '';
  el('tagRename').value = path.split('/').pop();
  // Save is disabled while a write is in flight; a dialog opened at any
  // other moment must find it armed.
  const saveBtn = el('tagSave');
  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
  overlayPush('tagModalOverlay', closeTagModal);
  el('tagModalOverlay').hidden = false;
}

function renameDerivedName(itemName, canonicalName, newCanonicalName) {
  const suffix = itemName.slice(basenameStem(canonicalName).length);
  return basenameStem(newCanonicalName) + suffix;
}

async function renamePhoto(path, newName) {
  const safe = sanitizeFilename(newName);
  const oldName = sanitizeFilename(path.split('/').pop());
  if (!safe) return { ok: false, error: 'the new name is empty after clean-up' };
  if (safe === oldName) return { ok: false, error: 'same name' };
  const folder = path.split('/').slice(-2, -1)[0];
  const targetPath = `${CONFIG.imagesPath}/${folder}/${safe}`;
  if ((state.folders[folder] || []).some(f => f.path === targetPath)) return { ok: false, error: `"${safe}" already exists in ${folder}` };

  if (DEMO_MODE) {
    const idx = (state.folders[folder] || []).findIndex(f => f.path === path);
    if (idx === -1) return { ok: false, error: 'photo not found' };
    state.folders[folder][idx] = { ...state.folders[folder][idx], name: safe, path: targetPath };
    if (state.metadata[path] !== undefined) {
      state.metadata[targetPath] = state.metadata[path];
      delete state.metadata[path];
    }
    return { ok: true };
  }

  const asset = state.assets.find(a => a.canonical.path === path);
  const items = asset ? [asset.canonical, ...asset.variants] : [{ path, sha: null, name: path.split('/').pop() }];
  let failed = 0;
  for (const item of items) {
    const newItemPath = `${CONFIG.imagesPath}/${folder}/${renameDerivedName(item.name, path.split('/').pop(), safe)}`;
    try {
      if (asset) {
        const blob = await githubFetch(`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/git/blobs/${item.sha}`, { headers: { Authorization: `Bearer ${state.token}` } });
        if (!blob.ok) throw new Error('could not read source blob');
        const content = (await blob.json()).content;
        await githubPut(newItemPath, content, `Rename ${item.name} → ${newItemPath.split('/').pop()} via gallery admin`, { overwrite: false });
      }
      await githubDelete(item.path, item.sha, `Rename ${item.name} → ${newItemPath.split('/').pop()} via gallery admin`);
    } catch (err) {
      failed++;
      console.error('rename item failed', item, err);
    }
  }
  if (failed) return { ok: false, error: `${failed} file(s) could not be moved` };

  if (state.metadata[path] !== undefined) {
    state.metadata[targetPath] = state.metadata[path];
    delete state.metadata[path];
  }
  return { ok: true };
}

/* A save in flight. One at a time: without this, a second press on Save
   re-enters the function and writes the same metadata twice. */
let tagSaving = false;

/* Put one photo into a folder that does not exist yet, which is how a
   folder comes into being at all. Git has no empty directories, so this is
   create-then-delete: the same pair of calls a move between albums makes,
   wrapped so a failure cannot leave a photo in both places.

   Every member of the asset travels, not just the canonical. Leaving a
   variant behind would split one logical photo across two albums, and the
   next tree load would group the strays back with the original. */
async function moveIntoNewAlbum(path, to) {
  const asset = state.assets.find(a => a.canonical.path === path);
  const items = asset ? [asset.canonical, ...asset.variants] : [];
  if (!items.length) return { ok: false, error: 'That photo is not in the loaded tree.' };
  const from = items[0].path.split('/').slice(-2, -1)[0];
  if (!from) return { ok: false, error: 'Could not tell which album this photo is in.' };
  if (from === to) return { ok: false, error: 'The photo is already in that album.' };

  const moved = [];
  try {
    for (const item of items) {
      const src = await githubFetch(
        `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/git/blobs/${item.sha}`,
        { headers: { Authorization: `Bearer ${state.token}` } });
      if (!src.ok) throw new Error(`could not read ${item.name}`);
      const content = (await src.json()).content;
      await githubPut(`${CONFIG.imagesPath}/${to}/${item.name}`, content,
        `Create album "${to}" with ${item.name} via gallery admin`, { overwrite: false });
      // Only delete the source once the copy exists. Reversing this order
      // loses the photo if the put fails.
      await githubDelete(item.path, item.sha, `File ${item.name} into ${to} via gallery admin`);
      moved.push(item);
    }
  } catch (err) {
    // Roll back the copies that did land, so a half-finished album does not
    // hold duplicates of a photo that is still in the old one. A rollback
    // that itself fails is swallowed: the original error is the one worth
    // reporting, and a second failure here cannot be acted on from here.
    for (const item of moved) {
      try { await githubDelete(`${CONFIG.imagesPath}/${to}/${item.name}`, null, 'Roll back partial album creation via gallery admin'); } catch (_) { /* already reported below */ }
    }
    return { ok: false, error: errWhy(err) };
  }
  return { ok: true, from, to };
}

/* Create the album, move the photo into it, and carry its classification
   across to the new path.

   The metadata move is not optional bookkeeping. gallery.json is keyed by
   path, so a photo that moves without its key follows the folder-name rules
   and lands back on "Needs review" — which is the state the whole feature
   exists to end. Both keys are rewritten together, and the old one removed,
   so nothing is left pointing at a file that is no longer there. */
async function createAlbumFromTag(path, to) {
  const name = path.split('/').pop();
  const toPath = `${CONFIG.imagesPath}/${to}/${name}`;

  if (DEMO_MODE) {
    let moved = null;
    for (const folder of state.order) {
      const hit = (state.folders[folder] || []).findIndex(f => f.path === path);
      if (hit !== -1) { [moved] = state.folders[folder].splice(hit, 1); break; }
    }
    if (!moved) return { ok: false, error: 'That photo is not in the demo gallery.' };
    moved = { ...moved, path: toPath, folder: to };
    (state.folders[to] = state.folders[to] || []).push(moved);
    state.order = Object.keys(state.folders).sort((a, b) =>
      (folderSequence(a) - folderSequence(b)) || a.localeCompare(b, 'en', { numeric: true }));
    const md = state.metadata[path];
    if (md) { state.metadata[toPath] = md; delete state.metadata[path]; }
    render();
    return { ok: true, to, path: toPath };
  }

  const r = await moveIntoNewAlbum(path, to);
  if (!r.ok) return r;

  // The write succeeded, so the file now lives at toPath. Re-key the
  // classification onto it before anything can re-render from stale state.
  const md = state.metadata[path];
  if (md) { state.metadata[toPath] = md; delete state.metadata[path]; }
  return { ok: true, to, path: toPath };
}

async function saveTagModal() {
  if (tagSaving) return;
  const path = state.taggingPath;
  const stageSel = el('tagStage').value;
  // If the user picked a stage, we may need to create its folder.
  // "— auto —" means no explicit stage, so we just save metadata.
  const phase = stageSel || '';
  const activity = el('tagActivity').value.trim();
  const newName = el('tagRename').value.trim();
  if (phase || activity) state.metadata[path] = { phase, activity };
  else delete state.metadata[path];
  overlayClose('tagModalOverlay');

  /* Nothing is said here. The dialog closes and the screen goes quiet until
     the write has actually resolved, and only then does a toast appear —
     carrying the outcome, not the intention.

     This used to open with a progress toast, and it was measurably wrong:
     a toast shown before the write lands is a claim about the future, and
     it is indistinguishable from the one shown after it lands. Two messages
     that look alike and mean opposite things is how an admin ends up
     believing a photo was filed when it was not. Silence is honest, and the
     Save button already says the work is under way. */
  tagSaving = true;
  // The guard above is what makes a double save impossible; disabling the
  // button is what makes it visible. openTagModal() puts it back, so a
  // save that throws mid-flight cannot leave the next dialog's Save dead.
  const saveBtn = el('tagSave');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  let renamedLive = false;
  let renameMsg = '';
  try {
    /* If the selected stage has no folder yet, create it by moving this
       photo into it. This is the same put-then-delete that moving between
       albums uses. The folder name comes from FOLDER_STAGES or a slugified
       stage name. If the folder already exists, we just classify normally. */
    const folder = phase ? stageFolder(phase) : null;
    const hasFolder = folder && (state.folders[folder] || []).length > 0;
    if (folder && !hasFolder) {
      /* The album is created FIRST. If it fails there is nothing to classify
         into, and a classification saved against a folder that does not exist
         is exactly the state that leaves a photo on "Needs review" forever. */
      const r = await createAlbumFromTag(path, folder);
      if (!r.ok) {
        // The photo is where it was and the album does not exist. Say so
        // plainly rather than reporting a save that did not happen.
        reportTagSaveFailed(new Error(r.error));
        return;
      }
      render();
      try { await persistMetadata(); } catch (err) { reportTagSaveFailed(err); return; }
      await loadTree(true);
      showToast(`Created album "${folder}" with this photo.`, { type: 'success', sound: 'success' });
      return;
    }

    if (newName) {
      const r = await renamePhoto(path, newName);
      if (r.ok) {
        renamedLive = !DEMO_MODE;
        renameMsg = renamedLive ? 'renamed.' : 'renamed (demo).';
      } else if (r.error && r.error !== 'same name') {
        renameMsg = `NOT renamed (${r.error}).`;
      }
    }

    if (renamedLive) {
      try {
        await persistMetadata();
        await loadTree(true);
        showToast(`Saved classification — ${renameMsg}`, { type: 'success' });
      } catch (err) {
        reportTagSaveFailed(err);
      }
      return;
    }

    render();
    try {
      await persistMetadata();
      showToast(renameMsg ? `Saved classification — ${renameMsg}` : 'Saved classification.', { type: 'success' });
    } catch (err) {
      reportTagSaveFailed(err);
    }
  } finally {
    tagSaving = false;
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
  }
}

/* A failed write is the one message that must not be missed, so it is
   sticky rather than a 3.2s toast. showToast dismisses whatever is on
   screen before it shows the next one, so an ordinary error toast could
   be replaced by an unrelated message — or simply expire — while the
   visitor was still looking at the dialog that had just closed. */
function reportTagSaveFailed(err) {
  showToast(`Classification NOT saved: ${errWhy(err)}`, { type: 'error', sticky: true });
}

/* ── Admin → Sort: pick photos right on the gallery, then move them all into
   one category. The Done popup is a combobox: pick any existing category or
   type a new one (added on save). Editing the name of an existing category
   creates the new folder and moves the selection there. Moving a photo moves
   its canonical file AND its committed webp variants together. ── */

const availableCategories = () => state.order;

function normalizeCategory(name) {
  return sanitizeFilename(name).toLowerCase();
}

function resolveTarget(rawValue) {
  const value = (rawValue || '').trim();
  const match = availableCategories().find(f => f.toLowerCase() === value.toLowerCase());
  return match || normalizeCategory(value);
}

/* ── Creating an album from the classify dialog ──────────────────────
   The stage dropdown can ask for a new album. That is not a cosmetic
   addition: four of the eleven folders on disk had no FOLDER_STAGES row,
   and a folder with no row can never have its classification saved, so
   those photos sit on "Needs review" forever.

   The awkward part is that git cannot store an empty directory. A folder
   only exists in the tree once something is in it, so "create this album"
   necessarily means "create it and put this photo in it" — the same
   put-then-delete that moving a photo between albums already does. */
/* A folder is an album. Some stages have folders; others don't yet.
   When a photo is classified under a stage that has no folder yet,
   the folder is created by moving the photo into it — the same
   put-then-delete that moving between albums uses. */
function stageFolder(stage) {
  // Inverse of FOLDER_STAGES: stage sequence → folder name.
  // A stage may have multiple folders; pick the first one.
  // If the stage isn't in JOURNEY, slugify it directly.
  const seq = JOURNEY.find(j => j.stage === stage)?.sequence;
  if (seq === undefined) return slugify(stage);
  const folders = Object.keys(FOLDER_STAGES).filter(f => FOLDER_STAGES[f] === seq);
  return folders[0] || slugify(stage);
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/* Selection mode (S10 long-press select). Entry points: the ⋮ menu's
   "Select photos", a long-press on a tile, or a right-click. The contextual
   top bar offers Move (into an album) and Delete, like the phone does. */
function enterSelectMode(path) {
  if (!state.adminMode) return;
  // Tiles live on the Pictures tab — unless a phase is open inline,
  // where selection stays inside that album's grid.
  if (state.view !== 'images' && !state.albumDetail) setView('images');
  state.batchSelect = true;
  if (path) state.batchSelected.add(path);
  render();
}

/* A path used as an ATTRIBUTE VALUE in a selector, not an identifier.
   CSS.escape is for identifiers — it escapes `.` and `/` into `\.` and `\/`,
   and inside `[data-path="…"]` those match a literal backslash followed by
   the character. Every card query built that way matched nothing, so
   selecting a photo updated the state and no badge appeared anywhere.

   Inside a double-quoted attribute value only the quote and the backslash
   itself need escaping. Nothing else. */
function attrSel(value) {
  return String(value).replace(/["\\]/g, '\\$&');
}
/* Every card showing this photo, in either grid. */
function cardsForPath(path) {
  const v = attrSel(path);
  return document.querySelectorAll(
    `#picturesView .card[data-path="${v}"], #albumDetailView .card[data-path="${v}"]`);
}

function toggleBatchSelect(path) {
  if (state.batchSelected.has(path)) state.batchSelected.delete(path);
  else state.batchSelected.add(path);
  const cards = cardsForPath(path);
  // `cards` is the ground truth for whether the tap landed on a card at all.
  // Zero matches means the badge went nowhere, which reads to a visitor as
  // "the wrong card lit up" — so it is recorded rather than swallowed.
  diagTap({
    what: 'select', said: path, resolved: cards.length ? cards[0].dataset.path : null,
    shown: state.batchSelected.has(path), ok: cards.length > 0,
  });
  cards.forEach(card => {
    card.classList.toggle('card-selected', state.batchSelected.has(path));
    const pick = card.querySelector('.card-pick');
    if (pick) pick.textContent = state.batchSelected.has(path) ? '✓' : '';
  });
  updateSelectBar();
}

function updateSelectBar() {
  const on = state.adminMode && state.batchSelect;
  const n = state.batchSelected.size;
  el('selectBar').hidden = !on;
  el('selectCount').textContent = `${n} selected`;
  el('selectMove').disabled = n === 0;
  el('selectDelete').disabled = n === 0;
  document.body.classList?.toggle('is-selecting', on);
  syncChromeH();
}

function exitBatchSelect() {
  state.batchSelect = false;
  state.batchSelected.clear();
  updateSelectBar();
}

/* Batch delete, mirroring removePhase: every selected asset goes with all of
   its committed variants; failures are reported once at the end. */
async function batchDeleteSelected() {
  const paths = [...state.batchSelected];
  if (!paths.length) return;
  // One card per path, resolved before the confirmation opens so the flight
  // has its tiles to clone from — the dialog sits there while you read it,
  // and the grid underneath can be scrolled or re-rendered in that time —
  // and so a failure can put that same tile back.
  const cards = paths.map(p => cardsForPath(p)[0] || null);

  const ok = await askConfirm({
    title: paths.length === 1 ? 'Delete 1 photo?' : `Delete ${paths.length} photos?`,
    body: paths.length === 1
      ? `<strong>${escapeHtml(prettyName(paths[0].split('/').pop()))}</strong> will be removed from the archive. You can undo this from the message that follows.`
      : `All <span class="confirm-count">${paths.length} photos</span> you selected will be removed from the archive. You can undo this from the message that follows.`,
    okLabel: paths.length === 1 ? 'Delete photo' : `Delete ${paths.length} photos`,
    // The selection is swallowed into the bin in the dialog while the
    // dialog is still up; the loop below starts once it has closed.
    // The tile's own <img> is what flies: it is the already-decoded
    // thumbnail, and it is what .is-eaten fades, so the tile keeps its box.
    onAccept: () => playTrashEat(el('confirmBin'),
      cards.filter(Boolean).map(c => ({ node: c.querySelector('.card-img') || c })))
  });
  if (!ok) return;

  if (DEMO_MODE) {
    for (const folder of state.order) {
      state.folders[folder] = state.folders[folder].filter(f => !state.batchSelected.has(f.path));
    }
    exitBatchSelect();
    render();
    showToast(`Deleted ${paths.length} photo${paths.length === 1 ? '' : 's'} (demo).`, { type: 'success' });
    return;
  }

  // The bin performed on the selection inside the confirmation, while the
  // dialog was up. The loop below runs once it has closed.
  let failed = 0;
  const failedNames = [];
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    // The whole asset, same as the single-photo path — see assetItemsFor.
    const items = assetItemsFor(path);
    try {
      for (const item of items) {
        await githubDelete(item.path, item.sha, `Remove ${item.name} via gallery admin`);
      }
    } catch (err) {
      failed++;
      failedNames.push(path.split('/').pop());
      eatRestore([cards[i] && cards[i].querySelector('.card-img')]);
    }
  }
  exitBatchSelect();
  showToast(failed
    ? `Deleted ${done - failed} photo${done - failed === 1 ? '' : 's'}${failureSuffix(failedNames)}.`
    : `Deleted ${done} photo${done === 1 ? '' : 's'}.`,
    { type: failed ? 'warning' : 'success', undo: failed ? null : undoLastChange });
  await loadTree(true);
}

function openCategoryModal() {
  const n = state.batchSelected.size;
  if (!n) return;
  const options = availableCategories().map(folder => {
    const j = journeyFor(folder);
    const label = j ? `${j.stage}${folder !== j.stage ? ` (${folder})` : ''}` : folder;
    return `<option value="${escapeAttr(folder)}">${escapeHtml(label)}</option>`;
  }).join('');
  el('categoryDatalist').innerHTML = options;
  el('categoryInput').value = '';
  el('sortModalCopy').textContent = `${n} photo${n === 1 ? '' : 's'} selected — pick a category or type a new one, then Save:`;
  el('sortPickList').innerHTML = [...state.batchSelected].map(path =>
    `<div class="pick-row"><span class="pick-name" title="${escapeAttr(path)}">${escapeHtml(path)}</span></div>`
  ).join('');
  overlayPush('sortModalOverlay', closeSortModal);
  el('sortModalOverlay').hidden = false;
  el('categoryInput').focus();
}

async function performBatchMove() {
  const to = resolveTarget(el('categoryInput').value);
  const paths = [...state.batchSelected];
  if (!to) { showToast('Type or pick a category first.', { type: 'warning' }); return; }
  overlayClose('sortModalOverlay');
  if (!paths.length) { exitBatchSelect(); render(); return; }

  if (DEMO_MODE) {
    // In-memory re-file, creating the category folder if it's brand-new.
    let n = 0;
    for (const path of paths) {
      let moved = null;
      for (const folder of state.order) {
        const hit = (state.folders[folder] || []).findIndex(f => f.path === path);
        if (hit !== -1) { [moved] = state.folders[folder].splice(hit, 1); break; }
      }
      if (!moved) continue;
      moved = { ...moved, path: `${CONFIG.imagesPath}/${to}/${moved.name}`, folder: to };
      (state.folders[to] = state.folders[to] || []).push(moved);
      n++;
    }
    state.order = Object.keys(state.folders).sort((a, b) =>
      (folderSequence(a) - folderSequence(b)) || a.localeCompare(b, 'en', { numeric: true })
    );
    exitBatchSelect();
    render();
    showToast(n ? `Moved ${n} photo${n === 1 ? '' : 's'} into ${to} (demo).` : `Nothing to move into ${to} (demo).`,
      { type: n ? 'success' : 'warning' });
    return;
  }

  let done = 0, failed = 0, collided = 0;
  const failedNames = [];
  for (const path of paths) {
    const asset = state.assets.find(a => a.canonical.path === path);
    const items = asset ? [asset.canonical, ...asset.variants] : [];
    const from = items.length ? items[0].path.split('/').slice(-2, -1)[0] : '';
    if (!items.length || !from || from === to) { done++; continue; }
    const collides = items.some(item =>
      (state.folders[to] || []).some(f => f.path === `${CONFIG.imagesPath}/${to}/${item.name}`)
    );
    if (collides) { collided++; done++; showToast(`Skipped ${items[0].name} — ${to} already has that name.`, { type: 'warning', sticky: true }); continue; }
    try {
      for (const item of items) {
        const src = await githubFetch(`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/git/blobs/${item.sha}`, { headers: { Authorization: `Bearer ${state.token}` } });
        if (!src.ok) throw new Error('could not read source blob');
        const content = (await src.json()).content;
        await githubPut(`${CONFIG.imagesPath}/${to}/${item.name}`, content, `Sort ${item.name} into ${to} via gallery admin`, { overwrite: false });
        await githubDelete(item.path, item.sha, `Sort ${item.name} out of ${from} via gallery admin`);
      }
    } catch (err) {
      failed++;
      failedNames.push(items[0].name);
    }
  }
  exitBatchSelect();
  const moved = done - failed - collided;
  showToast(failed || collided
    ? `Moved ${moved} photo${moved === 1 ? '' : 's'} into ${to}${failureSuffix(failedNames)}${collided ? ` (${collided} skipped — name already there)` : ''}.`
    : `Moved ${done} photo${done === 1 ? '' : 's'} into ${to}.`,
    // A clean batch reports a count, and reporting a count is the
    // difference from a single action: more happened, so it gets the
    // wider voice. A partial one stays on the default — it is a warning,
    // and a warning that sounded like a triumph would be worse than none.
    { type: failed || collided ? 'warning' : 'success', sound: failed || collided ? undefined : 'success' });
  await loadTree(true);
}

/* ── Admin → Phase settings (gear icon): rename or remove a whole phase.
   Both operate on every photo in the category — canonical + its committed
   variants — and both keep gallery.json metadata in sync. ── */

function openSettingsModal(preselect) {
  const options = availableCategories().map(folder => {
    const j = journeyFor(folder);
    const label = j ? `${j.stage}${folder !== j.stage ? ` (${folder})` : ''}` : folder;
    return `<option value="${escapeAttr(folder)}">${escapeHtml(label)}</option>`;
  }).join('');
  el('settingsPhase').innerHTML = options;
  if (preselect && availableCategories().includes(preselect)) {
    el('settingsPhase').value = preselect;
  }
  el('settingsPhaseRename').value = '';
  overlayPush('settingsModalOverlay', closeSettingsModal);
  el('settingsModalOverlay').hidden = false;
  el('settingsPhase').focus();
}

async function renamePhase() {
  const from = el('settingsPhase').value;
  const to = normalizeCategory(el('settingsPhaseRename').value);
  if (!from) return showToast('Pick a phase first.', { type: 'warning' });
  if (!to) return showToast('Type a new name for the phase.', { type: 'warning' });
  if (to === from) return showToast('New name matches the current phase.', { type: 'warning' });
  if (availableCategories().includes(to)) return showToast(`A phase named "${to}" already exists.`, { type: 'warning' });
  const photos = (state.folders[from] || []).length;
  if (!photos) return showToast(`Nothing to rename in "${from}".`, { type: 'warning' });
  overlayClose('settingsModalOverlay');

  const oldPrefix = `${CONFIG.imagesPath}/${from}/`;

  if (DEMO_MODE) {
    state.folders[to] = state.folders[from].map(f => ({ ...f, folder: to, path: `${CONFIG.imagesPath}/${to}/${f.name}` }));
    delete state.folders[from];
    const md = Object.keys(state.metadata);
    for (const key of md) if (key.startsWith(oldPrefix)) {
      state.metadata[`${CONFIG.imagesPath}/${to}/${key.slice(oldPrefix.length)}`] = state.metadata[key];
      delete state.metadata[key];
    }
    state.order = Object.keys(state.folders).sort((a, b) =>
      (folderSequence(a) - folderSequence(b)) || a.localeCompare(b, 'en', { numeric: true })
    );
    render();
    showToast(`Renamed "${from}" to "${to}" (demo).`, { type: 'success' });
    return;
  }

  const affected = state.assets.filter(a => a.folder === from);
  let failed = 0;
  const failedNames = [];
  for (const asset of affected) {
    try {
      for (const item of [asset.canonical, ...asset.variants]) {
        const src = await githubFetch(`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/git/blobs/${item.sha}`, { headers: { Authorization: `Bearer ${state.token}` } });
        if (!src.ok) throw new Error('could not read source blob');
        const content = (await src.json()).content;
        await githubPut(`${CONFIG.imagesPath}/${to}/${item.name}`, content, `Rename phase ${from} → ${to} via gallery admin`, { overwrite: false });
        await githubDelete(item.path, item.sha, `Rename phase ${from} → ${to} via gallery admin`);
      }
    } catch (err) {
      failed++;
      failedNames.push(asset.canonical.name);
    }
  }
  // Remap metadata keys from the old folder to the new one, then persist.
  const md = Object.keys(state.metadata);
  for (const key of md) if (key.startsWith(oldPrefix)) {
    state.metadata[`${CONFIG.imagesPath}/${to}/${key.slice(oldPrefix.length)}`] = state.metadata[key];
    delete state.metadata[key];
  }
  try {
    await persistMetadata();
  } catch (err) {
    showToast(`Photos renamed, but metadata not saved: ${errWhy(err)}`, { type: 'error' });
  }
  showToast(failed ? `Renamed "${from}" to "${to}"${failureSuffix(failedNames)}.` : `Renamed "${from}" to "${to}".`,
    { type: failed ? 'warning' : 'success', sound: failed ? undefined : 'success' });
  await loadTree(true);
}

async function removePhase() {
  const folder = el('settingsPhase').value;
  if (!folder) return showToast('Pick a phase first.', { type: 'warning' });
  const photos = (state.folders[folder] || []).length;
  if (!photos) return showToast(`"${folder}" is empty — nothing to remove.`, { type: 'warning' });
  const ok = await askConfirm({
    title: `Remove "${folder}"?`,
    body: `The album <strong>${escapeHtml(folder)}</strong> and all `
      + `<span class="confirm-count">${photos} photo${photos === 1 ? '' : 's'}</span> inside it will be removed from the archive. You can undo this from the message that follows.`,
    okLabel: 'Remove album',
    // The bin takes the album card — the object being removed, not the word
    // on the button — while this dialog is still up. The card is looked up
    // here rather than before the dialog opened, because the settings modal
    // has stepped out of the way and the wall behind the question can change
    // while it is being read. It flies as a clone rather than lifted, because
    // it has to keep its place in the grid until the album is really gone.
    // If the tab is not on screen there is nothing to fly and the album is
    // simply removed, same as any off-screen photo.
    onAccept: () => {
      const albumCard = document.querySelector(
        `#albumsView .album[data-folder="${attrSel(folder)}"]`);
      return playTrashEat(el('confirmBin'), albumCard ? [{ node: albumCard }] : []);
    }
  });
  if (!ok) return;
  overlayClose('settingsModalOverlay');

  const prefix = `${CONFIG.imagesPath}/${folder}/`;

  if (DEMO_MODE) {
    for (const key of Object.keys(state.metadata)) if (key.startsWith(prefix)) delete state.metadata[key];
    delete state.folders[folder];
    state.order = Object.keys(state.folders).sort((a, b) =>
      (folderSequence(a) - folderSequence(b)) || a.localeCompare(b, 'en', { numeric: true })
    );
    render();
    showToast(`Removed phase "${folder}" (demo).`, { type: 'success' });
    return;
  }

  const affected = state.assets.filter(a => a.folder === folder);
  let failed = 0;
  // The bar counts files, not photos. One asset is its canonical plus its
  // generated variants, so a phase of forty photos is well over forty
  // requests, and a bar counting the photos would sit at 100% for most of
  // the work it is meant to be reporting on.
  const files = affected.reduce((n, a) => n + 1 + a.variants.length, 0);
  for (const asset of affected) {
    for (const item of [asset.canonical, ...asset.variants]) {
      try {
        await githubDelete(item.path, item.sha, `Remove phase ${folder} via gallery admin`);
      } catch (err) {
        failed++;
        showToast(`Failed: ${item.name} — ${errWhy(err)}`, { type: 'error', sticky: true });
      }
      // After the try rather than inside it: the bar reports requests
      // finished, and a failed one is finished too.
    }
  }
  for (const key of Object.keys(state.metadata)) if (key.startsWith(prefix)) delete state.metadata[key];
  try {
    await persistMetadata();
  } catch (err) {
    showToast(`Photos removed, but metadata not saved: ${errWhy(err)}`, { type: 'error' });
  }
  showToast(failed ? `Removed "${folder}" (${failed} files failed).` : `Removed "${folder}".`,
    { type: failed ? 'warning' : 'success', undo: failed ? null : undoLastChange });
  await loadTree(true);
}

/* ── Admin → Phase settings · history undo/revert.
   Every admin action lands as a commit whose message ends with
   "via gallery admin". Undo diffs the tree against the PARENT of the
   newest admin commit (the state just before that action) and rewinds
   only the images/ folder and gallery.json. Revert all diffs against
   the parent of the OLDEST admin commit — the original seed state the
   gallery started from. ── */

const ADMIN_MARKER = 'via gallery admin';

function isAdminCommit(rawCommit) {
  const msg = ((rawCommit && (rawCommit.commit || rawCommit).message) || '').trim();
  return msg.includes(ADMIN_MARKER);
}

function scopeEntries(entries, imagesPath) {
  const map = {};
  for (const ent of entries || []) {
    if (ent.type !== 'blob') continue;
    if (ent.path === 'gallery.json' || ent.path.startsWith(`${imagesPath}/`)) map[ent.path] = ent.sha;
  }
  return map;
}

function planRestore(currentMap, targetMap) {
  const cur = currentMap || {};
  const tgt = targetMap || {};
  const put = [], remove = [];
  for (const path of Object.keys(tgt).sort()) {
    if (cur[path] !== tgt[path]) put.push({ path, sha: tgt[path] });
  }
  for (const path of Object.keys(cur).sort()) {
    if (!(path in tgt)) remove.push({ path, sha: cur[path] });
  }
  return { put, remove };
}

async function headCommit() {
  const res = await githubFetch(
    `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/commits/${CONFIG.branch}`,
    { headers: { Authorization: `Bearer ${state.token}` } }
  );
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).message) || `Could not read ${CONFIG.branch}.`);
  return res.json();
}

async function commitLog() {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const res = await githubFetch(
      `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/commits?sha=${CONFIG.branch}&per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${state.token}` } }
    );
    if (!res.ok) throw new Error('Could not read commit history.');
    const pageData = await res.json();
    all.push(...pageData);
    if (pageData.length < 100) break;
  }
  return all;
}

async function treePathMap(commitSha) {
  const res = await githubFetch(
    `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/git/trees/${commitSha}?recursive=1`,
    { headers: { Authorization: `Bearer ${state.token}` } }
  );
  if (!res.ok) throw new Error('Could not read the source tree.');
  const data = await res.json();
  return scopeEntries(data.tree, CONFIG.imagesPath);
}

async function applyRestore(plan, label) {
  const total = plan.put.length + plan.remove.length;
  if (!total) return showToast('Nothing to change — that state is already back.', { type: 'info' });
  let failed = 0;
  const failedNames = [];
  const headers = { Authorization: `Bearer ${state.token}` };
  for (const { path, sha } of plan.put) {
    try {
      const blob = await githubFetch(`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/git/blobs/${sha}`, { headers });
      if (!blob.ok) throw new Error('could not read file');
      const content = (await blob.json()).content;
      await githubPut(path, content, `${label} ${ADMIN_MARKER}`, { overwrite: true });
    } catch (err) {
      failed++;
      failedNames.push(path);
    }
  }
  for (const { path, sha } of plan.remove) {
    try {
      await githubDelete(path, sha, `${label} ${ADMIN_MARKER}`);
    } catch (err) {
      failed++;
      failedNames.push(path);
    }
  }
  showToast(failed ? `${label} done${failureSuffix(failedNames)}.` : `${label} done.`,
    { type: failed ? 'warning' : 'success' });
  await loadTree(true);
}

async function undoLastChange() {
  if (DEMO_MODE) return showToast('Undo puts the archive back — it only works on the live gallery.', { type: 'warning' });
  try {
    const head = await headCommit();
    if (!isAdminCommit(head)) return showToast('The last change was not made from the gallery, so there is nothing to undo here.', { type: 'warning' });
    const parent = head.parents && head.parents[0];
    if (!parent) return showToast('There is no earlier commit to undo to.', { type: 'warning' });
    const cur = await treePathMap(head.sha);
    const tgt = await treePathMap(parent.sha);
    await applyRestore(planRestore(cur, tgt), 'Undo');
  } catch (err) {
    showToast(`Could not undo: ${errWhy(err)}`, { type: 'error' });
  }
}

async function revertAllChanges() {
  if (DEMO_MODE) return showToast('Reverting puts the archive back — it only works on the live gallery.', { type: 'warning' });
  try {
    const log = await commitLog();
    let oldestAdmin = -1;
    for (let i = 0; i < log.length; i++) if (isAdminCommit(log[i])) oldestAdmin = i;
    if (oldestAdmin === -1) return showToast('Nothing was changed from the gallery yet — nothing to revert.', { type: 'warning' });
    const baseline = log[oldestAdmin].parents && log[oldestAdmin].parents[0];
    if (!baseline) return showToast('Could not find the original gallery state.', { type: 'error' });
    const adminChanges = log.filter(c => isAdminCommit(c)).length;
    const ok = await askConfirm({
      title: 'Revert every change?',
      body: `This puts the gallery back to how it started, undoing `
        + `<span class="confirm-count">${adminChanges} change${adminChanges === 1 ? '' : 's'}</span> `
        + `made from the gallery since it began — every photo added, removed, renamed or moved. `
        + `Photos added outside the gallery are left alone.`,
      okLabel: 'Revert everything'
    });
    if (!ok) return;
    const cur = await treePathMap(log[0].sha);
    const tgt = await treePathMap(baseline.sha);
    await applyRestore(planRestore(cur, tgt), 'Revert all');
  } catch (err) {
    showToast(`Could not revert all: ${errWhy(err)}`, { type: 'error' });
  }
}

/* ── The photo-eating trash ─────────────────────────────────────────
   Presentation only. It runs between the confirmation and the commit
   and never touches the network: deleteImage and batchDeleteSelected
   remain the only things that actually delete anything.

   Sequence: lid hinges up, a temporary clone of the photo leaves the
   exact box the photo occupies, shrinks and tips into the mouth, the
   lid shuts, and the existing deletion proceeds. The real node is
   faded with .is-eaten (opacity only, so the tile keeps its box and
   nothing reflows) and the class is dropped again if the delete
   fails, which puts the photo back untouched. */
const EAT_MAX_CLONES = 60;   // a whole selection is eaten, not the first dozen
const EAT_ANIM_ID = 'gallery-eat';   // lets updateLightbox cancel only our flight
const EAT_FLIGHT = 520;      // slow enough to actually watch: the whole point
const EAT_STAGGER = 60;      // max gap between two photos entering
const EAT_SPREAD = 220;      // …but the whole batch lands inside this window
let eatRunning = false;
let eatAnims = [];          // live, so a restore can cancel a filled flight

const eatPause = (ms) => new Promise(r => setTimeout(r, ms));

/* The can's mouth: the middle of the icon, just under the lid. Read
   once, with everything else, before a single write. */
function eatMouth(btn) {
  const icon = btn.querySelector('.trash') || btn;
  const r = icon.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height * 0.34 };
}

/* A settled stand-in for whatever is being eaten, matching the box it
   occupies. Two shapes:
     - an <img> (a photo) keeps the tile's crop and corner radius. Its src
       is the thumbnail already decoded for that tile, so no new bytes.
     - anything else (an album card) is deep-cloned whole, so it still reads
       as the object it was, then made inert — a live copy carrying ids or
       its own buttons would duplicate controls and screen-reader output. */
function eatClone(node, rect) {
  const isImg = node.tagName === 'IMG';
  let el;
  if (isImg) {
    el = document.createElement('img');
    el.src = node.currentSrc || node.src;
    // Async, deliberately: "sync" forces the decode onto the main thread
    // at paint time, which showed up as a 230 ms frame at the start of
    // the flight. There is no reason to block the thread for it.
    el.decoding = 'async';
    el.alt = '';
    el.className = 'eat-clone eat-clone-img';
    // Copy the crop rather than assume it. A tile is object-fit: cover, but
    // the viewer shows a full photo as contain — cloning that one into the
    // default cover would crop the photo at the very moment it starts flying,
    // so the thing you watched shrink was not the thing on screen.
    const fit = getComputedStyle(node);
    if (fit.objectFit) el.style.objectFit = fit.objectFit;
    if (fit.objectPosition) el.style.objectPosition = fit.objectPosition;
  } else {
    el = node.cloneNode(true);
    el.classList.add('eat-clone');
    el.removeAttribute('data-tour-target');
    el.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    el.querySelectorAll('button, a, input, select, textarea').forEach(n => {
      n.setAttribute('tabindex', '-1');
      if ('disabled' in n) n.disabled = true;
      if (n.tagName === 'A') n.removeAttribute('href');
    });
  }
  el.setAttribute('aria-hidden', 'true');
  const radius = getComputedStyle(node).borderRadius;
  if (radius) el.style.borderRadius = radius;
  el.style.left = rect.left + 'px';
  el.style.top = rect.top + 'px';
  el.style.width = rect.width + 'px';
  el.style.height = rect.height + 'px';
  return el;
}

/* animation.finished is the real signal; the timeout is only there so a
   dropped frame, a cancelled animation or an element removed mid-flight
   cannot wedge the delete forever. */
function eatSettle(anim, ms) {
  return Promise.race([anim.finished.catch(() => {}), eatPause(ms)]);
}

/* Lift a node out of its layout and into the flight layer, which sits above
   the modals — without re-decoding it.

   The bin lives in the confirmation dialog, which is a z-above-modal surface,
   while the photo being eaten is usually under it: a viewer photo at 95, a
   grid tile at almost nothing. Animating a node in place therefore flies it
   straight *behind* the dialog, which reads as the photo simply vanishing
   rather than going in. Nothing inside a lower stacking context can be raised
   past it, so the node has to move.

   Moving it rather than cloning it is the point: the same element keeps its
   decoded bitmap, so a full-screen photo is not rasterised a second time. A
   placeholder stands in so the layout it came out of does not close the gap,
   and the node goes back exactly where it was when the flight ends. */
function eatFloat(node, layer, rect) {
  const parent = node.parentNode;
  const ghost = document.createElement('div');
  ghost.className = node.className;           // same box, no image behind it
  ghost.setAttribute('aria-hidden', 'true');
  const css = node.style.cssText;
  parent.insertBefore(ghost, node);

  const fitted = getComputedStyle(node);
  node.style.cssText = css + ';position:absolute;margin:0;transition:none;'
    + `left:${rect.left}px;top:${rect.top}px;`
    + `width:${rect.width}px;height:${rect.height}px;`
    + `object-fit:${fitted.objectFit || 'cover'};`
    + `object-position:${fitted.objectPosition || '50% 50%'};will-change:transform,opacity;`;
  // The bin's mouth is inside a dialog, so the carrier has to paint above it.
  node.style.zIndex = '1';
  layer.appendChild(node);

  return {
    node,
    drop() {
      node.style.cssText = css;
      if (parent.isConnected) parent.insertBefore(node, ghost);
      ghost.remove();
    },
  };
}

/* sources: [{ node }] — the nodes whose photos are being eaten.
   opts.live flies the node itself, lifted into the flight layer, instead of a
   clone: the viewer uses it, because #lightboxImg is already decoded and
   re-rasterising a full-screen bitmap mid-delete is exactly the frame this
   must not drop. Cards cannot — they have to stay in the grid — so they fly
   as a clone. Either way the carrier ends up over the dialog, which is where
   the bin is. */
async function playTrashEat(host, sources, opts = {}) {
  const nodes = (sources || []).map(s => s.node).filter(n => n && n.isConnected);
  if (!host || !nodes.length || eatRunning) return;
  const live = !!opts.live;
  eatRunning = true;
  // `host` is whatever holds the bin — a button, or the confirmation
  // dialog's #confirmBin. It carries the lid and gulp states, and the
  // mouth. Disabling only makes sense when it is actually a button; askConfirm
  // disables its own Confirm while the swallow plays.
  const isButton = host.tagName === 'BUTTON';
  const wasDisabled = isButton && host.disabled;
  if (isButton) host.disabled = true;        // no second flight, no double submit
  host.dataset.running = 'true';
  const layer = eatLayer();
  const drops = [];          // the lifted nodes' way home; read by `finally`
  try {
    // Measure everything up front — boxes, mouths and radii — so the
    // flight below is pure writes and never re-reads layout mid-animation.
    const rects = nodes.map(n => n.getBoundingClientRect());
    const mouth = eatMouth(host);

    if (reduceMotion()) {
      // No lid, no flight: the photo's own fade is the whole effect.
      nodes.forEach(n => n.classList.add('is-eaten'));
      await eatPause(180);
      return;
    }

    // Only photos actually on screen get to fly. A tile scrolled far out
    // of view would launch its clone from off-screen — an invisible flight
    // and a wasted node — so those just fade with the rest.
    const vh = window.innerHeight, vw = window.innerWidth;
    const flying = nodes.map((n, i) => i).filter(i => {
      const r = rects[i];
      return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw
        && r.width > 0 && r.height > 0;
    }).slice(0, EAT_MAX_CLONES);

    // Stage the carriers first, invisible and un-animated, so the browser has
    // them ready before anything moves — otherwise the decode lands on the
    // flight's first frame. A card cannot leave the grid, so it flies as a
    // clone; a photo that can be lifted comes along itself, decoded bitmap
    // and all. Either way it ends up in the flight layer, over the dialog.
    const carriers = flying.map(i => {
      if (live) {
        const carrier = eatFloat(nodes[i], layer, rects[i]);
        drops.push(carrier);
        return carrier.node;
      }
      const clone = eatClone(nodes[i], rects[i]);
      clone.style.opacity = '0';
      layer.appendChild(clone);
      return clone;
    });

    // The lid starts opening and the flight starts with it. Waiting for the
    // hinge before launching would only add dead time to the tap.
    host.classList.add('is-eating');
    await Promise.race([
      Promise.all(carriers.map(c => c.decode ? c.decode().catch(() => {}) : Promise.resolve())),
      eatPause(500)
    ]);

    const anims = [];
    // Stagger, but bounded: a 40-photo selection still finishes together
    // instead of trickling in for two seconds. The tap has to feel instant.
    const step = Math.min(EAT_STAGGER, EAT_SPREAD / Math.max(1, carriers.length - 1));
    carriers.forEach((carrier, i) => {
      if (carrier.style) carrier.style.opacity = '';
      const rect = rects[flying[i]];
      const dx = mouth.x - (rect.left + rect.width / 2);
      const dy = mouth.y - (rect.top + rect.height / 2);
      const tilt = (i % 2 ? 1 : -1) * (5 + (i % 3) * 3);
      // The photo stays whole and fully opaque the whole way down — it only
      // fades once it is inside the mouth. Fading it while it was still in
      // the open is what made this read as vanishing, not as being eaten.
      const anim = carrier.animate([
        { transform: 'translate(0px,0px) rotate(0deg) scale(1)', opacity: 1, offset: 0 },
        { transform: `translate(${dx * 0.5}px,${dy * 0.34 - 14}px) rotate(${tilt * 0.5}deg) scale(0.44)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx * 0.92}px,${dy * 0.88}px) rotate(${tilt * 0.85}deg) scale(0.16)`, opacity: 1, offset: 0.86 },
        { transform: `translate(${dx}px,${dy}px) rotate(${tilt}deg) scale(0.05)`, opacity: 0, offset: 1 }
      ], {
        id: EAT_ANIM_ID,
        duration: EAT_FLIGHT,
        delay: i * step,
        easing: 'cubic-bezier(.32,.02,.28,1)',
        fill: 'forwards'
      });
      eatAnims.push(anim);
      carrier.__eatAnim = anim;      // eatRestore cancels only this photo
      anims.push(eatSettle(anim, EAT_FLIGHT + 400 + i * step));
      // A clone owns itself and goes when the flight ends. A lifted node does
      // not: it is the real photo, and eatDrop is what puts it back.
      if (!live) anim.finished.then(() => carrier.remove(), () => carrier.remove());
    });

    // The photo is in the bin; fade the node it came from, but only
    // once it has actually landed. The gulp and the lid shutting happen
    // together — the bin takes the weight of the photo as it swallows it
    // rather than a beat afterwards.
    await Promise.all(anims);
    nodes.forEach(n => n.classList.add('is-eaten'));
    // The bin closes around the photo: the lid shuts and the gulp fires
    // together, and the gulp is held for its own length — it is the last
    // thing on screen before the dialog goes, so it has to be seen.
    host.classList.remove('is-eating');
    host.classList.add('is-gulp');
    await eatPause(280);
    host.classList.remove('is-gulp');
  } catch (err) {
    // A presentation fault must never stop a deletion the user asked for.
    console.warn('Trash animation failed; deleting anyway.', err);
  } finally {
    // Cancel rather than leave a filled animation behind: the resting state
    // is .is-eaten, and a lingering fill would scale the next photo down.
    eatAnims.forEach(a => { try { a.cancel(); } catch (e) { /* already gone */ } });
    eatAnims = [];
    eatRunning = false;
    delete host.dataset.running;
    host.classList.remove('is-eating', 'is-gulp');
    if (isButton) host.disabled = wasDisabled;
    // Lifted nodes go home before the layer is swept, or the sweep would take
    // the real photo with the clones and leave a hole where it used to be.
    drops.forEach(d => d.drop());
    layer.textContent = '';
  }
}

function eatLayer() {
  let layer = el('eatLayer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'eatLayer';
    layer.className = 'eat-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
  }
  return layer;
}

/* Put a photo back after a delete that did not land. Cancelling matters
   as much as dropping .is-eaten: the flight holds a forwards fill, so
   without it the photo would come back shrunk. Scoped to these nodes
   only — one failure inside a running batch must not cancel the rest of
   the batch's flight. */
function eatRestore(nodes) {
  for (const n of nodes || []) {
    if (!n) continue;
    if (n.__eatAnim) {
      try { n.__eatAnim.cancel(); } catch (e) { /* already gone */ }
      delete n.__eatAnim;
    }
    if (n.classList) n.classList.remove('is-eaten');
  }
}

async function deleteImage(path, sha, prettyLabel, opts = {}) {
  let request = null;
  const ok = await askConfirm({
    title: `Delete "${prettyLabel}"?`,
    body: `<strong>${escapeHtml(prettyLabel)}</strong> will be removed from the archive. You can undo this from the message that follows.`,
    okLabel: 'Delete photo',
    // The swallow plays here, while the dialog is still up, so the photo is
    // eaten by the bin sitting right in front of you. The request goes out
    // alongside it — nothing waits on the animation to reach the network —
    // but only the animation is awaited: holding the dialog open for a slow
    // API round-trip would be a worse wait than the one it replaced. The
    // result is picked up below, and cancelling never runs either.
    onAccept: async () => {
      request = deleteImageRequest(path, sha, prettyLabel);
      request.catch(() => {});
      if (opts.presenter) await opts.presenter();
    },
  });
  if (!ok || !request) return;
  /* Say the delete is happening, and say it before the await.

     The swallow plays while the dialog is up, so by the time this runs the
     photo has already been eaten and the dialog has closed — and the
     request may not have come back yet. Measured against a 4s mock, the
     dialog was accepted at +5557ms and nothing appeared on screen until
     +9473ms: three and a half seconds in which a deletion looks like it
     was dropped. Deleting is destructive and this is the one action in the
     app with an Undo behind it, so a wait that cannot be interpreted is
     the worst place to have one. Sticky, so it holds until the outcome
     replaces it. */
  // The local state change is last: re-rendering mid-swallow pulls the
  // photo out of the bin before it arrives, which is the one thing this
  // effect must not do.
  try {
    await request;
    applyImageDelete(path);
    render();
    showToast(DEMO_MODE ? `Deleted ${prettyLabel} (demo).` : `Deleted ${prettyLabel}.`,
      { type: 'success', undo: DEMO_MODE ? null : undoLastChange });
  } catch (err) {
    reportDeleteFailed(err);
    if (opts.restore) opts.restore();
  }
}

/* A failed delete is destructive and undoable-but-not-automatically: the
   photo is still in the repo, but the visitor has just watched it get
   eaten and has to be told plainly that it was not removed, and given the
   reason. The message is sticky for the same reason the classify one is —
   showToast() dismisses whatever is on screen before showing the next, so
   an ordinary 3.2s toast can be replaced or expire unread — and the
   restore puts the photo back on screen either way. */
function reportDeleteFailed(err) {
  showToast(`NOT deleted: ${errWhy(err)}`, { type: 'error', sticky: true });
}

/* The part that talks to the repo. Everything that decides whether the
   photo actually goes still lives here and in applyImageDelete below —
   demo mode, the GitHub call, the local state update, the re-render and
   both toasts are unchanged from when this ran as one inline function.

   Every member of the asset is deleted, not just the original — see
   assetItemsFor below. Each is attempted even if an earlier one fails,
   because abandoning the rest strands the variants, and the first real
   reason is the one reported. */
function deleteImageRequest(path, sha, prettyLabel) {
  if (DEMO_MODE) return Promise.resolve();
  const items = assetItemsFor(path, sha);
  return (async () => {
    let firstError = null;
    for (const item of items) {
      try {
        await githubDelete(item.path, item.sha, `Remove ${prettyLabel} via gallery admin`);
      } catch (err) {
        if (!firstError) firstError = err;
      }
    }
    if (firstError) throw firstError;
  })();
}

/* The whole asset, not the one file the visitor tapped.

   A photo in this repo is usually three files — the original plus its
   `-480` / `-800` webp variants — and buildAssets collapses them into ONE
   card, keyed on the original (variantScore gives a non-variant name 0,
   so it always wins canonical, and the variants are unioned in by shared
   base name and folder). So deleting only the original leaves the
   variants behind, and because they still share that base name they
   group into a fresh asset on the next tree load. The photo vanishes,
   the toast says Deleted, and it walks back onto the wall on the next
   refresh — which is exactly what it did.

   The batch delete got this right from the start; only the single-photo
   path deleted one file. */
function assetItemsFor(path, sha) {
  const asset = (state.assets || []).find(a => a.canonical.path === path);
  if (asset) return asset.items;
  return [{ path, sha, name: prettyName(path.split('/').pop()) }];
}

function applyImageDelete(path) {
  const paths = new Set(assetItemsFor(path).map(i => i.path));
  for (const folder of state.order) {
    state.folders[folder] = state.folders[folder].filter(f => !paths.has(f.path));
  }
  // state.assets is what every other admin flow resolves an asset
  // through — move, rename, remove-phase, the viewer's variant picker —
  // and it is rebuilt only by a full tree load. A delete that skipped it
  // left a dead asset in place for all of them.
  state.assets = (state.assets || []).filter(a => !paths.has(a.canonical.path));
}

function contentsUrl(path) {
  return `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/* PUT a file. GitHub's Contents API requires the current file sha to UPDATE
   an existing path (422 "sha wasn't supplied" otherwise), so unless the
   caller opts out (overwrite:false — a "don't clobber" create), an
   acknowledged success is re-fetched for its sha and the write is retried.
   This is what makes gallery.json metadata edits work on a repo that already
   has the file committed (e.g. via the classify modal or upload metadata).

   A caller that already knows the sha may pass it (opts.sha) and skip both
   the rejected PUT and the read: that is what turns a metadata save from
   three round trips into one. The recovery below is unchanged and still
   covers a sha that has since gone stale — GitHub answers 409 for that,
   which falls into the same re-read-and-retry path.

   Returns the sha of the file as it now stands, or null for a plain create
   whose response carried none. */
async function githubPut(path, base64Content, message, opts = {}) {
  const overwrite = opts.overwrite !== false;
  async function attempt(sha) {
    return githubFetch(contentsUrl(path), {
      method: 'PUT',
      headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: base64Content, branch: CONFIG.branch, ...(sha ? { sha } : {}) }),
    });
  }
  let res = opts.sha ? await attempt(opts.sha) : await attempt();
  if (!res.ok) {
    const err0 = await res.json().catch(() => ({}));
    const message0 = err0.message || '';
    // "sha wasn't supplied" means we arrived without one; "is at X but
    // expected Y" (409) means the one we held has been superseded. Both are
    // answered by reading the file again and trying once with what it says.
    const needsSha = /sha wasn't supplied|sha was supposed to be a string|"sha" wasn't supplied/i.test(message0)
      || res.status === 409;
    if (needsSha && overwrite) {
      const cur = await githubFetch(contentsUrl(path), {
        headers: { Authorization: `Bearer ${state.token}` },
      });
      if (cur.ok) {
        const data = await cur.json().catch(() => ({}));
        if (data && data.sha) res = await attempt(data.sha);
      }
    }
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Upload failed (${res.status})`);
  }
  // A successful PUT answers with the new content's sha; that is the value
  // the next write needs, so it is handed back rather than re-read.
  const written = await res.json().catch(() => null);
  const sha = written && written.content && written.content.sha;
  return sha ? { sha } : null;
}

async function githubDelete(path, sha, message) {
  const res = await githubFetch(contentsUrl(path), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha, branch: CONFIG.branch }),
  });
  if (!res.ok) {
    // If the SHA is stale (409/422), fetch the current SHA and retry once
    if (res.status === 409 || res.status === 422) {
      const current = await githubFetch(contentsUrl(path), {
        headers: { Authorization: `Bearer ${state.token}` },
      });
      if (current.ok) {
        const data = await current.json().catch(() => ({}));
        if (data && data.sha) {
          const retry = await githubFetch(contentsUrl(path), {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, sha: data.sha, branch: CONFIG.branch }),
          });
          if (retry.ok) return;
        }
      }
    }
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.message || `Delete failed (${res.status})`);
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

/* ── Lightbox ─────────────────────────────────────────────────── */

/* The viewer's DownloadButton instance + the filename of the photo on
   screen (for the completion toast). Created in wireStaticEvents. */
let viewerDownload = null;
let viewerDownloadName = '';

/* On the Pictures tab the viewer walks the same day-sorted wall the user was
   looking at; from an album it stays inside that album. */
function lightboxItems(folder) {
  return state.view === 'images'
    ? (state.picturesList || []).map(c => c.img)
    : (state.folders[folder] || []);
}
/* Cards report a folder-local index; on the Pictures tab translate it to the
   position of that same photo in the day-sorted list.

   `said` is the path the tapped card claims. In an album the raw index is the
   whole answer, so it used to be trusted outright — and a card that no longer
   agrees with the data (a rename, a delete, a background reload shifting the
   array) would open whatever photo now sat in that slot. That is exactly the
   reported failure: tap one photo, see its neighbour, with no error anywhere.
   So both views now resolve by identity — the claimed path decides which photo
   opens, and the index is only used to find it. A card that cannot be matched
   opens nothing.

   -1 means "that index does not name a photo in this list", which is not the
   same as position 0. It used to collapse a miss to 0, and 0 is a perfectly
   valid position for a completely different photo — so a lookup that failed
   quietly produced a viewer showing the wrong picture under the tapped
   photo's name. Callers must treat -1 as a failure, not an index. */
function lightboxIndexFor(folder, index, said) {
  const items = state.folders[folder] || [];
  if (state.view !== 'images') {
    if (said) {
      // Identity first: the slot only matters once the path is confirmed.
      const at = items.findIndex(it => it.path === said);
      return at;
    }
    return index >= 0 && index < items.length ? index : -1;
  }
  const target = items[index];
  if (!target) return -1;
  if (said && target.path !== said) {
    // The card and the data disagree about who occupies this slot. Trust the
    // card's identity and resolve it directly rather than opening a neighbour.
    const at = items.findIndex(it => it.path === said);
    return at < 0 ? -1 : (state.picturesList || []).findIndex(c => c.img.path === said);
  }
  const at = (state.picturesList || []).findIndex(c => c.img.path === target.path);
  return at;   // -1 when the photo is not on the wall
}

/* The card's own thumbnail, but only if it really is the photo that resolved.
   It is a cache-hit shortcut so the viewer opens from cache rather than
   re-fetching — not a second source of truth. Handing updateLightbox a src
   from one photo while it resolves another is how you end up staring at
   image 2 under image 3's filename. */
function startSrcFor(fig, resolvedPath) {
  const img = fig && fig.querySelector ? fig.querySelector('img') : null;
  if (!img || !img.classList.contains('is-loaded') || !img.currentSrc) return null;
  // The card's img is only trustworthy when its card and the resolved photo
  // are the same file. Compare on the path the card claims, since currentSrc
  // is a tier of that path at best.
  const cardPath = fig.dataset ? fig.dataset.path : null;
  return cardPath && resolvedPath && cardPath === resolvedPath ? img.currentSrc : null;
}

/* A tap record, for diagnosing "I tapped this and that one came up".
   Every card tap is logged with the identity the card claimed, the identity
   the index maths resolved, and the file the viewer actually painted — so the
   report can be answered with one line from the console instead of a guess.

   Read it with:  __galleryDiag()          — the last 40 taps
                  __galleryDiag().clear()

   Cheap by design: one small object per tap, no layout reads, and it can
   never throw into the tap it is describing. */
function diagTap(entry) {
  try {
    const log = (window.__galleryDiagLog = window.__galleryDiagLog || []);
    log.push(Object.assign({ t: Date.now() }, entry));
    if (log.length > 40) log.shift();
  } catch (_) { /* diagnostics must never break a tap */ }
}
function galleryDiag() {
  const log = (typeof window !== 'undefined' && window.__galleryDiagLog) || [];
  const fmt = (e) => `${e.what || 'tap'} said=${e.said || '-'} `
    + `resolved=${String(e.resolved || '-').split('/').pop()} `
    + `shown=${String(e.shown || '-').split('/').pop()}`
    + (e.painted ? ` painted=${e.painted}` : '')
    + (e.ok === false ? '   <-- MISMATCH' : '');
  // A paint fault and an index fault look identical to the user but are not
  // the same bug. Index fault: the viewer holds a photo other than the one
  // resolved. Paint fault: the viewer holds the RIGHT photo index, but the
  // <img> is showing some other file's bytes — the slide track or the service
  // worker, not the maths. Split them out so one console call answers which.
  const wrongPaint = log.filter(e =>
    e.painted && !String(e.painted).includes(basenameStem(
      String(e.shown || 'x').split('/').pop() || 'x')));
  return {
    last: log.length ? fmt(log[log.length - 1]) : '(nothing recorded)',
    mismatches: log.filter(e => e.ok === false).map(fmt),
    paintMismatches: wrongPaint.length,
    paintSamples: wrongPaint.slice(-6).map(e => ({
      said: String(e.said || '').split('/').pop(),
      painted: e.painted,
      paintedFull: e.paintedFull,
      slots: e.slots,
    })),
    all: log.map(fmt),
    clear() { if (typeof window !== 'undefined' && window.__galleryDiagLog) window.__galleryDiagLog.length = 0; },
    raw: log,
  };
}

function openLightbox(folder, index, startSrc, said) {
  state.lightboxFolder = folder;
  const at = lightboxIndexFor(folder, index, said);
  // A tap on a card that no longer maps to a photo opens nothing rather than
  // opening the wrong one.
  if (at < 0) {
    diagTap({ what: 'viewer', said, index, resolved: null, shown: null, ok: false });
    return;
  }
  state.lightboxIndex = at;
  state.lightboxStartSrc = startSrc || null;
  resetSlideTrack();
  updateLightbox();
  // Read back what the viewer ACTUALLY painted. `shown` from the items array
  // can only ever prove the index maths agreed with itself — it cannot see a
  // rendering fault, and this bug is not an index fault: the maths resolves
  // correctly and the wrong photo is still on screen. So take the evidence off
  // the DOM — the big image's own src/data-full, and which photo each of the
  // three slide slots is actually holding.
  const lb = el('lightboxImg');
  const painted = lb ? (lb.currentSrc || lb.src || '') : '';
  const paintedFull = lb ? (lb.dataset.full || '') : '';
  const slots = slideNodes().map(n => ({
    id: n.id || '-',
    role: ['is-prev', 'is-current', 'is-next'].find(c => n.classList.contains(c)) || '?',
    path: n.dataset.path || '-',
    src: (n.currentSrc || n.src || '').split('/').pop().split('?')[0] || '-',
  }));
  const shown = (lightboxItems(folder)[at] || {}).path || null;
  diagTap({
    what: 'viewer', said, index, resolved: at, shown,
    painted: painted.split('/').pop().split('?')[0] || '(none)',
    paintedFull: paintedFull.split('/').pop().split('?')[0] || '(none)',
    slots,
    ok: shown === said,
  });
  overlayPush('lightbox', closeLightbox);
  el('lightbox').hidden = false;
}

/* ── The slide window ──────────────────────────────────────────────
   Three resident <img> slots on one track. A slot's role is its
   position, not its identity: stepping moves the track by one slot
   width and, once the transition lands, the slots are rotated so the
   one that slid into the middle becomes current. Rotating rather than
   refilling is the point — the promoted photo keeps the bitmap it was
   already showing, so advancing never re-decodes what is on screen.

   The whole animation is one compositor-owned transform. No layout, no
   paint, and no JavaScript running while the photos move.

   The window is what makes this affordable. These photos are 4080x3060
   — 49.9 MB of bitmap once decoded — so a slider that kept the album
   in the DOM would price memory by album length. Three slots cap it,
   the two neighbours are held at the ~25 KB webp tier rather than
   full-res, and a slot that leaves the window has its src dropped so
   the decoder can release it. */
const SLIDE_MS = 320;
/* Grace past the slide transition before the clock settles the track on its
   own, for a tab that never painted. */
const SLIDE_SLACK_MS = 150;
const SLIDE_IDS = ['lightboxImgPrev', 'lightboxImg', 'lightboxImgNext'];
const SLIDE_CLASSES = ['is-prev', 'is-current', 'is-next'];
let slideAnimating = false;

function slideNodes() {
  const track = el('lightboxTrack');
  return track ? Array.from(track.children) : [];
}

/* Ensure the track DOM is in canonical order: [prev, current, next].
   The track's DOM order can be rotated by commitSlide; this restores the
   canonical order so fillWindow's slot assumptions hold. */
function resetSlideTrack() {
  const track = el('lightboxTrack');
  if (!track) return;
  const prev = track.querySelector('#lightboxImgPrev');
  const current = track.querySelector('#lightboxImg');
  const next = track.querySelector('#lightboxImgNext');
  if (prev && current && next) {
    // Ensure canonical order: prev, current, next
    if (track.children[0] !== prev) track.insertBefore(prev, track.firstChild);
    if (track.children[1] !== current) track.insertBefore(current, next);
    if (track.children[2] !== next) track.appendChild(next);
  }
}
/* Roles follow DOM position, so a rotation only has to re-stamp them. */
function applySlideRoles() {
  const nodes = slideNodes();
  nodes.forEach((node, i) => {
    if (SLIDE_IDS[i]) node.id = SLIDE_IDS[i];
    for (const c of SLIDE_CLASSES) node.classList.remove(c);
    node.classList.add(SLIDE_CLASSES[i]);
    node.setAttribute('aria-hidden', i === 1 ? 'false' : 'true');
    if (i !== 1) node.alt = '';
  });
}
function reduceMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
/* Put a photo in a slot. The cheap tier keeps a neighbour's decode
   around 1.5 MB instead of 50. */
function fillSlot(node, img) {
  if (!node || !img) { if (node) releaseSlot(node); return; }
  const cheap = node.id !== 'lightboxImg';
  const src = cheap ? thumbSrc(img) : lightboxSrc(img);
  if (node.dataset.path !== img.path) {
    node.dataset.path = img.path;
    node.classList.remove('is-loaded');
    // Blur-up resolves on load. The current slot sets its own onload to
    // upgrade to full-res, so this listens rather than assigning — a
    // neighbour that never got this would sit blurred behind the slide
    // for as long as the viewer is open.
    const settle = () => node.classList.add('is-loaded');
    node.addEventListener('load', settle, { once: true });
    node.addEventListener('error', settle, { once: true });
    node.src = src;
  } else if (!node.getAttribute('src')) {
    node.src = src;
  }
  node.alt = cheap ? '' : prettyName(img.name);
}
/* Hand back a slot's memory. An empty src is what lets the browser
   evict the decoded bitmap rather than hold it for a thumbnail that
   will never be looked at again. */
function releaseSlot(node) {
  if (!node) return;
  delete node.dataset.path;
  delete node.dataset.full;
  node.removeAttribute('src');
  node.classList.remove('is-loaded');
  node.alt = '';
}
function windowItem(items, i) {
  const n = items.length;
  return n ? items[((i % n) + n) % n] : null;
}
/* Park the window around the live index, cheap on both flanks. */
function fillWindow(items, index) {
  const nodes = slideNodes();
  if (nodes.length < 3) return;
  const many = items.length > 1;
  // Find slots by role, not position — the track DOM order may be rotated
  // after swipes. The center slot always has class 'is-current'.
  const center = nodes.find(n => n.classList.contains('is-current')) || nodes[1];
  const prev = nodes.find(n => n.classList.contains('is-prev')) || nodes[0];
  const next = nodes.find(n => n.classList.contains('is-next')) || nodes[2];
  fillSlot(center, windowItem(items, index));
  fillSlot(prev, many ? windowItem(items, index - 1) : null);
  fillSlot(next, many ? windowItem(items, index + 1) : null);
}
/* Labels, counter and the download target for the photo now on screen. */
function paintViewerChrome(img, items) {
  const folder = state.view === 'images' ? (img.folder || state.lightboxFolder) : state.lightboxFolder;
  const iso = extractPhotoDate(img.name);
  el('lightboxName').textContent = prettyName(img.name);
  el('lightboxMeta').textContent = `${iso ? fmtDay(iso, true) : 'Undated'} · ${albumStageName(folder)}`;
  el('lightboxCounter').textContent = `${state.lightboxIndex + 1} / ${items.length}`;
  el('lightboxTag').hidden = !state.adminMode;
  el('lightboxDelete').hidden = !state.adminMode;
  el('lightbox').classList.remove('chrome-off');
  // The DownloadButton always points at the photo on screen, full-res,
  // tokenless (same-origin Pages host or the in-page demo data URL).
  viewerDownloadName = prettyName(img.name);
  if (viewerDownload) {
    viewerDownload.setFile({
      href: img.demoSrc || pageUrl(img.path),
      filename: sanitizeFilename(img.name) ||
        (viewerDownloadName.toLowerCase().replace(/\s+/g, '-') || 'gallery-photo') + '.jpg',
    });
  }
}
function updateLightbox() {
  const items = lightboxItems(state.lightboxFolder);
  if (state.lightboxIndex >= items.length) state.lightboxIndex = Math.max(0, items.length - 1);
  const img = items[state.lightboxIndex];
  if (!img) { if (!el('lightbox').hidden) overlayClose('lightbox'); return; }
  const lb = el('lightboxImg');
  // Always open crisp: the LARGEST committed variant (cached once the card
  // revealed, ~66KB if nav); full-res original layers in silently after.
  //
  // startSrc is only a cache-hit shortcut, and it is only honoured when it
  // names the photo actually on screen. Anything that steps the viewer after
  // open (a refresh from a rename, a delete) must fall back to this photo's
  // own source rather than reuse a thumbnail belonging to a different one —
  // that mismatch is invisible in code and obvious to anyone looking at it.
  const start = state.lightboxStartSrc || lightboxSrc(img);
  state.lightboxStartSrc = null;
  lb.src = start;
  lb.dataset.full = imgSrc(img);          // full-res — background upgrade only
  lb.classList.add('is-loaded');          // open clear, never blurred
  // This node outlives any one photo. If the last deletion left it eaten
  // — or left a filled flight on it — the photo stepping in behind it
  // would arrive invisible, or shrunk into a corner.
  lb.classList.remove('is-eaten');
  lb.getAnimations().forEach(a => { if (a.id === EAT_ANIM_ID) a.cancel(); });
  lb.onload = () => { if (lb.src !== lb.dataset.full && lb.dataset.full) lb.src = lb.dataset.full; };
  lb.onerror = () => { if (lb.src !== lb.dataset.full && lb.dataset.full) lb.src = lb.dataset.full; };
  lb.alt = prettyName(img.name);
  applySlideRoles();
  resetSlideTrack();
  fillWindow(items, state.lightboxIndex);
  paintViewerChrome(img, items);
}

/* Viewer bottom-bar admin actions act on the photo on screen. */
function viewerTag() {
  const img = lightboxItems(state.lightboxFolder)[state.lightboxIndex];
  if (img) openTagModal(img.path, prettyName(img.name));
}

async function viewerDelete() {
  const img = lightboxItems(state.lightboxFolder)[state.lightboxIndex];
  if (!img) return;
  const node = el('lightboxImg');
  await deleteImage(img.path, img.sha, prettyName(img.name), {
    // The bin in the confirmation, not the one on the viewer button: the
    // photo is swallowed by the can the visitor is already looking at.
    presenter: () => playTrashEat(el('confirmBin'), node ? [{ node }] : [], { live: true }),
    restore: () => eatRestore([node])
  });
  // deleteImage re-renders; updateLightbox (via render) clamps or closes.
}
/* Closing is when the window is worth most to release: a closed viewer
   holding three decoded photos is 50 MB of bitmap nobody is looking at.
   The main thread then has the wall to itself again. */
function closeLightbox() {
  el('lightbox').hidden = true;
  const track = el('lightboxTrack');
  if (track) {
    track.classList.remove('is-moving');
    track.style.transform = '';
    track.style.willChange = '';
    resetSlideTrack();
  }
  slideAnimating = false;
  for (const node of slideNodes()) releaseSlot(node);
}
/* Land the slide: rotate the slots under the track, hand the recycled
   one its new photo, and put the track back at rest. The rotation is
   what preserves the bitmap that just slid into view. */
function commitSlide(items, delta) {
  const track = el('lightboxTrack');
  if (!track) return;
  const nodes = slideNodes();
  if (nodes.length === 3) {
    // Stepping forward promotes the trailing slot to the middle.
    if (delta > 0) track.appendChild(nodes[0]);
    else track.insertBefore(nodes[2], track.firstChild);
  }
  track.classList.remove('is-moving');
  track.style.transform = '';
  track.removeAttribute('will-change');
  slideAnimating = false;
  applySlideRoles();
  fillWindow(items, state.lightboxIndex);
  const img = items[state.lightboxIndex];
  if (img) paintViewerChrome(img, items);
}
function lightboxStep(delta) {
  const items = lightboxItems(state.lightboxFolder);
  if (!items.length || items.length < 2) return;
  const track = el('lightboxTrack');
  // Stepping again mid-slide must not stack a second animation on the
  // first: land the one in flight, then slide from rest.
  if (slideAnimating) commitSlide(items, state.lightboxStepDir || 1);
  if (reduceMotion() || !track) {
    state.lightboxIndex = (state.lightboxIndex + delta + items.length) % items.length;
    updateLightbox();
    return;
  }
  state.lightboxIndex = (state.lightboxIndex + delta + items.length) % items.length;
  state.lightboxStepDir = delta;
  track.style.willChange = 'transform';
  // Offset is relative to the resting position, which is translateX(-100%)
  // in CSS because the current photo is the second of three slots. Stepping
  // forward slides toward the next slot, so -200%; back toward the previous,
  // so 0%. Measured from 0 instead — as this used to be — the track animated
  // one slot short of its target and the viewer settled on the wrong photo.
  track.style.transform = `translateX(${-100 - delta * 100}%)`;
  track.classList.add('is-moving');
  slideAnimating = true;
  const done = (e) => {
    if (e && e.target !== track) return;
    track.removeEventListener('transitionend', done);
    track.removeEventListener('transitioncancel', done);
    if (!slideAnimating) return;
    commitSlide(items, delta);
  };
  track.addEventListener('transitionend', done);
  track.addEventListener('transitioncancel', done);
  // A backgrounded tab paints nothing and would never fire transitionend,
  // which would strand the track off-centre. Settle it by clock instead,
  // SLIDE_SLACK_MS past the transition so the real end still wins the race.
  setTimeout(() => { if (slideAnimating) done(null); }, SLIDE_MS + SLIDE_SLACK_MS);
}

/* ── Small helpers ────────────────────────────────────────────── */

function rawUrl(path) {
  return `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
/* The photos at the top of the Pictures wall are what paints first (the
   default tab). Recomputed once per render and read per card, so the check
   stays O(1) for each image. */
let firstPaintPaths = new Set();
/* The loading gate's original markup, cached at boot so the
   Retry button can restore it after an error. */
let LOADING_MARKUP = '';
const FIRST_PAINT_EAGER = 3;   // eager/high-priority cards
const FIRST_PAINT_PRELOAD = 6; // thumb preloads
function firstPaintImages() {
  return (state.picturesList || []).slice(0, FIRST_PAINT_PRELOAD).map(c => c.img);
}
function computeFirstPaintPaths() {
  firstPaintPaths = new Set(
    (state.picturesList || []).slice(0, FIRST_PAINT_EAGER).map(c => c.img.path)
  );
}
function isFirstPaint(img) {
  return firstPaintPaths.has(img.path);
}

function thumbSrc(img) {
  // Blur-up placeholder = our smallest committed webp variant (~12 KB), served
  // from the Pages host (same-origin, SW-cached). jsDelivr ?w was tried first
  // but empirically serves the FULL original (2720 KB, no resize), silently
  // adding a multi-MB download at first paint — so it's disabled here.
  if (img.demoSrc) return img.demoSrc;
  const asset = (state.assets || []).find(a => a.canonical.path === img.path);
  const v = asset && asset.variants.filter(x => /\.webp$/i.test(x.name));
  if (v && v.length) return pageUrl(v[v.length - 1].path); // smallest tier
  return pageUrl(img.path);
}
function pageUrl(path) {
  // Same-origin GitHub Pages host: served off Fastly CDN with real
  // cache headers (unlike raw.githubusercontent which revalidates every
  // request). Tokenless by construction. Custom domains can set
  // CONFIG.siteOrigin to override the default <owner>.github.io/repo.
  const base = CONFIG.siteOrigin || `https://${CONFIG.owner}.github.io/${CONFIG.repo}/`;
  return base + path.split('/').map(encodeURIComponent).join('/');
}
function imgSrc(img) {
  return img.demoSrc || pageUrl(img.path);
}
function lightboxSrc(img) {
  // Lightbox: show the LARGEST committed webp variant (crisp in the big pane,
  // already cached once the card revealed), never the 12KB blur or the multi-MB
  // original on open. variants[0] is the highest-res webp tier (sorted by
  // variantScore ascending, original excluded). Full-res still layers in
  // silently afterwards via data-full.
  if (img.demoSrc) return img.demoSrc;
  const asset = (state.assets || []).find(a => a.canonical.path === img.path);
  const v = asset && asset.variants.filter(x => /\.webp$/i.test(x.name));
  if (v && v.length) return pageUrl(v[0].path);
  return pageUrl(img.path);
}
function cardSrc(img) {
  // Grid: serve a committed webp variant sized for the actual card, never the
  // multi-MB original (full-res loads only in the lightbox). Cards render at
  // ~180-300 px, so 1x DPR uses the -480 tier; 2x+ uses -800. Single source,
  // no redownload — pairs with the blur-up swap (srcset would force a second
  // fetch through the data-full upgrade, so it's deliberately avoided here).
  if (img.demoSrc) return img.demoSrc;
  const asset = (state.assets || []).find(a => a.canonical.path === img.path);
  const v = asset && asset.variants.filter(x => /\.webp$/i.test(x.name));
  if (v && v.length) {
    const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
    const pick = dpr >= 2 ? v[0] : v[v.length - 1];
    return pageUrl(pick.path);
  }
  return pageUrl(img.path);
}
function prettyName(filename) {
  return filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
}
function sanitizeFilename(name) {
  return name.trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9.\-_]/g, '')
    .replace(/^\.+/, '') // Remove leading dots
    .replace(/\.+$/, '') // Remove trailing dots
    .replace(/^[-_]+|[-_]+$/g, ''); // Trim leading/trailing hyphens/underscores
}
const cssSafe = (s) => s.replace(/[^a-zA-Z0-9_-]/g, '_');
const escapeHtml = (s) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escapeAttr = (s) => escapeHtml(s).replace(/"/g, '&quot;');

/* Why something failed, as a string that is never empty.
   Every failure toast interpolated `${err.message}` directly, and that is
   not a safe assumption: a rejected fetch, a thrown string, or an Error
   constructed with no argument all reach a catch with a message of
   undefined or ''. hcg-toast drops a falsy message outright (hcg-toast.js
   returns null before it builds anything), so `Could not undo: ` would
   have produced no message at all — the one outcome a failure toast
   exists to prevent.

   The fallbacks are ordered by how much they actually tell the reader: a
   real message, then the thrown value's own text, then 'unknown error'.
   The middle step is skipped when it would only stringify to
   '[object Object]', which names nothing. */
const errWhy = (err) => {
  if (err && typeof err.message === 'string' && err.message.trim()) return err.message;
  if (err === null || err === undefined) return 'unknown error';
  const text = String(err);
  return (text && text !== '[object Object]') ? text : 'unknown error';
};

/* ── Notifications ─────────────────────────────────────────────────
   Every message in the gallery goes through showToast, which is a
   thin wrapper over hcg-toast (hcg-toast.js, loaded ahead of app.js in
   index.html). It owns the placement, the timing, the sound and the one
   toast on screen at a time; callers only say what happened.

   The shape is Penguin UI's stacking notification and the skin is in
   style.css: a card washed 10% in its own variant colour, a circular
   plate holding the glyph, the message, and a stroked dismiss X. What
   the wrapper adds is the three things the library cannot know about:
   which glyph a gallery message deserves, the Undo action, and the
   ding.

   Three types are the JS action's outcome, and the stylesheet paints each
   one: `success` is green, `error` is red (Penguin's *danger*), and
   `pending` is orange — the colour this archive reserves for a write or a
   read that is still in flight. The card's text is the action itself
   ("Uploading photos", "Deleting photos", "Revert all"), so what the card
   says is what the app is doing, not merely that something is.

   A sticky message with no type of its own is pending by default, because
   every sticky message in this app is a batch telling you what it is
   doing. An explicit `type` outranks that, which is what keeps the
   batches' sticky *errors* red — a file that 403s mid-upload must not
   read as still-working. `opts.sticky` — or `true` as the whole argument
   — is the shorthand for such a line: it stays until the next call
   replaces it, so a long upload shows one moving line rather than a
   stack.

   Duration is 8s — Penguin's own displayDuration, and long enough to
   finish reading the sentence a forty-photo batch spends most of its
   life building — rising to 10s when there is something to undo, and 0
   for a progress line the next call replaces. hcg-toast pauses its
   own timer on hover and clears it on removal, so there is no timer
   here to leak. */
const TOAST_POSITION = 'top-center';
const TOAST_MAX = 3;
const TOAST_MS = 8000;
const TOAST_UNDO_MS = 10000;

/* Penguin paints its variant glyphs from Heroicons' 20px solid set,
   and so does this — the two libraries reach for the same free icons,
   and hand-drawing a third set would only be worse. */
const TOAST_GLYPH = (d) =>
  `<svg viewBox="0 0 20 20" fill="currentColor" fill-rule="evenodd" aria-hidden="true" focusable="false">${d}</svg>`;
const TOAST_GLYPHS = {
  info: TOAST_GLYPH('<path d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A.75.75 0 0 0 9.253 9H9Z"/>'),
  success: TOAST_GLYPH('<path d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"/>'),
  warning: TOAST_GLYPH('<path d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/>'),
  error: TOAST_GLYPH('<path d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.34 8.34l2.25 2.25-2.25 2.25 1.41 1.41 2.25-2.25 2.25 2.25 1.41-1.41-2.25-2.25 2.25-2.25-1.41-1.41-2.25 2.25-2.25-2.25-1.41 1.41Z"/>'),
  // A clock, not a spinner: nothing here animates to imply progress, the
  // bar does, and a spinning glyph would sit still under reduced-motion
  // while still claiming to be working.
  pending: TOAST_GLYPH('<path d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM10.75 5a.75.75 0 0 0-1.5 0v4.5c0 .27.14.52.36.66l3 1.8a.75.75 0 1 0 .78-1.3l-3-1.8V5Z"/>'),
};
/* The library renders `&times;` — a slanted multiplication sign, not the
   thin stroked cross the rest of the set is drawn in. */
const TOAST_CLOSE_GLYPH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 18L18 6M6 6l12 12"/></svg>';

/* ── The notification sound ─────────────────────────────────────────
   Every voice in this app is synthesised from oscillators. There is no
   audio file, no network request and no licence: an oscillator is a few
   hundred bytes of arithmetic, so a notification can carry its own
   sound without a decoder, a download, or anything to attribute.

   That is a deliberate position rather than a shortcut. A recorded
   notification was tried and the file was the problem, not the sound:
   the sources that permit redistribution are the ones with the thinnest
   catalogue for interface use, and the rest either demand a credit line
   or forbid shipping the file. Synthesising sidesteps the question
   entirely, and it keeps the archive working with the network gone. */
const TOAST_SOUND_KEY = 'gallery.toastSound';

function storedToastSound() {
  try {
    return localStorage.getItem(TOAST_SOUND_KEY) !== 'off';
  } catch (_) {
    return true; // cannot remember — sound on, as shipped
  }
}

let toastSoundOn = storedToastSound();

/* An AudioContext built before a gesture is born suspended, and Chrome
   logs a warning for the privilege of asking. So none is built until the
   page has been touched: the first pointerdown or keydown anywhere is the
   unlock. Until then a notification is silent. */
let toastUnlocked = false;
/* The context in use, and the voice currently sounding. Both are declared
   before the listeners below, which reach into them — a listener that ran
   against an uninitialised binding would throw rather than recover. */
let toastAudio = null;
let toastVoice = null;
/* Set when the browser hands back a context it will not run. The answer
   lasts for the session: a replacement would be born suspended too, and
   rebuilding on every notification is worse than being quiet. */
let toastRefused = false;

if (typeof window !== 'undefined' && window.addEventListener) {
  const unlock = () => {
    toastUnlocked = true;
    // A fresh gesture is the one thing that can overturn a browser's
    // earlier refusal, so the "no" is lifted here rather than anywhere
    // else — this is the only place a real human is involved.
    if (toastRefused) {
      toastRefused = false;
      // Silenced before the context goes, or the tone that prompted the
      // refusal keeps ringing against a context that is about to be closed.
      stopToastDing();
      const dead = toastAudio;
      toastAudio = null;
      if (dead && typeof dead.close === 'function') {
        try { dead.close(); } catch (_) { /* already closed */ }
      }
    }
  };
  window.addEventListener('pointerdown', unlock, { once: true, capture: true });
  window.addEventListener('keydown', unlock, { once: true, capture: true });

  /* A context the browser has suspended is a context this page can no
     longer use, and it does not always come back on its own. iOS in
     particular suspends on backgrounding and frequently does not resume on
     return — so without this a visitor who switched away once would find
     notifications permanently silent for the rest of the session, with no
     way to recover except a reload.

     The context is dropped rather than resumed, deliberately. resume() on
     a context nobody has unlocked is the thing that trips Chrome's autoplay
     warning, and it is also a lie about why it is suspended. Discarding it
     costs one small object; the next notification builds a fresh one, and
     by then the page has been touched again, so the new context is born
     running.

     Two events, because neither alone is enough: `visibilitychange` catches
     a backgrounded tab, and `pageshow` catches a page restored from the
     back/forward cache — which fires no visibilitychange at all. */
  const discardSuspended = () => {
    const ctx = toastAudio;
    if (!ctx || ctx.state !== 'suspended') return;
    // The handle goes with the context, for the same reason: nothing may
    // be left pointing at nodes that are about to be released.
    toastVoice = null;
    toastAudio = null;
    if (typeof ctx.close === 'function') {
      try { ctx.close(); } catch (_) { /* already closed */ }
    }
  };
  document.addEventListener('visibilitychange', discardSuspended);
  window.addEventListener('pageshow', discardSuspended);
}

/* ── The palette ──────────────────────────────────────────────────────
   Four voices, all built the same way: a list of partials struck at
   offsets, each one an oscillator and a gain envelope, all under one
   bus. Nothing is sampled and nothing is fetched, so there is no
   licence, no third-party notice, and the archive keeps working with
   the network gone.

   A partial is [frequency, delay, peak]. All four voices share the
   same 0.16 bus peak, so none of them is louder than another by
   accident — a sound that reads as "more urgent" because the gain
   happened to sit higher is a sound that is lying about urgency.

   Each voice is a different *direction*, because that is what survives
   a notification that lasts under a second: the ear catches a rise
   and a fall far more reliably than it catches timbre. */
const TOAST_VOICES = {
  /* The default, and unchanged: two partials a fifth apart, the second
     struck 50ms later at 40% — E6 then B6. Rising, so it reads as "it
     happened". */
  ding: {
    decay: 0.6,
    partials: [[1318.51, 0, 1], [1975.53, 0.05, 0.4]],
  },
  /* Failure. A falling MAJOR third — G4 down to Eb4, four semitones.
     Major rather than minor on purpose: a minor third would sound rueful,
     and rueful is the wrong register for something that did not happen. A
     falling major third is blunter, and reads as final rather than sad.

     Nearly two octaves below the default as well as inverted against it.
     The register does most of the work here — an error that sounded like a
     ding would be confusing however it moved.

     The third partial exists only for phone speakers. Both of the notes
     that carry the interval sit below 400Hz, where a handset rolls off
     hard — the error would arrive as a click. G5 sits alongside them at
     35% peak: inaudible as a separate note on decent speakers, and the
     only part of this voice a phone can actually reproduce. It is an
     octave above the first, so it adds no new interval. */
  error: {
    decay: 0.52,
    partials: [[392.0, 0, 1], [311.13, 0.09, 0.85], [784.0, 0.02, 0.35]],
  },
  /* "Done, but reversible." A falling PERFECT fifth — A5 down to D5, the
     mirror image of the default's rising fifth, same seven semitones. That
     symmetry is the whole design: the default means something happened,
     and this is the same gesture reversed, meaning it was taken back.

     Deliberately unresolved. The default rises into open air; this ends
     lower than it started, because the outcome it belongs to is not
     settled. */
  undo: {
    decay: 0.5,
    partials: [[880.0, 0, 1], [587.33, 0.1, 0.8]],
  },
  /* A batch that finished, as against a single action that did. A rising
     fourth then a fifth — E5, A5, E6 — three partials where the default
     has two, so the difference is "more happened" rather than "louder".
     The bus peak is identical to every other voice's. */
  success: {
    decay: 0.55,
    partials: [[659.25, 0, 0.9], [880.0, 0.07, 0.7], [1318.51, 0.14, 0.45]],
  },
};
const DEFAULT_VOICE = 'ding';

/* Voices share one context, but nothing else is shared between two
   notifications. Each builds its own bus and its own gains, and takes them
   all down when it finishes — a forty-photo batch that ends in a summary
   should not leave forty notifications' worth of gain graph hanging off
   the destination for the rest of the session. */
/* Cut the current tone off where it stands. Exponential, not linear: the
   point is to disappear rather than fade out audibly, and a linear ramp on
   an exponential envelope still clicks at the end. */
function stopToastDing() {
  const voice = toastVoice;
  if (!voice) return;
  // Cleared before any work, so a context that turns out to be unusable
  // still leaves nothing behind: a stale handle here would be stopped and
  // disconnected again on every later notification, against nodes that no
  // longer exist.
  toastVoice = null;
  try {
    const ctx = toastAudio;
    // A closed context is already silent, and its nodes are already gone.
    // Tearing down "logically" is all that is left, which the clear above
    // has done.
    if (!ctx || ctx.state === 'closed') return;
    const now = ctx.currentTime;
    voice.bus.gain.cancelScheduledValues(now);
    voice.bus.gain.setValueAtTime(Math.max(voice.bus.gain.value, 0.0001), now);
    voice.bus.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
    // The oscillators stop at the end of that ramp and release themselves
    // through the same onended teardown every other voice uses.
    for (const osc of voice.oscs) {
      try { osc.stop(now + 0.03); } catch (_) { /* already stopped */ }
    }
  } catch (_) {
    // Muting a tone is decoration being removed. A failure here must not
    // cost the notification that is about to be shown.
  }
}
function playToastDing(sound) {
  if (!toastSoundOn || !toastUnlocked) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  // One tone at a time. The gallery shows a single message, so a second
  // notification always supersedes the first — and the tone that announced
  // the first has to go with it, or the visitor hears something they can
  // no longer see. The ramp is short enough to be inaudible as a fade.
  stopToastDing();
  try {
    let freshContext = null;
    if (!toastAudio) {
      toastAudio = new AudioCtx();
      freshContext = toastAudio;
    }
    /* A context can go suspended without the page having been hidden — an
       incoming call on iOS, a Bluetooth device taking over, the OS
       reclaiming audio in a low-power state. A context that is *running*
       from an earlier notification is dead weight, and the visitor has
       interacted since, so a replacement is born running. That is the
       recovery the backgrounding case needs.

       But a context born suspended is the browser answering "no", and it
       must be obeyed rather than replaced — otherwise every notification
       would build and discard one, forever, and the page would spend its
       life constructing audio contexts it is not allowed to use. The
       refusal is remembered, so the app goes quiet for the rest of the
       session rather than churning; a genuine gesture clears it. */
    if (toastAudio.state === 'suspended') {
      if (toastAudio === freshContext) {
        toastRefused = true;
        return;
      }
      if (toastRefused) return;   // asked once already; the answer stands
      const dead = toastAudio;
      toastAudio = null;
      // Closed rather than merely dropped. A suspended context still holds
      // whatever it was holding the output device with, and "nobody
      // references it any more" is not the same as "the browser let it go".
      try { if (typeof dead.close === 'function') dead.close(); } catch (_) { /* already closed */ }
      try { toastAudio = new AudioCtx(); } catch (_) { return; }
      if (toastAudio.state === 'suspended') { toastRefused = true; return; }
    }
    const voice = TOAST_VOICES[sound] || TOAST_VOICES[DEFAULT_VOICE];
    const { decay, partials } = voice;
    const now = toastAudio.currentTime;
    const ctx = toastAudio;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.exponentialRampToValueAtTime(0.16, now + 0.012);
    bus.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    bus.connect(ctx.destination);

    // Everything this voice owns. Disconnecting the bus is enough to mute
    // it, but each gain is dropped from its own parent too so a stopped
    // voice releases its oscillator immediately rather than waiting for
    // the graph to be collected wholesale.
    const gains = [];
    let last = null;
    for (const [freq, delay, peak] of partials) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + delay);
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(peak, now + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + decay - 0.05);
      osc.connect(gain);
      gain.connect(bus);
      gains.push({ osc, gain });
      osc.start(now + delay);
      // The last partial to finish owns the teardown.
      osc.stop(now + delay + decay);
      last = osc;
    }
    if (last) {
      last.onended = () => {
        if (toastVoice && toastVoice.bus === bus) toastVoice = null;
        for (const { osc, gain } of gains) {
          try { osc.disconnect(); gain.disconnect(); } catch (_) { /* already torn down */ }
        }
        try { bus.disconnect(); } catch (_) { /* already torn down */ }
      };
      // Held so a new notification can cut this one off. The gallery shows
      // one message at a time and every batch replaces the last, so two
      // tones can legitimately overlap: an error that sounds, immediately
      // replaced by the next progress line, would otherwise ring on over
      // whatever the visitor is doing for another half second.
      toastVoice = { bus, oscs: gains.map((g) => g.osc) };
    }
  } catch (_) {
    // The sound is decoration. A device with no output, or a context
    // that refuses to build, must not cost the message it belongs to.
  }
}

/* Turned off from the ⋮ menu, remembered under gallery.toastSound.
   Turning it back on plays the ding, so the row confirms itself by being
   heard — and the tap that reached the menu is what unlocked the
   context. */
function setToastSound(on) {
  toastSoundOn = !!on;
  try { localStorage.setItem(TOAST_SOUND_KEY, toastSoundOn ? 'on' : 'off'); } catch (_) { /* nothing to remember it in */ }
  if (toastSoundOn) {
    stopToastDing();
    playToastDing();
  } else {
    // Turning sound off has to actually stop it, including whatever is
    // sounding at this instant — a visitor who mutes mid-tone expects
    // silence now, not in half a second. The context goes too: a live one
    // holds the output device open, so a muted gallery would still be
    // paying for the hardware and the battery.
    stopToastDing();
    const ctx = toastAudio;
    toastAudio = null;
    if (ctx && typeof ctx.close === 'function') {
      try { ctx.close(); } catch (_) { /* already closed, or closing */ }
    }
  }
  /* Destructive: releases the context, so anything pointing into it is
     cleared too. Every exit that drops the context must drop the voice. */
}

/* The id of the toast currently on screen. hcg-toast stacks, but the
   gallery showed one message at a time and the batch loops lean on
   that: each progress line replaces the last, and the final summary
   replaces the last progress line rather than joining it. */
let toastId = null;

/* The library, with its defaults applied once. It is loaded as a plain
   script ahead of app.js, so this is normally just the global; guarding it
   keeps the file loadable in the test harness, which stubs `window`
   without a DOM. Only ever one instance — nothing else configures one. */
let toastConfigured = false;
function toastLib() {
  const lib = (typeof window !== 'undefined' && window.toast) || null;
  if (lib && !toastConfigured) {
    toastConfigured = true;
    lib.configure({
      position: TOAST_POSITION,
      maxToasts: TOAST_MAX,
      duration: TOAST_MS,
      closable: true,
      pauseOnHover: true,
      showProgress: false,
    });
  }
  return lib;
}

function dismissToast() {
  // Replacing a message replaces its sound. The gallery shows one at a
  // time and the batch loops lean on that, so two tones can overlap: a
  // tone that outlived the message it belonged to would be announcing
  // something the visitor can no longer see.
  stopToastDing();
  const lib = toastLib();
  if (!lib || toastId == null) return;
  // dismissAll, not dismiss(id): dismiss() plays the exit transition and
  // leaves the entry in the library's stack until it ends, and a second
  // dismissed-but-still-animating toast can wedge the maxToasts eviction
  // loop. dismissAll removes immediately, which is also what this UI did
  // before — one message is replaced by the next, not slid away.
  lib.dismissAll();
  toastId = null;
}

/* The Undo for the message it belongs to. hcg-toast renders the icon,
   the body and the dismiss glyph and nothing else, so both are placed
   into the live toast element after it is shown and removed with it.
   Undo goes inside the body's column, under the message, because that
   is where Penguin puts the actions on a message-style notification.
   Same affordance, same guarantee: undo always reverses the most recent
   change made from the gallery, so a second change inside the window is
   what Undo takes back. */
function decorateToast(id, undo) {
  const item = document.querySelector(`.hcg-toast-item[data-toast-id="${id}"]`);
  if (!item) return;

  const close = item.querySelector('.hcg-toast-close');
  if (close) close.innerHTML = TOAST_CLOSE_GLYPH;
  if (!undo) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'toastUndo';
  btn.className = 'toast-undo';
  btn.textContent = 'Undo';
  btn.addEventListener('click', () => { dismissToast(); undo(); });
  (item.querySelector('.hcg-toast-body') || item).appendChild(btn);
}



/* A message, optionally carrying the Undo for what it is reporting.
   `opts === true` is the shorthand the batch loops use for a sticky
   progress line. */
function showToast(msg, opts = {}) {
  const lib = toastLib();
  if (!lib) return null;
  // Copied, not aliased: the voice chosen below is written back onto the
  // options, and a call site that passed an object it holds onto — or a
  // shared literal — must not come back from showToast carrying a sound
  // it never asked for. A 45-line function that quietly mutates its
  // argument is the kind of thing nobody audits.
  const o = Object.assign({}, opts === true ? { sticky: true } : (opts || {}));
  const undo = o.undo || null;
  // A sticky message with no type of its own is work in flight. Every
  // sticky line in this app is a batch saying what it is doing, so the
  // default has to be the colour that means "still going".
  const type = o.type || (o.sticky ? 'pending' : 'info');
  const duration = o.sticky ? 0 : (undo ? TOAST_UNDO_MS : TOAST_MS);

  // Which voice, when the call site has not named one. Failure is the
  // only outcome a visitor can misread — a message that failed and one
  // that succeeded are often the same sentence with a different verb, so
  // the sound is where the distinction is least likely to be lost. A
  // message offering Undo is a third thing: done, but not settled. An
  // explicit `sound` always wins over both.
  if (!o.sound) {
    o.sound = type === 'error' ? 'error' : (undo ? 'undo' : undefined);
  }

  dismissToast();
  // The library's global is a *callable*, not an object with a .show on
  // it: `toast(message, options)`. Its four typed helpers and the
  // lifecycle methods hang off that function, but `show` does not — that
  // name only exists on the instance you get from `toast.create()`. So
  // `lib.show(...)` throws on every message and the notification never
  // reaches the screen at all.
  //
  // Calling it bare is also the only way a fifth type can exist: the
  // helpers force their own type, whereas `type` as an option is just
  // another field for show() to read.
  const id = lib(msg, {
    type,
    duration,
    closable: true,
    pauseOnHover: true,
    showProgress: false,
    iconHtml: TOAST_GLYPHS[type] || TOAST_GLYPHS.info,
  });
  if (id == null) return null;
  toastId = id;
  decorateToast(id, undo);
  // A sticky *progress* line is a progress bar in words: a batch raises one
  // per photo, and forty dings across one upload is not a notification.
// That is the whole reason for the rule, and it is about frequency, not
  // about stickiness.
//
// Sticky is not the same as "invisible". A sticky line has duration 0, so
// it stays on screen until dismissed or replaced — often for the rest of
// the session. Four call sites raise a sticky *error* that the visitor is
// meant to read and act on: a classification that was not saved, a file
// that could not be deleted. Those are the messages that most need to be
// heard, and silencing them because they happen to be sticky meant the app
// reported its worst outcomes in silence and then sat there.
//
// So the gate is on what the line is *for*: work in flight stays quiet,
// and anything that has come to a stop sounds once — even if it does not
// leave on its own.
  if (!o.sticky || type !== 'pending') playToastDing(o.sound);
  return id;
}

// Failure detail is collected through a batch and surfaced once at the end.
// A per-item error toast would be overwritten by the next item's, and only
// the last would ever be read — so the reasons are gathered and named once.
function failureSuffix(failedNames) {
  if (!failedNames.length) return '';
  const shown = failedNames.slice(0, 3).join(', ');
  const extra = failedNames.length > 3 ? ` and ${failedNames.length - 3} more` : '';
  return ` (${failedNames.length} failed: ${shown}${extra})`;
}

  /* ── Public surface ───────────────────────────────────────────────────
     Deliberate and small. tour/boot.js reads `adminMode` to decide whether
     the walkthrough walks the admin tool set; the tests read the rest to
     exercise the pure model and the repo client with no DOM at all. */
  return {
    get adminMode() { return state.adminMode; },
    state,

    // Repo client
    githubFetch, githubPut, githubDelete, loadTree, loadMetadata, persistMetadata,

    // Journey model
    JOURNEY, JOURNEY_BY_SEQUENCE, FOLDER_STAGES,
    journeyFor, folderSequence, albumStageName, availableCategories,
    classifyPhoto, clsLabel, normalizeCategory, allPhaseOptions,
    extractPhotoDate, prettyName,
    slugify, stageFolder, moveIntoNewAlbum,

    // Assets & duplicates
    buildAssets, discoverFromTree, setAssets, summarizeDuplicates,
    scopeEntries, isAdminCommit, planRestore, renameDerivedName,

    // URLs, names & sources
    rawUrl, pageUrl, imgSrc, cardSrc, lightboxSrc, thumbSrc,
    lightboxIndexFor, openLightbox, startSrcFor,
    sanitizeFilename, cssSafe, escapeHtml, escapeAttr,

    // The search pill's view panel
    SEARCH_MENU, picturesCards, groupPictures, renderSearchMenu,
    toggleSearchMenu, closeSearchMenu, applyViewSize, applyViewOrder,

    // The upload rows' album panel
    phaseGroups, phaseLabel, togglePhaseMenu, closePhaseMenu, pickPhase,

    // Notifications
    showToast, dismissToast,

    // Walkthrough gate
    shouldRequireWalkthrough, WALKTHROUGH_SEEN_KEY,
  };
})();

/* The one deliberate global. The guided tour asks the live page whether an
   admin is signed in (tour/boot.js), and the tests load this file into a
   vm and reach the same object. */
window.__gallery = gallery;

/* The second global, and a function rather than a namespace: the tap log
   behind the "I tapped this and that one came up" report. Exposed so it can
   be read from a phone's console without a build step. `__galleryDiag()`
   summarises; `.clear()` empties it.

   Guarded because several tests slice this file and evaluate a region that
   does not include galleryDiag's definition. */
if (typeof galleryDiag === 'function') window.__galleryDiag = galleryDiag;