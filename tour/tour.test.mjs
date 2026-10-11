/* tour/tour.test.mjs — the guided tour's mandatory test suite.

   Same harness as tests/downloadButton.test.mjs: the real
   source files (oneui.js, tour/tour.js, tour/steps.js) run
   inside a node:vm sandbox with a just-rich-enough DOM stub,
   a virtual clock (fake Date.now + timer queue advanced by
   advance(ms)), and an in-memory localStorage.

   Run with: node --test tour/   (Node 18+)

   Covers the spec checklist: gating, detection, confirm +
   unlock, escape, persistence, motion + a11y, and the speed
   multiplier. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const oneuiSrc = fs.readFileSync(join(here, '..', 'oneui.js'), 'utf8');
const tourSrc = fs.readFileSync(join(here, 'tour.js'), 'utf8');
const stepsSrc = fs.readFileSync(join(here, 'steps.js'), 'utf8');

/* ── Selector matching (the tiny subset the engine uses:
      #id, .class, tag, [attr], [attr="v"], descendants) ── */

function parseCompound(part) {
  const out = { tag: null, id: null, classes: [], attrs: [] };
  const re = /#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|([\w-]+)/g;
  let m;
  while ((m = re.exec(part))) {
    if (m[1]) out.id = m[1];
    else if (m[2]) out.classes.push(m[2]);
    else if (m[3]) out.attrs.push({ name: m[3], value: m[4] });
    else if (m[5]) out.tag = m[5].toUpperCase();
  }
  return out;
}

function matchesCompound(el, part) {
  const c = typeof part === 'string' ? parseCompound(part) : part;
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  for (const cls of c.classes) if (!el.classSet.has(cls)) return false;
  for (const a of c.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    if (a.value !== undefined && el.getAttribute(a.name) !== a.value) return false;
  }
  return true;
}

function matchesSelector(el, parts) {
  if (!matchesCompound(el, parts[parts.length - 1])) return false;
  let idx = parts.length - 2;
  let anc = el.parentNode;
  while (anc && anc.nodeType === 1 && idx >= 0) {
    if (matchesCompound(anc, parts[idx])) idx--;
    anc = anc.parentNode;
  }
  return idx < 0;
}

function* walk(el) {
  for (const c of el.children) {
    yield c;
    yield* walk(c);
  }
}

function queryTree(root, sel) {
  const parts = sel.trim().split(/\s+/);
  for (const el of walk(root)) if (matchesSelector(el, parts)) return el;
  return null;
}

function queryTreeAll(root, sel) {
  const parts = sel.trim().split(/\s+/);
  const out = [];
  for (const el of walk(root)) if (matchesSelector(el, parts)) out.push(el);
  return out;
}

/* An element's full text: its own plus every descendant's
   (the stub stores text per-element, like the real DOM). */
function textTree(el) {
  let out = el._textContent || '';
  for (const c of walk(el)) out += c._textContent || '';
  return out;
}

/* ── Element stub ─────────────────────────────────────────── */

function makeEl(tag, opts = {}) {
  const el = {
    nodeType: 1,
    tagName: (tag || 'div').toUpperCase(),
    children: [],
    parentNode: null,
    attrs: {},
    listeners: {},
    styleSets: [],
    classSet: new Set(),
    _textContent: '',
    _innerHTML: '',
    hidden: false,
    id: '',
    value: opts.value || '',
    rect: opts.rect || { top: 100, left: 100, right: 142, bottom: 142, width: 42, height: 42 },
    offsetWidth: opts.offsetWidth != null ? opts.offsetWidth : 260,
    offsetHeight: opts.offsetHeight != null ? opts.offsetHeight : 120,
  };
  let _className = '';
  Object.defineProperty(el, 'className', {
    get: () => _className,
    set: (v) => { _className = v; el.classSet = new Set(String(v).split(/\s+/).filter(Boolean)); },
  });
  Object.defineProperty(el, 'textContent', {
    get: () => el._textContent,
    set: (v) => { el._textContent = String(v); },
  });
  Object.defineProperty(el, 'innerHTML', {
    get: () => el._innerHTML,
    set: (v) => { el._innerHTML = String(v); if (v === '') el.children = []; },
  });
  // Style is a Proxy: every property set is logged so tests can
  // assert that no duration is ever hardcoded (all derive from D).
  el.style = new Proxy({}, {
    set: (t, prop, value) => { t[prop] = value; el.styleSets.push(prop + '=' + value); return true; },
    get: (t, prop) => t[prop],
  });
  el.classList = {
    add: (...cs) => cs.forEach(c => el.classSet.add(c)),
    remove: (...cs) => cs.forEach(c => el.classSet.delete(c)),
    contains: c => el.classSet.has(c),
    toggle: (c, on) => { const want = on ?? !el.classSet.has(c); if (want) el.classSet.add(c); else el.classSet.delete(c); return want; },
  };
  el.setAttribute = (k, v) => {
    el.attrs[k] = String(v);
    if (k === 'id') el.id = String(v);
    if (k === 'class') el.className = String(v);
  };
  el.getAttribute = (k) => {
    if (k === 'id' && el.id) return el.id;
    return k in el.attrs ? el.attrs[k] : null;
  };
  el.hasAttribute = (k) => (k === 'id' ? !!el.id : k in el.attrs);
  el.removeAttribute = (k) => { delete el.attrs[k]; if (k === 'id') el.id = ''; };
  el.addEventListener = (type, fn) => { (el.listeners[type] = el.listeners[type] || []).push(fn); };
  el.removeEventListener = (type, fn) => {
    el.listeners[type] = (el.listeners[type] || []).filter(f => f !== fn);
  };
  el.dispatch = (type, event = {}) => {
    const ev = { preventDefault: () => { ev.defaultPrevented = true; }, stopPropagation: () => {}, isTrusted: true, ...event };
    (el.listeners[type] || []).slice().forEach(fn => fn(ev));
    return ev;
  };
  el.getBoundingClientRect = () => el.rect;
  el.appendChild = (c) => { c.parentNode = el; el.children.push(c); return c; };
  el.removeChild = (c) => {
    const i = el.children.indexOf(c);
    if (i !== -1) el.children.splice(i, 1);
    c.parentNode = null;
    return c;
  };
  el.contains = (node) => {
    if (node === el) return true;
    for (const c of el.children) if (c.contains && c.contains(node)) return true;
    return false;
  };
  el.querySelector = (sel) => queryTree(el, sel);
  el.querySelectorAll = (sel) => queryTreeAll(el, sel);
  return el;
}

/* ── Sandbox harness ──────────────────────────────────────── */

function setup({ reducedMotion = false, multiplierPatch = null, seedState = null } = {}) {
  const RealDate = Date;
  let fakeNow = 1000; // starts above ACTION_DEBOUNCE_MS so the first success is never debounced
  const timers = [];
  const warns = [];
  const navigations = [];
  const pushStates = [];
  const winListeners = {};
  const ioInstances = [];
  const roInstances = [];
  const moInstances = [];
  const store = new Map();
  const created = []; // every element the sandbox ever builds —
                      // styleSets survive teardown for audits
  const reg = (e) => { created.push(e); return e; };

  // The gallery the tour runs on: the real controls, with the
  // data-tour-target attributes index.html/app.js add.
  const body = reg(makeEl('body'));
  const tabPictures = reg(makeEl('button', { rect: { top: 700, left: 100, right: 180, bottom: 742, width: 80, height: 42 } }));
  tabPictures.id = 'tabPictures';
  const tabAlbums = reg(makeEl('button', { rect: { top: 700, left: 190, right: 270, bottom: 742, width: 80, height: 42 } }));
  tabAlbums.id = 'tabAlbums';
  tabAlbums.setAttribute('data-tour-target', 'tab-albums');
  const albumsView = reg(makeEl('section'));
  albumsView.id = 'albumsView';
  const albumCover = reg(makeEl('figure', { rect: { top: 200, left: 200, right: 400, bottom: 400, width: 200, height: 200 } }));
  albumCover.setAttribute('data-tour-target', 'album-cover');
  albumCover.__radius = '16px';
  albumsView.appendChild(albumCover);
  const albumDetailView = reg(makeEl('section'));
  albumDetailView.id = 'albumDetailView';
  const photoCard = reg(makeEl('figure', { rect: { top: 300, left: 300, right: 400, bottom: 400, width: 100, height: 100 } }));
  photoCard.setAttribute('data-tour-target', 'photo-card');
  albumDetailView.appendChild(photoCard);
  const lightbox = reg(makeEl('div'));
  lightbox.id = 'lightbox';
  const viewerPrev = reg(makeEl('button', { rect: { top: 400, left: 850, right: 894, bottom: 444, width: 44, height: 44 } }));
  viewerPrev.id = 'lightboxPrev';
  viewerPrev.setAttribute('data-tour-target', 'viewer-prev');
  const viewerNext = reg(makeEl('button', { rect: { top: 400, left: 1000, right: 1044, bottom: 444, width: 44, height: 44 } }));
  viewerNext.id = 'lightboxNext';
  viewerNext.setAttribute('data-tour-target', 'viewer-next');
  const viewerClose = reg(makeEl('button', { rect: { top: 20, left: 20, right: 62, bottom: 62, width: 42, height: 42 } }));
  viewerClose.id = 'lightboxClose';
  viewerClose.setAttribute('data-tour-target', 'viewer-close');
  const lightboxTag = reg(makeEl('button', { rect: { top: 740, left: 480, right: 560, bottom: 784, width: 80, height: 44 } }));
  lightboxTag.id = 'lightboxTag';
  lightboxTag.setAttribute('data-tour-target', 'viewer-classify');
  const lightboxDelete = reg(makeEl('button', { rect: { top: 740, left: 580, right: 660, bottom: 784, width: 80, height: 44 } }));
  lightboxDelete.id = 'lightboxDelete';
  lightboxDelete.setAttribute('data-tour-target', 'viewer-delete');
  lightbox.appendChild(viewerPrev);
  lightbox.appendChild(viewerNext);
  lightbox.appendChild(viewerClose);
  lightbox.appendChild(lightboxTag);
  lightbox.appendChild(lightboxDelete);
  body.appendChild(tabPictures);
  body.appendChild(tabAlbums);
  body.appendChild(albumsView);
  body.appendChild(albumDetailView);
  body.appendChild(lightbox);

  // The admin-era controls the expanded tour targets. In the
  // real app these render and hide with adminMode, the ⋮ sheet,
  // and the modals; the fixture is a static approximation —
  // the engine only needs querySelector to find the attribute.
  tabPictures.setAttribute('data-tour-target', 'tab-pictures');
  const menuBtn = reg(makeEl('button', { rect: { top: 20, left: 1200, right: 1244, bottom: 64, width: 44, height: 44 } }));
  menuBtn.id = 'menuBtn';
  menuBtn.setAttribute('data-tour-target', 'menu-btn');
  const sheetOverlay = reg(makeEl('div'));
  sheetOverlay.id = 'sheetOverlay';
  const sheetList = reg(makeEl('div'));
  sheetList.id = 'sheetList';
  const sheetItem = (target) => {
    const b = reg(makeEl('button', { rect: { top: 400, left: 780, right: 1020, bottom: 448, width: 240, height: 48 } }));
    b.setAttribute('data-tour-target', target);
    sheetList.appendChild(b);
    return b;
  };
  const menuAdminSignin = sheetItem('menu-admin-signin');
  const menuAddPhotos = sheetItem('menu-add-photos');
  const menuNewAlbum = sheetItem('menu-new-album');
  const menuSelectPhotos = sheetItem('menu-select-photos');
  const menuAlbumSettings = sheetItem('menu-album-settings');
  const menuSignOut = sheetItem('menu-sign-out');
  sheetOverlay.appendChild(sheetList);
  const searchWrap = reg(makeEl('div'));
  searchWrap.id = 'searchWrap';
  const adminSearch = reg(makeEl('input', { value: '' }));
  adminSearch.id = 'adminSearch';
  adminSearch.setAttribute('data-tour-target', 'admin-search');
  const adminSearchFilter = reg(makeEl('select'));
  adminSearchFilter.id = 'adminSearchFilter';
  adminSearchFilter.setAttribute('data-tour-target', 'admin-search-filter');
  searchWrap.appendChild(adminSearch);
  searchWrap.appendChild(adminSearchFilter);
  const selectBar = reg(makeEl('div'));
  selectBar.id = 'selectBar';
  const selectClose = reg(makeEl('button', { rect: { top: 20, left: 20, right: 64, bottom: 64, width: 44, height: 44 } }));
  selectClose.id = 'selectClose';
  selectClose.setAttribute('data-tour-target', 'select-close');
  const selectMove = reg(makeEl('button', { rect: { top: 20, left: 1000, right: 1080, bottom: 64, width: 80, height: 44 } }));
  selectMove.id = 'selectMove';
  selectMove.setAttribute('data-tour-target', 'select-move');
  selectBar.appendChild(selectClose);
  selectBar.appendChild(selectMove);
  body.appendChild(menuBtn);
  body.appendChild(sheetOverlay);
  body.appendChild(searchWrap);
  body.appendChild(selectBar);
  // The six modal Cancel buttons (each lives inside its own
  // overlay in the real markup; the fixture keeps them on the
  // body — the engine resolves them by attribute either way).
  const modalCancel = (id, target) => {
    const b = reg(makeEl('button', { rect: { top: 500, left: 600, right: 660, bottom: 540, width: 60, height: 40 } }));
    b.id = id;
    b.setAttribute('data-tour-target', target);
    body.appendChild(b);
    return b;
  };
  const tokenCancel = modalCancel('tokenCancel', 'admin-modal-cancel');
  const newAlbumCancel = modalCancel('newAlbumCancel', 'new-album-cancel');
  const uploadCancel = modalCancel('uploadCancel', 'upload-cancel');
  const sortCancel = modalCancel('sortCancel', 'move-cancel');
  const settingsCancel = modalCancel('settingsCancel', 'album-settings-cancel');
  const tagCancel = modalCancel('tagCancel', 'classify-cancel');
  // The commit buttons the tour clicks but that change nothing:
  // each is guarded by the app (empty-field toast, confirm() the
  // user cancels, or the same-name/metadata-hash no-op) — except
  // the two marked commit:true in steps.js.
  const uploadConfirm = reg(makeEl('button', { rect: { top: 500, left: 664, right: 784, bottom: 540, width: 120, height: 40 } }));
  uploadConfirm.id = 'uploadConfirm';
  uploadConfirm.setAttribute('data-tour-target', 'upload-confirm');
  const newFolderBtn = reg(makeEl('button', { rect: { top: 500, left: 664, right: 784, bottom: 540, width: 120, height: 40 } }));
  newFolderBtn.id = 'newFolderBtn';
  newFolderBtn.setAttribute('data-tour-target', 'new-album-pick');
  const sortConfirm = reg(makeEl('button', { rect: { top: 500, left: 664, right: 784, bottom: 540, width: 120, height: 40 } }));
  sortConfirm.id = 'sortConfirm';
  sortConfirm.setAttribute('data-tour-target', 'move-confirm');
  const settingsRenameBtn = reg(makeEl('button', { rect: { top: 500, left: 544, right: 624, bottom: 540, width: 80, height: 40 } }));
  settingsRenameBtn.id = 'settingsRenameBtn';
  settingsRenameBtn.setAttribute('data-tour-target', 'settings-rename');
  const settingsRemoveBtn = reg(makeEl('button', { rect: { top: 500, left: 634, right: 744, bottom: 540, width: 110, height: 40 } }));
  settingsRemoveBtn.id = 'settingsRemoveBtn';
  settingsRemoveBtn.setAttribute('data-tour-target', 'settings-remove');
  const settingsUndoBtn = reg(makeEl('button', { rect: { top: 560, left: 544, right: 664, bottom: 600, width: 120, height: 40 } }));
  settingsUndoBtn.id = 'settingsUndoBtn';
  settingsUndoBtn.setAttribute('data-tour-target', 'settings-undo');
  const settingsRevertBtn = reg(makeEl('button', { rect: { top: 560, left: 674, right: 784, bottom: 600, width: 110, height: 40 } }));
  settingsRevertBtn.id = 'settingsRevertBtn';
  settingsRevertBtn.setAttribute('data-tour-target', 'settings-revert');
  const tagSave = reg(makeEl('button', { rect: { top: 500, left: 664, right: 784, bottom: 540, width: 120, height: 40 } }));
  tagSave.id = 'tagSave';
  tagSave.setAttribute('data-tour-target', 'classify-save');
  const fabAdd = reg(makeEl('button', { rect: { top: 600, left: 1180, right: 1256, bottom: 656, width: 56, height: 56 } }));
  fabAdd.id = 'fabAdd';
  fabAdd.setAttribute('data-tour-target', 'fab-add');
  const selectDelete = reg(makeEl('button', { rect: { top: 20, left: 900, right: 990, bottom: 64, width: 90, height: 44 } }));
  selectDelete.id = 'selectDelete';
  selectDelete.setAttribute('data-tour-target', 'select-delete');
  selectBar.appendChild(selectDelete);
  // The per-album ⋮ chip (rendered by albumCardMarkup) and the
  // sheet items openSheet builds from albumMenu().
  const albumMore = reg(makeEl('button', { rect: { top: 210, left: 360, right: 396, bottom: 246, width: 36, height: 36 } }));
  albumMore.setAttribute('data-tour-target', 'album-menu');
  albumsView.appendChild(albumMore);
  const albumMenuAddPhotos = sheetItem('album-menu-add-photos');
  const albumMenuAlbumSettings = sheetItem('album-menu-album-settings');
  // The viewer's DownloadButton: an <a> inside its slot, targeted
  // by container selector so the component is never modified.
  const dlbSlot = reg(makeEl('span', { rect: { top: 740, left: 200, right: 360, bottom: 784, width: 160, height: 44 } }));
  dlbSlot.id = 'lightboxDownloadSlot';
  const dlb = reg(makeEl('a', { rect: { top: 740, left: 200, right: 360, bottom: 784, width: 160, height: 44 } }));
  dlbSlot.appendChild(dlb);
  lightbox.appendChild(dlbSlot);
  body.appendChild(fabAdd);
  body.appendChild(uploadConfirm);
  body.appendChild(newFolderBtn);
  body.appendChild(sortConfirm);
  body.appendChild(settingsRenameBtn);
  body.appendChild(settingsRemoveBtn);
  body.appendChild(settingsUndoBtn);
  body.appendChild(settingsRevertBtn);
  body.appendChild(tagSave);

  class FakeDate {
    static now() { return fakeNow; }
    constructor() { const t = fakeNow; return { toISOString: () => new RealDate(t).toISOString() }; }
  }

  class IntersectionObserver {
    constructor(cb, opts) { this.cb = cb; this.opts = opts; this.targets = []; this.disconnected = false; ioInstances.push(this); }
    observe(t) { this.targets.push(t); }
    unobserve() {}
    disconnect() { this.disconnected = true; }
    trigger(entries) { this.cb(entries, this); }
  }
  class ResizeObserver {
    constructor(cb) { this.cb = cb; this.targets = []; this.disconnected = false; roInstances.push(this); }
    observe(t) { this.targets.push(t); }
    unobserve() {}
    disconnect() { this.disconnected = true; }
    trigger() { this.cb([], this); }
  }
  class MutationObserver {
    constructor(cb) { this.cb = cb; this.disconnected = false; moInstances.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
    trigger() { if (!this.disconnected) this.cb([], this); }
  }

  const document = {
    body,
    readyState: 'complete',
    createElement: (t) => reg(makeEl(t)),
    createElementNS: (ns, t) => reg(makeEl(t)),
    querySelector: (sel) => queryTree(body, sel),
    querySelectorAll: (sel) => queryTreeAll(body, sel),
    addEventListener: () => {},
  };

  // A tiny history stack: pushState records state, and the tour reads
  // history.state to tell "the user left" from "the gallery unwound
  // an overlay". Declared before `window`, which closes over it.
  // Real history starts at the page it loaded on (state null); the tour
  // pushes its own entry on top, which is where the cursor then sits.
  const historyStack = [null];
  const history = {
    get state() { return historyStack[historyStack.length - 1] || null; },
    pushState: (s) => { pushStates.push(s); historyStack.push(s); },
    // Test affordances: `back()` steps the cursor down and fires
    // popstate, exactly as a browser back-press does.
    back() { historyStack.pop(); (winListeners.popstate || []).slice().forEach(fn => fn({})); },
    landOn(i) { historyStack.length = i + 1; },
  };

  const window = {
    innerWidth: 1280,
    innerHeight: 800,
    matchMedia: () => ({ matches: reducedMotion, addEventListener() {} }),
    addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); },
    removeEventListener: (t, fn) => {
      winListeners[t] = (winListeners[t] || []).filter(f => f !== fn);
    },
    dispatchEvent: (t, ev = {}) => {
      const e = { preventDefault: () => { e.defaultPrevented = true; }, stopPropagation: () => {}, isTrusted: true, defaultPrevented: false, ...ev };
      (winListeners[t] || []).slice().forEach(fn => fn(e));
      return e;
    },
    // A tiny history stack: pushState records state, and the tour reads
    // history.state to tell "the user left" from "the gallery unwound
    // an overlay". popstate fires without changing it unless the test
    // moves the cursor, which is what a real back-press does.
    history,
    location: { pathname: '/', search: '?tour=1', assign: (url) => navigations.push(url) },
  };

  // localStorage sits alongside the DOM stubs; `history` is declared above.

  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };

  // localStorage sits alongside the DOM stubs; `history` is declared above.

  const getComputedStyle = (el) => ({
    getPropertyValue: (prop) => (prop === 'border-radius' ? (el.__radius || '4px') : ''),
  });

  const sandbox = {
    console: { warn: (msg) => warns.push(String(msg)), log: () => {}, error: () => {} },
    document,
    window,
    localStorage,
    getComputedStyle,
    IntersectionObserver,
    ResizeObserver,
    MutationObserver,
    setTimeout: (fn, ms) => { const t = { fn, ms: ms || 0, at: fakeNow + (ms || 0), cancelled: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cancelled = true; },
    Date: FakeDate,
  };
  sandbox.globalThis = sandbox;

  if (seedState) store.set('walkthrough.tourState', JSON.stringify(seedState));

  const src = (multiplierPatch
    ? oneuiSrc.replace('SPEED_MULTIPLIER = 1.25', `SPEED_MULTIPLIER = ${multiplierPatch}`)
    : oneuiSrc) + '\n' + tourSrc + '\n' + stepsSrc
    + '\n;globalThis.__T = { createGuidedTour, TOUR_STEPS, selectTourSteps, parseTourState, shouldAutoStartTour, TOUR_STORAGE_KEY, TOUR_TRANSITIONS, D, SPEED_MULTIPLIER, ONE_UI_EASING, TOAST_HOLD, CHECKMARK_HOLD };';
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tour.js' });

  return {
    X: sandbox.__T,
    body,
    warns,
    navigations,
    pushStates,
    store,
    window,
    history,
    document,
    tabPictures,
    tabAlbums,
    albumCover,
    photoCard,
    viewerPrev,
    viewerNext,
    viewerClose,
    lightboxTag,
    lightboxDelete,
    menuBtn,
    menuAdminSignin,
    menuAddPhotos,
    menuNewAlbum,
    menuSelectPhotos,
    menuAlbumSettings,
    menuSignOut,
    adminSearch,
    adminSearchFilter,
    selectClose,
    selectMove,
    selectDelete,
    fabAdd,
    albumMore,
    albumMenuAddPhotos,
    albumMenuAlbumSettings,
    dlb,
    uploadConfirm,
    newFolderBtn,
    sortConfirm,
    settingsRenameBtn,
    settingsRemoveBtn,
    settingsUndoBtn,
    settingsRevertBtn,
    tagSave,
    tokenCancel,
    newAlbumCancel,
    uploadCancel,
    sortCancel,
    settingsCancel,
    tagCancel,
    // Drain the timer queue the way a browser does: fire the
    // EARLIEST due timer and move the clock to its due time, so a
    // timer scheduled from inside a callback counts from when that
    // callback actually ran. (Jumping the clock to the end of the
    // window first would restart every nested chain from the
    // overshot time and make honest timing arithmetic fail.)
    advance: (ms) => {
      const until = fakeNow + ms;
      let ran = 0;
      for (;;) {
        let next = null;
        for (const t of timers) {
          if (t.cancelled || t.at > until) continue;
          if (!next || t.at < next.at) next = t;
        }
        if (!next) break;
        fakeNow = next.at;
        timers.splice(timers.indexOf(next), 1);
        next.fn();
        ran++;
        if (ran > 100000) throw new Error('timer drain loop');
      }
      fakeNow = until;
      return ran;
    },
    pending: () => timers.filter(t => !t.cancelled),
    allText: () => [...walk(body)].map(e => e._textContent).join('|'),
    allStyleSets: () => created.flatMap(e => e.styleSets),
  };
}

/* ── Cross-realm comparison ──────────────────────────────────────
   The sandbox is its own JavaScript realm, so every array and object
   the engine produces carries THAT realm's Array/Object prototype.
   node:assert/strict's deepEqual is deepStrictEqual, which compares
   prototypes — so an identical ['s1'] from the sandbox fails against
   an identical ['s1'] written here. Round-tripping through JSON
   normalises the value into this realm without loosening the
   comparison: same members, same types, same order. */
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const sameDeep = (actual, expected, msg) => assert.deepStrictEqual(plain(actual), plain(expected), msg);

/* Synthetic step sets — the engine is driven with small
   deterministic scenarios; the real TOUR_STEPS get one
   integration run at the end. */

const clickStep = (id, order, targetAttr, confirm = { kind: 'pulse' }) => ({
  id, order, title: 'Step ' + id, prompt: 'Do the ' + id + ' thing.',
  target: { kind: 'selector', selector: `[data-tour-target="${targetAttr}"]`, label: id },
  action: { kind: 'click' }, confirm,
});

const tourOf = (...steps) => steps;

/* Drive one click step to completion and return the tour. */
function completeClickStep(h, tour, targetEl) {
  tour.start();
  h.advance(h.X.D.base);                 // prompting → waiting
  targetEl.dispatch('click');            // the action
  h.advance(h.X.D.base + h.X.D.short); // pulse confirm
  h.advance(h.X.D.base);               // unlock fade
  return tour;
}

/* ── Gating ─────────────────────────────────────────────────── */

describe('G — gating: the action is the only way forward', () => {
  test('G1 — step 2 is NOT in the DOM while step 1 is in waiting', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start();
    h.advance(h.X.D.base); // settle → waiting
    assert.equal(tour.getPhase(), 'waiting');
    // Only one prompt card exists, and it carries step 1's text only.
    const cards = h.document.querySelectorAll('.tour-card');
    assert.equal(cards.length, 1);
    assert.ok(h.allText().includes('Step s1'));
    assert.ok(!h.allText().includes('Step s2'));
    assert.ok(!h.allText().includes('Do the s2 thing'));
  });

  test('G2 — Continue / Next buttons do not exist during a tour', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'tab-albums')) });
    tour.start();
    h.advance(h.X.D.base);
    for (const el of walk(h.body)) {
      assert.ok(!el.classSet.has('tour-continue') && !el.classSet.has('tour-next'),
        'no continue/next class may exist');
      if (el.tagName === 'BUTTON') {
        assert.ok(!/^(continue|next)$/i.test(el._textContent.trim()),
          'no Continue/Next button may exist');
      }
    }
  });

  test('G3 — clicking elsewhere does not advance', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start();
    h.advance(h.X.D.base);
    h.tabAlbums.parentNode; // sanity: target present
    // A click on a different real control (the Pictures tab) is not the action.
    h.body.children[0].dispatch('click');
    assert.equal(tour.getPhase(), 'waiting');
    assert.equal(tour.getCurrentStepId(), 's1');
  });

  test('G4 — pressing Enter outside the target does not advance', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'tab-albums')) });
    tour.start();
    h.advance(h.X.D.base);
    // Enter on a non-target element…
    h.body.children[0].dispatch('keydown', { key: 'Enter' });
    // …and Enter with no element at all (window-level).
    h.window.dispatchEvent('keydown', { key: 'Enter' });
    assert.equal(tour.getPhase(), 'waiting');
  });

  test('G5 — editing the URL does not advance', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'tab-albums')) });
    tour.start();
    h.advance(h.X.D.base);
    h.window.location.search = '?tour=1&step=2'; // URL tampering
    h.window.location.pathname = '/tour/step-2';
    assert.equal(tour.getPhase(), 'waiting');
    assert.equal(tour.getCurrentStepId(), 's1');
  });

  test('G6 — browser back exits the tour entirely', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'tab-albums')) });
    tour.start();
    h.advance(h.X.D.base);
    h.history.back(); // a real back-press steps below the tour's entry
    assert.equal(tour.getPhase(), 'complete');
    const saved = h.X.parseTourState(h.store.get('walkthrough.tourState'));
    assert.equal(saved.finished, true);
    assert.ok(saved.escapedAt, 'escape is recorded');
    // The overlay is gone from the DOM.
    assert.equal(h.document.querySelectorAll('.tour-root').length, 0);
  });
});

/* ── Detection ──────────────────────────────────────────────── */

describe('D — action detection', () => {
  test('D1 — the correct click advances to the next step', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start();
    h.advance(h.X.D.base);
    assert.equal(tour.getPhase(), 'waiting');
    h.tabAlbums.dispatch('click');
    assert.equal(tour.getPhase(), 'confirming');
    h.advance(h.X.D.base + h.X.D.short); // pulse
    h.advance(h.X.D.base); // unlock
    assert.equal(tour.getPhase(), 'prompting');
    assert.equal(tour.getCurrentStepId(), 's2');
    assert.equal(h.document.querySelectorAll('.tour-card .tour-card-title')[0]._textContent, 'Step s2');
  });

  test('D2 — a wrong click does not advance', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'album-cover')) });
    tour.start();
    h.advance(h.X.D.base);
    h.tabAlbums.dispatch('click'); // not the highlighted target
    assert.equal(tour.getPhase(), 'waiting');
  });

  test('D3 — hover fires only after durationMs of continuous hover', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf({
      id: 'h1', order: 1, title: 'Hover step', prompt: 'Hover it.',
      target: { kind: 'selector', selector: '[data-tour-target="album-cover"]', label: 'cover' },
      action: { kind: 'hover', durationMs: 500 }, confirm: { kind: 'silent' },
    }) });
    tour.start();
    h.advance(h.X.D.base);
    h.albumCover.dispatch('pointerenter');
    h.advance(499);
    assert.equal(tour.getPhase(), 'waiting'); // not yet
    h.advance(1);
    // The silent confirm settles instantly (nothing plays), so
    // the machine has already advanced through confirming.
    assert.equal(tour.getPhase(), 'unlocking'); // exactly at 500ms
  });

  test('D4 — leaving the target resets the hover timer', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf({
      id: 'h1', order: 1, title: 'Hover step', prompt: 'Hover it.',
      target: { kind: 'selector', selector: '[data-tour-target="album-cover"]', label: 'cover' },
      action: { kind: 'hover', durationMs: 500 }, confirm: { kind: 'silent' },
    }) });
    tour.start();
    h.advance(h.X.D.base);
    h.albumCover.dispatch('pointerenter');
    h.advance(250);
    h.albumCover.dispatch('pointerleave');
    h.advance(1000); // far past durationMs, but the hover was interrupted
    assert.equal(tour.getPhase(), 'waiting');
  });

  test('D5 — input fires only when the value matches', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf({
      id: 'i1', order: 1, title: 'Type step', prompt: 'Type it.',
      target: { kind: 'selector', selector: '[data-tour-target="album-cover"]', label: 'cover' },
      action: { kind: 'input', valueMatches: 'archive' }, confirm: { kind: 'silent' },
    }) });
    tour.start();
    h.advance(h.X.D.base);
    h.albumCover.value = 'nope';
    h.albumCover.dispatch('input');
    assert.equal(tour.getPhase(), 'waiting');
    h.albumCover.value = 'archive';
    h.albumCover.dispatch('input');
    // Silent confirm: the machine advances past confirming on the
    // next macrotask, so the queue must drain before we look.
    h.advance(0);
    assert.equal(tour.getPhase(), 'unlocking');
  });

  test('D6 — synthetic events (isTrusted === false) are ignored for click', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'tab-albums')) });
    tour.start();
    h.advance(h.X.D.base);
    h.tabAlbums.dispatch('click', { isTrusted: false });
    assert.equal(tour.getPhase(), 'waiting');
  });

  test('D7 — synthetic events are ignored for hover and input', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf({
      id: 'x1', order: 1, title: 'Synthetic', prompt: 'Try.',
      target: { kind: 'selector', selector: '[data-tour-target="album-cover"]', label: 'cover' },
      action: { kind: 'hover', durationMs: 300 }, confirm: { kind: 'silent' },
    }, {
      id: 'x2', order: 2, title: 'Synthetic2', prompt: 'Try.',
      target: { kind: 'selector', selector: '[data-tour-target="album-cover"]', label: 'cover' },
      action: { kind: 'input' }, confirm: { kind: 'silent' },
    }) });
    tour.start();
    h.advance(h.X.D.base);
    h.albumCover.dispatch('pointerenter', { isTrusted: false });
    h.advance(1000);
    assert.equal(tour.getPhase(), 'waiting');
    h.albumCover.value = 'anything';
    h.albumCover.dispatch('input', { isTrusted: false });
    assert.equal(tour.getPhase(), 'waiting');
  });

  test('D8 — custom events are honored only via tour:action with the expected detail', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf({
      id: 'c1', order: 1, title: 'Custom', prompt: 'Dispatch.',
      target: { kind: 'selector', selector: '[data-tour-target="album-cover"]', label: 'cover' },
      action: { kind: 'custom', eventName: 'panel-open' }, confirm: { kind: 'silent' },
    }) });
    tour.start();
    h.advance(h.X.D.base);
    // Wrong event name on the right channel.
    h.window.dispatchEvent('tour:action', { detail: { name: 'panel-close' } });
    assert.equal(tour.getPhase(), 'waiting');
    // Right detail on the wrong channel.
    h.window.dispatchEvent('some-other-event', { detail: { name: 'panel-open' } });
    assert.equal(tour.getPhase(), 'waiting');
    // The real thing.
    h.window.dispatchEvent('tour:action', { detail: { name: 'panel-open' } });
    // Silent confirm: honored, and the machine advances through
    // confirming on the next macrotask, so drain before looking.
    h.advance(0);
    assert.equal(tour.getPhase(), 'unlocking');
  });
});

/* ── Confirm + unlock ─────────────────────────────────────── */

describe('C — confirmation and the unlock hand-off', () => {
  test('C1 — the confirm animation plays exactly once per step', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums', { kind: 'pulse' }),
      clickStep('s2', 2, 'album-cover', { kind: 'pulse' }),
    ) });
    completeClickStep(h, tour, h.tabAlbums);
    // s1's confirm timers (pulse: D.base/2 scale, D.base fade,
    // D.base + D.short done) have all fired and been removed;
    // only s2's settle timer (D.base) remains pending.
    assert.equal(h.pending().filter(t => t.ms === h.X.D.base).length, 1);
    assert.equal(h.pending().filter(t => t.ms === h.X.D.base / 2).length, 0);
    const saved = h.X.parseTourState(h.store.get('walkthrough.tourState'));
    sameDeep(saved.completed, ['s1']); // recorded once, never twice
  });

  test('C2 — the current highlight fully fades before the next appears', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start();
    h.advance(h.X.D.base);
    const card = h.document.querySelector('.tour-card');
    h.tabAlbums.dispatch('click');
    h.advance(h.X.D.base + h.X.D.short); // confirm done → unlocking starts (fade over D.base)
    assert.equal(tour.getPhase(), 'unlocking');
    assert.equal(card.style.opacity, '0');      // fully faded…
    assert.equal(textTree(card), '1 / 2Step s1Do the s1 thing.Skip this stepEnd tour'); // …and still step 1's text
    h.advance(h.X.D.base - 1);
    assert.equal(textTree(card), '1 / 2Step s1Do the s1 thing.Skip this stepEnd tour'); // not yet re-populated
    h.advance(1);                                // unlock fires
    assert.equal(textTree(card), '2 / 2Step s2Do the s2 thing.Skip this stepEnd tour'); // next step's text exists now, count and title together
  });

  test('C3 — no overlap between outgoing and incoming prompt cards', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
      clickStep('s3', 3, 'photo-card'),
    ) });
    tour.start();
    h.advance(h.X.D.base); // step 1 arms
    // Each chain runs confirm + unlock + the next step's
    // settle, so every click lands on an armed step.
    const arm = h.X.D.base + h.X.D.short + h.X.D.base + h.X.D.base;
    for (let i = 0; i < 2; i++) {
      const targets = [h.tabAlbums, h.albumCover];
      targets[i].dispatch('click');
      h.advance(arm);
      assert.equal(h.document.querySelectorAll('.tour-card').length, 1,
        'exactly one prompt card may exist at any moment');
    }
  });

  test('C4 — the toast holds for its full duration before unlock', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums', { kind: 'toast', text: 'Done.' }),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start();
    h.advance(h.X.D.base);
    h.tabAlbums.dispatch('click');
    assert.equal(tour.getPhase(), 'confirming');
    // D.short + TOAST_HOLD (2 × D.long) + D.short − 1: still confirming.
    h.advance(h.X.D.short + h.X.TOAST_HOLD + h.X.D.short - 1);
    assert.equal(tour.getPhase(), 'confirming');
    h.advance(1); // toast done → unlock
    assert.equal(tour.getPhase(), 'unlocking');
    h.advance(h.X.D.base);
    assert.equal(tour.getCurrentStepId(), 's2');
  });
});

/* ── Escape ───────────────────────────────────────────────── */

describe('E — escape hatches', () => {
  test('E1 — skip-action advances without adding to completed', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start();
    h.advance(h.X.D.base);
    const skipLinks = h.document.querySelectorAll('.tour-card-escapes .tour-escape-link');
    assert.equal(skipLinks.length, 2);
    skipLinks[0].dispatch('click'); // "Skip this step"
    h.advance(h.X.D.base); // unlock
    assert.equal(tour.getPhase(), 'prompting');
    assert.equal(tour.getCurrentStepId(), 's2');
    const saved = h.X.parseTourState(h.store.get('walkthrough.tourState'));
    sameDeep(saved.completed, []);      // NOT completed
    sameDeep(saved.skipped, ['s1']);    // recorded as skipped
  });

  test('E2 — skip-tour ends the tour and routes to the archive root', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'tab-albums')) });
    tour.start();
    h.advance(h.X.D.base);
    const skipLinks = h.document.querySelectorAll('.tour-card-escapes .tour-escape-link');
    skipLinks[1].dispatch('click'); // "End tour"
    assert.equal(tour.getPhase(), 'complete');
    sameDeep(h.navigations, ['/'], 'routes to the archive root');
    const saved = h.X.parseTourState(h.store.get('walkthrough.tourState'));
    assert.equal(saved.finished, true);
    assert.ok(saved.escapedAt);
    assert.equal(h.document.querySelectorAll('.tour-root').length, 0);
  });

  test('E3 — the Escape key opens the hatch menu', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'tab-albums')) });
    tour.start();
    h.advance(h.X.D.base);
    const menu = h.document.querySelector('.tour-escape-menu');
    assert.equal(menu.hidden, true);
    h.window.dispatchEvent('keydown', { key: 'Escape' });
    assert.equal(menu.hidden, false);
    assert.equal(menu.querySelectorAll('.tour-escape-link').length, 2);
    h.window.dispatchEvent('keydown', { key: 'Escape' }); // toggles closed
    assert.equal(menu.hidden, true);
  });

  test('E4 — a step whose target is missing is skipped, not rendered', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      { id: 's2', order: 2, title: 'Ghost step', prompt: 'Never rendered.',
        target: { kind: 'selector', selector: '[data-tour-target="does-not-exist"]', label: 'ghost' },
        action: { kind: 'click' }, confirm: { kind: 'pulse' } },
      clickStep('s3', 3, 'album-cover'),
    ) });
    tour.start();
    h.advance(h.X.D.base);
    h.tabAlbums.dispatch('click');
    h.advance(h.X.D.base + h.X.D.short); // confirm
    h.advance(h.X.D.base); // unlock → renderStep(s2): target missing → wait
    assert.equal(tour.getCurrentStepId(), 's2');
    // The ghost step never renders its card; the wait expires and it is skipped.
    h.advance(10000); // TARGET_WAIT_MS
    h.advance(h.X.D.base);   // unlock skip → s3
    assert.equal(tour.getPhase(), 'prompting');
    assert.equal(tour.getCurrentStepId(), 's3');
    assert.ok(!h.allText().includes('Ghost step'));
    assert.ok(!h.allText().includes('Never rendered.'));
    const saved = h.X.parseTourState(h.store.get('walkthrough.tourState'));
    sameDeep(saved.skipped, ['s2']);
    assert.ok(h.warns.some(w => w.includes('s2')), 'the skip is logged');
  });
});

/* ── Persistence ──────────────────────────────────────────── */

describe('P — persistence', () => {
  test('P1 — reloading resumes at currentStepId with the same highlight', () => {
    const h = setup({ seedState: {
      startedAt: '2026-01-01T00:00:00.000Z',
      currentStepId: 's2',
      completed: ['s1'],
      skipped: [],
      escapedAt: null,
      finished: false,
    } });
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start({ resume: true });
    assert.equal(tour.getCurrentStepId(), 's2');
    assert.equal(h.document.querySelector('.tour-card .tour-card-title')._textContent, 'Step s2');
    assert.equal(h.document.querySelector('.tour-card .tour-card-count')._textContent, '2 / 2');
  });

  test('P2 — completed is append-only and monotonic across sessions', () => {
    const h = setup();
    const tour1 = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    completeClickStep(h, tour1, h.tabAlbums);
    // "Reload": a fresh engine over the same persisted storage.
    const tour2 = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour2.start({ resume: true });
    assert.equal(tour2.getCurrentStepId(), 's2');
    h.advance(h.X.D.base);
    h.albumCover.dispatch('click');
    h.advance(h.X.D.base + h.X.D.short);
    h.advance(h.X.D.base);
    const saved = h.X.parseTourState(h.store.get('walkthrough.tourState'));
    sameDeep(saved.completed, ['s1', 's2']); // in order, no duplicates
  });

  test('P3 — finished: true prevents re-starting on the next visit', () => {
    const h = setup();
    const params = (v) => ({ get: (k) => (k === 'tour' ? v : null) });
    assert.equal(h.X.shouldAutoStartTour({ finished: true }, params('1')), false);
    assert.equal(h.X.shouldAutoStartTour({ finished: true, currentStepId: 's1' }, params(null)), false);
    assert.equal(h.X.shouldAutoStartTour(null, params('1')), true);
    assert.equal(h.X.shouldAutoStartTour({ finished: false, currentStepId: 's2' }, params(null)), true);
    assert.equal(h.X.shouldAutoStartTour(null, params(null)), false);
  });

  test('P4 — a fresh start resets the persisted lists', () => {
    const h = setup({ seedState: {
      startedAt: '2026-01-01T00:00:00.000Z', currentStepId: 's1',
      completed: ['old-1'], skipped: ['old-2'], escapedAt: null, finished: false,
    } });
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'tab-albums')) });
    tour.start(); // no resume → fresh start
    const saved = h.X.parseTourState(h.store.get('walkthrough.tourState'));
    sameDeep(saved.completed, []);
    sameDeep(saved.skipped, []);
  });
});

/* ── Motion + a11y ────────────────────────────────────────── */

describe('M — reduced motion and accessibility', () => {
  test('M1 — reduced motion: no animation, every state change is instant', () => {
    const h = setup({ reducedMotion: true });
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start();
    h.advance(0); // settle timer is 0ms
    assert.equal(tour.getPhase(), 'waiting');
    h.tabAlbums.dispatch('click');
    h.advance(0); // confirm + unlock + next settle: all 0ms, chained
    // The whole machine drained instantly — step 2 is armed.
    assert.equal(tour.getPhase(), 'waiting');
    assert.equal(tour.getCurrentStepId(), 's2');
    // The ring is solid, not drawn in: dashoffset is 0 from the start.
    const ringRect = h.document.querySelector('.tour-ring-rect');
    assert.equal(ringRect.getAttribute('stroke-dashoffset'), '0');
    // Every transition duration that was set is 0ms.
    const durations = [];
    for (const s of h.allStyleSets()) {
      const m = s.match(/(\d+(?:\.\d+)?)ms/);
      if (m) durations.push(parseFloat(m[1]));
    }
    assert.ok(durations.length > 0);
    for (const d of durations) assert.equal(d, 0);
  });

  test('M2 — aria-live announces each prompt', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start();
    const card = h.document.querySelector('.tour-card');
    assert.equal(card.getAttribute('aria-live'), 'polite');
    const prompt = h.document.querySelector('.tour-card-prompt');
    assert.equal(prompt._textContent, 'Do the s1 thing.');
    completeClickStep(h, tour, h.tabAlbums);
    assert.equal(h.document.querySelector('.tour-card-prompt')._textContent, 'Do the s2 thing.');
  });

  test('M3 — aria-describedby is on the target during the step, removed after', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start();
    h.advance(h.X.D.base);
    const describedBy = h.tabAlbums.getAttribute('aria-describedby');
    assert.ok(describedBy, 'target is described while the step is active');
    assert.equal(describedBy, h.document.querySelector('.tour-card-prompt').id);
    completeClickStep(h, tour, h.tabAlbums);
    assert.equal(h.tabAlbums.getAttribute('aria-describedby'), null);
  });

  test('M4 — focus can always leave the tour via Tab', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'tab-albums')) });
    tour.start();
    h.advance(h.X.D.base);
    // Tab is never intercepted…
    const ev = h.window.dispatchEvent('keydown', { key: 'Tab' });
    assert.equal(ev.defaultPrevented, false);
    // …and the prompt card is not made focusable (no tabindex on it).
    const card = h.document.querySelector('.tour-card');
    assert.equal(card.hasAttribute('tabindex'), false);
  });

  test('M5 — non-native targets get tabindex for the step, then lose it', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'album-cover'), // a <figure>, not natively focusable
      clickStep('s2', 2, 'tab-albums'),  // a <button>, natively focusable
    ) });
    tour.start();
    h.advance(h.X.D.base);
    assert.equal(h.albumCover.getAttribute('tabindex'), '0');
    completeClickStep(h, tour, h.albumCover);
    assert.equal(h.albumCover.getAttribute('tabindex'), null);
    h.advance(h.X.D.base); // s2 settle
    // The button keeps its own focusability; the engine adds nothing.
    assert.equal(h.tabAlbums.getAttribute('data-tour-tabindex'), null);
    assert.equal(h.tabAlbums.hasAttribute('tabindex'), false);
  });
});

/* ── Speed multiplier ─────────────────────────────────────── */

describe('S — the speed multiplier is the single timing source', () => {
  test('S1 — SPEED_MULTIPLIER = 2.0 scales every tour timing', () => {
    const h = setup({ multiplierPatch: 2.0 });
    assert.equal(h.X.D.short, 200);
    assert.equal(h.X.D.base, 600);
    assert.equal(h.X.D.long, 1000);
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start();
    // The settle timer (prompting → waiting) is D.base = 600ms at ×2.0.
    assert.ok(h.pending().some(t => t.ms === 600), 'settle timer scaled');
    h.advance(600);
    h.tabAlbums.dispatch('click');
    // The unlock fade is D.base = 600ms at ×2.0.
    h.advance(600);  // pulse: D.base + D.short = 800… advance in steps
    h.advance(200);
    h.advance(600);  // unlock fade
    assert.equal(tour.getCurrentStepId(), 's2');
  });

  test('S2 — at ×1.25 no hardcoded durations remain; all derive from D', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums', { kind: 'toast', text: 'Done.' }),
      clickStep('s2', 2, 'album-cover', { kind: 'checkmark' }),
      clickStep('s3', 3, 'photo-card', { kind: 'silent' }),
    ) });
    // Run the whole tour — every confirm kind, plus unlocks.
    // Each chain includes the next step's settle, so every
    // step is armed (waiting) before its click lands.
    const arm = h.X.D.short + h.X.TOAST_HOLD + h.X.D.short + h.X.D.base + h.X.D.base;
    tour.start();
    h.advance(h.X.D.base);
    for (const target of [h.tabAlbums, h.albumCover, h.photoCard]) {
      target.dispatch('click');
      h.advance(arm);
    }
    assert.equal(tour.getPhase(), 'complete');
    const allowed = new Set([0, h.X.D.short, h.X.D.base, h.X.D.long, h.X.D.base / 2]);
    const seen = new Set();
    // The overlay is torn down on completion, so audit every
    // element the sandbox ever built, not just the live tree.
    for (const s of h.allStyleSets()) {
      if (!s.startsWith('transition=')) continue;
      for (const m of s.matchAll(/(\d+(?:\.\d+)?)ms/g)) {
        const d = parseFloat(m[1]);
        seen.add(d);
        assert.ok(allowed.has(d), `duration ${d}ms is not derived from D: ${s}`);
      }
    }
    assert.ok(seen.size > 0, 'transitions were exercised');
  });
});

/* ── Integration: the real authored tour ──────────────────── */

describe('T — the real TOUR_STEPS integration', () => {
  test('T1 — the authored 56-step tour runs end to end on the real targets', () => {
    const h = setup();
    assert.equal(h.X.TOUR_STEPS.length, 56);
    const tour = h.X.createGuidedTour({ steps: h.X.TOUR_STEPS });
    tour.start();
    // A step's action listener is bound when it reaches
    // waiting — so every advance chain below runs
    // confirm + unlock + the NEXT step's settle, leaving
    // each step armed (waiting) before its action.
    const arm = h.X.D.base + h.X.D.short + h.X.D.base + h.X.D.base;
    // A toast confirm holds (D.short + TOAST_HOLD + D.short)
    // before the unlock fade; a NON-final toast step needs
    // one more D.base so the next step settles into waiting.
    const toastArm = h.X.D.short + h.X.TOAST_HOLD + h.X.D.short + h.X.D.base;
    const toastArmNext = toastArm + h.X.D.base;
    const step = (id, targetEl, advanceAfter = arm) => {
      assert.equal(tour.getCurrentStepId(), id);
      targetEl.dispatch('click');
      h.advance(advanceAfter);
    };
    const type = (id, value) => {
      assert.equal(tour.getCurrentStepId(), id);
      h.adminSearch.value = value;
      h.adminSearch.dispatch('input');
      h.advance(arm);
    };
    h.advance(h.X.D.base); // step 1 arms
    // Segment 1 — the shared path (every visitor).
    step('wall-photo', h.photoCard);
    step('viewer-next', h.viewerNext);
    step('viewer-prev', h.viewerPrev);
    step('viewer-close', h.viewerClose);
    step('albums-tab', h.tabAlbums);
    step('album-open', h.albumCover);
    step('album-photo', h.photoCard);
    step('album-viewer-close', h.viewerClose);
    step('menu-open', h.menuBtn);
    // Segment 2 — the visitor-only sign-in reveal.
    step('menu-admin-signin', h.menuAdminSignin);
    step('admin-modal-cancel', h.tokenCancel, toastArmNext);
    // Segment 3 — every admin control. The raw authored
    // array walks it end to end here; boot.js hands these
    // steps to the engine only when the tour starts signed
    // in as admin (see T3).
    step('menu-add-photos', h.menuAddPhotos);
    step('upload-confirm', h.uploadConfirm);
    step('upload-cancel', h.uploadCancel);
    step('fab-add', h.fabAdd);
    step('upload-cancel-2', h.uploadCancel);
    step('pictures-tab', h.tabPictures);
    type('search-type', 'sunset');
    // The scope step is an input action on a <select>.
    assert.equal(tour.getCurrentStepId(), 'search-scope');
    h.adminSearchFilter.value = 'image';
    h.adminSearchFilter.dispatch('input');
    h.advance(arm);
    // The clear step counts only an EMPTY box: typing more
    // text fires input but never advances.
    assert.equal(tour.getCurrentStepId(), 'search-clear');
    h.adminSearch.value = 'still typing';
    h.adminSearch.dispatch('input');
    assert.equal(tour.getPhase(), 'waiting');
    h.adminSearch.value = '';
    h.adminSearch.dispatch('input');
    h.advance(arm);
    step('menu-open-2', h.menuBtn);
    step('menu-new-album', h.menuNewAlbum);
    step('new-album-pick', h.newFolderBtn);
    step('new-album-cancel', h.newAlbumCancel);
    step('menu-open-3', h.menuBtn);
    step('menu-select-photos', h.menuSelectPhotos);
    step('pick-photo', h.photoCard);
    step('select-move', h.selectMove);
    step('move-confirm', h.sortConfirm);
    step('move-cancel', h.sortCancel);
    step('select-delete', h.selectDelete);
    step('select-close', h.selectClose);
    step('menu-open-4', h.menuBtn);
    step('menu-album-settings', h.menuAlbumSettings);
    step('settings-rename', h.settingsRenameBtn);
    step('settings-remove', h.settingsRemoveBtn);
    step('settings-undo', h.settingsUndoBtn);
    step('settings-revert', h.settingsRevertBtn);
    step('album-settings-cancel', h.settingsCancel);
    step('albums-tab-2', h.tabAlbums);
    step('album-menu-open', h.albumMore);
    step('album-menu-add-photos', h.albumMenuAddPhotos);
    step('album-menu-open-2', h.albumMore);
    step('menu-album-settings-2', h.albumMenuAlbumSettings);
    step('album-settings-cancel-2', h.settingsCancel);
    step('pictures-tab-2', h.tabPictures);
    step('wall-photo-2', h.photoCard);
    step('viewer-download', h.dlb);
    step('viewer-classify', h.lightboxTag);
    step('classify-save', h.tagSave);
    step('viewer-classify-2', h.lightboxTag);
    step('classify-cancel', h.tagCancel);
    step('viewer-delete', h.lightboxDelete);
    step('viewer-close-2', h.viewerClose);
    step('menu-open-5', h.menuBtn);
    step('menu-sign-out', h.menuSignOut, toastArm);
    assert.equal(tour.getPhase(), 'complete');
    const saved = h.X.parseTourState(h.store.get('walkthrough.tourState'));
    sameDeep(saved.completed, [
      'wall-photo', 'viewer-next', 'viewer-prev', 'viewer-close',
      'albums-tab', 'album-open', 'album-photo', 'album-viewer-close',
      'menu-open', 'menu-admin-signin', 'admin-modal-cancel',
      'menu-add-photos', 'upload-confirm', 'upload-cancel',
      'fab-add', 'upload-cancel-2', 'pictures-tab',
      'search-type', 'search-scope', 'search-clear',
      'menu-open-2', 'menu-new-album', 'new-album-pick', 'new-album-cancel',
      'menu-open-3', 'menu-select-photos', 'pick-photo',
      'select-move', 'move-confirm', 'move-cancel', 'select-delete',
      'select-close', 'menu-open-4', 'menu-album-settings',
      'settings-rename', 'settings-remove', 'settings-undo',
      'settings-revert', 'album-settings-cancel', 'albums-tab-2',
      'album-menu-open', 'album-menu-add-photos', 'album-menu-open-2',
      'menu-album-settings-2', 'album-settings-cancel-2', 'pictures-tab-2',
      'wall-photo-2', 'viewer-download', 'viewer-classify',
      'classify-save', 'viewer-classify-2', 'classify-cancel',
      'viewer-delete', 'viewer-close-2', 'menu-open-5', 'menu-sign-out',
    ]);
    assert.equal(saved.finished, true);
    assert.equal(saved.currentStepId, null);
  });

  test('T2 — the tour pushes a history entry so back exits it', () => {
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: h.X.TOUR_STEPS });
    tour.start();
    sameDeep(h.pushStates, [{ guidedTour: true }]);
  });

  test('T2b — the gallery unwinding an overlay is NOT the user leaving', () => {
    // Regression: the gallery closes overlays by popping a history
    // entry, so closing the viewer with its Back button fires a
    // popstate. The tour used to read that as "back pressed" and tore
    // itself down — which ended the visitor walk at step 4 of 11.
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(
      clickStep('s1', 1, 'tab-albums'),
      clickStep('s2', 2, 'album-cover'),
    ) });
    tour.start();
    h.advance(h.X.D.base);
    // The gallery pushes its overlay entry, then closes it: announce,
    // then pop.
    h.window.dispatchEvent('gallery:history-pop');
    h.history.back();
    assert.equal(tour.getPhase(), 'waiting', 'an overlay close must not exit the tour');
    assert.notEqual(tour.getCurrentStepId(), null);
    assert.equal(h.document.querySelectorAll('.tour-root').length, 1, 'the overlay stays up');
    // And the tour still works afterwards.
    h.tabAlbums.dispatch('click');
    h.advance(h.X.D.base + h.X.D.short + h.X.D.base + h.X.D.base);
    assert.equal(tour.getCurrentStepId(), 's2');
  });

  test('T2c — a pop landing on the tour entry is not an exit either', () => {
    // Covers an overlay opened before the announcement path: the pop
    // lands on the tour's own entry, so the user has not left.
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'tab-albums')) });
    tour.start();
    h.advance(h.X.D.base);
    h.window.dispatchEvent('popstate'); // cursor still on the tour entry
    assert.equal(tour.getPhase(), 'waiting');
    assert.equal(h.document.querySelectorAll('.tour-root').length, 1);
  });

  test('T2d — a genuine back-press still exits the tour', () => {
    // The guard must not blunt the real escape hatch: stepping below
    // the tour's own entry is the user leaving.
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'tab-albums')) });
    tour.start();
    h.advance(h.X.D.base);
    assert.equal(h.history.state && h.history.state.guidedTour, true);
    h.history.back(); // now below the tour entry
    assert.equal(tour.getPhase(), 'complete');
    const saved = h.X.parseTourState(h.store.get('walkthrough.tourState'));
    assert.equal(saved.finished, true);
    assert.ok(saved.escapedAt, 'a real escape is recorded as escaped, not completed');
  });

  test('T2e — the announcement is consumed once, not sticky', () => {
    // If the flag never cleared, a later REAL back-press would be
    // swallowed and the tour would refuse to exit.
    const h = setup();
    const tour = h.X.createGuidedTour({ steps: tourOf(clickStep('s1', 1, 'tab-albums')) });
    tour.start();
    h.advance(h.X.D.base);
    h.window.dispatchEvent('gallery:history-pop');
    h.history.back(); // consumed by this pop
    // A second, unannounced back-press (below the tour entry) must exit.
    h.history.back();
    assert.equal(tour.getPhase(), 'complete');
  });

  test('T3 — selectTourSteps splits the audiences and renumbers', () => {
    const h = setup();
    const visitor = h.X.selectTourSteps(h.X.TOUR_STEPS, false);
    const admin = h.X.selectTourSteps(h.X.TOUR_STEPS, true);
    // Visitors never see admin steps; admins never see the
    // sign-in reveal — the tour never renders a step the
    // user cannot perform.
    assert.ok(visitor.every(s => !s.adminOnly));
    assert.ok(admin.every(s => !s.visitorOnly));
    assert.equal(visitor.length, 11);
    assert.equal(admin.length, 54);
    // Orders renumber 1..N for the audience's own walk.
    sameDeep(visitor.map(s => s.order), visitor.map((_, i) => i + 1));
    sameDeep(admin.map(s => s.order), admin.map((_, i) => i + 1));
    // The shared path is identical for both audiences.
    sameDeep(visitor.slice(0, 9).map(s => s.id), admin.slice(0, 9).map(s => s.id));
    // Each walk ends on its own completion toast.
    assert.equal(visitor[visitor.length - 1].id, 'admin-modal-cancel');
    assert.equal(admin[admin.length - 1].id, 'menu-sign-out');
    // The authored array itself is never mutated.
    assert.equal(h.X.TOUR_STEPS.length, 56);
    assert.equal(h.X.TOUR_STEPS[0].order, 1);
    assert.equal(h.X.TOUR_STEPS[55].order, 56);
  });

  test('T4 — an input step with valueMatches "" counts only an empty box', () => {
    const h = setup();
    const clearStep = {
      id: 'clear', order: 1, title: 'Clear the search', prompt: 'Delete the text.',
      target: { kind: 'selector', selector: '[data-tour-target="admin-search"]', label: 'search box' },
      action: { kind: 'input', valueMatches: '' }, confirm: { kind: 'pulse' },
    };
    const tour = h.X.createGuidedTour({ steps: tourOf(clearStep) });
    tour.start();
    h.advance(h.X.D.base);
    assert.equal(tour.getPhase(), 'waiting');
    // Typing more text fires input but does not count…
    h.adminSearch.value = 'still typing';
    h.adminSearch.dispatch('input');
    assert.equal(tour.getPhase(), 'waiting');
    // …an empty box does.
    h.adminSearch.value = '';
    h.adminSearch.dispatch('input');
    assert.equal(tour.getPhase(), 'confirming');
    h.advance(h.X.D.base + h.X.D.short + h.X.D.base + h.X.D.base);
    assert.equal(tour.getPhase(), 'complete');
  });

  test('T5 — an input action works on a select (the scope picker)', () => {
    const h = setup();
    const scopeStep = {
      id: 'scope', order: 1, title: 'Pick a scope', prompt: 'Pick one.',
      target: { kind: 'selector', selector: '[data-tour-target="admin-search-filter"]', label: 'scope dropdown' },
      action: { kind: 'input' }, confirm: { kind: 'pulse' },
    };
    const tour = h.X.createGuidedTour({ steps: tourOf(scopeStep) });
    tour.start();
    h.advance(h.X.D.base);
    assert.equal(tour.getPhase(), 'waiting');
    h.adminSearchFilter.value = 'image';
    h.adminSearchFilter.dispatch('input');
    assert.equal(tour.getPhase(), 'confirming');
  });

  test('T6 — the authored tour is well-formed', () => {
    const h = setup();
    const ids = new Set();
    h.X.TOUR_STEPS.forEach((s, i) => {
      assert.ok(s.id && !ids.has(s.id), 'unique id at ' + i);
      ids.add(s.id);
      assert.equal(s.order, i + 1, 'sequential order at ' + i);
      assert.ok(s.title && s.prompt, 'title and prompt at ' + i);
      assert.ok(s.target && s.target.kind === 'selector' && s.target.selector, 'selector target at ' + i);
      assert.ok(s.action && s.action.kind, 'action at ' + i);
      assert.ok(s.confirm && s.confirm.kind, 'confirm at ' + i);
      if (s.confirm.kind === 'toast') assert.ok(s.confirm.text, 'toast text at ' + i);
    });
    // Exactly one step ends each audience's walk, on a toast.
    sameDeep(
      h.X.TOUR_STEPS.filter(s => s.confirm.kind === 'toast').map(s => s.id),
      ['admin-modal-cancel', 'menu-sign-out']);
    // The segments: 9 shared, 2 visitor-only, 45 admin-only.
    assert.equal(h.X.TOUR_STEPS.filter(s => s.visitorOnly).length, 2);
    assert.equal(h.X.TOUR_STEPS.filter(s => s.adminOnly).length, 45);
    assert.equal(h.X.TOUR_STEPS.filter(s => !s.adminOnly && !s.visitorOnly).length, 9);
  });
});

/* ── Coverage: the tour promises to reveal every button ────── */

describe('U — every button is toured', () => {
  // The buttons no step targets, each with the reason it
  // cannot be one. Anything else un-targeted fails the audit.
  const EXCLUDED = {
    tokenSubmit: 'signing in needs a real repo token — a visitor cannot perform it',
    comfortBtn: 'display preference, not part of the archive flow — it opens a self-contained picker',
  };

  test('U1 — every static button is a tour step or an explicit exclusion', () => {
    const h = setup();
    const html = fs.readFileSync(join(here, '..', 'index.html'), 'utf8');
    const selectors = h.X.TOUR_STEPS.map(s => s.target.selector);
    const gaps = [];
    for (const m of html.matchAll(/<button[^>]*\bid="([^"]+)"([^>]*)>/g)) {
      const id = m[1];
      if (EXCLUDED[id]) continue;
      const t = /data-tour-target="([^"]+)"/.exec(m[2]);
      if (!t) { gaps.push(id + ' (no data-tour-target)'); continue; }
      const hit = selectors.some(sel => sel.includes('"' + t[1] + '"') || sel.includes('#' + id));
      if (!hit) gaps.push(id + ' (' + t[1] + ' targeted by no step)');
    }
    sameDeep(gaps, []);
  });

  test('U2 — the runtime-built controls are toured too', () => {
    // Built by app.js at runtime (albumCardMarkup / albumMenu),
    // so the static audit above cannot see them.
    const h = setup();
    const app = fs.readFileSync(join(here, '..', 'app.js'), 'utf8');
    for (const t of ['album-menu', 'album-menu-add-photos', 'album-menu-album-settings',
                     'menu-add-photos', 'menu-new-album', 'menu-select-photos',
                     'menu-album-settings', 'menu-sign-out', 'menu-admin-signin']) {
      // A menu item is hooked via tourTarget: '…'; the album chip
      // carries data-tour-target="…" inside its template. Accept either.
      const hooked = app.includes('data-tour-target="' + t + '"') ||
                     app.includes("tourTarget: '" + t + "'");
      assert.ok(hooked, t + ' is not hooked in app.js');
      assert.ok(h.X.TOUR_STEPS.some(s => s.target.selector.includes('"' + t + '"')),
        t + ' is targeted by no step');
    }
  });

  test('U3 — the unguarded commit buttons are flagged and say how to pass them', () => {
    const h = setup();
    const marked = h.X.TOUR_STEPS.filter(s => s.commit).map(s => s.id);
    sameDeep(marked, ['upload-confirm', 'settings-undo']);
    for (const id of marked) {
      const s = h.X.TOUR_STEPS.find(x => x.id === id);
      assert.ok(/skip/i.test(s.prompt), id + ' prompt must offer the way past');
      assert.ok(/real/i.test(s.hint), id + ' hint must say the click is real');
    }
  });
});
