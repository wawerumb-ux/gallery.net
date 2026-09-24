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

const IMG_EXT = /\.(png|jpe?g|gif|webp|avif)$/i;
const TOKEN_KEY = 'sn_gallery_token';

const state = {
  folders: {},   // folderName -> [{ path, name, sha }]
  order: [],
  adminMode: false,
  token: null,
  lightboxFolder: null,
  lightboxIndex: 0,
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

  await loadTree(state.adminMode);
}

/* ── Reading the repo ─────────────────────────────────────────── */

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

    // The subtree lists paths relative to itself (no "images/" prefix),
    // so rebuild each full repo path from the raw path here.
    const folders = {};
    for (const item of data.tree) {
      if (item.type !== 'blob' || !IMG_EXT.test(item.path)) continue;
      const slash = item.path.indexOf('/');
      const folder = slash === -1 ? 'General' : item.path.slice(0, slash);
      const name = slash === -1 ? item.path : item.path.slice(slash + 1);
      if (!folders[folder]) folders[folder] = [];
      folders[folder].push({ path: `${imagesPath}/${item.path}`, sha: item.sha, name });
    }
    state.folders = folders;
    state.order = Object.keys(folders).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    render();
  } catch (err) {
    el('loadingState').textContent = 'Could not read the repository — check owner/repo/branch in app.js.';
    showToast(err.message || 'Could not read repository.');
  }
}

function loadDemoData() {
  if (!state.order.length) {
    state.folders = buildDemoFolders();
    state.order = Object.keys(state.folders).sort();
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
    return `
    <section class="phase-section" id="section-${cssSafe(folder)}">
      <div class="phase-header">
        <h2>${escapeHtml(folder)}</h2>
        <span class="phase-header-count">${items.length}</span>
        ${state.adminMode ? `<button class="btn btn-ghost btn-sm add-photos-btn" data-folder="${escapeAttr(folder)}">+ Add photos</button>` : ''}
      </div>
      <div class="grid">
        ${items.map((img, i) => {
          const pretty = prettyName(img.name);
          return `<figure class="card" data-folder="${escapeAttr(folder)}" data-index="${i}">
            <img src="${imgSrc(img)}" alt="${escapeAttr(pretty)}" loading="lazy">
            ${state.adminMode ? `<button class="card-delete" data-path="${escapeAttr(img.path)}" data-sha="${escapeAttr(img.sha)}" data-name="${escapeAttr(pretty)}" aria-label="Delete ${escapeAttr(pretty)}">×</button>` : ''}
            <figcaption>${escapeHtml(pretty)}</figcaption>
          </figure>`;
        }).join('')}
      </div>
    </section>`;
  }).join('');

  gallery.querySelectorAll('.card img').forEach(img => {
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
  gallery.querySelectorAll('.add-photos-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.multiple = true; input.accept = 'image/*';
      input.onchange = () => { if (input.files.length) uploadFiles(btn.dataset.folder, input.files); };
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
      if (e.target.files.length) uploadFiles(name, e.target.files);
      el('newFolderName').value = '';
    };
    el('newFolderFiles').click();
  });

  el('lightboxClose').addEventListener('click', closeLightbox);
  el('lightboxPrev').addEventListener('click', () => lightboxStep(-1));
  el('lightboxNext').addEventListener('click', () => lightboxStep(1));
  el('lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') closeLightbox(); });
  document.addEventListener('keydown', e => {
    if (el('lightbox').hidden) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') lightboxStep(-1);
    if (e.key === 'ArrowRight') lightboxStep(1);
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
}

function closeModal() {
  el('adminModalOverlay').hidden = true;
  el('tokenInput').value = '';
  el('tokenError').hidden = true;
}

/* ── Admin: upload / delete via the GitHub Contents API ─────────── */

async function uploadFiles(folder, fileList) {
  const files = Array.from(fileList);
  if (DEMO_MODE) {
    if (!state.folders[folder]) { state.folders[folder] = []; state.order = Object.keys(state.folders).sort(); }
    for (const file of files) {
      const src = await fileToDataUrl(file);
      state.folders[folder].push({
        path: `${CONFIG.imagesPath || 'images'}/${folder}/${file.name}`,
        sha: `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        demoSrc: src,
      });
    }
    render();
    showToast(`Added ${files.length} photo${files.length > 1 ? 's' : ''} (demo — not saved to GitHub).`);
    return;
  }
  let done = 0;
  showToast(`Uploading 0/${files.length}…`, true);
  for (const file of files) {
    try {
      const base64 = await fileToBase64(file);
      const safeName = sanitizeFilename(file.name);
      await githubPut(`${CONFIG.imagesPath}/${folder}/${safeName}`, base64, `Add ${safeName} via gallery admin`);
    } catch (err) {
      showToast(`Failed: ${file.name} — ${err.message}`);
    }
    done++;
    showToast(`Uploading ${done}/${files.length}…`, true);
  }
  showToast(`Added ${files.length} photo${files.length > 1 ? 's' : ''}.`);
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
  el('lightboxImg').src = imgSrc(img);
  el('lightboxImg').alt = prettyName(img.name);
  el('lightboxCaption').textContent = `${state.lightboxFolder} / ${prettyName(img.name)}`;
}
function closeLightbox() { el('lightbox').hidden = true; }
function lightboxStep(delta) {
  const items = state.folders[state.lightboxFolder];
  state.lightboxIndex = (state.lightboxIndex + delta + items.length) % items.length;
  updateLightbox();
}

/* ── Small helpers ────────────────────────────────────────────── */

function rawUrl(path) {
  return `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
function imgSrc(img) {
  return img.demoSrc || rawUrl(img.path);
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