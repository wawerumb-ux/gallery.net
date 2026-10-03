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
const FOLDER_STAGES = {
  'site-survey':         1,
  'cable-pull':          4,
  'rack-build':          6,
  'phase-1':             6, // WhatsApp batch — rack installation work (user-confirmed)
  'termination-testing': 10,
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

const state = {
  folders: {},   // folderName -> [{ path, name, sha }] (one canonical item per logical asset)
  order: [],
  assets: [],    // [{ id, folder, items, canonical, variants, exactDuplicate, sha256 }]
  duplicateSummary: { totalFiles: 0, uniqueAssets: 0, exactDuplicateFiles: 0, visualDuplicateCandidates: 0 },
  adminMode: false,
  token: null,
  view: 'images', // 'images' = Pictures tab (day-grouped wall), 'phases' = Albums tab
  picturesList: [],   // flat [{img, folder, index}] newest-first — the Pictures tab order
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
  taggingPath: null,
};

const el = (id) => document.getElementById(id);

// Loading status: "loading images..." + Arch-style ASCII progress bar.
const LOAD_PROG_WIDTH = 24;
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
      setTimeout(() => { gate.hidden = true; gate.style.opacity = ''; }, 320);
    }, delay);
  },
};

// Fetch timeout in milliseconds
const FETCH_TIMEOUT = 10000;

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

// Helper: fetch with timeout and rate limit tracking.
// Only unauthenticated requests are throttled — a PAT rides a separate quota,
// so a stalling public rate limit must never block signing in or uploads.
async function githubFetch(url, options = {}) {
  const authHeader = options.headers && (options.headers.Authorization || options.headers.authorization);
  const authed = !!authHeader;

  // Check if we should throttle due to rate limits
  if (!authed && rateLimitReset > Date.now() / 1000) {
    const waitMs = (rateLimitReset - Date.now() / 1000) * 1000 + 1000;
    showToast(`GitHub rate limit reached — waiting ${Math.round(waitMs / 1000)}s...`, true);
    await new Promise(r => setTimeout(r, waitMs));
    el('toast').hidden = true;
  }

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

    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    abortController = null;
    if (err.name === 'AbortError') {
      throw new Error('Request timed out after ' + FETCH_TIMEOUT / 1000 + 's');
    }
    throw err;
  }
}

document.addEventListener('DOMContentLoaded', init);

async function init() {
  el('demoBadge').hidden = !DEMO_MODE;
  state.token = sessionStorage.getItem(TOKEN_KEY);
  state.adminMode = DEMO_MODE ? false : !!state.token;
  updateAdminUI();
  wireStaticEvents();
  syncAppbar();

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
}

/* ── Reading the repo ─────────────────────────────────────────── */

/* gallery.json maps a full repo path to { phase, activity } — manually
   assigned classifications. Read as raw so it also works without a token.
   Missing or malformed file simply starts empty. */
async function loadMetadata(auth = false) {
  state.metadata = {};
  if (DEMO_MODE) return;
  const headers = {};
  if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;
  try {
    const res = await githubFetch(rawUrl('gallery.json'), { headers });
    if (!res.ok) return;
    const data = JSON.parse(await res.text());
    state.metadata = data && typeof data === 'object' ? data : {};
  } catch (err) {
    console.warn('No gallery.json metadata yet — starting clean.', err && err.message);
  }
}

/* Persist manual classifications to gallery.json (one commit) unless the
   content is unchanged. Demo mode never touches GitHub. */
async function persistMetadata() {
  if (DEMO_MODE) return;
  const json = JSON.stringify(state.metadata, null, 2);
  if (state._metaHash === json) return;
  const encoded = btoa(unescape(encodeURIComponent(json)));
  await githubPut('gallery.json', encoded, 'Update photo classification metadata via gallery admin');
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

function basenameStem(name) { return name.replace(/\.[^.]+$/, ''); }
function isVariantName(name) { return VARIANT_REGEX.test(basenameStem(name)); }
function assetBase(name) { return basenameStem(name).replace(VARIANT_REGEX, '').toLowerCase(); }

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
      throw new Error(errData.message || `GitHub API error (${rootRes.status})`);
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
      throw new Error(errData.message || `GitHub API error (${imagesRes.status})`);
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
    el('loadingState').textContent = 'Could not read the repository — check owner/repo/branch in app.js.';
    showToast(err.message || 'Could not read repository.');
  }
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
    else setTimeout(() => loadProg.finish(), 6000);
  }
  // A re-render can stale the open viewer (rename/delete/classify) — refresh it.
  if (!el('lightbox').hidden) updateLightbox();
}

/* ── Bottom tabs (Pictures / Albums) ───────────────────────────────
   Both views are always rendered; a tab switch just reveals one and
   restores its scroll position, so flipping tabs never loses place. */
function setView(view) {
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
}

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
  const j = folder ? journeyFor(folder) : null;
  const name = folder ? (j ? j.stage : folder) : 'Gallery';
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

/* Admin quick-find: hide cards/albums that don't match the query, and fold
   away day groups left empty by the filter. */
function applyAdminFilter() {
  const input = el('adminSearch');
  const wrap = el('searchWrap');
  if (!input || !wrap || wrap.hidden) return;
  const q = input.value.trim().toLowerCase();
  const scope = el('adminSearchFilter').value;
  let visible = 0, total = 0;
  document.querySelectorAll('#picturesView .card[data-path]').forEach(card => {
    total++;
    const hit = !q || (card.dataset.path || '').toLowerCase().includes(q);
    const show = !q || (scope !== 'phase' && hit);
    card.hidden = !show;
    if (show) visible++;
  });
  document.querySelectorAll('#picturesView .day').forEach(day => {
    if (q && scope === 'phase') { day.hidden = true; return; }
    day.hidden = !!q && ![...day.querySelectorAll('.card')].some(c => !c.hidden);
  });
  document.querySelectorAll('#albumsView .album').forEach(alb => {
    total++;
    const hit = !q || (alb.dataset.folder || '').toLowerCase().includes(q);
    const show = !q || (scope !== 'image' && hit);
    alb.hidden = !show;
    if (show) visible++;
  });
  // An open album detail holds photo cards too — same rules as the wall.
  document.querySelectorAll('#albumDetailView .card[data-path]').forEach(card => {
    total++;
    const hit = !q || (card.dataset.path || '').toLowerCase().includes(q);
    const show = !q || (scope !== 'phase' && hit);
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
  return `<figure class="card${c.needsReview ? ' card-needs-review' : ''}${sel ? ' card-selectable' : ''}${picked ? ' card-selected' : ''}" data-group="${escapeAttr(c.group || '')}" data-folder="${escapeAttr(folder)}" data-index="${i}" data-path="${escapeAttr(img.path)}">
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
  const stageName = j ? j.stage : folder;
  const needsReview = items.some(img => classifyPhoto(img).needsReview);
  const coverIdx = items.length - 1;
  const cover = items[coverIdx];
  return `<figure class="album" data-folder="${escapeAttr(folder)}" data-index="${coverIdx}" data-group="${escapeAttr(j ? j.group : '')}">
    <div class="album-cover">
      <img src="${thumbSrc(cover)}" data-full="${cardSrc(cover)}" alt="${escapeAttr(stageName)}" loading="lazy" decoding="async">
      ${needsReview ? `<span class="album-badge" title="Some photos here have no journey stage assigned">Needs review</span>` : ''}
      ${state.adminMode ? `<button class="album-more" data-folder="${escapeAttr(folder)}" aria-label="Options for ${escapeAttr(stageName)}">${ICONS.ellipsis}</button>` : ''}
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

/* Pictures tab: every photo on one wall, grouped by day taken (newest first),
   exactly like the S10 Gallery. Day order comes from the camera/WhatsApp
   timestamp in the filename; unparseable names land in "Undated" at the end. */
function picturesCards() {
  return allImageCards().sort((a, b) => {
    const ta = photoTs(a.img.name), tb = photoTs(b.img.name);
    if (ta !== tb) return tb - ta; // newest first
    return a.img.name.localeCompare(b.img.name, 'en', { numeric: true });
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

/* ── Album detail: one tap on a cover reveals that phase's photos in
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
  const stageName = j ? j.stage : folder;
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
      const img = fig.querySelector('img');
      openLightbox(fig.dataset.folder, Number(fig.dataset.index),
        (img && img.classList.contains('is-loaded') && img.currentSrc) ? img.currentSrc : null);
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
    // Blur-up: when the tiny thumb finishes, swap in the full-res image and
    // fade it in (CSS adds the blur + transition). Revisit with SW = instant.
    img.addEventListener('load', () => {
      // Reveal the moment the tiny thumb finishes — never gate the blur-clear
      // on the heavier sharp tier. The upgrade then happens in the background;
      // on 1x screens src and data-full are the same file, so no 2nd fetch.
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
      // hit = instant, no re-download, no blur flash). Null = card still
      // loading → start at the sharp tier.
      const img = fig.querySelector('img');
      openLightbox(fig.dataset.folder, Number(fig.dataset.index),
        (img && img.classList.contains('is-loaded') && img.currentSrc) ? img.currentSrc : null);
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

/* S10 selection gesture: long-press a photo (touch) or right-click it
   (desktop) to enter selection mode with that photo picked. */
function wireLongPress(fig) {
  let timer = null, sx = 0, sy = 0;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  fig.addEventListener('touchstart', e => {
    if (!state.adminMode || state.batchSelect) return;
    if (!e.touches || e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    timer = setTimeout(() => {
      timer = null;
      state._suppressClickUntil = Date.now() + 700;
      enterSelectMode(fig.dataset.path);
      if (navigator.vibrate) navigator.vibrate(15);
    }, 480);
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

/* ── Browser back: overlays & section jumps ─────────────────────
   Opening the lightbox or a modal — or clicking a phase in the
   sidebar — pushes a history entry, so the back button (and the
   mobile back gesture / edge swipe) returns to what was visible
   before instead of leaving the site. Explicit closes unwind their
   entry; the popstate listener does the actual hiding so the DOM
   and the URL history always agree. Direct closing is the file://
   fallback, where pushState is unreliable. */
const overlayRegistry = {};
const overlayStack = [];
let suppressPopstate = false;

function overlayPush(id, closeFn) {
  overlayRegistry[id] = closeFn;
  if (location.protocol === 'file:') return;
  try {
    history.pushState({ 'gallery-overlay': id }, '');
    overlayStack.push(id);
  } catch (_) {}
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
    if (location.protocol !== 'file:') {
      suppressPopstate = true;
      try { history.go(-1); } catch (_) {}
    }
  }
}

window.addEventListener('popstate', (e) => {
  if (suppressPopstate) { suppressPopstate = false; return; }
  const id = overlayStack.pop();
  if (id) return overlayHide(id);
});

/* Overlay close routines (shared by the X/Esc/outside handlers and the
   back-button popstate path, so both run identical cleanup). */
function closeUploadModal() { el('uploadModalOverlay').hidden = true; state.pendingUploads = null; }
function closeSortModal() { el('sortModalOverlay').hidden = true; }
function closeSettingsModal() { el('settingsModalOverlay').hidden = true; }
function closeTagModal() { el('tagModalOverlay').hidden = true; state.taggingPath = null; }

/* ── Admin: sign in / out ─────────────────────────────────────── */

function wireStaticEvents() {
  // Bottom tabs
  el('tabPictures').addEventListener('click', () => setView('images'));
  el('tabAlbums').addEventListener('click', () => setView('phases'));

  // ⋮ overflow → bottom sheet
  el('menuBtn').addEventListener('click', mainMenu);
  el('sheetOverlay').addEventListener('click', e => { if (e.target.id === 'sheetOverlay') overlayClose('sheetOverlay'); });

  // Admin search (header pill)
  el('adminSearch').addEventListener('input', applyAdminFilter);
  el('adminSearch').addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); e.target.value = ''; applyAdminFilter(); }
  });
  el('adminSearchFilter').addEventListener('change', applyAdminFilter);

  // FAB + new-album dialog
  el('fabAdd').addEventListener('click', () => pickFiles(null));
  el('newFolderBtn').addEventListener('click', () => {
    const name = sanitizeFilename(el('newFolderName').value).toLowerCase();
    if (!name) return showToast('Enter an album name first.');
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
  el('toastClose').addEventListener('click', () => { el('toast').hidden = true; });
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

  // Upload confirm modal
  el('uploadCancel').addEventListener('click', () => overlayClose('uploadModalOverlay'));
  el('uploadConfirm').addEventListener('click', performUploads);
  el('uploadModalOverlay').addEventListener('click', e => {
    if (e.target.id === 'uploadModalOverlay') overlayClose('uploadModalOverlay');
  });

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
    onDownloadComplete: () => showToast(`Saved ${viewerDownloadName}`),
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
  window.addEventListener('resize', syncAppbar);
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
    showToast('Demo admin session — nothing leaves this browser tab.');
    return;
  }
  const submit = el('tokenSubmit');
  submit.disabled = true; submit.textContent = 'Checking…';
  try {
    const res = await githubFetch(`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error('Token was rejected by GitHub.');
    if (!data.permissions || !data.permissions.push) throw new Error('This token does not have write access to the repo.');
    state.token = token;
    state.adminMode = true;
    sessionStorage.setItem(TOKEN_KEY, token);
    console.warn('GitHub PAT stored in sessionStorage — do not share screenshots of this console.');
    overlayClose('adminModalOverlay');
    updateAdminUI();
    await loadMetadata(true);
    await loadTree(true);
    showToast('Signed in — you can add and remove photos now.');
  } catch (err) {
    el('tokenError').hidden = false;
    el('tokenError').textContent = err.message;
  } finally {
    submit.disabled = false; submit.textContent = 'Sign in';
  }
}

function signOut() {
  state.token = null;
  state.adminMode = false;
  exitBatchSelect();
  sessionStorage.removeItem(TOKEN_KEY);
  updateAdminUI();
  render();
  showToast('Signed out.');
}

function updateAdminUI() {
  el('fabAdd').hidden = !state.adminMode;
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

function closeSheet() { el('sheetOverlay').hidden = true; }

/* Header ⋮: everyone gets the walkthrough; a visitor also gets sign-in,
   the admin gets the full tool set. */
function mainMenu() {
  const items = [
    { icon: ICONS.route, label: 'Project walkthrough', onTap: () => { window.location.href = 'walkthrough/'; } },
    ...(state.adminMode ? [
      { icon: ICONS.photoAdd, label: 'Add photos', onTap: () => pickFiles(null) },
      { icon: ICONS.folderAdd, label: 'New album…', onTap: openNewAlbumModal },
      { icon: ICONS.checkCircle, label: 'Select photos', onTap: () => enterSelectMode() },
      { icon: ICONS.gear, label: 'Album settings', onTap: () => openSettingsModal() },
      { icon: ICONS.signOut, label: 'Sign out', onTap: signOut },
    ] : [
      { icon: ICONS.signIn, label: 'Admin sign in', onTap: openAdminModal },
    ]),
  ];
  openSheet({ title: DEMO_MODE ? 'Demo data — nothing leaves this tab' : undefined, items });
}

/* Album cover ⋮: quick actions scoped to that one album. */
function albumMenu(folder) {
  const j = journeyFor(folder);
  openSheet({
    title: j ? j.stage : folder,
    items: [
      { icon: ICONS.photoAdd, label: 'Add photos', onTap: () => pickFiles(folder) },
      { icon: ICONS.gear, label: 'Album settings', onTap: () => openSettingsModal(folder) },
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

/* Classify-and-confirm upload flow: every file row gets a phase dropdown
   prefilled with the algorithm's best guess so you can override per file. */
function openUploadConfirm(fileList, contextFolder) {
  state.pendingUploads = { files: Array.from(fileList), context: contextFolder };
  const options = allPhaseOptions(contextFolder);
  const optsHtml = name => options
    .map(o => `<option value="${escapeAttr(o)}" ${o === name ? 'selected' : ''}>${escapeHtml(o)}</option>`)
    .join('');
  el('uploadPickList').innerHTML = state.pendingUploads.files.map((file, i) => {
    const guess = suggestPhase(file.name);
    const prefill = contextFolder || guess || 'General';
    const hint = guess && guess !== contextFolder
      ? `<span class="pick-hint">suggested: ${escapeHtml(guess)}${(() => { const j = journeyFor(guess); return j ? ' · ' + escapeHtml(j.stage) : ''; })()}</span>` : '';
    return `<div class="pick-row">
      <span class="pick-name" title="${escapeAttr(file.name)}">${escapeHtml(file.name)}</span>
      <span class="pick-control">
        <select class="pick-select" data-idx="${i}">${optsHtml(prefill)}</select>${hint}
      </span>
    </div>`;
  }).join('');
  el('uploadConfirm').textContent = `Upload ${state.pendingUploads.files.length}`;
  overlayPush('uploadModalOverlay', closeUploadModal);
  el('uploadModalOverlay').hidden = false;
}

async function performUploads() {
  const groups = {};
  state.pendingUploads.files.forEach((file, i) => {
    const sel = el('uploadPickList').querySelector(`select[data-idx="${i}"]`);
    const folder = sel ? sel.value : (state.pendingUploads.context || 'General');
    (groups[folder] = groups[folder] || []).push(file);
  });
  overlayClose('uploadModalOverlay');

  let total = Object.values(groups).reduce((a, g) => a + g.length, 0);
  let done = 0, skipped = 0, failed = 0;
  const failedNames = [];

  // Paths already in the gallery → same-name uploads are skipped (a blind PUT
  // would 422 "sha wasn't supplied" and stall the whole batch). Cheap, no API
  // calls; the tree was just fetched.
  const existing = new Set();
  for (const folder of state.order) for (const f of state.folders[folder]) existing.add(f.path);

  showToast(`Uploading 0/${total}…`, true);
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
        if (existing.has(path)) { skipped++; done++; continue; }
        const src = await fileToDataUrl(file);
        state.folders[folder].push({
          path,
          sha: `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          demoSrc: src,
        });
        existing.add(path);
        done++;
        showToast(`Uploading ${done}/${total}…`, true);
      }
      continue;
    }
    for (const file of files) {
      try {
        const base64 = await fileToBase64(file);
        const safeName = sanitizeFilename(file.name);
        const path = `${CONFIG.imagesPath}/${folder}/${safeName}`;
        if (existing.has(path)) { skipped++; done++; continue; }
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
      }
      done++;
      showToast(`Uploading ${done}/${total}…`, true);
    }
  }
  const added = total - skipped - failed;
  showToast(skipped || failed
    ? `Added ${added} photo${added === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped — already in the gallery)` : ''}${failureSuffix(failedNames)}.`
    : `Added ${total} photo${total === 1 ? '' : 's'}.`);
  if (DEMO_MODE) { render(); return; }
  try {
    await persistMetadata();
  } catch (err) {
    showToast(`Photos added, but classification metadata not saved: ${err.message}`);
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

async function saveTagModal() {
  const path = state.taggingPath;
  const phase = el('tagStage').value;
  const activity = el('tagActivity').value.trim();
  const newName = el('tagRename').value.trim();
  if (phase || activity) state.metadata[path] = { phase, activity };
  else delete state.metadata[path];
  overlayClose('tagModalOverlay');

  let renamedLive = false;
  let renameMsg = '';
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
      showToast(`Saved classification — ${renameMsg}`);
    } catch (err) {
      showToast(`Metadata not saved: ${err.message}`);
    }
    return;
  }

  render();
  try {
    await persistMetadata();
    showToast(renameMsg ? `Saved classification — ${renameMsg}` : 'Saved classification.');
  } catch (err) {
    showToast(`Metadata not saved: ${err.message}`);
  }
}

/* ── Admin → Sort: pick photos right on the gallery, then move them all into
   one category. The Done popup is a combobox: pick any existing category or
   type a new one (added on save). Editing the name of an existing category
   creates the new folder and moves the selection there. Moving a photo moves
   its canonical file AND its committed webp variants together. ── */

function availableCategories() { return state.order; }

function normalizeCategory(name) {
  return sanitizeFilename(name).toLowerCase();
}

function resolveTarget(rawValue) {
  const value = (rawValue || '').trim();
  const match = availableCategories().find(f => f.toLowerCase() === value.toLowerCase());
  return match || normalizeCategory(value);
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

function toggleBatchSelect(path) {
  if (state.batchSelected.has(path)) state.batchSelected.delete(path);
  else state.batchSelected.add(path);
  document.querySelectorAll(`#picturesView .card[data-path="${CSS.escape(path)}"], #albumDetailView .card[data-path="${CSS.escape(path)}"]`).forEach(card => {
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
  if (!confirm(`Delete ${paths.length} photo${paths.length === 1 ? '' : 's'}? This can't be undone from here.`)) return;

  if (DEMO_MODE) {
    for (const folder of state.order) {
      state.folders[folder] = state.folders[folder].filter(f => !state.batchSelected.has(f.path));
    }
    exitBatchSelect();
    render();
    showToast(`Deleted ${paths.length} photo${paths.length === 1 ? '' : 's'} (demo).`);
    return;
  }

  let done = 0, failed = 0;
  const failedNames = [];
  showToast(`Deleting 0/${paths.length}…`, true);
  for (const path of paths) {
    const asset = state.assets.find(a => a.canonical.path === path);
    const items = asset ? [asset.canonical, ...asset.variants] : [];
    try {
      for (const item of items) {
        await githubDelete(item.path, item.sha, `Remove ${item.name} via gallery admin`);
      }
    } catch (err) {
      failed++;
      failedNames.push(path.split('/').pop());
    }
    done++;
    showToast(`Deleting ${done}/${paths.length}…`, true);
  }
  exitBatchSelect();
  showToast(failed
    ? `Deleted ${done - failed} photo${done - failed === 1 ? '' : 's'}${failureSuffix(failedNames)}.`
    : `Deleted ${done} photo${done === 1 ? '' : 's'}.`);
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
  if (!to) { showToast('Type or pick a category first.'); return; }
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
    showToast(n ? `Moved ${n} photo${n === 1 ? '' : 's'} into ${to} (demo).` : `Nothing to move into ${to} (demo).`);
    return;
  }

  let done = 0, failed = 0, collided = 0;
  const failedNames = [];
  showToast(`Moving 0/${paths.length}…`, true);
  for (const path of paths) {
    const asset = state.assets.find(a => a.canonical.path === path);
    const items = asset ? [asset.canonical, ...asset.variants] : [];
    const from = items.length ? items[0].path.split('/').slice(-2, -1)[0] : '';
    if (!items.length || !from || from === to) { done++; continue; }
    const collides = items.some(item =>
      (state.folders[to] || []).some(f => f.path === `${CONFIG.imagesPath}/${to}/${item.name}`)
    );
    if (collides) { collided++; done++; showToast(`Skipped ${items[0].name} — ${to} already has that name.`, true); continue; }
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
    done++;
    showToast(`Moving ${done}/${paths.length}…`, true);
  }
  exitBatchSelect();
  const moved = done - failed - collided;
  showToast(failed || collided
    ? `Moved ${moved} photo${moved === 1 ? '' : 's'} into ${to}${failureSuffix(failedNames)}${collided ? ` (${collided} skipped — name already there)` : ''}.`
    : `Moved ${done} photo${done === 1 ? '' : 's'} into ${to}.`);
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
  if (!from) return showToast('Pick a phase first.');
  if (!to) return showToast('Type a new name for the phase.');
  if (to === from) return showToast('New name matches the current phase.');
  if (availableCategories().includes(to)) return showToast(`A phase named "${to}" already exists.`);
  const photos = (state.folders[from] || []).length;
  if (!photos) return showToast(`Nothing to rename in "${from}".`);
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
    showToast(`Renamed "${from}" to "${to}" (demo).`);
    return;
  }

  const affected = state.assets.filter(a => a.folder === from);
  let done = 0, failed = 0;
  const failedNames = [];
  showToast(`Renaming 0/${affected.length}\u2026`, true);
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
    done++;
    showToast(`Renaming ${done}/${affected.length}\u2026`, true);
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
    showToast(`Photos renamed, but metadata not saved: ${err.message}`);
  }
  showToast(failed ? `Renamed "${from}" to "${to}"${failureSuffix(failedNames)}.` : `Renamed "${from}" to "${to}".`);
  await loadTree(true);
}

async function removePhase() {
  const folder = el('settingsPhase').value;
  if (!folder) return showToast('Pick a phase first.');
  const photos = (state.folders[folder] || []).length;
  if (!photos) return showToast(`"${folder}" is empty — nothing to remove.`);
  if (!confirm(`Remove phase "${folder}" and delete all ${photos} photo${photos === 1 ? '' : 's'} inside it? This can't be undone from here.`)) return;
  overlayClose('settingsModalOverlay');

  const prefix = `${CONFIG.imagesPath}/${folder}/`;

  if (DEMO_MODE) {
    for (const key of Object.keys(state.metadata)) if (key.startsWith(prefix)) delete state.metadata[key];
    delete state.folders[folder];
    state.order = Object.keys(state.folders).sort((a, b) =>
      (folderSequence(a) - folderSequence(b)) || a.localeCompare(b, 'en', { numeric: true })
    );
    render();
    showToast(`Removed phase "${folder}" (demo).`);
    return;
  }

  const affected = state.assets.filter(a => a.folder === folder);
  let failed = 0;
  showToast(`Removing 0/${affected.length} photo${affected.length === 1 ? '' : 's'}\u2026`, true);
  for (const asset of affected) {
    for (const item of [asset.canonical, ...asset.variants]) {
      try {
        await githubDelete(item.path, item.sha, `Remove phase ${folder} via gallery admin`);
      } catch (err) {
        failed++;
        showToast(`Failed: ${item.name} — ${err.message}`, true);
      }
    }
  }
  for (const key of Object.keys(state.metadata)) if (key.startsWith(prefix)) delete state.metadata[key];
  try {
    await persistMetadata();
  } catch (err) {
    showToast(`Photos removed, but metadata not saved: ${err.message}`);
  }
  showToast(failed ? `Removed phase "${folder}" (${failed} files failed).` : `Removed phase "${folder}".`);
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
  if (!total) return showToast('Nothing to change — that state is already back.');
  let done = 0, failed = 0;
  const failedNames = [];
  const headers = { Authorization: `Bearer ${state.token}` };
  showToast(`Reverting 0/${total}…`, true);
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
    showToast(`Reverting ${++done}/${total}…`, true);
  }
  for (const { path, sha } of plan.remove) {
    try {
      await githubDelete(path, sha, `${label} ${ADMIN_MARKER}`);
    } catch (err) {
      failed++;
      failedNames.push(path);
    }
    showToast(`Reverting ${++done}/${total}…`, true);
  }
  showToast(failed ? `${label} done${failureSuffix(failedNames)}.` : `${label} done.`);
  await loadTree(true);
}

async function undoLastChange() {
  if (DEMO_MODE) return showToast('Undo steps back a real commit — it only works on the live gallery.');
  try {
    const head = await headCommit();
    if (!isAdminCommit(head)) return showToast('The last change was not made from the gallery — nothing to undo.');
    const parent = head.parents && head.parents[0];
    if (!parent) return showToast('There is no earlier commit to undo to.');
    const cur = await treePathMap(head.sha);
    const tgt = await treePathMap(parent.sha);
    await applyRestore(planRestore(cur, tgt), 'Undo');
  } catch (err) {
    showToast(`Could not undo: ${err.message}`);
  }
}

async function revertAllChanges() {
  if (DEMO_MODE) return showToast('Revert all restores the real repo — it only works on the live gallery.');
  try {
    const log = await commitLog();
    let oldestAdmin = -1;
    for (let i = 0; i < log.length; i++) if (isAdminCommit(log[i])) oldestAdmin = i;
    if (oldestAdmin === -1) return showToast('Nothing was changed from the gallery yet — nothing to revert.');
    const baseline = log[oldestAdmin].parents && log[oldestAdmin].parents[0];
    if (!baseline) return showToast('Could not find the original gallery state.');
    if (!confirm(
      `Return every photo and phase to the original gallery state (commit ${baseline.sha.slice(0, 8)})?\n` +
      'All admin sorts, renames and removals are undone in one step.'
    )) return;
    const cur = await treePathMap(log[0].sha);
    const tgt = await treePathMap(baseline.sha);
    await applyRestore(planRestore(cur, tgt), 'Revert all');
  } catch (err) {
    showToast(`Could not revert all: ${err.message}`);
  }
}

async function deleteImage(path, sha, prettyLabel) {
  if (!confirm(`Delete "${prettyLabel}"? This can't be undone from here.`)) return;
  if (DEMO_MODE) {
    for (const folder of state.order) {
      state.folders[folder] = state.folders[folder].filter(f => f.path !== path);
    }
    render();
    showToast(`Deleted ${prettyLabel} (demo).`);
    return;
  }
  try {
    await githubDelete(path, sha, `Remove ${prettyLabel} via gallery admin`);
    for (const folder of state.order) {
      state.folders[folder] = state.folders[folder].filter(f => f.path !== path);
    }
    render();
    showToast(`Deleted ${prettyLabel}.`);
  } catch (err) {
    showToast(err.message);
  }
}

function contentsUrl(path) {
  return `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/* PUT a file. GitHub's Contents API requires the current file sha to UPDATE
   an existing path (422 "sha wasn't supplied" otherwise), so unless the
   caller opts out (overwrite:false — a "don't clobber" create), an
   acknowledged success is re-fetched for its sha and the write is retried.
   This is what makes gallery.json metadata edits work on a repo that already
   has the file committed (e.g. via the classify modal or upload metadata). */
async function githubPut(path, base64Content, message, opts = {}) {
  const overwrite = opts.overwrite !== false;
  async function attempt(sha) {
    return githubFetch(contentsUrl(path), {
      method: 'PUT',
      headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: base64Content, branch: CONFIG.branch, ...(sha ? { sha } : {}) }),
    });
  }
  let res = await attempt();
  if (!res.ok) {
    const err0 = await res.json().catch(() => ({}));
    const needsSha = /sha wasn't supplied|sha was supposed to be a string|"sha" wasn't supplied/i.test(err0.message || '');
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
}

async function githubDelete(path, sha, message) {
  const res = await githubFetch(contentsUrl(path), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha, branch: CONFIG.branch }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Delete failed (${res.status})`);
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
   position of that same photo in the day-sorted list. */
function lightboxIndexFor(folder, index) {
  if (state.view !== 'images') return index;
  const target = (state.folders[folder] || [])[index];
  if (!target) return 0;
  const at = (state.picturesList || []).findIndex(c => c.img.path === target.path);
  return at >= 0 ? at : 0;
}

function openLightbox(folder, index, startSrc) {
  state.lightboxFolder = folder;
  state.lightboxIndex = lightboxIndexFor(folder, index);
  state.lightboxStartSrc = startSrc || null;
  updateLightbox();
  overlayPush('lightbox', closeLightbox);
  el('lightbox').hidden = false;
}
function updateLightbox() {
  const items = lightboxItems(state.lightboxFolder);
  if (state.lightboxIndex >= items.length) state.lightboxIndex = Math.max(0, items.length - 1);
  const img = items[state.lightboxIndex];
  if (!img) { if (!el('lightbox').hidden) overlayClose('lightbox'); return; }
  const lb = el('lightboxImg');
  // Always open crisp: the LARGEST committed variant (cached once the card
  // revealed, ~66KB if nav); full-res original layers in silently after.
  const start = state.lightboxStartSrc || lightboxSrc(img);
  state.lightboxStartSrc = null;
  lb.src = start;
  lb.dataset.full = imgSrc(img);          // full-res — background upgrade only
  lb.classList.add('is-loaded');          // open clear, never blurred
  lb.onload = () => { if (lb.src !== lb.dataset.full && lb.dataset.full) lb.src = lb.dataset.full; };
  lb.onerror = () => { if (lb.src !== lb.dataset.full && lb.dataset.full) lb.src = lb.dataset.full; };
  lb.alt = prettyName(img.name);
  const folder = state.view === 'images' ? (img.folder || state.lightboxFolder) : state.lightboxFolder;
  const j = journeyFor(folder);
  const iso = extractPhotoDate(img.name);
  el('lightboxName').textContent = prettyName(img.name);
  el('lightboxMeta').textContent = `${iso ? fmtDay(iso, true) : 'Undated'} · ${j ? j.stage : folder}`;
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

/* Viewer bottom-bar admin actions act on the photo on screen. */
function viewerTag() {
  const img = lightboxItems(state.lightboxFolder)[state.lightboxIndex];
  if (img) openTagModal(img.path, prettyName(img.name));
}

async function viewerDelete() {
  const img = lightboxItems(state.lightboxFolder)[state.lightboxIndex];
  if (!img) return;
  await deleteImage(img.path, img.sha, prettyName(img.name));
  // deleteImage re-renders; updateLightbox (via render) clamps or closes.
}
function closeLightbox() { el('lightbox').hidden = true; }
function lightboxStep(delta) {
  const items = lightboxItems(state.lightboxFolder);
  if (!items.length) return;
  state.lightboxIndex = (state.lightboxIndex + delta + items.length) % items.length;
  updateLightbox();
}

/* ── Small helpers ────────────────────────────────────────────── */

function rawUrl(path) {
  return `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
/* The photos at the top of the Pictures wall are what paints first (the
   default tab). Recomputed once per render and read per card, so the check
   stays O(1) for each image. */
let firstPaintPaths = new Set();
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
function cssSafe(s) { return s.replace(/[^a-zA-Z0-9_-]/g, '_'); }
function escapeHtml(s) { return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

let toastTimer;
function showToast(msg, sticky = false) {
  const t = el('toast');
  let span = document.getElementById('toastMessage');
  if (!span) {
    span = document.createElement('span');
    span.id = 'toastMessage';
    t.textContent = '';
    t.appendChild(span);
    let close = document.getElementById('toastClose');
    if (!close) {
      close = document.createElement('button');
      close.type = 'button';
      close.className = 'toast-close';
      close.id = 'toastClose';
      close.setAttribute('aria-label', 'Dismiss');
      close.textContent = '×';
      close.addEventListener('click', () => { t.hidden = true; });
      t.appendChild(close);
    }
  }
  span.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

// Failure detail is collected through a batch and surfaced once at the end,
// because a per-item error toast is immediately overwritten by the next
// progress toast and would never be seen.
function failureSuffix(failedNames) {
  if (!failedNames.length) return '';
  const shown = failedNames.slice(0, 3).join(', ');
  const extra = failedNames.length > 3 ? ` and ${failedNames.length - 3} more` : '';
  return ` (${failedNames.length} failed: ${shown}${extra})`;
}