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

/* '20260621_122750' or 'IMG-20260621-WA0001' → numeric timestamp (for photo order). */
function photoTs(name) {
  const m = name.match(/^(\d{8})_(\d{6})/) || name.match(/^IMG-(\d{8})-WA(\d{4})/i);
  if (m) return parseInt(m[1] + (m[2] ? m[2] : '000000'), 10);
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
    return {
      stage: md.phase,
      group: j ? j.group : null,
      sequence: j ? j.sequence : null,
      activity: md.activity || null,
      reason: 'manual assignment',
      rule: 'gallery.json override',
      confidence: 'explicit',
      needsReview: false,
    };
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
  lightboxFolder: null,
  lightboxIndex: 0,
  pendingUploads: null, // { files: File[], context: folderName|null }
  metadata: {},  // fullRepoPath -> { phase, activity, visual? } (manual overrides)
  _metaHash: null, // last persisted metadata JSON, to avoid no-op writes
  taggingPath: null,
};

const el = (id) => document.getElementById(id);

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

  await loadMetadata(false);
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
  for (const folder of Object.keys(folders)) folders[folder].sort((x, y) => photoTs(x.name) - photoTs(y.name));
  state.folders = folders;
  state.order = Object.keys(folders).sort((a, b) =>
    (folderSequence(a) - folderSequence(b)) || a.localeCompare(b, 'en', { numeric: true })
  );
}

async function loadTree(auth = false) {
  if (DEMO_MODE) { loadDemoData(); return; }
  try {
    const headers = {};
    if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;

    // Get the root tree (non-recursive)
    const rootRes = await githubFetch(
      `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/git/trees/${CONFIG.branch}?recursive=0`,
      { headers }
    );
    if (!rootRes.ok) {
      const errData = await rootRes.json().catch(() => ({}));
      throw new Error(errData.message || `GitHub API error (${rootRes.status})`);
    }
    const rootData = await rootRes.json();

    // Find the images folder in the root tree
    const imagesPath = CONFIG.imagesPath;
    const imagesNode = rootData.tree.find(t => t.path === imagesPath && t.type === 'tree');

    if (!imagesNode) {
      // No images folder yet - check if it might exist deeper
      const prefix = `${imagesPath}/`;
      const folders = {};
      state.folders = folders;
      state.order = [];
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
    const data = await imagesRes.json();

    // Files → logical assets → canonical card per asset. Exact duplicates
    // and responsive variants all collapse into ONE representation.
    setAssets(discoverFromTree(data.tree));
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
  const phases = ['site-survey', 'cable-pull', 'termination-testing', 'rack-build'];
  const folders = {};
  phases.forEach((phase, pIdx) => {
    folders[phase] = Array.from({ length: 4 }, (_, i) => ({
      path: `${CONFIG.imagesPath || 'images'}/${phase}/demo-${i + 1}.svg`,
      sha: `demo-${pIdx}-${i}`,
      name: `demo-${i + 1}.svg`,
      demoSrc: demoImage(phase, i + 1),
    }));
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
  el('loadingState').hidden = true;
  const totalPhotos = Object.values(state.folders).reduce((a, f) => a + f.length, 0);
  el('emptyState').hidden = totalPhotos !== 0;
  el('emptyPath').textContent = CONFIG.imagesPath + '/';
  renderSidebar();
  renderGallery();
  animateIntro(totalPhotos, state.order.length);
}

function renderSidebar() {
  el('phaseList').innerHTML = state.order.map(folder => `
    <li><button class="phase-btn" data-folder="${escapeAttr(folder)}">
      <span>${escapeHtml(folder)}</span><span class="phase-count">${state.folders[folder].length}</span>
    </button></li>
  `).join('');
  el('phaseList').querySelectorAll('.phase-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      el(`section-${cssSafe(btn.dataset.folder)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function renderGallery() {
  const gallery = el('gallery');
  gallery.innerHTML = state.order.map(folder => {
    const items = state.folders[folder];
    const j = journeyFor(folder);
    const stageName = j ? j.stage : folder;
    const needsReview = items.some(img => classifyPhoto(img).needsReview);
    return `
    <section class="phase-section" id="section-${cssSafe(folder)}">
      <div class="phase-header">
        <div class="phase-header-main">
          <h2>${escapeHtml(stageName)}</h2>
          ${j ? `<span class="group-pill">${escapeHtml(j.group)}</span>` : ''}
          <span class="phase-path">${escapeHtml(CONFIG.imagesPath + '/' + folder)}</span>
        </div>
        <span class="phase-header-meta">
          <span class="phase-header-count">${items.length}</span>
          ${needsReview ? `<span class="needs-review-chip" title="Some photos here have no journey stage assigned">Needs Review</span>` : ''}
          ${state.adminMode ? `<button class="btn btn-ghost btn-sm add-photos-btn" data-folder="${escapeAttr(folder)}">+ Add photos</button>` : ''}
        </span>
      </div>
      <div class="grid">
        ${items.map((img, i) => {
          const pretty = prettyName(img.name);
          const c = classifyPhoto(img);
          return `<figure class="card ${c.needsReview ? 'card-needs-review' : ''}" data-group="${escapeAttr(c.group || '')}" data-folder="${escapeAttr(folder)}" data-index="${i}">
            <img class="card-img" src="${thumbSrc(img)}" data-full="${cardSrc(img)}" alt="${escapeAttr(pretty)}" loading="${isFirstPaint(img) ? 'eager' : 'lazy'}" fetchpriority="${isFirstPaint(img) ? 'high' : 'auto'}" decoding="async">
            ${state.adminMode ? `<button class="card-delete" data-path="${escapeAttr(img.path)}" data-sha="${escapeAttr(img.sha)}" data-name="${escapeAttr(pretty)}" aria-label="Delete ${escapeAttr(pretty)}">×</button>` : ''}
            ${state.adminMode ? `<button class="card-tag" data-path="${escapeAttr(img.path)}" data-name="${escapeAttr(pretty)}" title="Classify this photo">tag</button>` : ''}
            <figcaption>${escapeHtml(pretty)}</figcaption>
          </figure>`;
        }).join('')}
      </div>
    </section>`;
  }).join('');

  /* First paint: raw.githubusercontent sends Cache-Control: no-cache, so
     every visit pays DNS + TLS + a full GET unless we preconnect and preload
     the images the user actually sees first. */
  if (!document.querySelector('link[data-gallery-preconnect]')) {
    const a = document.createElement('link');
    a.rel = 'preconnect'; a.href = 'https://raw.githubusercontent.com'; a.setAttribute('data-gallery-preconnect','');
    document.head.appendChild(a);
    const b = document.createElement('link');
    b.rel = 'dns-prefetch'; b.href = 'https://raw.githubusercontent.com';
    document.head.appendChild(b);
  }
  const firstFolder = state.order[0];
  const firstImgs = (firstFolder && state.folders[firstFolder]) ? state.folders[firstFolder].slice(0, 6) : [];
  firstImgs.forEach(img => {
    const pre = document.createElement('link');
    pre.rel = 'preload'; pre.as = 'image'; pre.href = cardSrc(img); pre.fetchPriority = 'high';
    document.head.appendChild(pre);
  });
  gallery.querySelectorAll('.card img').forEach(img => {
    // Blur-up: when the tiny thumb finishes, swap in the full-res image and
    // fade it in (CSS adds the blur + transition). Revisit with SW = instant.
    img.addEventListener('load', () => {
      if (img.src !== img.dataset.full && img.dataset.full) {
        img.src = img.dataset.full;
      } else {
        img.classList.add('is-loaded');
      }
    });
    img.addEventListener('error', () => {
      if (img.src !== img.dataset.full && img.dataset.full) img.src = img.dataset.full;
    });

    img.addEventListener('click', () => {
      const card = img.closest('.card');
      openLightbox(card.dataset.folder, Number(card.dataset.index));
    });
  });
  gallery.querySelectorAll('.card-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteImage(btn.dataset.path, btn.dataset.sha, btn.dataset.name);
    });
  });
  gallery.querySelectorAll('.card-tag').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTagModal(btn.dataset.path, btn.dataset.name);
    });
  });
  gallery.querySelectorAll('.add-photos-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.multiple = true; input.accept = 'image/*';
      input.onchange = () => { if (input.files.length) openUploadConfirm(input.files, btn.dataset.folder); };
      input.click();
    });
  });
}

/* One deliberate load moment: counters tick up, a trace line draws under the header. */
function animateIntro(totalPhotos, totalFolders) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    el('statPhotos').textContent = totalPhotos;
    el('statFolders').textContent = totalFolders;
    el('traceLine').style.transform = 'scaleX(1)';
    return;
  }
  requestAnimationFrame(() => { el('traceLine').style.transform = 'scaleX(1)'; });
  animateCount(el('statPhotos'), totalPhotos);
  animateCount(el('statFolders'), totalFolders);
}
function animateCount(node, target) {
  if (target === 0) { node.textContent = '0'; return; }
  const duration = 700, start = performance.now();
  (function tick(now) {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3); // Ease-out cubic
    node.textContent = Math.round(eased * target);
    if (p < 1) requestAnimationFrame(tick);
  })(start);
}

/* ── Admin: sign in / out ─────────────────────────────────────── */

function wireStaticEvents() {
  el('adminToggle').addEventListener('click', () => {
    if (state.adminMode) signOut();
    else { el('adminModalOverlay').hidden = false; el('tokenInput').focus(); }
  });
  el('toastClose').addEventListener('click', () => { el('toast').hidden = true; });
  el('tokenCancel').addEventListener('click', closeModal);
  el('tokenSubmit').addEventListener('click', trySignIn);
  el('tokenInput').addEventListener('keydown', e => { if (e.key === 'Enter') trySignIn(); });
  el('adminModalOverlay').addEventListener('click', e => { if (e.target.id === 'adminModalOverlay') closeModal(); });

  el('newFolderBtn').addEventListener('click', () => {
    const name = sanitizeFilename(el('newFolderName').value).toLowerCase();
    if (!name) return showToast('Enter a folder name first.');
    el('newFolderFiles').onchange = (e) => {
      if (e.target.files.length) openUploadConfirm(e.target.files, name);
      el('newFolderName').value = '';
    };
    el('newFolderFiles').click();
  });

  el('sortPhotosBtn').addEventListener('click', () => { if (state.adminMode) openSortPreview(); });
  el('sortCancel').addEventListener('click', () => { el('sortModalOverlay').hidden = true; });
  el('sortConfirm').addEventListener('click', performSortMoves);
  el('sortModalOverlay').addEventListener('click', e => { if (e.target.id === 'sortModalOverlay') el('sortModalOverlay').hidden = true; });

  el('uploadCancel').addEventListener('click', () => { el('uploadModalOverlay').hidden = true; state.pendingUploads = null; });
  el('uploadConfirm').addEventListener('click', performUploads);
  el('uploadModalOverlay').addEventListener('click', e => {
    if (e.target.id === 'uploadModalOverlay') { el('uploadModalOverlay').hidden = true; state.pendingUploads = null; }
  });

  el('tagCancel').addEventListener('click', () => { el('tagModalOverlay').hidden = true; state.taggingPath = null; });
  el('tagSave').addEventListener('click', saveTagModal);
  el('tagModalOverlay').addEventListener('click', e => {
    if (e.target.id === 'tagModalOverlay') { el('tagModalOverlay').hidden = true; state.taggingPath = null; }
  });

  el('lightboxClose').addEventListener('click', closeLightbox);
  el('lightboxPrev').addEventListener('click', () => lightboxStep(-1));
  el('lightboxNext').addEventListener('click', () => lightboxStep(1));
  el('lightboxDownload').addEventListener('click', downloadFromLightbox);
  el('lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') closeLightbox(); });
  document.addEventListener('keydown', e => {
    if (el('lightbox').hidden) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') lightboxStep(-1);
    if (e.key === 'ArrowRight') lightboxStep(1);
    if (e.key === 'd' || e.key === 'D') downloadFromLightbox();
  });
}

async function trySignIn() {
  const token = el('tokenInput').value.trim();
  if (!token) return;
  if (DEMO_MODE) {
    state.token = 'demo';
    state.adminMode = true;
    closeModal();
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
    closeModal();
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
  sessionStorage.removeItem(TOKEN_KEY);
  updateAdminUI();
  render();
  showToast('Signed out.');
}

function updateAdminUI() {
  el('adminToggle').textContent = state.adminMode ? 'Sign out' : 'Admin';
  el('newFolderPanel').hidden = !state.adminMode;
  el('sortPhotosBtn').hidden = !state.adminMode;
}

function closeModal() {
  el('adminModalOverlay').hidden = true;
  el('tokenInput').value = '';
  el('tokenError').hidden = true;
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
  el('uploadModalOverlay').hidden = false;
}

async function performUploads() {
  const groups = {};
  state.pendingUploads.files.forEach((file, i) => {
    const sel = el('uploadPickList').querySelector(`select[data-idx="${i}"]`);
    const folder = sel ? sel.value : (state.pendingUploads.context || 'General');
    (groups[folder] = groups[folder] || []).push(file);
  });
  el('uploadModalOverlay').hidden = true;
  state.pendingUploads = null;

  let total = Object.values(groups).reduce((a, g) => a + g.length, 0);
  let done = 0;
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
        const src = await fileToDataUrl(file);
        state.folders[folder].push({
          path: `${CONFIG.imagesPath || 'images'}/${folder}/${file.name}`,
          sha: `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          demoSrc: src,
        });
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
        await githubPut(path, base64, `Add ${safeName} via gallery admin`);
        const j = journeyFor(folder);
        state.metadata[path] = { phase: j ? j.stage : folder, activity: '' };
      } catch (err) {
        showToast(`Failed: ${file.name} — ${err.message}`);
      }
      done++;
      showToast(`Uploading ${done}/${total}…`, true);
    }
  }
  showToast(`Added ${total} photo${total === 1 ? '' : 's'}.`);
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
  el('tagModalOverlay').hidden = false;
}

async function saveTagModal() {
  const path = state.taggingPath;
  const phase = el('tagStage').value;
  const activity = el('tagActivity').value.trim();
  if (phase || activity) state.metadata[path] = { phase, activity };
  else delete state.metadata[path];
  el('tagModalOverlay').hidden = true;
  state.taggingPath = null;
  render();
  try {
    await persistMetadata();
    showToast('Saved classification.');
  } catch (err) {
    showToast(`Metadata not saved: ${err.message}`);
  }
}

/* Admin → Sort photos: propose moves only for strays and identity-pattern
   re-files. Date windows never touch a filed photo; manual metadata overrides
   never move files. Uses blob SHAs already fetched from the tree, so no
   re-download of content. */
function buildSortProposals() {
  const proposals = [];
  for (const folder of state.order) {
    for (const img of state.folders[folder]) {
      const identity = IDENTITY_RULES.find(rule => rule.pattern.test(img.name));
      const to = suggestPhase(img.name);
      if (!to || folder === to) continue;
      // Identity rules can re-file anything; date rules only file strays.
      if (!identity && isConfigPhase(folder)) continue;
      proposals.push({ img, from: folder, to, cls: classifyPhoto(img) });
    }
  }
  return proposals;
}

function openSortPreview() {
  const proposals = buildSortProposals();
  const needsReview = [];
  for (const folder of state.order) {
    for (const img of state.folders[folder]) {
      const c = classifyPhoto(img);
      if (c.needsReview) needsReview.push({ img, folder, cls: c });
    }
  }
  el('sortModalCopy').textContent = proposals.length
    ? `${proposals.length} photo${proposals.length === 1 ? '' : 's'} to move:`
    : 'All photos are already filed in their classified stage folders.';
  el('sortPickList').innerHTML = proposals.map((p, i) => `
    <label class="pick-row pick-check">
      <input type="checkbox" data-idx="${i}" checked>
      <span class="pick-name" title="${escapeAttr(p.img.name)}">${escapeHtml(p.img.name)}</span>
      <span class="pick-move">${escapeHtml(p.from)} → ${escapeHtml(p.to)}</span>
      <span class="pick-sub">${escapeHtml(clsLabel(p.cls))}</span>
    </label>`).join('') || (needsReview.length ? '' : '<p class="modal-copy">Nothing to do.</p>');
  el('sortReviewList').innerHTML = needsReview.length
    ? `<p class="modal-copy needs-review-note">Needs Review — ${needsReview.length} photo${needsReview.length === 1 ? '' : 's'} with no stage. No move is proposed; classify them from the gallery.</p>
       ${needsReview.map(r =>
         `<div class="pick-row"><span class="pick-name" title="${escapeAttr(r.img.name)}">${escapeHtml(r.img.name)}</span>
          <span class="pick-move">${escapeHtml(r.folder)}</span><span class="pick-sub">${escapeHtml(clsLabel(r.cls))}</span></div>`
       ).join('')}`
    : '';
  el('sortConfirm').disabled = proposals.length === 0;
  el('sortModalOverlay').hidden = false;
}

async function performSortMoves() {
  const checked = new Set([...el('sortPickList').querySelectorAll('input:checked')].map(c => Number(c.dataset.idx)));
  const proposals = buildSortProposals().filter((_, i) => checked.has(i));
  el('sortModalOverlay').hidden = true;
  if (!proposals.length) return;
  let done = 0;
  showToast(`Moving 0/${proposals.length}…`, true);
  for (const p of proposals) {
    try {
      const src = await githubFetch(
        `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/git/blobs/${p.img.sha}`,
        { headers: { Authorization: `Bearer ${state.token}` } }
      );
      if (!src.ok) throw new Error('could not read source blob');
      const content = (await src.json()).content;
      await githubPut(`${CONFIG.imagesPath}/${p.to}/${p.img.name}`, content, `Sort ${p.img.name} into ${p.to} via gallery admin`);
      await githubDelete(p.img.path, p.img.sha, `Sort ${p.img.name} out of ${p.from} via gallery admin`);
    } catch (err) {
      showToast(`Failed: ${p.img.name} — ${err.message}`);
    }
    done++;
    showToast(`Moving ${done}/${proposals.length}…`, true);
  }
  showToast(`Moved ${proposals.length} photo${proposals.length === 1 ? '' : 's'}.`);
  await loadTree(true);
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

async function githubPut(path, base64Content, message) {
  const res = await githubFetch(contentsUrl(path), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: base64Content, branch: CONFIG.branch }),
  });
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

function openLightbox(folder, index) {
  state.lightboxFolder = folder;
  state.lightboxIndex = index;
  updateLightbox();
  el('lightbox').hidden = false;
}
function updateLightbox() {
  const img = state.folders[state.lightboxFolder][state.lightboxIndex];
  const lb = el('lightboxImg');
  lb.src = thumbSrc(img);                 // blur-up thumb first — instant
  lb.dataset.full = imgSrc(img);          // full-res swaps in on load
  lb.classList.remove('is-loaded');       // start blurred
  lb.onload = () => {
    if (lb.src !== lb.dataset.full && lb.dataset.full) {
      lb.src = lb.dataset.full;           // now pull the real one
    } else {
      lb.classList.add('is-loaded');      // and only then sharpen
    }
  };
  lb.onerror = () => { if (lb.src !== lb.dataset.full && lb.dataset.full) lb.src = lb.dataset.full; };
  lb.alt = prettyName(img.name);
  el('lightboxCaption').textContent = `${state.lightboxFolder} / ${prettyName(img.name)}`;
}
function closeLightbox() { el('lightbox').hidden = true; }
function lightboxStep(delta) {
  const items = state.folders[state.lightboxFolder];
  state.lightboxIndex = (state.lightboxIndex + delta + items.length) % items.length;
  updateLightbox();
}

/* Visitor-safe download: never sends the admin token, never puts a token in
   any URL. Demo mode uses the in-page data URL directly; live mode fetches
   the raw bytes (raw.githubusercontent serves CORS with `Access-Control-Allow-
   Origin: *` and needs no token), converts to a blob + object URL, and saves
   via an anchor with the `download` attribute. If the fetch fails (offline /
   /CORS hiccup) it opens the tokenless raw URL in a new tab so the visitor
   can still save the image. */
async function downloadFromLightbox() {
  const img = state.folders[state.lightboxFolder][state.lightboxIndex];
  if (!img) return;
  const filename = sanitizeFilename(img.name) ||
    (prettyName(img.name).toLowerCase().replace(/\s+/g, '-') || 'gallery-photo') + '.jpg';

  if (img.demoSrc) {
    const a = document.createElement('a');
    a.href = img.demoSrc;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast(`Saved ${prettyName(img.name)}`);
    return;
  }

  try {
    const res = await fetch(pageUrl(img.path));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast(`Saved ${prettyName(img.name)}`);
  } catch (err) {
    window.open(pageUrl(img.path), '_blank', 'noopener');
    showToast('Opened in a new tab — use “Save image as…”', true);
  }
}

/* ── Small helpers ────────────────────────────────────────────── */

function rawUrl(path) {
  return `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
function isFirstPaint(img) {
  if (!state.order || !state.order.length || !state.folders) return false;
  const first = state.order[0];
  if (img.folder !== first) return false;
  const idx = (state.folders[first] || []).findIndex(f => f.path === img.path);
  return idx >= 0 && idx < 3;
}

function thumbSrc(img) {
  // Tiny jsDelivr resize → instant low-res placeholder per card; full-res
  // loads on top via data-full (Pinterest/Unsplash blur-up pattern).
  // jsDelivr sends real Cache-Control headers so even the thumbs are cached.
  if (img.demoSrc) return img.demoSrc;
  if (!CONFIG.owner || !CONFIG.repo) return imgSrc(img);
  const rel = img.path.split('/').map(encodeURIComponent).join('/');
  return `https://cdn.jsdelivr.net/gh/${encodeURIComponent(CONFIG.owner)}/${encodeURIComponent(CONFIG.repo)}@${encodeURIComponent(CONFIG.branch)}/${rel}?w=64&q=50&blur=on`;
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
function cardSrc(img) {
  // Grid: prefer the smallest committed webp variant (client-ready, ~80 KB)
  // over the multi-MB original; the full-res original only loads in the
  // lightbox. Falls back to the original if no variants are committed yet.
  if (img.demoSrc) return img.demoSrc;
  const asset = (state.assets || []).find(a => a.canonical.path === img.path);
  const v = asset && asset.variants.filter(x => /\.webp$/i.test(x.name));
  if (v && v.length) return pageUrl(v[0].path);
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
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}